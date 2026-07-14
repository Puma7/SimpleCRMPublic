jest.mock('../../electron/sqlite-service', () => ({
  getDb: jest.fn(),
  getSyncInfo: jest.fn(() => null),
  setSyncInfo: jest.fn(),
}));

import { normalizeSpamPattern, selectSpamListMatch } from '../../electron/email/email-spam-store';
import {
  applyAutomatedSpamStatusFromDecision,
  deleteSpamListEntry,
  evaluateSpamListMatch,
  getSenderDomainForMessage,
  labelForSpamStatus,
  listSpamListEntries,
  loadSpamFeatureStats,
  migrateLegacySpamLists,
  recordSpamLearningForMessage,
  saveSpamDecision,
  saveSpamListEntry,
} from '../../electron/email/email-spam-store';
import { getDb, getSyncInfo, setSyncInfo } from '../../electron/sqlite-service';
import type { SpamListEntry } from '../../electron/email/email-spam-types';

const getDbMock = getDb as jest.MockedFunction<typeof getDb>;
const getSyncInfoMock = getSyncInfo as jest.MockedFunction<typeof getSyncInfo>;
const setSyncInfoMock = setSyncInfo as jest.MockedFunction<typeof setSyncInfo>;

type Prepared = {
  get?: jest.Mock;
  all?: jest.Mock;
  run?: jest.Mock;
};

function routedDb(route: (sql: string) => Prepared) {
  const prepare = jest.fn((sql: string) => route(sql));
  const transaction = jest.fn((work: () => void) => work);
  return { db: { prepare, transaction } as never, prepare, transaction };
}

function messageFrom(address: string): never {
  return {
    id: 1,
    account_id: 1,
    from_json: JSON.stringify({ value: [{ address }] }),
    subject: '',
    snippet: '',
    body_text: '',
    body_html: null,
    auth_spf: null,
    auth_dkim: null,
    auth_dmarc: null,
    auth_arc: null,
    attachments_json: null,
    has_attachments: 0,
  } as never;
}

function entry(
  listType: SpamListEntry['list_type'],
  patternType: SpamListEntry['pattern_type'],
  pattern: string,
): SpamListEntry {
  return {
    id: 1,
    list_type: listType,
    pattern_type: patternType,
    pattern,
    account_id: null,
    note: null,
    created_at: '2026-06-02T00:00:00.000Z',
    updated_at: '2026-06-02T00:00:00.000Z',
  };
}

describe('email spam list matching', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('normalizes legacy-style domain and email patterns', () => {
    expect(normalizeSpamPattern(' @Example.COM ')).toEqual({
      pattern: 'example.com',
      patternType: 'domain',
    });
    expect(normalizeSpamPattern('User@Example.COM')).toEqual({
      pattern: 'user@example.com',
      patternType: 'email',
    });
  });

  test('rejects too broad or malformed patterns', () => {
    expect(() => normalizeSpamPattern('com')).toThrow(/Ung/);
    expect(() => normalizeSpamPattern('bad@')).toThrow(/Ung/);
  });

  test('allowlist wins before a more specific blocklist match', () => {
    const match = selectSpamListMatch(
      [
        entry('block', 'email', 'vip@example.com'),
        entry('allow', 'domain', 'example.com'),
      ],
      messageFrom('vip@example.com'),
    );

    expect(match).toMatchObject({
      listType: 'allow',
      patternType: 'domain',
      pattern: 'example.com',
    });
  });

  test('matches exact domains and subdomains with specificity', () => {
    expect(
      selectSpamListMatch([entry('block', 'domain', 'example.com')], messageFrom('a@example.com')),
    ).toMatchObject({ listType: 'block', specificity: 80 });

    expect(
      selectSpamListMatch([entry('block', 'domain', 'example.com')], messageFrom('a@mail.example.com')),
    ).toMatchObject({ listType: 'block', specificity: 60 });
  });

  test('does not match sibling domains', () => {
    expect(
      selectSpamListMatch([entry('block', 'domain', 'example.com')], messageFrom('a@badexample.com')),
    ).toBeNull();
  });

  test('prefers the most specific match within a list type and handles missing senders', () => {
    expect(
      selectSpamListMatch(
        [
          entry('block', 'domain', 'example.com'),
          entry('block', 'email', 'vip@example.com'),
        ],
        messageFrom('vip@example.com'),
      ),
    ).toMatchObject({ patternType: 'email', specificity: 100 });

    expect(selectSpamListMatch([entry('allow', 'domain', 'example.com')], messageFrom(''))).toBeNull();
  });
});

