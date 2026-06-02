import { getDb } from '../sqlite-service';
import {
  EMAIL_MESSAGES_TABLE,
  EMAIL_THREAD_ALIASES_TABLE,
  EMAIL_THREAD_EDGES_TABLE,
  EMAIL_THREADS_TABLE,
} from '../database-schema';
import type { AccountMailView, EmailMessageRow } from './email-store';
import { listMessagesForMailScope } from './email-store';
import { generateTicketCode } from './email-ticket';

const MAX_REF_IDS = 64;

export function canonicalThreadId(threadId: string): string {
  const db = getDb();
  if (!db) return threadId;
  let current = threadId;
  for (let i = 0; i < 8; i++) {
    const row = db
      .prepare(
        `SELECT canonical_thread_id FROM ${EMAIL_THREAD_ALIASES_TABLE} WHERE alias_thread_id = ?`,
      )
      .get(current) as { canonical_thread_id: string } | undefined;
    if (!row) break;
    current = row.canonical_thread_id;
  }
  return current;
}

export function rebuildThreadEdges(threadId: string): void {
  const db = getDb();
  if (!db) return;
  const canon = canonicalThreadId(threadId);
  const messages = db
    .prepare(
      `SELECT id, message_id, in_reply_to, references_header, date_received
       FROM ${EMAIL_MESSAGES_TABLE} WHERE thread_id = ? OR thread_id IN (
         SELECT alias_thread_id FROM ${EMAIL_THREAD_ALIASES_TABLE} WHERE canonical_thread_id = ?
       )
       ORDER BY date_received ASC`,
    )
    .all(canon, canon) as {
    id: number;
    message_id: string | null;
    in_reply_to: string | null;
    references_header: string | null;
  }[];

  const ids = messages.map((m) => m.id);
  if (ids.length === 0) return;

  db.prepare(`DELETE FROM ${EMAIL_THREAD_EDGES_TABLE} WHERE child_message_id IN (${ids.map(() => '?').join(',')})`).run(...ids);

  const byMid = new Map<string, number>();
  for (const m of messages) {
    if (m.message_id) byMid.set(m.message_id.trim().toLowerCase(), m.id);
  }

  const ins = db.prepare(
    `INSERT OR IGNORE INTO ${EMAIL_THREAD_EDGES_TABLE} (parent_message_id, child_message_id) VALUES (?, ?)`,
  );

  for (const m of messages) {
    const refs: string[] = [];
    if (m.in_reply_to) refs.push(m.in_reply_to.trim());
    if (m.references_header) {
      for (const part of m.references_header.split(/\s+/)) {
        if (part.trim()) refs.push(part.trim());
        if (refs.length >= MAX_REF_IDS) break;
      }
    }
    let parentId: number | null = null;
    for (const ref of refs) {
      const pid = byMid.get(ref.toLowerCase());
      if (pid != null && pid !== m.id) {
        parentId = pid;
        break;
      }
    }
    if (parentId != null) {
      ins.run(parentId, m.id);
    }
  }
}

