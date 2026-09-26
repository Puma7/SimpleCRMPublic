/**
 * Ansicht „Gesendet (KI)“ (Teilautomatisierung P3, Desktop): Liste je Konto
 * und über alle Konten, view-gebundene Suche, kein Verschieben dorthin.
 * Echte In-Memory-DB mit dem echten Schema.
 */
import Database from 'better-sqlite3';

const db = new Database(':memory:');
db.pragma('foreign_keys = OFF');

jest.mock('../../electron/sqlite-service', () => ({
  getDb: () => db,
  getSyncInfo: () => null,
  setSyncInfo: () => undefined,
}));

import { createEmailMessageAttachmentsTable, createEmailMessagesTable } from '../../electron/database-schema';
import { ensureSentProvenanceColumns } from '../../electron/email/email-sent-provenance-schema';
import {
  listMessagesForAccountView,
  listMessagesForAllAccountsView,
  moveMessageToMailView,
} from '../../electron/email/email-store';
import { searchMessagesForAccountWithMeta } from '../../electron/email/email-crm-store';
import { SENT_AI_VIEW_KINDS } from '../../packages/core/src/email/sent-provenance';

beforeAll(() => {
  db.exec(createEmailMessagesTable);
  // Die Suche prüft Anhangsnamen und Kundennamen mit (LIKE-Pfad ohne Volltextindex).
  db.exec(createEmailMessageAttachmentsTable);
  db.exec('CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT, firstName TEXT, company TEXT, email TEXT)');
  db.exec(`
    ALTER TABLE email_messages ADD COLUMN snoozed_until TEXT;
    ALTER TABLE email_messages ADD COLUMN scheduled_send_at TEXT;
    ALTER TABLE email_messages ADD COLUMN approval_state TEXT;
    ALTER TABLE email_messages ADD COLUMN approval_reason TEXT;
    ALTER TABLE email_messages ADD COLUMN bcc_json TEXT;
  `);
  ensureSentProvenanceColumns(db);

  const insert = db.prepare(
    `INSERT INTO email_messages
       (id, account_id, folder_id, uid, subject, folder_kind, sent_by_kind, sent_by_label, date_received)
     VALUES (?, ?, 10, ?, ?, ?, ?, ?, ?)`,
  );
  insert.run(1, 1, 101, 'Re: Frage Mensch', 'sent', 'human', 'Anna', '2026-09-26T08:00:00Z');
  insert.run(2, 1, 102, 'Re: Frage KI', 'sent', 'ai_auto', 'Workflow „KI-Antwort“', '2026-09-26T08:01:00Z');
  insert.run(3, 1, 103, 'Re: Frage freigegeben', 'sent', 'ai_approved', 'Anna', '2026-09-26T08:02:00Z');
  insert.run(4, 2, 104, 'Rechnung Frage', 'sent', 'workflow', 'Workflow „Rechnungen“', '2026-09-26T08:03:00Z');
  insert.run(5, 1, 105, 'Shop Frage', 'sent', 'relay', 'Shop', '2026-09-26T08:04:00Z');
  insert.run(6, 1, 106, 'Alt Frage', 'sent', null, null, '2026-09-26T08:05:00Z');
  // Eingang mit (fehlerhaft) gesetzter Kennzeichnung bleibt draußen.
  insert.run(7, 1, 107, 'Eingang Frage', 'inbox', 'ai_auto', null, '2026-09-26T08:06:00Z');
});

describe('Desktop: Ansicht „Gesendet (KI)“', () => {
  test('SQL-Filter und Core-Liste stimmen überein', () => {
    expect([...SENT_AI_VIEW_KINDS].sort()).toEqual(['ai_approved', 'ai_auto', 'workflow']);
  });

  test('je Konto nur KI/Automatik, „Gesendet“ weiterhin alles', () => {
    expect(listMessagesForAccountView(1, 'sent_ai').map((m) => m.id)).toEqual([3, 2]);
    expect(listMessagesForAccountView(1, 'sent').map((m) => m.id)).toEqual([6, 5, 3, 2, 1]);
    const row = listMessagesForAccountView(1, 'sent_ai')[1]!;
    expect(row).toEqual(expect.objectContaining({
      sent_by_kind: 'ai_auto',
      sent_by_label: 'Workflow „KI-Antwort“',
      sent_outbound_review_skipped: 0,
    }));
  });

  test('über alle Konten', () => {
    expect(listMessagesForAllAccountsView('sent_ai').map((m) => m.id)).toEqual([4, 3, 2]);
  });

  test('view-gebundene Suche', () => {
    const result = searchMessagesForAccountWithMeta(1, 'Frage', { view: 'sent_ai', limit: 20 });
    expect(result.rows.map((m) => m.id).sort()).toEqual([2, 3]);
  });

  test('kein Verschieben in die Ansicht', () => {
    expect(() => moveMessageToMailView(1, 'sent_ai')).toThrow('kein Verschieben');
  });
});
