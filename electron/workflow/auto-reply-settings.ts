import { getSyncInfo } from '../sqlite-service';

export const AUTO_REPLY_ENABLED_KEY = 'auto_reply_enabled';

/** Matches automated / no-reply senders to prevent auto-reply loops. */
export const AUTO_REPLY_NOREPLY_RE =
  /(^|[._+-])(no[._-]?reply|do[._-]?not[._-]?reply|mailer[._-]?daemon|postmaster|bounce|notifications?|automated)([._+-]|@)/i;

export function loadAutoReplyEnabled(): boolean {
  const value = String(getSyncInfo(AUTO_REPLY_ENABLED_KEY) ?? '').trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'on';
}
