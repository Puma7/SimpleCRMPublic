import { randomBytes } from 'crypto';

const TICKET_PREFIX = 'SCR';

export function generateTicketCode(): string {
  const part = randomBytes(5).toString('hex').toUpperCase();
  return `${TICKET_PREFIX}-${part}`;
}

export function extractTicketFromSubject(subject: string | null): string | null {
  if (!subject) return null;
  const match = subject.match(/\[SCR-([A-F0-9]{6,10})\]/i);
  return match ? `${TICKET_PREFIX}-${match[1]!.toUpperCase()}` : null;
}

export function ensureTicketInSubject(subject: string, ticketCode: string): string {
  if (subject.includes(`[${ticketCode}]`)) return subject;
  return `[${ticketCode}] ${subject}`.trim();
}
