/**
 * @jest-environment node
 *
 * FTS v2 -> v3 upgrade against a real SQLite database: version guards do not
 * downgrade, the whole migration is transactional, body_text is backfilled
 * from HTML-only mail and the recreated triggers match the new table shape.
 */
import Database from 'better-sqlite3';
import { bootstrapFreshDatabaseSchema } from '../../electron/sqlite-service';
import {
  EMAIL_ACCOUNTS_TABLE,
  EMAIL_FOLDERS_TABLE,
  EMAIL_MESSAGES_FTS_TABLE,
  EMAIL_MESSAGES_TABLE,
  SYNC_INFO_TABLE,
} from '../../electron/database-schema';

const V2_FTS_SQL = `
  CREATE VIRTUAL TABLE ${EMAIL_MESSAGES_FTS_TABLE} USING fts5(
    subject, snippet, body_text, from_json, to_json, cc_json, bcc_json, ticket_code,
    content='${EMAIL_MESSAGES_TABLE}',
    content_rowid='id',
    tokenize = 'unicode61'
  );
`;

describe('email FTS v3 migration (real sqlite)', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    bootstrapFreshDatabaseSchema(db);
    db.prepare(
      `INSERT INTO ${EMAIL_ACCOUNTS_TABLE}
         (id, display_name, email_address, imap_host, imap_username, keytar_account_key)
       VALUES (1, 'Test', 'test@firma.de', 'imap.firma.de', 'test', 'k1')`,
    ).run();
    db.prepare(`INSERT INTO ${EMAIL_FOLDERS_TABLE} (id, account_id, path) VALUES (1, 1, 'INBOX')`).run();
  });

  afterEach(() => {
    db.close();
  });

  function ftsVersion(): string | undefined {
    const row = db
      .prepare(`SELECT value FROM ${SYNC_INFO_TABLE} WHERE key = 'email_fts_search_version'`)
      .get() as { value: string } | undefined;
    return row?.value;
  }

  function ftsColumns(): string[] {
    return (db.prepare(`PRAGMA table_info(${EMAIL_MESSAGES_FTS_TABLE})`).all() as { name: string }[]).map(
      (c) => c.name,
    );
  }

  function simulateV2Database(): void {
    db.exec('DROP TRIGGER IF EXISTS email_messages_fts_ai');
    db.exec('DROP TRIGGER IF EXISTS email_messages_fts_ad');
    db.exec('DROP TRIGGER IF EXISTS email_messages_fts_au');
    db.exec(`DROP TABLE IF EXISTS ${EMAIL_MESSAGES_FTS_TABLE}`);
    db.exec(V2_FTS_SQL);
    db.exec(`INSERT INTO ${EMAIL_MESSAGES_FTS_TABLE}(${EMAIL_MESSAGES_FTS_TABLE}) VALUES('rebuild')`);
    db.prepare(
      `INSERT OR REPLACE INTO ${SYNC_INFO_TABLE} (key, value) VALUES ('email_fts_search_version', '2')`,
    ).run();
  }

  function seedMessage(uid: number, cols: Record<string, unknown>): void {
    const entries = Object.entries({ account_id: 1, folder_id: 1, uid, ...cols });
    db.prepare(
      `INSERT INTO ${EMAIL_MESSAGES_TABLE} (${entries.map(([k]) => k).join(', ')})
       VALUES (${entries.map(() => '?').join(', ')})`,
    ).run(...entries.map(([, v]) => v));
  }

  test('fresh install lands on version 3 with v3-shaped table', () => {
    expect(ftsVersion()).toBe('3');
    expect(ftsColumns()).toContain('attachments_json');
  });

  test('v2 database is upgraded: backfill, rebuild, triggers, version 3', () => {
    simulateV2Database();
    // HTML-only mail: body_text must be backfilled and indexed by the rebuild.
    seedMessage(1, {
      subject: 'HTML only',
      body_text: null,
      body_html: '<p>Geheimnisvolle <b>Inhalte</b></p><style>p{color:red}</style>',
    });
    // v2 rebuild picked the row up without body_text.
    db.exec(`INSERT INTO ${EMAIL_MESSAGES_FTS_TABLE}(${EMAIL_MESSAGES_FTS_TABLE}) VALUES('rebuild')`);

    bootstrapFreshDatabaseSchema(db);

    expect(ftsVersion()).toBe('3');
    expect(ftsColumns()).toContain('attachments_json');
    const row = db
      .prepare(`SELECT body_text FROM ${EMAIL_MESSAGES_TABLE} WHERE uid = 1`)
      .get() as { body_text: string | null };
    expect(row.body_text).toBe('Geheimnisvolle Inhalte');
    const hits = db
      .prepare(
        `SELECT rowid FROM ${EMAIL_MESSAGES_FTS_TABLE} WHERE ${EMAIL_MESSAGES_FTS_TABLE} MATCH '"geheim"*'`,
      )
      .all();
    expect(hits).toHaveLength(1);
  });

  test('post-migration triggers index new mail incl. attachments_json', () => {
    simulateV2Database();
    bootstrapFreshDatabaseSchema(db);
    seedMessage(2, {
      subject: 'Mit Anhang',
      body_text: 'Text',
      attachments_json: JSON.stringify([{ filename: 'jahresbilanz.pdf' }]),
      has_attachments: 1,
    });
    const hits = db
      .prepare(
        `SELECT rowid FROM ${EMAIL_MESSAGES_FTS_TABLE} WHERE ${EMAIL_MESSAGES_FTS_TABLE} MATCH '"jahresbilanz"*'`,
      )
      .all();
    expect(hits).toHaveLength(1);
    // Update + delete keep the index in sync (au/ad triggers).
    db.prepare(`UPDATE ${EMAIL_MESSAGES_TABLE} SET subject = 'Umbenannt' WHERE uid = 2`).run();
    expect(
      db
        .prepare(
          `SELECT rowid FROM ${EMAIL_MESSAGES_FTS_TABLE} WHERE ${EMAIL_MESSAGES_FTS_TABLE} MATCH '"umbenannt"'`,
        )
        .all(),
    ).toHaveLength(1);
  });

  test('v2 guard does not downgrade a v3 database (re-running migrations is a no-op)', () => {
    simulateV2Database();
    bootstrapFreshDatabaseSchema(db);
    expect(ftsVersion()).toBe('3');
    bootstrapFreshDatabaseSchema(db);
    expect(ftsVersion()).toBe('3');
    expect(ftsColumns()).toContain('attachments_json');
  });

  test('mismatched triggers on a v2 table are healed by the migration', () => {
    simulateV2Database();
    // Worst case before the fix: v3-column triggers on a v2 table make every
    // mail ingest fail.
    db.exec(`
      CREATE TRIGGER email_messages_fts_ai AFTER INSERT ON ${EMAIL_MESSAGES_TABLE} BEGIN
        INSERT INTO ${EMAIL_MESSAGES_FTS_TABLE}(rowid, subject, snippet, body_text, from_json, to_json, cc_json, bcc_json, ticket_code, attachments_json)
        VALUES (new.id, new.subject, new.snippet, new.body_text, new.from_json, new.to_json, new.cc_json, new.bcc_json, new.ticket_code, new.attachments_json);
      END;
    `);
    expect(() => seedMessage(3, { subject: 'bricht', body_text: 'x' })).toThrow();

    bootstrapFreshDatabaseSchema(db);
    expect(() => seedMessage(4, { subject: 'geht wieder', body_text: 'x' })).not.toThrow();
    expect(
      db
        .prepare(
          `SELECT rowid FROM ${EMAIL_MESSAGES_FTS_TABLE} WHERE ${EMAIL_MESSAGES_FTS_TABLE} MATCH '"geht"'`,
        )
        .all(),
    ).toHaveLength(1);
  });
});
