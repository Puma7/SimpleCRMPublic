import type { Kysely } from 'kysely';

import type { ServerDatabase } from '../../packages/server/src/db/schema';
import type { JobPayload } from '../../packages/server/src/jobs/types';
import { createPostgresWorkflowExecutionJobPort } from '../../packages/server/src/workflow-execution';
import { pruneWorkflowRunStepDetails } from '../../packages/server/src/workflow-run-step-append';
import { startMigratedEmbeddedPostgres, type EmbeddedPostgres } from './helpers/embedded-postgres';

jest.mock('kysely', () => jest.requireActual('../../packages/server/node_modules/kysely'));

jest.setTimeout(120_000);

/**
 * Plan 047 (Server): „Testlauf“ speichert den Lauf mit Schritten, gekennzeichnet
 * als Test (dry_run), auch für einen deaktivierten Workflow – ohne jeden
 * Seiteneffekt (kein Tag, kein Archivieren, kein Job). Die Versandvorschau
 * speichert weiterhin nichts.
 */
const WORKSPACE_ID = '10000000-0000-4000-8000-0000000000f1';
const USER_ID = '10000000-0000-4000-8000-0000000000f2';
const ACCOUNT_ID = 821;
const FOLDER_ID = 822;
const WORKFLOW_ID = 823;
const MESSAGE_ID = 8301;

type JobRow = { type: string; payload: JobPayload };

