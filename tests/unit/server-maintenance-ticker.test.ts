import {
  DEFAULT_AUDIT_RETENTION_INTERVAL_MS,
  DEFAULT_LOCK_CLEANUP_INTERVAL_MS,
  graphileJobKeyForJob,
  graphileSpecFromJob,
  isTrustedServiceJobPayload,
  startMaintenanceJobTicker,
} from '../../packages/server/src/jobs';
import type { EnqueueJobInput } from '../../packages/server/src/jobs/types';

const WORKSPACE_A = '11111111-1111-4111-8111-111111111111';
const WORKSPACE_B = '22222222-2222-4222-8222-222222222222';

/**
 * Minimale Kysely-Attrappe fuer `selectFrom('workspaces').select('id')...`.
 * Reicht genau so weit, wie listWorkspaceIds die Kette benutzt.
 */
function makeWorkspaceDb(ids: string[], onSelect?: () => void) {
  const builder = {
    selectFrom() { return this; },
    select() { return this; },
    orderBy() { return this; },
    async execute() {
      onSelect?.();
      return ids.map((id) => ({ id }));
    },
  };
  return {
    transaction() {
      return {
        async execute(callback: (trx: unknown) => Promise<unknown>) {
          return callback(builder);
        },
      };
    },
  };
}

/** Die RLS-Session wird in diesen Tests nicht gesetzt — kein echtes Postgres. */
const noopSession = async () => undefined;

describe('maintenance job ticker', () => {
  const realSetTimeout = globalThis.setTimeout;
  let pending: Array<{ fn: () => void; delayMs: number }>;

  beforeEach(() => {
    pending = [];
    // setTimeout ersetzen statt Fake-Timer: der Ticker plant sich selbst nach,
    // wir wollen jeden Lauf einzeln ausloesen koennen.
    (globalThis as { setTimeout: unknown }).setTimeout = ((fn: () => void, delayMs: number) => {
      pending.push({ fn, delayMs });
      return { unref() { /* no-op */ } };
    }) as unknown as typeof globalThis.setTimeout;
  });

  afterEach(() => {
    (globalThis as { setTimeout: unknown }).setTimeout = realSetTimeout;
  });

  async function runNextTick(): Promise<void> {
    const next = pending.shift();
    expect(next).toBeDefined();
    next!.fn();
    // Der Timer-Callback startet den asynchronen Lauf ohne await — auf die
    // Microtask-Queue warten, bis er durch ist.
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
  }

  test('reiht beide Wartungsjobs je Workspace als Trusted-Service ein', async () => {
    const enqueued: EnqueueJobInput[] = [];
    const ticker = startMaintenanceJobTicker({
      db: makeWorkspaceDb([WORKSPACE_A, WORKSPACE_B]) as never,
      queue: { async enqueue(input) { enqueued.push(input); return undefined; } },
      jobType: 'lock.cleanup',
      applyWorkspaceSession: noopSession,
    });

    expect(pending[0]?.delayMs).toBe(60_000);
    await runNextTick();

    expect(enqueued.map((job) => [job.type, job.workspaceId])).toEqual([
      ['lock.cleanup', WORKSPACE_A],
      ['lock.cleanup', WORKSPACE_B],
    ]);
    // actorMode 'service' in der Job-Policy: ohne den Trusted-Service-Marker
    // wuerde enforceMailJobPolicy den Job ablehnen.
    for (const job of enqueued) {
      expect(isTrustedServiceJobPayload(job.payload)).toBe(true);
      expect(job.payload.workspaceId).toBe(job.workspaceId);
    }
    // Selbst nachgeplant, mit dem regulaeren Intervall.
    expect(pending[0]?.delayMs).toBe(DEFAULT_LOCK_CLEANUP_INTERVAL_MS);
    ticker.stop();
  });

  test('audit.retention laeuft seltener und beide Typen haben einen workspace-skopierten Job-Key', async () => {
    const ticker = startMaintenanceJobTicker({
      db: makeWorkspaceDb([WORKSPACE_A]) as never,
      queue: { async enqueue() { return undefined; } },
      jobType: 'audit.retention',
      applyWorkspaceSession: noopSession,
    });
    await runNextTick();
    expect(pending[0]?.delayMs).toBe(DEFAULT_AUDIT_RETENTION_INTERVAL_MS);
    ticker.stop();

    // Der Ticker laeuft in JEDER Server-Instanz. Ohne Job-Key stapelten sich
    // dort Duplikate; mit Key kollabieren gleichzeitige Enqueues ueber
    // jobKeyMode 'replace' auf genau einen wartenden Job je Workspace.
    for (const type of ['lock.cleanup', 'audit.retention'] as const) {
      expect(graphileJobKeyForJob(type, { workspaceId: WORKSPACE_A }))
        .toBe(`${type}:${WORKSPACE_A}`);
      expect(graphileSpecFromJob({
        type,
        workspaceId: WORKSPACE_A,
        payload: { workspaceId: WORKSPACE_A },
      }).jobKeyMode).toBe('replace');
    }
  });

  test('ein fehlgeschlagener Workspace stoppt weder die uebrigen noch den Ticker', async () => {
    const seen: string[] = [];
    const warnings: string[] = [];
    const ticker = startMaintenanceJobTicker({
      db: makeWorkspaceDb([WORKSPACE_A, WORKSPACE_B]) as never,
      queue: {
        async enqueue(input) {
          seen.push(input.workspaceId);
          if (input.workspaceId === WORKSPACE_A) throw new Error('queue kaputt');
          return undefined;
        },
      },
      jobType: 'lock.cleanup',
      log: (message) => warnings.push(message),
      applyWorkspaceSession: noopSession,
    });

    await runNextTick();

    expect(seen).toEqual([WORKSPACE_A, WORKSPACE_B]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('queue kaputt');
    expect(warnings[0]).toContain(WORKSPACE_A);
    // Trotz Fehler weiter getaktet.
    expect(pending[0]?.delayMs).toBe(DEFAULT_LOCK_CLEANUP_INTERVAL_MS);
    ticker.stop();
  });

  test('stop() verhindert jeden weiteren Lauf', async () => {
    let selects = 0;
    const ticker = startMaintenanceJobTicker({
      db: makeWorkspaceDb([WORKSPACE_A], () => { selects += 1; }) as never,
      queue: { async enqueue() { return undefined; } },
      jobType: 'lock.cleanup',
      applyWorkspaceSession: noopSession,
    });

    ticker.stop();
    await runNextTick();

    expect(selects).toBe(0);
    expect(pending).toHaveLength(0);
  });

  test('eine unlesbare Workspace-Liste beendet den Ticker nicht', async () => {
    const warnings: string[] = [];
    const ticker = startMaintenanceJobTicker({
      db: {
        transaction() {
          return {
            async execute() { throw new Error('db weg'); },
          };
        },
      } as never,
      queue: { async enqueue() { return undefined; } },
      jobType: 'lock.cleanup',
      log: (message) => warnings.push(message),
      applyWorkspaceSession: noopSession,
    });

    await runNextTick();

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('db weg');
    expect(pending[0]?.delayMs).toBe(DEFAULT_LOCK_CLEANUP_INTERVAL_MS);
    ticker.stop();
  });
});
