import { getSyncInfo, setSyncInfo } from '../sqlite-service';

const WHITELIST_KEY = 'workflow_sender_whitelist';
const BLACKLIST_KEY = 'workflow_sender_blacklist';
const THRESHOLD_KEY = 'workflow_spam_score_threshold';
const BUILTIN_TRUSTED_KEY = 'mail_security_builtin_trusted';
const AUTO_BLACKLIST_KEY = 'mail_security_auto_blacklist';

export type MailSecuritySettings = {
  senderWhitelist: string;
  senderBlacklist: string;
  spamScoreThreshold: string;
  useBuiltinTrustedSenders: boolean;
  autoBlacklistBeforeWorkflow: boolean;
};

export function getMailSecuritySettings(): MailSecuritySettings {
  return {
    senderWhitelist: getSyncInfo(WHITELIST_KEY) ?? '',
    senderBlacklist: getSyncInfo(BLACKLIST_KEY) ?? '',
    spamScoreThreshold: getSyncInfo(THRESHOLD_KEY) ?? '70',
    useBuiltinTrustedSenders: (getSyncInfo(BUILTIN_TRUSTED_KEY) ?? '1') !== '0',
    autoBlacklistBeforeWorkflow: (getSyncInfo(AUTO_BLACKLIST_KEY) ?? '1') !== '0',
  };
}

export function setMailSecuritySettings(payload: Partial<MailSecuritySettings>): void {
  if (payload.senderWhitelist !== undefined) {
    setSyncInfo(WHITELIST_KEY, payload.senderWhitelist.trim());
  }
  if (payload.senderBlacklist !== undefined) {
    setSyncInfo(BLACKLIST_KEY, payload.senderBlacklist.trim());
  }
  if (payload.spamScoreThreshold !== undefined) {
    const t = Math.max(1, Math.min(100, Math.floor(Number(payload.spamScoreThreshold) || 70)));
    setSyncInfo(THRESHOLD_KEY, String(t));
  }
  if (payload.useBuiltinTrustedSenders !== undefined) {
    setSyncInfo(BUILTIN_TRUSTED_KEY, payload.useBuiltinTrustedSenders ? '1' : '0');
  }
  if (payload.autoBlacklistBeforeWorkflow !== undefined) {
    setSyncInfo(AUTO_BLACKLIST_KEY, payload.autoBlacklistBeforeWorkflow ? '1' : '0');
  }
}

/** Global spam score threshold (1–100) for workflow „Schwellwert“ nodes. */
export function getMailSecuritySpamScoreThreshold(): number {
  const raw = getSyncInfo(THRESHOLD_KEY);
  const n = Number(raw);
  if (!Number.isFinite(n)) return 70;
  return Math.max(1, Math.min(100, Math.floor(n)));
}
