jest.mock('electron', () => ({ dialog: { showOpenDialog: jest.fn(), showSaveDialog: jest.fn(), showMessageBox: jest.fn() } }));
import { resolveScopedAccountOverrides } from '../../shared/mail-account-overrides';
import {
  getMailFolderCountsForScope,
  listMessagesForMailScope,
} from '../../electron/email/email-store';
import { listCategoryCountsForMailScope } from '../../electron/email/email-crm-store';

const mockPreparedSql: string[] = [];

jest.mock('../../electron/sqlite-service', () => {
  const accounts = [
    { id: 1, display_name: 'A' },
    { id: 2, display_name: 'B' },
  ];
  const messages = [
    {
      id: 1,
      account_id: 1,
      folder_id: 1,
      uid: 1,
      subject: 'In A',
      soft_deleted: 0,
      archived: 0,
      is_spam: 0,
      folder_kind: 'inbox',
      seen_local: 0,
      pop3_uidl: null,
      outbound_hold: 0,
    },
    {
      id: 2,
      account_id: 2,
      folder_id: 2,
      uid: 2,
      subject: 'In B',
      soft_deleted: 0,
      archived: 0,
      is_spam: 0,
      folder_kind: 'inbox',
      seen_local: 1,
      pop3_uidl: null,
      outbound_hold: 0,
    },
  ];
  const aggregateCounts = {
    trash: 0,
    inbox: 2,
    inbox_unread: 1,
    sent_failed: 0,
    drafts: 0,
    archived: 0,
    spam: 0,
    snoozed: 0,
  };
  const prepare = jest.fn((sql: string) => {
    mockPreparedSql.push(sql);
    return {
      all: (..._args: unknown[]) => {
        if (sql.includes('SUM(CASE')) {
          return [aggregateCounts];
        }
        if (sql.includes('GROUP BY mc.category_id')) {
          return [{ categoryId: 1, count: 2 }];
        }
        return messages;
      },
      get: () =>
        sql.includes('SUM(CASE')
          ? aggregateCounts
          : {
              trash: 0,
              inbox: 1,
              inbox_unread: 0,
              sent_failed: 0,
              drafts: 0,
              archived: 0,
              spam: 0,
              snoozed: 0,
            },
      run: jest.fn(),
    };
  });
  return {
    getDb: () => ({ prepare }),
  };
});

describe('mail account scope', () => {
  beforeEach(() => {
    mockPreparedSql.length = 0;
  });

  it('listMessagesForMailScope all returns cross-account rows', () => {
    const rows = listMessagesForMailScope('all', 'inbox', { limit: 50 });
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.account_id).sort()).toEqual([1, 2]);
  });

  it('getMailFolderCountsForScope all aggregates inbox', () => {
    const c = getMailFolderCountsForScope('all');
    expect(c.inbox).toBe(2);
    expect(c.inboxUnread).toBe(1);
  });

  it('excludes done archived messages from folder badge counts', () => {
    getMailFolderCountsForScope('all');

    const countSql = mockPreparedSql.find((sql) => sql.includes('AS archived'));
    expect(countSql).toBeDefined();
    expect(countSql).toContain("archived = 1");
    expect(countSql).toContain("COALESCE(done_local, 0) = 0");
  });

  it('listCategoryCountsForMailScope all uses global counts', () => {
    const counts = listCategoryCountsForMailScope('all');
    expect(counts).toEqual([{ categoryId: 1, count: 2 }]);
  });
});


describe('account override resolution', () => {
  const rows = [
    { id: 1, account_id: null, override_key: 'reply', sort_order: 0, value: 'global reply' },
    { id: 2, account_id: null, override_key: 'shipping', sort_order: 1, value: 'global shipping' },
    { id: 3, account_id: 7, override_key: 'reply', sort_order: 0, value: 'shop reply' },
    { id: 4, account_id: 8, override_key: 'reply', sort_order: 0, value: 'other shop reply' },
  ];

  test('shared inbox keeps global entries only', () => {
    expect(resolveScopedAccountOverrides(rows, 'all').map((r) => r.value)).toEqual([
      'global reply',
      'global shipping',
    ]);
  });

  test('selected account overrides matching global override key', () => {
    expect(resolveScopedAccountOverrides(rows, 7).map((r) => r.value)).toEqual([
      'shop reply',
      'global shipping',
    ]);
  });
});
