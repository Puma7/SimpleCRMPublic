import { isIP } from 'node:net';

export const MIN_ALLOWLIST_LABEL_LENGTH = 4;
export const DEFAULT_HTTP_METHODS = ['GET', 'POST'] as const;

const BLOCKED_BARE_LABELS = new Set([
  'com',
  'net',
  'org',
  'de',
  'io',
  'ai',
  'co',
  'uk',
  'eu',
  'us',
  'app',
]);

export function parseHttpAllowlist(raw: string): string[] {
  return raw
    .split(/[,;\s]+/)
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
}

export function isValidHttpAllowlistEntry(entry: string): boolean {
  if (entry.length < MIN_ALLOWLIST_LABEL_LENGTH) return false;
  if (entry.includes('..') || !/^[a-z0-9.-]+$/.test(entry)) return false;
  if (!entry.includes('.') && BLOCKED_BARE_LABELS.has(entry)) return false;
  return true;
}

export function hostMatchesHttpAllowlist(host: string, allowed: string[]): boolean {
  const h = host.toLowerCase();
  return allowed.some((a) => {
    if (!isValidHttpAllowlistEntry(a)) return false;
    if (h === a) return true;
    if (a.includes('.') && h.endsWith(`.${a}`)) return true;
    return false;
  });
}

export function isBlockedHttpHostname(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, '');
  if (!h) return true;
  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  if (h === '0.0.0.0' || h === '::' || h === '::1') return true;
  if (h.endsWith('.local') || h.endsWith('.internal')) return true;
  if (h === 'metadata.google.internal' || h === 'metadata') return true;
  return false;
}

export function isPrivateOrReservedIp(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, '').toLowerCase();
  const kind = isIP(h);
  if (kind === 4) {
    const [a, b] = h.split('.').map((x) => parseInt(x, 10));
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    return false;
  }
  if (kind === 6) {
    if (h === '::1' || h === '::') return true;
    if (h.startsWith('fe80:') || h.startsWith('fc') || h.startsWith('fd')) return true;
    if (h.startsWith('::ffff:')) {
      const mapped = h.slice('::ffff:'.length);
      if (isIP(mapped) === 4) return isPrivateOrReservedIp(mapped);
    }
  }
  return false;
}

export function isHttpMethodAllowed(method: string): boolean {
  const m = method.toUpperCase();
  return (DEFAULT_HTTP_METHODS as readonly string[]).includes(m);
}

export function validateHttpRequestUrl(url: string, allowlistRaw: string): { ok: true } | { ok: false; message: string } {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, message: 'Ungültige URL' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, message: 'Nur http(s)-URLs erlaubt' };
  }
  const host = parsed.hostname.toLowerCase();
  if (isBlockedHttpHostname(host)) {
    return { ok: false, message: 'Lokale/reservierte Hostnamen sind blockiert' };
  }
  if (isPrivateOrReservedIp(host)) {
    return { ok: false, message: 'Private/lokale IP-Adressen sind blockiert' };
  }
  const allowed = parseHttpAllowlist(allowlistRaw).filter(isValidHttpAllowlistEntry);
  if (allowed.length === 0) {
    return { ok: false, message: 'HTTP-Allowlist ist leer oder ungültig' };
  }
  if (!hostMatchesHttpAllowlist(host, allowed)) {
    return { ok: false, message: 'Host nicht in Allowlist' };
  }
  return { ok: true };
}
