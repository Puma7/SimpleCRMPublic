import { getDb } from '../sqlite-service';
import {
  EMAIL_MESSAGES_TABLE,
  EMAIL_THREAD_ALIASES_TABLE,
} from '../database-schema';
import { canonicalThreadId } from './email-thread-resolve';
import { normalizeSubject } from './email-thread-resolve';

export type ThreadAliasWarning = {
  messageId: number;
  accountId: number;
  subject: string | null;
  aliasThreadId: string;
  canonicalThreadId: string;
  confidence: string;
};

/** Cross-account: same normalized subject + overlapping Message-ID → alias (medium). */
export function runCrossAccountThreadHeuristics(messageId: number): ThreadAliasWarning | null {
  const db = getDb();
  if (!db) return null;
  const row = db
    .prepare(
      `SELECT id, account_id, thread_id, subject, message_id, normalized_subject
       FROM ${EMAIL_MESSAGES_TABLE} WHERE id = ?`,
    )
    .get(messageId) as
    | {
        id: number;
        account_id: number;
        thread_id: string | null;
        subject: string | null;
        message_id: string | null;
        normalized_subject: string | null;
      }
    | undefined;
  if (!row?.thread_id) return null;

  const norm = row.normalized_subject ?? normalizeSubject(row.subject);
  if (!norm) return null;

  const mid = row.message_id?.trim().toLowerCase();
  const candidates = db
    .prepare(
      `SELECT id, account_id, thread_id, subject
       FROM ${EMAIL_MESSAGES_TABLE}
       WHERE id != ? AND normalized_subject = ? AND thread_id IS NOT NULL AND thread_id != ?
       LIMIT 20`,
    )
    .all(messageId, norm, row.thread_id) as {
    id: number;
    account_id: number;
    thread_id: string;
    subject: string | null;
  }[];

  for (const c of candidates) {
    if (c.account_id === row.account_id) continue;
    const canonA = canonicalThreadId(row.thread_id);
    const canonB = canonicalThreadId(c.thread_id);
    if (canonA === canonB) continue;

    db.prepare(
      `INSERT OR IGNORE INTO ${EMAIL_THREAD_ALIASES_TABLE}
       (alias_thread_id, canonical_thread_id, confidence, source)
       VALUES (?, ?, 'medium', 'cross_account_subject')`,
    ).run(canonB, canonA);

    return {
      messageId: row.id,
      accountId: row.account_id,
      subject: row.subject,
      aliasThreadId: canonB,
      canonicalThreadId: canonA,
      confidence: 'medium',
    };
  }

  if (mid) {
    const overlap = db
      .prepare(
        `SELECT id, account_id, thread_id, subject FROM ${EMAIL_MESSAGES_TABLE}
         WHERE account_id != ? AND thread_id IS NOT NULL
           AND (LOWER(message_id) = ? OR LOWER(in_reply_to) = ? OR references_header LIKE ?)
         LIMIT 1`,
      )
      .get(row.account_id, mid, mid, `%${mid}%`) as
      | { id: number; account_id: number; thread_id: string; subject: string | null }
      | undefined;
    if (overlap && overlap.thread_id !== row.thread_id) {
      const canonA = canonicalThreadId(row.thread_id);
      const canonB = canonicalThreadId(overlap.thread_id);
      db.prepare(
        `INSERT OR IGNORE INTO ${EMAIL_THREAD_ALIASES_TABLE}
         (alias_thread_id, canonical_thread_id, confidence, source)
         VALUES (?, ?, 'medium', 'cross_account_message_id')`,
      ).run(canonB, canonA);
      return {
        messageId: row.id,
        accountId: row.account_id,
        subject: row.subject,
        aliasThreadId: canonB,
        canonicalThreadId: canonA,
        confidence: 'medium',
      };
    }
  }

  return null;
}

export function listPendingThreadAliasWarnings(limit = 50): ThreadAliasWarning[] {
  const db = getDb();
  if (!db) return [];
  return db
    .prepare(
      `SELECT m.id AS messageId, m.account_id AS accountId, m.subject,
              a.alias_thread_id AS aliasThreadId, a.canonical_thread_id AS canonicalThreadId,
              a.confidence
       FROM ${EMAIL_THREAD_ALIASES_TABLE} a
       JOIN ${EMAIL_MESSAGES_TABLE} m ON m.thread_id = a.alias_thread_id
       WHERE a.source LIKE 'cross_account%'
       ORDER BY a.created_at DESC
       LIMIT ?`,
    )
    .all(limit) as ThreadAliasWarning[];
}
