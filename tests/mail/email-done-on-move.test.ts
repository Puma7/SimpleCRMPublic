/**
 * @jest-environment node
 */
import {
  moveMessageToMailView,
  setMessageArchived,
  setMessageSoftDeleted,
  setMessageSpam,
} from '../../electron/email/email-store';

const mockRun = jest.fn();
const mockGet = jest.fn();
const mockRecordSpamLearning = jest.fn();

jest.mock('../../electron/sqlite-service', () => ({
  getDb: () => ({
    transaction: (fn: () => unknown) => fn,
    prepare: (sql: string) => ({
      run: (...args: unknown[]) => {
        mockRun(sql, ...args);
        return { changes: 1 };
      },
      get: (...args: unknown[]) => mockGet(sql, ...args),
      all: jest.fn(() => []),
    }),
  }),
}));
jest.mock('../../electron/email/email-spam-store', () => ({
  recordSpamLearningForMessage: (...args: unknown[]) => mockRecordSpamLearning(...args),
}));

describe('done_local on folder moves', () => {
  beforeEach(() => {
    mockRun.mockClear();
    mockGet.mockClear();
    mockGet.mockReturnValue({
      archived: 0,
      is_spam: 0,
      folder_kind: 'inbox',
      trash_prev_archived: null,
      trash_prev_is_spam: null,
      trash_prev_folder_kind: null,
    });
  });

  test('setMessageArchived(true) sets done_local', () => {
    setMessageArchived(5, true);
    expect(mockRun).toHaveBeenCalledWith(
      expect.stringContaining('done_local'),
      1,
      1,
      5,
    );
  });

  test('setMessageSpam(true) sets done_local', () => {
    setMessageSpam(6, true);
    expect(mockRun).toHaveBeenCalledWith(
      expect.stringContaining("spam_status = 'spam'"),
      6,
    );
    expect(mockRun.mock.calls[0][0]).toContain('done_local = 1');
  });

  test('setMessageSoftDeleted(true) sets done_local', () => {
    setMessageSoftDeleted(7, true);
    expect(mockRun).toHaveBeenCalledWith(
      expect.stringContaining('done_local = 1'),
      0,
      0,
      'inbox',
      7,
    );
  });

  test('moveMessageToMailView inbox clears done_local', () => {
    mockGet.mockReturnValueOnce({
      uid: 1,
      pop3_uidl: null,
    });
    moveMessageToMailView(8, 'inbox');
    expect(mockRun).toHaveBeenCalledWith(
      expect.stringContaining('done_local = 0'),
      8,
    );
  });

  test('moveMessageToMailView spam sets done_local', () => {
    mockGet.mockReturnValueOnce({
      uid: 1,
      pop3_uidl: null,
    });
    moveMessageToMailView(9, 'spam');
    expect(mockRun).toHaveBeenCalledWith(
      expect.stringContaining('done_local = 1'),
      9,
    );
  });
});
