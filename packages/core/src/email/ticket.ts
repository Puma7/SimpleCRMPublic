import { randomBytes } from 'crypto';

const DEFAULT_TICKET_PREFIX = 'SCR';

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

export function extractTicketFromSubject(subject: string | null): string | null {
  if (!subject) return null;
  const match = subject.match(/\[([A-Z0-9]{2,12})-([A-Z0-9]{3,20})\]/i);
  return match ? `${normalizeTicketPrefix(match[1])}-${match[2]!.toUpperCase()}` : null;
}

export function ensureTicketInSubject(subject: string, ticketCode: string): string {
  if (subject.includes(`[${ticketCode}]`)) return subject;
  return `[${ticketCode}] ${subject}`.trim();
}
