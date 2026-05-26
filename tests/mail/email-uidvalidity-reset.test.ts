import { createSqliteMock } from './helpers/sqlite-mock';

const syncStore = new Map<string, string>();
const { db, stmt } = createSqliteMock();

jest.mock('../../electron/sqlite-service', () => ({
  getDb: () => db,
  getSyncInfo: (key: string) => syncStore.get(key) ?? null,
  setSyncInfo: (key: string, value: string) => syncStore.set(key, value),
  deleteSyncInfo: (key: string) => syncStore.delete(key),
}));

import {
  backupFolderLocalMetaBeforeUidValidityReset,
  dismissUidValidityResetNotice,
  listUidValidityResetNotices,
  recordUidValidityResetNotice,
  tryRestoreLocalMetaFromUidValidityBackup,
} from '../../electron/email/email-uidvalidity-reset';

describe('email-uidvalidity-reset', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    syncStore.clear();
    stmt.all.mockReturnValue([]);
    stmt.get.mockReturnValue(undefined);
    stmt.run.mockReturnValue({ changes: 1 });
  });

  test('backupFolderLocalMetaBeforeUidValidityReset stores entries', () => {
    stmt.all
      .mockReturnValueOnce([
        {
          id: 5,
          uid: 10,
          message_id: '<m@x>',
          customer_id: 7,
          assigned_to: 'u1',
          is_spam: 1,
        },
      ])
      .mockReturnValueOnce([{ tag: 't1' }])
      .mockReturnValueOnce([{ category_id: 2 }])
      .mockReturnValueOnce([{ workflow_id: 3 }]);
    const entries = backupFolderLocalMetaBeforeUidValidityReset(99);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      message_id: '<m@x>',
      tags: ['t1'],
      category_ids: [2],
      workflow_ids: [3],
    });
    expect(syncStore.get('uidvalidity_backup:99')).toBeTruthy();
  });

  test('record and list notices', () => {
    recordUidValidityResetNotice({
      accountId: 1,
      folderPath: 'INBOX',
      oldValidity: '1',
      newValidity: '2',
      messageCount: 5,
      backedUpCount: 3,
    });
    stmt.all.mockReturnValue([{ key: 'uidvalidity_notice:1' }]);
    const notices = listUidValidityResetNotices();
    expect(notices[0]?.accountId).toBe(1);
    expect(notices[0]?.folderPath).toBe('INBOX');
  });

  test('dismiss notice removes or updates list', () => {
    recordUidValidityResetNotice({
      accountId: 2,
      folderPath: 'INBOX',
      oldValidity: null,
      newValidity: '3',
      messageCount: 1,
      backedUpCount: 0,
    });
    const raw = syncStore.get('uidvalidity_notice:2');
    const id = (JSON.parse(raw!) as { id: string }[])[0]!.id;
    stmt.all.mockReturnValue([{ key: 'uidvalidity_notice:2' }]);
    dismissUidValidityResetNotice(id);
    expect(syncStore.has('uidvalidity_notice:2')).toBe(false);
  });

  test('tryRestoreLocalMetaFromUidValidityBackup restores metadata', () => {
    syncStore.set(
      'uidvalidity_backup:10',
      JSON.stringify([
        {
          message_id: '<restore@x>',
          uid: 1,
          customer_id: 8,
          assigned_to: 'agent',
          is_spam: 1,
          tags: ['vip'],
          category_ids: [4],
          workflow_ids: [9],
        },
      ]),
    );
    expect(tryRestoreLocalMetaFromUidValidityBackup(10, 20, '<restore@x>')).toBe(true);
    expect(tryRestoreLocalMetaFromUidValidityBackup(10, 20, '')).toBe(false);
    expect(tryRestoreLocalMetaFromUidValidityBackup(10, 20, '<missing>')).toBe(false);
    syncStore.set('uidvalidity_backup:10', 'bad-json');
    expect(tryRestoreLocalMetaFromUidValidityBackup(10, 20, '<restore@x>')).toBe(false);
  });
});
