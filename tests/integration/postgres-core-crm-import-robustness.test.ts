import { runPostgresCoreCrmImport } from '../../packages/server/src/db/postgres-core-crm-import';
import { startMigratedEmbeddedPostgres, type EmbeddedPostgres } from './helpers/embedded-postgres';

jest.mock('kysely', () => jest.requireActual('../../packages/server/node_modules/kysely'));

jest.setTimeout(120_000);

const WORKSPACE_ID = '10000000-0000-4000-8000-0000000000e1';
const RUN_ID = '30000000-0000-4000-8000-0000000000e1';

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
