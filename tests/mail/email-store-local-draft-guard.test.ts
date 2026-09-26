/**
 * @jest-environment node
 *
 * Nur echte lokale Entwuerfe duerfen ueber die Entwurfs-Funktionen geloescht
 * oder ueberschrieben werden. Echte SQLite (frisches Schema), echte Store-Logik.
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
  POP3_UID_CEILING,
  bulkDeleteLocalComposeDrafts,
  createComposeDraft,
  deleteLocalComposeDraft,
  getEmailMessageById,
  markDraftAsSent,
  updateComposeDraft,
} from '../../electron/email/email-store';

function insertPop3Message(uid: number, uidl: string): number {
  const r = db
    .prepare(
      `INSERT INTO ${EMAIL_MESSAGES_TABLE} (account_id, folder_id, uid, subject, body_text, pop3_uidl)
       VALUES (1, 1, ?, ?, 'Inhalt', ?)`,
    )
    .run(uid, `Rechnung ${uidl}`, uidl);
  return Number(r.lastInsertRowid);
}

describe('Entwurfs-Funktionen treffen nur lokale Entwuerfe', () => {
  let pop3A: number;
  let pop3B: number;
  let draft: number;
  let sentCopy: number;

  beforeEach(() => {
    db = new Database(':memory:');
    bootstrapFreshDatabaseSchema(db);
    db.prepare(
      `INSERT INTO ${EMAIL_ACCOUNTS_TABLE}
         (id, display_name, email_address, imap_host, imap_username, keytar_account_key, protocol)
       VALUES (1, 'POP3', 'pop@firma.de', 'pop.firma.de', 'pop', 'k1', 'pop3')`,
    ).run();
    db.prepare(`INSERT INTO ${EMAIL_FOLDERS_TABLE} (id, account_id, path) VALUES (1, 1, 'INBOX')`).run();
    pop3A = insertPop3Message(POP3_UID_CEILING, 'UIDL-A');
    pop3B = insertPop3Message(POP3_UID_CEILING - 1, 'UIDL-B');
    draft = createComposeDraft({ accountId: 1, subject: 'Entwurf' });
    sentCopy = createComposeDraft({ accountId: 1, subject: 'Gesendet' });
    markDraftAsSent(sentCopy);
  });

  afterEach(() => {
    db.close();
  });

  // C-A14: Empfangene POP3-Mails (negative UID) liessen sich als "lokaler Entwurf" endgueltig loeschen und ueberschreiben.
  test('empfangene POP3-Mails bleiben erhalten', () => {
    expect(() => deleteLocalComposeDraft(pop3A)).toThrow(/Nur lokale Entwürfe/);
    expect(bulkDeleteLocalComposeDrafts([pop3A, pop3B])).toBe(0);
    expect(() => updateComposeDraft(pop3B, { subject: 'ueberschrieben' })).toThrow(/Nur lokale Entwürfe/);

    expect(getEmailMessageById(pop3A)?.subject).toBe('Rechnung UIDL-A');
    expect(getEmailMessageById(pop3B)?.subject).toBe('Rechnung UIDL-B');
  });

  test('gesendete lokale Kopien sind keine Entwuerfe mehr', () => {
    expect(getEmailMessageById(sentCopy)).toMatchObject({ folder_kind: 'sent' });
    expect(() => deleteLocalComposeDraft(sentCopy)).toThrow(/Nur lokale Entwürfe/);
    expect(bulkDeleteLocalComposeDrafts([sentCopy])).toBe(0);
    expect(() => updateComposeDraft(sentCopy, { subject: 'geaendert' })).toThrow(/Nur lokale Entwürfe/);
    expect(getEmailMessageById(sentCopy)?.subject).toBe('Gesendet');
  });

  test('lokale Entwuerfe lassen sich weiter bearbeiten und loeschen', () => {
    updateComposeDraft(draft, { subject: 'Neu' });
    expect(getEmailMessageById(draft)?.subject).toBe('Neu');

    expect(bulkDeleteLocalComposeDrafts([draft, pop3A])).toBe(1);
    expect(getEmailMessageById(draft)).toBeUndefined();
    expect(getEmailMessageById(pop3A)).toBeDefined();

    const second = createComposeDraft({ accountId: 1 });
    deleteLocalComposeDraft(second);
    expect(getEmailMessageById(second)).toBeUndefined();
    expect(() => deleteLocalComposeDraft(second)).toThrow(/nicht gefunden/);
  });
});
