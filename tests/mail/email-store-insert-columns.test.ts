import { createSqliteMock } from './helpers/sqlite-mock';

const { db, stmt } = createSqliteMock();
let capturedInsertSql = '';

db.prepare.mockImplementation((sql: string) => {
  if (sql.includes('INSERT INTO') && sql.includes('email_messages') && sql.includes('ON CONFLICT')) {
    capturedInsertSql = sql;
  }
  return stmt;
});

jest.mock('../../electron/sqlite-service', () => ({
  getDb: () => db,
  allocatePop3NegativeUid: jest.fn(() => -1_000_001),
}));

import { insertOrUpdateEmailMessage } from '../../electron/email/email-store';

function countInsertColumns(sql: string): number {
  const m = sql.match(/INSERT INTO[^(]+\(([\s\S]+?)\)\s*VALUES/i);
  if (!m) return 0;
  return m[1].split(',').map((s) => s.trim()).filter(Boolean).length;
}

function countValueSlots(sql: string): number {
  const m = sql.match(/VALUES\s*([\s\S]+?)\s*ON CONFLICT/i);
  if (!m) return 0;
  const chunk = m[1];
  return chunk.split(',').map((s) => s.trim()).filter(Boolean).length;
}

describe('insertOrUpdateEmailMessage INSERT column alignment', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    capturedInsertSql = '';
    stmt.get.mockReturnValue(undefined);
    stmt.run.mockReturnValue({ lastInsertRowid: 42, changes: 1 });
  });

  test('INSERT column count matches VALUES slots including archived/is_spam', () => {
    insertOrUpdateEmailMessage({
      accountId: 1,
      folderId: 10,
      uid: 100,
      messageId: '<a@b>',
      inReplyTo: null,
      referencesHeader: null,
      subject: 'Test',
      fromJson: '[]',
      toJson: '[]',
      ccJson: '[]',
      dateReceived: '2024-01-01T00:00:00.000Z',
      snippet: 's',
      bodyText: 't',
      bodyHtml: null,
      seenLocal: false,
      folderKind: 'sent',
      archived: true,
      isSpam: true,
    });

    expect(capturedInsertSql).toContain('archived, is_spam, spam_status, post_process_done');
    expect(countInsertColumns(capturedInsertSql)).toBe(countValueSlots(capturedInsertSql));

    const placeholders = (capturedInsertSql.match(/\?/g) ?? []).length;
    expect(placeholders).toBe(26);
    expect(stmt.run.mock.calls[0]?.length).toBe(26);
  });
});
