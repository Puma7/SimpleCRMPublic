import { getDb } from '../sqlite-service';
import { EMAIL_MESSAGES_TABLE, EMAIL_THREADS_TABLE } from '../database-schema';
import { extractTicketFromSubject, generateTicketCode, getOrCreateThreadForTicket } from './email-ticket';

function normId(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.trim().replace(/^<|>$/g, '').toLowerCase();
  return s || null;
}

function parseReferences(refs: string | null): string[] {
  if (!refs) return [];
  return refs
    .split(/\s+/)
    .map((x) => normId(x))
    .filter((x): x is string => Boolean(x));
}

function collectRelatedIds(messageId: string | null, inReplyTo: string | null, refs: string | null): string[] {
  const s = new Set<string>();
  const m = normId(messageId);
  if (m) s.add(m);
  const ir = normId(inReplyTo);
  if (ir) s.add(ir);
  for (const r of parseReferences(refs)) s.add(r);
  return [...s];
}

function normHeaderCol(col: string): string {
  return `LOWER(TRIM(REPLACE(REPLACE(IFNULL(${col}, ''), '<', ''), '>', '')))`;
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
  const ticketFromSubject = extractTicketFromSubject(input.subject);
  const related = collectRelatedIds(input.messageIdHeader, input.inReplyTo, input.referencesHeader);
  const myMid = normId(input.messageIdHeader);

  if (related.length === 0 && !ticketFromSubject) {
    const ticket = generateTicketCode();
    const threadId = getOrCreateThreadForTicket(ticket);
    getDb()
      .prepare(`UPDATE ${EMAIL_MESSAGES_TABLE} SET thread_id = ?, ticket_code = ? WHERE id = ?`)
      .run(threadId, ticket, messageId);
    return;
  }

  const placeholders = related.map(() => '?').join(',');
  const nMid = normHeaderCol('message_id');
  const nIrt = normHeaderCol('in_reply_to');

  const refClauses: string[] = [];
  const refParams: string[] = [];
  for (const r of related) {
    refClauses.push(`(m.references_header IS NOT NULL AND INSTR(LOWER(m.references_header), ?) > 0)`);
    refParams.push(r);
  }
  const refSql = refClauses.length ? ` OR ${refClauses.join(' OR ')}` : '';

  const myReplyClause = myMid
    ? ` OR ${nIrt} = ? OR (m.references_header IS NOT NULL AND INSTR(LOWER(m.references_header), ?) > 0)`
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
    params.push(myMid, myMid);
  }

  const matches = getDb().prepare(sql).all(...params) as { thread_id: string; ticket_code: string | null }[];

  let threadId: string;
  let ticketCode: string;

  if (matches.length === 0) {
    if (ticketFromSubject) {
      ticketCode = ticketFromSubject;
      threadId = getOrCreateThreadForTicket(ticketCode);
    } else {
      ticketCode = generateTicketCode();
      threadId = getOrCreateThreadForTicket(ticketCode);
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
      ticketCode = generateTicketCode();
    }

    const canonicalThread = getOrCreateThreadForTicket(ticketCode);

    for (const tid of threadIds) {
      if (tid === canonicalThread) continue;
      getDb()
        .prepare(
          `UPDATE ${EMAIL_MESSAGES_TABLE} SET thread_id = ?, ticket_code = ? WHERE account_id = ? AND thread_id = ?`,
        )
        .run(canonicalThread, ticketCode, accountId, tid);
      getDb().prepare(`DELETE FROM ${EMAIL_THREADS_TABLE} WHERE id = ?`).run(tid);
    }
    threadId = canonicalThread;
  }

  getDb()
    .prepare(`UPDATE ${EMAIL_MESSAGES_TABLE} SET thread_id = ?, ticket_code = ? WHERE id = ?`)
    .run(threadId, ticketCode, messageId);
}
