import { randomBytes } from 'crypto';

const DEFAULT_TICKET_PREFIX = 'SCR';
const TICKET_PATTERN = /\[([A-Z0-9]{1,12})-([A-Z0-9]{1,20})\]/gi;

export type TicketCodeOptions = {
  /** Account-specific letter combination/prefix. Defaults to the legacy SCR prefix. */
  prefix?: string | null;
  /** Optional account-local sequence/number range value. Falls back to random legacy token. */
  sequence?: number | string | null;
};

export function normalizeTicketPrefix(prefix?: string | null): string {
  const normalized = String(prefix ?? DEFAULT_TICKET_PREFIX)
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 12);
  return normalized || DEFAULT_TICKET_PREFIX;
}

export function generateTicketCode(options: TicketCodeOptions = {}): string {
  const prefix = normalizeTicketPrefix(options.prefix);
  if (options.sequence !== undefined && options.sequence !== null) {
    const sequence = String(options.sequence).trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (sequence) return `${prefix}-${sequence}`;
  }
  const part = randomBytes(5).toString('hex').toUpperCase();
  return `${prefix}-${part}`;
}

export type ExtractTicketOptions = {
  /** When set, only prefixes in this list (plus legacy SCR) are accepted. */
  allowedPrefixes?: ReadonlySet<string> | readonly string[];
};

function buildAllowedTicketPrefixes(
  allowedPrefixes?: ReadonlySet<string> | readonly string[],
): Set<string> {
  const allowed = new Set<string>([DEFAULT_TICKET_PREFIX]);
  if (!allowedPrefixes) return allowed;
  const values = Array.isArray(allowedPrefixes)
    ? allowedPrefixes
    : Array.from(allowedPrefixes);
  for (let index = 0; index < values.length; index += 1) {
    allowed.add(normalizeTicketPrefix(values[index]));
  }
  return allowed;
}

export function extractTicketFromSubject(
  subject: string | null,
  options?: ExtractTicketOptions,
): string | null {
  if (!subject) return null;
  const allowed = buildAllowedTicketPrefixes(options?.allowedPrefixes);
  const pattern = new RegExp(TICKET_PATTERN.source, TICKET_PATTERN.flags);
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(subject)) !== null) {
    const prefix = normalizeTicketPrefix(match[1]);
    if (!allowed.has(prefix)) continue;
    const suffix = match[2]!.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!suffix) continue;
    return `${prefix}-${suffix}`;
  }
  return null;
}

export function ensureTicketInSubject(subject: string, ticketCode: string): string {
  if (subject.includes(`[${ticketCode}]`)) return subject;
  return `[${ticketCode}] ${subject}`.trim();
}
