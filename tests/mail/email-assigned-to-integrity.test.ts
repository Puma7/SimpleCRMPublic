/**
 * @jest-environment node
 */
import Database from 'better-sqlite3';
import {
  createCustomersTable,
  createEmailAccountsTable,
  createEmailFoldersTable,
  createEmailMessagesTable,
  createEmailTeamMembersTable,
  EMAIL_MESSAGES_TABLE,
  EMAIL_TEAM_MEMBERS_TABLE,
} from '../../electron/database-schema';
import { ensureAssignedToReferentialIntegrity } from '../../electron/email/email-assigned-to-integrity';

describe('ensureAssignedToReferentialIntegrity', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec('PRAGMA foreign_keys = ON');
    db.exec(createCustomersTable);
    db.exec(createEmailAccountsTable);
    db.exec(createEmailTeamMembersTable);
    db.exec(createEmailFoldersTable);
    db.exec(createEmailMessagesTable);
    db.prepare(
      `INSERT INTO email_accounts (id, display_name, email_address, imap_host, imap_port, imap_tls, imap_username, keytar_account_key)
       VALUES (1, 'T', 't@x.de', 'h', 993, 1, 'u', 'k')`,
    ).run();
    db.prepare(`INSERT INTO ${EMAIL_TEAM_MEMBERS_TABLE} (id, display_name, role) VALUES ('a1', 'Agent', 'agent')`).run();
    db.prepare(`INSERT INTO email_folders (id, account_id, path, last_uid) VALUES (1, 1, 'INBOX', 0)`).run();
  });

  afterEach(() => {
    db?.close();
  });

  test('clears orphaned assigned_to and nulls on team delete', () => {
    db.exec('PRAGMA foreign_keys = OFF');
    db.prepare(
      `INSERT INTO ${EMAIL_MESSAGES_TABLE}
       (account_id, folder_id, uid, assigned_to, folder_kind, has_attachments)
       VALUES (1, 1, 1, 'ghost', 'inbox', 0), (1, 1, 2, 'a1', 'inbox', 0)`,
    ).run();
    db.exec('PRAGMA foreign_keys = ON');

    ensureAssignedToReferentialIntegrity(db);

    expect(
      (
        db
          .prepare(`SELECT assigned_to FROM ${EMAIL_MESSAGES_TABLE} WHERE uid = 1`)
          .get() as { assigned_to: string | null }
      ).assigned_to,
    ).toBeNull();
    expect(
      (
        db
          .prepare(`SELECT assigned_to FROM ${EMAIL_MESSAGES_TABLE} WHERE uid = 2`)
          .get() as { assigned_to: string | null }
      ).assigned_to,
    ).toBe('a1');

    db.prepare(`DELETE FROM ${EMAIL_TEAM_MEMBERS_TABLE} WHERE id = 'a1'`).run();
    expect(
      (
        db
          .prepare(`SELECT assigned_to FROM ${EMAIL_MESSAGES_TABLE} WHERE uid = 2`)
          .get() as { assigned_to: string | null }
      ).assigned_to,
    ).toBeNull();
  });
});
