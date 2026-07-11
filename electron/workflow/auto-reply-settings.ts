import { getSyncInfo, setSyncInfo } from '../sqlite-service';

export const AUTO_REPLY_ENABLED_KEY = 'auto_reply_enabled';
export const AUTO_REPLY_MAX_PER_SENDER_PER_DAY_KEY = 'auto_reply_max_per_sender_per_day';

export const AUTO_REPLY_MAX_PER_SENDER_DEFAULT = 1;

/** Matches automated / no-reply senders to prevent auto-reply loops. */
export const AUTO_REPLY_NOREPLY_RE =
  /(^|[._+-])(no[._-]?reply|do[._-]?not[._-]?reply|mailer[._-]?daemon|postmaster|bounce|notifications?|automated)([._+-]|@)/i;

export function loadAutoReplyEnabled(): boolean {
  const value = String(getSyncInfo(AUTO_REPLY_ENABLED_KEY) ?? '').trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'on';
}

/** Max. automatische Antworten pro Absender und Tag (Anti-Loop-Rate-Limit). */
export function loadAutoReplyMaxPerSenderPerDay(): number {
  const raw = Number(getSyncInfo(AUTO_REPLY_MAX_PER_SENDER_PER_DAY_KEY) ?? '');
  if (!Number.isFinite(raw) || raw < 1) return AUTO_REPLY_MAX_PER_SENDER_DEFAULT;
  return Math.min(50, Math.floor(raw));
}

export type AutoReplySettings = {
  enabled: boolean;
  maxPerSenderPerDay: number;
};

export function loadAutoReplySettings(): AutoReplySettings {
  return {
    enabled: loadAutoReplyEnabled(),
    maxPerSenderPerDay: loadAutoReplyMaxPerSenderPerDay(),
  };
}

export function saveAutoReplySettings(input: Partial<AutoReplySettings>): AutoReplySettings {
  if (input.enabled !== undefined) {
    setSyncInfo(AUTO_REPLY_ENABLED_KEY, input.enabled ? '1' : '0');
  }
  if (input.maxPerSenderPerDay !== undefined) {
    const clamped = Math.min(50, Math.max(1, Math.floor(Number(input.maxPerSenderPerDay) || 1)));
    setSyncInfo(AUTO_REPLY_MAX_PER_SENDER_PER_DAY_KEY, String(clamped));
  }
  return loadAutoReplySettings();
}
