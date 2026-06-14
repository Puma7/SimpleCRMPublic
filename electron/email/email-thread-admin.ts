import { getDb } from '../sqlite-service';
import {
  EMAIL_MESSAGES_TABLE,
  EMAIL_THREAD_ALIASES_TABLE,
  EMAIL_THREADS_TABLE,
} from '../database-schema';
import { createTicketCodeForAccount, getOrCreateThreadForTicket } from './email-ticket';
import { rebuildThreadEdges, upsertThreadAggregates } from './email-thread-aggregate';
import { canonicalThreadId, wouldCreateThreadAliasCycle } from './email-thread-resolve';

/** Merge alias thread into canonical (non-destructive alias row). */
export function mergeThreads(
  aliasThreadId: string,
  canonicalThreadId: string,
  accountId: number,
  source = 'manual_merge',
): { ok: true } | { ok: false; error: string } {
  const db = getDb();
  if (!db) return { ok: false, error: 'Database not initialized' };
  const alias = aliasThreadId.trim();
  const canon = canonicalThreadId.trim();
  if (!alias || !canon) return { ok: false, error: 'Thread-IDs erforderlich' };
  if (alias === canon) return { ok: false, error: 'Gleiche Thread-ID' };
  if (wouldCreateThreadAliasCycle(alias, canon)) {
    return { ok: false, error: 'Thread-Zusammenführung würde einen Alias-Zyklus erzeugen' };
  }

  db.prepare(
    `INSERT OR REPLACE INTO ${EMAIL_THREAD_ALIASES_TABLE}
     (alias_thread_id, canonical_thread_id, confidence, source)
     VALUES (?, ?, 'high', ?)`,
  ).run(alias, canon, source);

  db.prepare(
    `UPDATE ${EMAIL_MESSAGES_TABLE} SET thread_id = ? WHERE thread_id = ? AND account_id = ?`,
  ).run(canon, alias, accountId);
  const orphan = db
    .prepare(`SELECT 1 FROM ${EMAIL_MESSAGES_TABLE} WHERE thread_id = ? LIMIT 1`)
    .get(alias);
  if (!orphan) {
    db.prepare(`DELETE FROM ${EMAIL_THREADS_TABLE} WHERE id = ?`).run(alias);
  }
  rebuildThreadEdges(canon);
  upsertThreadAggregates(canon);
  return { ok: true };
}

/** Split one message into its own thread (new ticket). */
export function splitMessageToOwnThread(messageId: number): { ok: true; threadId: string } | { ok: false; error: string } {
  const db = getDb();
  if (!db) return { ok: false, error: 'Database not initialized' };
  const row = db
    .prepare(`SELECT thread_id, ticket_code, account_id FROM ${EMAIL_MESSAGES_TABLE} WHERE id = ?`)
    .get(messageId) as { thread_id: string | null; ticket_code: string | null; account_id: number | null } | undefined;
  if (!row) return { ok: false, error: 'Nachricht nicht gefunden' };

  const ticket = createTicketCodeForAccount(row.account_id);
  const threadId = getOrCreateThreadForTicket(ticket, row.account_id);
  db.prepare(`UPDATE ${EMAIL_MESSAGES_TABLE} SET thread_id = ?, ticket_code = ? WHERE id = ?`).run(
    threadId,
    ticket,
    messageId,
  );
  rebuildThreadEdges(threadId);
  upsertThreadAggregates(threadId);
  if (row.thread_id) {
    upsertThreadAggregates(canonicalThreadId(row.thread_id));
  }
  return { ok: true, threadId };
}
