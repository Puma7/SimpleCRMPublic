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

/**
 * RFC-3834-Marker: dieser Entwurf ist eine automatische Antwort.
 * Gelesen wird der Marker direkt von der Message-Row (auto_submitted),
 * z. B. in email-compose-send — hier gibt es bewusst keinen Getter.
 */
export function markDraftAutoSubmitted(messageId: number): void {
  getDb()
    .prepare(`UPDATE ${EMAIL_MESSAGES_TABLE} SET auto_submitted = 1 WHERE id = ?`)
    .run(messageId);
}

/**
 * Marker zurücknehmen: wenn der Mensch sich gegen den Auto-Versand
 * entscheidet ("Als Entwurf behalten"), ist ein späterer manueller Versand
 * keine automatische Antwort mehr und darf den RFC-3834-Header nicht tragen.
 */
export function clearDraftAutoSubmitted(messageId: number): void {
  getDb()
    .prepare(`UPDATE ${EMAIL_MESSAGES_TABLE} SET auto_submitted = 0 WHERE id = ?`)
    .run(messageId);
}
