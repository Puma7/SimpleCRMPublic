import { randomBytes } from 'crypto';
import { getDb } from '../sqlite-service';
import { EMAIL_THREADS_TABLE, EMAIL_MESSAGES_TABLE } from '../database-schema';
import {
  ensureTicketInSubject,
  extractTicketFromSubject,
  generateTicketCode,
} from '../../packages/core/src/email';
import { allocateNextTicketCodeForAccount, listKnownTicketPrefixes } from './account-mail-settings-store';

export {
  ensureTicketInSubject,
  extractTicketFromSubject,
  generateTicketCode,
};

export function extractKnownTicketFromSubject(subject: string | null): string | null {
  return extractTicketFromSubject(subject, { allowedPrefixes: listKnownTicketPrefixes() });
}

export function getOrCreateThreadForTicket(ticketCode: string, accountId?: number | null): string {
  const accountValue = accountId ?? null;
  const existing = getDb()
    .prepare(
      `SELECT id FROM ${EMAIL_THREADS_TABLE} WHERE ticket_code = ? AND ((account_id IS NULL AND ? IS NULL) OR account_id = ?)`,
    )
    .get(ticketCode, accountValue, accountValue) as { id: string } | undefined;
  if (existing) return existing.id;
  const id = `th-${randomBytes(12).toString('hex')}`;
  getDb()
    .prepare(`INSERT INTO ${EMAIL_THREADS_TABLE} (id, ticket_code, account_id) VALUES (?, ?, ?)`)
    .run(id, ticketCode, accountValue);
  return id;
}

function isAccountMailSettingsUnavailable(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /no such table:\s*email_account_mail_settings/i.test(error.message);
}

export function createTicketCodeForAccount(accountId?: number | null): string {
  if (accountId == null) {
    return generateTicketCode();
  }
  try {
    return allocateNextTicketCodeForAccount(accountId);
  } catch (error) {
    if (!isAccountMailSettingsUnavailable(error)) {
      throw error;
    }
    console.warn(
      '[email-ticket] account mail settings table unavailable; using legacy ticket code',
      { accountId },
    );
    return generateTicketCode();
  }
}

export function assignThreadAndTicketToMessage(
  messageId: number,
  input: { subject: string | null; inReplyTo: string | null; referencesHeader: string | null; accountId?: number | null; ticketPrefix?: string | null; ticketSequence?: number | string | null },
): void {
  const fromSubj = extractKnownTicketFromSubject(input.subject);
  let ticket = fromSubj;
  if (!ticket) {
    ticket = generateTicketCode({ prefix: input.ticketPrefix, sequence: input.ticketSequence });
  }
  const threadId = getOrCreateThreadForTicket(ticket, input.accountId);
  getDb()
    .prepare(
      `UPDATE ${EMAIL_MESSAGES_TABLE} SET thread_id = ?, ticket_code = ? WHERE id = ? AND thread_id IS NULL`,
    )
    .run(threadId, ticket, messageId);
}
