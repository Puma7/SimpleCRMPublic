/**
 * @jest-environment node
 *
 * End-to-end search against a real SQLite database (fresh schema incl. FTS v3):
 * prefix matching, broad scope, operators, attachment search and the
 * FTS-zero-rows → LIKE fallback.
 */
import Database from 'better-sqlite3';

let db: Database.Database;

jest.mock('../../electron/sqlite-service', () => {
  const actual = jest.requireActual('../../electron/sqlite-service');
  return {
    ...actual,
    getDb: () => db,
  };
});

import { bootstrapFreshDatabaseSchema } from '../../electron/sqlite-service';
import {
  EMAIL_ACCOUNTS_TABLE,
  EMAIL_FOLDERS_TABLE,
  EMAIL_MESSAGES_TABLE,
} from '../../electron/database-schema';
import {
  searchMessagesForAccountWithMeta,
  searchMessagesForAllAccountsWithMeta,
} from '../../electron/email/email-crm-store';

type SeedMessage = {
  uid: number;
  subject: string;
  bodyText?: string | null;
  fromAddr?: string;
  toAddr?: string;
  folderKind?: string;
  archived?: number;
  isSpam?: number;
  spamStatus?: string;
  softDeleted?: number;
  hasAttachments?: number;
  attachmentsJson?: string | null;
  dateReceived?: string;
  snoozedUntil?: string | null;
};

