/**
 * @jest-environment node
 */
// Overrides the global mail electron mock: the upgrade-path test below points
// initializeDatabase() at a per-test temp dir via env var.
jest.mock('electron', () => ({
  app: {
    getPath: () => process.env.SIMPLECRM_MAIL_TEST_USERDATA ?? '/tmp/simplecrm-mail-test',
    getName: () => 'simplecrm-test',
  },
}));

import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import {
  EMAIL_ACCOUNTS_TABLE,
  EMAIL_AI_PROFILES_TABLE,
  EMAIL_FOLDERS_TABLE,
  EMAIL_MESSAGES_FTS_TABLE,
  EMAIL_MESSAGES_TABLE,
  SYNC_INFO_TABLE,
} from '../../electron/database-schema';
import {
  bootstrapFreshDatabaseSchema,
  closeDatabase,
  getDb,
  initializeDatabase,
} from '../../electron/sqlite-service';

describe('sqlite fresh install integration', () => {
  let tmpDir: string;
  let db: Database.Database;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scm-fresh-'));
    const dbFile = path.join(tmpDir, 'database.sqlite');
    db = new Database(dbFile);
    bootstrapFreshDatabaseSchema(db);
  });

  afterEach(() => {
    try {
      db?.close();
    } catch {
      /* ignore */
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function tableExists(name: string): boolean {
    const row = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
      .get(name) as { name: string } | undefined;
    return row != null;
  }

  function columnExists(table: string, column: string): boolean {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    return cols.some((c) => c.name === column);
  }

  function indexExists(name: string): boolean {
    const row = db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name=?")
      .get(name) as { name: string } | undefined;
    return row != null;
  }

  test('creates email_ai_profiles before dependent mail tables are usable', () => {
    expect(tableExists(EMAIL_AI_PROFILES_TABLE)).toBe(true);
    expect(tableExists(EMAIL_MESSAGES_TABLE)).toBe(true);
  });

  test('email_messages has done_local and sent_imap_sync_failed after migrations', () => {
    expect(columnExists(EMAIL_MESSAGES_TABLE, 'done_local')).toBe(true);
    expect(columnExists(EMAIL_MESSAGES_TABLE, 'sent_imap_sync_failed')).toBe(true);
  });

  test('FTS index and search version sync_info exist', () => {
    expect(tableExists(EMAIL_MESSAGES_FTS_TABLE)).toBe(true);
    const version = db
      .prepare(`SELECT value FROM ${SYNC_INFO_TABLE} WHERE key = ?`)
      .get('email_fts_search_version') as { value: string } | undefined;
    expect(version?.value).toBe('3');
    expect(columnExists(EMAIL_MESSAGES_FTS_TABLE, 'attachments_json')).toBe(true);
  });

  test('attachment text search structures exist (Suche Phase 2)', () => {
    expect(columnExists('email_message_attachments', 'text_content')).toBe(true);
    expect(columnExists('email_message_attachments', 'text_extracted_at')).toBe(true);
    expect(tableExists('email_attachments_fts')).toBe(true);
    expect(columnExists('email_attachments_fts', 'text_content')).toBe(true);
  });

  test('attachments message_id index exists and is re-created on upgraded DBs', () => {
    // Fresh install: Index dient der korrelierten EXISTS-/LIKE-Probe der Suche.
    expect(indexExists('idx_email_attach_message')).toBe(true);

    // Upgrade-Simulation ueber den ECHTEN Bestands-DB-Pfad von
    // initializeDatabase(): ensureTableExists legt Indizes nur bei Tabellen-
    // Neuanlage an — eine Bestands-DB, deren Attachments-Tabelle den Index
    // nie bekommen hat, muss ihn durch runMigrations unconditional nachziehen.
    db.exec('DROP INDEX idx_email_attach_message');
    expect(indexExists('idx_email_attach_message')).toBe(false);
    db.close();

    process.env.SIMPLECRM_MAIL_TEST_USERDATA = tmpDir;
    try {
      initializeDatabase();
      const upgraded = getDb();
      const row = upgraded
        .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name=?")
        .get('idx_email_attach_message');
      expect(row).toBeTruthy();
    } finally {
      closeDatabase();
      delete process.env.SIMPLECRM_MAIL_TEST_USERDATA;
    }

    // afterEach schliesst `db` — auf eine frische Verbindung zeigen lassen.
    db = new Database(path.join(tmpDir, 'database.sqlite'));
  });

  test('legacy DB without FTS gets body_text backfill before the first index build', () => {
    // Legacy-Profil von VOR der FTS-Einfuehrung simulieren: Mails existieren,
    // email_messages_fts fehlt, Version-Key fehlt.
    db.exec('DROP TRIGGER IF EXISTS email_messages_fts_ai');
    db.exec('DROP TRIGGER IF EXISTS email_messages_fts_ad');
    db.exec('DROP TRIGGER IF EXISTS email_messages_fts_au');
    db.exec(`DROP TABLE IF EXISTS ${EMAIL_MESSAGES_FTS_TABLE}`);
    db.prepare(`DELETE FROM ${SYNC_INFO_TABLE} WHERE key = 'email_fts_search_version'`).run();
    db.prepare(
      `INSERT INTO ${EMAIL_ACCOUNTS_TABLE}
         (id, display_name, email_address, imap_host, imap_username, keytar_account_key)
       VALUES (1, 'Test', 'test@firma.de', 'imap.firma.de', 'test', 'k1')`,
    ).run();
    db.prepare(`INSERT INTO ${EMAIL_FOLDERS_TABLE} (id, account_id, path) VALUES (1, 1, 'INBOX')`).run();
    // HTML-only-Mail: Begriff liegt tief im Body, jenseits der 217-Zeichen-
    // Snippet-Grenze — nur der body_text-Backfill macht ihn auffindbar.
    const filler = 'Sehr geehrte Damen und Herren, vielen Dank fuer Ihre Nachricht. '.repeat(6);
    const plainStart = filler.slice(0, 217);
    db.prepare(
      `INSERT INTO ${EMAIL_MESSAGES_TABLE} (account_id, folder_id, uid, subject, snippet, body_text, body_html)
       VALUES (1, 1, 100, 'Altbestand', ?, NULL, ?)`,
    ).run(`${plainStart}...`, `<p>${filler}</p><p>Zauberwortbegriff am Ende</p>`);
    db.close();

    process.env.SIMPLECRM_MAIL_TEST_USERDATA = tmpDir;
    try {
      initializeDatabase();
      const upgraded = getDb();
      const version = upgraded
        .prepare(`SELECT value FROM ${SYNC_INFO_TABLE} WHERE key = 'email_fts_search_version'`)
        .get() as { value: string } | undefined;
      expect(version?.value).toBe('3');
      const row = upgraded
        .prepare(`SELECT body_text FROM ${EMAIL_MESSAGES_TABLE} WHERE uid = 100`)
        .get() as { body_text: string | null };
      expect(row.body_text).toContain('Zauberwortbegriff');
      const hits = upgraded
        .prepare(
          `SELECT rowid FROM ${EMAIL_MESSAGES_FTS_TABLE} WHERE ${EMAIL_MESSAGES_FTS_TABLE} MATCH '"zauberwortbegriff"'`,
        )
        .all();
      expect(hits).toHaveLength(1);
    } finally {
      closeDatabase();
      delete process.env.SIMPLECRM_MAIL_TEST_USERDATA;
    }

    // afterEach schliesst `db` — auf eine frische Verbindung zeigen lassen.
    db = new Database(path.join(tmpDir, 'database.sqlite'));
  });

  test('fresh DB (no messages) lands on version 3 straight from index creation', () => {
    // Fresh-Fall des Missing-FTS-Zweigs: Version '3' direkt, migrate-
    // EmailFtsSearchV3 muss nichts mehr tun (kein Backfill-Lauf noetig,
    // email_messages ist leer).
    const row = db
      .prepare(`SELECT value FROM ${SYNC_INFO_TABLE} WHERE key = 'email_fts_search_version'`)
      .get() as { value: string } | undefined;
    expect(row?.value).toBe('3');
    const count = db
      .prepare(`SELECT COUNT(*) AS n FROM ${EMAIL_MESSAGES_TABLE}`)
      .get() as { n: number };
    expect(count.n).toBe(0);
  });

  test('seeds initial sync status rows', () => {
    const status = db
      .prepare(`SELECT value FROM ${SYNC_INFO_TABLE} WHERE key = ?`)
      .get('lastSyncStatus') as { value: string } | undefined;
    expect(status?.value).toBe('Never');
  });
});
