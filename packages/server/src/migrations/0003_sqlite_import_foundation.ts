import type { SqlMigration } from './types';

export const sqliteImportFoundationMigration: SqlMigration = {
  id: '0003_sqlite_import_foundation',
  description: 'Server edition SQLite import foundation: resumable import runs and table checkpoints.',
  upSql: [
    `CREATE TABLE IF NOT EXISTS sqlite_import_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  plan_id text NOT NULL,
  source_fingerprint text NOT NULL,
  status text NOT NULL CHECK (status IN ('running', 'succeeded', 'failed', 'dry_run')),
  dry_run boolean NOT NULL DEFAULT false,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  error text,
  UNIQUE (workspace_id, plan_id, source_fingerprint, dry_run)
);`,
    'CREATE INDEX IF NOT EXISTS sqlite_import_runs_workspace_started_idx ON sqlite_import_runs (workspace_id, started_at DESC);',
    `CREATE TABLE IF NOT EXISTS sqlite_import_table_checkpoints (
  run_id uuid NOT NULL REFERENCES sqlite_import_runs(id) ON DELETE CASCADE,
  table_name text NOT NULL,
  source_row_count integer NOT NULL DEFAULT 0,
  copied_row_count integer NOT NULL DEFAULT 0,
  last_source_pk text,
  checksum text,
  status text NOT NULL CHECK (status IN ('pending', 'running', 'succeeded', 'failed', 'skipped', 'dry_run')),
  error text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, table_name)
);`,
    'CREATE INDEX IF NOT EXISTS sqlite_import_table_checkpoints_status_idx ON sqlite_import_table_checkpoints (status, updated_at DESC);',
    `ALTER TABLE sqlite_import_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE sqlite_import_table_checkpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE sqlite_import_runs FORCE ROW LEVEL SECURITY;
ALTER TABLE sqlite_import_table_checkpoints FORCE ROW LEVEL SECURITY;`,
    `CREATE POLICY sqlite_import_runs_workspace_isolation ON sqlite_import_runs
  USING (app.can_access_workspace(workspace_id))
  WITH CHECK (app.can_access_workspace(workspace_id));`,
    `CREATE POLICY sqlite_import_table_checkpoints_workspace_isolation ON sqlite_import_table_checkpoints
  USING (EXISTS (
    SELECT 1
    FROM sqlite_import_runs r
    WHERE r.id = run_id
      AND app.can_access_workspace(r.workspace_id)
  ))
  WITH CHECK (EXISTS (
    SELECT 1
    FROM sqlite_import_runs r
    WHERE r.id = run_id
      AND app.can_access_workspace(r.workspace_id)
  ));`,
  ],
  downSql: [
    'DROP POLICY IF EXISTS sqlite_import_table_checkpoints_workspace_isolation ON sqlite_import_table_checkpoints;',
    'DROP POLICY IF EXISTS sqlite_import_runs_workspace_isolation ON sqlite_import_runs;',
    'DROP TABLE IF EXISTS sqlite_import_table_checkpoints;',
    'DROP TABLE IF EXISTS sqlite_import_runs;',
  ],
};
