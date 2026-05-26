import { normalizeEmailAddress } from './email-address-normalize';

export type SenderTrustLevel = 'ok' | 'suspicious';

export type SenderTrustAnalysis = {
  level: SenderTrustLevel;
  reason?: string;
  displayName?: string;
  address?: string;
};

type ParsedFrom = { displayName: string; address: string };

function parseFromJson(fromJson: string | null): ParsedFrom | null {
  if (!fromJson?.trim()) return null;
  try {
    const parsed = JSON.parse(fromJson) as {
      value?: { name?: string; address?: string }[];
    };
    const v = parsed?.value?.[0];
    const address = v?.address?.trim() ?? '';
    if (!address) return null;
    return {
      displayName: (v?.name ?? '').trim(),
      address: normalizeEmailAddress(address),
    };
  } catch {
    return null;
  }
}

function domainOfEmail(address: string): string {
  const at = address.lastIndexOf('@');
  return at >= 0 ? address.slice(at + 1).toLowerCase() : '';
}

/** Domains mentioned in display text (e.g. „Sparkasse“ → sparkasse.de in name). */
function domainsMentionedInText(text: string): string[] {
  const found = new Set<string>();
  const re = /\b([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}\b/gi;
  for (const m of text.matchAll(re)) {
    found.add(m[0].toLowerCase());
  }
  return [...found];
}

function domainsMatch(mentioned: string, actual: string): boolean {
  if (!mentioned || !actual) return true;
  if (mentioned === actual) return true;
  return actual.endsWith(`.${mentioned}`) || mentioned.endsWith(`.${actual}`);
}

/**
 * Heuristic: display name or domain in name does not match the real From address
 * (common phishing / „cloak“ pattern).
 */
export function analyzeSenderTrust(fromJson: string | null): SenderTrustAnalysis {
  const parsed = parseFromJson(fromJson);
  if (!parsed) return { level: 'ok' };

  const { displayName, address } = parsed;
  const addrDomain = domainOfEmail(address);
  if (!addrDomain) return { level: 'ok', displayName, address };

  const emailInName = displayName.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i)?.[0];
  if (emailInName) {
    const normalizedInName = normalizeEmailAddress(emailInName);
    if (normalizedInName !== address) {
      return {
        level: 'suspicious',
        displayName,
        address,
        reason: `Im Anzeigenamen steht „${emailInName}“, tatsächlicher Absender ist „${address}“.`,
      };
    }
  }

  for (const mentioned of domainsMentionedInText(displayName)) {
    if (!domainsMatch(mentioned, addrDomain)) {
      return {
        level: 'suspicious',
        displayName,
        address,
        reason: `Anzeigename verweist auf „${mentioned}“, Absender-Domain ist „${addrDomain}“.`,
      };
    }
  }

  return { level: 'ok', displayName, address };
}
