import { sql, type Kysely } from 'kysely';

import type { ServerDatabase } from '../../packages/server/src/db/schema';
import { createJtlSyncPort, createPostgresJtlSyncStore, type JtlSyncSourceData } from '../../packages/server/src/jtl-sync';
import { jtlKeyUniquenessMigration } from '../../packages/server/src/migrations/0052_jtl_key_uniqueness';
import { startMigratedEmbeddedPostgres, type EmbeddedPostgres } from './helpers/embedded-postgres';

jest.mock('kysely', () => jest.requireActual('../../packages/server/node_modules/kysely'));

jest.setTimeout(120_000);

const WORKSPACE_ID = '10000000-0000-4000-8000-0000000000f1';
const CLEANUP_WORKSPACE_ID = '10000000-0000-4000-8000-0000000000f2';
const USER_ID = '20000000-0000-4000-8000-0000000000f1';

function source(overrides: Partial<JtlSyncSourceData>): JtlSyncSourceData {
  return { customers: [], products: [], firmen: [], warenlager: [], zahlungsarten: [], versandarten: [], ...overrides };
}

describe('server JTL sync keys on kKunde/kArtikel (PostgreSQL)', () => {
  let postgres: EmbeddedPostgres;
  let db: Kysely<ServerDatabase>;

  beforeAll(async () => {
    postgres = await startMigratedEmbeddedPostgres('jtl-sync-key');
    await postgres.admin.query(
      `INSERT INTO workspaces (id, name) VALUES ($1, 'JTL Sync'), ($2, 'JTL Cleanup')`,
      [WORKSPACE_ID, CLEANUP_WORKSPACE_ID],
    );
    await postgres.admin.query(
      `INSERT INTO users (id, workspace_id, email, display_name, password_hash, role)
       VALUES ($1, $2, 'sync@example.test', 'Sync', 'hash', 'owner')`,
      [USER_ID, WORKSPACE_ID],
    );
    db = postgres.createApplicationDb();
  });

  afterAll(async () => {
    if (db) await db.destroy();
    if (postgres) await postgres.stop();
  });

  // F-A10-01: the sync upserted on source_sqlite_id = kKunde/kArtikel, but
  // migrated rows carry their desktop ids there. A local customer whose desktop
  // id equalled a kKunde was overwritten with foreign JTL data, and a product
  // collision ended in a SKU violation that rolled back every sync.
  test('a colliding desktop id no longer overwrites a foreign customer or product', async () => {
    await postgres.admin.query(
      `INSERT INTO customers (workspace_id, source_sqlite_id, jtl_kkunde, name, email) VALUES
        ($1, 42, NULL, 'Mueller', 'mueller@example.test'),
        ($1, 43, NULL, 'Lokal 43', NULL),
        ($1, 97, 42, 'Schmidt', 'alt@example.test')`,
      [WORKSPACE_ID],
    );
    await postgres.admin.query(
      `INSERT INTO products (workspace_id, source_sqlite_id, jtl_kartikel, name, sku, price) VALUES
        ($1, 7, 123, 'Alt', 'SKU-1', 5),
        ($1, 123, NULL, 'Lokal', 'LOCAL-123', 1)`,
      [WORKSPACE_ID],
    );
    const port = createJtlSyncPort({
      reader: {
        fetchAll: async () => source({
          customers: [
            { kKunde: 42, AddressLastName: 'Schmidt', AddressEmail: 'schmidt@jtl.example' },
            { kKunde: 43, AddressLastName: 'Neu 43' },
            { kKunde: 500, AddressLastName: 'Neu 500' },
          ],
          products: [{ kArtikel: 123, Sku: 'SKU-1', Name: 'Neu', PriceNet: 10 }],
        }),
      },
      store: createPostgresJtlSyncStore({ db }),
    });

    const result = await port.run({ workspaceId: WORKSPACE_ID, actorUserId: USER_ID });
    expect(result).toMatchObject({ success: true });
    // A second run must update in place and not create duplicates.
    expect(await port.run({ workspaceId: WORKSPACE_ID, actorUserId: USER_ID })).toMatchObject({ success: true });

    const customers = await postgres.admin.query<{ source_sqlite_id: string; jtl_kkunde: string | null; name: string; email: string | null }>(
      `SELECT source_sqlite_id::text, jtl_kkunde::text, name, email
         FROM customers WHERE workspace_id = $1 ORDER BY customers.jtl_kkunde NULLS FIRST, customers.source_sqlite_id`,
      [WORKSPACE_ID],
    );
    expect(customers.rows).toEqual([
      { source_sqlite_id: '42', jtl_kkunde: null, name: 'Mueller', email: 'mueller@example.test' },
      { source_sqlite_id: '43', jtl_kkunde: null, name: 'Lokal 43', email: null },
      { source_sqlite_id: '97', jtl_kkunde: '42', name: 'Schmidt', email: 'schmidt@jtl.example' },
      { source_sqlite_id: expect.stringMatching(/^-\d+$/), jtl_kkunde: '43', name: 'Neu 43', email: null },
      { source_sqlite_id: '500', jtl_kkunde: '500', name: 'Neu 500', email: null },
    ]);

    const products = await postgres.admin.query<{ source_sqlite_id: string; jtl_kartikel: string | null; name: string; sku: string }>(
      `SELECT source_sqlite_id::text, jtl_kartikel::text, name, sku
         FROM products WHERE workspace_id = $1 ORDER BY products.source_sqlite_id`,
      [WORKSPACE_ID],
    );
    expect(products.rows).toEqual([
      { source_sqlite_id: '7', jtl_kartikel: '123', name: 'Neu', sku: 'SKU-1' },
      { source_sqlite_id: '123', jtl_kartikel: null, name: 'Lokal', sku: 'LOCAL-123' },
    ]);
  });

  test('the migration unlinks duplicate JTL keys under FORCE RLS and is idempotent', async () => {
    await postgres.admin.query('DROP INDEX customers_workspace_jtl_kkunde_unique_idx');
    await postgres.admin.query('DROP INDEX products_workspace_jtl_kartikel_unique_idx');
    // State the old sync left behind: the migrated JTL row (desktop id 61) and
    // the row the sync wrote under source_sqlite_id = kKunde share jtl_kkunde 60.
    await postgres.admin.query(
      `INSERT INTO customers (workspace_id, source_sqlite_id, jtl_kkunde, name, source_row) VALUES
        ($1, 60, 60, 'Vom Sync ueberschrieben', '{"kKunde": 60}'::jsonb),
        ($1, 61, 60, 'Migrierter JTL-Kunde', '{"id": 61, "jtl_kKunde": 60}'::jsonb)`,
      [CLEANUP_WORKSPACE_ID],
    );
    await postgres.admin.query(
      `INSERT INTO products (workspace_id, source_sqlite_id, jtl_kartikel, name, sku, price) VALUES
        ($1, 70, 70, 'Vom Sync', 'SYNC-70', 1),
        ($1, 71, 70, 'Migriert', 'MIG-70', 1)`,
      [CLEANUP_WORKSPACE_ID],
    );

    const runMigration = () => db.connection().execute(async (connection) => {
      await sql`BEGIN`.execute(connection);
      for (const statement of jtlKeyUniquenessMigration.upSql) {
        await sql.raw(statement).execute(connection);
      }
      await sql`COMMIT`.execute(connection);
    });
    await runMigration();
    await runMigration();

    const customers = await postgres.admin.query<{ source_sqlite_id: string; jtl_kkunde: string | null; removed: string | null }>(
      `SELECT source_sqlite_id::text, jtl_kkunde::text, source_row->'jtlLinkRemoved'->>'jtlKkunde' AS removed
         FROM customers WHERE workspace_id = $1 ORDER BY customers.source_sqlite_id`,
      [CLEANUP_WORKSPACE_ID],
    );
    expect(customers.rows).toEqual([
      { source_sqlite_id: '60', jtl_kkunde: null, removed: '60' },
      { source_sqlite_id: '61', jtl_kkunde: '60', removed: null },
    ]);
    const products = await postgres.admin.query<{ source_sqlite_id: string; jtl_kartikel: string | null }>(
      `SELECT source_sqlite_id::text, jtl_kartikel::text FROM products WHERE workspace_id = $1 ORDER BY products.source_sqlite_id`,
      [CLEANUP_WORKSPACE_ID],
    );
    expect(products.rows).toEqual([
      { source_sqlite_id: '70', jtl_kartikel: null },
      { source_sqlite_id: '71', jtl_kartikel: '70' },
    ]);
    const indexes = await postgres.admin.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes
        WHERE indexname IN ('customers_workspace_jtl_kkunde_unique_idx', 'products_workspace_jtl_kartikel_unique_idx')
        ORDER BY indexname`,
    );
    expect(indexes.rows.map((row) => row.indexname)).toEqual([
      'customers_workspace_jtl_kkunde_unique_idx',
      'products_workspace_jtl_kartikel_unique_idx',
    ]);
  });
});
