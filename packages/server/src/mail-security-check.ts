import dns from 'node:dns';

import {
  isCorruptRawHeaders,
  readBoundedResponseJson,
  readBoundedResponseText,
  selectTrustedAuthenticationResults,
} from '@simplecrm/core';
import type { AuthStatus, DKIMVerifyResult } from 'mailauth';

// Byte limits while reading, as on the desktop: the Rspamd URL is configurable
// and may point to a foreign host.
const MAX_RSPAMD_RESPONSE_BYTES = 1024 * 1024;
const MAX_RSPAMD_ERROR_TEXT_BYTES = 64 * 1024;

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

export type RspamdCheckResult = {
  score: number | null;
  action: string | null;
  requiredScore: number | null;
  symbols: string[];
  error?: string;
};

export type RspamdLearnLabel = 'spam' | 'ham';

export type RspamdLearnResult = {
  success: boolean;
  label: RspamdLearnLabel;
  error?: string;
};

export type StoredMailSecurityCheckInput = {
  /** Original bytes (mail-raw-storage.ts); preferred over rawRfc822B64. */
  rawRfc822?: Buffer | null;
  rawRfc822B64?: string | null;
  rawHeaders: string | null;
  bodyText: string | null;
  bodyHtml: string | null;
  mailauthEnabled: boolean;
  mailauthTimeoutMs?: number;
  mailauthAuthenticate?: typeof import('mailauth').authenticate;
  /**
   * authserv-id whose Authentication-Results may stand in for a failed live
   * check (RFC 8601 §5); null/undefined disables that fallback.
   */
  trustedAuthservId?: string | null;
  rspamdEnabled: boolean;
  rspamdUrl: string;
  rspamdTimeoutMs: number;
  fetchImpl?: typeof fetch;
};

export type StoredMailSecurityCheckResult = {
  auth: MailAuthVerification | null;
  rspamd: RspamdCheckResult | null;
  authChecked: boolean;
  rspamdChecked: boolean;
};

type RspamdJson = {
  score?: number;
  action?: string;
  required_score?: number;
  symbols?: Record<string, { score?: number; options?: string[] }>;
};

let dnsResultOrderPatched = false;
const DEFAULT_MAILAUTH_TIMEOUT_MS = 15_000;

export async function runStoredMailSecurityChecks(
  input: StoredMailSecurityCheckInput,
): Promise<StoredMailSecurityCheckResult> {
  const auth = input.mailauthEnabled
    ? await verifyMailAuthentication(input)
    : null;
  const rspamd = input.rspamdEnabled
    ? await checkMessageWithRspamd(input)
    : null;
  return {
    auth,
    rspamd,
    authChecked: auth !== null,
    rspamdChecked: rspamd !== null,
  };
}

export function buildRfc822FromStored(input: {
  /** Original bytes (mail-raw-storage.ts); preferred over rawRfc822B64. */
  rawRfc822?: Buffer | null;
  rawRfc822B64?: string | null;
  rawHeaders: string | null;
  bodyText: string | null;
  bodyHtml: string | null;
}): Buffer | null {
  if (input.rawRfc822 && input.rawRfc822.length > 0) return input.rawRfc822;
  if (input.rawRfc822B64?.trim()) {
    return Buffer.from(input.rawRfc822B64, 'base64');
  }

  const raw = input.rawHeaders?.trim() && !isCorruptRawHeaders(input.rawHeaders)
    ? input.rawHeaders.trim()
    : null;
  if (!raw) return null;

  const headers = raw.replace(/\r?\n/g, '\r\n').replace(/\r\n+$/, '');
  let body = (input.bodyText ?? '').trim();
  if (!body) {
    const html = (input.bodyHtml ?? '').trim();
    if (html) body = html;
  }
  return Buffer.from(`${headers}\r\n\r\n${body}`, 'utf8');
}

export function extractEnvelopeSender(rawHeaders: string | null): string | undefined {
  if (!rawHeaders) return undefined;
  const rp = rawHeaders.match(/^Return-Path:\s*<?([^>\s;]+)>?/im);
  if (rp?.[1]) return rp[1].trim();
  const from = rawHeaders.match(/^From:\s*.*<([^>]+)>/im);
  if (from?.[1]) return from[1].trim();
  const fromPlain = rawHeaders.match(/^From:\s*(\S+@\S+)/im);
  return fromPlain?.[1]?.trim();
}

