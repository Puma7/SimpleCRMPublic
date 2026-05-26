/** Default page size for mail list queries (IMAP sync + UI). Keep bounded for large mailboxes. */
export const EMAIL_LIST_DEFAULT_LIMIT = 200;

/** Hard cap for a single list request (safety). */
export const EMAIL_LIST_MAX_LIMIT = 500;

export function clampEmailListLimit(limit: number | undefined): number {
  if (limit == null || !Number.isFinite(limit)) return EMAIL_LIST_DEFAULT_LIMIT;
  return Math.max(1, Math.min(Math.floor(limit), EMAIL_LIST_MAX_LIMIT));
}
