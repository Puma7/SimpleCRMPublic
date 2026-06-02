import type Database from 'better-sqlite3';
import { USER_ACCOUNT_ACCESS_TABLE } from '../database-schema';
import type { SessionRole } from '../auth/session-store';

/** Session slice for scoping unified inbox (`accountScope: 'all'`). */
export type MailScopeSession = { userId: string; role: SessionRole };

/** `null` = no filter (owner/admin); `[]` = no accessible accounts. */
export function accountIdsForMailScopeAll(
  db: Database.Database,
  session: MailScopeSession,
): number[] | null {
  if (session.role === 'owner' || session.role === 'admin') return null;
  const rows = db
    .prepare(
      `SELECT account_id FROM ${USER_ACCOUNT_ACCESS_TABLE} WHERE user_id = ?`,
    )
    .all(session.userId) as { account_id: number }[];
  return rows.map((r) => r.account_id);
}

export function sqlAndAccountIds(
  ids: number[] | null,
  column = 'm.account_id',
): { sql: string; params: number[] } {
  if (ids === null) return { sql: '', params: [] };
  if (ids.length === 0) return { sql: ' AND 1=0', params: [] };
  return {
    sql: ` AND ${column} IN (${ids.map(() => '?').join(',')})`,
    params: ids,
  };
}

export function accountAccessSql(
  db: Database.Database,
  session: MailScopeSession | undefined,
  column = 'm.account_id',
): { sql: string; params: number[] } {
  if (!session) return { sql: '', params: [] };
  return sqlAndAccountIds(accountIdsForMailScopeAll(db, session), column);
}
