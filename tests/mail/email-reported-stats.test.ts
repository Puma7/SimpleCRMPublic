import { createSqliteMock } from './helpers/sqlite-mock';

const { db, stmt } = createSqliteMock();
jest.mock('../../electron/sqlite-service', () => ({ getDb: () => db }));

import { getEmailReportingSnapshot } from '../../electron/email/email-reported-stats';

describe('getEmailReportingSnapshot', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    stmt.all
      .mockReturnValueOnce([{ id: 1, display_name: 'A', email_address: 'a@x.de', protocol: 'imap' }])
      .mockReturnValueOnce([{ accountId: 1, messages: 2, unread: 1, archived: 0 }])
      .mockReturnValueOnce([{ workflow_id: 3, count: 5, errors: 1 }]);
    stmt.get.mockReturnValue({
      messages: 10,
      unread: 3,
      archived: 2,
      withCustomer: 4,
      withAssignment: 1,
      withAttachments: 6,
    });
  });

  test('aggregates totals without account filter', () => {
    const snap = getEmailReportingSnapshot(null);
    expect(snap.accounts).toHaveLength(1);
    expect(snap.totals.messages).toBe(10);
    expect(snap.perAccount[0].accountId).toBe(1);
    expect(snap.workflowRuns24h[0].workflow_id).toBe(3);
    expect(stmt.get).toHaveBeenCalledWith();
  });

  test('filters by account id', () => {
    getEmailReportingSnapshot(7);
    expect(stmt.get).toHaveBeenCalledWith(7);
    expect(stmt.all).toHaveBeenCalledWith(7);
  });

  test('coerces missing numeric fields to zero', () => {
    stmt.get.mockReturnValue({
      messages: null,
      unread: undefined,
      archived: NaN,
      withCustomer: null,
      withAssignment: null,
      withAttachments: null,
    });
    const snap = getEmailReportingSnapshot(null);
    expect(snap.totals).toEqual({
      messages: 0,
      unread: 0,
      archived: 0,
      withCustomer: 0,
      withAssignment: 0,
      withAttachments: 0,
    });
  });
});