export function upsertThreadAggregates(threadId: string): void {
  const db = getDb();
  if (!db) return;
  const canon = canonicalThreadId(threadId);
  const stats = db
    .prepare(
      `SELECT COUNT(*) AS cnt,
              MAX(date_received) AS last_at,
              MAX(CASE WHEN seen_local = 0 AND uid >= 0 THEN 1 ELSE 0 END) AS has_unread,
              MAX(has_attachments) AS has_att
       FROM ${EMAIL_MESSAGES_TABLE}
       WHERE thread_id = ? OR thread_id IN (
         SELECT alias_thread_id FROM ${EMAIL_THREAD_ALIASES_TABLE} WHERE canonical_thread_id = ?
       )`,
    )
    .get(canon, canon) as {
    cnt: number;
    last_at: string | null;
    has_unread: number;
    has_att: number;
  };
  if (!stats || stats.cnt === 0) return;
  const ticketRow = db
    .prepare(
      `SELECT ticket_code FROM ${EMAIL_THREADS_TABLE} WHERE id = ?
       UNION SELECT ticket_code FROM ${EMAIL_MESSAGES_TABLE} WHERE thread_id = ? AND ticket_code IS NOT NULL LIMIT 1`,
    )
    .get(canon, canon) as { ticket_code: string } | undefined;
  const ticketCode = ticketRow?.ticket_code ?? generateTicketCode();
  db.prepare(
    `INSERT INTO ${EMAIL_THREADS_TABLE} (id, ticket_code, message_count, last_message_at, has_unread, has_attachments)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       message_count = excluded.message_count,
       last_message_at = excluded.last_message_at,
       has_unread = excluded.has_unread,
       has_attachments = excluded.has_attachments`,
  ).run(canon, ticketCode, stats.cnt, stats.last_at, stats.has_unread, stats.has_att);
}

export function rebuildThreadAggregates(): void {
  const db = getDb();
  if (!db) return;
  const threads = db
    .prepare(`SELECT DISTINCT thread_id AS id FROM ${EMAIL_MESSAGES_TABLE} WHERE thread_id IS NOT NULL AND thread_id != ''`)
    .all() as { id: string }[];
  for (const t of threads) {
    rebuildThreadEdges(t.id);
    upsertThreadAggregates(t.id);
  }
}

export function listThreadMessages(
  threadId: string,
  limit = 50,
  offset = 0,
): EmailMessageRow[] {
  const db = getDb();
  if (!db) return [];
  const canon = canonicalThreadId(threadId);
  return db
    .prepare(
      `SELECT m.* FROM ${EMAIL_MESSAGES_TABLE} m
       WHERE m.thread_id = ? OR m.thread_id IN (
         SELECT alias_thread_id FROM ${EMAIL_THREAD_ALIASES_TABLE} WHERE canonical_thread_id = ?
       )
       ORDER BY m.date_received ASC LIMIT ? OFFSET ?`,
    )
    .all(canon, canon, limit, offset) as EmailMessageRow[];
}

export type ThreadListRow = {
  threadId: string;
  messageCount: number;
  lastMessageAt: string | null;
  hasUnread: boolean;
  subject: string | null;
  latestMessageId: number | null;
};

export function listThreadsForMailScope(
  accountScope: number | 'all',
  view: AccountMailView,
  opts: { limit?: number; offset?: number } = {},
): ThreadListRow[] {
  const messages = listMessagesForMailScope(accountScope, view, {
    limit: 500,
    offset: 0,
  });
  const byThread = new Map<string, EmailMessageRow[]>();
  for (const m of messages) {
    const key =
      m.thread_id?.trim() ||
      m.imap_thread_id?.trim() ||
      m.ticket_code?.trim() ||
      `m:${m.id}`;
    const canon = m.thread_id ? canonicalThreadId(m.thread_id) : key;
    const arr = byThread.get(canon) ?? [];
    arr.push(m);
    byThread.set(canon, arr);
  }
  const rows: ThreadListRow[] = [];
  for (const [threadId, msgs] of byThread) {
    const sorted = [...msgs].sort((a, b) => (b.date_received ?? '').localeCompare(a.date_received ?? ''));
    const latest = sorted[0]!;
    rows.push({
      threadId,
      messageCount: msgs.length,
      lastMessageAt: latest.date_received,
      hasUnread: msgs.some((x) => x.seen_local === 0 && x.uid >= 0),
      subject: sorted[sorted.length - 1]?.subject ?? latest.subject,
      latestMessageId: latest.id,
    });
  }
  rows.sort((a, b) => (b.lastMessageAt ?? '').localeCompare(a.lastMessageAt ?? ''));
  const off = opts.offset ?? 0;
  const lim = opts.limit ?? 100;
  return rows.slice(off, off + lim);
}
