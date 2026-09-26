import type { Kysely } from 'kysely';

import type { ServerDatabase } from '../../packages/server/src/db/schema';
import { withWorkspaceTransaction } from '../../packages/server/src/db/workspace-context';
import { createPostgresWorkflowReadPort } from '../../packages/server/src/db/postgres-workflow-read-ports';
import { isTrustedServiceJobPayload } from '../../packages/server/src/jobs/policy';
import type { EnqueueJobInput } from '../../packages/server/src/jobs/types';
import {
  SERVER_SCHEDULE_SYNC_LOG,
  buildScheduleWorkflowContext,
  resetWorkflowScheduleTickLogForTests,
  runWorkflowScheduleTick,
} from '../../packages/server/src/jobs/workflow-schedule-tick';
import { createPostgresWorkflowExecutionJobPort } from '../../packages/server/src/workflow-execution';
import { startMigratedEmbeddedPostgres, type EmbeddedPostgres } from './helpers/embedded-postgres';

jest.mock('kysely', () => jest.requireActual('../../packages/server/node_modules/kysely'));

jest.setTimeout(120_000);

const WORKSPACE_A = '10000000-0000-4000-8000-0000000000e4';
const WORKSPACE_B = '10000000-0000-4000-8000-0000000000e5';
const USER_A = '20000000-0000-4000-8000-0000000000e4';
const ACCOUNT_A = 9401;

// Montag, 28.09.2026, 06:05 in Berlin (Sommerzeit, UTC+2).
const NOW = new Date('2026-09-28T04:05:00.000Z');
const SLOT = '2026-09-28T04:00:00.000Z';

const SCHEDULE_GRAPH = {
  version: 1,
  nodes: [
    { id: 't1', type: 'trigger', data: { kind: 'schedule' } },
    { id: 'sync1', type: 'registry', data: { nodeType: 'sync.run', config: {} } },
  ],
  edges: [{ id: 'e0', source: 't1', target: 'sync1' }],
};

type Enqueued = EnqueueJobInput & { payload: Record<string, any> };

