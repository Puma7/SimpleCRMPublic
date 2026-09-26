import type { Kysely } from 'kysely';

import { workflowGraphHasSideEffectNode } from '@simplecrm/core';
import type { ServerDatabase } from '../../packages/server/src/db/schema';
import { createPostgresWorkflowExecutionJobPort } from '../../packages/server/src/workflow-execution';
import { startMigratedEmbeddedPostgres, type EmbeddedPostgres } from './helpers/embedded-postgres';

jest.mock('kysely', () => jest.requireActual('../../packages/server/node_modules/kysely'));

jest.setTimeout(120_000);

const WORKSPACE_ID = '10000000-0000-4000-8000-0000000000b2';
const WORKFLOW_ID = 7101;

// F-A2b-01: the side-effect guard (workflows.edit without workflows.manage may
// only save harmless graphs) resolved the node type with a string check and
// fell back to actionType, while the executor coerced any nodeType with
// String(). An array nodeType therefore looked like logic.merge to the guard
// and ran as the side-effecting node it names.
describe('workflow node type resolution: guard and executor agree', () => {
  let postgres: EmbeddedPostgres;
  let db: Kysely<ServerDatabase>;

  beforeAll(async () => {
    postgres = await startMigratedEmbeddedPostgres('workflow-node-type');
    await postgres.admin.query(`INSERT INTO workspaces (id, name) VALUES ($1, 'Node Type Test')`, [WORKSPACE_ID]);
    db = postgres.createApplicationDb();
  });

  afterAll(async () => {
    if (db) await db.destroy();
    if (postgres) await postgres.stop();
  });

  test('an array nodeType the guard treats as logic.merge does not execute crm.create_task', async () => {
    const graph = {
      version: 1,
      nodes: [
        { id: 'trigger-1', type: 'trigger', data: { kind: 'manual' } },
        {
          id: 'smuggled-1',
          type: 'action',
          data: {
            nodeType: ['crm.create_task'],
            actionType: 'logic.merge',
            config: { title: 'Smuggled side effect', allowWithoutCustomer: true },
          },
        },
      ],
      edges: [{ id: 'edge-1', source: 'trigger-1', target: 'smuggled-1' }],
    };
    expect(workflowGraphHasSideEffectNode(graph)).toBe(false);

    await postgres.admin.query(`
      INSERT INTO email_workflows (
        id, workspace_id, source_sqlite_id, name, trigger_name, enabled, priority,
        definition_json, graph_json, execution_mode, engine_version
      ) VALUES ($1, $2, $1, 'Array node type', 'manual', true, 1, '{}'::jsonb, $3::jsonb, 'graph', 1)
    `, [WORKFLOW_ID, WORKSPACE_ID, JSON.stringify(graph)]);

    await createPostgresWorkflowExecutionJobPort({ db }).execute({
      workspaceId: WORKSPACE_ID,
      workflowId: WORKFLOW_ID,
      triggerName: 'manual',
      context: {},
    });

    const tasks = await postgres.admin.query(`SELECT title FROM tasks WHERE workspace_id = $1`, [WORKSPACE_ID]);
    expect(tasks.rows).toEqual([]);
  });
});
