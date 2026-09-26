/**
 * Teilautomatisierung P2 (Desktop): Hält der Ausgang einen geplanten Entwurf
 * (Workflow-Versand, geplanter Versand) endgültig an, muss er im Posteingang
 * als angehalten erscheinen und darf nicht automatisch erneut gesendet werden.
 * Bisher blieb scheduled_send_at stehen: der Posteingang zeigt angehaltene
 * Entwürfe nur ohne Planung, der Versand-Ticker überspringt angehaltene —
 * die Mail hing unsichtbar. Echte In-Memory-DB mit dem echten Schema.
 */
import Database from 'better-sqlite3';

const db = new Database(':memory:');
db.pragma('foreign_keys = OFF');

jest.mock('../../electron/sqlite-service', () => ({
  getDb: () => db,
  getSyncInfo: (key: string) =>
    (db.prepare('SELECT value FROM sync_info WHERE key = ?').get(key) as { value: string } | undefined)
      ?.value ?? null,
  setSyncInfo: (key: string, value: string) => {
    db.prepare(
      `INSERT INTO sync_info (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ).run(key, value);
  },
}));
jest.mock('electron', () => ({ dialog: {} }));

import { createEmailMessagesTable, createSyncInfoTable } from '../../electron/database-schema';
import { listMessagesForAccountView, getEmailMessageById } from '../../electron/email/email-store';
import { listDueScheduledDraftIds } from '../../electron/email/email-message-features';
import { returnOutboundDraftToInbox } from '../../electron/email/email-outbound-review';
import {
  readScheduledSendActor,
  recordScheduledSendActor,
} from '../../electron/email/email-scheduled-send-actor';
import {
  OUTBOUND_HOLD_FALLBACK_REASON,
  OUTBOUND_WARNING_MARKER,
} from '../../packages/core/src/email';

beforeAll(() => {
  db.exec(createEmailMessagesTable);
  db.exec(createSyncInfoTable);
  db.exec(`
    ALTER TABLE email_messages ADD COLUMN snoozed_until TEXT;
    ALTER TABLE email_messages ADD COLUMN scheduled_send_at TEXT;
    ALTER TABLE email_messages ADD COLUMN approval_state TEXT;
    ALTER TABLE email_messages ADD COLUMN approval_reason TEXT;
    ALTER TABLE email_messages ADD COLUMN auto_submitted INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE email_messages ADD COLUMN draft_attachment_paths_json TEXT;
    ALTER TABLE email_messages ADD COLUMN reply_parent_message_id INTEGER;
  `);
});

beforeEach(() => {
  db.exec('DELETE FROM email_messages');
  db.exec('DELETE FROM sync_info');
});

const PAST = '2020-01-01T08:00:00.000Z';

function insertScheduledDraft(id: number): void {
  db.prepare(
    `INSERT INTO email_messages
       (id, account_id, folder_id, uid, subject, folder_kind, body_text, body_html,
        scheduled_send_at, date_received)
     VALUES (?, 1, 10, ?, 'Re: Frage', 'draft', 'Antwort an den Kunden', '<p>Antwort an den Kunden</p>',
             ?, '2026-09-26T07:00:00Z')`,
  ).run(id, -id, PAST);
}

describe('Desktop: angehaltener geplanter Entwurf', () => {
  test('endgültiger Block löscht Planung und Planer, der Entwurf erscheint im Posteingang', () => {
    insertScheduledDraft(51);
    recordScheduledSendActor(51, { userId: 'planer-1' });
    expect(listDueScheduledDraftIds()).toEqual([51]);
    expect(listMessagesForAccountView(1, 'inbox')).toHaveLength(0);

    returnOutboundDraftToInbox(51, 'Preisangabe fehlt');

    const row = getEmailMessageById(51)!;
    expect(row.outbound_hold).toBe(1);
    expect(row.outbound_block_reason).toBe('Preisangabe fehlt');
    expect((row as { scheduled_send_at?: string | null }).scheduled_send_at).toBeNull();
    expect(readScheduledSendActor(51)).toBeUndefined();
    expect(listDueScheduledDraftIds()).toEqual([]);
    expect(listMessagesForAccountView(1, 'inbox').map((m) => m.id)).toEqual([51]);
    expect(row.body_text).toContain('Preisangabe fehlt');
    expect(row.body_text).toContain('Antwort an den Kunden');
  });

  test('eine angehaltene automatische Antwort behält den RFC-3834-Marker', () => {
    insertScheduledDraft(53);
    db.prepare('UPDATE email_messages SET auto_submitted = 1 WHERE id = 53').run();

    returnOutboundDraftToInbox(53, 'Preisangabe fehlt');

    expect(getEmailMessageById(53)!.auto_submitted).toBe(1);
  });

  test('Block ohne Begründung speichert und zeigt den einheitlichen Fallback-Text', () => {
    insertScheduledDraft(52);

    returnOutboundDraftToInbox(52, '');

    const row = getEmailMessageById(52)!;
    expect(row.outbound_block_reason).toBe(OUTBOUND_HOLD_FALLBACK_REASON);
    expect(row.body_text?.startsWith(OUTBOUND_WARNING_MARKER)).toBe(true);
    expect(row.body_text).toContain(OUTBOUND_HOLD_FALLBACK_REASON);
  });
});
