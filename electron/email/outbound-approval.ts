import {
  encodeOutboundApprovalMarker,
  outboundDraftFingerprint,
  parseOutboundApprovalMarker,
} from '../../packages/core/src/email/outbound-approval-marker';
import { getSyncInfo, setSyncInfo } from '../sqlite-service';

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
