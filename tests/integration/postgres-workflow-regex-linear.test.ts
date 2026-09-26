import { setFlagsFromString } from 'v8';
import type { Kysely } from 'kysely';

import type { ServerDatabase } from '../../packages/server/src/db/schema';
import { createPostgresWorkflowExecutionJobPort } from '../../packages/server/src/workflow-execution';
import { startMigratedEmbeddedPostgres, type EmbeddedPostgres } from './helpers/embedded-postgres';

jest.mock('kysely', () => jest.requireActual('../../packages/server/node_modules/kysely'));

jest.setTimeout(120_000);

// Wie docker/api.Dockerfile; wirkt auf jeden danach erzeugten RegExp.
setFlagsFromString('--enable-experimental-regexp-engine-on-excessive-backtracks');

const WORKSPACE_ID = '10000000-0000-4000-8000-0000000000e1';
const WORKFLOW_ID = 7151;

// F-A13A14-04: Regex-Bedingungen sind standardmaessig case-insensitiv; mit Flag i
// stellt V8 nie auf die lineare Engine um, und (a|a)*b auf einem Betreff aus
// 26 'a' blockierte den API-Prozess fuer Sekunden.
describe('server workflow regex conditions run on the linear engine', () => {
  let postgres: EmbeddedPostgres;
  let db: Kysely<ServerDatabase>;

  beforeAll(async () => {
    postgres = await startMigratedEmbeddedPostgres('workflow-regex-linear');
    await postgres.admin.query(`INSERT INTO workspaces (id, name) VALUES ($1, 'Regex Linear Test')`, [WORKSPACE_ID]);
    db = postgres.createApplicationDb();
    const graph = {
      version: 1,
      nodes: [
        { id: 'trigger-1', type: 'trigger', data: { kind: 'manual' } },
        { id: 'cond-1', type: 'condition', data: { field: 'subject', op: 'regex', value: '(a|a)*b', caseInsensitive: true } },
        {
          id: 'task-1',
          type: 'action',
          data: { nodeType: 'crm.create_task', config: { title: 'Regex erkannt', allowWithoutCustomer: true } },
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
      ) VALUES ($1, $2, $1, 'Regex Linear', 'manual', true, 1, '{}'::jsonb, $3::jsonb, 'graph', 1)
    `, [WORKFLOW_ID, WORKSPACE_ID, JSON.stringify(graph)]);
  });

  afterAll(async () => {
    if (db) await db.destroy();
    if (postgres) await postgres.stop();
  });

  async function run(subject: string): Promise<void> {
    await createPostgresWorkflowExecutionJobPort({ db }).execute({
      workspaceId: WORKSPACE_ID,
      workflowId: WORKFLOW_ID,
      triggerName: 'manual',
      context: { outbound: { subject, bodyText: '', to: 'kunde@example.com' } },
    });
  }

  test('a hostile subject does not stall the run, a matching subject still matches case-insensitively', async () => {
    const started = Date.now();
    await run('a'.repeat(26) + '!');
    expect(Date.now() - started).toBeLessThan(3_000);
    const none = await postgres.admin.query(`SELECT title FROM tasks WHERE workspace_id = $1`, [WORKSPACE_ID]);
    expect(none.rows).toEqual([]);

    await run('Betreff AAAB');
    const tasks = await postgres.admin.query(`SELECT title FROM tasks WHERE workspace_id = $1`, [WORKSPACE_ID]);
    expect(tasks.rows).toEqual([{ title: 'Regex erkannt' }]);
  });
});
