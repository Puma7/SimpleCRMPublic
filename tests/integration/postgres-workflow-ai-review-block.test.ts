import type { Kysely } from 'kysely';

import { createPostgresAiReviewPort } from '../../packages/server/src/ai-classification';
import type { PostgresSecretPort } from '../../packages/server/src/db/postgres-secret-port';
import type { ServerDatabase } from '../../packages/server/src/db/schema';
import { buildAiReviewJobPlan, buildWorkflowExecutionJobPlan } from '../../packages/server/src/jobs/production-handlers';
import type { JobPayload } from '../../packages/server/src/jobs/types';
import { createPostgresWorkflowExecutionJobPort } from '../../packages/server/src/workflow-execution';
import { startMigratedEmbeddedPostgres, type EmbeddedPostgres } from './helpers/embedded-postgres';

jest.mock('kysely', () => jest.requireActual('../../packages/server/node_modules/kysely'));

jest.setTimeout(120_000);

const WORKSPACE_ID = '10000000-0000-4000-8000-0000000000e9';
const ACCOUNT_ID = 901;
const FOLDER_ID = 911;
const CHAIN_WORKFLOW_ID = 931;
const NEXT_WORKFLOW_ID = 932;
const FAN_OUT_WORKFLOW_ID = 933;

type JobRow = { payload: JobPayload };

const trigger = { id: 'trigger-1', type: 'trigger', data: { kind: 'inbound' } };
const review = {
  id: 'review',
  type: 'registry',
  data: { nodeType: 'ai.review', config: { fallbackUserTemplate: 'Pruefe {{text}}', runOnEveryInbound: true } },
};
function tag(id: string, value: string) {
  return { id, type: 'registry', data: { nodeType: 'email.tag', config: { tag: value, runOnEveryInbound: true } } };
}

