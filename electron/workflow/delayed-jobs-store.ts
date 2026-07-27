import { getDb } from '../sqlite-service';
import { WORKFLOW_DELAYED_JOBS_TABLE } from '../database-schema';

/**
 * Offene Verzögerungs-Jobs eines Workflows für eine Nachricht abbrechen.
 *
 * Gegenstück zu `cancelPendingWorkflowDelayedJobsForMessage` auf dem Server:
 * Stoppt ein späterer Trigger-Zweig die Inbound-Kette (Spam), darf ein zuvor
 * eingeplanter `logic.delay`-Zweig nicht später aufwachen und Folgeaktionen
 * (Entwurf senden, Weiterleitung) ausführen.
 *
 * Eigenes Modul, damit `runtime.ts` das aufrufen kann, ohne einen Importzyklus
 * mit `delayed-jobs.ts` (das `parseGraphDocument` aus `runtime.ts` bezieht) zu
 * erzeugen.
 */
export function cancelPendingDelayedJobsForMessage(
  workflowId: number,
  messageId: number | null | undefined,
): number {
  if (messageId == null) return 0;
  const r = getDb()
    .prepare(
      `UPDATE ${WORKFLOW_DELAYED_JOBS_TABLE}
       SET status = 'cancelled'
       WHERE workflow_id = ? AND message_id = ? AND status IN ('pending', 'running')`,
    )
    .run(workflowId, messageId);
  return r.changes;
}

/** Wie oben, aber ohne SQLite (Unit-Tests) still fehlschlagend. */
export function cancelPendingDelayedJobsForMessageSafe(
  workflowId: number,
  messageId: number | null | undefined,
): void {
  try {
    cancelPendingDelayedJobsForMessage(workflowId, messageId);
  } catch {
    // Kein SQLite verfügbar (Unit-Test) — Abbruch ist best effort.
  }
}
