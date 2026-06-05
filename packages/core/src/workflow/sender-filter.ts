/** Domains commonly used for transactional mail. Used as pre-filter before AI classification. */
export const BUILTIN_TRUSTED_SENDER_ENTRIES = [
  'paypal.com',
  'paypal.de',
  'amazon.com',
  'amazon.de',
  'amazon.co.uk',
  'amazon.fr',
  'notifications.amazon.com',
  'email.amazon.com',
  'lidl.com',
  'lidl.de',
  'noreply@lidl.de',
  'stripe.com',
  'google.com',
  'microsoft.com',
  'outlook.com',
  'dhl.de',
  'dhl.com',
  'fedex.com',
  'ups.com',
];

export type SenderFilterResult = 'whitelist' | 'blacklist' | 'default';

export function parseSenderList(raw: string | null | undefined): string[] {
  return (raw ?? '')
    .split(/[,;\n]+/)
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

export function extractSenderEmail(fromAddress: string): string {
  const trimmed = fromAddress.trim();
  const angle = /<([^>]+)>/.exec(trimmed);
  if (angle?.[1]) return angle[1].trim().toLowerCase();

  const plain = /[\w.+-]+@[\w.-]+\.[a-z]{2,}/i.exec(trimmed);
  return (plain?.[0] ?? trimmed).toLowerCase();
}

export function extractSenderDomain(email: string): string {
  const at = email.lastIndexOf('@');
  return at >= 0 ? email.slice(at + 1) : email;
}

/** Match full email, @domain suffix, or bare domain including subdomains. */
export function matchSenderList(fromAddress: string, entries: readonly string[]): boolean {
  if (!fromAddress.trim() || entries.length === 0) return false;

  const email = extractSenderEmail(fromAddress);
  const domain = extractSenderDomain(email);

  for (const entry of entries) {
    const candidate = entry.trim().toLowerCase();
    if (!candidate) continue;

    if (candidate.startsWith('@')) {
      const candidateDomain = candidate.slice(1);
      if (email.endsWith(candidate) || domain === candidateDomain || domain.endsWith(`.${candidateDomain}`)) {
        return true;
      }
      continue;
    }

    if (candidate.includes('@')) {
      if (email === candidate) return true;
      continue;
    }

    if (domain === candidate || domain.endsWith(`.${candidate}`)) return true;
  }

  return false;
}

export function evaluateSenderFilterFromLists(
  fromAddress: string,
  opts: {
    whitelist?: readonly string[];
    blacklist?: readonly string[];
    extraWhitelist?: string;
    extraBlacklist?: string;
    useBuiltinTrusted?: boolean;
  } = {},
): SenderFilterResult {
  const from = fromAddress.trim();
  if (!from) return 'default';

  const whitelist = [
    ...(opts.whitelist ?? []),
    ...parseSenderList(opts.extraWhitelist),
  ];
  const blacklist = [
    ...(opts.blacklist ?? []),
    ...parseSenderList(opts.extraBlacklist),
  ];

  if (whitelist.length > 0 && matchSenderList(from, whitelist)) return 'whitelist';
  if (blacklist.length > 0 && matchSenderList(from, blacklist)) return 'blacklist';

  if (opts.useBuiltinTrusted !== false && matchSenderList(from, BUILTIN_TRUSTED_SENDER_ENTRIES)) {
    return 'whitelist';
  }

  return 'default';
}
