import type { Kysely } from 'kysely';

import type { ServerDatabase } from '../../packages/server/src/db/schema';
import { createPostgresWorkflowExecutionJobPort } from '../../packages/server/src/workflow-execution';
import { startMigratedEmbeddedPostgres, type EmbeddedPostgres } from './helpers/embedded-postgres';

jest.mock('kysely', () => jest.requireActual('../../packages/server/node_modules/kysely'));

jest.setTimeout(120_000);

const WORKSPACE_ID = '10000000-0000-4000-8000-0000000000b8';

type GraphNode = { id: string; type: string; data: Record<string, unknown> };
type GraphEdge = { id: string; source: string; target: string; label?: string };

const trigger: GraphNode = { id: 'trigger', type: 'trigger', data: { kind: 'manual' } };

function loopNode(id: string, items: string, sourceVariable: string): GraphNode {
  return { id, type: 'registry', data: { nodeType: 'logic.loop', config: { items, sourceVariable } } };
}

const review: GraphNode = {
  id: 'review',
  type: 'registry',
  data: { nodeType: 'ai.review', config: { blockKeyword: 'BLOCK' } },
};
const tag: GraphNode = { id: 'tag', type: 'registry', data: { nodeType: 'email.tag', config: { tag: 'geprueft' } } };

describe('server workflow loop and block-port guards', () => {
  let postgres: EmbeddedPostgres;
  let db: Kysely<ServerDatabase>;
  let nextWorkflowId = 7150;

  beforeAll(async () => {
    postgres = await startMigratedEmbeddedPostgres('workflow-loop-guards');
    await postgres.admin.query(`INSERT INTO workspaces (id, name) VALUES ($1, 'Loop Guard Test')`, [WORKSPACE_ID]);
    db = postgres.createApplicationDb();
  });

  afterAll(async () => {
    if (db) await db.destroy();
    if (postgres) await postgres.stop();
  });

  async function insertWorkflow(nodes: GraphNode[], edges: GraphEdge[]): Promise<number> {
    const id = nextWorkflowId++;
    await postgres.admin.query(`
      INSERT INTO email_workflows (
        id, workspace_id, source_sqlite_id, name, trigger_name, enabled, priority,
        definition_json, graph_json, execution_mode, engine_version
      ) VALUES ($1, $2, $1, $3, 'manual', true, 1, '{}'::jsonb, $4::jsonb, 'graph', 1)
    `, [id, WORKSPACE_ID, `Loop guard ${id}`, JSON.stringify({ version: 1, nodes, edges })]);
    return id;
  }

  /** Blockiert die ersten `blockCalls` Aufrufe, danach OK — damit auch der fehlerhafte Lauf endet. */
  function previewPort(blockCalls: number) {
    let calls = 0;
    return {
      get calls() {
        return calls;
      },
      async run() {
        calls += 1;
        return calls <= blockCalls ? { ok: false as const, reason: 'nein' } : { ok: true as const };
      },
    };
  }

  // F-N-srv-01: Verschachtelte Schleifen erbten die Haltepunkte der umschliessenden
  // Schleife nicht; ein Kreis L1 -> L2 -> L1 startete L1 im Rumpf von L2 neu
  // (ohne das leerende set_variable unbegrenzt rekursiv).
  test('a nested loop does not restart the enclosing loop', async () => {
    const workflowId = await insertWorkflow(
      [
        trigger,
        loopNode('l1', 'a,b', 'l1_items'),
        { id: 'x', type: 'registry', data: { nodeType: 'logic.set_variable', config: { name: 'l1_items', value: ' ' } } },
        loopNode('l2', 'p,q', 'l2_items'),
        { id: 'y', type: 'registry', data: { nodeType: 'logic.merge', config: {} } },
      ],
      [
        { id: 'e1', source: 'trigger', target: 'l1' },
        { id: 'e2', source: 'l1', target: 'x', label: 'each' },
        { id: 'e3', source: 'x', target: 'l2' },
        { id: 'e4', source: 'l2', target: 'y', label: 'each' },
        { id: 'e5', source: 'y', target: 'l1' },
      ],
    );

    const result = await createPostgresWorkflowExecutionJobPort({ db }).dryRun!({
      workspaceId: WORKSPACE_ID,
      workflowId,
      triggerName: 'manual',
      context: {},
    });

    expect(result.status).toBe('ok');
    expect(result.log.filter((line) => line.startsWith('loop:'))).toEqual([
      'loop:0:a',
      'loop:0:p',
      'loop:1:q',
      'loop:1:b',
      'loop:0:p',
      'loop:1:q',
    ]);
  });

  // F-N-srv-01: Der Block-Port-Zweig begann mit stepCount 0; ein Kreis ueber einen
  // Block-Ausgang im Schleifenrumpf lief so ohne Schrittlimit weiter.
  test('the block-port branch keeps counting steps inside a loop body', async () => {
    const workflowId = await insertWorkflow(
      [trigger, loopNode('l1', 'a', 'l1_items'), review, tag],
      [
        { id: 'e1', source: 'trigger', target: 'l1' },
        { id: 'e2', source: 'l1', target: 'review', label: 'each' },
        { id: 'e3', source: 'review', target: 'tag', label: 'block' },
        { id: 'e4', source: 'tag', target: 'review' },
      ],
    );
    const preview = previewPort(400);

    const result = await createPostgresWorkflowExecutionJobPort({ db, aiReviewPreview: preview.run }).dryRun!({
      workspaceId: WORKSPACE_ID,
      workflowId,
      triggerName: 'manual',
      context: { previewOutbound: true },
    });

    expect(result.blocked).toBe(true);
    expect(result.blockReason).toBe('graph_step_limit:server_workflow_execution');
    expect(preview.calls).toBeLessThanOrEqual(250);
  });

  // F-N-srv-01: Ausserhalb von Schleifen verlor der Block-Port-Zweig ausserdem die
  // besuchten Knoten; ein Kreis ueber den Block-Ausgang wurde nicht erkannt.
  test('the block-port branch detects a cycle back to the blocking node', async () => {
    const workflowId = await insertWorkflow(
      [trigger, review, tag],
      [
        { id: 'e1', source: 'trigger', target: 'review' },
        { id: 'e2', source: 'review', target: 'tag', label: 'block' },
        { id: 'e3', source: 'tag', target: 'review' },
      ],
    );
    const preview = previewPort(400);

    const result = await createPostgresWorkflowExecutionJobPort({ db, aiReviewPreview: preview.run }).dryRun!({
      workspaceId: WORKSPACE_ID,
      workflowId,
      triggerName: 'manual',
      context: { previewOutbound: true },
    });

    expect(result.blocked).toBe(true);
    expect(result.blockReason).toBe('nein');
    expect(result.log).toContain('cycle:review');
    expect(preview.calls).toBe(1);
  });
});
