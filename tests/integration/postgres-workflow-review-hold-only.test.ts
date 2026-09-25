import type { Kysely } from 'kysely';

import type { PostgresSecretPort } from '../../packages/server/src/db/postgres-secret-port';
import type { ServerDatabase } from '../../packages/server/src/db/schema';
import {
  buildAiReviewDraftJobPlan,
  buildWorkflowExecutionJobPlan,
} from '../../packages/server/src/jobs/production-handlers';
import type { JobPayload } from '../../packages/server/src/jobs/types';
import { createPostgresAiReviewDraftPort } from '../../packages/server/src/workflow-ai-draft-nodes';
import { createPostgresWorkflowExecutionJobPort } from '../../packages/server/src/workflow-execution';
import { startMigratedEmbeddedPostgres, type EmbeddedPostgres } from './helpers/embedded-postgres';

jest.mock('kysely', () => jest.requireActual('../../packages/server/node_modules/kysely'));
// Die Gegenlese-KI liefert immer SEND; alles andere läuft gegen die echte DB.
jest.mock('../../packages/server/src/workflow-ai-chat', () => ({
  ...jest.requireActual('../../packages/server/src/workflow-ai-chat'),
  runWorkflowTrackedChatCompletion: jest.fn(async () => 'STATUS: SEND\nANSWERED: yes\nREASON: passt'),
}));

jest.setTimeout(120_000);

const WORKSPACE_ID = '10000000-0000-4000-8000-0000000000f7';
const ACCOUNT_ID = 701;
const FOLDER_ID = 711;
const WORKFLOW_ID = 731;
const NEXT_WORKFLOW_ID = 732;
const FAN_OUT_WORKFLOW_ID = 733;

type JobRow = { payload: JobPayload };