export async function verifyMailAuthentication(input: {
  /** Original bytes (mail-raw-storage.ts); preferred over rawRfc822B64. */
  rawRfc822?: Buffer | null;
  rawRfc822B64?: string | null;
  rawHeaders: string | null;
  bodyText: string | null;
  bodyHtml: string | null;
  mailauthTimeoutMs?: number;
  mailauthAuthenticate?: typeof import('mailauth').authenticate;
  trustedAuthservId?: string | null;
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

  const trustedAuthservId = input.trustedAuthservId ?? null;
  const headerText = resolveHeaderTextForMailAuth(input, trustedAuthservId);
  try {
    ensureDnsPrefersIpv4();
    const authenticate = input.mailauthAuthenticate ?? (await import('mailauth')).authenticate;
    const result = await withMailauthTimeout(
      authenticate(message, {
        trustReceived: true,
        sender: extractEnvelopeSender(headerText ?? input.rawHeaders),
        disableBimi: true,
      }),
      input.mailauthTimeoutMs,
    );
    const dkimAgg = aggregateDkim(result.dkim);
    return applyHeaderAuthFallback({
      spf: result.spf && typeof result.spf === 'object' ? statusLabel(result.spf.status) : 'none',
      dkim: dkimAgg.label,
      dmarc: result.dmarc && typeof result.dmarc === 'object' ? statusLabel(result.dmarc.status) : 'none',
      arc: result.arc && typeof result.arc === 'object' ? statusLabel(result.arc.status) : 'none',
      dkimDomains: dkimAgg.domains,
    }, headerText, trustedAuthservId);
  } catch (error) {
    return applyHeaderAuthFallback({
      spf: 'unknown',
      dkim: 'unknown',
      dmarc: 'unknown',
      arc: 'unknown',
      dkimDomains: [],
      error: error instanceof Error ? error.message : String(error),
    }, headerText, trustedAuthservId);
  }
}

async function withMailauthTimeout<T>(promise: Promise<T>, timeoutMs?: number): Promise<T> {
  const boundedTimeout = Number.isFinite(timeoutMs)
    ? Math.max(1, Math.min(60_000, Math.floor(Number(timeoutMs))))
    : DEFAULT_MAILAUTH_TIMEOUT_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Mailauth Timeout')), boundedTimeout);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function checkMessageWithRspamd(input: {
  /** Original bytes (mail-raw-storage.ts); preferred over rawRfc822B64. */
  rawRfc822?: Buffer | null;
  rawRfc822B64?: string | null;
  rawHeaders: string | null;
  bodyText: string | null;
  bodyHtml: string | null;
  rspamdUrl: string;
  rspamdTimeoutMs: number;
  fetchImpl?: typeof fetch;
}): Promise<RspamdCheckResult> {
  const message = buildRfc822FromStored(input);
  if (!message) {
    return {
      score: null,
      action: null,
      requiredScore: null,
      symbols: [],
      error: 'Keine Nachricht zum Pruefen',
    };
  }

  const normalized = normalizeRspamdBaseUrl(input.rspamdUrl);
  if (!normalized.ok) {
    return {
      score: null,
      action: null,
      requiredScore: null,
      symbols: [],
      error: normalized.error,
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.rspamdTimeoutMs);
  try {
    const fetchImpl = input.fetchImpl ?? fetch;
    const response = await fetchImpl(`${normalized.baseUrl}/checkv2`, {
      method: 'POST',
      headers: { 'Content-Type': 'message/rfc822' },
      body: new Uint8Array(message),
      signal: controller.signal,
    });
    if (!response.ok) {
      const text = await readBoundedResponseText(response, MAX_RSPAMD_ERROR_TEXT_BYTES).catch(() => '');
      return {
        score: null,
        action: null,
        requiredScore: null,
        symbols: [],
        error: `Rspamd HTTP ${response.status}${text ? `: ${text.slice(0, 200)}` : ''}`,
      };
    }
    const data = await readBoundedResponseJson(response, MAX_RSPAMD_RESPONSE_BYTES) as RspamdJson;
    return {
      score: typeof data.score === 'number' ? data.score : null,
      action: data.action ?? null,
      requiredScore: typeof data.required_score === 'number' ? data.required_score : null,
      symbols: rspamdSymbols(data),
    };
  } catch (error) {
    return {
      score: null,
      action: null,
      requiredScore: null,
      symbols: [],
      error: error instanceof Error && error.name === 'AbortError'
        ? 'Rspamd Timeout'
        : error instanceof Error
          ? error.message
          : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function learnMessageWithRspamd(input: {
  /** Original bytes (mail-raw-storage.ts); preferred over rawRfc822B64. */
  rawRfc822?: Buffer | null;
  rawRfc822B64?: string | null;
  rawHeaders: string | null;
  bodyText: string | null;
  bodyHtml: string | null;
  label: RspamdLearnLabel;
  rspamdUrl: string;
  rspamdTimeoutMs: number;
  fetchImpl?: typeof fetch;
}): Promise<RspamdLearnResult> {
  const message = buildRfc822FromStored(input);
  if (!message) {
    return {
      success: false,
      label: input.label,
      error: 'Keine Nachricht zum Lernen',
    };
  }

  const normalized = normalizeRspamdBaseUrl(input.rspamdUrl);
  if (!normalized.ok) {
    return {
      success: false,
      label: input.label,
      error: normalized.error,
    };
  }

  const endpoint = input.label === 'spam' ? 'learnspam' : 'learnham';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.rspamdTimeoutMs);
  try {
    const fetchImpl = input.fetchImpl ?? fetch;
    const response = await fetchImpl(`${normalized.baseUrl}/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'message/rfc822' },
      body: new Uint8Array(message),
      signal: controller.signal,
    });
    if (!response.ok) {
      const text = await readBoundedResponseText(response, MAX_RSPAMD_ERROR_TEXT_BYTES).catch(() => '');
      return {
        success: false,
        label: input.label,
        error: `Rspamd HTTP ${response.status}${text ? `: ${text.slice(0, 200)}` : ''}`,
      };
    }
    return {
      success: true,
      label: input.label,
    };
  } catch (error) {
    return {
      success: false,
      label: input.label,
      error: error instanceof Error && error.name === 'AbortError'
        ? 'Rspamd Timeout'
        : error instanceof Error
          ? error.message
          : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

function ensureDnsPrefersIpv4(): void {
  if (dnsResultOrderPatched) return;
  try {
    dns.setDefaultResultOrder('ipv4first');
    dnsResultOrderPatched = true;
  } catch {
    // Older Node versions may not expose setDefaultResultOrder.
  }
}

function normalizeResult(raw: string | undefined): AuthResultLabel {
  if (!raw) return 'unknown';
  const result = raw.toLowerCase();
  if (result === 'temperr') return 'temperror';
  if (
    result === 'pass'
    || result === 'fail'
    || result === 'softfail'
    || result === 'neutral'
    || result === 'none'
    || result === 'temperror'
    || result === 'permerror'
    || result === 'policy'
    || result === 'skipped'
  ) {
    return result;
  }
  return 'unknown';
}

function statusLabel(status: AuthStatus | undefined): AuthResultLabel {
  return normalizeResult(status?.result);
}

function aggregateDkim(dkim: DKIMVerifyResult | undefined): {
  label: AuthResultLabel;
  domains: string[];
} {
  if (!dkim?.results?.length) {
    return { label: 'none', domains: [] };
  }
  const domains = dkim.results.map((result) => result.signingDomain).filter(Boolean);
  const results = dkim.results.map((result) => statusLabel(result.status));
  if (results.some((result) => result === 'pass')) return { label: 'pass', domains };
  if (results.some((result) => result === 'fail' || result === 'permerror')) {
    return { label: 'fail', domains };
  }
  return { label: results[0] ?? 'unknown', domains };
}

function resolveHeaderTextForMailAuth(
  input: {
    rawRfc822?: Buffer | null;
    rawRfc822B64?: string | null;
    rawHeaders: string | null;
  },
  trustedAuthservId: string | null,
): string | null {
  const fromStored = input.rawHeaders?.trim() && !isCorruptRawHeaders(input.rawHeaders)
    ? input.rawHeaders
    : null;
  if (fromStored && parseAuthenticationResultsLabels(fromStored, trustedAuthservId)) return fromStored;
  const fromRfc822 = extractHeaderSectionFromStored(input);
  if (fromRfc822 && parseAuthenticationResultsLabels(fromRfc822, trustedAuthservId)) return fromRfc822;
  return fromRfc822 ?? fromStored;
}

function extractHeaderSectionFromStored(input: {
  /** Original bytes (mail-raw-storage.ts); preferred over rawRfc822B64. */
  rawRfc822?: Buffer | null;
  rawRfc822B64?: string | null;
  rawHeaders: string | null;
}): string | null {
  const rawBytes = input.rawRfc822 && input.rawRfc822.length > 0
    ? input.rawRfc822
    : input.rawRfc822B64?.trim() ? Buffer.from(input.rawRfc822B64, 'base64') : null;
  if (rawBytes) {
    try {
      const raw = rawBytes.toString('utf8');
      const separator = raw.search(/\r?\n\r?\n/);
      if (separator >= 0) return raw.slice(0, separator);
    } catch {
      // Invalid stored base64 falls back to raw_headers.
    }
  }
  return input.rawHeaders?.trim() && !isCorruptRawHeaders(input.rawHeaders) ? input.rawHeaders : null;
}

function parseAuthenticationResultsLabels(
  rawHeaders: string | null,
  trustedAuthservId: string | null,
): Partial<Record<'spf' | 'dkim' | 'dmarc' | 'arc', AuthResultLabel>> | null {
  // RFC 8601 §5: any sender can add Authentication-Results, so only the topmost
  // field counts, and only when it carries the account's trusted authserv-id.
  // Lower fields and ARC-Authentication-Results (no ARC chain validation here)
  // never supply or fill in keys.
  const block = selectTrustedAuthenticationResults(rawHeaders, trustedAuthservId);
  if (!block) return null;

  const parsed: Partial<Record<'spf' | 'dkim' | 'dmarc' | 'arc', AuthResultLabel>> = {};
  for (const key of ['spf', 'dkim', 'dmarc', 'arc'] as const) {
    const match = block.match(new RegExp(`\\b${key}\\s*=\\s*([a-z]+)`, 'i'));
    if (!match?.[1]) continue;
    parsed[key] = normalizeResult(match[1]);
  }
  return Object.keys(parsed).length > 0 ? parsed : null;
}

function applyHeaderAuthFallback(
  live: MailAuthVerification,
  headerText: string | null,
  trustedAuthservId: string | null,
): MailAuthVerification {
  const header = parseAuthenticationResultsLabels(headerText, trustedAuthservId);
  if (!header) return live;

  const merged: MailAuthVerification = { ...live, dkimDomains: [...live.dkimDomains] };
  let usedFallback = false;
  for (const key of ['spf', 'dkim', 'dmarc'] as const) {
    const headerLabel = header[key];
    if (headerLabel && !liveCheckUnreliable(headerLabel) && liveCheckUnreliable(live[key])) {
      merged[key] = headerLabel;
      usedFallback = true;
    }
  }
  if (live.arc === 'fail' && (!header.arc || header.arc === 'none')) {
    merged.arc = 'none';
    usedFallback = true;
  } else if (header.arc && !liveCheckUnreliable(header.arc) && (live.arc === 'fail' || liveCheckUnreliable(live.arc))) {
    merged.arc = header.arc;
    usedFallback = true;
  }
  if (usedFallback) {
    merged.error = 'Live-DNS-Pruefung nicht verfuegbar; Werte aus Authentication-Results des empfangenden Servers genutzt.';
  }
  return merged;
}

function liveCheckUnreliable(label: AuthResultLabel): boolean {
  return label === 'temperror' || label === 'unknown';
}

function normalizeRspamdBaseUrl(input: string): { ok: true; baseUrl: string } | { ok: false; error: string } {
  const raw = input.trim();
  if (!raw) return { ok: false, error: 'Rspamd-URL fehlt' };
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return { ok: false, error: 'Rspamd-URL muss http oder https sein' };
    }
    return { ok: true, baseUrl: url.toString().replace(/\/$/, '') };
  } catch {
    return { ok: false, error: 'Rspamd-URL ungueltig' };
  }
}

function rspamdSymbols(data: RspamdJson): string[] {
  if (!data.symbols) return [];
  return Object.entries(data.symbols)
    .filter(([, value]) => (value?.score ?? 0) > 0.01)
    .sort((a, b) => (b[1]?.score ?? 0) - (a[1]?.score ?? 0))
    .slice(0, 12)
    .map(([name, value]) => `${name}(${value?.score?.toFixed(2) ?? '?'})`);
}
