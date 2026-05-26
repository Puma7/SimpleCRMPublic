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
