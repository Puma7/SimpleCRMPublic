import { getDb } from '../sqlite-service';
import { EMAIL_MESSAGES_TABLE, EMAIL_THREADS_TABLE } from '../database-schema';
import {
  normalizeSubject,
  resolveThreadListKey,
  type ThreadConfidence,
} from './email-thread-resolve';

export function applyMessageThreadMetadata(
  messageId: number,
  accountId: number,
  input: {
    subject: string | null;
    from_json: string | null;
    ticket_code?: string | null;
    imap_thread_id?: string | null;
    thread_id?: string | null;
    serverThreadSource?: string;
  },
): void {
  const db = getDb();
  if (!db) return;
  const row = db
    .prepare(
      `SELECT id, account_id, ticket_code, imap_thread_id, thread_id, subject, from_json
       FROM ${EMAIL_MESSAGES_TABLE} WHERE id = ?`,
    )
    .get(messageId) as
    | {
        id: number;
        account_id: number;
        ticket_code: string | null;
        imap_thread_id: string | null;
        thread_id: string | null;
        subject: string | null;
        from_json: string | null;
      }
    | undefined;
  if (!row) return;

  const merged = {
    id: row.id,
    account_id: accountId,
    ticket_code: input.ticket_code ?? row.ticket_code,
    imap_thread_id: input.imap_thread_id ?? row.imap_thread_id,
    thread_id: input.thread_id ?? row.thread_id,
    subject: input.subject ?? row.subject,
    from_json: input.from_json ?? row.from_json,
  };
  const { confidence, resolver } = resolveThreadListKey(merged);
  const normSubj = normalizeSubject(merged.subject);
  db.prepare(
    `UPDATE ${EMAIL_MESSAGES_TABLE}
     SET thread_confidence = ?, thread_resolver_version = 1,
         normalized_subject = ?, server_thread_source = ?
     WHERE id = ?`,
  ).run(confidence, normSubj || null, input.serverThreadSource ?? resolver, messageId);

  if (merged.thread_id && normSubj) {
    db.prepare(
      `UPDATE ${EMAIL_THREADS_TABLE} SET subject_normalized = ? WHERE id = ?`,
    ).run(normSubj, merged.thread_id);
  }
}

export function confidenceForJwzAssign(hasTicketFromSubject: boolean, matchCount: number): ThreadConfidence {
  if (hasTicketFromSubject) return 'high';
  if (matchCount > 0) return 'medium';
  return 'medium';
}
