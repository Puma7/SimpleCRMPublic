const syncStore = new Map<string, string>();
jest.mock('../../electron/sqlite-service', () => ({
  getSyncInfo: (k: string) => syncStore.get(k) ?? null,
  setSyncInfo: (k: string, v: string) => {
    syncStore.set(k, v);
  },
  deleteSyncInfo: (k: string) => {
    syncStore.delete(k);
  },
}));

import {
  IMAP_UID_MAX_FAILURES,
  clearImapUidFetchFailure,
  recordImapUidFetchFailure,
  shouldSkipImapUidAfterFailures,
} from '../../electron/email/imap-uid-failure';

describe('imap-uid-failure', () => {
  beforeEach(() => syncStore.clear());

  test('record increments from zero and NaN', () => {
    expect(recordImapUidFetchFailure(1, 10)).toBe(1);
    expect(recordImapUidFetchFailure(1, 10)).toBe(2);
    syncStore.set('imap_uid_fail:2:5', 'not-a-number');
    expect(recordImapUidFetchFailure(2, 5)).toBe(1);
  });

  test('shouldSkip after max failures', () => {
    for (let i = 0; i < IMAP_UID_MAX_FAILURES; i++) recordImapUidFetchFailure(3, 7);
    expect(shouldSkipImapUidAfterFailures(3, 7)).toBe(true);
    expect(shouldSkipImapUidAfterFailures(3, 8)).toBe(false);
    syncStore.set('imap_uid_fail:3:7', 'bad');
    expect(shouldSkipImapUidAfterFailures(3, 7)).toBe(false);
  });

  test('clear removes failure count', () => {
    recordImapUidFetchFailure(4, 1);
    clearImapUidFetchFailure(4, 1);
    expect(shouldSkipImapUidAfterFailures(4, 1)).toBe(false);
  });
});
