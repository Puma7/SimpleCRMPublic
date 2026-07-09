import { createSqliteMock } from './helpers/sqlite-mock';

const { db, stmt } = createSqliteMock();
jest.mock('../../electron/sqlite-service', () => ({
  getDb: () => db,
}));

import { assignJwzThreadAndTicket } from '../../electron/email/email-threading-jwz';

describe('assignJwzThreadAndTicket', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    stmt.all.mockReturnValue([]);
    stmt.get.mockReturnValue(undefined);
    stmt.run.mockReturnValue({ changes: 1, lastInsertRowid: 1 });
    db.prepare.mockImplementation((sql: string) => {
      if (sql.includes('FROM email_accounts')) {
        return { ...stmt, get: jest.fn(() => ({ id: 2, email: 'shop@example.test' })) };
      }
      if (sql.includes('FROM email_account_mail_settings')) {
        return { ...stmt, get: jest.fn(() => undefined), all: jest.fn(() => [{ ticket_prefix: 'SHOPA' }]) };
      }
      if (sql.includes('SELECT id FROM email_threads')) {
        return { ...stmt, get: jest.fn(() => undefined) };
      }
      if (sql.includes('SELECT subject, from_json FROM email_messages')) {
        return { ...stmt, get: jest.fn(() => ({ subject: 'Re: topic', from_json: null })) };
      }
      return stmt;
    });
  });

  test('creates new ticket when no related headers', () => {
    assignJwzThreadAndTicket(1, 10, {
      messageIdHeader: null,
      inReplyTo: null,
      referencesHeader: null,
      subject: 'Hello',
    });
    expect(stmt.run).toHaveBeenCalled();
  });

  test('uses the message account when creating a thread from a subject ticket', () => {
    stmt.all.mockReturnValueOnce([]);
    assignJwzThreadAndTicket(2, 10, {
      messageIdHeader: '<a@test>',
      inReplyTo: null,
      referencesHeader: null,
      subject: '[SHOPA-000123] Re: topic',
    });

    expect(stmt.run).toHaveBeenCalledWith(expect.any(String), 'SHOPA-000123', 10);
  });

  test('merges when related thread found', () => {
    stmt.all.mockReturnValueOnce([{ thread_id: 'th-1', ticket_code: 'SCR-AAA' }]);
    assignJwzThreadAndTicket(2, 10, {
      messageIdHeader: '<a@test>',
      inReplyTo: '<b@test>',
      referencesHeader: '<c@test>',
      subject: 'Re: topic',
    });
    expect(stmt.all).toHaveBeenCalled();
  });
});
