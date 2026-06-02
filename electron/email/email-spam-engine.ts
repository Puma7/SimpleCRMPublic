import type { EmailMessageRow } from './email-store';
import { getEmailMessageById } from './email-store';
import { getMailSecuritySettings } from './mail-security-settings';
import { buildFeaturePreview } from './email-spam-features';
import {
  evaluateSpamListMatch,
  loadSpamFeatureStats,
  saveSpamDecision,
} from './email-spam-store';
import type { AuthResultLabel } from './mail-auth-verify';
import type { SpamScoreBreakdown, SpamScoreReason, SpamStatus } from './email-spam-types';

const MODEL_VERSION = 1;

function clampScore(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function statusForScore(score: number, reviewThreshold: number, spamThreshold: number): SpamStatus {
  if (score >= spamThreshold) return 'spam';
  if (score >= reviewThreshold) return 'review';
  return 'clean';
}

function authReason(protocol: string, value: AuthResultLabel | string | null | undefined): SpamScoreReason | null {
  const v = String(value ?? '').toLowerCase();
  if (v === 'fail' || v === 'permerror') {
    return {
      code: `auth.${protocol}.fail`,
      label: `${protocol.toUpperCase()} fehlgeschlagen`,
      points: protocol === 'dmarc' ? 24 : 14,
    };
  }
  if (v === 'softfail' || v === 'policy') {
    return {
      code: `auth.${protocol}.softfail`,
      label: `${protocol.toUpperCase()} unsicher`,
      points: protocol === 'dmarc' ? 12 : 7,
    };
  }
  if (v === 'pass') {
    return {
      code: `auth.${protocol}.pass`,
      label: `${protocol.toUpperCase()} bestanden`,
      points: protocol === 'dmarc' ? -8 : -4,
    };
  }
  return null;
}

function addReason(reasons: SpamScoreReason[], reason: SpamScoreReason | null): void {
  if (!reason || reason.points === 0) return;
  reasons.push(reason);
}

function heuristicReasons(featureKeys: Set<string>): SpamScoreReason[] {
  const out: SpamScoreReason[] = [];
  if (featureKeys.has('content:suspicious_terms')) {
    out.push({ code: 'content.suspicious_terms', label: 'Verdächtige Begriffe im Inhalt', points: 12 });
  }
  if (featureKeys.has('content:many_urls')) {
    out.push({ code: 'content.many_urls', label: 'Viele Links in der Nachricht', points: 10 });
  } else if (featureKeys.has('content:has_url')) {
    out.push({ code: 'content.has_url', label: 'Enthält Links', points: 3 });
  }
  if (featureKeys.has('html:form')) {
    out.push({ code: 'html.form', label: 'HTML-Formular erkannt', points: 14 });
  }
  if (featureKeys.has('html:script')) {
    out.push({ code: 'html.script', label: 'Script-Tag im HTML erkannt', points: 18 });
  }
  if (featureKeys.has('html:remote_resource')) {
    out.push({ code: 'html.remote_resource', label: 'Externe HTML-Ressourcen', points: 5 });
  }
  if (featureKeys.has('attachment:risky_type')) {
    out.push({ code: 'attachment.risky_type', label: 'Riskanter Anhangstyp', points: 16 });
  } else if (featureKeys.has('attachment:any')) {
    out.push({ code: 'attachment.any', label: 'Nachricht enthält Anhänge', points: 2 });
  }
  if (featureKeys.has('content:business_terms')) {
    out.push({ code: 'content.business_terms', label: 'Geschäftskontext erkannt', points: -4 });
  }
  return out;
}

function learningReasons(featureKeys: string[]): SpamScoreReason[] {
  const stats = loadSpamFeatureStats(featureKeys);
  const out: SpamScoreReason[] = [];
  for (const key of featureKeys) {
    const s = stats.get(key);
    if (!s) continue;
    const total = s.spam_count + s.ham_count;
    if (total < 2) continue;
    const spamRatio = (s.spam_count + 1) / (total + 2);
    const points = Math.round((spamRatio - 0.5) * 28);
    if (Math.abs(points) < 3) continue;
    out.push({
      code: `learning.${key}`,
      label: points > 0 ? `Lernsignal Spam: ${key}` : `Lernsignal Kein Spam: ${key}`,
      points,
    });
  }
  return out.sort((a, b) => Math.abs(b.points) - Math.abs(a.points)).slice(0, 6);
}

function rspamdReason(row: EmailMessageRow): SpamScoreReason | null {
  if (row.rspamd_score == null || Number.isNaN(row.rspamd_score)) return null;
  const action = String(row.rspamd_action ?? '').toLowerCase();
  const points = Math.max(
    action === 'reject' ? 35 : 0,
    action === 'add header' || action === 'rewrite subject' ? 24 : 0,
    Math.min(35, Math.round(row.rspamd_score * 2.5)),
  );
  if (points <= 0) return null;
  return {
    code: 'rspamd.score',
    label: `Rspamd-Score ${row.rspamd_score}`,
    points,
  };
}

export function buildSpamDecision(row: EmailMessageRow): SpamScoreBreakdown {
  const settings = getMailSecuritySettings();
  const preview = buildFeaturePreview(row);
  const featureSet = new Set(preview.featureKeys);

  if (!settings.spamEngineEnabled) {
    return {
      score: 0,
      status: 'clean',
      source: 'disabled',
      reasons: [{ code: 'engine.disabled', label: 'Spam-Engine deaktiviert', points: 0 }],
      featureKeys: preview.featureKeys,
      modelVersion: MODEL_VERSION,
    };
  }

  const listMatch = evaluateSpamListMatch(row);
  if (listMatch?.listType === 'allow') {
    return {
      score: 0,
      status: 'clean',
      source: 'allowlist',
      reasons: [{ code: 'list.allow', label: `Allowlist: ${listMatch.pattern}`, points: -100 }],
      featureKeys: preview.featureKeys,
      listMatch,
      modelVersion: MODEL_VERSION,
    };
  }
  if (listMatch?.listType === 'block') {
    return {
      score: 100,
      status: 'spam',
      source: 'blocklist',
      reasons: [{ code: 'list.block', label: `Blocklist: ${listMatch.pattern}`, points: 100 }],
      featureKeys: preview.featureKeys,
      listMatch,
      modelVersion: MODEL_VERSION,
    };
  }

  const reasons: SpamScoreReason[] = [];
  addReason(reasons, authReason('spf', row.auth_spf));
  addReason(reasons, authReason('dkim', row.auth_dkim));
  addReason(reasons, authReason('dmarc', row.auth_dmarc));
  addReason(reasons, authReason('arc', row.auth_arc));
  if (settings.rspamdContributionEnabled) addReason(reasons, rspamdReason(row));
  for (const r of heuristicReasons(featureSet)) addReason(reasons, r);
  if (settings.localLearningEnabled) {
    for (const r of learningReasons(preview.featureKeys)) addReason(reasons, r);
  }

  const base = 8;
  const score = clampScore(base + reasons.reduce((sum, r) => sum + r.points, 0));
  const status = statusForScore(score, settings.spamReviewThreshold, settings.spamSpamThreshold);
  const sourceParts = ['local'];
  if (settings.rspamdContributionEnabled && row.rspamd_score != null) sourceParts.push('rspamd');
  if (settings.localLearningEnabled) sourceParts.push('learning');

  return {
    score,
    status,
    source: sourceParts.join('+'),
    reasons: reasons.sort((a, b) => Math.abs(b.points) - Math.abs(a.points)).slice(0, 12),
    featureKeys: preview.featureKeys,
    modelVersion: MODEL_VERSION,
  };
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
