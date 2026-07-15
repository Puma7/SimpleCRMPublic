jest.mock('../../electron/sqlite-service', () => ({
  getDb: jest.fn(),
}));

jest.mock('../../electron/email/email-store', () => ({
  listMessagesForMailScope: jest.fn(),
}));

jest.mock('../../electron/email/email-ticket', () => ({
  createTicketCodeForAccount: jest.fn(() => 'TICKET-GENERATED'),
}));

jest.mock('../../electron/email/email-thread-resolve', () => ({
  canonicalThreadId: jest.fn((threadId: string) =>
    threadId.startsWith('alias:') ? threadId.slice('alias:'.length) : threadId,
  ),
  normalizeSubject: jest.fn((subject: string | null | undefined) =>
    (subject ?? '').replace(/^re:\s*/i, '').trim().toLowerCase(),
  ),
  resolveThreadListKey: jest.fn((row: { id: number; thread_id?: string | null }) => ({
    key: row.thread_id?.trim() || `message:${row.id}`,
    strategy: row.thread_id ? 'thread_id' : 'message_id',
  })),
}));

import { getDb } from '../../electron/sqlite-service';
import { listMessagesForMailScope } from '../../electron/email/email-store';
import { createTicketCodeForAccount } from '../../electron/email/email-ticket';
import {
  listPendingThreadAliasWarnings,
  runCrossAccountThreadHeuristics,
} from '../../electron/email/email-thread-heuristics';
import {
  listThreadMessages,
  listThreadsForMailScope,
  rebuildThreadAggregates,
  rebuildThreadEdges,
  upsertThreadAggregates,
} from '../../electron/email/email-thread-aggregate';

const getDbMock = getDb as jest.MockedFunction<typeof getDb>;
const listMessagesMock = listMessagesForMailScope as jest.MockedFunction<
  typeof listMessagesForMailScope
>;
const createTicketMock = createTicketCodeForAccount as jest.MockedFunction<
  typeof createTicketCodeForAccount
>;

type Prepared = {
  get?: jest.Mock;
  all?: jest.Mock;
  run?: jest.Mock;
};

function routedDb(route: (sql: string) => Prepared) {
  const prepare = jest.fn((sql: string) => route(sql));
  return { db: { prepare } as never, prepare };
}

function message(overrides: Record<string, unknown>) {
  return {
    id: 1,
    uid: 1,
    account_id: 1,
    thread_id: null,
    date_received: '2026-07-14T10:00:00.000Z',
    subject: 'Betreff',
    seen_local: 0,
    ...overrides,
  } as never;
}

