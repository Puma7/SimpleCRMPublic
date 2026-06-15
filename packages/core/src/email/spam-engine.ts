import {
  buildFeaturePreview,
  type SpamFeatureMessageInput,
} from './spam-features';

export type SpamStatus = 'clean' | 'review' | 'spam';
export type SpamListType = 'allow' | 'block';
export type SpamPatternType = 'email' | 'domain';
export type SpamTrainingLabel = 'spam' | 'ham';

export type SpamScoreReason = {
  code: string;
  label: string;
  points: number;
};

export type SpamListMatch = {
  listType: SpamListType;
  patternType: SpamPatternType;
  pattern: string;
  specificity: number;
};

export type SpamScoreBreakdown = {
  score: number;
  status: SpamStatus;
  source: string;
  reasons: SpamScoreReason[];
  featureKeys: string[];
  listMatch?: SpamListMatch;
  modelVersion: number;
};

export type SpamFeatureStatInput = {
  featureKey?: string;
  feature_key?: string;
  spamCount?: number;
  spam_count?: number;
  hamCount?: number;
  ham_count?: number;
};

export type SpamEngineSettings = {
  spamEngineEnabled: boolean;
  spamReviewThreshold: number;
  spamSpamThreshold: number;
  localLearningEnabled: boolean;
  rspamdContributionEnabled: boolean;
};

export type SpamDecisionMessageInput = SpamFeatureMessageInput & {
  rspamdScore?: number | null;
  rspamd_score?: number | null;
  rspamdAction?: string | null;
  rspamd_action?: string | null;
};

export type BuildSpamDecisionOptions = {
  settings?: Partial<SpamEngineSettings>;
  listMatch?: SpamListMatch | null;
  featureStats?: Map<string, SpamFeatureStatInput> | readonly SpamFeatureStatInput[];
};

export const SPAM_ENGINE_MODEL_VERSION = 1;

export type SpamStatusApplyMessageInput = {
  doneLocal?: boolean | number | string | null;
  spamStatus?: string | null;
  isSpam?: boolean | number | null;
};

/** Passing auth checks correlate with ham; they must not feed local learning stats. */
export function isSpamLearningFeatureKey(featureKey: string): boolean {
  return !(featureKey.startsWith('auth:') && featureKey.endsWith(':pass'));
}

/** Keep handled inbox mail in place when automated rescoring would move it to review/spam. */
export function shouldAutoApplySpamStatus(
  message: SpamStatusApplyMessageInput,
  nextStatus: SpamStatus,
): boolean {
  if (nextStatus === 'clean') return true;
  const done =
    message.doneLocal === true ||
    message.doneLocal === 1 ||
    message.doneLocal === '1';
  return !done;
}

export const DEFAULT_SPAM_ENGINE_SETTINGS: SpamEngineSettings = {
  spamEngineEnabled: true,
  spamReviewThreshold: 45,
  spamSpamThreshold: 75,
  localLearningEnabled: true,
  rspamdContributionEnabled: false,
};

function clampScore(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function statusForScore(score: number, reviewThreshold: number, spamThreshold: number): SpamStatus {
  if (score >= spamThreshold) return 'spam';
  if (score >= reviewThreshold) return 'review';
  return 'clean';
}

function authReason(protocol: string, value: string | null | undefined): SpamScoreReason | null {
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
    out.push({ code: 'content.suspicious_terms', label: 'Verdaechtige Begriffe im Inhalt', points: 12 });
  }
  if (featureKeys.has('content:many_urls')) {
    out.push({ code: 'content.many_urls', label: 'Viele Links in der Nachricht', points: 10 });
  } else if (featureKeys.has('content:has_url')) {
    out.push({ code: 'content.has_url', label: 'Enthaelt Links', points: 3 });
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
    out.push({ code: 'attachment.any', label: 'Nachricht enthaelt Anhaenge', points: 2 });
  }
  if (featureKeys.has('content:business_terms')) {
    out.push({ code: 'content.business_terms', label: 'Geschaeftskontext erkannt', points: -4 });
  }
  return out;
}

