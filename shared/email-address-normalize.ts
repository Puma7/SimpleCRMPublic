/** Normalize email for customer matching (strip +tags, lowercase). */
export function normalizeEmailAddress(raw: string): string {
  const trimmed = raw.trim().toLowerCase();
  const at = trimmed.lastIndexOf('@');
  if (at <= 0) return trimmed;
  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);
  const plus = local.indexOf('+');
  const localBase = plus >= 0 ? local.slice(0, plus) : local;
  return `${localBase}@${domain}`;
}
