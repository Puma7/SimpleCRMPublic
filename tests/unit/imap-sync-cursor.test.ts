import { canAdvanceImapSyncCursor } from '../../packages/core/src/email';

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

  it('works with Set for batch membership', () => {
    expect(canAdvanceImapSyncCursor(100, 103, new Set([101, 102, 103]))).toBe(false);
    expect(canAdvanceImapSyncCursor(100, 103, new Set([101, 103]))).toBe(false);
  });

  it('allows advance past permanently skipped uids in batch', () => {
    const skipped = new Set([102]);
    expect(canAdvanceImapSyncCursor(101, 103, new Set([101, 102, 103]), skipped)).toBe(true);
  });
});
