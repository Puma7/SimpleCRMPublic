import {
  clearImapAuthNotice,
  dismissImapAuthNotice,
  listImapAuthNotices,
  maybeRecordImapAuthNotice,
  recordImapAuthNotice,
} from '../../electron/email/email-imap-auth-notice';

const syncStore = new Map<string, string>();

jest.mock('../../electron/sqlite-service', () => ({
  getSyncInfo: (key: string) => syncStore.get(key) ?? null,
  setSyncInfo: (key: string, value: string) => {
    syncStore.set(key, value);
  },
  deleteSyncInfo: (key: string) => {
    syncStore.delete(key);
  },
  getDb: () => ({
    prepare: (sql: string) => ({
      all: (prefix: string) => {
        const rows: { key: string; value: string }[] = [];
        for (const [key, value] of syncStore) {
          if (sql.includes('LIKE') && key.startsWith(prefix.replace(/%/g, ''))) {
            rows.push({ key, value });
          }
        }
        return rows;
      },
    }),
  }),
}));

describe('email-imap-auth-notice', () => {
  beforeEach(() => {
    syncStore.clear();
  });

  test('record and list notices', () => {
    recordImapAuthNotice(3, 'OAuth refresh failed');
    const list = listImapAuthNotices();
    expect(list).toHaveLength(1);
    expect(list[0].accountId).toBe(3);
    expect(list[0].message).toContain('OAuth');
  });

  test('maybeRecordImapAuthNotice stores error message', () => {
    maybeRecordImapAuthNotice(5, new Error('Kein gespeichertes IMAP-Passwort'));
    expect(listImapAuthNotices()[0]?.accountId).toBe(5);
  });

  test('clear and dismiss remove notice', () => {
    recordImapAuthNotice(1, 'x');
    clearImapAuthNotice(1);
    expect(listImapAuthNotices()).toHaveLength(0);
    recordImapAuthNotice(2, 'y');
    dismissImapAuthNotice(2);
    expect(listImapAuthNotices()).toHaveLength(0);
  });
});
