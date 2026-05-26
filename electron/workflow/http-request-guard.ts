import dns from 'node:dns/promises';
import {
  isPrivateOrReservedIp,
  validateHttpRequestUrl,
} from '../../shared/workflow-http-allowlist';

export async function assertWorkflowHttpUrlAllowed(
  url: string,
  allowlistRaw: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const base = validateHttpRequestUrl(url, allowlistRaw);
  if (!base.ok) return base;

  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return { ok: false, message: 'Ungültige URL' };
  }

  try {
    const records = await dns.lookup(host, { all: true, verbatim: true });
    for (const rec of records) {
      const addr = String(rec.address).replace(/^\[|\]$/g, '');
      if (isPrivateOrReservedIp(addr)) {
        return { ok: false, message: 'DNS-Auflösung zeigt auf blockierte Adresse' };
      }
    }
  } catch {
    return { ok: false, message: 'DNS-Auflösung fehlgeschlagen' };
  }

  return { ok: true };
}
