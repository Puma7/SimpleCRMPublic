import { createHash } from 'node:crypto';

import { hasSimpleEmailShape, trailingAngleBracketContent } from './email-address-shape';
import { normalizeOutboundHoldContent, type OutboundHoldContentInput } from './outbound-review-skip';

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
export type OutboundDraftFingerprintInput = {
  subject?: string | null;
  bodyText?: string | null;
  bodyHtml?: string | null;
  to?: string | null;
  cc?: string | null;
  bcc?: string | null;
  attachmentPaths?: readonly string[] | null;
};

export function outboundDraftFingerprint(input: OutboundDraftFingerprintInput): string {
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

/** Freigabe-Marker: Inhalt plus Absenderkonto. Nach einem Kontowechsel ginge
 *  derselbe Text über eine Absender-Identität raus, die die Prüfung nie sah. */
export function outboundApprovalFingerprint(
  input: OutboundDraftFingerprintInput & { accountId: unknown },
): string {
  const { accountId, ...content } = input;
  return createHash('sha256')
    .update(`approval|${outboundDraftFingerprint(content)}|account:${approvalAccountKey(accountId)}`)
    .digest('hex')
    .slice(0, 32);
}

function approvalAccountKey(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = String(value).trim();
  return /^\d+$/.test(text) ? String(Number(text)) : text;
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
  // Linear statt `/^(.+)<([^>]+)>$/` und `/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/`
  // (CodeQL: polynomial bei präparierten Empfängern); gleiches Ergebnis, damit
  // gespeicherte Fingerprints gültig bleiben.
  const angle = trailingAngleBracketContent(part);
  const candidate = (angle ?? part).trim().toLowerCase();
  if (hasSimpleEmailShape(candidate, '<>')) return candidate;
  return part.trim().toLowerCase();
}

/** Encodes timestamp + fingerprint into the approval-marker `sync_info.value`.
 *  The fingerprint comes from `outboundApprovalFingerprint` (content and sender
 *  account). A value without the `|<hash>` suffix is invalid: readers treat it
 *  as "no approval" and the draft goes through the review again. */
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

/**
 * Fingerprint des endgültig angehaltenen Inhalts (sync_info
 * `outbound_hold_fingerprint:<id>`): outboundDraftFingerprint über die
 * normalisierten Felder, Hinweis „Versand blockiert“ herausgerechnet.
 */
export function outboundHoldFingerprint(input: OutboundHoldContentInput): string {
  const normalized = normalizeOutboundHoldContent(input);
  // Das Absenderkonto gehört dazu (Kontowechsel = neuer Stand); der Freigabe-
  // Marker bindet es über outboundApprovalFingerprint.
  return createHash('sha256')
    .update(`${outboundDraftFingerprint(normalized)}|account:${normalized.accountId}`)
    .digest('hex')
    .slice(0, 32);
}
