import { getSyncInfo } from '../sqlite-service';

/** Domains commonly used for transactional mail (PayPal, Amazon, …) — pre-filter before KI. */
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

const WHITELIST_KEY = 'workflow_sender_whitelist';
const BLACKLIST_KEY = 'workflow_sender_blacklist';

export function parseSenderList(raw: string | null | undefined): string[] {
  return (raw ?? '')
    .split(/[,;\n]+/)
    .map((s) => s.trim().toLowerCase())
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

/** Match full e-mail, @domain suffix, or bare domain (incl. subdomains). */
export function matchSenderList(fromAddress: string, entries: string[]): boolean {
  if (!fromAddress.trim() || entries.length === 0) return false;
  const email = extractSenderEmail(fromAddress);
  const domain = extractSenderDomain(email);
  for (const entry of entries) {
    const e = entry.trim().toLowerCase();
    if (!e) continue;
    if (e.startsWith('@')) {
      const dom = e.slice(1);
      if (email.endsWith(e) || domain === dom || domain.endsWith(`.${dom}`)) return true;
      continue;
    }
    if (e.includes('@')) {
      if (email === e) return true;
      continue;
    }
    if (domain === e || domain.endsWith(`.${e}`)) return true;
  }
  return false;
}

export function getGlobalSenderWhitelist(): string[] {
  return parseSenderList(getSyncInfo(WHITELIST_KEY));
}

export function getGlobalSenderBlacklist(): string[] {
  return parseSenderList(getSyncInfo(BLACKLIST_KEY));
}

export type SenderFilterResult = 'whitelist' | 'blacklist' | 'default';

export function evaluateSenderFilter(
  fromAddress: string,
  opts: {
    useGlobalLists?: boolean;
    useBuiltinTrusted?: boolean;
    extraWhitelist?: string;
    extraBlacklist?: string;
  } = {},
): SenderFilterResult {
  const from = fromAddress.trim();
  if (!from) return 'default';

  const useGlobal = opts.useGlobalLists !== false;
  const whitelist = [
    ...(useGlobal ? getGlobalSenderWhitelist() : []),
    ...parseSenderList(opts.extraWhitelist),
  ];
  const blacklist = [
    ...(useGlobal ? getGlobalSenderBlacklist() : []),
    ...parseSenderList(opts.extraBlacklist),
  ];

  if (whitelist.length > 0 && matchSenderList(from, whitelist)) return 'whitelist';
  if (blacklist.length > 0 && matchSenderList(from, blacklist)) return 'blacklist';

  if (opts.useBuiltinTrusted !== false && matchSenderList(from, BUILTIN_TRUSTED_SENDER_ENTRIES)) {
    return 'whitelist';
  }

  return 'default';
}
