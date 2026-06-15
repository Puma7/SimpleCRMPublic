import {
  encodeOutboundApprovalMarker,
  outboundDraftFingerprint,
  parseOutboundApprovalMarker,
} from '../../packages/core/src/email/outbound-approval-marker';
import { getSyncInfo, setSyncInfo } from '../sqlite-service';
import { extractDraftBodyForOutboundBlock } from './email-outbound-review-parse';
import { getEmailMessageById, setOutboundHold, updateComposeDraft } from './email-store';
import { createTicketCodeForAccount, ensureTicketInSubject, extractKnownTicketFromSubject } from './email-ticket';
import { recipientFieldFromJson } from '../../shared/email-recipient-parse';
import { parseDraftAttachmentPathsJson } from '../../shared/compose-draft-attachments';

export const OUTBOUND_REVIEW_APPROVED_PREFIX = 'outbound_review_approved:';
const OUTBOUND_REVIEW_APPROVED_TTL_MS = 24 * 60 * 60 * 1000;

export function outboundReviewApprovedKey(draftId: number): string {
  return `${OUTBOUND_REVIEW_APPROVED_PREFIX}${draftId}`;
}

export type OutboundDraftFingerprintInput = {
  subject?: string | null;
  bodyText?: string | null;
  bodyHtml?: string | null;
  to?: string | null;
  cc?: string | null;
  bcc?: string | null;
  attachmentPaths?: readonly string[] | null;
};

export function tryOutboundApprovalBypass(
  draftMessageId: number,
  input: OutboundDraftFingerprintInput,
): boolean {
  const raw = getSyncInfo(outboundReviewApprovedKey(draftMessageId));
  if (!raw) return false;

  const parsed = parseOutboundApprovalMarker(raw);
  const now = Date.now();
  const fresh =
    parsed.approvedAt !== null &&
    now - parsed.approvedAt.getTime() < OUTBOUND_REVIEW_APPROVED_TTL_MS;
  const currentFingerprint = outboundDraftFingerprint(input);
  const contentMatches =
    parsed.fingerprint === null || parsed.fingerprint === currentFingerprint;

  if (fresh && contentMatches) return true;

  if (!fresh || !contentMatches) {
    setSyncInfo(outboundReviewApprovedKey(draftMessageId), '');
  }
  return false;
}

export function stampOutboundApprovalMarker(
  draftId: number,
  input: OutboundDraftFingerprintInput,
): void {
  const fingerprint = outboundDraftFingerprint(input);
  setSyncInfo(
    outboundReviewApprovedKey(draftId),
    encodeOutboundApprovalMarker(new Date(), fingerprint),
  );
}

export function clearOutboundApprovalMarker(draftId: number): void {
  setSyncInfo(outboundReviewApprovedKey(draftId), '');
}

export function applyManualComposeOutboundApproval(
  draftId: number,
  input: OutboundDraftFingerprintInput,
): void {
  const draftRow = getEmailMessageById(draftId);
  if (!draftRow) return;

  const cleaned = extractDraftBodyForOutboundBlock(
    {
      body_text: draftRow.body_text ?? null,
      body_html: draftRow.body_html ?? null,
    },
    {
      bodyText: input.bodyText ?? '',
      bodyHtml: input.bodyHtml ?? null,
    },
  );
  const storedSubject = input.subject?.trim() || draftRow.subject?.trim() || '';
  const existingTicket =
    draftRow.ticket_code?.trim() || extractKnownTicketFromSubject(draftRow.subject ?? null);
  const ticketCode = existingTicket || createTicketCodeForAccount(draftRow.account_id);
  const finalSubject = ensureTicketInSubject(storedSubject || '(Ohne Betreff)', ticketCode);

  updateComposeDraft(draftId, {
    subject: finalSubject,
    bodyText: cleaned.plain,
    bodyHtml: cleaned.html || null,
  });
  setOutboundHold(draftId, false, null);

  stampOutboundApprovalMarker(draftId, {
    subject: finalSubject,
    bodyText: cleaned.plain,
    bodyHtml: cleaned.html || null,
    to: input.to ?? recipientFieldFromJson(draftRow.to_json),
    cc: (input.cc ?? recipientFieldFromJson(draftRow.cc_json)) || null,
    bcc: (input.bcc ?? recipientFieldFromJson(draftRow.bcc_json)) || null,
    attachmentPaths: input.attachmentPaths
      ?? parseDraftAttachmentPathsJson(draftRow.draft_attachment_paths_json),
  });
}
