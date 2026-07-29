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
      const state: { threshold?: Date; limit?: number } = {};
      const builder = {
        select() { return builder },
        where(arg: unknown) {
          if (typeof arg === 'function') {
            // Kysely reicht einen AUFRUFBAREN Ausdrucksbauer herein, der
            // zusaetzlich .or und .ref traegt. Der Mock muss das koennen, sonst
            // scheitert schon der Aufbau der Bedingung.
            const eb = Object.assign(
              (..._parts: unknown[]) => ({}),
              { or: (parts: unknown[]) => parts, ref: (name: string) => name },
            );
            (arg as (builder: unknown) => unknown)(eb);
          }
          return builder
        },
        orderBy() { return builder },
        limit(value: number) { state.limit = value; return builder },
        async execute() {
          // Nie gesyncte Konten zuerst. Dass die Abfrage das wirklich
          // verlangt (Postgres sortiert bei ASC von sich aus NULLS LAST),
          // prueft der Test „verlangt NULLS FIRST" am kompilierten SQL — ein
          // Mock kann rohes SQL nicht auswerten und wuerde hier sonst nur die
          // eigene Erwartung bestaetigen.
          const nullsRank = -Infinity;
          const due = accounts
            .filter((account) => account.last_sync_started_at === null
              || account.last_sync_started_at.getTime() < NOW.getTime() - DEFAULT_MAIL_SYNC_INTERVAL_MS)
            .filter((account) => {
              const normalized = String(account.protocol ?? 'imap').trim().toLowerCase() || 'imap';
              return account.protocol === null || normalized === 'imap' || normalized === 'pop3';
            })
            .sort((left, right) => {
              const a = left.last_sync_started_at?.getTime() ?? nullsRank;
              const b = right.last_sync_started_at?.getTime() ?? nullsRank;
              if (a !== b) return a < b ? -1 : 1;
              return left.id - right.id;
            });
          return due.slice(0, state.limit ?? due.length)
            .map((account) => ({ id: account.id, protocol: account.protocol }));
        },
      };
      return builder
    },
    updateTable() {
      let targetId: number | undefined;
      const builder = {
        set() { return builder },
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
      };
      return builder
    },
  };
  return { db: db as unknown as Kysely<ServerDatabase>, claims };
}

function fakeQueue() {
  const enqueued: Array<{ type: string; accountId: unknown; hasActor: boolean }> = [];
  return {
    enqueued,
    queue: {
      async enqueue(input: { type: string; payload: Record<string, unknown> }) {
        enqueued.push({
          type: input.type,
          accountId: input.payload.accountId,
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

  test('ein nicht synchronisierbares Konto belegt keinen Platz im Stapel', async () => {
    // Es wird schon in der Abfrage ausgeschlossen. Wuerde es nur in der
    // Schleife uebersprungen, bliebe es ungestempelt und damit dauerhaft
    // faellig — und weil die aeltesten zuerst drankommen, stuende es fuer immer
    // vorn. Ab Stapelgroesse vieler solcher Konten kaeme kein IMAP-Konto mehr
    // dran.
    const accounts: Account[] = [
      { id: 1, protocol: 'exchange-rpc', last_sync_started_at: null },
      { id: 2, protocol: 'exchange-rpc', last_sync_started_at: null },
      { id: 3, protocol: 'imap', last_sync_started_at: null },
    ];
    const { db } = fakeDb(accounts);
    const { queue, enqueued } = fakeQueue();

    const result = await runMailSyncSchedule({
      db, queue, workspaceId: WORKSPACE, now: NOW, batchSize: 2, applyWorkspaceSession: async () => {},
    });

    expect(enqueued.map((entry) => entry.accountId)).toEqual([3]);
    expect(result).toEqual({ enqueued: 1, hasMore: false });
    expect(accounts[0]!.last_sync_started_at).toBeNull();
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

  test('Protokollzuordnung faellt auf IMAP zurueck, lehnt aber Unbekanntes ab', () => {
    expect(mailSyncJobTypeForProtocol('imap')).toBe('mail.sync.imap');
    expect(mailSyncJobTypeForProtocol('POP3')).toBe('mail.sync.pop3');
    expect(mailSyncJobTypeForProtocol(null)).toBe('mail.sync.imap');
    expect(mailSyncJobTypeForProtocol('')).toBe('mail.sync.imap');
    expect(mailSyncJobTypeForProtocol('exchange')).toBeNull();
  });
});
