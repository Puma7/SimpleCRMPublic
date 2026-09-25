import type { Kysely } from 'kysely';

import type { ServerDatabase } from '../../packages/server/src/db/schema';
import { createPostgresWorkflowExecutionJobPort } from '../../packages/server/src/workflow-execution';
import { startMigratedEmbeddedPostgres, type EmbeddedPostgres } from './helpers/embedded-postgres';

jest.mock('kysely', () => jest.requireActual('../../packages/server/node_modules/kysely'));

jest.setTimeout(120_000);

const WORKSPACE_ID = '10000000-0000-4000-8000-0000000000b9';
const HOPS_VARIABLE = '__continuation_hops';

type GraphNode = { id: string; type: string; data: Record<string, unknown> };
type GraphEdge = { id: string; source: string; target: string; label?: string };
type QueuedJob = { type: string; payload: Record<string, any> };
type StepRow = { node_id: string; status: string; message: string | null };

const trigger: GraphNode = { id: 'trigger-1', type: 'trigger', data: { kind: 'manual' } };
const loop: GraphNode = {
  id: 'loop-1',
  type: 'registry',
  data: { nodeType: 'logic.loop', config: { items: 'alpha,beta,gamma' } },
};
const http: GraphNode = {
  id: 'http-1',
  type: 'registry',
  data: { nodeType: 'http.request', config: { method: 'GET', url: 'https://api.example.com/hook' } },
};
const delay: GraphNode = {
  id: 'delay-1',
  type: 'registry',
  data: { nodeType: 'logic.delay', config: { delaySeconds: 60 } },
};
const tag: GraphNode = {
  id: 'tag-1',
  type: 'registry',
  data: { nodeType: 'logic.set_variable', config: { name: 'seen', value: '{{loop.item}}' } },
};

