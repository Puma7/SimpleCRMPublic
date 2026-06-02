import Database from 'better-sqlite3';
import {
  EMAIL_MESSAGES_TABLE,
  EMAIL_THREADS_TABLE,
  EMAIL_THREAD_ALIASES_TABLE,
} from '../../electron/database-schema';

jest.mock('../../electron/sqlite-service', () => ({
  getDb: () => (global as { __testDb?: Database.Database }).__testDb,
}));

jest.mock('../../electron/email/email-thread-aggregate', () => ({
  rebuildThreadEdges: jest.fn(),
  upsertThreadAggregates: jest.fn(),
}));

import { mergeThreads } from '../../electron/email/email-thread-admin';

describe('mergeThreads', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    (global as { __testDb?: Database.Database }).__testDb = db;
    db.exec(`
      CREATE TABLE ${EMAIL_THREADS_TABLE} (id TEXT PRIMARY KEY, ticket_code TEXT);
      CREATE TABLE ${EMAIL_MESSAGES_TABLE} (
        id INTEGER PRIMARY KEY, thread_id TEXT, ticket_code TEXT, account_id INTEGER
      );
      CREATE TABLE ${EMAIL_THREAD_ALIASES_TABLE} (
        alias_thread_id TEXT PRIMARY KEY, canonical_thread_id TEXT, confidence TEXT, source TEXT
      );
      CREATE TABLE email_thread_edges (parent_message_id INTEGER, child_message_id INTEGER);
    `);
    db.prepare(`INSERT INTO ${EMAIL_THREADS_TABLE} (id, ticket_code) VALUES ('t-a', 'A'), ('t-b', 'B')`).run();
    db.prepare(
      `INSERT INTO ${EMAIL_MESSAGES_TABLE} (id, thread_id, ticket_code, account_id) VALUES (1, 't-a', 'A', 1)`,
    ).run();
  });

  afterEach(() => {
    db.close();
  });

  it('merges alias into canonical', () => {
    const r = mergeThreads('t-b', 't-a');
    expect(r.ok).toBe(true);
    const alias = db
      .prepare(`SELECT canonical_thread_id FROM ${EMAIL_THREAD_ALIASES_TABLE} WHERE alias_thread_id = 't-b'`)
      .get() as { canonical_thread_id: string };
    expect(alias.canonical_thread_id).toBe('t-a');
  });
});
