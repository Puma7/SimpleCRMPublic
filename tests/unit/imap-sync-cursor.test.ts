import { canAdvanceImapSyncCursor } from '../../electron/email/imap-sync-cursor';

describe('canAdvanceImapSyncCursor', () => {
  it('advances on next contiguous uid', () => {
    expect(canAdvanceImapSyncCursor(100, 101, [101, 102, 103])).toBe(true);
  });

  it('does not skip failed uid in batch', () => {
    expect(canAdvanceImapSyncCursor(100, 103, [101, 102, 103])).toBe(false);
  });

  it('allows server uid gap when intermediate uid not in batch', () => {
    expect(canAdvanceImapSyncCursor(101, 105, [101, 105])).toBe(true);
  });
});
