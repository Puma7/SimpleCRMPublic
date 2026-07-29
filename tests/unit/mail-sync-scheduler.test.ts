import {
  DEFAULT_MAIL_SYNC_INTERVAL_MS,
  mailSyncJobTypeForProtocol,
  runMailSyncSchedule,
} from '../../packages/server/src/jobs/mail-sync-scheduler';
import type { ServerDatabase } from '../../packages/server/src/db/schema';
import type { Kysely } from 'kysely';

const WORKSPACE = '11111111-1111-4111-8111-111111111111';
const NOW = new Date('2026-07-29T12:00:00.000Z');

type Account = { id: number; protocol: string | null; last_sync_started_at: Date | null };

/**
 * Nachbau der beiden Zugriffe, die der Scheduler macht: die Auswahl der
 * faelligen Konten und das bedingte UPDATE, mit dem er sie beansprucht. Der
 * Mock haelt die WHERE-Bedingung wirklich ein — sonst pruefte der Test die
 * Serialisierung nicht mit, die er behauptet.
 */
function fakeDb(accounts: Account[], options: { claimedBySomeoneElse?: Set<number> } = {}) {
  const claims: number[] = [];
  const db = {
    transaction() {
      return {
        async execute<T>(operation: (trx: unknown) => Promise<T>): Promise<T> {
          return operation(trx);
        },
      };
    },
  };
  const trx = {
    selectFrom() {
      const state: { threshold?: Date; limit?: number; targetId?: number; singleLookup?: boolean } = {};
      const builder = {
        select() { return builder },
        where(arg: unknown, column?: unknown, value?: unknown) {
          if (typeof arg === 'function') {
            const eb = Object.assign(
              (..._parts: unknown[]) => ({}),
              { or: (parts: unknown[]) => parts },
            );
            (arg as (builder: unknown) => unknown)(eb);
          } else if (arg === 'id') {
            state.targetId = value as number;
            state.singleLookup = true;
          }
          return builder
        },
        orderBy() { return builder },
        limit(value: number) { state.limit = value; return builder },
        async executeTakeFirst() {
          if (state.singleLookup && state.targetId !== undefined) {
            const account = accounts.find((entry) => entry.id === state.targetId);
            return account ? { last_sync_started_at: account.last_sync_started_at } : undefined;
          }
          return undefined;
        },
        async execute() {
          const due = accounts
            .filter((account) => account.last_sync_started_at === null
              || account.last_sync_started_at.getTime() < NOW.getTime() - DEFAULT_MAIL_SYNC_INTERVAL_MS)
            .sort((left, right) => {
              const a = left.last_sync_started_at?.getTime() ?? -1;
              const b = right.last_sync_started_at?.getTime() ?? -1;
              return a - b || left.id - right.id;
            });
          return due.slice(0, state.limit ?? due.length)
            .map((account) => ({ id: account.id, protocol: account.protocol }));
        },
      };
      return builder
    },
    updateTable() {
      let targetId: number | undefined;
      let rollbackTo: Date | null | undefined;
      const builder = {
        set(values: { last_sync_started_at?: Date | null }) {
          if ('last_sync_started_at' in values) rollbackTo = values.last_sync_started_at ?? null;
          return builder
        },
        where(column: unknown, _op?: unknown, value?: unknown) {
          if (column === 'id') targetId = value as number;
          return builder
        },
        returning() { return builder },
        async executeTakeFirst() {
          if (targetId === undefined) return undefined;
          // Eine zweite Serverinstanz war schneller: das bedingte UPDATE trifft
          // dann keine Zeile mehr.
          if (options.claimedBySomeoneElse?.has(targetId)) return undefined;
          const account = accounts.find((entry) => entry.id === targetId);
          if (!account) return undefined;
          account.last_sync_started_at = NOW;
          claims.push(targetId);
          return { id: targetId };
        },
        async execute() {
          if (targetId === undefined) return;
          const account = accounts.find((entry) => entry.id === targetId);
          if (!account) return;
          account.last_sync_started_at = rollbackTo ?? null;
        },
      };
      return builder
    },
  };
  return { db: db as unknown as Kysely<ServerDatabase>, claims };
}

function fakeQueue(failForAccountIds: Set<number> = new Set()) {
  const enqueued: Array<{ type: string; accountId: unknown; hasActor: boolean }> = [];
  return {
    enqueued,
    queue: {
      async enqueue(input: { type: string; payload: Record<string, unknown> }) {
        const accountId = input.payload.accountId as number;
        if (failForAccountIds.has(accountId)) {
          throw new Error('enqueue failed');
        }
        enqueued.push({
          type: input.type,
          accountId,
          hasActor: 'actorUserId' in input.payload,
        });
      },
    },
  };
}

