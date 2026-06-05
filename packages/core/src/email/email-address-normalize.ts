function normalizeEmailDomain(domain: string): string {
  const lower = domain.trim().toLowerCase();
  if (!lower) return lower;
  try {
    return new URL(`http://${lower}`).hostname || lower;
  } catch {
    return lower;
  }
}

export function normalizeEmailAddress(raw: string): string {
  const trimmed = raw.trim().toLowerCase();
  const at = trimmed.lastIndexOf('@');
  if (at <= 0) return trimmed;
  const local = trimmed.slice(0, at);
  const domain = normalizeEmailDomain(trimmed.slice(at + 1));
  const plus = local.indexOf('+');
  const localBase = plus >= 0 ? local.slice(0, plus) : local;
  return `${localBase}@${domain}`;
}