describe('email spam list persistence', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('updates an explicit or matching existing list entry', () => {
    const updated = { ...entry('allow', 'domain', 'example.com'), id: 5, note: 'Partner' };
    const updateRun = jest.fn(() => ({ changes: 1 }));
    const { db } = routedDb((sql) => {
      if (sql.includes('SELECT id FROM')) return { get: jest.fn(() => ({ id: 5 })) };
      if (sql.includes('UPDATE')) return { run: updateRun };
      if (sql.includes('SELECT * FROM')) return { get: jest.fn(() => updated) };
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    getDbMock.mockReturnValue(db);

    expect(
      saveSpamListEntry({
        listType: 'allow',
        pattern: '@Example.com',
        accountId: null,
        note: ' Partner ',
      }),
    ).toEqual(updated);
    expect(updateRun).toHaveBeenCalledWith('allow', 'domain', 'example.com', null, 'Partner', 5);

    expect(
      saveSpamListEntry({
        id: 5,
        listType: 'allow',
        patternType: 'domain',
        pattern: 'example.com',
      }),
    ).toEqual(updated);
  });

  test('inserts a new account-specific list entry', () => {
    const inserted = { ...entry('block', 'email', 'bad@example.com'), id: 9, account_id: 3 };
    const insertRun = jest.fn(() => ({ lastInsertRowid: 9 }));
    const { db } = routedDb((sql) => {
      if (sql.includes('SELECT id FROM')) return { get: jest.fn(() => undefined) };
      if (sql.includes('INSERT INTO')) return { run: insertRun };
      if (sql.includes('SELECT * FROM')) return { get: jest.fn(() => inserted) };
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    getDbMock.mockReturnValue(db);

    expect(
      saveSpamListEntry({
        listType: 'block',
        patternType: 'email',
        pattern: 'BAD@Example.com',
        accountId: 3,
      }),
    ).toEqual(inserted);
    expect(insertRun).toHaveBeenCalledWith('block', 'email', 'bad@example.com', 3, null);
  });

  test('surfaces a disappeared entry and reports delete changes', () => {
    const updateRun = jest.fn(() => ({ changes: 1 }));
    const deleteRun = jest.fn()
      .mockReturnValueOnce({ changes: 1 })
      .mockReturnValueOnce({ changes: 0 });
    const { db } = routedDb((sql) => {
      if (sql.includes('UPDATE')) return { run: updateRun };
      if (sql.includes('SELECT * FROM')) return { get: jest.fn(() => undefined) };
      if (sql.includes('DELETE FROM')) return { run: deleteRun };
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    getDbMock.mockReturnValue(db);

    expect(() =>
      saveSpamListEntry({ id: 10, listType: 'allow', pattern: 'example.com' }),
    ).toThrow('Spam-Listen-Eintrag nicht gefunden');
    expect(deleteSpamListEntry(10)).toBe(true);
    expect(deleteSpamListEntry(11)).toBe(false);
  });

  test('migrates legacy lists once and ignores malformed legacy entries', () => {
    getSyncInfoMock.mockImplementation((key: string) => {
      if (key === 'workflow_sender_whitelist') return 'invalid; @Example.com';
      if (key === 'workflow_sender_blacklist') return 'bad@; Blocked.example';
      return null;
    });
    const stored = new Map<string, SpamListEntry>();
    let nextId = 1;
    const { db } = routedDb((sql) => {
      if (sql.includes('SELECT id FROM')) {
        return { get: jest.fn(() => undefined) };
      }
      if (sql.includes('INSERT INTO')) {
        return {
          run: jest.fn((listType: 'allow' | 'block', patternType: 'email' | 'domain', pattern: string) => {
            stored.set(String(nextId), {
              ...entry(listType, patternType, pattern),
              id: nextId,
            });
            return { lastInsertRowid: nextId++ };
          }),
        };
      }
      if (sql.includes('SELECT * FROM')) {
        return { get: jest.fn((id: number) => stored.get(String(id))) };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    getDbMock.mockReturnValue(db);

    migrateLegacySpamLists();

    expect([...stored.values()]).toEqual([
      expect.objectContaining({ list_type: 'allow', pattern: 'example.com' }),
      expect.objectContaining({ list_type: 'block', pattern: 'blocked.example' }),
    ]);
    expect(setSyncInfoMock).toHaveBeenCalledWith('email_spam_legacy_lists_migrated_v1', '1');

    jest.clearAllMocks();
    getSyncInfoMock.mockReturnValue('1');
    migrateLegacySpamLists();
    expect(getDbMock).not.toHaveBeenCalled();
    expect(setSyncInfoMock).not.toHaveBeenCalled();
  });

  test('lists account-visible and global entries in deterministic order', () => {
    const rows = [entry('allow', 'domain', 'example.com')];
    const all = jest.fn(() => rows);
    const { db } = routedDb(() => ({ all }));
    getDbMock.mockReturnValue(db);
    getSyncInfoMock.mockReturnValue('1');

    expect(listSpamListEntries(4)).toBe(rows);
    expect(all).toHaveBeenNthCalledWith(1, 4);
    expect(listSpamListEntries('all')).toBe(rows);
    expect(all).toHaveBeenNthCalledWith(2);
    expect(listSpamListEntries(null)).toBe(rows);
  });
});

describe('spam learning and decisions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('loads only requested feature statistics and short-circuits an empty request', () => {
    expect(loadSpamFeatureStats([])).toEqual(new Map());
    expect(getDbMock).not.toHaveBeenCalled();

    const rows = [
      { feature_key: 'auth:spf_fail', spam_count: 5, ham_count: 1 },
      { feature_key: 'sender_domain:example.com', spam_count: 2, ham_count: 8 },
    ];
    const all = jest.fn(() => rows);
    const { db } = routedDb(() => ({ all }));
    getDbMock.mockReturnValue(db);

    const loaded = loadSpamFeatureStats(rows.map((row) => row.feature_key));
    expect(loaded.get('auth:spf_fail')).toEqual(rows[0]);
    expect(loaded.get('sender_domain:example.com')).toEqual(rows[1]);
    expect(all).toHaveBeenCalledWith('auth:spf_fail', 'sender_domain:example.com');
  });

  test('records filtered learning features transactionally for spam and ham', () => {
    const eventRun = jest.fn();
    const statRun = jest.fn();
    const { db, transaction } = routedDb((sql) => {
      if (sql.includes('LEARNING_EVENTS')) return { run: eventRun };
      if (sql.includes('FEATURE_STATS')) return { run: statRun };
      if (sql.includes('email_spam_learning_events')) return { run: eventRun };
      if (sql.includes('email_spam_feature_stats')) return { run: statRun };
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    getDbMock.mockReturnValue(db);
    const row = messageFrom('sender@example.com');

    recordSpamLearningForMessage(row, 'spam', 'manual');
    recordSpamLearningForMessage(row, 'ham', 'review');

    expect(transaction).toHaveBeenCalledTimes(2);
    expect(eventRun).toHaveBeenNthCalledWith(
      1,
      1,
      1,
      'spam',
      'manual',
      expect.stringMatching(/^\[/),
    );
    expect(eventRun).toHaveBeenNthCalledWith(
      2,
      1,
      1,
      'ham',
      'review',
      expect.stringMatching(/^\[/),
    );
    expect(statRun).toHaveBeenCalled();
    expect(statRun.mock.calls.some((call) => call.slice(-2).join(',') === '1,0')).toBe(true);
    expect(statRun.mock.calls.some((call) => call.slice(-2).join(',') === '0,1')).toBe(true);
  });

  test('applies only automated review and spam states', () => {
    const run = jest.fn();
    const { db, prepare } = routedDb(() => ({ run }));
    getDbMock.mockReturnValue(db);

    applyAutomatedSpamStatusFromDecision(1, 'clean');
    expect(prepare).not.toHaveBeenCalled();

    applyAutomatedSpamStatusFromDecision(2, 'review');
    applyAutomatedSpamStatusFromDecision(3, 'spam');
    expect(run).toHaveBeenNthCalledWith(1, 2);
    expect(run).toHaveBeenNthCalledWith(2, 3);
  });

  test('stores a decision and prunes history in one transaction', () => {
    const updateRun = jest.fn();
    const insertRun = jest.fn();
    const deleteRun = jest.fn();
    const { db, transaction } = routedDb((sql) => {
      if (sql.includes('UPDATE')) return { run: updateRun };
      if (sql.includes('INSERT INTO')) return { run: insertRun };
      if (sql.includes('DELETE FROM')) return { run: deleteRun };
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    getDbMock.mockReturnValue(db);
    const breakdown = {
      score: 82,
      status: 'spam' as const,
      label: 'Spam',
      source: 'local',
      modelVersion: 'v1',
      listMatch: null,
      reasons: [],
    };

    saveSpamDecision(9, messageFrom('sender@example.com'), breakdown as never);

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(updateRun).toHaveBeenCalledWith(82, 'spam', 'local', JSON.stringify(breakdown), 9);
    expect(insertRun).toHaveBeenCalledWith(
      9,
      1,
      82,
      'spam',
      'local',
      JSON.stringify(breakdown),
      'v1',
    );
    expect(deleteRun).toHaveBeenCalledWith(9, 9);
  });

  test('maps training labels, evaluates persisted lists and extracts sender domains', () => {
    expect(labelForSpamStatus('spam')).toBe('spam');
    expect(labelForSpamStatus('clean')).toBe('ham');
    expect(labelForSpamStatus('review')).toBeNull();
    expect(labelForSpamStatus(undefined)).toBeNull();
    expect(getSenderDomainForMessage(messageFrom('Sender@Sub.Example.com'))).toBe('sub.example.com');

    getSyncInfoMock.mockReturnValue('1');
    const { db } = routedDb(() => ({
      all: jest.fn(() => [entry('block', 'domain', 'example.com')]),
    }));
    getDbMock.mockReturnValue(db);
    expect(evaluateSpamListMatch(messageFrom('sender@example.com'))).toMatchObject({
      listType: 'block',
      pattern: 'example.com',
    });
  });
});
