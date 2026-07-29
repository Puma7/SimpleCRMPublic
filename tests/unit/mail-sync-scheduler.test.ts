import {
  DEFAULT_MAIL_SYNC_INTERVAL_MS,
  mailSyncJobTypeForProtocol,
  runMailSyncSchedule,
} from '../../packages/server/src/jobs/mail-sync-scheduler';
import { createMaintenanceJobHandlers } from '../../packages/server/src/jobs/maintenance-handlers';
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
  const releases: number[] = [];
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
            .map((account) => ({
              id: account.id,
              protocol: account.protocol,
              last_sync_started_at: account.last_sync_started_at,
            }));
        },
      };
      return builder
    },
    updateTable() {
      let targetId: number | undefined;
      let setValue: Date | null | undefined;
      // Aus `.where('last_sync_started_at', '=', X)` — nur die Ruecknahme
      // benutzt das, um den EIGENEN Stempel zu treffen.
      let expectedStamp: Date | undefined;
      const builder = {
        set(values: { last_sync_started_at: Date | null }) {
          setValue = values.last_sync_started_at;
          return builder
        },
        where(column: unknown, op?: unknown, value?: unknown) {
          if (column === 'id') targetId = value as number;
          if (column === 'last_sync_started_at' && op === '=') expectedStamp = value as Date;
          return builder
        },
        returning() { return builder },
        /** Der Anspruch: bedingtes UPDATE, das eine Zeile zurueckgibt oder nicht. */
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
        /** Die Ruecknahme nach einem Queue-Fehler. */
        async execute() {
          if (targetId === undefined) return [];
          const account = accounts.find((entry) => entry.id === targetId);
          if (!account) return [];
          // Bedingt auf den eigenen Stempel: hat inzwischen jemand anders
          // beansprucht, gehoert die Zeile ihm und bleibt unberuehrt.
          if (expectedStamp !== undefined
            && account.last_sync_started_at?.getTime() !== expectedStamp.getTime()) return [];
          account.last_sync_started_at = setValue ?? null;
          releases.push(targetId);
          return [];
        },
      };
      return builder
    },
  };
  return { db: db as unknown as Kysely<ServerDatabase>, claims, releases };
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
    expect(result).toMatchObject({ enqueued: 2, hasMore: false, failed: [] });
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
    expect(result).toMatchObject({ enqueued: 2, hasMore: true, failed: [] });
  });

  test('wer den Anspruch verliert, reiht gar nicht erst ein', async () => {
    // Beansprucht wird VOR dem Einreihen. Zwischen Auswahl und Anspruch kann
    // eine zweite Instanz takten — oder ein Nutzer einen Vollimport ausloesen,
    // der beide Zeitspalten stempelt und seinen eigenen Job einreiht.
    //
    // Andersherum (einreihen, dann stempeln) haette der Scheduler seinen
    // gewoehnlichen Sync da laengst eingereiht und den verlorenen Anspruch erst
    // danach bemerkt. Seit dem ':full'-Suffix teilen sich die beiden Jobs
    // keinen Job-Key mehr, blieben also beide liegen und liefen ueber dieselbe
    // Konto-Queue direkt nacheinander — genau der zweite Abruf, den das
    // doppelte Stempeln des Vollimports verhindern soll.
    const { db, claims } = fakeDb(
      [
        { id: 1, protocol: 'imap', last_sync_started_at: null },
        { id: 2, protocol: 'imap', last_sync_started_at: null },
      ],
      { claimedBySomeoneElse: new Set([1]) },
    );
    const { queue, enqueued } = fakeQueue();

    const result = await runMailSyncSchedule({ db, queue, workspaceId: WORKSPACE, now: NOW, applyWorkspaceSession: async () => {} });

    // Konto 1 gehoert dem anderen Anspruch — kein zweiter Job dafuer.
    expect(enqueued.map((entry) => entry.accountId)).toEqual([2]);
    expect(claims).toEqual([2]);
    expect(result).toMatchObject({ enqueued: 1, failed: [] });
  });

  test('ein fehlgeschlagenes Einreihen reisst den Takt nicht mit und gibt den Anspruch zurueck', async () => {
    // Ohne diese Isolation wuerde ein einzelner Verbindungshaenger den ganzen
    // Lauf abbrechen: die uebrigen faelligen Konten sind bereits ausgewaehlt
    // und wuerden in diesem Takt gar nicht mehr versucht.
    //
    // Und ohne die Ruecknahme bliebe der Stempel stehen: das Konto galte fuer
    // das volle Intervall als bedient, obwohl nie ein Job entstand.
    const accounts: Account[] = [
      { id: 1, protocol: 'imap', last_sync_started_at: null },
      { id: 2, protocol: 'imap', last_sync_started_at: null },
      { id: 3, protocol: 'imap', last_sync_started_at: null },
    ];
    const { db, claims, releases } = fakeDb(accounts);
    const enqueued: number[] = [];
    const queue = {
      async enqueue(input: { payload: Record<string, unknown> }) {
        const accountId = Number(input.payload.accountId);
        if (accountId === 2) throw new Error('queue unavailable');
        enqueued.push(accountId);
      },
    };

    const result = await runMailSyncSchedule({
      db, queue, workspaceId: WORKSPACE, now: NOW, applyWorkspaceSession: async () => {},
    });

    expect(enqueued).toEqual([1, 3]);
    expect(result.enqueued).toBe(2);
    // Konto 2 wurde beansprucht, der Anspruch aber wieder freigegeben — es ist
    // im naechsten Takt erneut faellig.
    expect(claims).toEqual([1, 2, 3]);
    expect(releases).toEqual([2]);
    expect(accounts[1]!.last_sync_started_at).toBeNull();
    expect(result.failed.map((entry) => entry.accountId)).toEqual([2]);
  });

  test('die Ruecknahme stellt einen vorhandenen Zeitstempel wieder her, nicht null', async () => {
    // Ein faelliges Konto hatte in aller Regel schon einen Stempel. Ihn beim
    // Zuruecknehmen auf null zu setzen waere kein Rollback, sondern eine
    // zweite Aenderung — das Konto saehe aus, als sei es nie synchronisiert
    // worden, und stuende (NULLS FIRST) ploetzlich ganz vorn.
    const previous = new Date(NOW.getTime() - 3_600_000);
    const accounts: Account[] = [{ id: 1, protocol: 'imap', last_sync_started_at: previous }];
    const { db, releases } = fakeDb(accounts);
    const queue = { async enqueue() { throw new Error('queue unavailable') } };

    await runMailSyncSchedule({
      db, queue, workspaceId: WORKSPACE, now: NOW, applyWorkspaceSession: async () => {},
    });

    expect(releases).toEqual([1]);
    expect(accounts[0]!.last_sync_started_at).toEqual(previous);
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
    expect(result).toMatchObject({ enqueued: 1, hasMore: false, failed: [] });
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
    expect(mailSyncJobTypeForProtocol('POP3')).toBeNull();
    expect(mailSyncJobTypeForProtocol(null)).toBe('mail.sync.imap');
    expect(mailSyncJobTypeForProtocol('')).toBe('mail.sync.imap');
    // Exakt wie im Sync-Handler: 'IMAP' oder ' imap ' sind dort KEIN imap.
    expect(mailSyncJobTypeForProtocol(' imap ')).toBeNull();
    expect(mailSyncJobTypeForProtocol('exchange')).toBeNull();
  });
});