describe('cross-account thread heuristics', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('is inert without a database or usable source thread', () => {
    getDbMock.mockReturnValueOnce(null as never);
    expect(runCrossAccountThreadHeuristics(1)).toBeNull();

    const missing = routedDb(() => ({ get: jest.fn(() => undefined) }));
    getDbMock.mockReturnValueOnce(missing.db);
    expect(runCrossAccountThreadHeuristics(2)).toBeNull();

    const noSubject = routedDb(() => ({
      get: jest.fn(() => ({
        id: 3,
        account_id: 1,
        thread_id: 'thread-a',
        subject: null,
        message_id: null,
        normalized_subject: null,
      })),
    }));
    getDbMock.mockReturnValueOnce(noSubject.db);
    expect(runCrossAccountThreadHeuristics(3)).toBeNull();
  });

  test('returns a warning for a different-account subject candidate', () => {
    const { db } = routedDb((sql) => {
      if (sql.includes('WHERE id = ?')) {
        return {
          get: jest.fn(() => ({
            id: 10,
            account_id: 1,
            thread_id: 'thread-a',
            subject: 'Re: Projekt',
            message_id: '<a@example.com>',
            normalized_subject: 'projekt',
          })),
        };
      }
      if (sql.includes('normalized_subject = ?')) {
        return {
          all: jest.fn(() => [
            { id: 11, account_id: 1, thread_id: 'same-account', subject: 'Projekt' },
            { id: 12, account_id: 2, thread_id: 'alias:thread-b', subject: 'Projekt' },
          ]),
        };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    getDbMock.mockReturnValue(db);

    expect(runCrossAccountThreadHeuristics(10)).toEqual({
      messageId: 10,
      accountId: 1,
      subject: 'Re: Projekt',
      aliasThreadId: 'thread-b',
      canonicalThreadId: 'thread-a',
      confidence: 'medium',
    });
  });

  test('falls back to Message-ID overlap and ignores an already identical thread', () => {
    const { db } = routedDb((sql) => {
      if (sql.includes('WHERE id = ?')) {
        return {
          get: jest.fn(() => ({
            id: 20,
            account_id: 1,
            thread_id: 'thread-a',
            subject: 'Projekt',
            message_id: ' <MID@EXAMPLE.COM> ',
            normalized_subject: 'projekt',
          })),
        };
      }
      if (sql.includes('normalized_subject = ?')) {
        return {
          all: jest.fn(() => [
            { id: 21, account_id: 2, thread_id: 'thread-a', subject: 'Projekt' },
          ]),
        };
      }
      if (sql.includes('LOWER(message_id)')) {
        return {
          get: jest.fn(() => ({
            id: 22,
            account_id: 2,
            thread_id: 'alias:thread-c',
            subject: 'Anders',
          })),
        };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    getDbMock.mockReturnValue(db);

    expect(runCrossAccountThreadHeuristics(20)).toMatchObject({
      aliasThreadId: 'thread-c',
      canonicalThreadId: 'thread-a',
    });
  });

  test('lists persisted warnings with the requested limit', () => {
    const rows = [{
      messageId: 1,
      accountId: 2,
      subject: 'Projekt',
      aliasThreadId: 'b',
      canonicalThreadId: 'a',
      confidence: 'medium',
    }];
    const all = jest.fn(() => rows);
    const { db } = routedDb(() => ({ all }));
    getDbMock.mockReturnValue(db);

    expect(listPendingThreadAliasWarnings(7)).toBe(rows);
    expect(all).toHaveBeenCalledWith(7);

    getDbMock.mockReturnValue(null as never);
    expect(listPendingThreadAliasWarnings()).toEqual([]);
  });
});

describe('thread edge and aggregate persistence', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('is inert without a database and for an empty thread', () => {
    getDbMock.mockReturnValue(null as never);
    rebuildThreadEdges('thread-a');
    upsertThreadAggregates('thread-a');
    rebuildThreadAggregates();
    expect(listThreadMessages('thread-a')).toEqual([]);

    const { db, prepare } = routedDb(() => ({ all: jest.fn(() => []) }));
    getDbMock.mockReturnValue(db);
    rebuildThreadEdges('thread-a');
    expect(prepare).toHaveBeenCalledTimes(1);
  });

  test('rebuilds parent-child edges from in-reply-to and bounded references', () => {
    const deleteRun = jest.fn();
    const insertRun = jest.fn();
    const messages = [
      { id: 1, message_id: '<root@example.com>', in_reply_to: null, references_header: null },
      { id: 2, message_id: '<child@example.com>', in_reply_to: '<root@example.com>', references_header: null },
      { id: 3, message_id: '<third@example.com>', in_reply_to: null, references_header: '<missing> <child@example.com>' },
      { id: 4, message_id: '<self@example.com>', in_reply_to: '<self@example.com>', references_header: null },
    ];
    const { db } = routedDb((sql) => {
      if (sql.includes('SELECT id, message_id')) return { all: jest.fn(() => messages) };
      if (sql.includes('DELETE FROM')) return { run: deleteRun };
      if (sql.includes('INSERT OR IGNORE')) return { run: insertRun };
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    getDbMock.mockReturnValue(db);

    rebuildThreadEdges('thread-a');

    expect(deleteRun).toHaveBeenCalledWith(1, 2, 3, 4);
    expect(insertRun).toHaveBeenNthCalledWith(1, 1, 2);
    expect(insertRun).toHaveBeenNthCalledWith(2, 2, 3);
    expect(insertRun).toHaveBeenCalledTimes(2);
  });

  test('upserts thread statistics with generated and existing tickets', () => {
    const upsertRun = jest.fn();
    let ticket = undefined as { ticket_code: string } | undefined;
    const { db } = routedDb((sql) => {
      if (sql.includes('COUNT(*) AS cnt')) {
        return {
          get: jest.fn(() => ({
            cnt: 3,
            last_at: '2026-07-14T10:00:00.000Z',
            has_unread: 1,
            has_att: 1,
            account_id: 8,
          })),
        };
      }
      if (sql.includes('SELECT ticket_code')) return { get: jest.fn(() => ticket) };
      if (sql.includes('INSERT INTO')) return { run: upsertRun };
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    getDbMock.mockReturnValue(db);

    upsertThreadAggregates('thread-a');
    expect(createTicketMock).toHaveBeenCalledWith(8);
    expect(upsertRun).toHaveBeenCalledWith(
      'thread-a',
      'TICKET-GENERATED',
      8,
      3,
      '2026-07-14T10:00:00.000Z',
      1,
      1,
    );

    ticket = { ticket_code: 'TICKET-EXISTING' };
    upsertThreadAggregates('thread-a');
    expect(upsertRun).toHaveBeenLastCalledWith(
      'thread-a',
      'TICKET-EXISTING',
      8,
      3,
      '2026-07-14T10:00:00.000Z',
      1,
      1,
    );
  });

  test('skips aggregate upsert when the thread contains no messages', () => {
    const { db, prepare } = routedDb(() => ({
      get: jest.fn(() => ({ cnt: 0 })),
    }));
    getDbMock.mockReturnValue(db);

    upsertThreadAggregates('thread-a');
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(createTicketMock).not.toHaveBeenCalled();
  });

  test('rebuilds every discovered thread and lists canonical thread messages', () => {
    const listRows = [message({ id: 9, thread_id: 'thread-a' })];
    const threadMessagesAll = jest.fn(() => listRows);
    const { db } = routedDb((sql) => {
      if (sql.includes('SELECT DISTINCT thread_id')) {
        return { all: jest.fn(() => [{ id: 'thread-a' }, { id: 'thread-b' }]) };
      }
      if (sql.includes('SELECT id, message_id')) return { all: jest.fn(() => []) };
      if (sql.includes('COUNT(*) AS cnt')) return { get: jest.fn(() => ({ cnt: 0 })) };
      if (sql.includes('SELECT m.*')) return { all: threadMessagesAll };
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    getDbMock.mockReturnValue(db);

    rebuildThreadAggregates();
    expect(listThreadMessages('alias:thread-a', 10, 5)).toBe(listRows);
    expect(threadMessagesAll).toHaveBeenCalledWith('thread-a', 'thread-a', 10, 5);
  });
});

describe('thread list projection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('uses persisted aggregates for a numeric inbox scope', () => {
    const { db } = routedDb(() => ({
      all: jest.fn(() => [{
        threadId: 'thread-a',
        messageCount: 4,
        lastMessageAt: '2026-07-14T12:00:00.000Z',
        hasUnread: 1,
        subject: undefined,
        latestMessageId: 44,
      }]),
    }));
    getDbMock.mockReturnValue(db);

    expect(listThreadsForMailScope(3, 'inbox', { limit: 20, offset: 2 })).toEqual([{
      threadId: 'thread-a',
      messageCount: 4,
      lastMessageAt: '2026-07-14T12:00:00.000Z',
      hasUnread: true,
      subject: null,
      latestMessageId: 44,
    }]);
    expect(listMessagesMock).not.toHaveBeenCalled();
  });

  test('groups, sorts and paginates the message fallback', () => {
    getDbMock.mockReturnValue(null as never);
    listMessagesMock.mockReturnValue([
      message({ id: 1, thread_id: 'thread-a', date_received: '2026-07-14T09:00:00.000Z', subject: 'Alt', seen_local: 1 }),
      message({ id: 2, thread_id: 'thread-a', date_received: '2026-07-14T11:00:00.000Z', subject: 'Neu', seen_local: 0 }),
      message({ id: 3, thread_id: null, date_received: '2026-07-14T10:00:00.000Z', subject: 'Einzeln', uid: -1 }),
    ] as never);

    const rows = listThreadsForMailScope('all', 'sent', { limit: 1, offset: 0 });

    expect(listMessagesMock).toHaveBeenCalledWith(
      'all',
      'sent',
      { limit: 200, offset: 0 },
      undefined,
    );
    expect(rows).toEqual([{
      threadId: 'thread-a',
      messageCount: 2,
      lastMessageAt: '2026-07-14T11:00:00.000Z',
      hasUnread: true,
      subject: 'Alt',
      latestMessageId: 2,
    }]);

    expect(listThreadsForMailScope('all', 'sent', { limit: 5, offset: 1 })[0]).toMatchObject({
      threadId: 'message:3',
      hasUnread: false,
      latestMessageId: 3,
    });
  });
});
