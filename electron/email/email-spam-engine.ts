import {
  buildSpamDecision as buildCoreSpamDecision,
  shouldRunInitialSpamScoring,
} from '../../packages/core/src/email';
import type { EmailMessageRow } from './email-store';
import { getEmailMessageById } from './email-store';
import { buildFeaturePreview } from './email-spam-features';
import {
  evaluateSpamListMatch,
  loadSpamFeatureStats,
  applyAutomatedSpamStatusFromDecision,
  saveSpamDecision,
} from './email-spam-store';
import { getMailSecuritySettings } from './mail-security-settings';
import type { SpamScoreBreakdown, SpamStatus } from './email-spam-types';

function storedSpamDecisionFromRow(row: EmailMessageRow): SpamScoreBreakdown | null {
  if (row.spam_score_breakdown_json) {
    try {
      return JSON.parse(row.spam_score_breakdown_json) as SpamScoreBreakdown;
    } catch {
      /* ignore invalid stored breakdown */
    }
  }
  if (row.spam_score == null) return null;
  return {
    score: row.spam_score,
    status: (row.spam_score_label ?? 'clean') as SpamStatus,
    source: row.spam_decision_source ?? 'stored',
    reasons: [],
    featureKeys: [],
    modelVersion: 1,
  };
}

export function buildSpamDecision(row: EmailMessageRow): SpamScoreBreakdown {
  const preview = buildFeaturePreview(row);
  return buildCoreSpamDecision(row, {
    settings: getMailSecuritySettings(),
    listMatch: evaluateSpamListMatch(row),
    featureStats: loadSpamFeatureStats(preview.featureKeys),
  });
}

export function evaluateAndSaveSpamDecision(
  messageId: number,
  preloadedRow?: EmailMessageRow,
): SpamScoreBreakdown | null {
  const row = preloadedRow ?? getEmailMessageById(messageId);
  if (!row) return null;
  if (!shouldRunInitialSpamScoring({ spamDecidedAt: row.spam_decided_at })) {
    return storedSpamDecisionFromRow(row);
  }
  const decision = buildSpamDecision(row);
  if (decision.status === 'review' || decision.status === 'spam') {
    applyAutomatedSpamStatusFromDecision(messageId, decision.status);
  }
  saveSpamDecision(messageId, row, decision);
  return decision;
}
