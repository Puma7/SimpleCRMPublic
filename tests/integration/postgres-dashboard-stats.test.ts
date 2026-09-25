import type { Kysely } from 'kysely';

import { createPostgresDashboardPort } from '../../packages/server/src/db/postgres-dashboard-port';
import type { ServerDatabase } from '../../packages/server/src/db/schema';
import { startMigratedEmbeddedPostgres, type EmbeddedPostgres } from './helpers/embedded-postgres';

jest.mock('kysely', () => jest.requireActual('../../packages/server/node_modules/kysely'));

jest.setTimeout(120_000);

const WORKSPACE_ID = '10000000-0000-4000-8000-0000000000d7';

// F-A10-07: the conversion rate counted only 'Closed Won'/'Closed Lost', so it
// stayed at 0 % for the German stages the UI writes, and "new customers last
// month" used updated_at, which every JTL sync refreshes for all customers.
describe('PostgreSQL dashboard stats', () => {
  let postgres: EmbeddedPostgres;
  let db: Kysely<ServerDatabase>;

  beforeAll(async () => {
    postgres = await startMigratedEmbeddedPostgres('dashboard-stats');
    await postgres.admin.query(`INSERT INTO workspaces (id, name) VALUES ($1, 'Dashboard Stats')`, [WORKSPACE_ID]);
    await postgres.admin.query(
      `INSERT INTO customers (id, workspace_id, source_sqlite_id, name, date_added, updated_at) VALUES
        (1, $1, 1, 'Altkunde nach JTL-Sync', now() - interval '90 days', now()),
        (2, $1, 2, 'Neukunde', now() - interval '3 days', now())`,
      [WORKSPACE_ID],
    );
    await postgres.admin.query(
      `INSERT INTO deals (workspace_id, source_sqlite_id, customer_source_sqlite_id, customer_id, name, value, stage) VALUES
        ($1, 1, 1, 1, 'Gewonnen', 100, 'Gewonnen'),
        ($1, 2, 1, 1, 'Verloren', 50, 'Verloren'),
        ($1, 3, 1, 1, 'Legacy gewonnen', 20, 'Closed Won'),
        ($1, 4, 1, 1, 'Offen', 30, 'Angebot')`,
      [WORKSPACE_ID],
    );
    db = postgres.createApplicationDb();
  });

  afterAll(async () => {
    if (db) await db.destroy();
    if (postgres) await postgres.stop();
  });

  test('counts German won/lost stages and new customers by date added', async () => {
    const stats = await createPostgresDashboardPort({ db }).getStats({ workspaceId: WORKSPACE_ID });

    expect(stats.conversionRate).toBeCloseTo((2 / 3) * 100);
    expect(stats.activeDealsCount).toBe(1);
    expect(stats.activeDealsValue).toBe(30);
    expect(stats.totalCustomers).toBe(2);
    expect(stats.newCustomersLastMonth).toBe(1);
  });
});
