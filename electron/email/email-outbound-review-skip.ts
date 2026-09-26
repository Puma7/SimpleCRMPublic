/**
 * „Ohne Ausgangsprüfung senden“ (Teilautomatisierung P2, Desktop): Ein vom
 * Ausgang angehaltener Entwurf geht ohne erneuten Durchlauf der Ausgangs-
 * Workflows raus. Die Freigabe gilt nur dem aktuellen Inhalt (Freigabe-Marker
 * mit Fingerprint, wie „Ausgang prüfen“); gesendet wird über den normalen
 * Sendepfad, der den Marker erkennt. Rolle laut Einstellung wird hier im
 * Main-Prozess durchgesetzt, der Kontozugriff (rw) von registerIpcHandler.
 */
import { AUTH_AUDIT_LOG_TABLE, EMAIL_MESSAGES_TABLE } from '../database-schema';
import { getDb, getSyncInfo, setSyncInfo } from '../sqlite-service';
import { logAuthAction } from '../auth/audit-log';
import { getEmailMessageById } from './email-store';
import { applyManualComposeOutboundApproval, outboundReviewApprovedKey } from './outbound-approval';
import { clearScheduledSendActor } from './email-scheduled-send-actor';
import { sendComposeDraft, type ComposeSendActor } from './email-compose-send';
import { recipientFieldFromJson } from '../../shared/email-recipient-parse';
import { parseDraftAttachmentPathsJson } from '../../shared/compose-draft-attachments';
import {
  OUTBOUND_REVIEW_SKIP_CHANGED_MESSAGE,
  OUTBOUND_REVIEW_SKIP_FORBIDDEN_MESSAGE,
  OUTBOUND_REVIEW_SKIP_NOT_HELD_MESSAGE,
  outboundReviewSkipAllowedForRole,
  outboundReviewSkippedKey,
} from '../../packages/core/src/email/outbound-review-skip';
import { loadOutboundReviewSkipPolicy } from './outbound-review-skip-settings';
import {
  clearOutboundHoldFingerprints,
  currentOutboundHoldFingerprint,
  readOutboundHoldFingerprint,
} from './outbound-hold-fingerprint';

export type OutboundReviewSkipSendResult =
  | { success: true; warning?: string; recoveredSentAppend?: true }
  | { success: false; error: string; workflowRunId?: number | null };

function hasAuditLogTable(): boolean {
  return Boolean(
    getDb()
      .prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`)
      .get(AUTH_AUDIT_LOG_TABLE),
  );
}

export async function sendDraftSkippingOutboundReview(
  draftId: number,
  actor: ComposeSendActor,
): Promise<OutboundReviewSkipSendResult> {
  if (!outboundReviewSkipAllowedForRole(loadOutboundReviewSkipPolicy(), actor.role)) {
    return { success: false, error: OUTBOUND_REVIEW_SKIP_FORBIDDEN_MESSAGE };
  }
  // Prüfen und Freigeben in einer Transaktion: zwischen dem Vergleich mit dem
  // angehaltenen Inhalt und der Freigabe kann nichts dazwischenschreiben.
  const prepared = getDb().transaction(() => {
    const draft = getEmailMessageById(draftId);
    if (!draft || draft.uid >= 0 || draft.folder_kind !== 'draft' || (draft.soft_deleted ?? 0) > 0) {
      return { ok: false as const, error: 'Entwurf nicht gefunden' };
    }
    if ((draft.outbound_hold ?? 0) <= 0) {
      return { ok: false as const, error: OUTBOUND_REVIEW_SKIP_NOT_HELD_MESSAGE };
    }
    // Nur der unveränderte, angehaltene Inhalt: bearbeitet oder Altbestand ohne
    // Fingerprint ⇒ normal senden, dann prüft der Ausgang den neuen Inhalt.
    const heldFingerprint = readOutboundHoldFingerprint(draftId);
    if (!heldFingerprint || heldFingerprint !== currentOutboundHoldFingerprint(draftId)) {
      return { ok: false as const, error: OUTBOUND_REVIEW_SKIP_CHANGED_MESSAGE };
    }

    const to = recipientFieldFromJson(draft.to_json);
    const cc = recipientFieldFromJson(draft.cc_json);
    const bcc = recipientFieldFromJson(draft.bcc_json);
    const attachmentPaths = parseDraftAttachmentPathsJson(draft.draft_attachment_paths_json);
    // Entfernt den Banner, setzt den Betreff mit Ticket, hebt die Sperre auf und
    // stempelt den Freigabe-Marker für genau diesen Inhalt.
    applyManualComposeOutboundApproval(draftId, {
      subject: draft.subject ?? '',
      bodyText: draft.body_text ?? '',
      bodyHtml: draft.body_html ?? null,
      to,
      cc: cc || null,
      bcc: bcc || null,
      attachmentPaths,
    });
    // updateComposeDraft löscht den RFC-3834-Marker bei jedem Inhaltsschreiben.
    // Das Entfernen des Banners ist keine inhaltliche Änderung: eine automatische
    // Antwort bleibt als solche gekennzeichnet (wie auf dem Server).
    getDb()
      .prepare(
        `UPDATE ${EMAIL_MESSAGES_TABLE} SET auto_submitted = ?, scheduled_send_at = NULL WHERE id = ?`,
      )
      .run(draft.auto_submitted === 1 ? 1 : 0, draftId);
    clearScheduledSendActor(draftId);
    clearOutboundHoldFingerprints(draftId);
    // Übersprung-Marker = aktueller Freigabe-Marker; eine spätere Änderung am
    // Entwurf entwertet den Freigabe-Marker und damit auch diese Kennzeichnung.
    setSyncInfo(outboundReviewSkippedKey(draftId), getSyncInfo(outboundReviewApprovedKey(draftId)) ?? '');
    return { ok: true as const, draft, to, cc, bcc, attachmentPaths };
  })();
  if (!prepared.ok) return { success: false, error: prepared.error };
  const { draft, to, cc, bcc, attachmentPaths } = prepared;
  if (hasAuditLogTable()) {
    logAuthAction(getDb(), {
      userId: actor.userId,
      action: 'email.outbound_review_skipped',
      resourceType: 'email_message',
      resourceId: String(draftId),
      detail: { accountId: draft.account_id },
    });
  }

  const approved = getEmailMessageById(draftId);
  if (!approved) return { success: false, error: 'Entwurf nicht gefunden' };
  const replyParent = (approved as { reply_parent_message_id?: number | null }).reply_parent_message_id;
  const result = await sendComposeDraft({
    accountId: approved.account_id,
    draftMessageId: draftId,
    subject: approved.subject ?? '(Ohne Betreff)',
    bodyText: approved.body_text ?? '',
    bodyHtml: approved.body_html,
    to,
    cc: cc || undefined,
    bcc: bcc || undefined,
    attachmentPaths: attachmentPaths.length > 0 ? attachmentPaths : undefined,
    inReplyToMessageId: replyParent ?? undefined,
    actor,
  });
  if (result.ok) {
    if (result.warning) return { success: true, warning: result.warning };
    if (result.recoveredSentAppend) return { success: true, recoveredSentAppend: true };
    return { success: true };
  }
  return {
    success: false,
    error: result.error,
    workflowRunId: 'workflowRunId' in result ? result.workflowRunId ?? null : null,
  };
}
