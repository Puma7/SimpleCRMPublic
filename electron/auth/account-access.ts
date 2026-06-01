import Database from 'better-sqlite3';
import { USER_ACCOUNT_ACCESS_TABLE } from '../database-schema';
import type { SessionRole } from './session-store';

export type AccountAccessLevel = 'rw' | 'ro' | 'send_only';

const LEVEL_RANK: Record<AccountAccessLevel, number> = {
  ro: 1,
  send_only: 2,
  rw: 3,
};

export function canAccessAccount(
  db: Database.Database,
  userId: string,
  accountId: number,
  required: AccountAccessLevel,
  role: SessionRole,
): boolean {
  if (role === 'owner' || role === 'admin') return true;
  const row = db
    .prepare(
      `SELECT access_level FROM ${USER_ACCOUNT_ACCESS_TABLE} WHERE user_id = ? AND account_id = ?`,
    )
    .get(userId, accountId) as { access_level: string } | undefined;
  if (!row) return false;
  const have = row.access_level as AccountAccessLevel;
  return (LEVEL_RANK[have] ?? 0) >= (LEVEL_RANK[required] ?? 99);
}
