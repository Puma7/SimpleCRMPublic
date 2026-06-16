import {
  buildComposeDraftInitKey,
  buildComposeSessionKey,
  buildComposeSessionSnapshot,
} from '../../shared/compose-session';

describe('compose session keys', () => {
  it('buildComposeSessionKey is stable across bootstrap generations', () => {
    const intent = { mode: 'new' as const };
    expect(buildComposeSessionKey(intent, 3)).toBe('new:3:');
    expect(buildComposeDraftInitKey(intent, 3, 0)).toBe('new:3::g0');
    expect(buildComposeDraftInitKey(intent, 3, 2)).toBe('new:3::g2');
    expect(buildComposeSessionKey(intent, 3)).toBe(
      buildComposeDraftInitKey(intent, 3, 99).replace(/:g\d+$/, ''),
    );
  });

  it('includes draft message id for draft mode', () => {
    const intent = { mode: 'draft' as const, messageId: 42 };
    expect(buildComposeSessionKey(intent, 7)).toBe('draft:7:42');
  });

  it('buildComposeSessionSnapshot carries flags and stable initKey', () => {
    const snap = buildComposeSessionSnapshot(
      { mode: 'reply' },
      5,
      100,
      12,
      { keepReplyOpenInInbox: true, pgpEncrypt: true, pgpSign: false },
    );
    expect(snap.initKey).toBe('reply:5:');
    expect(snap.draftId).toBe(100);
    expect(snap.replyToId).toBe(12);
    expect(snap.keepReplyOpenInInbox).toBe(true);
    expect(snap.pgpEncrypt).toBe(true);
    expect(snap.pgpSign).toBe(false);
  });
});
