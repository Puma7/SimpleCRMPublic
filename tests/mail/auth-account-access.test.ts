import Database from 'better-sqlite3';
import { canAccessAccount } from '../../electron/auth/account-access';
import {
  USERS_TABLE,
  USER_ACCOUNT_ACCESS_TABLE,
  EMAIL_ACCOUNTS_TABLE,
} from '../../electron/database-schema';

describe('canAccessAccount', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE ${USERS_TABLE} (id TEXT PRIMARY KEY, role TEXT);
      CREATE TABLE ${EMAIL_ACCOUNTS_TABLE} (id INTEGER PRIMARY KEY);
      CREATE TABLE ${USER_ACCOUNT_ACCESS_TABLE} (
        user_id TEXT, account_id INTEGER, access_level TEXT
      );
    `);
    db.prepare(`INSERT INTO ${USERS_TABLE} (id, role) VALUES ('u1', 'agent')`).run();
    db.prepare(`INSERT INTO ${EMAIL_ACCOUNTS_TABLE} (id) VALUES (1)`).run();
    db.prepare(
      `INSERT INTO ${USER_ACCOUNT_ACCESS_TABLE} (user_id, account_id, access_level) VALUES ('u1', 1, 'ro')`,
    ).run();
  });

  afterEach(() => {
    db.close();
  });

  it('allows owner all accounts', () => {
    expect(canAccessAccount(db, 'owner', 99, 'ro', 'owner')).toBe(true);
  });

  it('checks user_account_access for agents', () => {
    expect(canAccessAccount(db, 'u1', 1, 'ro', 'agent')).toBe(true);
    expect(canAccessAccount(db, 'u1', 2, 'ro', 'agent')).toBe(false);
  });
});
