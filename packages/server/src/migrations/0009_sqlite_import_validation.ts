import type { SqlMigration } from './types';

export const sqliteImportValidationMigration: SqlMigration = {
  id: '0009_sqlite_import_validation',
  description: 'Server edition SQLite import validation: row hashes for staged source rows.',
  upSql: [
    'ALTER TABLE sqlite_import_rows ADD COLUMN IF NOT EXISTS source_row_sha256 text;',
    'CREATE INDEX IF NOT EXISTS sqlite_import_rows_validation_idx ON sqlite_import_rows (workspace_id, table_name, imported_in_run_id, source_pk);',
  ],
  downSql: [
    'DROP INDEX IF EXISTS sqlite_import_rows_validation_idx;',
    'ALTER TABLE sqlite_import_rows DROP COLUMN IF EXISTS source_row_sha256;',
  ],
};
