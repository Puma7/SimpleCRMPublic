import { runPostgresCoreCrmImport } from '../../packages/server/src/db/postgres-core-crm-import';
import { runPostgresSqliteFinalImport } from '../../packages/server/src/db/postgres-sqlite-final-import';
import { startMigratedEmbeddedPostgres, type EmbeddedPostgres } from './helpers/embedded-postgres';

jest.mock('kysely', () => jest.requireActual('../../packages/server/node_modules/kysely'));

jest.setTimeout(120_000);

const WORKSPACE_ID = '10000000-0000-4000-8000-0000000000e1';
const RUN_ID = '30000000-0000-4000-8000-0000000000e1';
const QUANTITY_WORKSPACE_ID = '10000000-0000-4000-8000-0000000000e2';
const QUANTITY_RUN_ID = '30000000-0000-4000-8000-0000000000e2';
const ROLLBACK_WORKSPACE_ID = '10000000-0000-4000-8000-0000000000e3';
const ROLLBACK_RUN_ID = '30000000-0000-4000-8000-0000000000e3';

type StagedRow = { table: string; sourcePk: string; row: Record<string, unknown> };

// F-A10-06: the desktop stores custom field options as free text, but the
// importer cast them with ::jsonb, so a typed list like 'Rot, Gruen, Blau'
// aborted the final import after customers/deals were already committed.
describe('PostgreSQL core CRM import robustness', () => {
  let postgres: EmbeddedPostgres;

  beforeAll(async () => {
    postgres = await startMigratedEmbeddedPostgres('core-crm-import');
    await postgres.admin.query(`INSERT INTO workspaces (id, name) VALUES ($1, 'Import Robustness')`, [WORKSPACE_ID]);
    await postgres.admin.query(
      `INSERT INTO sqlite_import_runs (id, workspace_id, plan_id, source_fingerprint, status)
       VALUES ($1, $2, 'import-robustness', 'import-robustness', 'running')`,
      [RUN_ID, WORKSPACE_ID],
    );
  });

  afterAll(async () => {
    if (postgres) await postgres.stop();
  });

  async function stageRun(workspaceId: string, runId: string, stagedRows: readonly StagedRow[]): Promise<void> {
    await postgres.admin.query(`INSERT INTO workspaces (id, name) VALUES ($1, 'Import Robustness')`, [workspaceId]);
    await postgres.admin.query(
      `INSERT INTO sqlite_import_runs (id, workspace_id, plan_id, source_fingerprint, status)
       VALUES ($1, $2, 'import-robustness', $3, 'running')`,
      [runId, workspaceId, `fingerprint-${runId}`],
    );
    for (const staged of stagedRows) {
      await postgres.admin.query(
        `INSERT INTO sqlite_import_rows (
          workspace_id, table_name, source_pk, source_row, source_row_sha256, imported_in_run_id
        ) VALUES ($1, $2, $3, $4::jsonb, $5, $6)`,
        [workspaceId, staged.table, staged.sourcePk, JSON.stringify(staged.row), `sha-${staged.table}-${staged.sourcePk}`, runId],
      );
    }
  }

  // F-A10-06: Deal-Mengen mit Nachkommastellen (Desktop speichert REAL) brachen den Import mit '::integer' ab.
  test('rounds fractional deal quantities and records the original value in source_row', async () => {
    await stageRun(QUANTITY_WORKSPACE_ID, QUANTITY_RUN_ID, [
      { table: 'customers', sourcePk: '1', row: { id: 1, name: 'Ada' } },
      { table: 'products', sourcePk: '1', row: { id: 1, name: 'Schraube', price: 1.5 } },
      { table: 'products', sourcePk: '2', row: { id: 2, name: 'Mutter', price: 0.5 } },
      { table: 'products', sourcePk: '3', row: { id: 3, name: 'Kabel', price: 2 } },
      { table: 'deals', sourcePk: '1', row: { id: 1, customer_id: 1, name: 'Deal', stage: 'Angebot', value: 10 } },
      { table: 'deal_products', sourcePk: '40', row: { id: 40, deal_id: 1, product_id: 1, quantity: 2.5, price_at_time_of_adding: 1.5 } },
      { table: 'deal_products', sourcePk: '41', row: { id: 41, deal_id: 1, product_id: 2, quantity: 3, price_at_time_of_adding: 0.5 } },
      { table: 'deal_products', sourcePk: '42', row: { id: 42, deal_id: 1, product_id: 3, quantity: 0.4, price_at_time_of_adding: 2 } },
    ]);

    await runPostgresSqliteFinalImport(postgres.admin, {
      workspaceId: QUANTITY_WORKSPACE_ID,
      runId: QUANTITY_RUN_ID,
      domains: ['core_crm'],
    });

    const rows = await postgres.admin.query<{ source_sqlite_id: string; quantity: number; rounded_from: unknown }>(
      `SELECT source_sqlite_id::text, quantity, source_row->'quantityRoundedFrom' AS rounded_from
       FROM deal_products WHERE workspace_id = $1 ORDER BY source_sqlite_id`,
      [QUANTITY_WORKSPACE_ID],
    );
    expect(rows.rows).toEqual([
      { source_sqlite_id: '40', quantity: 3, rounded_from: 2.5 },
      { source_sqlite_id: '41', quantity: 3, rounded_from: null },
      { source_sqlite_id: '42', quantity: 1, rounded_from: 0.4 },
    ]);
  });

  // F-A10-06: Ohne Transaktion blieb nach einem Fehler ein halb importierter Workspace zurueck.
  test('rolls back the whole domain when one of its tables fails', async () => {
    await stageRun(ROLLBACK_WORKSPACE_ID, ROLLBACK_RUN_ID, [
      { table: 'customers', sourcePk: '1', row: { id: 1, name: 'Ada' } },
      { table: 'deals', sourcePk: '1', row: { id: 1, customer_id: 1, name: 'Deal', stage: 'Angebot', value: 'viel' } },
    ]);

    await expect(runPostgresSqliteFinalImport(postgres.admin, {
      workspaceId: ROLLBACK_WORKSPACE_ID,
      runId: ROLLBACK_RUN_ID,
      domains: ['core_crm'],
    })).rejects.toThrow();

    const customers = await postgres.admin.query(
      `SELECT id FROM customers WHERE workspace_id = $1`,
      [ROLLBACK_WORKSPACE_ID],
    );
    expect(customers.rows).toEqual([]);
    // The connection is usable again (no aborted transaction left open).
    await expect(postgres.admin.query('SELECT 1 AS ok')).resolves.toMatchObject({ rows: [{ ok: 1 }] });
  });

  test('keeps non-JSON custom field options as a JSON string instead of aborting', async () => {
    const stagedRows = [
      { table: 'customers', sourcePk: '1', row: { id: 1, name: 'Ada' } },
      { table: 'customer_custom_fields', sourcePk: '20', row: { id: 20, name: 'farbe', label: 'Farbe', type: 'select', options: 'Rot, Gruen, Blau' } },
      { table: 'customer_custom_fields', sourcePk: '21', row: { id: 21, name: 'stufe', label: 'Stufe', type: 'select', options: '[{"value":"a","label":"A"}]' } },
      { table: 'customer_custom_field_values', sourcePk: '30', row: { id: 30, customer_id: 1, field_id: 20, value: 'Rot' } },
    ];
    for (const staged of stagedRows) {
      await postgres.admin.query(
        `INSERT INTO sqlite_import_rows (
          workspace_id, table_name, source_pk, source_row, source_row_sha256, imported_in_run_id
        ) VALUES ($1, $2, $3, $4::jsonb, $5, $6)`,
        [WORKSPACE_ID, staged.table, staged.sourcePk, JSON.stringify(staged.row), `sha-${staged.table}-${staged.sourcePk}`, RUN_ID],
      );
    }

    await runPostgresCoreCrmImport(postgres.admin, { workspaceId: WORKSPACE_ID, runId: RUN_ID });

    const fields = await postgres.admin.query<{ source_sqlite_id: string; options: unknown }>(
      `SELECT source_sqlite_id::text, options FROM customer_custom_fields WHERE workspace_id = $1 ORDER BY source_sqlite_id`,
      [WORKSPACE_ID],
    );
    expect(fields.rows).toEqual([
      { source_sqlite_id: '20', options: 'Rot, Gruen, Blau' },
      { source_sqlite_id: '21', options: [{ value: 'a', label: 'A' }] },
    ]);
    const values = await postgres.admin.query<{ value: string }>(
      `SELECT value FROM customer_custom_field_values WHERE workspace_id = $1`,
      [WORKSPACE_ID],
    );
    expect(values.rows).toEqual([{ value: 'Rot' }]);
  });
});
