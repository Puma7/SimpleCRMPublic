import type { Kysely } from 'kysely';

import type { ServerDatabase } from '../../packages/server/src/db/schema';
import { buildWorkflowExecutionJobPlan } from '../../packages/server/src/jobs/production-handlers';
import type { JobPayload } from '../../packages/server/src/jobs/types';
import { createPostgresWorkflowExecutionJobPort } from '../../packages/server/src/workflow-execution';
import { startMigratedEmbeddedPostgres, type EmbeddedPostgres } from './helpers/embedded-postgres';

jest.mock('kysely', () => jest.requireActual('../../packages/server/node_modules/kysely'));

jest.setTimeout(120_000);

const WORKSPACE_ID = '10000000-0000-4000-8000-0000000000d3';
const ACCOUNT_ID = 801;
const FOLDER_ID = 811;
const NEXT_WORKFLOW_ID = 830;
const DELAY_WORKFLOW_ID = 831;
const TWO_DELAYS_WORKFLOW_ID = 832;
const DELAY_THEN_NODE_STOP_WORKFLOW_ID = 833;
const DELAY_THEN_SPAM_STOP_WORKFLOW_ID = 834;

type QueuedJob = { payload: JobPayload & { workflowId?: number; delayedJobId?: number; context?: { inboundWorkflowChain?: { index: number } } } };

const trigger = { id: 'trigger-1', type: 'trigger', data: { kind: 'inbound' } };
function delay(id: string) {
  return { id, type: 'registry', data: { nodeType: 'logic.delay', config: { delaySeconds: 3600 } } };
}
function tag(id: string, value: string, extra: Record<string, unknown> = {}) {
  return { id, type: 'registry', data: { nodeType: 'email.tag', config: { tag: value, runOnEveryInbound: true, ...extra } } };
}
function edge(id: string, source: string, target: string) {
  return { id, source, target };
}

