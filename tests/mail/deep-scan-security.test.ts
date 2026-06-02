const syncStore: Record<string, string> = {};

jest.mock('../../electron/sqlite-service', () => ({
  getSyncInfo: (key: string) => syncStore[key] ?? null,
  setSyncInfo: (key: string, value: string) => {
    syncStore[key] = value;
  },
  deleteSyncInfo: (key: string) => {
    delete syncStore[key];
  },
  getDb: () => null,
}));

import Database from 'better-sqlite3';
import {
  checkLoginAllowed,
  clearLoginFailures,
  recordLoginFailure,
  reloadLoginFailuresFromDb,
} from '../../electron/auth/login-guard';
import {
  resolveRemoteContentPolicy,
  setRemoteContentPolicy,
  consumeAllowedOnceRemoteContent,
} from '../../electron/email/email-remote-content';
import { wouldCreateThreadAliasCycle } from '../../electron/email/email-thread-resolve';
import { mergeThreads } from '../../electron/email/email-thread-admin';
import {
  EMAIL_ACCOUNTS_TABLE,
  EMAIL_MESSAGES_TABLE,
  EMAIL_REMOTE_CONTENT_ALLOWLIST_TABLE,
  EMAIL_THREAD_ALIASES_TABLE,
  PGP_PEER_KEYS_TABLE,
} from '../../electron/database-schema';
import { checkRecipientKeys } from '../../electron/pgp/pgp-service';

describe('deep-scan security fixes', () => {
  beforeEach(() => {
    for (const k of Object.keys(syncStore)) delete syncStore[k];
    clearLoginFailures('alice');
    reloadLoginFailuresFromDb();
  });

  it('login guard escalates lock duration after repeated bursts', () => {
    jest.useFakeTimers();
    try {
      for (let i = 0; i < 5; i++) recordLoginFailure('alice');
      const locked1 = checkLoginAllowed('alice');
      expect(locked1.ok).toBe(false);
      if (!locked1.ok) expect(locked1.waitMs).toBeLessThanOrEqual(30_000 + 50);

      jest.advanceTimersByTime(31_000);
      expect(checkLoginAllowed('alice').ok).toBe(true);

      for (let i = 0; i < 5; i++) recordLoginFailure('alice');
      const locked2 = checkLoginAllowed('alice');
      expect(locked2.ok).toBe(false);
      if (!locked2.ok) expect(locked2.waitMs).toBeGreaterThan(30_000);
    } finally {
      jest.useRealTimers();
    }
  });

  it('allowed_once permits remote content once then blocks', () => {
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE ${EMAIL_ACCOUNTS_TABLE} (
        id INTEGER PRIMARY KEY,
        default_remote_content_policy TEXT NOT NULL DEFAULT 'blocked'
      );
      CREATE TABLE ${EMAIL_MESSAGES_TABLE} (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        account_id INTEGER,
        remote_content_policy TEXT NOT NULL DEFAULT 'blocked',
        from_json TEXT
      );
      CREATE TABLE ${EMAIL_REMOTE_CONTENT_ALLOWLIST_TABLE} (
        scope TEXT, value TEXT
      );
    `);
    db.prepare(`INSERT INTO ${EMAIL_ACCOUNTS_TABLE} (id) VALUES (1)`).run();
    db.prepare(
      `INSERT INTO ${EMAIL_MESSAGES_TABLE} (account_id, remote_content_policy, from_json) VALUES (1, 'blocked', ?)`,
    ).run(JSON.stringify({ value: [{ address: 'sender@example.com' }] }));

    setRemoteContentPolicy(db, 1, 'allowed_once');
    const once = consumeAllowedOnceRemoteContent(db, 1);
    expect(once.allowRemote).toBe(true);
    expect(once.policy).toBe('allowed_once');

    const after = resolveRemoteContentPolicy(db, 1);
    expect(after.allowRemote).toBe(false);
    expect(after.policy).toBe('blocked');
    db.close();
  });

  it('pgp encrypt ignores unknown trust keys', () => {
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE ${PGP_PEER_KEYS_TABLE} (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT,
        fingerprint TEXT UNIQUE,
        public_key_armor TEXT,
        source TEXT,
        trust_level TEXT
      );
    `);
    jest.spyOn(require('../../electron/sqlite-service'), 'getDb').mockReturnValue(db);
    db.prepare(
      `INSERT INTO ${PGP_PEER_KEYS_TABLE} (email, fingerprint, public_key_armor, source, trust_level)
       VALUES ('bob@test.com', 'fp-unknown', 'armor', 'test', 'unknown')`,
    ).run();
    expect(checkRecipientKeys(['bob@test.com'])[0]?.hasKey).toBe(false);
    db.prepare(`UPDATE ${PGP_PEER_KEYS_TABLE} SET trust_level = 'imported' WHERE fingerprint = 'fp-unknown'`).run();
    expect(checkRecipientKeys(['bob@test.com'])[0]?.hasKey).toBe(true);
    db.close();
  });

  it('thread merge rejects alias cycles', () => {
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE ${EMAIL_THREAD_ALIASES_TABLE} (
        alias_thread_id TEXT PRIMARY KEY,
        canonical_thread_id TEXT,
        confidence TEXT,
        source TEXT
      );
      CREATE TABLE email_messages (id INTEGER PRIMARY KEY, thread_id TEXT, account_id INTEGER);
      CREATE TABLE email_threads (id TEXT PRIMARY KEY);
    `);
    jest.spyOn(require('../../electron/sqlite-service'), 'getDb').mockReturnValue(db);
    db.prepare(
      `INSERT INTO ${EMAIL_THREAD_ALIASES_TABLE} (alias_thread_id, canonical_thread_id, confidence, source)
       VALUES ('thread-a', 'thread-b', 'high', 'test')`,
    ).run();
    expect(wouldCreateThreadAliasCycle('thread-b', 'thread-a')).toBe(true);
    const r = mergeThreads('thread-b', 'thread-a', 1, 'test');
    expect(r.ok).toBe(false);
    db.close();
  });
});
