/** Validate Rspamd controller base URL (typically local daemon). */
export function normalizeRspamdBaseUrl(
  raw: string,
): { ok: true; baseUrl: string } | { ok: false; error: string } {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: false, error: 'Rspamd-URL fehlt' };
  }
  try {
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
    const u = new URL(withScheme);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      return { ok: false, error: 'Rspamd-URL muss http oder https sein' };
    }
    if (!u.hostname) {
      return { ok: false, error: 'Rspamd-URL ungültig' };
    }
    return { ok: true, baseUrl: `${u.protocol}//${u.host}` };
  } catch {
    return { ok: false, error: 'Rspamd-URL ungültig' };
  }
}