// F-D1-07: with only a HOLD edge on ai.review_draft, a SEND verdict ended the
// branch without the terminal completion: the workflow was never marked as
// applied, and a chain-less run (backfill/reapply) kept its join barrier open.
describe('ai.review_draft SEND verdict on a graph with only a HOLD edge', () => {
  let postgres: EmbeddedPostgres;
  let db: Kysely<ServerDatabase>;

  beforeAll(async () => {
    postgres = await startMigratedEmbeddedPostgres('workflow-review-hold-only');
    const { admin } = postgres;
    await admin.query(`INSERT INTO workspaces (id, name) VALUES ($1, 'Review Hold Only Test')`, [WORKSPACE_ID]);
    await admin.query(`
      INSERT INTO email_accounts (id, workspace_id, source_sqlite_id, display_name, email_address, imap_host, imap_username)
      VALUES ($1, $2, $1, 'Support', 'support@example.test', 'imap.example.test', 'support')
    `, [ACCOUNT_ID, WORKSPACE_ID]);
    await admin.query(`
      INSERT INTO email_folders (id, workspace_id, source_sqlite_id, account_source_sqlite_id, account_id, path)
      VALUES ($1, $2, $1, $3, $3, 'INBOX')
    `, [FOLDER_ID, WORKSPACE_ID, ACCOUNT_ID]);
    // „Nur prüfen, nie automatisch senden“: nur der hold-Ausgang ist verdrahtet.
    const graph = {
      version: 1,
      nodes: [
        { id: 'trigger-1', type: 'trigger', data: { kind: 'inbound' } },
        { id: 'review', type: 'registry', data: { nodeType: 'ai.review_draft', config: { draftIdVariable: 'draft.id', runOnEveryInbound: true } } },
        { id: 'tag-hold', type: 'registry', data: { nodeType: 'email.tag', config: { tag: 'ki-freigabe', runOnEveryInbound: true } } },
      ],
      edges: [
        { id: 'edge-1', source: 'trigger-1', target: 'review' },
        { id: 'edge-2', source: 'review', target: 'tag-hold', label: 'hold' },
      ],
    };
    // Zweiter Trigger-Zweig mit Delay: der Elternlauf legt eine Join-Barriere
    // für zwei deferierte Zweige an.
    const fanOutGraph = {
      version: 1,
      nodes: [
        ...graph.nodes,
        { id: 'delay-1', type: 'registry', data: { nodeType: 'logic.delay', config: { delaySeconds: 3600 } } },
        { id: 'tag-delay', type: 'registry', data: { nodeType: 'email.tag', config: { tag: 'nach-delay', runOnEveryInbound: true } } },
      ],
      edges: [
        ...graph.edges,
        { id: 'edge-3', source: 'trigger-1', target: 'delay-1' },
        { id: 'edge-4', source: 'delay-1', target: 'tag-delay' },
      ],
    };
    const nextGraph = {
      version: 1,
      nodes: [{ id: 'trigger-1', type: 'trigger', data: { kind: 'inbound' } }],
      edges: [],
    };
    for (const [id, priority, workflowGraph] of [
      [WORKFLOW_ID, 1, graph],
      [NEXT_WORKFLOW_ID, 2, nextGraph],
      [FAN_OUT_WORKFLOW_ID, 3, fanOutGraph],
    ] as const) {
      await admin.query(`
        INSERT INTO email_workflows (
          id, workspace_id, source_sqlite_id, name, trigger_name, enabled, priority,
          definition_json, graph_json, execution_mode, engine_version
        ) VALUES ($1, $2, $1, $3, 'inbound', true, $4, '{}'::jsonb, $5::jsonb, 'graph', 1)
      `, [id, WORKSPACE_ID, `Workflow ${id}`, priority, JSON.stringify(workflowGraph)]);
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

  async function seedInboundWithDraft(messageId: number, draftId: number): Promise<void> {
    await postgres.admin.query(`
      INSERT INTO email_messages (
        id, workspace_id, source_sqlite_id, account_source_sqlite_id, folder_source_sqlite_id,
        account_id, folder_id, uid, subject, from_json
      ) VALUES ($1, $2, $1, $3, $4, $3, $4, $1, 'Frage', $5::jsonb)
    `, [messageId, WORKSPACE_ID, ACCOUNT_ID, FOLDER_ID, JSON.stringify({ value: [{ address: `kunde${messageId}@example.com` }] })]);
    await postgres.admin.query(`
      INSERT INTO email_messages (
        id, workspace_id, source_sqlite_id, account_source_sqlite_id, folder_source_sqlite_id,
        account_id, folder_id, uid, folder_kind, subject, body_text
      ) VALUES ($1, $2, $1, $3, $4, $3, $4, $5, 'draft', 'Re: Frage', 'Entwurf')
    `, [draftId, WORKSPACE_ID, ACCOUNT_ID, FOLDER_ID, -draftId]);
  }

  async function jobs(type: string): Promise<JobRow[]> {
    const rows = await postgres.admin.query<JobRow>(
      `SELECT payload FROM job_queue WHERE workspace_id = $1 AND type = $2 ORDER BY id`,
      [WORKSPACE_ID, type],
    );
    return [...rows.rows];
  }

  async function runWithSendVerdict(
    workflowId: number,
    messageId: number,
    draftId: number,
    context: Record<string, unknown>,
  ): Promise<void> {
    await createPostgresWorkflowExecutionJobPort({ db }).execute({
      workspaceId: WORKSPACE_ID,
      workflowId,
      messageId,
      triggerName: 'inbound',
      context: { ...context, eventVariables: { 'draft.id': draftId } },
    });
    const reviewJobs = await jobs('ai.review_draft');
    expect(reviewJobs).toHaveLength(1);
    await postgres.admin.query(`DELETE FROM job_queue WHERE workspace_id = $1 AND type = 'ai.review_draft'`, [WORKSPACE_ID]);
    await createPostgresAiReviewDraftPort({ db, secrets: {} as PostgresSecretPort })
      .reviewDraft(buildAiReviewDraftJobPlan(reviewJobs[0]!.payload, WORKSPACE_ID));
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
    await seedInboundWithDraft(7501, 7502);

    await runWithSendVerdict(WORKFLOW_ID, 7501, 7502, {
      inboundWorkflowChain: { workflowIds: [WORKFLOW_ID, NEXT_WORKFLOW_ID], index: 0 },
    });

    expect(await jobs('workflow.execute')).toMatchObject([{ payload: { workflowId: NEXT_WORKFLOW_ID } }]);
    expect(await openJoinBarriers(7501)).toEqual([]);
    expect(await appliedWorkflowIds(7501)).toEqual([WORKFLOW_ID]);
  });

  test('without a chain (backfill/reapply) the review releases its slot of the join barrier', async () => {
    await seedInboundWithDraft(7511, 7512);

    await runWithSendVerdict(FAN_OUT_WORKFLOW_ID, 7511, 7512, {});
    expect(await openJoinBarriers(7511)).toHaveLength(1);

    // Der Delay-Zweig läuft als letzter Geschwisterzweig zu Ende.
    const delayContinuations = await jobs('workflow.execute');
    expect(delayContinuations).toHaveLength(1);
    const delayPayload = delayContinuations[0]!.payload;
    await createPostgresWorkflowExecutionJobPort({ db }).execute(buildWorkflowExecutionJobPlan(delayPayload, WORKSPACE_ID, {
      // Wie der Worker nach der Prüfung durch den Async-Policy-Enforcer.
      kind: 'workflow_execute_delayed_message',
      delayedJobId: Number(delayPayload.delayedJobId),
      messageId: 7511,
    }));

    expect(await openJoinBarriers(7511)).toEqual([]);
    expect(await appliedWorkflowIds(7511)).toEqual([FAN_OUT_WORKFLOW_ID]);
  });
});
