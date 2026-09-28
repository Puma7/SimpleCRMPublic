import type { SqlMigration } from './types';

/**
 * Automatik-Cockpit (Plan 049): die Auswertung zählt die Antworten der
 * KI-Entscheidung der letzten 30 Tagen je Workspace. Der Teilindex enthält nur
 * ai.decide-Schritte, bleibt also klein.
 */
export const workflowRunStepAiDecideIndexMigration: SqlMigration = {
  id: '0063_workflow_run_step_ai_decide_index',
  description: 'Partial index for the automation cockpit: ai.decide run steps per workspace and time',
  upSql: [
    `CREATE INDEX IF NOT EXISTS email_workflow_run_steps_ai_decide_idx
      ON email_workflow_run_steps (workspace_id, created_at)
      WHERE node_type = 'ai.decide';`,
  ],
  downSql: [
    'DROP INDEX IF EXISTS email_workflow_run_steps_ai_decide_idx;',
  ],
};
