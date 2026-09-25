import type { Kysely } from 'kysely';

import { createPostgresWorkflowDelayedJobReadPort } from '../../packages/server/src/db/postgres-workflow-runtime-read-ports';
import type { ServerDatabase } from '../../packages/server/src/db/schema';
import { createPostgresWorkflowExecutionJobPort } from '../../packages/server/src/workflow-execution';
import { startMigratedEmbeddedPostgres, type EmbeddedPostgres } from './helpers/embedded-postgres';

jest.mock('kysely', () => jest.requireActual('../../packages/server/node_modules/kysely'));

jest.setTimeout(120_000);

const WORKSPACE_ID = '10000000-0000-4000-8000-0000000000c3';
const OWNER_ID = '20000000-0000-4000-8000-0000000000c3';
const ACCOUNT_ID = 301;
const FOLDER_ID = 311;
const MESSAGE_ID = 321;
const DELAY_WORKFLOW_ID = 331;
const NEXT_WORKFLOW_ID = 332;

type QueuedJob = { payload: { workflowId?: number; delayedJobId?: number; context?: { inboundWorkflowChain?: { index: number } } } };

// F-D1-02: cancelling or deleting a waiting logic.delay job in the diagnostics
// view dropped the queued continuation, which is the only thing that releases
// the deferred join and advances the inbound priority chain. Every
// lower-priority inbound workflow then silently never ran for that message.
describe('manual cancel of a delayed inbound workflow keeps the priority chain moving', () => {
  let postgres: EmbeddedPostgres;
  let db: Kysely<ServerDatabase>;

  beforeAll(async () => {
    postgres = await startMigratedEmbeddedPostgres('workflow-delay-cancel');
    const { admin } = postgres;
    await admin.query(`INSERT INTO workspaces (id, name) VALUES ($1, 'Delay Cancel Test')`, [WORKSPACE_ID]);
    await admin.query(`
      INSERT INTO users (id, workspace_id, email, display_name, password_hash, role)
      VALUES ($1, $2, 'owner@example.test', 'Owner', 'hash', 'owner')
    `, [OWNER_ID, WORKSPACE_ID]);
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
        account_id, folder_id, uid, subject
      ) VALUES ($1, $2, $1, $3, $4, $3, $4, 1, 'Delay chain')
    `, [MESSAGE_ID, WORKSPACE_ID, ACCOUNT_ID, FOLDER_ID]);
    const delayGraph = {
      version: 1,
      nodes: [
        { id: 'trigger-1', type: 'trigger', data: { kind: 'inbound' } },
        { id: 'delay-1', type: 'registry', data: { nodeType: 'logic.delay', config: { delaySeconds: 3600 } } },
        { id: 'tag-1', type: 'registry', data: { nodeType: 'email.tag', config: { tag: 'after-delay' } } },
      ],
      edges: [
        { id: 'edge-1', source: 'trigger-1', target: 'delay-1' },
        { id: 'edge-2', source: 'delay-1', target: 'tag-1' },
      ],
    };
    const nextGraph = {
      version: 1,
      nodes: [
        { id: 'trigger-1', type: 'trigger', data: { kind: 'inbound' } },
        { id: 'tag-1', type: 'registry', data: { nodeType: 'email.tag', config: { tag: 'next-priority' } } },
      ],
      edges: [{ id: 'edge-1', source: 'trigger-1', target: 'tag-1' }],
    };
    for (const [id, priority, graph] of [[DELAY_WORKFLOW_ID, 1, delayGraph], [NEXT_WORKFLOW_ID, 2, nextGraph]] as const) {
      await admin.query(`
        INSERT INTO email_workflows (
          id, workspace_id, source_sqlite_id, name, trigger_name, enabled, priority,
          definition_json, graph_json, execution_mode, engine_version
        ) VALUES ($1, $2, $1, $3, 'inbound', true, $4, '{}'::jsonb, $5::jsonb, 'graph', 1)
      `, [id, WORKSPACE_ID, `Workflow ${id}`, priority, JSON.stringify(graph)]);
    }
    db = postgres.createApplicationDb();
  });

  afterAll(async () => {
    if (db) await db.destroy();
    if (postgres) await postgres.stop();
  });

  beforeEach(async () => {
    await postgres.admin.query(`DELETE FROM job_queue`);
    await postgres.admin.query(`DELETE FROM workflow_delayed_jobs`);
    await postgres.admin.query(`DELETE FROM email_workflow_runs`);
    await postgres.admin.query(`DELETE FROM sync_info WHERE workspace_id = $1`, [WORKSPACE_ID]);
  });

  async function startDelayedChain(): Promise<number> {
    await createPostgresWorkflowExecutionJobPort({ db }).execute({
      workspaceId: WORKSPACE_ID,
      workflowId: DELAY_WORKFLOW_ID,
      messageId: MESSAGE_ID,
      triggerName: 'inbound',
      context: { inboundWorkflowChain: { workflowIds: [DELAY_WORKFLOW_ID, NEXT_WORKFLOW_ID], index: 0 } },
    });
    const delayed = await postgres.admin.query<{ id: string; status: string }>(
      `SELECT id::text AS id, status FROM workflow_delayed_jobs WHERE workspace_id = $1`,
      [WORKSPACE_ID],
    );
    expect(delayed.rows).toEqual([{ id: expect.any(String), status: 'pending' }]);
    return Number(delayed.rows[0]!.id);
  }

  async function queuedJobs(): Promise<QueuedJob[]> {
    const rows = await postgres.admin.query<QueuedJob>(
      `SELECT payload FROM job_queue WHERE workspace_id = $1 AND type = 'workflow.execute' ORDER BY id`,
      [WORKSPACE_ID],
    );
    return [...rows.rows];
  }

  test('cancel advances the chain to the next priority workflow', async () => {
    const delayedJobId = await startDelayedChain();
    expect((await queuedJobs()).map((job) => job.payload.delayedJobId)).toEqual([delayedJobId]);

    const port = createPostgresWorkflowDelayedJobReadPort({ db });
    await expect(port.update!({
      workspaceId: WORKSPACE_ID,
      actorUserId: OWNER_ID,
      id: delayedJobId,
      values: { status: 'cancelled' },
      mailScope: { kind: 'all' },
    })).resolves.toMatchObject({ ok: true });

    const jobs = await queuedJobs();
    expect(jobs.map((job) => [job.payload.workflowId, job.payload.context?.inboundWorkflowChain?.index])).toEqual([
      [NEXT_WORKFLOW_ID, 1],
    ]);
  });

  test('delete advances the chain to the next priority workflow', async () => {
    const delayedJobId = await startDelayedChain();

    const port = createPostgresWorkflowDelayedJobReadPort({ db });
    await expect(port.delete!({
      workspaceId: WORKSPACE_ID,
      actorUserId: OWNER_ID,
      id: delayedJobId,
      mailScope: { kind: 'all' },
    })).resolves.toMatchObject({ id: delayedJobId });

    const jobs = await queuedJobs();
    expect(jobs.map((job) => [job.payload.workflowId, job.payload.context?.inboundWorkflowChain?.index])).toEqual([
      [NEXT_WORKFLOW_ID, 1],
    ]);
  });

  test('a continuation that still runs after the cancel does not advance the chain a second time', async () => {
    const delayedJobId = await startDelayedChain();
    const continuation = (await queuedJobs())[0]!;
    // Simulate the worker having locked the continuation before the cancel.
    await postgres.admin.query(`UPDATE job_queue SET locked_at = now() WHERE workspace_id = $1`, [WORKSPACE_ID]);

    await createPostgresWorkflowDelayedJobReadPort({ db }).update!({
      workspaceId: WORKSPACE_ID,
      actorUserId: OWNER_ID,
      id: delayedJobId,
      values: { status: 'cancelled' },
      mailScope: { kind: 'all' },
    });
    await createPostgresWorkflowExecutionJobPort({ db }).execute({
      workspaceId: WORKSPACE_ID,
      workflowId: DELAY_WORKFLOW_ID,
      messageId: MESSAGE_ID,
      delayedJobId,
      triggerName: 'inbound',
      context: continuation.payload.context as Record<string, unknown>,
    });

    const nextHops = (await queuedJobs()).filter((job) => job.payload.workflowId === NEXT_WORKFLOW_ID);
    expect(nextHops).toHaveLength(1);
    const tags = await postgres.admin.query(`SELECT tag FROM email_message_tags WHERE workspace_id = $1`, [WORKSPACE_ID]);
    expect(tags.rows).toEqual([]);
  });
});
