import { randomBytes } from 'crypto';
import { getDb } from '../sqlite-service';
import { EMAIL_THREADS_TABLE, EMAIL_MESSAGES_TABLE } from '../database-schema';
import {
  ensureTicketInSubject,
  extractTicketFromSubject,
  generateTicketCode,
} from '../../packages/core/src/email';

export {
  ensureTicketInSubject,
  extractTicketFromSubject,
  generateTicketCode,
};

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
