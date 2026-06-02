import { getSyncInfo, setSyncInfo } from '../sqlite-service';

const KEYS = {
  mailauthEnabled: 'mail_security_mailauth_enabled',
  rspamdEnabled: 'mail_security_rspamd_enabled',
  rspamdUrl: 'mail_security_rspamd_url',
  rspamdTimeoutMs: 'mail_security_rspamd_timeout_ms',
  rspamdSpamScore: 'mail_security_rspamd_spam_score',
  autoSpamDmarcFail: 'mail_security_auto_spam_dmarc_fail',
  autoSpamSpfFail: 'mail_security_auto_spam_spf_fail',
  autoSpamRspamd: 'mail_security_auto_spam_rspamd',
  senderWhitelist: 'workflow_sender_whitelist',
  senderBlacklist: 'workflow_sender_blacklist',
  spamScoreThreshold: 'workflow_spam_score_threshold',
  spamEngineEnabled: 'mail_security_spam_engine_enabled',
  spamReviewThreshold: 'mail_security_spam_review_threshold',
  spamSpamThreshold: 'mail_security_spam_spam_threshold',
  localLearningEnabled: 'mail_security_spam_local_learning_enabled',
  rspamdContributionEnabled: 'mail_security_spam_rspamd_contribution_enabled',
  rspamdLearningEnabled: 'mail_security_spam_rspamd_learning_enabled',
  aiSpamWorkflowEnabled: 'mail_security_spam_ai_workflow_enabled',
} as const;

export type MailSecuritySettings = {
  mailauthEnabled: boolean;
  rspamdEnabled: boolean;
  rspamdUrl: string;
  rspamdTimeoutMs: number;
  rspamdSpamScore: number;
  autoSpamDmarcFail: boolean;
  autoSpamSpfFail: boolean;
  autoSpamRspamd: boolean;
  senderWhitelist: string;
  senderBlacklist: string;
  spamScoreThreshold: number;
  spamEngineEnabled: boolean;
  spamReviewThreshold: number;
  spamSpamThreshold: number;
  localLearningEnabled: boolean;
  rspamdContributionEnabled: boolean;
  rspamdLearningEnabled: boolean;
  aiSpamWorkflowEnabled: boolean;
};

function flag(key: string, defaultOn: boolean): boolean {
  const v = getSyncInfo(key);
  if (v == null || v === '') return defaultOn;
  return v === '1' || v.toLowerCase() === 'true' || v === 'yes';
}

export function getMailSecuritySettings(): MailSecuritySettings {
  const rspamdUrl = (getSyncInfo(KEYS.rspamdUrl) ?? 'http://127.0.0.1:11333').trim();
  const timeoutRaw = parseInt(getSyncInfo(KEYS.rspamdTimeoutMs) ?? '8000', 10);
  const rspamdTimeoutMs = Number.isFinite(timeoutRaw) ? Math.max(1000, Math.min(60_000, timeoutRaw)) : 8000;
  const rspamdScoreRaw = parseFloat(getSyncInfo(KEYS.rspamdSpamScore) ?? '15');
  const rspamdSpamScore = Number.isFinite(rspamdScoreRaw) ? Math.max(1, Math.min(100, rspamdScoreRaw)) : 15;
  const rspamdEnabled = flag(KEYS.rspamdEnabled, false);
  const kiThreshRaw = parseInt(getSyncInfo(KEYS.spamScoreThreshold) ?? '70', 10);
  const spamScoreThreshold = Number.isFinite(kiThreshRaw)
    ? Math.max(1, Math.min(100, kiThreshRaw))
    : 70;
  const reviewRaw = parseInt(getSyncInfo(KEYS.spamReviewThreshold) ?? '45', 10);
  const spamRaw = parseInt(getSyncInfo(KEYS.spamSpamThreshold) ?? '75', 10);
  const spamReviewThreshold = Number.isFinite(reviewRaw)
    ? Math.max(0, Math.min(100, reviewRaw))
    : 45;
  const spamSpamThreshold = Math.max(
    spamReviewThreshold,
    Number.isFinite(spamRaw) ? Math.max(0, Math.min(100, spamRaw)) : 75,
  );

  return {
    mailauthEnabled: flag(KEYS.mailauthEnabled, true),
    rspamdEnabled,
    rspamdUrl: rspamdUrl.replace(/\/$/, ''),
    rspamdTimeoutMs,
    rspamdSpamScore,
    autoSpamDmarcFail: flag(KEYS.autoSpamDmarcFail, false),
    autoSpamSpfFail: flag(KEYS.autoSpamSpfFail, false),
    autoSpamRspamd: flag(KEYS.autoSpamRspamd, false),
    senderWhitelist: getSyncInfo(KEYS.senderWhitelist) ?? '',
    senderBlacklist: getSyncInfo(KEYS.senderBlacklist) ?? '',
    spamScoreThreshold,
    spamEngineEnabled: flag(KEYS.spamEngineEnabled, true),
    spamReviewThreshold,
    spamSpamThreshold,
    localLearningEnabled: flag(KEYS.localLearningEnabled, true),
    rspamdContributionEnabled: flag(KEYS.rspamdContributionEnabled, rspamdEnabled),
    rspamdLearningEnabled: flag(KEYS.rspamdLearningEnabled, false),
    aiSpamWorkflowEnabled: flag(KEYS.aiSpamWorkflowEnabled, false),
  };
}

