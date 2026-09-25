import type { FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';

import {
  createFastifyServer,
  type AuthenticatedPrincipal,
  type ServerApiPorts,
} from '../../packages/server/src';
import { createPostgresCustomerReadPort } from '../../packages/server/src/db/postgres-customer-port';
import type { ServerDatabase } from '../../packages/server/src/db/schema';
import { startMigratedEmbeddedPostgres, type EmbeddedPostgres } from './helpers/embedded-postgres';

jest.mock('kysely', () => jest.requireActual('../../packages/server/node_modules/kysely'));

jest.setTimeout(120_000);

const WORKSPACE_ID = '10000000-0000-4000-8000-0000000000b5';
const OWNER_ID = '20000000-0000-4000-8000-0000000000b5';

const owner: AuthenticatedPrincipal = { userId: OWNER_ID, workspaceId: WORKSPACE_ID, role: 'owner' };

// F-A10-10: deleting a customer on the server set customer_id of its deals and
// tasks to NULL and left them orphaned, while the desktop silently cascaded.
// Both editions now refuse (409 with counters) until the caller confirms with
// ?cascade=true, which then removes deals, tasks and appointments together.
describe('DELETE /api/v1/customers/:id with dependent records (PostgreSQL)', () => {
  let postgres: EmbeddedPostgres;
  let db: Kysely<ServerDatabase>;
  let app: FastifyInstance;

  const count = async (sql: string) => Number((await postgres.admin.query<{ count: string }>(sql, [WORKSPACE_ID])).rows[0]?.count);

  beforeAll(async () => {
    postgres = await startMigratedEmbeddedPostgres('customer-delete');
    await postgres.admin.query(`INSERT INTO workspaces (id, name) VALUES ($1, 'Customer Delete')`, [WORKSPACE_ID]);
    await postgres.admin.query(
      `INSERT INTO users (id, workspace_id, email, display_name, password_hash, role)
       VALUES ($1, $2, 'owner@example.test', 'Owner', 'hash', 'owner')`,
      [OWNER_ID, WORKSPACE_ID],
    );
    await postgres.admin.query(
      `INSERT INTO customers (id, workspace_id, source_sqlite_id, name) VALUES (1, $1, 1, 'Ada'), (2, $1, 2, 'Ohne Daten')`,
      [WORKSPACE_ID],
    );
    await postgres.admin.query(
      `INSERT INTO products (id, workspace_id, source_sqlite_id, name, price) VALUES (1, $1, 1, 'Produkt', 10)`,
      [WORKSPACE_ID],
    );
    await postgres.admin.query(
      `INSERT INTO deals (id, workspace_id, source_sqlite_id, customer_source_sqlite_id, customer_id, name, value, stage)
       VALUES (1, $1, 1, 1, 1, 'Deal', 10, 'Angebot')`,
      [WORKSPACE_ID],
    );
    await postgres.admin.query(
      `INSERT INTO deal_products (workspace_id, source_sqlite_id, deal_source_sqlite_id, product_source_sqlite_id, deal_id, product_id, quantity, price_at_time_of_adding)
       VALUES ($1, 1, 1, 1, 1, 1, 1, 10)`,
      [WORKSPACE_ID],
    );
    await postgres.admin.query(
      `INSERT INTO tasks (id, workspace_id, source_sqlite_id, customer_source_sqlite_id, customer_id, title, priority)
       VALUES (1, $1, 1, 1, 1, 'Anrufen', 'High')`,
      [WORKSPACE_ID],
    );
    await postgres.admin.query(
      `INSERT INTO calendar_events (id, workspace_id, source_sqlite_id, title, start_date, end_date, task_id)
       VALUES (1, $1, 1, 'Anrufen', now(), now() + interval '1 hour', 1)`,
      [WORKSPACE_ID],
    );
    db = postgres.createApplicationDb();
    const ports = {
      auth: {} as ServerApiPorts['auth'],
      locks: {} as ServerApiPorts['locks'],
      customers: createPostgresCustomerReadPort({ db }),
    } as ServerApiPorts;
    app = createFastifyServer({ ports, resolvePrincipal: () => owner });
    await app.ready();
  });

  afterAll(async () => {
    if (app) await app.close();
    if (db) await db.destroy();
    if (postgres) await postgres.stop();
  });

  test('refuses with 409 and counters, then cascades in one step after confirmation', async () => {
    const withoutDependents = await app.inject({ method: 'DELETE', url: '/api/v1/customers/2' });
    expect(withoutDependents.statusCode).toBe(200);

    const refused = await app.inject({ method: 'DELETE', url: '/api/v1/customers/1' });
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toMatchObject({
      error: {
        code: 'customer_has_dependents',
        details: { dependents: { deals: 1, tasks: 1, appointments: 1 } },
      },
    });
    expect(await count('SELECT count(*) FROM deals WHERE workspace_id = $1 AND customer_id = 1')).toBe(1);
    expect(await count('SELECT count(*) FROM tasks WHERE workspace_id = $1 AND customer_id = 1')).toBe(1);

    const invalid = await app.inject({ method: 'DELETE', url: '/api/v1/customers/1?cascade=maybe' });
    expect(invalid.statusCode).toBe(400);

    const cascaded = await app.inject({ method: 'DELETE', url: '/api/v1/customers/1?cascade=true' });
    expect(cascaded.statusCode).toBe(200);
    expect(await count('SELECT count(*) FROM customers WHERE workspace_id = $1')).toBe(0);
    expect(await count('SELECT count(*) FROM deals WHERE workspace_id = $1')).toBe(0);
    expect(await count('SELECT count(*) FROM deal_products WHERE workspace_id = $1')).toBe(0);
    expect(await count('SELECT count(*) FROM tasks WHERE workspace_id = $1')).toBe(0);
    expect(await count('SELECT count(*) FROM calendar_events WHERE workspace_id = $1')).toBe(0);
  });
});
