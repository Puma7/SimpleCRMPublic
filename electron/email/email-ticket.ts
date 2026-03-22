import { randomBytes } from 'crypto';
import { getDb } from '../sqlite-service';
import { EMAIL_THREADS_TABLE, EMAIL_MESSAGES_TABLE } from '../database-schema';

const TICKET_PREFIX = 'SCR';

export function generateTicketCode(): string {
  const part = randomBytes(3).toString('hex').toUpperCase();
  return `${TICKET_PREFIX}-${part}`;
}

export function extractTicketFromSubject(subject: string | null): string | null {
  if (!subject) return null;
  const m = subject.match(/\[SCR-([A-F0-9]+)\]/i);
  return m ? `${TICKET_PREFIX}-${m[1]!.toUpperCase()}` : null;
}

export function ensureTicketInSubject(subject: string, ticketCode: string): string {
  if (subject.includes(`[${ticketCode}]`)) return subject;
  return `[${ticketCode}] ${subject}`.trim();
}

export function getOrCreateThreadForTicket(ticketCode: string): string {
  const existing = getDb()
    .prepare(`SELECT id FROM ${EMAIL_THREADS_TABLE} WHERE ticket_code = ?`)
    .get(ticketCode) as { id: string } | undefined;
  if (existing) return existing.id;
  const id = `th-${randomBytes(8).toString('hex')}`;
  getDb()
    .prepare(`INSERT INTO ${EMAIL_THREADS_TABLE} (id, ticket_code) VALUES (?, ?)`)
    .run(id, ticketCode);
  return id;
}

export function assignThreadAndTicketToMessage(
  messageId: number,
  input: { subject: string | null; inReplyTo: string | null; referencesHeader: string | null },
): void {
  const fromSubj = extractTicketFromSubject(input.subject);
  let ticket = fromSubj;
  if (!ticket) {
    ticket = generateTicketCode();
  }
  const threadId = getOrCreateThreadForTicket(ticket);
  getDb()
    .prepare(
      `UPDATE ${EMAIL_MESSAGES_TABLE} SET thread_id = ?, ticket_code = ? WHERE id = ? AND thread_id IS NULL`,
    )
    .run(threadId, ticket, messageId);
}
