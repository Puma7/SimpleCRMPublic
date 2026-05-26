const store = new Map<string, string>();
const mockRun = jest.fn();
const mockGet = jest.fn();
const mockAll = jest.fn();

jest.mock('../../electron/sqlite-service', () => ({
  getDb: () => ({
    prepare: (sql: string) => ({
      all: (...args: unknown[]) => mockAll(sql, ...args),
      get: (...args: unknown[]) => mockGet(sql, ...args),
      run: (...args: unknown[]) => mockRun(sql, ...args),
    }),
  }),
  getSyncInfo: (key: string) => store.get(key) ?? null,
  setSyncInfo: (key: string, value: string) => {
    store.set(key, value);
  },
  deleteSyncInfo: (key: string) => {
    store.delete(key);
  },
}));

import {
  backupFolderLocalMetaBeforeUidValidityReset,
  tryRestoreLocalMetaFromUidValidityBackup,
} from '../../electron/email/email-uidvalidity-reset';

describe('email-uidvalidity-reset', () => {
  beforeEach(() => {
    store.clear();
    jest.clearAllMocks();
  });

  test('backupFolderLocalMetaBeforeUidValidityReset stores JSON backup', () => {
    mockAll.mockReturnValueOnce([
      {
        id: 10,
        uid: 42,
        message_id: '<abc@test>',
        customer_id: 3,
        assigned_to: 'user1',
        is_spam: 0,
      },
    ]);
    mockAll.mockReturnValue([]);
    mockGet.mockReturnValue(undefined);

    const entries = backupFolderLocalMetaBeforeUidValidityReset(7);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.message_id).toBe('<abc@test>');
    const raw = store.get('uidvalidity_backup:7');
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw!)).toHaveLength(1);
  });

  test('tryRestoreLocalMetaFromUidValidityBackup applies tags and customer', () => {
    store.set(
      'uidvalidity_backup:7',
      JSON.stringify([
        {
          message_id: '<abc@test>',
          uid: 42,
          customer_id: 3,
          assigned_to: 'user1',
          is_spam: 1,
          tags: ['vip'],
          category_ids: [2],
          workflow_ids: [5],
        },
      ]),
    );

    const ok = tryRestoreLocalMetaFromUidValidityBackup(7, 99, '<abc@test>');
    expect(ok).toBe(true);
    expect(mockRun).toHaveBeenCalled();
    const sqls = mockRun.mock.calls.map((c) => String(c[0]));
    expect(sqls.some((s) => s.includes('customer_id'))).toBe(true);
    expect(sqls.some((s) => s.includes('INSERT OR IGNORE INTO') && s.includes('tag'))).toBe(true);
  });
});
