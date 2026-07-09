import { extractDraftBodyForOutboundBlock } from '../email/email-outbound-review-parse';
import {
  getEmailMessageById,
  setOutboundHold,
  updateComposeDraft,
} from '../email/email-store';
import { setDraftScheduledSendAt } from '../email/email-message-features';
import { stampOutboundApprovalMarker } from '../email/outbound-approval';
import { createTicketCodeForAccount, ensureTicketInSubject, extractKnownTicketFromSubject } from '../email/email-ticket';
import { recipientFieldFromJson } from '../../shared/email-recipient-parse';
import { parseDraftAttachmentPathsJson } from '../../shared/compose-draft-attachments';
import { getDb } from '../sqlite-service';
import { EMAIL_MESSAGES_TABLE } from '../database-schema';

export type PrepareDraftSendResult =
  | { ok: true; finalSubject: string; cleanedBodyText: string; cleanedBodyHtml: string | null }
  | { ok: false; message: string };

function draftFingerprintFields(
  draftId: number,
  finalSubject: string,
  cleanedBodyText: string,
  cleanedBodyHtml: string | null,
) {
  const draftRow = getEmailMessageById(draftId);
  if (!draftRow) return null;
  return {
    subject: finalSubject,
    bodyText: cleanedBodyText,
    bodyHtml: cleanedBodyHtml,
    to: recipientFieldFromJson(draftRow.to_json),
    cc: recipientFieldFromJson(draftRow.cc_json) || null,
    bcc: recipientFieldFromJson(draftRow.bcc_json) || null,
    attachmentPaths: parseDraftAttachmentPathsJson(draftRow.draft_attachment_paths_json),
  };
}

/** Prepare a draft for scheduled send; optionally stamp outbound-review bypass marker. */
export function prepareDraftForWorkflowSend(
  draftId: number,
  opts: { runOutboundReview: boolean; dryRun?: boolean },
): PrepareDraftSendResult {
  const draftRow = getEmailMessageById(draftId);
  if (!draftRow) return { ok: false, message: `Entwurf ${draftId} nicht gefunden` };
  if (draftRow.folder_kind !== 'draft' || draftRow.uid >= 0) {
    return { ok: false, message: `Nachricht ${draftId} ist kein Entwurf` };
  }

  const cleaned = extractDraftBodyForOutboundBlock({
    body_text: draftRow.body_text ?? null,
    body_html: draftRow.body_html ?? null,
  });
  const storedSubject = draftRow.subject?.trim() || '';
  const existingTicket =
    draftRow.ticket_code?.trim() || extractKnownTicketFromSubject(draftRow.subject ?? null);
  const ticketCode = existingTicket || createTicketCodeForAccount(draftRow.account_id);
  const finalSubject = ensureTicketInSubject(storedSubject || '(Ohne Betreff)', ticketCode);

  if (opts.dryRun) {
    return {
      ok: true,
      finalSubject,
      cleanedBodyText: cleaned.plain,
      cleanedBodyHtml: cleaned.html || null,
    };
  }

  updateComposeDraft(draftId, {
    subject: finalSubject,
    bodyText: cleaned.plain,
    bodyHtml: cleaned.html || null,
  });
  getDb()
    .prepare(`UPDATE ${EMAIL_MESSAGES_TABLE} SET ticket_code = ?, outbound_hold = 0, outbound_block_reason = NULL WHERE id = ?`)
    .run(ticketCode, draftId);
  setDraftScheduledSendAt(draftId, new Date().toISOString());

  if (!opts.runOutboundReview) {
    const fp = draftFingerprintFields(draftId, finalSubject, cleaned.plain, cleaned.html || null);
    if (fp) stampOutboundApprovalMarker(draftId, fp);
  }

  return {
    ok: true,
    finalSubject,
    cleanedBodyText: cleaned.plain,
    cleanedBodyHtml: cleaned.html || null,
  };
}

/** Release outbound hold on current outbound draft (outbound-quality-check template). */
export function releaseOutboundHoldForDraft(
  messageId: number,
  autoSend: boolean,
  dryRun: boolean,
): { ok: true; autoSendScheduled: boolean } | { ok: false; message: string } {
  if (!autoSend) {
    if (!dryRun) setOutboundHold(messageId, false, null);
    return { ok: true, autoSendScheduled: false };
  }
  const prep = prepareDraftForWorkflowSend(messageId, { runOutboundReview: false, dryRun });
  if (!prep.ok) return prep;
  return { ok: true, autoSendScheduled: !dryRun };
}
