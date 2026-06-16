import { createHash } from 'node:crypto';

/** Stable content fingerprint for outbound drafts, used by the approval marker
 *  (`outbound_review_approved:<draftId>`) to detect edits between approval and
 *  the actual SMTP send. If the user edits the draft after the workflow
 *  approved it, the hash changes → review.review denies the bypass and the
 *  draft re-enters the outbound review pipeline.
 *
 *  The fingerprint is intentionally narrow: only the fields a recipient would
 *  see. Metadata bookkeeping (updated_at, scheduled_send_at, internal flags)
 *  is excluded so an unrelated touch (e.g. another node flipping outbound_hold)
 *  does NOT invalidate the marker. */
export function outboundDraftFingerprint(input: {
  subject?: string | null;
  bodyText?: string | null;
  bodyHtml?: string | null;
  to?: string | null;
  cc?: string | null;
  bcc?: string | null;
  attachmentPaths?: readonly string[] | null;
}): string {
  const canonical = JSON.stringify({
    subject: (input.subject ?? '').trim(),
    bodyText: input.bodyText ?? '',
    bodyHtml: input.bodyHtml ?? '',
    to: normalizeRecipientList(input.to),
    cc: normalizeRecipientList(input.cc),
    bcc: normalizeRecipientList(input.bcc),
    attachmentPaths: [...(input.attachmentPaths ?? [])].sort(),
  });
  return createHash('sha256').update(canonical).digest('hex').slice(0, 32);
}

function normalizeRecipientList(value: string | null | undefined): string[] {
  if (!value) return [];
  return value
    .split(/[,;]+/)
    .map((part) => extractRecipientEmail(part.trim()))
    .filter(Boolean)
    .sort();
}

function extractRecipientEmail(part: string): string {
  if (!part) return '';
  const angle = part.match(/^(.+)<([^>]+)>$/);
  const candidate = (angle ? angle[2] : part).trim().toLowerCase();
  if (/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(candidate)) return candidate;
  return part.trim().toLowerCase();
}

/** Encodes timestamp + fingerprint into the approval-marker `sync_info.value`.
 *  Backwards-compatible reader: a value without the `|<hash>` suffix is still
 *  treated as a valid marker (fingerprint check skipped) so old markers from
 *  before this change keep working. */
export function encodeOutboundApprovalMarker(now: Date, fingerprint: string): string {
  return `${now.toISOString()}|${fingerprint}`;
}

export type OutboundApprovalMarker = {
  approvedAt: Date | null;
  fingerprint: string | null;
};

export function parseOutboundApprovalMarker(raw: string | null | undefined): OutboundApprovalMarker {
  if (!raw) return { approvedAt: null, fingerprint: null };
  const [isoPart, hashPart] = raw.split('|', 2);
  const approvedAt = isoPart ? new Date(isoPart) : null;
  return {
    approvedAt: approvedAt && Number.isFinite(approvedAt.getTime()) ? approvedAt : null,
    fingerprint: hashPart && hashPart.length > 0 ? hashPart : null,
  };
}
