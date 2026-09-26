import type { Kysely } from 'kysely';

import type { ServerDatabase } from '../../packages/server/src/db/schema';
import { createPostgresWorkflowExecutionJobPort } from '../../packages/server/src/workflow-execution';
import { createPostgresWorkflowForwardCopyPort } from '../../packages/server/src/workflow-forward-copy';
import type { ServerSmtpSendInput } from '../../packages/server/src/mail-smtp-send';
import { startMigratedEmbeddedPostgres, type EmbeddedPostgres } from './helpers/embedded-postgres';

jest.mock('kysely', () => jest.requireActual('../../packages/server/node_modules/kysely'));

jest.setTimeout(120_000);

const WORKSPACE_ID = '10000000-0000-4000-8000-0000000000f3';
const ACCOUNT_ID = 901;
const FOLDER_ID = 911;
const WORKFLOW_ID = 931;

type QueuedJob = { type: string; payload: Record<string, any> };
type StepRow = { node_id: string; status: string; message: string | null };

// F-A9-03: Die Kopie einer Weiterleitung traegt "Auto-Submitted: auto-forwarded",
// eingangsseitig pruefte das aber niemand. Landete die Kopie wieder in einem
// synchronisierten Postfach (oder leitete das Ziel zurueck), passte sie erneut
// auf die Bedingung und wurde endlos weitergeleitet (Mail-Ping-Pong).
describe('email.forward_copy does not forward auto-forwarded copies again', () => {
  let postgres: EmbeddedPostgres;
  let db: Kysely<ServerDatabase>;
  let nextMessageId = 921;

  beforeAll(async () => {
    postgres = await startMigratedEmbeddedPostgres('workflow-forward-copy-loop');
    const { admin } = postgres;
    await admin.query(`INSERT INTO workspaces (id, name) VALUES ($1, 'Forward Loop Test')`, [WORKSPACE_ID]);
    await admin.query(`
      INSERT INTO email_accounts (
        id, workspace_id, source_sqlite_id, display_name, email_address, imap_host, imap_username, smtp_host
      ) VALUES ($1, $2, $1, 'Eingang', 'eingang@example.test', 'imap.example.test', 'eingang', 'smtp.example.test')
    `, [ACCOUNT_ID, WORKSPACE_ID]);
    await admin.query(`
      INSERT INTO email_folders (id, workspace_id, source_sqlite_id, account_source_sqlite_id, account_id, path)
      VALUES ($1, $2, $1, $3, $3, 'INBOX')
    `, [FOLDER_ID, WORKSPACE_ID, ACCOUNT_ID]);
    const graph = {
      version: 1,
      nodes: [
        { id: 'trigger-1', type: 'trigger', data: { kind: 'inbound' } },
        { id: 'cond-1', type: 'condition', data: { field: 'subject', op: 'contains', value: 'Rechnung' } },
        {
          id: 'forward-1',
          type: 'registry',
          data: { nodeType: 'email.forward_copy', config: { to: 'buchhaltung@example.test' } },
        },
      ],
      edges: [
        { id: 'edge-1', source: 'trigger-1', target: 'cond-1' },
        { id: 'edge-2', source: 'cond-1', target: 'forward-1', label: 'yes' },
      ],
    };
    await admin.query(`
      INSERT INTO email_workflows (
        id, workspace_id, source_sqlite_id, name, trigger_name, enabled, priority,
        definition_json, graph_json, execution_mode, engine_version
      ) VALUES ($1, $2, $1, 'Rechnungen weiterleiten', 'inbound', true, 1, '{}'::jsonb, $3::jsonb, 'graph', 1)
    `, [WORKFLOW_ID, WORKSPACE_ID, JSON.stringify(graph)]);
    db = postgres.createApplicationDb();
  });

  afterAll(async () => {
    if (db) await db.destroy();
    if (postgres) await postgres.stop();
  });

  beforeEach(async () => {
    await postgres.admin.query(`DELETE FROM job_queue WHERE workspace_id = $1`, [WORKSPACE_ID]);
  });

  async function insertMessage(subject: string, rawHeaders: string): Promise<number> {
    const id = nextMessageId++;
    await postgres.admin.query(`
      INSERT INTO email_messages (
        id, workspace_id, source_sqlite_id, account_source_sqlite_id, folder_source_sqlite_id,
        account_id, folder_id, uid, subject, body_text, raw_headers, from_json
      ) VALUES ($1, $2, $1, $3, $4, $3, $4, $1, $5, 'Rechnung im Anhang', $6, $7::jsonb)
    `, [
      id, WORKSPACE_ID, ACCOUNT_ID, FOLDER_ID, subject, rawHeaders,
      JSON.stringify({ value: [{ address: 'rechnung@lieferant.example' }] }),
    ]);
    return id;
  }

  async function runInbound(messageId: number): Promise<void> {
    await createPostgresWorkflowExecutionJobPort({ db }).execute({
      workspaceId: WORKSPACE_ID,
      workflowId: WORKFLOW_ID,
      messageId,
      triggerName: 'inbound',
      context: {},
    });
  }

  async function forwardJobs(): Promise<QueuedJob[]> {
    const result = await postgres.admin.query<QueuedJob>(
      `SELECT type, payload FROM job_queue WHERE workspace_id = $1 AND type = 'workflow.forward_copy' ORDER BY id`,
      [WORKSPACE_ID],
    );
    return [...result.rows];
  }

  async function forwardStep(messageId: number): Promise<StepRow | undefined> {
    const result = await postgres.admin.query<StepRow>(`
      SELECT s.node_id, s.status, s.message
      FROM email_workflow_run_steps s
      JOIN email_workflow_runs r ON r.id = s.run_id
      WHERE r.workspace_id = $1 AND r.message_id = $2 AND s.node_id = 'forward-1'
    `, [WORKSPACE_ID, messageId]);
    return result.rows[0];
  }

  test('an auto-forwarded copy is not queued for another forward', async () => {
    const messageId = await insertMessage(
      'Fwd: Rechnung 4711',
      'Auto-Submitted: auto-forwarded\r\nSubject: Fwd: Rechnung 4711\r\n',
    );

    await runInbound(messageId);

    expect(await forwardJobs()).toEqual([]);
    expect(await forwardStep(messageId)).toEqual({
      node_id: 'forward-1',
      status: 'skipped',
      message: 'skip:auto_forwarded_source',
    });
  });

  test.each([
    ['auto-generated invoice mail', 'Auto-Submitted: auto-generated\r\n'],
    ['bulk invoice mail', 'Precedence: bulk\r\n'],
  ])('an %s is still forwarded', async (_label, rawHeaders) => {
    const messageId = await insertMessage('Rechnung 4712', rawHeaders);

    await runInbound(messageId);

    const jobs = await forwardJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.payload).toMatchObject({ messageId, to: 'buchhaltung@example.test' });
  });

  test('a forward job queued before the check does not send an auto-forwarded copy', async () => {
    const messageId = await insertMessage('Fwd: Rechnung 4713', 'Auto-Submitted: auto-forwarded\r\n');
    const smtpSends: ServerSmtpSendInput[] = [];
    const port = createPostgresWorkflowForwardCopyPort({
      db,
      smtpSend: async (input) => {
        smtpSends.push(input);
      },
    });

    await expect(port.forwardCopy({
      workspaceId: WORKSPACE_ID,
      workflowId: WORKFLOW_ID,
      messageId,
      to: 'buchhaltung@example.test',
    })).resolves.toBeUndefined();

    expect(smtpSends).toEqual([]);
  });
});
