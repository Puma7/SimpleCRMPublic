import { authenticate, type AuthStatus, type DKIMVerifyResult } from 'mailauth';
import { buildRfc822FromStored, extractEnvelopeSender } from './mail-rfc822-build';

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
    return {
      spf,
      dkim: dkimAgg.label,
      dmarc,
      arc,
      dkimDomains: dkimAgg.domains,
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
