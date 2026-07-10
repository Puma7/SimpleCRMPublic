/**
 * Neutraler "Wartet auf Freigabe"-Zustand für KI-Entwürfe.
 *
 * Bewusst GETRENNT vom fail-closed `outbound_hold` (rotes Banner
 * "Versand blockiert"): Freigabe ist kein Fehlerzustand, sondern der
 * gewollte Mensch-Prüft-Pfad der Zwei-Stufen-KI-Antwort. Die Gegenlese-KI
 * (ai.review_draft) setzt 'pending'; der Mensch entscheidet im Postfach
 * ("Jetzt senden" / "Als Entwurf behalten"). Manuelles Senden oder
 * Bearbeiten löscht den Zustand.
 */
import { getDb } from '../sqlite-service';
import { EMAIL_MESSAGES_TABLE } from '../database-schema';

export type DraftApprovalState = 'pending' | null;

export function setDraftApprovalPending(messageId: number, reason: string): void {
  getDb()
    .prepare(
      `UPDATE ${EMAIL_MESSAGES_TABLE}
       SET approval_state = 'pending', approval_reason = ?
       WHERE id = ?`,
    )
    .run(reason.slice(0, 500), messageId);
}

export function clearDraftApproval(messageId: number): void {
  getDb()
    .prepare(
      `UPDATE ${EMAIL_MESSAGES_TABLE}
       SET approval_state = NULL, approval_reason = NULL
       WHERE id = ?`,
    )
    .run(messageId);
}

export function getDraftApproval(
  messageId: number,
): { state: DraftApprovalState; reason: string | null } {
  const row = getDb()
    .prepare(`SELECT approval_state, approval_reason FROM ${EMAIL_MESSAGES_TABLE} WHERE id = ?`)
    .get(messageId) as { approval_state: string | null; approval_reason: string | null } | undefined;
  return {
    state: row?.approval_state === 'pending' ? 'pending' : null,
    reason: row?.approval_reason ?? null,
  };
}

/** RFC-3834-Marker: dieser Entwurf ist eine automatische Antwort. */
export function markDraftAutoSubmitted(messageId: number): void {
  getDb()
    .prepare(`UPDATE ${EMAIL_MESSAGES_TABLE} SET auto_submitted = 1 WHERE id = ?`)
    .run(messageId);
}

export function isDraftAutoSubmitted(messageId: number): boolean {
  const row = getDb()
    .prepare(`SELECT auto_submitted FROM ${EMAIL_MESSAGES_TABLE} WHERE id = ?`)
    .get(messageId) as { auto_submitted: number } | undefined;
  return row?.auto_submitted === 1;
}
