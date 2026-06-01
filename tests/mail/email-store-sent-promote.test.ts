import { createSqliteMock } from './helpers/sqlite-mock';

const { db, stmt } = createSqliteMock();
let lastSql = '';

db.prepare.mockImplementation((sql: string) => {
  lastSql = sql;
  return stmt;
});

jest.mock('../../electron/sqlite-service', () => ({
  getDb: () => db,
  allocatePop3NegativeUid: jest.fn(() => -1),
}));

import { insertOrUpdateEmailMessage } from '../../electron/email/email-store';

describe('insertOrUpdateEmailMessage sent promotion', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    lastSql = '';
    stmt.get.mockImplementation(() => {
      if (lastSql.includes("folder_kind = 'sent'") && lastSql.includes('uid < 0')) {
        return { id: 7 };
      }
      if (lastSql.includes('uid = ?') && lastSql.includes('id !=')) {
        return undefined;
      }
      return undefined;
    });
    stmt.run.mockReturnValue({ changes: 1, lastInsertRowid: 7 });
  });

  test('updates local sent row instead of inserting duplicate', () => {
    const result = insertOrUpdateEmailMessage({
      accountId: 1,
      folderId: 8,
      uid: 200,
      messageId: '<sent@local>',
      inReplyTo: null,
      referencesHeader: null,
      subject: 'Server',
      fromJson: '[]',
      toJson: '[]',
      ccJson: '[]',
      dateReceived: null,
      snippet: 's',
      bodyText: 't',
      bodyHtml: null,
      seenLocal: true,
      folderKind: 'sent',
    });
    expect(result).toEqual({ id: 7, isNew: false });
    expect(lastSql).toContain('UPDATE');
    expect(lastSql).toContain('folder_id = ?');
    expect(stmt.run).toHaveBeenCalled();
    const insertCalls = db.prepare.mock.calls.filter(
      (c) => String(c[0]).includes('INSERT INTO') && String(c[0]).includes('ON CONFLICT'),
    );
    expect(insertCalls.length).toBe(0);
  });
});
