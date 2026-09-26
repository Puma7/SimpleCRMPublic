import type { SqlMigration } from './types';

/**
 * Zeitplan-Workflows auf dem Server: welcher Zeitpunkt wurde zuletzt ausgeloest?
 *
 * Der Server-Taktgeber (jobs/workflow-schedule-tick.ts) prueft je Minute und
 * Workspace, welcher faellige Zeitpunkt eines aktiven Zeitplan-Workflows
 * zuletzt vor „jetzt" lag. Ausgeloest wird nur, wer diesen Zeitpunkt per
 * bedingtem UPDATE (`schedule_last_slot_at IS NULL OR < Zeitpunkt`) als Erster
 * in diese Spalte schreibt — so laeuft jeder Zeitpunkt genau einmal, auch wenn
 * mehrere Server-Prozesse gleichzeitig takten.
 *
 * Beim Anlegen, Aktivieren und Aendern des Zeitplans setzt die Workflow-API die
 * Spalte auf den Speicherzeitpunkt: vergangene Zeitpunkte sind damit erledigt
 * und werden nicht nachtraeglich ausgeloest.
 *
 * Kein eigener Index: die Auswahl des Taktgebers (aktive Workflows eines
 * Workspaces mit Ausloeser `schedule`) deckt der bestehende
 * email_workflows_trigger_idx (workspace_id, trigger_name, enabled, priority)
 * aus Migration 0008 bereits ab. RLS bleibt unveraendert: die Spalte gehoert
 * zu email_workflows und erbt deren Policy.
 */
export const emailWorkflowScheduleStateMigration: SqlMigration = {
  id: '0056_email_workflow_schedule_state',
  description: 'Remember the last fired schedule slot per workflow for the server schedule tick',
  upSql: [
    `ALTER TABLE email_workflows
  ADD COLUMN IF NOT EXISTS schedule_last_slot_at timestamptz;`,
  ],
  downSql: [
    'ALTER TABLE email_workflows DROP COLUMN IF EXISTS schedule_last_slot_at;',
  ],
};
