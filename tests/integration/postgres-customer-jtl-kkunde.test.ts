import type { Kysely } from 'kysely';

import { createPostgresCustomerReadPort } from '../../packages/server/src/db/postgres-customer-port';
import type { ServerDatabase } from '../../packages/server/src/db/schema';
import { startMigratedEmbeddedPostgres, type EmbeddedPostgres } from './helpers/embedded-postgres';

jest.mock('kysely', () => jest.requireActual('../../packages/server/node_modules/kysely'));

jest.setTimeout(120_000);

const WORKSPACE_ID = '10000000-0000-4000-8000-0000000000f2';

// F-A10-12: Die Kunden-API lieferte kein jtl_kkunde; die Server-UI zeigte source_sqlite_id als
// JTL-Kundennummer (auch fuer Kunden ohne JTL-Bezug) und suchte/sortierte danach.
describe('PostgreSQL customers expose the JTL customer key', () => {
  let postgres: EmbeddedPostgres;
  let db: Kysely<ServerDatabase>;

  beforeAll(async () => {
    postgres = await startMigratedEmbeddedPostgres('customer-jtl-kkunde');
    await postgres.admin.query(`INSERT INTO workspaces (id, name) VALUES ($1, 'Customer JTL')`, [WORKSPACE_ID]);
    await postgres.admin.query(
      `INSERT INTO customers (id, workspace_id, source_sqlite_id, name, jtl_kkunde) VALUES
        (1, $1, 5001, 'JTL Kunde A', 777),
        (2, $1, 777, 'Lokaler Kunde', NULL),
        (3, $1, 3, 'JTL Kunde B', 12)`,
      [WORKSPACE_ID],
    );
    db = postgres.createApplicationDb();
  });

  afterAll(async () => {
    if (db) await db.destroy();
    if (postgres) await postgres.stop();
  });

  test('list and get return jtlKkunde, null for customers without JTL link', async () => {
    const customers = createPostgresCustomerReadPort({ db });

    const list = await customers.list({ workspaceId: WORKSPACE_ID, limit: 10 });
    expect(list.items.map((item) => [item.id, item.jtlKkunde])).toEqual([[1, 777], [2, null], [3, 12]]);
    await expect(customers.get({ workspaceId: WORKSPACE_ID, id: 2 })).resolves.toMatchObject({ jtlKkunde: null });
  });

  test('searching a JTL customer number matches jtl_kkunde, not source_sqlite_id', async () => {
    const customers = createPostgresCustomerReadPort({ db });

    const result = await customers.list({ workspaceId: WORKSPACE_ID, limit: 10, search: '777' });

    expect(result.items.map((item) => item.id)).toEqual([1]);
    expect(result.total).toBe(1);
  });

  test('sorting by the JTL customer number orders by jtl_kkunde', async () => {
    const customers = createPostgresCustomerReadPort({ db });

    const result = await customers.list({
      workspaceId: WORKSPACE_ID,
      limit: 10,
      offset: 0,
      sortBy: 'jtlCustomerNumber',
      sortDirection: 'asc',
    });

    expect(result.items.map((item) => item.id)).toEqual([3, 1, 2]);
  });
});
