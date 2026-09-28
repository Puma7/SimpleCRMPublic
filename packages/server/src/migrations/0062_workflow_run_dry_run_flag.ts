import type { SqlMigration } from './types';

/**
 * Testläufe („Testlauf“ im Workflow-Editor) werden mit ihren Schritten
 * gespeichert und als Test gekennzeichnet. Statistiken, Diagnose und die
 * Ausgangsprüfung zählen sie nicht; die Aufbewahrung löscht sie nach
 * 30 Tagen (Teilindex nur über Testläufe).
 */
export const workflowRunDryRunFlagMigration: SqlMigration = {
  id: '0062_workflow_run_dry_run_flag',
  description: 'Flag stored workflow test runs (dry_run) and index them for retention',
  upSql: [
    'ALTER TABLE email_workflow_runs ADD COLUMN IF NOT EXISTS dry_run boolean NOT NULL DEFAULT false;',
    `CREATE INDEX IF NOT EXISTS email_workflow_runs_dry_run_idx
      ON email_workflow_runs (workspace_id, started_at)
      WHERE dry_run;`,
  ],
  downSql: [
    'DROP INDEX IF EXISTS email_workflow_runs_dry_run_idx;',
    'ALTER TABLE email_workflow_runs DROP COLUMN IF EXISTS dry_run;',
  ],
};
