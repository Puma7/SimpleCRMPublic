import { getSyncInfo, setSyncInfo } from '../sqlite-service';
import {
  OUTBOUND_REVIEW_SKIP_POLICY_KEY,
  parseOutboundReviewSkipPolicy,
  type OutboundReviewSkipPolicy,
} from '../../packages/core/src/email/outbound-review-skip';

/** Einstellung „Ausgangsprüfung überspringen erlauben“ (sync_info, Standard „all“). */
export function loadOutboundReviewSkipPolicy(): OutboundReviewSkipPolicy {
  return parseOutboundReviewSkipPolicy(getSyncInfo(OUTBOUND_REVIEW_SKIP_POLICY_KEY));
}

export function saveOutboundReviewSkipPolicy(policy: OutboundReviewSkipPolicy): void {
  setSyncInfo(OUTBOUND_REVIEW_SKIP_POLICY_KEY, policy);
}
