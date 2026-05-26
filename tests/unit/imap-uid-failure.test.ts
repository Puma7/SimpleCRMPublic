const store = new Map<string, string>();

jest.mock('../../electron/sqlite-service', () => ({
  getSyncInfo: (key: string) => store.get(key) ?? null,
  setSyncInfo: (key: string, value: string) => {
    store.set(key, value);
  },
  deleteSyncInfo: (key: string) => {
    store.delete(key);
  },
}));

import {
  clearImapUidFetchFailure,
  IMAP_UID_MAX_FAILURES,
  recordImapUidFetchFailure,
  shouldSkipImapUidAfterFailures,
} from '../../electron/email/imap-uid-failure';

describe('imap-uid-failure', () => {
  beforeEach(() => store.clear());

  it('skips after max failures', () => {
    const folderId = 1;
    const uid = 42;
    for (let i = 0; i < IMAP_UID_MAX_FAILURES; i++) {
      recordImapUidFetchFailure(folderId, uid);
    }
    expect(shouldSkipImapUidAfterFailures(folderId, uid)).toBe(true);
    clearImapUidFetchFailure(folderId, uid);
    expect(shouldSkipImapUidAfterFailures(folderId, uid)).toBe(false);
  });
});
