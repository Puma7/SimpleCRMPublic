import Database from 'better-sqlite3';
import {
  accountIdsForMailScopeAll,
  sqlAndAccountIds,
} from '../../electron/email/mail-scope-access';
import {
  EMAIL_ACCOUNTS_TABLE,
  USER_ACCOUNT_ACCESS_TABLE,
} from '../../electron/database-schema';

describe('mail-scope-access', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE ${EMAIL_ACCOUNTS_TABLE} (id INTEGER PRIMARY KEY);
      CREATE TABLE ${USER_ACCOUNT_ACCESS_TABLE} (
        user_id TEXT, account_id INTEGER, access_level TEXT
      );
    `);
    db.prepare(`INSERT INTO ${EMAIL_ACCOUNTS_TABLE} (id) VALUES (1), (2), (3)`).run();
    db.prepare(
      `INSERT INTO ${USER_ACCOUNT_ACCESS_TABLE} (user_id, account_id, access_level) VALUES ('u1', 1, 'ro'), ('u1', 2, 'ro')`,
    ).run();
  });

  afterEach(() => {
    db.close();
  });

  it('owner/admin: no account filter for unified inbox', () => {
    expect(accountIdsForMailScopeAll(db, { userId: 'o', role: 'owner' })).toBeNull();
    expect(sqlAndAccountIds(null).sql).toBe('');
  });

  it('agent: only assigned accounts', () => {
    expect(accountIdsForMailScopeAll(db, { userId: 'u1', role: 'agent' })).toEqual([1, 2]);
    const { sql, params } = sqlAndAccountIds([1, 2]);
    expect(sql).toContain('IN (?,?)');
    expect(params).toEqual([1, 2]);
  });

  it('agent with no grants: empty IN blocks all rows', () => {
    const { sql } = sqlAndAccountIds([]);
    expect(sql).toBe(' AND 1=0');
  });
});
