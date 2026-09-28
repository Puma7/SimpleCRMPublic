/**
 * Plan 049: Warteschlangen der Teilautomatisierung als eigene Ansichten
 * (Desktop): „Wartet auf Freigabe“ und „Versand blockiert“. Liste je Konto und
 * über alle Konten, view-gebundene Suche, kein Verschieben dorthin, IPC-Schema.
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
import { IPCChannels } from '../../shared/ipc/channels';
import { getPayloadSchema } from '../../shared/ipc/schemas';

beforeAll(() => {
  db.exec(createEmailMessagesTable);
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
       (id, account_id, folder_id, uid, subject, folder_kind, approval_state, outbound_hold, scheduled_send_at, soft_deleted, date_received)
     VALUES (?, ?, 10, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  insert.run(1, 1, -1, 'Entwurf Freigabe', 'draft', 'pending', 0, null, 0, '2026-09-26T08:00:00Z');
  insert.run(2, 1, -2, 'Entwurf Freigabe geplant', 'draft', 'pending', 0, '2026-09-30T08:00:00Z', 0, '2026-09-26T08:01:00Z');
  insert.run(3, 1, -3, 'Entwurf blockiert', 'draft', null, 1, null, 0, '2026-09-26T08:02:00Z');
  insert.run(4, 1, -4, 'Entwurf Freigabe blockiert', 'draft', 'pending', 1, null, 0, '2026-09-26T08:03:00Z');
  insert.run(5, 1, 105, 'Gesendet Freigabe', 'sent', 'pending', 0, null, 0, '2026-09-26T08:04:00Z');
  insert.run(6, 1, -6, 'Entwurf blockiert gelöscht', 'draft', null, 1, null, 1, '2026-09-26T08:05:00Z');
  insert.run(7, 2, -7, 'Anderes Konto Freigabe', 'draft', 'pending', 1, null, 0, '2026-09-26T08:06:00Z');
});

describe('Desktop: Ansichten „Wartet auf Freigabe“ und „Versand blockiert“', () => {
  test('je Konto', () => {
    expect(listMessagesForAccountView(1, 'approval_pending').map((m) => m.id)).toEqual([4, 1]);
    expect(listMessagesForAccountView(1, 'outbound_blocked').map((m) => m.id)).toEqual([4, 3]);
  });

  test('über alle Konten', () => {
    expect(listMessagesForAllAccountsView('approval_pending').map((m) => m.id)).toEqual([7, 4, 1]);
    expect(listMessagesForAllAccountsView('outbound_blocked').map((m) => m.id)).toEqual([7, 4, 3]);
  });

  test('view-gebundene Suche', () => {
    expect(searchMessagesForAccountWithMeta(1, 'Entwurf', { view: 'approval_pending', limit: 20 }).rows.map((m) => m.id).sort())
      .toEqual([1, 4]);
    expect(searchMessagesForAccountWithMeta(1, 'Entwurf', { view: 'outbound_blocked', limit: 20 }).rows.map((m) => m.id).sort())
      .toEqual([3, 4]);
  });

  test('kein Verschieben in die Ansichten', () => {
    expect(() => moveMessageToMailView(5, 'approval_pending')).toThrow('kein Verschieben');
    expect(() => moveMessageToMailView(5, 'outbound_blocked')).toThrow('kein Verschieben');
  });

  test('IPC: Liste und Suche nehmen die Ansichten an, Verschieben nicht', () => {
    for (const view of ['approval_pending', 'outbound_blocked']) {
      expect(getPayloadSchema(IPCChannels.Email.ListMessagesByView).safeParse({ accountId: 'all', view }).success).toBe(true);
      expect(getPayloadSchema(IPCChannels.Email.ListMessageIdsByView).safeParse({ accountId: 1, view }).success).toBe(true);
      expect(getPayloadSchema(IPCChannels.Email.SearchMessages).safeParse({ accountId: 1, query: 'x', view }).success).toBe(true);
      expect(getPayloadSchema(IPCChannels.Email.MoveMessageToView).safeParse({ messageId: 5, view }).success).toBe(false);
    }
  });
});