// N-wf-01: an inbound ai.review that answers BLOCK ends its branch (there is no
// block edge to resume at). Like F-D1-07, the job then only advanced the chain:
// the workflow was never marked as applied, and a chain-less fan-out
// (backfill/reapply) kept its join barrier open forever.
describe('inbound ai.review BLOCK verdict completes its branch', () => {
  let postgres: EmbeddedPostgres;
  let db: Kysely<ServerDatabase>;

  beforeAll(async () => {
    postgres = await startMigratedEmbeddedPostgres('workflow-ai-review-block');
    const { admin } = postgres;
    await admin.query(`INSERT INTO workspaces (id, name) VALUES ($1, 'AI Review Block Test')`, [WORKSPACE_ID]);
    await admin.query(`
      INSERT INTO email_accounts (id, workspace_id, source_sqlite_id, display_name, email_address, imap_host, imap_username)
      VALUES ($1, $2, $1, 'Support', 'support@example.test', 'imap.example.test', 'support')
    `, [ACCOUNT_ID, WORKSPACE_ID]);
    await admin.query(`
      INSERT INTO email_folders (id, workspace_id, source_sqlite_id, account_source_sqlite_id, account_id, path)
      VALUES ($1, $2, $1, $3, $3, 'INBOX')
    `, [FOLDER_ID, WORKSPACE_ID, ACCOUNT_ID]);
    const secret = await admin.query<{ id: string }>(`
      INSERT INTO secrets (workspace_id, kind, name, ciphertext, nonce, algorithm)
      VALUES ($1, 'email.ai_profile.api_key', 'email_ai_profile:1:api_key', '\\x00', '\\x00', 'test')
      RETURNING id::text AS id
    `, [WORKSPACE_ID]);
    await admin.query(`
      INSERT INTO email_ai_profiles (workspace_id, source_sqlite_id, label, provider, base_url, model, secret_id, is_default)
      VALUES ($1, 1, 'Test', 'openai', 'https://api.openai.test/v1', 'gpt-test', $2, true)
    `, [WORKSPACE_ID, secret.rows[0]!.id]);
    const graphs: Array<[number, unknown]> = [
      [CHAIN_WORKFLOW_ID, {
        version: 1,
        nodes: [trigger, review, tag('tag-ok', 'review-ok')],
        edges: [{ id: 'e1', source: 'trigger-1', target: 'review' }, { id: 'e2', source: 'review', target: 'tag-ok' }],
      }],
      [NEXT_WORKFLOW_ID, { version: 1, nodes: [trigger], edges: [] }],
      [FAN_OUT_WORKFLOW_ID, {
        version: 1,
        nodes: [
          trigger,
          review,
          tag('tag-ok', 'review-ok'),
          { id: 'delay-1', type: 'registry', data: { nodeType: 'logic.delay', config: { delaySeconds: 3600 } } },
          tag('tag-delay', 'after-delay'),
        ],
        edges: [
          { id: 'e1', source: 'trigger-1', target: 'review' },
          { id: 'e2', source: 'review', target: 'tag-ok' },
          { id: 'e3', source: 'trigger-1', target: 'delay-1' },
          { id: 'e4', source: 'delay-1', target: 'tag-delay' },
        ],
      }],
    ];
    for (const [id, graph] of graphs) {
      await admin.query(`
        INSERT INTO email_workflows (
          id, workspace_id, source_sqlite_id, name, trigger_name, enabled, priority,
          definition_json, graph_json, execution_mode, engine_version
        ) VALUES ($1, $2, $1, $3, 'inbound', true, $5, '{}'::jsonb, $4::jsonb, 'graph', 1)
      `, [id, WORKSPACE_ID, `Workflow ${id}`, JSON.stringify(graph), id]);
    }
    db = postgres.createApplicationDb();
  });

  afterAll(async () => {
    if (db) await db.destroy();
    if (postgres) await postgres.stop();
  });

  beforeEach(async () => {
    await postgres.admin.query(`DELETE FROM job_queue`);
  });

  async function seedMessage(id: number): Promise<void> {
    await postgres.admin.query(`
      INSERT INTO email_messages (
        id, workspace_id, source_sqlite_id, account_source_sqlite_id, folder_source_sqlite_id,
        account_id, folder_id, uid, subject, body_text
      ) VALUES ($1, $2, $1, $3, $4, $3, $4, $1, 'Pruefen', 'Bitte pruefen')
    `, [id, WORKSPACE_ID, ACCOUNT_ID, FOLDER_ID]);
  }

  async function jobs(type: string): Promise<JobRow[]> {
    const rows = await postgres.admin.query<JobRow>(
      `SELECT payload FROM job_queue WHERE workspace_id = $1 AND type = $2 ORDER BY id`,
      [WORKSPACE_ID, type],
    );
    return [...rows.rows];
  }

  async function runReviewWithBlock(): Promise<void> {
    const [job] = await jobs('ai.review');
    expect(job).toBeDefined();
    await postgres.admin.query(`DELETE FROM job_queue WHERE workspace_id = $1 AND type = 'ai.review'`, [WORKSPACE_ID]);
    await createPostgresAiReviewPort({
      db,
      secrets: { async readSecret() { return Buffer.from('sk-test'); } } as unknown as PostgresSecretPort,
      async chatCompletion() {
        return 'BLOCK';
      },
    }).review(buildAiReviewJobPlan(job!.payload, WORKSPACE_ID));
  }

  async function appliedWorkflowIds(messageId: number): Promise<number[]> {
    const rows = await postgres.admin.query<{ workflow_id: number }>(
      `SELECT workflow_id FROM email_message_workflow_applied WHERE workspace_id = $1 AND message_id = $2`,
      [WORKSPACE_ID, messageId],
    );
    return rows.rows.map((row) => Number(row.workflow_id));
  }

  async function openJoinBarriers(messageId: number): Promise<string[]> {
    const rows = await postgres.admin.query<{ key: string }>(
      `SELECT key FROM sync_info WHERE workspace_id = $1 AND key LIKE $2`,
      [WORKSPACE_ID, `inbound_deferred_join:${messageId}:%`],
    );
    return rows.rows.map((row) => row.key);
  }

  test('in a priority chain the workflow counts as applied and the chain moves on', async () => {
    await seedMessage(9501);
    await createPostgresWorkflowExecutionJobPort({ db }).execute({
      workspaceId: WORKSPACE_ID,
      workflowId: CHAIN_WORKFLOW_ID,
      messageId: 9501,
      triggerName: 'inbound',
      context: { inboundWorkflowChain: { workflowIds: [CHAIN_WORKFLOW_ID, NEXT_WORKFLOW_ID], index: 0 } },
    });

    await runReviewWithBlock();

    expect(await jobs('workflow.execute')).toMatchObject([{ payload: { workflowId: NEXT_WORKFLOW_ID } }]);
    expect(await appliedWorkflowIds(9501)).toEqual([CHAIN_WORKFLOW_ID]);
  });

  test('without a chain the review releases its slot of the join barrier', async () => {
    await seedMessage(9511);
    await createPostgresWorkflowExecutionJobPort({ db }).execute({
      workspaceId: WORKSPACE_ID,
      workflowId: FAN_OUT_WORKFLOW_ID,
      messageId: 9511,
      triggerName: 'inbound',
      context: {},
    });
    expect(await openJoinBarriers(9511)).toHaveLength(1);

    await runReviewWithBlock();
    const [delayContinuation] = await jobs('workflow.execute');
    expect(delayContinuation).toBeDefined();
    await createPostgresWorkflowExecutionJobPort({ db }).execute(buildWorkflowExecutionJobPlan(delayContinuation!.payload, WORKSPACE_ID, {
      kind: 'workflow_execute_delayed_message',
      delayedJobId: Number(delayContinuation!.payload.delayedJobId),
      messageId: 9511,
    }));

    expect(await openJoinBarriers(9511)).toEqual([]);
    expect(await appliedWorkflowIds(9511)).toEqual([FAN_OUT_WORKFLOW_ID]);
  });
});