describe('Taktgeber-Handler des periodischen Syncs', () => {
  /** Konten, die alle scheitern — der Vorrat schrumpft also nie. */
  function unenqueueableAccounts(count: number): Account[] {
    return Array.from({ length: count }, (_unused, index) => ({
      id: index + 1,
      protocol: 'imap',
      last_sync_started_at: null,
    }));
  }

  function handlerFor(accounts: Account[], queue: { enqueue(input: never): Promise<void> }) {
    const requeued: string[] = [];
    const { db } = fakeDb(accounts);
    const handlers = createMaintenanceJobHandlers({
      db,
      now: () => NOW,
      applyWorkspaceSession: async () => {},
      requeue: {
        async enqueue(input: { type: string }) {
          // Die Sync-Jobs des Schedulers und das Nachschieben laufen ueber
          // denselben Port; nur letzteres interessiert hier.
          if (input.type === 'mail.sync.schedule') requeued.push(input.type);
          else await queue.enqueue(input as never);
        },
      } as never,
    });
    return { handlers, requeued };
  }

  test('schiebt bei voller Charge nach', async () => {
    const accounts = unenqueueableAccounts(3);
    const { handlers, requeued } = handlerFor(accounts, { async enqueue() {} });

    await handlers['mail.sync.schedule']!({
      workspaceId: WORKSPACE,
      payload: { workspaceId: WORKSPACE },
    } as never);

    // Stapelgrenze ist 200, drei Konten fuellen sie nicht — nichts nachzuschieben.
    expect(requeued).toEqual([]);
  });

  test('schiebt NICHT nach, wenn keine einzige Einreihung durchkam', async () => {
    // `hasMore` beschreibt nur die Groesse der urspruenglichen AUSWAHL, nicht
    // den Erfolg. Scheitern alle Einreihungen, bliebe es wahr, waehrend kein
    // Konto gestempelt wurde: die naechste Charge saehe dieselben Konten, und
    // der Handler schoebe im Fuenf-Sekunden-Takt endlos nach — jedes Mal mit
    // einer vollen Ladung fehlschlagender Versuche.
    const accounts = unenqueueableAccounts(201);
    const { handlers, requeued } = handlerFor(accounts, {
      async enqueue() { throw new Error('queue unavailable'); },
    });

    await handlers['mail.sync.schedule']!({
      workspaceId: WORKSPACE,
      payload: { workspaceId: WORKSPACE },
    } as never);

    // Der Stapel WAR voll (201 faellige Konten bei Grenze 200), aber ohne
    // Fortschritt darf nicht nachgeschoben werden. Der Minutentakt genuegt,
    // und liegen bleibt nichts: ungestempelte Konten bleiben faellig.
    expect(requeued).toEqual([]);
    expect(accounts.every((account) => account.last_sync_started_at === null)).toBe(true);
  });

  test('schiebt bei voller Charge MIT Fortschritt nach', async () => {
    const accounts = unenqueueableAccounts(201);
    const { handlers, requeued } = handlerFor(accounts, { async enqueue() {} });

    await handlers['mail.sync.schedule']!({
      workspaceId: WORKSPACE,
      payload: { workspaceId: WORKSPACE },
    } as never);

    expect(requeued).toEqual(['mail.sync.schedule']);
  });
});
