import type { Kysely } from 'kysely';

import type { ServerDatabase } from '../../packages/server/src/db/schema';
import { createPostgresWorkflowExecutionJobPort } from '../../packages/server/src/workflow-execution';
import { startMigratedEmbeddedPostgres, type EmbeddedPostgres } from './helpers/embedded-postgres';

jest.mock('kysely', () => jest.requireActual('../../packages/server/node_modules/kysely'));

jest.setTimeout(120_000);

const WORKSPACE_ID = '10000000-0000-4000-8000-0000000000b7';
const WORKFLOW_ID = 7141;

// F-N-redos-01: stringsFromOutbound strippte den HTML-Teil des Entwurfs mit
// /<[^>]+>/g; unverschlossene '<' liefen quadratisch und blockierten den
// Workflow-Worker fuer Sekunden pro Lauf.
describe('server outbound workflow context strips draft HTML linearly', () => {
  let postgres: EmbeddedPostgres;
  let db: Kysely<ServerDatabase>;

  beforeAll(async () => {
    postgres = await startMigratedEmbeddedPostgres('workflow-outbound-html');
    await postgres.admin.query(`INSERT INTO workspaces (id, name) VALUES ($1, 'Outbound HTML Test')`, [WORKSPACE_ID]);
    db = postgres.createApplicationDb();
  });

  afterAll(async () => {
    if (db) await db.destroy();
    if (postgres) await postgres.stop();
  });

  test('hostile bodyHtml does not stall the run and the text still reaches combined_text', async () => {
    const graph = {
      version: 1,
      nodes: [
        { id: 'trigger-1', type: 'trigger', data: { kind: 'manual' } },
        {
          id: 'cond-1',
          type: 'condition',
          data: { field: 'combined_text', op: 'contains', value: 'hallo welt', caseInsensitive: true },
        },
        {
          id: 'task-1',
          type: 'action',
          data: { nodeType: 'crm.create_task', config: { title: 'HTML erkannt', allowWithoutCustomer: true } },
        },
      ],
      edges: [
        { id: 'edge-1', source: 'trigger-1', target: 'cond-1' },
        { id: 'edge-2', source: 'cond-1', target: 'task-1', label: 'ja' },
      ],
    };
    await postgres.admin.query(`
      INSERT INTO email_workflows (
        id, workspace_id, source_sqlite_id, name, trigger_name, enabled, priority,
        definition_json, graph_json, execution_mode, engine_version
      ) VALUES ($1, $2, $1, 'Outbound HTML', 'manual', true, 1, '{}'::jsonb, $3::jsonb, 'graph', 1)
    `, [WORKFLOW_ID, WORKSPACE_ID, JSON.stringify(graph)]);

    const started = Date.now();
    await createPostgresWorkflowExecutionJobPort({ db }).execute({
      workspaceId: WORKSPACE_ID,
      workflowId: WORKFLOW_ID,
      triggerName: 'manual',
      context: {
        outbound: {
          subject: 'Test',
          bodyText: '',
          bodyHtml: `<p>Hallo</p>Welt${'<'.repeat(80_000)}`,
          to: 'kunde@example.com',
        },
      },
    });
    expect(Date.now() - started).toBeLessThan(3_000);

    const tasks = await postgres.admin.query(`SELECT title FROM tasks WHERE workspace_id = $1`, [WORKSPACE_ID]);
    expect(tasks.rows).toEqual([{ title: 'HTML erkannt' }]);
  });
});