function learningReasons(
  featureKeys: string[],
  featureStats: ReadonlyMap<string, SpamFeatureStatInput>,
): SpamScoreReason[] {
  const out: SpamScoreReason[] = [];
  for (const key of featureKeys) {
    if (!isSpamLearningFeatureKey(key)) continue;
    const s = featureStats.get(key);
    if (!s) continue;
    const spamCount = s.spamCount ?? s.spam_count ?? 0;
    const hamCount = s.hamCount ?? s.ham_count ?? 0;
    const total = spamCount + hamCount;
    if (total < 2) continue;
    const spamRatio = (spamCount + 1) / (total + 2);
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

function rspamdReason(message: SpamDecisionMessageInput): SpamScoreReason | null {
  const score = message.rspamdScore ?? message.rspamd_score;
  if (score == null || Number.isNaN(score)) return null;
  const action = String(message.rspamdAction ?? message.rspamd_action ?? '').toLowerCase();
  const points = Math.max(
    action === 'reject' ? 35 : 0,
    action === 'add header' || action === 'rewrite subject' ? 24 : 0,
    Math.min(35, Math.round(score * 2.5)),
  );
  if (points <= 0) return null;
  return {
    code: 'rspamd.score',
    label: `Rspamd-Score ${score}`,
    points,
  };
}

function normalizeFeatureStats(
  value: BuildSpamDecisionOptions['featureStats'],
): ReadonlyMap<string, SpamFeatureStatInput> {
  if (!value) return new Map();
  if (value instanceof Map) return value;
  const out = new Map<string, SpamFeatureStatInput>();
  for (const stat of value) {
    const key = stat.featureKey ?? stat.feature_key;
    if (key) out.set(key, stat);
  }
  return out;
}

function normalizeSettings(settings: Partial<SpamEngineSettings> | undefined): SpamEngineSettings {
  const merged = { ...DEFAULT_SPAM_ENGINE_SETTINGS, ...settings };
  const review = clampScore(merged.spamReviewThreshold);
  const spam = Math.max(review, clampScore(merged.spamSpamThreshold));
  return {
    ...merged,
    spamReviewThreshold: review,
    spamSpamThreshold: spam,
  };
}

export function buildSpamDecision(
  message: SpamDecisionMessageInput,
  options: BuildSpamDecisionOptions = {},
): SpamScoreBreakdown {
  const settings = normalizeSettings(options.settings);
  const preview = buildFeaturePreview(message);
  const featureSet = new Set(preview.featureKeys);

  if (!settings.spamEngineEnabled) {
    return {
      score: 0,
      status: 'clean',
      source: 'disabled',
      reasons: [{ code: 'engine.disabled', label: 'Spam-Engine deaktiviert', points: 0 }],
      featureKeys: preview.featureKeys,
      modelVersion: SPAM_ENGINE_MODEL_VERSION,
    };
  }

  if (options.listMatch?.listType === 'allow') {
    return {
      score: 0,
      status: 'clean',
      source: 'allowlist',
      reasons: [{ code: 'list.allow', label: `Allowlist: ${options.listMatch.pattern}`, points: -100 }],
      featureKeys: preview.featureKeys,
      listMatch: options.listMatch,
      modelVersion: SPAM_ENGINE_MODEL_VERSION,
    };
  }
  if (options.listMatch?.listType === 'block') {
    return {
      score: 100,
      status: 'spam',
      source: 'blocklist',
      reasons: [{ code: 'list.block', label: `Blocklist: ${options.listMatch.pattern}`, points: 100 }],
      featureKeys: preview.featureKeys,
      listMatch: options.listMatch,
      modelVersion: SPAM_ENGINE_MODEL_VERSION,
    };
  }

  const reasons: SpamScoreReason[] = [];
  addReason(reasons, authReason('spf', message.authSpf ?? message.auth_spf));
  addReason(reasons, authReason('dkim', message.authDkim ?? message.auth_dkim));
  addReason(reasons, authReason('dmarc', message.authDmarc ?? message.auth_dmarc));
  addReason(reasons, authReason('arc', message.authArc ?? message.auth_arc));
  if (settings.rspamdContributionEnabled) addReason(reasons, rspamdReason(message));
  for (const r of heuristicReasons(featureSet)) addReason(reasons, r);
  if (settings.localLearningEnabled) {
    for (const r of learningReasons(preview.featureKeys, normalizeFeatureStats(options.featureStats))) {
      addReason(reasons, r);
    }
  }

  const base = 8;
  const score = clampScore(base + reasons.reduce((sum, r) => sum + r.points, 0));
  const status = statusForScore(score, settings.spamReviewThreshold, settings.spamSpamThreshold);
  const sourceParts = ['local'];
  if (settings.rspamdContributionEnabled && (message.rspamdScore ?? message.rspamd_score) != null) sourceParts.push('rspamd');
  if (settings.localLearningEnabled) sourceParts.push('learning');

  return {
    score,
    status,
    source: sourceParts.join('+'),
    reasons: reasons.sort((a, b) => Math.abs(b.points) - Math.abs(a.points)).slice(0, 12),
    featureKeys: preview.featureKeys,
    modelVersion: SPAM_ENGINE_MODEL_VERSION,
  };
}
