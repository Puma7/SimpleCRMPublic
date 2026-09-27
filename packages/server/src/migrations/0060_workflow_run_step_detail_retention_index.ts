import type { SqlMigration } from './types';

/**
 * Lauf-Historie: Eingang/Ausgang je Schritt (detail_json) wird nach 30 Tagen
 * geleert (workflow-run-step-append.ts, täglich im audit.retention-Job je
 * Workspace). Ohne passenden Index müsste Postgres dafür die ganze
 * Schritt-Historie des Workspace lesen. Der Teilindex enthält nur Schritte mit
 * Details; geleerte Schritte fallen heraus, er bleibt also klein.
 */
export const workflowRunStepDetailRetentionIndexMigration: SqlMigration = {
  id: '0060_workflow_run_step_detail_retention_index',
  description: 'Partial index so the daily run-step detail retention only reads steps that still carry details',
  upSql: [
    `CREATE INDEX IF NOT EXISTS email_workflow_run_steps_detail_retention_idx
      ON email_workflow_run_steps (workspace_id, created_at)
      WHERE detail_json IS NOT NULL;`,
  ],
  downSql: [
    'DROP INDEX IF EXISTS email_workflow_run_steps_detail_retention_idx;',
  ],
};