describe('server schedule tick (TA-P4)', () => {
  let postgres: EmbeddedPostgres;
  let db: Kysely<ServerDatabase>;

  beforeAll(async () => {
    postgres = await startMigratedEmbeddedPostgres('workflow-schedule-tick');
    await postgres.admin.query(
      `INSERT INTO workspaces (id, name) VALUES ($1, 'Schedule A'), ($2, 'Schedule B')`,
      [WORKSPACE_A, WORKSPACE_B],
    );
    await postgres.admin.query(
      `INSERT INTO users (id, workspace_id, email, display_name, password_hash, role)
       VALUES ($1, $2, 'owner@example.test', 'Owner', 'x', 'owner')`,
      [USER_A, WORKSPACE_A],
    );
    await postgres.admin.query(`
      INSERT INTO email_accounts (id, workspace_id, source_sqlite_id, display_name, email_address, imap_host, imap_username)
      VALUES ($1, $2, $1, 'Support', 'support@example.test', 'imap.example.test', 'support')
    `, [ACCOUNT_A, WORKSPACE_A]);
    db = postgres.createApplicationDb();
  });

  afterAll(async () => {
    if (db) await db.destroy();
    if (postgres) await postgres.stop();
  });

  beforeEach(async () => {
    resetWorkflowScheduleTickLogForTests();
    await postgres.admin.query('DELETE FROM job_queue');
    await postgres.admin.query('DELETE FROM email_workflow_run_steps');
    await postgres.admin.query('DELETE FROM email_workflow_runs');
    await postgres.admin.query('DELETE FROM email_workflows');
    await postgres.admin.query('DELETE FROM sync_info');
    await insertWorkflow(9101, WORKSPACE_A, { trigger: 'schedule', enabled: true, cron: '0 6 * * *', accountId: ACCOUNT_A });
    await insertWorkflow(9102, WORKSPACE_A, { trigger: 'schedule', enabled: false, cron: '0 6 * * *' });
    // Bestand vom Desktop: zu dichter Takt — wird uebersprungen, nicht ausgeloest.
    await insertWorkflow(9103, WORKSPACE_A, { trigger: 'schedule', enabled: true, cron: '*/5 * * * *' });
    // Ein Cron-Ausdruck an einem anderen Ausloeser ist wirkungslos.
    await insertWorkflow(9104, WORKSPACE_A, { trigger: 'inbound', enabled: true, cron: '0 6 * * *' });
    await insertWorkflow(9201, WORKSPACE_B, { trigger: 'schedule', enabled: true, cron: '0 6 * * *' });
  });

  async function insertWorkflow(
    id: number,
    workspaceId: string,
    input: { trigger: string; enabled: boolean; cron: string | null; accountId?: number; graph?: unknown },
  ): Promise<void> {
    await postgres.admin.query(`
      INSERT INTO email_workflows (
        id, workspace_id, source_sqlite_id, name, trigger_name, enabled, priority,
        definition_json, graph_json, cron_expr, schedule_account_id, schedule_account_source_sqlite_id,
        execution_mode, engine_version
      ) VALUES ($1, $2, $1, $3, $4, $5, 100, '{}'::jsonb, $6::jsonb, $7, $8, $8, 'graph', 1)
    `, [
      id,
      workspaceId,
      `Workflow ${id}`,
      input.trigger,
      input.enabled,
      JSON.stringify(input.graph ?? SCHEDULE_GRAPH),
      input.cron,
      input.accountId ?? null,
    ]);
  }

  async function lastSlot(id: number): Promise<string | null> {
    const result = await postgres.admin.query<{ slot: Date | null }>(
      'SELECT schedule_last_slot_at AS slot FROM email_workflows WHERE id = $1',
      [id],
    );
    const slot = result.rows[0]?.slot ?? null;
    return slot ? new Date(slot).toISOString() : null;
  }

  function collectingQueue(delayMs = 0) {
    const enqueued: Enqueued[] = [];
    return {
      enqueued,
      queue: {
        async enqueue(input: EnqueueJobInput) {
          if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
          enqueued.push(input as Enqueued);
        },
      },
    };
  }

  test('enqueues exactly one run per due slot and ignores disabled, invalid and non-schedule workflows', async () => {
    const { enqueued, queue } = collectingQueue();
    const logs: string[] = [];

    const first = await runWorkflowScheduleTick({ db, queue, workspaceId: WORKSPACE_A, now: NOW, log: (m) => logs.push(m) });

    expect(first).toEqual({ enqueued: 1, skippedInvalid: 1, failed: [] });
    expect(enqueued).toHaveLength(1);
    const job = enqueued[0]!;
    expect(job).toMatchObject({ type: 'workflow.execute', workspaceId: WORKSPACE_A, maxAttempts: 3 });
    expect(job.payload).toMatchObject({
      workspaceId: WORKSPACE_A,
      workflowId: 9101,
      triggerName: 'schedule',
      scheduleSlot: SLOT,
    });
    expect(job.payload).not.toHaveProperty('actorUserId');
    expect(isTrustedServiceJobPayload(job.payload)).toBe(true);
    expect(job.payload.context.eventVariables).toEqual({
      'schedule.fired_at': NOW.toISOString(),
      'schedule.slot': SLOT,
      'schedule.sync_log': SERVER_SCHEDULE_SYNC_LOG,
      'email.account_id': ACCOUNT_A,
    });
    expect(await lastSlot(9101)).toBe(SLOT);
    expect(await lastSlot(9102)).toBeNull();
    expect(await lastSlot(9104)).toBeNull();
    expect(await lastSlot(9201)).toBeNull();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatch(/Workflow 9103 .*uebersprungen/);

    // Derselbe Zeitpunkt ist erledigt; der ungueltige Ausdruck wird nicht erneut gemeldet.
    const again = await runWorkflowScheduleTick({ db, queue, workspaceId: WORKSPACE_A, now: new Date(NOW.getTime() + 60_000), log: (m) => logs.push(m) });
    expect(again.enqueued).toBe(0);
    expect(enqueued).toHaveLength(1);
    expect(logs).toHaveLength(1);

    // Am naechsten Tag ist der naechste Zeitpunkt dran.
    const nextDay = await runWorkflowScheduleTick({ db, queue, workspaceId: WORKSPACE_A, now: new Date('2026-09-29T04:00:30.000Z'), log: (m) => logs.push(m) });
    expect(nextDay.enqueued).toBe(1);
    expect(enqueued[1]!.payload.scheduleSlot).toBe('2026-09-29T04:00:00.000Z');
  });

  test('two concurrent ticks enqueue a slot only once', async () => {
    const { enqueued, queue } = collectingQueue(150);
    const results = await Promise.all([
      runWorkflowScheduleTick({ db, queue, workspaceId: WORKSPACE_A, now: NOW, log: () => undefined }),
      runWorkflowScheduleTick({ db, queue, workspaceId: WORKSPACE_A, now: NOW, log: () => undefined }),
      runWorkflowScheduleTick({ db, queue, workspaceId: WORKSPACE_A, now: new Date(NOW.getTime() + 30_000), log: () => undefined }),
    ]);
    expect(results.map((result) => result.enqueued).reduce((a, b) => a + b, 0)).toBe(1);
    expect(enqueued.map((job) => job.payload.workflowId)).toEqual([9101]);
  });

  test('does not catch up slots older than 15 minutes', async () => {
    const { enqueued, queue } = collectingQueue();
    await runWorkflowScheduleTick({ db, queue, workspaceId: WORKSPACE_A, now: new Date('2026-09-28T04:15:01.000Z'), log: () => undefined });
    expect(enqueued).toEqual([]);
    expect(await lastSlot(9101)).toBeNull();

    // Genau 15 Minuten alt zaehlt noch.
    await runWorkflowScheduleTick({ db, queue, workspaceId: WORKSPACE_A, now: new Date('2026-09-28T04:15:00.000Z'), log: () => undefined });
    expect(enqueued).toHaveLength(1);

    // Server war einen Tag aus: der gestrige Zeitpunkt verfaellt, auch wenn er nie lief.
    await postgres.admin.query(
      `UPDATE email_workflows SET schedule_last_slot_at = '2026-09-27T04:00:00Z' WHERE id = 9101`,
    );
    await runWorkflowScheduleTick({ db, queue, workspaceId: WORKSPACE_A, now: new Date('2026-09-28T09:00:00.000Z'), log: () => undefined });
    expect(enqueued).toHaveLength(1);
  });

  test('a failed enqueue releases the claim so the next tick retries', async () => {
    let fail = true;
    const enqueued: Enqueued[] = [];
    const queue = {
      async enqueue(input: EnqueueJobInput) {
        if (fail) {
          fail = false;
          throw new Error('queue unavailable');
        }
        enqueued.push(input as Enqueued);
      },
    };
    const failed = await runWorkflowScheduleTick({ db, queue, workspaceId: WORKSPACE_A, now: NOW, log: () => undefined });
    expect(failed.enqueued).toBe(0);
    expect(failed.failed.map((entry) => entry.workflowId)).toEqual([9101]);
    expect(await lastSlot(9101)).toBeNull();

    const retried = await runWorkflowScheduleTick({ db, queue, workspaceId: WORKSPACE_A, now: new Date(NOW.getTime() + 60_000), log: () => undefined });
    expect(retried.enqueued).toBe(1);
    expect(enqueued[0]!.payload.scheduleSlot).toBe(SLOT);
  });

  test('uses the workspace time zone', async () => {
    await postgres.admin.query(
      `INSERT INTO sync_info (workspace_id, key, value) VALUES ($1, 'workflow_schedule_timezone', 'America/New_York')`,
      [WORKSPACE_A],
    );
    const { enqueued, queue } = collectingQueue();
    // 06:00 Berlin ist in New York Mitternacht — nichts faellig.
    await runWorkflowScheduleTick({ db, queue, workspaceId: WORKSPACE_A, now: NOW, log: () => undefined });
    expect(enqueued).toEqual([]);
    // 06:00 New York (Sommerzeit, UTC-4) = 10:00 UTC.
    await runWorkflowScheduleTick({ db, queue, workspaceId: WORKSPACE_A, now: new Date('2026-09-28T10:02:00.000Z'), log: () => undefined });
    expect(enqueued.map((job) => job.payload.scheduleSlot)).toEqual(['2026-09-28T10:00:00.000Z']);

    // Ein ungueltiger gespeicherter Wert faellt auf Europe/Berlin zurueck.
    await postgres.admin.query(
      `UPDATE sync_info SET value = 'Mars/Olympus' WHERE workspace_id = $1 AND key = 'workflow_schedule_timezone'`,
      [WORKSPACE_A],
    );
    const logs: string[] = [];
    await runWorkflowScheduleTick({ db, queue, workspaceId: WORKSPACE_A, now: new Date('2026-09-29T04:01:00.000Z'), log: (m) => logs.push(m) });
    expect(enqueued.map((job) => job.payload.scheduleSlot)).toEqual(['2026-09-28T10:00:00.000Z', '2026-09-29T04:00:00.000Z']);
    expect(logs.some((line) => line.includes('Mars/Olympus'))).toBe(true);
  });

  test('keeps workspaces apart (query scope and RLS)', async () => {
    const { enqueued, queue } = collectingQueue();
    await runWorkflowScheduleTick({ db, queue, workspaceId: WORKSPACE_B, now: NOW, log: () => undefined });
    expect(enqueued.map((job) => [job.workspaceId, job.payload.workflowId])).toEqual([[WORKSPACE_B, 9201]]);
    expect(await lastSlot(9201)).toBe(SLOT);
    expect(await lastSlot(9101)).toBeNull();

    // Unter der Session von Workspace A ist die Zeile von B per RLS unsichtbar —
    // auch ein direkter Anspruch per ID trifft sie nicht.
    const foreign = await withWorkspaceTransaction(
      db,
      { workspaceId: WORKSPACE_A, role: 'system' },
      async (trx) => trx
        .updateTable('email_workflows')
        .set({ schedule_last_slot_at: new Date('2030-01-01T00:00:00.000Z') })
        .where('id', '=', 9201)
        .returning('id')
        .executeTakeFirst(),
    );
    expect(foreign).toBeUndefined();
    expect(await lastSlot(9201)).toBe(SLOT);
  });

  test('saving or activating a schedule marks past slots as done; editing the graph does not', async () => {
    const port = createPostgresWorkflowReadPort({ db });
    const created = await port.create!({
      workspaceId: WORKSPACE_A,
      actorUserId: USER_A,
      values: {
        name: 'Viertelstuendlich',
        triggerName: 'schedule',
        enabled: true,
        definition: { version: 1, rules: [] },
        graph: SCHEDULE_GRAPH,
        cronExpr: '*/15 * * * *',
      },
    });
    expect(created.ok).toBe(true);
    const id = created.ok ? created.workflow.id : 0;
    const savedAt = await lastSlot(id);
    expect(savedAt).not.toBeNull();

    // Der letzte Viertelstunden-Zeitpunkt liegt vor dem Anlegen: nichts ausloesen.
    const { enqueued, queue } = collectingQueue();
    await runWorkflowScheduleTick({ db, queue, workspaceId: WORKSPACE_A, now: new Date(savedAt!), log: () => undefined });
    expect(enqueued.filter((job) => job.payload.workflowId === id)).toEqual([]);

    // Deaktivieren, Zustand verlieren (wie nach einem Import), wieder aktivieren.
    await port.update!({ workspaceId: WORKSPACE_A, actorUserId: USER_A, id, values: { enabled: false } });
    await postgres.admin.query('UPDATE email_workflows SET schedule_last_slot_at = NULL WHERE id = $1', [id]);
    const beforeActivation = Date.now();
    await port.update!({ workspaceId: WORKSPACE_A, actorUserId: USER_A, id, values: { enabled: true } });
    const activatedAt = await lastSlot(id);
    expect(new Date(activatedAt!).getTime()).toBeGreaterThanOrEqual(beforeActivation - 1000);
    await runWorkflowScheduleTick({ db, queue, workspaceId: WORKSPACE_A, now: new Date(activatedAt!), log: () => undefined });
    expect(enqueued.filter((job) => job.payload.workflowId === id)).toEqual([]);

    // Graph speichern (enabled unveraendert mitgesendet) laesst den Zustand stehen.
    await postgres.admin.query(
      `UPDATE email_workflows SET schedule_last_slot_at = '2026-01-01T00:00:00Z' WHERE id = $1`,
      [id],
    );
    await port.update!({
      workspaceId: WORKSPACE_A,
      actorUserId: USER_A,
      id,
      values: { enabled: true, graph: SCHEDULE_GRAPH, cronExpr: '*/15 * * * *' },
    });
    expect(await lastSlot(id)).toBe('2026-01-01T00:00:00.000Z');

    // Ein neuer Ausdruck gilt ab jetzt.
    await port.update!({ workspaceId: WORKSPACE_A, actorUserId: USER_A, id, values: { cronExpr: '0 * * * *' } });
    expect(new Date((await lastSlot(id))!).getTime()).toBeGreaterThan(Date.parse('2026-01-01T00:00:00Z'));
  });

  test('a scheduled run starts at the schedule trigger node and passes the planned account', async () => {
    await insertWorkflow(9105, WORKSPACE_A, {
      trigger: 'schedule',
      enabled: true,
      cron: '0 6 * * *',
      accountId: ACCOUNT_A,
      graph: {
        version: 1,
        nodes: [
          { id: 'tm', type: 'trigger', data: { kind: 'manual' } },
          { id: 'wrong', type: 'registry', data: { nodeType: 'logic.set_variable', config: { name: 'x', value: 'manual' } } },
          { id: 'ts', type: 'trigger', data: { kind: 'schedule' } },
          { id: 'sync1', type: 'registry', data: { nodeType: 'sync.run', config: {} } },
        ],
        edges: [
          { id: 'e1', source: 'tm', target: 'wrong' },
          { id: 'e2', source: 'ts', target: 'sync1' },
        ],
      },
    });

    await createPostgresWorkflowExecutionJobPort({ db }).execute({
      workspaceId: WORKSPACE_A,
      workflowId: 9105,
      triggerName: 'schedule',
      trustedService: true,
      context: buildScheduleWorkflowContext({ firedAt: NOW, slot: new Date(SLOT), scheduleAccountId: ACCOUNT_A }),
    });

    const runs = await postgres.admin.query<{ id: number; direction: string; status: string; message_id: number | null }>(
      'SELECT id, direction, status, message_id FROM email_workflow_runs WHERE workflow_id = 9105',
    );
    expect(runs.rows).toHaveLength(1);
    expect(runs.rows[0]).toMatchObject({ direction: 'schedule', status: 'ok', message_id: null });
    const steps = await postgres.admin.query<{ node_id: string }>(
      'SELECT node_id FROM email_workflow_run_steps WHERE run_id = $1 ORDER BY id',
      [runs.rows[0]!.id],
    );
    expect(steps.rows.map((row) => row.node_id)).toEqual(['sync1']);
    // sync.run hat das geplante Konto aus email.account_id bekommen.
    const jobs = await postgres.admin.query<{ type: string; payload: Record<string, unknown> }>(
      'SELECT type, payload FROM job_queue WHERE workspace_id = $1',
      [WORKSPACE_A],
    );
    expect(jobs.rows).toHaveLength(1);
    expect(jobs.rows[0]!.type).toBe('mail.sync.imap');
    expect(jobs.rows[0]!.payload).toMatchObject({ workspaceId: WORKSPACE_A, accountId: ACCOUNT_A });
    expect(isTrustedServiceJobPayload(jobs.rows[0]!.payload)).toBe(true);
  });

  test('a scheduled run skips a workflow that is no longer a schedule', async () => {
    await createPostgresWorkflowExecutionJobPort({ db }).execute({
      workspaceId: WORKSPACE_A,
      workflowId: 9104,
      triggerName: 'schedule',
      trustedService: true,
      context: buildScheduleWorkflowContext({ firedAt: NOW, slot: new Date(SLOT), scheduleAccountId: null }),
    });
    const runs = await postgres.admin.query<{ status: string; log_json: unknown }>(
      'SELECT status, log_json FROM email_workflow_runs WHERE workflow_id = 9104',
    );
    expect(runs.rows).toHaveLength(1);
    expect(runs.rows[0]!.status).toBe('ok');
    expect(JSON.stringify(runs.rows[0]!.log_json)).toContain('skip:workflow_scope_changed');
    const jobs = await postgres.admin.query('SELECT 1 FROM job_queue WHERE workspace_id = $1', [WORKSPACE_A]);
    expect(jobs.rows).toHaveLength(0);
  });
});
