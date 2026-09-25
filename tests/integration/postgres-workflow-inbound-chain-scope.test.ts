import type { Kysely } from 'kysely';

import type { ServerDatabase } from '../../packages/server/src/db/schema';
import { createPostgresWorkflowExecutionJobPort } from '../../packages/server/src/workflow-execution';
import { startMigratedEmbeddedPostgres, type EmbeddedPostgres } from './helpers/embedded-postgres';

jest.mock('kysely', () => jest.requireActual('../../packages/server/node_modules/kysely'));

jest.setTimeout(120_000);

const WORKSPACE_ID = '10000000-0000-4000-8000-0000000000e6';
const ACCOUNT_A = 601;
const ACCOUNT_B = 602;
const FOLDER_A = 611;
const MESSAGE_ID = 621;
const HOP_WORKFLOW_ID = 631;
const NEXT_WORKFLOW_ID = 632;

type QueuedJob = { payload: { workflowId?: number; context?: { inboundWorkflowChain?: { index: number } } } };

// F-D1-06: a later hop of the serial inbound chain only re-checked `enabled`.
// A workflow moved to another mailbox (or switched away from the inbound
// trigger) after the chain was built still ran as inbound on the old mail.
describe('serial inbound chain re-checks the workflow scope at each hop', () => {
  let postgres: EmbeddedPostgres;
  let db: Kysely<ServerDatabase>;

  beforeAll(async () => {
    postgres = await startMigratedEmbeddedPostgres('workflow-chain-scope');
    const { admin } = postgres;
    await admin.query(`INSERT INTO workspaces (id, name) VALUES ($1, 'Chain Scope Test')`, [WORKSPACE_ID]);
    for (const accountId of [ACCOUNT_A, ACCOUNT_B]) {
      await admin.query(`
        INSERT INTO email_accounts (id, workspace_id, source_sqlite_id, display_name, email_address, imap_host, imap_username)
        VALUES ($1, $2, $1, $3, $4, 'imap.example.test', $3)
      `, [accountId, WORKSPACE_ID, `account-${accountId}`, `support-${accountId}@example.test`]);
    }
    await admin.query(`
      INSERT INTO email_folders (id, workspace_id, source_sqlite_id, account_source_sqlite_id, account_id, path)
      VALUES ($1, $2, $1, $3, $3, 'INBOX')
    `, [FOLDER_A, WORKSPACE_ID, ACCOUNT_A]);
    await admin.query(`
      INSERT INTO email_messages (
        id, workspace_id, source_sqlite_id, account_source_sqlite_id, folder_source_sqlite_id,
        account_id, folder_id, uid, subject
      ) VALUES ($1, $2, $1, $3, $4, $3, $4, 1, 'Mail an Postfach A')
    `, [MESSAGE_ID, WORKSPACE_ID, ACCOUNT_A, FOLDER_A]);
    for (const [id, priority, tag] of [[HOP_WORKFLOW_ID, 1, 'hop-ran'], [NEXT_WORKFLOW_ID, 2, 'next-ran']] as const) {
      const graph = {
        version: 1,
        nodes: [
          { id: 'trigger-1', type: 'trigger', data: { kind: 'inbound' } },
          { id: 'tag-1', type: 'registry', data: { nodeType: 'email.tag', config: { tag, runOnEveryInbound: true } } },
        ],
        edges: [{ id: 'edge-1', source: 'trigger-1', target: 'tag-1' }],
      };
      await admin.query(`
        INSERT INTO email_workflows (
          id, workspace_id, source_sqlite_id, name, trigger_name, enabled, priority, account_id,
          definition_json, graph_json, execution_mode, engine_version
        ) VALUES ($1, $2, $1, $3, 'inbound', true, $4, $5, '{}'::jsonb, $6::jsonb, 'graph', 1)
      `, [id, WORKSPACE_ID, `Workflow ${id}`, priority, ACCOUNT_A, JSON.stringify(graph)]);
    }
    db = postgres.createApplicationDb();
  });

  afterAll(async () => {
    if (db) await db.destroy();
    if (postgres) await postgres.stop();
  });

  beforeEach(async () => {
    const { admin } = postgres;
    await admin.query(`DELETE FROM job_queue`);
    await admin.query(`DELETE FROM email_message_tags WHERE workspace_id = $1`, [WORKSPACE_ID]);
    await admin.query(`DELETE FROM email_message_workflow_applied WHERE workspace_id = $1`, [WORKSPACE_ID]);
    await admin.query(`DELETE FROM sync_info WHERE workspace_id = $1`, [WORKSPACE_ID]);
    await admin.query(`
      UPDATE email_workflows SET trigger_name = 'inbound', account_id = $2 WHERE workspace_id = $1
    `, [WORKSPACE_ID, ACCOUNT_A]);
  });

  async function runHop(): Promise<void> {
    // Genau der Job, den die Kette beim Enqueue der Mail angelegt hat.
    await createPostgresWorkflowExecutionJobPort({ db }).execute({
      workspaceId: WORKSPACE_ID,
      workflowId: HOP_WORKFLOW_ID,
      messageId: MESSAGE_ID,
      triggerName: 'inbound',
      context: {
        skipIfMessageSpamOrReview: true,
        inboundWorkflowChain: { workflowIds: [HOP_WORKFLOW_ID, NEXT_WORKFLOW_ID], index: 0 },
      },
    });
  }

  async function tags(): Promise<string[]> {
    const rows = await postgres.admin.query<{ tag: string }>(
      `SELECT tag FROM email_message_tags WHERE workspace_id = $1 ORDER BY tag`,
      [WORKSPACE_ID],
    );
    return rows.rows.map((row) => row.tag);
  }

  async function lastHopRunLog(): Promise<unknown> {
    const rows = await postgres.admin.query<{ log_json: unknown }>(
      `SELECT log_json FROM email_workflow_runs WHERE workspace_id = $1 AND workflow_id = $2 ORDER BY id DESC LIMIT 1`,
      [WORKSPACE_ID, HOP_WORKFLOW_ID],
    );
    return rows.rows[0]?.log_json;
  }

  async function queuedHops(): Promise<Array<[number | undefined, number | undefined]>> {
    const rows = await postgres.admin.query<QueuedJob>(
      `SELECT payload FROM job_queue WHERE workspace_id = $1 AND type = 'workflow.execute' ORDER BY id`,
      [WORKSPACE_ID],
    );
    return rows.rows.map((job) => [job.payload.workflowId, job.payload.context?.inboundWorkflowChain?.index]);
  }

  test('an unchanged hop runs and advances the chain', async () => {
    await runHop();

    expect(await tags()).toEqual(['hop-ran']);
    expect(await queuedHops()).toEqual([[NEXT_WORKFLOW_ID, 1]]);
  });

  test('a hop whose workflow moved to another mailbox is skipped and the chain moves on', async () => {
    await postgres.admin.query(`UPDATE email_workflows SET account_id = $2 WHERE id = $1`, [HOP_WORKFLOW_ID, ACCOUNT_B]);

    await runHop();

    expect(await tags()).toEqual([]);
    expect(await lastHopRunLog()).toEqual(['skip:workflow_scope_changed']);
    expect(await queuedHops()).toEqual([[NEXT_WORKFLOW_ID, 1]]);
  });

  test('a hop whose workflow no longer has the inbound trigger is skipped and the chain moves on', async () => {
    await postgres.admin.query(`UPDATE email_workflows SET trigger_name = 'manual' WHERE id = $1`, [HOP_WORKFLOW_ID]);

    await runHop();

    expect(await tags()).toEqual([]);
    expect(await lastHopRunLog()).toEqual(['skip:workflow_scope_changed']);
    expect(await queuedHops()).toEqual([[NEXT_WORKFLOW_ID, 1]]);
  });
});
