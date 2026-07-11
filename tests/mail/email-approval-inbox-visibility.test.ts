/**
 * Zwei-Stufen-KI: Entwürfe im Zustand "Wartet auf Freigabe" müssen im
 * POSTEINGANG erscheinen (Liste + Zähler) — sonst wäre das Freigabe-Banner
 * nur über den Entwürfe-Ordner erreichbar. Echte In-Memory-DB mit dem
 * echten Schema (Basis-CREATE + die migrations-gleichen Zusatzspalten).
 */
import Database from 'better-sqlite3';

const db = new Database(':memory:');
// Nur email_messages wird angelegt — FK-Ziele (accounts/folders/…) gibt es
// im Test nicht, und sie sind für die Inbox-Query irrelevant.
db.pragma('foreign_keys = OFF');

jest.mock('../../electron/sqlite-service', () => ({
  getDb: () => db,
}));

import { createEmailMessagesTable } from '../../electron/database-schema';
import {
  getMailFolderCountsForAccount,
  listMessagesForAccountView,
} from '../../electron/email/email-store';
import {
  clearDraftApproval,
  setDraftApprovalPending,
} from '../../electron/email/email-draft-approval';

beforeAll(() => {
  db.exec(createEmailMessagesTable);
  // Spalten, die in echten Installationen per Migration (sqlite-service.ts)
  // ergänzt werden und von den Inbox-Queries gebraucht werden.
  db.exec(`
    ALTER TABLE email_messages ADD COLUMN snoozed_until TEXT;
    ALTER TABLE email_messages ADD COLUMN scheduled_send_at TEXT;
    ALTER TABLE email_messages ADD COLUMN approval_state TEXT;
    ALTER TABLE email_messages ADD COLUMN approval_reason TEXT;
    ALTER TABLE email_messages ADD COLUMN auto_submitted INTEGER NOT NULL DEFAULT 0;
  `);
});

beforeEach(() => {
  db.exec('DELETE FROM email_messages');
});

function insertMessage(input: {
  id: number;
  uid: number;
  folderKind: string;
  outboundHold?: number;
  approvalState?: string | null;
  scheduledSendAt?: string | null;
}): void {
  db.prepare(
    `INSERT INTO email_messages
       (id, account_id, folder_id, uid, subject, folder_kind, outbound_hold,
        approval_state, scheduled_send_at, date_received)
     VALUES (?, 1, 10, ?, ?, ?, ?, ?, ?, '2026-07-10T10:00:00Z')`,
  ).run(
    input.id,
    input.uid,
    `Nachricht ${input.id}`,
    input.folderKind,
    input.outboundHold ?? 0,
    input.approvalState ?? null,
    input.scheduledSendAt ?? null,
  );
}

describe('Freigabe-Entwürfe im Posteingang', () => {
  test('pending-Entwurf erscheint in Inbox-Liste und -Zähler; nach Freigabe-Ende nicht mehr', () => {
    insertMessage({ id: 1, uid: 100, folderKind: 'inbox' }); // normale Kundenmail
    insertMessage({ id: 42, uid: -5, folderKind: 'draft' }); // gewöhnlicher Entwurf

    // Ausgangslage: nur die Kundenmail liegt im Posteingang.
    expect(listMessagesForAccountView(1, 'inbox').map((m) => m.id)).toEqual([1]);
    expect(getMailFolderCountsForAccount(1).inbox).toBe(1);

    // ai.review_draft (hold) → Entwurf wartet auf Freigabe → sichtbar.
    setDraftApprovalPending(42, 'Kulanz-Zusage bitte prüfen');
    const inbox = listMessagesForAccountView(1, 'inbox');
    expect(inbox.map((m) => m.id).sort()).toEqual([1, 42]);
    expect(inbox.find((m) => m.id === 42)?.approval_state).toBe('pending');
    expect(getMailFolderCountsForAccount(1).inbox).toBe(2);

    // "Als Entwurf behalten"/Freigabe/Bearbeiten clearen → wieder unsichtbar.
    clearDraftApproval(42);
    expect(listMessagesForAccountView(1, 'inbox').map((m) => m.id)).toEqual([1]);
    expect(getMailFolderCountsForAccount(1).inbox).toBe(1);
  });

  test('eingeplante Sends und outbound_hold-Entwürfe bleiben wie gehabt', () => {
    // Bereits zum Versand eingeplant → gehört in "Geplant", nicht in die Inbox.
    insertMessage({
      id: 43,
      uid: -6,
      folderKind: 'draft',
      approvalState: 'pending',
      scheduledSendAt: '2026-07-11T09:00:00Z',
    });
    expect(listMessagesForAccountView(1, 'inbox')).toHaveLength(0);

    // Bestehendes Verhalten unangetastet: outbound_hold-Entwurf in der Inbox.
    insertMessage({ id: 44, uid: -7, folderKind: 'draft', outboundHold: 1 });
    expect(listMessagesForAccountView(1, 'inbox').map((m) => m.id)).toEqual([44]);
  });
});
