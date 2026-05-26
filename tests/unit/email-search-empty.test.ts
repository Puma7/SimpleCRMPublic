jest.mock('../../electron/sqlite-service', () => ({
  getDb: jest.fn(() => ({
    prepare: () => ({ all: jest.fn(), get: jest.fn() }),
  })),
}));

import { searchMessagesForAccountWithMeta } from '../../electron/email/email-crm-store';

describe('email search empty query', () => {
  test('searchMessagesForAccountWithMeta returns empty for blank query', () => {
    const r = searchMessagesForAccountWithMeta(1, '   ', {});
    expect(r.rows).toEqual([]);
    expect(r.hasMore).toBe(false);
  });
});
