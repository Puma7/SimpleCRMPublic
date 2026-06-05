import { buildSpamDecision as buildCoreSpamDecision } from '../../packages/core/src/email';
import type { EmailMessageRow } from './email-store';
import { getEmailMessageById } from './email-store';
import { buildFeaturePreview } from './email-spam-features';
import {
  evaluateSpamListMatch,
  loadSpamFeatureStats,
  saveSpamDecision,
} from './email-spam-store';
import { getMailSecuritySettings } from './mail-security-settings';
import type { SpamScoreBreakdown } from './email-spam-types';

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
  const decision = buildSpamDecision(row);
  saveSpamDecision(messageId, row, decision);
  return decision;
}
