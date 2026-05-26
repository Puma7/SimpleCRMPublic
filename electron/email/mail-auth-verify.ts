import dns from 'dns';
import { authenticate, type AuthStatus, type DKIMVerifyResult } from 'mailauth';
import { buildRfc822FromStored, extractEnvelopeSender } from './mail-rfc822-build';

let dnsResultOrderPatched = false;

/** Broken IPv6 DNS on some networks causes mailauth temperror for SPF/DKIM/DMARC. */
function ensureDnsPrefersIpv4(): void {
  if (dnsResultOrderPatched) return;
  try {
    dns.setDefaultResultOrder('ipv4first');
    dnsResultOrderPatched = true;
  } catch {
    /* Node without setDefaultResultOrder */
  }
}

export type AuthResultLabel =
  | 'pass'
  | 'fail'
  | 'softfail'
  | 'neutral'
  | 'none'
  | 'temperror'
  | 'permerror'
  | 'policy'
  | 'skipped'
  | 'unknown';

export type MailAuthVerification = {
  spf: AuthResultLabel;
  dkim: AuthResultLabel;
  dmarc: AuthResultLabel;
  arc: AuthResultLabel;
  dkimDomains: string[];
  error?: string;
};

function normalizeResult(raw: string | undefined): AuthResultLabel {
  if (!raw) return 'unknown';
  const r = raw.toLowerCase();
  if (r === 'temperr') return 'temperror';
  if (
    r === 'pass' ||
    r === 'fail' ||
    r === 'softfail' ||
    r === 'neutral' ||
    r === 'none' ||
    r === 'temperror' ||
    r === 'permerror' ||
    r === 'policy' ||
    r === 'skipped'
  ) {
    return r as AuthResultLabel;
  }
  return 'unknown';
}

function statusLabel(st: AuthStatus | undefined): AuthResultLabel {
  return normalizeResult(st?.result);
}

/** Best-effort parse of the receiving MTA's Authentication-Results (advisory only). */
function extractAuthenticationResultsBlocks(rawHeaders: string): string[] {
  const lines = rawHeaders.replace(/\r\n/g, '\n').split('\n');
  const blocks: string[] = [];
  let current: string | null = null;
  for (const line of lines) {
    if (/^Authentication-Results:/i.test(line)) {
      if (current) blocks.push(current.trim());
      current = line.replace(/^Authentication-Results:\s*/i, '');
    } else if (current != null && /^[ \t]/.test(line)) {
      current += ` ${line.trim()}`;
    } else {
      if (current) blocks.push(current.trim());
      current = null;
    }
  }
  if (current) blocks.push(current.trim());
  return blocks;
}

export function parseAuthenticationResultsAdvisory(rawHeaders: string | null): string | null {
  if (!rawHeaders?.trim()) return null;
  const blocks = extractAuthenticationResultsBlocks(rawHeaders);
  if (!blocks.length) return null;
  const body = blocks[blocks.length - 1];
  const parts: string[] = [];
  for (const key of ['spf', 'dkim', 'dmarc', 'arc'] as const) {
    const m = body.match(new RegExp(`\\b${key}\\s*=\\s*([a-z]+)`, 'i'));
    if (m?.[1]) parts.push(`${key.toUpperCase()}=${m[1].toLowerCase()}`);
  }
  return parts.length > 0 ? parts.join(', ') : null;
}

function buildTemperrorHint(
  labels: AuthResultLabel[],
  rawHeaders: string | null,
): string | undefined {
  const temperrors = labels.filter((l) => l === 'temperror' || l === 'unknown').length;
  if (temperrors < 2) return undefined;
  const advisory = parseAuthenticationResultsAdvisory(rawHeaders);
  const base =
    'Live-DNS-Prüfung (mailauth) vorübergehend fehlgeschlagen (temperror). ' +
    'Internet, VPN/Firewall und DNS prüfen (z. B. Pi-hole, Firmen-DNS).';
  if (advisory) {
    return `${base} Empfangsserver (Authentication-Results): ${advisory}.`;
  }
  return base;
}

function aggregateDkim(dkim: DKIMVerifyResult | undefined): {
  label: AuthResultLabel;
  domains: string[];
} {
  if (!dkim?.results?.length) {
    return { label: 'none', domains: [] };
  }
  const domains = dkim.results.map((r) => r.signingDomain).filter(Boolean);
  const results = dkim.results.map((r) => statusLabel(r.status));
  if (results.some((r) => r === 'pass')) return { label: 'pass', domains };
  if (results.some((r) => r === 'fail' || r === 'permerror')) {
    return { label: 'fail', domains };
  }
  return { label: results[0] ?? 'unknown', domains };
}

/**
 * Verify SPF, DKIM, DMARC, ARC using mailauth on reconstructed RFC822 (headers + body).
 */
export async function verifyMailAuthentication(input: {
  rawRfc822B64?: string | null;
  rawHeaders: string | null;
  bodyText: string | null;
  bodyHtml: string | null;
}): Promise<MailAuthVerification> {
  const message = buildRfc822FromStored(input);
  if (!message) {
    return {
      spf: 'none',
      dkim: 'none',
      dmarc: 'none',
      arc: 'none',
      dkimDomains: [],
      error: 'Keine RFC822-Header gespeichert',
    };
  }

  try {
    ensureDnsPrefersIpv4();
    const sender = extractEnvelopeSender(input.rawHeaders);
    const result = await authenticate(message, {
      trustReceived: true,
      sender,
      disableBimi: true,
    });
    const dkimAgg = aggregateDkim(result.dkim);
    const spf =
      result.spf && typeof result.spf === 'object' ? statusLabel(result.spf.status) : 'none';
    const dmarc =
      result.dmarc && typeof result.dmarc === 'object'
        ? statusLabel(result.dmarc.status)
        : 'none';
    const arc =
      result.arc && typeof result.arc === 'object' ? statusLabel(result.arc.status) : 'none';
    const error = buildTemperrorHint([spf, dkimAgg.label, dmarc], input.rawHeaders);
    return {
      spf,
      dkim: dkimAgg.label,
      dmarc,
      arc,
      dkimDomains: dkimAgg.domains,
      error,
    };
  } catch (e) {
    return {
      spf: 'unknown',
      dkim: 'unknown',
      dmarc: 'unknown',
      arc: 'unknown',
      dkimDomains: [],
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export function isAuthFailure(label: AuthResultLabel): boolean {
  return label === 'fail' || label === 'permerror';
}
