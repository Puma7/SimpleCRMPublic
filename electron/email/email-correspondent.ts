import { getDb } from '../sqlite-service';
import { EMAIL_MESSAGES_TABLE } from '../database-schema';
import type { EmailMessageRow } from './email-store';

/** Escape `%` and `_` for SQL LIKE. */
export function likePatternContainsEmail(email: string): string {
  const e = email.trim().toLowerCase();
  return `%${e.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')}%`;
}

/** All messages involving an email address (from/to/cc), any folder except trash. */
export function listMessagesByCorrespondentEmail(
  accountScope: number | 'all',
  opts: {
    email: string;
    excludeMessageId?: number;
    limit?: number;
  },
): EmailMessageRow[] {
  const normalized = opts.email.trim().toLowerCase();
  if (!normalized.includes('@')) return [];

  const limit = Math.min(opts.limit ?? 50, 100);
  const pattern = likePatternContainsEmail(normalized);
  const clauses: string[] = ['m.soft_deleted = 0'];
  const params: (string | number)[] = [];

  if (accountScope !== 'all') {
    clauses.push('m.account_id = ?');
    params.push(accountScope);
  }
  if (opts.excludeMessageId != null) {
    clauses.push('m.id != ?');
    params.push(opts.excludeMessageId);
  }

  clauses.push(
    `(LOWER(COALESCE(m.from_json, '')) LIKE ? ESCAPE '\\'
      OR LOWER(COALESCE(m.to_json, '')) LIKE ? ESCAPE '\\'
      OR LOWER(COALESCE(m.cc_json, '')) LIKE ? ESCAPE '\\'
      OR LOWER(COALESCE(m.bcc_json, '')) LIKE ? ESCAPE '\\')`,
  );
  params.push(pattern, pattern, pattern, pattern);
  params.push(limit);

  const sql = `SELECT m.* FROM ${EMAIL_MESSAGES_TABLE} m
    WHERE ${clauses.join(' AND ')}
    ORDER BY datetime(COALESCE(m.date_received, m.created_at)) DESC
    LIMIT ?`;

  return getDb().prepare(sql).all(...params) as EmailMessageRow[];
}
