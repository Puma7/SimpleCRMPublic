import type { SqlMigration } from './types';

export const sqliteImportStagingMigration: SqlMigration = {
  id: '0004_sqlite_import_staging',
  description: 'Server edition SQLite import staging: lossless JSONB row preservation before domain mapping.',
  upSql: [
    `CREATE TABLE IF NOT EXISTS sqlite_import_rows (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  table_name text NOT NULL,
  source_pk text NOT NULL,
  source_row jsonb NOT NULL,
  source_row_sha256 text NOT NULL,
  imported_in_run_id uuid NOT NULL REFERENCES sqlite_import_runs(id) ON DELETE CASCADE,
  imported_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, table_name, source_pk)
);`,
    'CREATE INDEX IF NOT EXISTS sqlite_import_rows_run_idx ON sqlite_import_rows (imported_in_run_id);',
    'CREATE INDEX IF NOT EXISTS sqlite_import_rows_table_idx ON sqlite_import_rows (workspace_id, table_name);',
    `ALTER TABLE sqlite_import_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE sqlite_import_rows FORCE ROW LEVEL SECURITY;`,
    `CREATE POLICY sqlite_import_rows_workspace_isolation ON sqlite_import_rows
  USING (app.can_access_workspace(workspace_id))
  WITH CHECK (app.can_access_workspace(workspace_id));`,
  ],
  downSql: [
    'DROP POLICY IF EXISTS sqlite_import_rows_workspace_isolation ON sqlite_import_rows;',
    'DROP TABLE IF EXISTS sqlite_import_rows;',
  ],
};