function seedMessage(m: SeedMessage): number {
  const r = db
    .prepare(
      `INSERT INTO ${EMAIL_MESSAGES_TABLE} (
         account_id, folder_id, uid, subject, from_json, to_json, snippet, body_text,
         date_received, folder_kind, archived, is_spam, spam_status, soft_deleted,
         has_attachments, attachments_json, snoozed_until
       ) VALUES (1, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      m.uid,
      m.subject,
      JSON.stringify({ value: [{ address: m.fromAddr ?? 'sender@example.de' }] }),
      JSON.stringify({ value: [{ address: m.toAddr ?? 'empfang@firma.de' }] }),
      (m.bodyText ?? '').slice(0, 100),
      m.bodyText ?? null,
      m.dateReceived ?? '2026-07-01T10:00:00.000Z',
      m.folderKind ?? 'inbox',
      m.archived ?? 0,
      m.isSpam ?? 0,
      m.spamStatus ?? 'clean',
      m.softDeleted ?? 0,
      m.hasAttachments ?? 0,
      m.attachmentsJson ?? null,
      m.snoozedUntil ?? null,
    );
  return Number(r.lastInsertRowid);
}

describe('email search integration (real sqlite)', () => {
  beforeAll(() => {
    db = new Database(':memory:');
    bootstrapFreshDatabaseSchema(db);
    db.prepare(
      `INSERT INTO ${EMAIL_ACCOUNTS_TABLE}
         (id, display_name, email_address, imap_host, imap_username, keytar_account_key)
       VALUES (1, 'Test', 'test@firma.de', 'imap.firma.de', 'test', 'k1')`,
    ).run();
    db.prepare(
      `INSERT INTO ${EMAIL_FOLDERS_TABLE} (id, account_id, path) VALUES (1, 1, 'INBOX')`,
    ).run();

    seedMessage({
      uid: 1,
      subject: 'Rechnung 4711',
      bodyText: 'Bitte um Zahlung bis Ende des Monats.',
      fromAddr: 'max@test.de',
      hasAttachments: 1,
      attachmentsJson: JSON.stringify([{ filename: 'quartalsreport.pdf' }]),
    });
    seedMessage({
      uid: 2,
      subject: 'Angebot Gartenmöbel',
      bodyText: 'Unser Angebot für Ihre Terrasse.',
      archived: 1,
    });
    seedMessage({
      uid: 3,
      subject: 'Gewinnspiel Rechnung',
      bodyText: 'Spam Rechnung gewinnen!',
      isSpam: 1,
      spamStatus: 'spam',
    });
    seedMessage({
      uid: 4,
      subject: 'Alte Rechnung geloescht',
      bodyText: 'liegt im Papierkorb',
      softDeleted: 1,
    });
    // Drei LIKE-only-Treffer (Mid-Word 'anzgutschrift') fuer Pagination.
    seedMessage({
      uid: 10,
      subject: 'Info Alpha',
      bodyText: 'Kulanzgutschrift Alpha erteilt.',
      dateReceived: '2026-07-02T10:00:00.000Z',
    });
    seedMessage({
      uid: 11,
      subject: 'Info Beta',
      bodyText: 'Kulanzgutschrift Beta erteilt.',
      dateReceived: '2026-07-02T11:00:00.000Z',
    });
    seedMessage({
      uid: 12,
      subject: 'Info Gamma',
      bodyText: 'Kulanzgutschrift Gamma erteilt.',
      dateReceived: '2026-07-02T12:00:00.000Z',
    });
    // Gesnoozte Mail: unsichtbar in der View-Suche, sichtbar in broad.
    seedMessage({
      uid: 20,
      subject: 'Zahlungsplan',
      bodyText: 'Bitte um Zahlung morgen frueh.',
      snoozedUntil: '2099-01-01T00:00:00.000Z',
    });
  });

  afterAll(() => {
    db.close();
  });

  test('fresh schema builds FTS v3 with attachments_json', () => {
    const cols = db.prepare('PRAGMA table_info(email_messages_fts)').all() as { name: string }[];
    expect(cols.map((c) => c.name)).toContain('attachments_json');
  });

  test('prefix search matches word starts via FTS', () => {
    const r = searchMessagesForAccountWithMeta(1, 'rech', { view: 'inbox' });
    expect(r.searchMode).toBe('fts');
    expect(r.rows.map((m) => m.uid)).toEqual([1]);
  });

  test('mid-word substring falls back to LIKE and still finds the mail', () => {
    const r = searchMessagesForAccountWithMeta(1, 'ahlung', { view: 'inbox' });
    expect(r.searchMode).toBe('like');
    expect(r.rows.map((m) => m.uid)).toEqual([1]);
  });

  test('view scope hides archived mail, broad scope finds it', () => {
    const inView = searchMessagesForAccountWithMeta(1, 'angebot', { view: 'inbox' });
    expect(inView.rows).toHaveLength(0);
    const broad = searchMessagesForAccountWithMeta(1, 'angebot', {
      view: 'inbox',
      scope: { mode: 'broad' },
    });
    expect(broad.rows.map((m) => m.uid)).toEqual([2]);
  });

  test('broad scope excludes spam and trash unless requested', () => {
    const def = searchMessagesForAccountWithMeta(1, 'rechnung', { scope: { mode: 'broad' } });
    expect(def.rows.map((m) => m.uid).sort()).toEqual([1]);
    const withSpam = searchMessagesForAccountWithMeta(1, 'rechnung', {
      scope: { mode: 'broad', includeSpam: true },
    });
    expect(withSpam.rows.map((m) => m.uid).sort()).toEqual([1, 3]);
    const withTrash = searchMessagesForAccountWithMeta(1, 'rechnung', {
      scope: { mode: 'broad', includeTrash: true },
    });
    expect(withTrash.rows.map((m) => m.uid).sort()).toEqual([1, 4]);
  });

  test('trash view search works', () => {
    const r = searchMessagesForAccountWithMeta(1, 'papierkorb', { view: 'trash' });
    expect(r.rows.map((m) => m.uid)).toEqual([4]);
  });

  test('operators filter sender and attachments', () => {
    const bySender = searchMessagesForAccountWithMeta(1, 'von:max@test.de', {
      scope: { mode: 'broad' },
    });
    expect(bySender.searchMode).toBe('like');
    expect(bySender.rows.map((m) => m.uid)).toEqual([1]);

    const withText = searchMessagesForAccountWithMeta(1, 'von:max@test.de rechnung', {
      scope: { mode: 'broad' },
    });
    expect(withText.rows.map((m) => m.uid)).toEqual([1]);

    const noHit = searchMessagesForAccountWithMeta(1, 'von:max@test.de angebot', {
      scope: { mode: 'broad' },
    });
    expect(noHit.rows).toHaveLength(0);

    const withAttachment = searchMessagesForAccountWithMeta(1, 'has:attachment rechnung', {
      scope: { mode: 'broad' },
    });
    expect(withAttachment.rows.map((m) => m.uid)).toEqual([1]);
  });

  test('attachment filenames are searchable', () => {
    const r = searchMessagesForAccountWithMeta(1, 'quartalsreport', { view: 'inbox' });
    expect(r.rows.map((m) => m.uid)).toEqual([1]);
  });

  test('quoted phrase must match exactly', () => {
    const hit = searchMessagesForAccountWithMeta(1, '"Bitte um Zahlung"', { view: 'inbox' });
    expect(hit.rows.map((m) => m.uid)).toEqual([1]);
    const miss = searchMessagesForAccountWithMeta(1, '"Zahlung um Bitte"', { view: 'inbox' });
    expect(miss.rows).toHaveLength(0);
  });

  test('all-accounts search returns real search mode', () => {
    const r = searchMessagesForAllAccountsWithMeta('rech', { scope: { mode: 'broad' } });
    expect(r.searchMode).toBe('fts');
    expect(r.rows.map((m) => m.uid)).toEqual([1]);
  });

  test('like-mode query paginates in like mode past page 1', () => {
    const p1 = searchMessagesForAccountWithMeta(1, 'anzgutschrift', {
      view: 'inbox',
      limit: 2,
      offset: 0,
    });
    expect(p1.searchMode).toBe('like');
    expect(p1.rows).toHaveLength(2);
    expect(p1.hasMore).toBe(true);
    const p2 = searchMessagesForAccountWithMeta(1, 'anzgutschrift', {
      view: 'inbox',
      limit: 2,
      offset: 2,
    });
    expect(p2.searchMode).toBe('like');
    expect(p2.rows).toHaveLength(1);
    expect(p2.hasMore).toBe(false);
    const uids = [...p1.rows, ...p2.rows].map((m) => m.uid).sort((a, b) => a - b);
    expect(uids).toEqual([10, 11, 12]);
  });

  test('fts pagination past the last page stays fts (no like re-dispatch)', () => {
    const opts = { scope: { mode: 'broad' as const, includeSpam: true, includeTrash: true }, limit: 2 };
    const p1 = searchMessagesForAccountWithMeta(1, 'rechnung', { ...opts, offset: 0 });
    expect(p1.searchMode).toBe('fts');
    expect(p1.rows).toHaveLength(2);
    const p2 = searchMessagesForAccountWithMeta(1, 'rechnung', { ...opts, offset: 2 });
    expect(p2.searchMode).toBe('fts');
    expect(p2.rows).toHaveLength(1);
    const p3 = searchMessagesForAccountWithMeta(1, 'rechnung', { ...opts, offset: 4 });
    expect(p3.searchMode).toBe('fts');
    expect(p3.rows).toHaveLength(0);
  });

  test('address operator: domain suffix, prefix and exact patterns', () => {
    const broad = { scope: { mode: 'broad' as const } };
    expect(
      searchMessagesForAccountWithMeta(1, 'von:@test.de', broad).rows.map((m) => m.uid),
    ).toEqual([1]);
    expect(
      searchMessagesForAccountWithMeta(1, 'von:max@test', broad).rows.map((m) => m.uid),
    ).toEqual([1]);
    expect(
      searchMessagesForAccountWithMeta(1, 'von:max@test.de', broad).rows.map((m) => m.uid),
    ).toEqual([1]);
    expect(searchMessagesForAccountWithMeta(1, 'von:@nirgendwo.example', broad).rows).toHaveLength(0);
    expect(searchMessagesForAccountWithMeta(1, 'von:moritz@test.de', broad).rows).toHaveLength(0);
  });

  test('snoozed mail hidden in view search (also via LIKE fallback), visible in broad', () => {
    const inView = searchMessagesForAccountWithMeta(1, 'ahlung', { view: 'inbox' });
    expect(inView.searchMode).toBe('like');
    expect(inView.rows.map((m) => m.uid)).toEqual([1]);
    const broad = searchMessagesForAccountWithMeta(1, 'ahlung', { scope: { mode: 'broad' } });
    expect(broad.rows.map((m) => m.uid).sort((a, b) => a - b)).toEqual([1, 20]);
  });

  test('regex search finds matching rows and respects the view', () => {
    const r = searchMessagesForAccountWithMeta(1, '/^Rechnung \\d+$/m', { view: 'inbox' });
    expect(r.searchMode).toBe('regex');
    expect(r.rows.map((m) => m.uid)).toEqual([1]);
    const trash = searchMessagesForAccountWithMeta(1, '/papierkorb/i', { view: 'trash' });
    expect(trash.searchMode).toBe('regex');
    expect(trash.rows.map((m) => m.uid)).toEqual([4]);
    const inboxMiss = searchMessagesForAccountWithMeta(1, '/papierkorb/i', { view: 'inbox' });
    expect(inboxMiss.rows).toHaveLength(0);
  });
});
