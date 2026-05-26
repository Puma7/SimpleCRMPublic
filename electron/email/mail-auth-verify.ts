import dns from 'dns';
import { authenticate, type AuthStatus, type DKIMVerifyResult } from 'mailauth';
import { isCorruptRawHeaders } from './email-parse-utils';
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
    if (/^(?:ARC-)?Authentication-Results:/i.test(line)) {
      if (current) blocks.push(current.trim());
      current = line.replace(/^(?:ARC-)?Authentication-Results:\s*/i, '');
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

/** Header block from stored RFC822 (preferred when raw_headers omit Authentication-Results). */
export function extractHeaderSectionFromStored(input: {
  rawRfc822B64?: string | null;
  rawHeaders: string | null;
}): string | null {
  if (input.rawRfc822B64?.trim()) {
    try {
      const str = Buffer.from(input.rawRfc822B64, 'base64').toString('utf8');
      const sep = str.search(/\r?\n\r?\n/);
      if (sep >= 0) return str.slice(0, sep);
    } catch {
      /* invalid base64 */
    }
  }
  if (input.rawHeaders?.trim() && !isCorruptRawHeaders(input.rawHeaders)) {
    return input.rawHeaders;
  }
  return null;
}

/** Use whichever stored header source contains parseable Authentication-Results. */
export function resolveHeaderTextForMailAuth(input: {
  rawRfc822B64?: string | null;
  rawHeaders: string | null;
}): string | null {
  const fromStored =
    input.rawHeaders?.trim() && !isCorruptRawHeaders(input.rawHeaders)
      ? input.rawHeaders
      : null;
  if (fromStored && parseAuthenticationResultsLabels(fromStored)) {
    return fromStored;
  }
  const fromRfc822 = extractHeaderSectionFromStored(input);
  if (fromRfc822 && parseAuthenticationResultsLabels(fromRfc822)) {
    return fromRfc822;
  }
  return fromRfc822 ?? fromStored;
}

export type ParsedAuthenticationResults = Partial<
  Record<'spf' | 'dkim' | 'dmarc' | 'arc', AuthResultLabel>
>;

function liveCheckUnreliable(label: AuthResultLabel): boolean {
  return label === 'temperror' || label === 'unknown';
}

/** Parse receiving MTA Authentication-Results into SPF/DKIM/DMARC/ARC labels. */
export function parseAuthenticationResultsLabels(
  rawHeaders: string | null,
): ParsedAuthenticationResults | null {
  if (!rawHeaders?.trim()) return null;
  const blocks = extractAuthenticationResultsBlocks(rawHeaders);
  if (!blocks.length) return null;
  const out: ParsedAuthenticationResults = {};
  for (const body of blocks) {
    for (const key of ['spf', 'dkim', 'dmarc', 'arc'] as const) {
      const m = body.match(new RegExp(`\\b${key}\\s*=\\s*([a-z]+)`, 'i'));
      if (!m?.[1]) continue;
      const label = normalizeResult(m[1]);
      const prev = out[key];
      if (!prev || (liveCheckUnreliable(prev) && !liveCheckUnreliable(label))) {
        out[key] = label;
      }
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}

function buildTemperrorHint(
  labels: AuthResultLabel[],
  headerText: string | null,
): string | undefined {
  const temperrors = labels.filter((l) => liveCheckUnreliable(l)).length;
  if (temperrors < 2) return undefined;
  const advisory = parseAuthenticationResultsAdvisory(headerText);
  const base =
    'Live-DNS-Prüfung (mailauth) vorübergehend fehlgeschlagen (temperror). ' +
    'Internet, VPN/Firewall und DNS prüfen (z. B. Pi-hole, Firmen-DNS).';
  if (advisory) {
    return `${base} Empfangsserver (Authentication-Results): ${advisory}.`;
  }
  return base;
}

export function parseAuthenticationResultsAdvisory(rawHeaders: string | null): string | null {
  const parsed = parseAuthenticationResultsLabels(rawHeaders);
  if (!parsed) return null;
  const parts: string[] = [];
  for (const key of ['spf', 'dkim', 'dmarc', 'arc'] as const) {
    const v = parsed[key];
    if (v) parts.push(`${key.toUpperCase()}=${v}`);
  }
  return parts.length > 0 ? parts.join(', ') : null;
}

function applyHeaderAuthFallback(
  live: MailAuthVerification,
  headerText: string | null,
): MailAuthVerification {
  const header = parseAuthenticationResultsLabels(headerText);
  if (!header) {
    const temperrors = [live.spf, live.dkim, live.dmarc].filter(liveCheckUnreliable).length;
    if (temperrors >= 2) {
      const hint = buildTemperrorHint([live.spf, live.dkim, live.dmarc], headerText);
      return {
        ...live,
        error:
          live.error ??
          hint ??
          'Live-DNS-Prüfung (mailauth) fehlgeschlagen (temperror). ' +
            'Kein Authentication-Results-Header zum Ausweichen. DNS/VPN/Firewall prüfen.',
      };
    }
    return live;
  }

  const merged: MailAuthVerification = { ...live, dkimDomains: [...live.dkimDomains] };
  let usedFallback = false;

  for (const key of ['spf', 'dkim', 'dmarc'] as const) {
    const headerLabel = header[key];
    if (
      headerLabel &&
      !liveCheckUnreliable(headerLabel) &&
      liveCheckUnreliable(live[key])
    ) {
      merged[key] = headerLabel;
      usedFallback = true;
    }
  }

  // Direct mail without forwarding: live ARC often "fail", header often omits ARC.
  if (live.arc === 'fail' && (!header.arc || header.arc === 'none')) {
    merged.arc = 'none';
    usedFallback = true;
  } else if (
    header.arc &&
    !liveCheckUnreliable(header.arc) &&
    (live.arc === 'fail' || liveCheckUnreliable(live.arc))
  ) {
    merged.arc = header.arc;
    usedFallback = true;
  }

  if (usedFallback) {
    const advisory = parseAuthenticationResultsAdvisory(headerText);
    merged.error =
      'Live-DNS-Prüfung nicht verfügbar — Werte aus Authentication-Results des empfangenden Servers' +
      (advisory ? ` (${advisory}).` : '.') +
      ' Für vollständige Live-Prüfung DNS/VPN prüfen.';
  } else {
    const hint = buildTemperrorHint([merged.spf, merged.dkim, merged.dmarc], headerText);
    if (hint) merged.error = live.error ?? hint;
  }

  return merged;
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

  const headerText = resolveHeaderTextForMailAuth(input);

  try {
    ensureDnsPrefersIpv4();
    const sender = extractEnvelopeSender(headerText ?? input.rawHeaders);
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
    return applyHeaderAuthFallback(
      {
        spf,
        dkim: dkimAgg.label,
        dmarc,
        arc,
        dkimDomains: dkimAgg.domains,
      },
      headerText,
    );
  } catch (e) {
    return applyHeaderAuthFallback(
      {
        spf: 'unknown',
        dkim: 'unknown',
        dmarc: 'unknown',
        arc: 'unknown',
        dkimDomains: [],
        error: e instanceof Error ? e.message : String(e),
      },
      headerText,
    );
  }
}

export function isAuthFailure(label: AuthResultLabel): boolean {
  return label === 'fail' || label === 'permerror';
}
