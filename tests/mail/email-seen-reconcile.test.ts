/**
 * @jest-environment node
 */
import Database from 'better-sqlite3';
import {
  createCustomersTable,
  createEmailFoldersTable,
  createEmailMessagesTable,
  createEmailTeamMembersTable,
  createEmailAccountsTable,
  EMAIL_MESSAGES_TABLE,
} from '../../electron/database-schema';

const fetchMock = jest.fn();
const getMailboxLockMock = jest.fn(async () => ({ release: jest.fn() }));

jest.mock('../../electron/sqlite-service', () => ({
  getDb: () => db,
}));

import {
  pushPendingSeenSyncsForFolder,
  reconcileSeenFlagsForFolder,
} from '../../electron/email/email-seen-reconcile';

let db: Database.Database;

describe('reconcileSeenFlagsForFolder', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
    db.prepare(`INSERT INTO email_folders (id, account_id, path, last_uid) VALUES (10, 1, 'INBOX', 0)`).run();
    db.prepare(
      `INSERT INTO ${EMAIL_MESSAGES_TABLE}
       (id, account_id, folder_id, uid, seen_local, seen_sync_pending, folder_kind, has_attachments)
       VALUES (1, 1, 10, 42, 0, 0, 'inbox', 0), (2, 1, 10, 43, 1, 0, 'inbox', 0)`,
    ).run();
    getMailboxLockMock.mockResolvedValue({ release: jest.fn() });
  });

  afterEach(() => {
    db?.close();
  });

  test('updates seen_local from server \\Seen flags', async () => {
    async function* gen() {
      yield { uid: 42, flags: new Set(['\\Seen']) };
      yield { uid: 43, flags: new Set<string>() };
    }
    fetchMock.mockReturnValue(gen());

    const client = {
      getMailboxLock: getMailboxLockMock,
      fetch: fetchMock,
    };

    const changed = await reconcileSeenFlagsForFolder(client as never, 10, 'INBOX');
    expect(changed).toBe(2);
    expect(
      (db.prepare(`SELECT seen_local FROM ${EMAIL_MESSAGES_TABLE} WHERE id = 1`).get() as { seen_local: number })
        .seen_local,
    ).toBe(1);
    expect(
      (db.prepare(`SELECT seen_local FROM ${EMAIL_MESSAGES_TABLE} WHERE id = 2`).get() as { seen_local: number })
        .seen_local,
    ).toBe(0);
  });

  test('does not overwrite pending local seen state from server flags', async () => {
    db.prepare(`UPDATE ${EMAIL_MESSAGES_TABLE} SET seen_local = 1, seen_sync_pending = 1 WHERE id = 1`).run();

    async function* gen() {
      yield { uid: 42, flags: new Set<string>() };
    }
    fetchMock.mockReturnValue(gen());

    const changed = await reconcileSeenFlagsForFolder(
      { getMailboxLock: getMailboxLockMock, fetch: fetchMock } as never,
      10,
      'INBOX',
    );

    expect(changed).toBe(0);
    expect(
      (db.prepare(`SELECT seen_local, seen_sync_pending FROM ${EMAIL_MESSAGES_TABLE} WHERE id = 1`).get() as {
        seen_local: number;
        seen_sync_pending: number;
      }),
    ).toEqual({ seen_local: 1, seen_sync_pending: 1 });
  });

  test('retries pending local seen state and clears pending after IMAP push', async () => {
    db.prepare(`UPDATE ${EMAIL_MESSAGES_TABLE} SET seen_local = 1, seen_sync_pending = 1 WHERE id = 1`).run();
    const messageFlagsAdd = jest.fn().mockResolvedValue(undefined);
    const messageFlagsRemove = jest.fn().mockResolvedValue(undefined);

    const pushed = await pushPendingSeenSyncsForFolder(
      { messageFlagsAdd, messageFlagsRemove } as never,
      10,
    );

    expect(pushed).toBe(1);
    expect(messageFlagsAdd).toHaveBeenCalledWith({ uid: 42 }, ['\\Seen'], { uid: true });
    expect(messageFlagsRemove).not.toHaveBeenCalled();
    expect(
      (db.prepare(`SELECT seen_sync_pending FROM ${EMAIL_MESSAGES_TABLE} WHERE id = 1`).get() as {
        seen_sync_pending: number;
      }).seen_sync_pending,
    ).toBe(0);
  });

  test('keeps pending local seen state when IMAP push fails', async () => {
    db.prepare(`UPDATE ${EMAIL_MESSAGES_TABLE} SET seen_local = 0, seen_sync_pending = 1 WHERE id = 2`).run();

    await expect(
      pushPendingSeenSyncsForFolder(
        {
          messageFlagsAdd: jest.fn().mockResolvedValue(undefined),
          messageFlagsRemove: jest.fn().mockRejectedValue(new Error('network')),
        } as never,
        10,
      ),
    ).rejects.toThrow('network');

    expect(
      (db.prepare(`SELECT seen_sync_pending FROM ${EMAIL_MESSAGES_TABLE} WHERE id = 2`).get() as {
        seen_sync_pending: number;
      }).seen_sync_pending,
    ).toBe(1);
  });
});