describe('server workflow: asynchronous nodes inside a loop body', () => {
  let postgres: EmbeddedPostgres;
  let db: Kysely<ServerDatabase>;
  let nextWorkflowId = 7250;

  beforeAll(async () => {
    postgres = await startMigratedEmbeddedPostgres('workflow-loop-async');
    await postgres.admin.query(`INSERT INTO workspaces (id, name) VALUES ($1, 'Loop Async Test')`, [WORKSPACE_ID]);
    db = postgres.createApplicationDb();
  });

  afterAll(async () => {
    if (db) await db.destroy();
    if (postgres) await postgres.stop();
  });

  beforeEach(async () => {
    await postgres.admin.query(`DELETE FROM job_queue WHERE workspace_id = $1`, [WORKSPACE_ID]);
  });

  async function insertWorkflow(nodes: GraphNode[], edges: GraphEdge[]): Promise<number> {
    const id = nextWorkflowId++;
    await postgres.admin.query(`
      INSERT INTO email_workflows (
        id, workspace_id, source_sqlite_id, name, trigger_name, enabled, priority,
        definition_json, graph_json, execution_mode, engine_version
      ) VALUES ($1, $2, $1, $3, 'manual', true, 1, '{}'::jsonb, $4::jsonb, 'graph', 1)
    `, [id, WORKSPACE_ID, `Loop async ${id}`, JSON.stringify({ version: 1, nodes, edges })]);
    return id;
  }

  async function execute(workflowId: number, context: Record<string, unknown> = {}): Promise<void> {
    await createPostgresWorkflowExecutionJobPort({ db }).execute({
      workspaceId: WORKSPACE_ID,
      workflowId,
      triggerName: 'manual',
      context,
    });
  }

  async function jobs(): Promise<QueuedJob[]> {
    const result = await postgres.admin.query<QueuedJob>(
      `SELECT type, payload FROM job_queue WHERE workspace_id = $1 ORDER BY id`,
      [WORKSPACE_ID],
    );
    return [...result.rows];
  }

  async function lastRun(workflowId: number): Promise<{ status: string; steps: StepRow[] }> {
    const run = await postgres.admin.query<{ id: number; status: string }>(
      `SELECT id, status FROM email_workflow_runs WHERE workspace_id = $1 AND workflow_id = $2 ORDER BY id DESC LIMIT 1`,
      [WORKSPACE_ID, workflowId],
    );
    const steps = await postgres.admin.query<StepRow>(
      `SELECT node_id, status, message FROM email_workflow_run_steps WHERE run_id = $1 ORDER BY id`,
      [run.rows[0]!.id],
    );
    return { status: run.rows[0]!.status, steps: [...steps.rows] };
  }

  // F-A9-04: Ein asynchroner Knoten mit Folgeknoten im Je-Eintrag-Zweig
  // deferierte beim ersten Eintrag; die Schleife gab auf, beta und gamma gingen
  // still verloren, und der Lauf meldete OK.
  test('an HTTP request with a follow-up inside the loop body fails the run before queueing', async () => {
    const workflowId = await insertWorkflow(
      [trigger, loop, http, tag],
      [
        { id: 'e1', source: 'trigger-1', target: 'loop-1' },
        { id: 'e2', source: 'loop-1', target: 'http-1', label: 'each' },
        { id: 'e3', source: 'http-1', target: 'tag-1' },
      ],
    );

    await execute(workflowId);

    expect(await jobs()).toEqual([]);
    const run = await lastRun(workflowId);
    expect(run.status).toBe('error');
    expect(run.steps.at(-1)).toEqual({
      node_id: 'http-1',
      status: 'error',
      message: expect.stringContaining('Schleife'),
    });
  });

  // F-A9-04: Gleiches Muster mit Verzoegerung; die Rueckkante zur Schleife hat
  // die Fortsetzung bei Eintrag 0 neu starten lassen (Endloskette).
  test('a delay with a back edge to the loop fails the run before scheduling', async () => {
    const workflowId = await insertWorkflow(
      [trigger, loop, delay, tag],
      [
        { id: 'e1', source: 'trigger-1', target: 'loop-1' },
        { id: 'e2', source: 'loop-1', target: 'delay-1', label: 'each' },
        { id: 'e3', source: 'delay-1', target: 'tag-1' },
        { id: 'e4', source: 'tag-1', target: 'loop-1' },
      ],
    );

    await execute(workflowId);

    expect(await jobs()).toEqual([]);
    const delayed = await postgres.admin.query(
      `SELECT id FROM workflow_delayed_jobs WHERE workspace_id = $1 AND workflow_id = $2`,
      [WORKSPACE_ID, workflowId],
    );
    expect(delayed.rows).toEqual([]);
    expect((await lastRun(workflowId)).status).toBe('error');
  });

  test('an HTTP request without a follow-up still runs once per loop item', async () => {
    const workflowId = await insertWorkflow(
      [trigger, loop, http],
      [
        { id: 'e1', source: 'trigger-1', target: 'loop-1' },
        { id: 'e2', source: 'loop-1', target: 'http-1', label: 'each' },
      ],
    );

    await execute(workflowId);

    expect((await jobs()).map((job) => job.type)).toEqual([
      'workflow.http_request',
      'workflow.http_request',
      'workflow.http_request',
    ]);
    expect((await lastRun(workflowId)).status).toBe('ok');
  });

  // F-A9-04: Fortsetzungen hatten keine globale Schranke; ein Kreis ueber einen
  // asynchronen Knoten (hier HTTP -> Variable -> HTTP) reihte ohne Ende neue
  // Jobs ein, weil MAX_GRAPH_STEPS nur je Job gilt.
  test('a continuation chain stops at the hop limit', async () => {
    const workflowId = await insertWorkflow(
      [trigger, http, tag],
      [
        { id: 'e1', source: 'trigger-1', target: 'http-1' },
        { id: 'e2', source: 'http-1', target: 'tag-1' },
        { id: 'e3', source: 'tag-1', target: 'http-1' },
      ],
    );

    await execute(workflowId, { resumeNodeId: 'tag-1', eventVariables: { [HOPS_VARIABLE]: 5 } });
    const [next] = await jobs();
    expect(next?.type).toBe('workflow.http_request');
    expect(next?.payload.continuation.eventVariables[HOPS_VARIABLE]).toBe(6);

    await postgres.admin.query(`DELETE FROM job_queue WHERE workspace_id = $1`, [WORKSPACE_ID]);
    await execute(workflowId, { resumeNodeId: 'tag-1', eventVariables: { [HOPS_VARIABLE]: 100 } });

    expect(await jobs()).toEqual([]);
    expect((await lastRun(workflowId)).status).toBe('error');
  });
});