export function saveMailSecuritySettings(input: Partial<MailSecuritySettings>): void {
  if (input.mailauthEnabled !== undefined) {
    setSyncInfo(KEYS.mailauthEnabled, input.mailauthEnabled ? '1' : '0');
  }
  if (input.rspamdEnabled !== undefined) {
    setSyncInfo(KEYS.rspamdEnabled, input.rspamdEnabled ? '1' : '0');
  }
  if (input.rspamdUrl !== undefined) {
    setSyncInfo(KEYS.rspamdUrl, input.rspamdUrl.trim().replace(/\/$/, '') || 'http://127.0.0.1:11333');
  }
  if (input.rspamdTimeoutMs !== undefined) {
    const t = Math.max(1000, Math.min(60_000, Math.floor(input.rspamdTimeoutMs)));
    setSyncInfo(KEYS.rspamdTimeoutMs, String(t));
  }
  if (input.rspamdSpamScore !== undefined) {
    const s = Math.max(1, Math.min(100, input.rspamdSpamScore));
    setSyncInfo(KEYS.rspamdSpamScore, String(s));
  }
  if (input.autoSpamDmarcFail !== undefined) {
    setSyncInfo(KEYS.autoSpamDmarcFail, input.autoSpamDmarcFail ? '1' : '0');
  }
  if (input.autoSpamSpfFail !== undefined) {
    setSyncInfo(KEYS.autoSpamSpfFail, input.autoSpamSpfFail ? '1' : '0');
  }
  if (input.autoSpamRspamd !== undefined) {
    setSyncInfo(KEYS.autoSpamRspamd, input.autoSpamRspamd ? '1' : '0');
  }
  if (input.senderWhitelist !== undefined) {
    setSyncInfo(KEYS.senderWhitelist, input.senderWhitelist.trim());
  }
  if (input.senderBlacklist !== undefined) {
    setSyncInfo(KEYS.senderBlacklist, input.senderBlacklist.trim());
  }
  if (input.spamScoreThreshold !== undefined) {
    const t = Math.max(1, Math.min(100, Math.floor(input.spamScoreThreshold)));
    setSyncInfo(KEYS.spamScoreThreshold, String(t));
  }
  if (input.spamEngineEnabled !== undefined) {
    setSyncInfo(KEYS.spamEngineEnabled, input.spamEngineEnabled ? '1' : '0');
  }
  if (input.spamReviewThreshold !== undefined) {
    const t = Math.max(0, Math.min(100, Math.floor(input.spamReviewThreshold)));
    setSyncInfo(KEYS.spamReviewThreshold, String(t));
  }
  if (input.spamSpamThreshold !== undefined) {
    const t = Math.max(0, Math.min(100, Math.floor(input.spamSpamThreshold)));
    setSyncInfo(KEYS.spamSpamThreshold, String(t));
  }
  if (input.localLearningEnabled !== undefined) {
    setSyncInfo(KEYS.localLearningEnabled, input.localLearningEnabled ? '1' : '0');
  }
  if (input.rspamdContributionEnabled !== undefined) {
    setSyncInfo(KEYS.rspamdContributionEnabled, input.rspamdContributionEnabled ? '1' : '0');
  }
  if (input.rspamdLearningEnabled !== undefined) {
    setSyncInfo(KEYS.rspamdLearningEnabled, input.rspamdLearningEnabled ? '1' : '0');
  }
  if (input.aiSpamWorkflowEnabled !== undefined) {
    setSyncInfo(KEYS.aiSpamWorkflowEnabled, input.aiSpamWorkflowEnabled ? '1' : '0');
  }
}

export function isMailauthEnabled(): boolean {
  return getMailSecuritySettings().mailauthEnabled;
}

export function isRspamdEnabled(): boolean {
  return getMailSecuritySettings().rspamdEnabled;
}
