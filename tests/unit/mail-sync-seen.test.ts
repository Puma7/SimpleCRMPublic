import { mergeSeenLocalOnMailSync } from '../../shared/mail-sync-seen';

describe('mergeSeenLocalOnMailSync', () => {
  test('keeps local seen state for spam-review queue mail instead of importing IMAP seen', () => {
    expect(mergeSeenLocalOnMailSync({
      currentSeenLocal: false,
      incomingSeenLocal: true,
      spamStatus: 'review',
      reconcileSeenFromServer: true,
    })).toBe(false);

    expect(mergeSeenLocalOnMailSync({
      currentSeenLocal: true,
      incomingSeenLocal: false,
      spamStatus: 'review',
      reconcileSeenFromServer: true,
    })).toBe(true);
  });

  test('imports IMAP seen for normal inbox mail', () => {
    expect(mergeSeenLocalOnMailSync({
      currentSeenLocal: false,
      incomingSeenLocal: true,
      spamStatus: 'clean',
      reconcileSeenFromServer: true,
    })).toBe(true);
  });
});
