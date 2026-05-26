const mockAll = jest.fn();
const mockPrepare = jest.fn(() => ({ all: mockAll }));

jest.mock('../../electron/sqlite-service', () => ({
  getDb: jest.fn(() => ({
    prepare: mockPrepare,
  })),
}));

import { listMessagesByCorrespondentEmail } from '../../electron/email/email-correspondent';

describe('listMessagesByCorrespondentEmail', () => {
  beforeEach(() => {
    mockAll.mockReset();
    mockPrepare.mockClear();
    mockAll.mockReturnValue([{ id: 2 }]);
  });

  it('queries with LIKE on address fields', () => {
    listMessagesByCorrespondentEmail(1, { email: 'partner@example.com', excludeMessageId: 5, limit: 10 });
    expect(mockPrepare).toHaveBeenCalled();
    const sql = String(mockPrepare.mock.calls[0]?.[0]);
    expect(sql).toContain('from_json');
    expect(sql).toContain('to_json');
    const params = mockAll.mock.calls[0] as unknown[];
    expect(params).toEqual(
      expect.arrayContaining([1, 5, expect.stringContaining('partner@example.com'), 10]),
    );
  });

  it('returns empty for invalid email', () => {
    expect(listMessagesByCorrespondentEmail(1, { email: 'not-an-email' })).toEqual([]);
    expect(mockAll).not.toHaveBeenCalled();
  });
});
