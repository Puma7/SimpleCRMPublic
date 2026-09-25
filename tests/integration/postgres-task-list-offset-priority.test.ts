import type { Kysely } from 'kysely';

import { createServerApi, type AuthApiPort, type ServerApiPorts } from '../../packages/server/src';
import { createPostgresTaskReadPort } from '../../packages/server/src/db/postgres-core-crm-read-ports';
import type { ServerDatabase } from '../../packages/server/src/db/schema';
import { startMigratedEmbeddedPostgres, type EmbeddedPostgres } from './helpers/embedded-postgres';

jest.mock('kysely', () => jest.requireActual('../../packages/server/node_modules/kysely'));

jest.setTimeout(120_000);

const WORKSPACE_ID = '10000000-0000-4000-8000-0000000000f1';
const OWNER_ID = '20000000-0000-4000-8000-0000000000f1';
const PRIORITIES = ['High', 'Medium', 'Low'] as const;

// F-A11b-01: GET /api/v1/tasks kannte weder offset noch priority; jede Seite der Aufgabenliste
// zeigte dieselben ersten Eintraege und der Prioritaetsfilter wirkte nicht.
describe('PostgreSQL task list: offset pagination and priority filter', () => {
  let postgres: EmbeddedPostgres;
  let db: Kysely<ServerDatabase>;

  beforeAll(async () => {
    postgres = await startMigratedEmbeddedPostgres('task-list-offset-priority');
    await postgres.admin.query(`INSERT INTO workspaces (id, name) VALUES ($1, 'Task List')`, [WORKSPACE_ID]);
    await postgres.admin.query(
      `INSERT INTO users (id, workspace_id, email, display_name, password_hash, role)
       VALUES ($1, $2, 'owner@example.test', 'Owner', 'hash', 'owner')`,
      [OWNER_ID, WORKSPACE_ID],
    );
    for (let id = 1; id <= 25; id += 1) {
      await postgres.admin.query(
        `INSERT INTO tasks (id, workspace_id, source_sqlite_id, customer_source_sqlite_id, title, priority, completed, assignment_scope)
         VALUES ($1, $2, $1, 0, $3, $4, false, 'global')`,
        [id, WORKSPACE_ID, `Aufgabe ${id}`, PRIORITIES[(id - 1) % 3]],
      );
    }
    db = postgres.createApplicationDb();
  });

  afterAll(async () => {
    if (db) await db.destroy();
    if (postgres) await postgres.stop();
  });

  function api() {
    const ports: ServerApiPorts = {
      auth: {} as AuthApiPort,
      locks: {} as ServerApiPorts['locks'],
      tasks: createPostgresTaskReadPort({ db }),
    };
    return createServerApi(ports);
  }

  async function listIds(query: Record<string, string>): Promise<number[]> {
    const response = await api().handle({
      method: 'GET',
      path: '/api/v1/tasks',
      query,
      principal: { userId: OWNER_ID, workspaceId: WORKSPACE_ID, role: 'owner' },
    });
    expect(response.status).toBe(200);
    return (response.body as { data: { items: Array<{ id: number }> } }).data.items.map((item) => item.id);
  }

  test('offset skips the earlier pages', async () => {
    expect(await listIds({ limit: '10' })).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(await listIds({ limit: '10', offset: '10' })).toEqual([11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
    expect(await listIds({ limit: '10', offset: '20' })).toEqual([21, 22, 23, 24, 25]);
  });

  test('priority filters before paginating', async () => {
    expect(await listIds({ limit: '5', priority: 'High' })).toEqual([1, 4, 7, 10, 13]);
    expect(await listIds({ limit: '5', offset: '5', priority: 'High' })).toEqual([16, 19, 22, 25]);
  });

  test('rejects an invalid offset and offset together with cursor', async () => {
    const principal = { userId: OWNER_ID, workspaceId: WORKSPACE_ID, role: 'owner' as const };
    const invalid = await api().handle({ method: 'GET', path: '/api/v1/tasks', query: { offset: '-1' }, principal });
    expect(invalid.status).toBe(400);
    const ambiguous = await api().handle({
      method: 'GET',
      path: '/api/v1/tasks',
      query: { offset: '10', cursor: '3' },
      principal,
    });
    expect(ambiguous.status).toBe(400);
  });
});