describe('Workflow-Testlauf (Embedded Postgres)', () => {
  let postgres: EmbeddedPostgres;
  let db: Kysely<ServerDatabase>;

  beforeAll(async () => {
    postgres = await startMigratedEmbeddedPostgres('workflow-test-run');
    const { admin } = postgres;
    await admin.query(`INSERT INTO workspaces (id, name) VALUES ($1, 'Test Run')`, [WORKSPACE_ID]);
    await admin.query(`
      INSERT INTO email_accounts (id, workspace_id, source_sqlite_id, display_name, email_address, imap_host, imap_username)
      VALUES ($1, $2, $1, 'Support', 'support@example.test', 'imap.example.test', 'support')
    `, [ACCOUNT_ID, WORKSPACE_ID]);
    await admin.query(`
      INSERT INTO email_folders (id, workspace_id, source_sqlite_id, account_source_sqlite_id, account_id, path)
      VALUES ($1, $2, $1, $3, $3, 'INBOX')
    `, [FOLDER_ID, WORKSPACE_ID, ACCOUNT_ID]);
    await admin.query(`
      INSERT INTO email_messages (
        id, workspace_id, source_sqlite_id, account_source_sqlite_id, folder_source_sqlite_id,
        account_id, folder_id, uid, subject, from_json, body_text
      ) VALUES ($1, $2, $1, $3, $4, $3, $4, $1, 'Sie haben gewonnen', $5::jsonb, 'Klicken Sie hier.')
    `, [MESSAGE_ID, WORKSPACE_ID, ACCOUNT_ID, FOLDER_ID, JSON.stringify({ value: [{ address: 'gewinn@example.com' }] })]);
    const graph = {
      version: 1,
      nodes: [
        { id: 'trigger-1', type: 'trigger', data: { kind: 'inbound' } },
        { id: 'decide', type: 'registry', data: { nodeType: 'ai.decide', config: { question: 'Ist das Spam?', threshold: 80 } } },
        { id: 'tag', type: 'registry', data: { nodeType: 'email.tag', config: { tag: 'spam-pruefen' } } },
        { id: 'archive', type: 'registry', data: { nodeType: 'email.archive', config: {} } },
      ],
      edges: [
        { id: 'edge-1', source: 'trigger-1', target: 'decide' },
        { id: 'edge-2', source: 'decide', target: 'tag', label: 'unsicher' },
        { id: 'edge-3', source: 'tag', target: 'archive' },
      ],
    };
    // Deaktiviert: soll vor dem Einschalten gefahrlos getestet werden können.
    await admin.query(`
      INSERT INTO email_workflows (
        id, workspace_id, source_sqlite_id, name, trigger_name, enabled, priority,
        definition_json, graph_json, execution_mode, engine_version
      ) VALUES ($1, $2, $1, 'Spamfilter', 'inbound', false, 1, '{}'::jsonb, $3::jsonb, 'graph', 1)
    `, [WORKFLOW_ID, WORKSPACE_ID, JSON.stringify(graph)]);
    db = postgres.createApplicationDb();
  });

  afterAll(async () => {
    if (db) await db.destroy();
    if (postgres) await postgres.stop();
  });

  async function takeJobs(type: string): Promise<JobRow[]> {
    const rows = await postgres.admin.query<JobRow>(
      `SELECT type, payload FROM job_queue WHERE workspace_id = $1 AND type = $2 ORDER BY id`,
      [WORKSPACE_ID, type],
    );
    await postgres.admin.query(`DELETE FROM job_queue WHERE workspace_id = $1 AND type = $2`, [WORKSPACE_ID, type]);
    return [...rows.rows];
  }

  test('Testlauf eines deaktivierten Workflows: gespeichert, gekennzeichnet, ohne Seiteneffekte', async () => {
    const port = createPostgresWorkflowExecutionJobPort({ db });
    const result = await port.dryRun!({
      workspaceId: WORKSPACE_ID,
      workflowId: WORKFLOW_ID,
      messageId: MESSAGE_ID,
      triggerName: 'inbound',
      actorUserId: USER_ID,
      context: {},
      testRun: true,
    });
    expect(result).toMatchObject({ success: true, dryRun: true, runId: expect.any(Number) });
    expect(result.runId).toBeLessThan(0);

    const runs = await postgres.admin.query<{ id: string; source_sqlite_id: string; dry_run: boolean; status: string; message_id: string }>(
      `SELECT id, source_sqlite_id, dry_run, status, message_id FROM email_workflow_runs WHERE workspace_id = $1 AND workflow_id = $2`,
      [WORKSPACE_ID, WORKFLOW_ID],
    );
    expect(runs.rows).toHaveLength(1);
    expect(runs.rows[0]).toMatchObject({ dry_run: true, message_id: String(MESSAGE_ID) });
    expect(Number(runs.rows[0]!.source_sqlite_id)).toBe(result.runId);
    const steps = await postgres.admin.query<{ node_type: string; port: string | null }>(
      `SELECT node_type, port FROM email_workflow_run_steps WHERE workspace_id = $1 AND run_id = $2 ORDER BY id`,
      [WORKSPACE_ID, runs.rows[0]!.id],
    );
    expect(steps.rows.map((row) => row.node_type)).toEqual(expect.arrayContaining(['ai.decide', 'email.tag', 'email.archive']));

    const tags = await postgres.admin.query(`SELECT 1 FROM email_message_tags WHERE workspace_id = $1 AND message_id = $2`, [WORKSPACE_ID, MESSAGE_ID]);
    expect(tags.rows).toHaveLength(0);
    const message = await postgres.admin.query<{ archived: boolean }>(`SELECT archived FROM email_messages WHERE id = $1`, [MESSAGE_ID]);
    expect(message.rows[0]!.archived).toBe(false);
    expect(await takeJobs('ai.decide')).toEqual([]);
    expect(await takeJobs('workflow.execute')).toEqual([]);
  });

  test('Aufbewahrung: Testläufe werden nach 30 Tagen samt Schritten gelöscht, echte Läufe bleiben', async () => {
    await postgres.admin.query(`DELETE FROM email_workflow_runs WHERE workspace_id = $1`, [WORKSPACE_ID]);
    const port = createPostgresWorkflowExecutionJobPort({ db });
    const result = await port.dryRun!({
      workspaceId: WORKSPACE_ID,
      workflowId: WORKFLOW_ID,
      messageId: MESSAGE_ID,
      triggerName: 'inbound',
      actorUserId: USER_ID,
      context: {},
      testRun: true,
    });
    expect(result.runId).toBeLessThan(0);
    await postgres.admin.query(`
      INSERT INTO email_workflow_runs (workspace_id, workflow_source_sqlite_id, workflow_id, message_id, direction, status, started_at, finished_at)
      VALUES ($1, $2, $2, $3, 'inbound', 'ok', '2026-01-01T00:00:00Z', '2026-01-01T00:00:01Z')
    `, [WORKSPACE_ID, WORKFLOW_ID, MESSAGE_ID]);
    await postgres.admin.query(
      `UPDATE email_workflow_runs SET started_at = '2026-01-01T00:00:00Z' WHERE workspace_id = $1 AND dry_run`,
      [WORKSPACE_ID],
    );
    await pruneWorkflowRunStepDetails({ db, now: () => new Date('2026-09-27T12:00:00Z') }, WORKSPACE_ID);
    const runs = await postgres.admin.query<{ dry_run: boolean }>(
      `SELECT dry_run FROM email_workflow_runs WHERE workspace_id = $1`,
      [WORKSPACE_ID],
    );
    expect(runs.rows).toEqual([{ dry_run: false }]);
    const steps = await postgres.admin.query(
      `SELECT 1 FROM email_workflow_run_steps WHERE workspace_id = $1 AND run_source_sqlite_id = $2`,
      [WORKSPACE_ID, result.runId],
    );
    expect(steps.rows).toHaveLength(0);
  });

  test('Versandvorschau ohne testRun speichert keinen Lauf', async () => {
    await postgres.admin.query(`DELETE FROM email_workflow_runs WHERE workspace_id = $1`, [WORKSPACE_ID]);
    await postgres.admin.query(`UPDATE email_workflows SET enabled = true WHERE id = $1`, [WORKFLOW_ID]);
    try {
      const port = createPostgresWorkflowExecutionJobPort({ db });
      const result = await port.dryRun!({
        workspaceId: WORKSPACE_ID,
        workflowId: WORKFLOW_ID,
        messageId: MESSAGE_ID,
        triggerName: 'inbound',
        actorUserId: USER_ID,
        context: { previewOutbound: true },
      });
      expect(result.success).toBe(true);
      expect(result.runId).toBeUndefined();
      const runs = await postgres.admin.query(`SELECT 1 FROM email_workflow_runs WHERE workspace_id = $1`, [WORKSPACE_ID]);
      expect(runs.rows).toHaveLength(0);
    } finally {
      await postgres.admin.query(`UPDATE email_workflows SET enabled = false WHERE id = $1`, [WORKFLOW_ID]);
    }
  });
});
