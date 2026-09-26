import { getDb } from '../sqlite-service';
import { EMAIL_MESSAGES_TABLE, EMAIL_THREADS_TABLE } from '../database-schema';
// Shared with the server resolver: only plausible msg-ids (id@right, >= 5 chars, no
// brackets/whitespace) link conversations, so a bare token like "com" matches nothing. (C-A62)
import { collectRelatedIds, normalizeThreadingMessageId } from '../../packages/core/src/email';
import { createTicketCodeForAccount, extractKnownTicketFromSubject, getOrCreateThreadForTicket } from './email-ticket';
import { rebuildThreadEdges } from './email-thread-aggregate';
import { applyMessageThreadMetadata, confidenceForJwzAssign } from './email-thread-metadata';

function normHeaderCol(col: string): string {
  return `LOWER(TRIM(REPLACE(REPLACE(IFNULL(${col}, ''), '<', ''), '>', '')))`;
}

/**
 * A References column as a space-delimited token list (" id1 id2 "): brackets and folding
 * whitespace become separators, so an id matches only a whole reference, never a substring.
 */
function refTokensCol(col: string): string {
  return `(' ' || LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(${col}, '<', ' '), '>', ' '), char(9), ' '), char(13), ' '), char(10), ' ')) || ' ')`;
}

/** LIKE pattern for one whole token of refTokensCol; %, _ and \ match literally. */
function refTokenPattern(id: string): string {
  return `% ${id.replace(/[\\%_]/g, (c) => `\\${c}`)} %`;
}

/**
 * Thread messages by RFC headers (Message-ID, In-Reply-To, References) within one account.
 * Merges existing `thread_id` groups when a new message links them.
 */
export function assignJwzThreadAndTicket(
  messageId: number,
  accountId: number,
  input: {
    messageIdHeader: string | null;
    inReplyTo: string | null;
    referencesHeader: string | null;
    subject: string | null;
  },
): void {
  const ticketFromSubject = extractKnownTicketFromSubject(input.subject);
  const related = collectRelatedIds(input.messageIdHeader, input.inReplyTo, input.referencesHeader);
  const myMid = normalizeThreadingMessageId(input.messageIdHeader);

  if (related.length === 0 && !ticketFromSubject) {
    const ticket = createTicketCodeForAccount(accountId);
    const threadId = getOrCreateThreadForTicket(ticket, accountId);
    getDb()
      .prepare(`UPDATE ${EMAIL_MESSAGES_TABLE} SET thread_id = ?, ticket_code = ? WHERE id = ?`)
      .run(threadId, ticket, messageId);
    return;
  }

  const placeholders = related.map(() => '?').join(',');
  const nMid = normHeaderCol('message_id');
  const nIrt = normHeaderCol('in_reply_to');
  const refMatch = `(m.references_header IS NOT NULL AND ${refTokensCol('m.references_header')} LIKE ? ESCAPE '\\')`;

  const refClauses: string[] = [];
  const refParams: string[] = [];
  for (const r of related) {
    refClauses.push(refMatch);
    refParams.push(refTokenPattern(r));
  }
  const refSql = refClauses.length ? ` OR ${refClauses.join(' OR ')}` : '';

  const myReplyClause = myMid
    ? ` OR ${nIrt} = ? OR ${refMatch}`
    : '';

  const sql = `
    SELECT DISTINCT m.thread_id, m.ticket_code
    FROM ${EMAIL_MESSAGES_TABLE} m
    WHERE m.account_id = ?
      AND m.thread_id IS NOT NULL
      AND m.id != ?
      AND (
        ${nMid} IN (${placeholders})
        OR ${nIrt} IN (${placeholders})
        ${refSql}
        ${myReplyClause}
      )
  `;

  const params: unknown[] = [accountId, messageId, ...related, ...related, ...refParams];
  if (myMid) {
    params.push(myMid, refTokenPattern(myMid));
  }

  const matches = getDb().prepare(sql).all(...params) as { thread_id: string; ticket_code: string | null }[];

  let threadId: string;
  let ticketCode: string;

  if (matches.length === 0) {
    if (ticketFromSubject) {
      ticketCode = ticketFromSubject;
      threadId = getOrCreateThreadForTicket(ticketCode, accountId);
    } else {
      ticketCode = createTicketCodeForAccount(accountId);
      threadId = getOrCreateThreadForTicket(ticketCode, accountId);
    }
  } else {
    const threadIds = [...new Set(matches.map((m) => m.thread_id))].sort();
    threadId = threadIds[0]!;
    const existingTickets = matches.map((m) => m.ticket_code).filter((t): t is string => Boolean(t));
    if (ticketFromSubject) {
      ticketCode = ticketFromSubject;
    } else if (existingTickets.length > 0) {
      ticketCode = [...new Set(existingTickets)].sort()[0]!;
    } else {
      ticketCode = createTicketCodeForAccount(accountId);
    }

    const canonicalThread = getOrCreateThreadForTicket(ticketCode, accountId);

    for (const tid of threadIds) {
      if (tid === canonicalThread) continue;
      getDb()
        .prepare(
          `UPDATE ${EMAIL_MESSAGES_TABLE} SET thread_id = ?, ticket_code = ? WHERE account_id = ? AND thread_id = ?`,
        )
        .run(canonicalThread, ticketCode, accountId, tid);
      const stillRef = getDb()
        .prepare(`SELECT 1 FROM ${EMAIL_MESSAGES_TABLE} WHERE thread_id = ? LIMIT 1`)
        .get(tid) as { 1: number } | undefined;
      if (!stillRef) {
        getDb().prepare(`DELETE FROM ${EMAIL_THREADS_TABLE} WHERE id = ?`).run(tid);
      }
    }
    threadId = canonicalThread;
  }

  getDb()
    .prepare(`UPDATE ${EMAIL_MESSAGES_TABLE} SET thread_id = ?, ticket_code = ? WHERE id = ?`)
    .run(threadId, ticketCode, messageId);

  const row = getDb()
    .prepare(`SELECT subject, from_json FROM ${EMAIL_MESSAGES_TABLE} WHERE id = ?`)
    .get(messageId) as { subject: string | null; from_json: string | null };
  applyMessageThreadMetadata(messageId, accountId, {
    subject: row?.subject ?? input.subject,
    from_json: row?.from_json ?? null,
    ticket_code: ticketCode,
    thread_id: threadId,
    serverThreadSource: 'jwz_headers',
  });
  const conf = confidenceForJwzAssign(Boolean(ticketFromSubject), matches.length);
  getDb()
    .prepare(`UPDATE ${EMAIL_MESSAGES_TABLE} SET thread_confidence = ? WHERE id = ?`)
    .run(conf, messageId);

  rebuildThreadEdges(threadId);
}