describe('periodischer Mail-Sync', () => {
  test('reiht nur faellige Konten ein und stempelt sie dabei', async () => {
    const { db, claims } = fakeDb([
      { id: 1, protocol: 'imap', last_sync_started_at: null },
      { id: 2, protocol: 'imap', last_sync_started_at: new Date(NOW.getTime() - 60_000) },
      { id: 3, protocol: 'pop3', last_sync_started_at: new Date(NOW.getTime() - 3_600_000) },
    ]);
    const { queue, enqueued } = fakeQueue();

    const result = await runMailSyncSchedule({ db, queue, workspaceId: WORKSPACE, now: NOW, applyWorkspaceSession: async () => {} });

    // Konto 2 wurde vor einer Minute geholt und ist noch nicht dran.
    expect(enqueued).toEqual([
      { type: 'mail.sync.imap', accountId: 1, hasActor: false },
      { type: 'mail.sync.pop3', accountId: 3, hasActor: false },
    ]);
    expect(claims).toEqual([1, 3]);
    expect(result).toEqual({ enqueued: 2, hasMore: false });
  });

  test('kein actorUserId: der Lauf gehoert keinem Menschen', async () => {
    const { db } = fakeDb([{ id: 7, protocol: 'imap', last_sync_started_at: null }]);
    const { queue, enqueued } = fakeQueue();
    await runMailSyncSchedule({ db, queue, workspaceId: WORKSPACE, now: NOW, applyWorkspaceSession: async () => {} });
    expect(enqueued[0]?.hasActor).toBe(false);
  });

  test('die Stapelgrenze verschiebt, statt zu verwerfen', async () => {
    // Ein Neustart nach laengerer Pause darf nicht zehntausend Sync-Jobs auf
    // einmal einreihen — der Mailserver saehe sonst die ganze Belegschaft
    // gleichzeitig. Was liegen bleibt, kommt im naechsten Takt dran.
    const accounts = Array.from({ length: 5 }, (_unused, index) => ({
      id: index + 1,
      protocol: 'imap',
      last_sync_started_at: null,
    }));
    const { db } = fakeDb(accounts);
    const { queue, enqueued } = fakeQueue();

    const result = await runMailSyncSchedule({
      db, queue, workspaceId: WORKSPACE, now: NOW, batchSize: 2, applyWorkspaceSession: async () => {},
    });

    expect(enqueued.map((entry) => entry.accountId)).toEqual([1, 2]);
    // hasMore statt einer Anzahl: die Abfrage holt nur eine Zeile mehr als den
    // Stapel, eine "Anzahl wartender Konten" waere damit immer 1.
    expect(result).toEqual({ enqueued: 2, hasMore: true });
  });

  test('verliert das bedingte UPDATE, wird nicht eingereiht', async () => {
    // Zwei Serverinstanzen takten gleichzeitig. Der Zuschlag faellt im UPDATE,
    // nicht in der Auswahl — sonst holten beide dasselbe Konto ab.
    const { db } = fakeDb(
      [
        { id: 1, protocol: 'imap', last_sync_started_at: null },
        { id: 2, protocol: 'imap', last_sync_started_at: null },
      ],
      { claimedBySomeoneElse: new Set([1]) },
    );
    const { queue, enqueued } = fakeQueue();

    const result = await runMailSyncSchedule({ db, queue, workspaceId: WORKSPACE, now: NOW, applyWorkspaceSession: async () => {} });

    expect(enqueued.map((entry) => entry.accountId)).toEqual([2]);
    expect(result.enqueued).toBe(1);
  });

  test('ein Konto mit unbekanntem Protokoll wird NICHT gestempelt', async () => {
    // Sonst saehe der Scheduler es als "gerade behandelt" an und verdeckte,
    // dass hier dauerhaft nichts passiert.
    const accounts: Account[] = [{ id: 9, protocol: 'exchange-rpc', last_sync_started_at: null }];
    const { db, claims } = fakeDb(accounts);
    const { queue, enqueued } = fakeQueue();

    const result = await runMailSyncSchedule({ db, queue, workspaceId: WORKSPACE, now: NOW, applyWorkspaceSession: async () => {} });

    expect(enqueued).toEqual([]);
    expect(claims).toEqual([]);
    expect(accounts[0]!.last_sync_started_at).toBeNull();
    expect(result.enqueued).toBe(0);
  });

  test('ein Enqueue-Fehler reiht die restlichen Konten weiter ein und rollt den Claim zurueck', async () => {
    const previousSync = new Date(NOW.getTime() - 3_600_000);
    const accounts: Account[] = [
      { id: 1, protocol: 'imap', last_sync_started_at: previousSync },
      { id: 2, protocol: 'imap', last_sync_started_at: null },
    ];
    const { db } = fakeDb(accounts);
    const { queue, enqueued } = fakeQueue(new Set([1]));

    const result = await runMailSyncSchedule({
      db, queue, workspaceId: WORKSPACE, now: NOW, applyWorkspaceSession: async () => {},
    });

    expect(enqueued.map((entry) => entry.accountId)).toEqual([2]);
    expect(accounts[0]!.last_sync_started_at).toEqual(previousSync);
    expect(accounts[1]!.last_sync_started_at).toEqual(NOW);
    expect(result).toEqual({ enqueued: 1, hasMore: false });
  });

  test('Protokollzuordnung faellt auf IMAP zurueck, lehnt aber Unbekanntes ab', () => {
    expect(mailSyncJobTypeForProtocol('imap')).toBe('mail.sync.imap');
    expect(mailSyncJobTypeForProtocol('POP3')).toBe('mail.sync.pop3');
    expect(mailSyncJobTypeForProtocol(null)).toBe('mail.sync.imap');
    expect(mailSyncJobTypeForProtocol('')).toBe('mail.sync.imap');
    expect(mailSyncJobTypeForProtocol('exchange')).toBeNull();
  });
});
