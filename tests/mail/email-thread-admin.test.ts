import {
  EMAIL_MESSAGES_TABLE,
  EMAIL_THREADS_TABLE,
  EMAIL_THREAD_ALIASES_TABLE,
} from '../../electron/database-schema';

const stmt = {
  get: jest.fn(),
  run: jest.fn(() => ({ changes: 1, lastInsertRowid: 1 })),
  all: jest.fn(() => []),
};
const db = {
  prepare: jest.fn(() => stmt),
};

jest.mock('../../electron/sqlite-service', () => ({
  getDb: () => db,
}));

jest.mock('../../electron/email/email-thread-aggregate', () => ({
  rebuildThreadEdges: jest.fn(),
  upsertThreadAggregates: jest.fn(),
}));

jest.mock('../../electron/email/email-thread-resolve', () => ({
  canonicalThreadId: (id: string) => id,
  wouldCreateThreadAliasCycle: jest.fn(() => false),
}));

jest.mock('../../electron/email/account-mail-settings-store', () => ({
  allocateNextTicketCodeForAccount: jest.fn((accountId: number) => `SHOP${accountId}-000001`),
}));

import { mergeThreads, splitMessageToOwnThread } from '../../electron/email/email-thread-admin';

describe('email thread admin', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    stmt.get.mockReturnValue(undefined);
    stmt.run.mockReturnValue({ changes: 1, lastInsertRowid: 1 });
  });

  it('merges alias into canonical without touching other accounts', () => {
    const r = mergeThreads('t-b', 't-a', 1);

    expect(r.ok).toBe(true);
    expect(db.prepare).toHaveBeenCalledWith(
      expect.stringContaining(`UPDATE ${EMAIL_MESSAGES_TABLE} SET thread_id = ? WHERE thread_id = ? AND account_id = ?`),
    );
    expect(stmt.run).toHaveBeenCalledWith('t-a', 't-b', 1);
    expect(db.prepare).toHaveBeenCalledWith(
      expect.stringContaining(`DELETE FROM ${EMAIL_THREADS_TABLE} WHERE id = ?`),
    );
  });

  it('splits a message into an account-namespaced ticket/thread', () => {
    stmt.get
      .mockReturnValueOnce({ thread_id: 'old-thread', ticket_code: 'OLD-1', account_id: 7 })
      .mockReturnValueOnce(undefined);

    const r = splitMessageToOwnThread(42);

    expect(r.ok).toBe(true);
    expect(db.prepare).toHaveBeenCalledWith(
      expect.stringContaining(`INSERT INTO ${EMAIL_THREADS_TABLE} (id, ticket_code, account_id) VALUES (?, ?, ?)`),
    );
    expect(stmt.run).toHaveBeenCalledWith(expect.any(String), 'SHOP7-000001', 7);
    expect(stmt.run).toHaveBeenCalledWith(expect.any(String), 'SHOP7-000001', 42);
  });
});
