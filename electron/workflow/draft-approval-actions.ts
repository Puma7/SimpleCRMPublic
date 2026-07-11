/**
 * Menschliche Entscheidung über "Wartet auf Freigabe"-Entwürfe der
 * Zwei-Stufen-KI-Antwort (gesetzt von ai.review_draft). Von den
 * IPC-Handlern (electron/ipc/workflow.ts) aufgerufen; als eigenes Modul,
 * damit die Guards testbar sind.
 */
import {
  clearDraftApproval,
  clearDraftAutoSubmitted,
  markDraftAutoSubmitted,
} from '../email/email-draft-approval';
import { getEmailMessageById } from '../email/email-store';
import { markAutoReplySent } from './auto-reply-guard';
import { prepareDraftForWorkflowSend } from './draft-send-prep';
import { recipientFieldFromJson } from '../../shared/email-recipient-parse';

export type DraftApprovalActionResult =
  | { success: true }
  | { success: false; error: string };

/** "Jetzt senden": plant den freigegebenen KI-Entwurf zum Versand ein. */
export function approveDraftSend(draftId: number): DraftApprovalActionResult {
  // Erst den LIVE-Zustand prüfen: ein staler zweiter View (Entwurf wurde
  // inzwischen bearbeitet oder "Als Entwurf behalten" gewählt — beides
  // cleart die Freigabe) darf nicht mehr mit runOutboundReview=false an der
  // Ausgangsprüfung vorbei einplanen.
  const draft = getEmailMessageById(draftId);
  if (!draft) return { success: false, error: 'Entwurf nicht gefunden' };
  if (draft.approval_state !== 'pending') {
    return {
      success: false,
      error: 'Entwurf wartet nicht (mehr) auf Freigabe — bitte Ansicht aktualisieren.',
    };
  }

  // Erst einplanen, dann Freigabe-Zustand löschen: schlägt das Einplanen
  // fehl, bleiben Banner und KI-Begründung erhalten (nichts wurde gesendet).
  const prep = prepareDraftForWorkflowSend(draftId, { runOutboundReview: false });
  if (!prep.ok) return { success: false, error: prep.message };
  // Antwort stammt aus der automatischen Pipeline → RFC-3834-Marker NACH
  // prep stempeln (prep normalisiert per updateComposeDraft und setzt
  // auto_submitted dabei zurück) — wie email.send_draft.
  markDraftAutoSubmitted(draftId);
  // Auch die menschlich freigegebene Antwort verbraucht das Tagesbudget des
  // Empfängers: der Mensch wird nie blockiert, aber nachfolgende
  // AUTOMATISCHE Antworten respektieren das Limit.
  const recipient = recipientFieldFromJson(draft.to_json).split(',')[0]?.trim() ?? '';
  if (recipient) {
    markAutoReplySent(draft.account_id, recipient, draft.reply_parent_message_id ?? null);
  }
  clearDraftApproval(draftId);
  return { success: true };
}

/** "Als Entwurf behalten": Mensch übernimmt — kein Auto-Versand. */
export function dismissDraftApproval(draftId: number): DraftApprovalActionResult {
  clearDraftApproval(draftId);
  // Ein späterer manueller Versand ist keine automatische Antwort mehr.
  clearDraftAutoSubmitted(draftId);
  return { success: true };
}