// F-D1-03: since the serial inbound chain, a logic.delay in a higher-priority
// workflow held every lower-priority inbound workflow (spam, assignment, tags,
// auto-reply) until the delay was over — up to 7 days per delay. Approved
// semantics: when nothing behind the delay can stop the chain, the chain moves
// on right away; otherwise it stays serial.
describe('inbound priority chain with logic.delay', () => {
  let postgres: EmbeddedPostgres;
  let db: Kysely<ServerDatabase>;
  let nextMessageId = 8401;

  beforeAll(async () => {
    postgres = await startMigratedEmbeddedPostgres('workflow-delay-chain-advance');
    const { admin } = postgres;
    await admin.query(`INSERT INTO workspaces (id, name) VALUES ($1, 'Delay Chain Advance Test')`, [WORKSPACE_ID]);
    await admin.query(`
      INSERT INTO email_accounts (id, workspace_id, source_sqlite_id, display_name, email_address, imap_host, imap_username)
      VALUES ($1, $2, $1, 'Support', 'support@example.test', 'imap.example.test', 'support')
    `, [ACCOUNT_ID, WORKSPACE_ID]);
    await admin.query(`
      INSERT INTO email_folders (id, workspace_id, source_sqlite_id, account_source_sqlite_id, account_id, path)
      VALUES ($1, $2, $1, $3, $3, 'INBOX')
    `, [FOLDER_ID, WORKSPACE_ID, ACCOUNT_ID]);
    const graphs: Array<[number, unknown]> = [
      [NEXT_WORKFLOW_ID, { version: 1, nodes: [trigger, tag('tag-1', 'next')], edges: [edge('e1', 'trigger-1', 'tag-1')] }],
      [DELAY_WORKFLOW_ID, {
        version: 1,
        nodes: [trigger, delay('delay-1'), tag('tag-1', 'after-delay')],
        edges: [edge('e1', 'trigger-1', 'delay-1'), edge('e2', 'delay-1', 'tag-1')],
      }],
      [TWO_DELAYS_WORKFLOW_ID, {
        version: 1,
        nodes: [trigger, delay('delay-1'), delay('delay-2'), tag('tag-1', 'after-delay-1'), tag('tag-2', 'after-delay-2')],
        edges: [
          edge('e1', 'trigger-1', 'delay-1'),
          edge('e2', 'trigger-1', 'delay-2'),
          edge('e3', 'delay-1', 'tag-1'),
          edge('e4', 'delay-2', 'tag-2'),
        ],
      }],
      [DELAY_THEN_NODE_STOP_WORKFLOW_ID, {
        version: 1,
        nodes: [trigger, delay('delay-1'), tag('tag-1', 'after-delay'), tag('tag-2', 'stop-here', { stopFurtherWorkflows: true })],
        edges: [edge('e1', 'trigger-1', 'delay-1'), edge('e2', 'delay-1', 'tag-1'), edge('e3', 'tag-1', 'tag-2')],
      }],
      [DELAY_THEN_SPAM_STOP_WORKFLOW_ID, {
        version: 1,
        nodes: [trigger, delay('delay-1'), { id: 'spam-stop', type: 'registry', data: { nodeType: 'logic.stop_after_spam', config: {} } }],
        edges: [edge('e1', 'trigger-1', 'delay-1'), edge('e2', 'delay-1', 'spam-stop')],
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

  async function newMessage(): Promise<number> {
    const id = nextMessageId++;
    await postgres.admin.query(`
      INSERT INTO email_messages (
        id, workspace_id, source_sqlite_id, account_source_sqlite_id, folder_source_sqlite_id,
        account_id, folder_id, uid, subject
      ) VALUES ($1, $2, $1, $3, $4, $3, $4, $1, 'Delay chain')
    `, [id, WORKSPACE_ID, ACCOUNT_ID, FOLDER_ID]);
    return id;
  }

  async function startChain(workflowId: number, messageId: number): Promise<void> {
    await createPostgresWorkflowExecutionJobPort({ db }).execute({
      workspaceId: WORKSPACE_ID,
      workflowId,
      messageId,
      triggerName: 'inbound',
      context: { inboundWorkflowChain: { workflowIds: [workflowId, NEXT_WORKFLOW_ID], index: 0 } },
    });
  }

  async function queuedJobs(): Promise<QueuedJob[]> {
    const rows = await postgres.admin.query<QueuedJob>(
      `SELECT payload FROM job_queue WHERE workspace_id = $1 AND type = 'workflow.execute' ORDER BY id`,
      [WORKSPACE_ID],
    );
    return [...rows.rows];
  }

  async function nextHops(): Promise<Array<number | undefined>> {
    return (await queuedJobs())
      .filter((job) => job.payload.workflowId === NEXT_WORKFLOW_ID)
      .map((job) => job.payload.context?.inboundWorkflowChain?.index);
  }

  async function delayContinuations(): Promise<QueuedJob[]> {
    return (await queuedJobs()).filter((job) => job.payload.delayedJobId !== undefined);
  }

  /** Delay abgelaufen: die eingereihte Fortsetzung laeuft wie im Worker. */
  async function runDelayContinuation(job: QueuedJob, messageId: number): Promise<void> {
    await createPostgresWorkflowExecutionJobPort({ db }).execute(buildWorkflowExecutionJobPlan(job.payload, WORKSPACE_ID, {
      kind: 'workflow_execute_delayed_message',
      delayedJobId: Number(job.payload.delayedJobId),
      messageId,
    }));
  }

  async function tags(messageId: number): Promise<string[]> {
    const rows = await postgres.admin.query<{ tag: string }>(
      `SELECT tag FROM email_message_tags WHERE workspace_id = $1 AND message_id = $2 ORDER BY tag`,
      [WORKSPACE_ID, messageId],
    );
    return rows.rows.map((row) => row.tag);
  }

  async function appliedWorkflowIds(messageId: number): Promise<number[]> {
    const rows = await postgres.admin.query<{ workflow_id: number }>(
      `SELECT workflow_id FROM email_message_workflow_applied WHERE workspace_id = $1 AND message_id = $2`,
      [WORKSPACE_ID, messageId],
    );
    return rows.rows.map((row) => Number(row.workflow_id));
  }

  test('a delay with nothing chain-stopping behind it advances the chain immediately', async () => {
    const messageId = await newMessage();
    await startChain(DELAY_WORKFLOW_ID, messageId);

    expect(await nextHops()).toEqual([1]);
    const [continuation] = await delayContinuations();
    expect(continuation).toBeDefined();

    await runDelayContinuation(continuation!, messageId);

    // Die Fortsetzung schliesst nur noch ab, sie reiht nicht erneut ein.
    expect(await nextHops()).toEqual([1]);
    expect(await tags(messageId)).toEqual(['after-delay']);
    expect(await appliedWorkflowIds(messageId)).toEqual([DELAY_WORKFLOW_ID]);
  });

  test('two delay branches advance the chain once and are applied after the last one', async () => {
    const messageId = await newMessage();
    await startChain(TWO_DELAYS_WORKFLOW_ID, messageId);

    expect(await nextHops()).toEqual([1]);
    const continuations = await delayContinuations();
    expect(continuations).toHaveLength(2);

    await runDelayContinuation(continuations[0]!, messageId);
    expect(await appliedWorkflowIds(messageId)).toEqual([]);
    await runDelayContinuation(continuations[1]!, messageId);

    expect(await nextHops()).toEqual([1]);
    expect(await tags(messageId)).toEqual(['after-delay-1', 'after-delay-2']);
    expect(await appliedWorkflowIds(messageId)).toEqual([TWO_DELAYS_WORKFLOW_ID]);
  });

  test('a node with stopFurtherWorkflows behind the delay keeps the chain serial', async () => {
    const messageId = await newMessage();
    await startChain(DELAY_THEN_NODE_STOP_WORKFLOW_ID, messageId);

    expect(await nextHops()).toEqual([]);
    const [continuation] = await delayContinuations();
    await runDelayContinuation(continuation!, messageId);

    // Der Knoten stoppt die Kette: der naechste Workflow laeuft gar nicht.
    expect(await nextHops()).toEqual([]);
    expect(await tags(messageId)).toEqual(['after-delay', 'stop-here']);
  });

  test('logic.stop_after_spam behind the delay keeps the chain serial until the delay is over', async () => {
    const messageId = await newMessage();
    await startChain(DELAY_THEN_SPAM_STOP_WORKFLOW_ID, messageId);

    expect(await nextHops()).toEqual([]);
    const [continuation] = await delayContinuations();
    await runDelayContinuation(continuation!, messageId);

    // Kein Spam: die Kette laeuft nach dem Delay weiter, genau einmal.
    expect(await nextHops()).toEqual([1]);
  });
});
