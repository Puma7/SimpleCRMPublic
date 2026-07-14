import {
  buildComposeDraftInitKey,
  buildComposeSessionKey,
  buildComposeSessionSnapshot,
} from '../../shared/compose-session';
import { resolveComposeTeamMemberId } from '../../shared/compose-sender-identity';

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

describe('compose sender identity', () => {
  const members = [
    { id: 'agent-1', display_name: 'Anna Agent' },
    { id: 'user-2', display_name: 'Ben Bearbeiter' },
  ];

  it('keeps the team member already assigned to the source or draft', () => {
    expect(resolveComposeTeamMemberId(members, { assignedTo: 'agent-1', userId: 'user-2' }))
      .toBe('agent-1');
  });

  it('matches the authenticated user before falling back to the first member', () => {
    expect(resolveComposeTeamMemberId(members, { userId: 'user-2' })).toBe('user-2');
    expect(resolveComposeTeamMemberId(members, { displayName: 'ben bearbeiter' })).toBe('user-2');
    expect(resolveComposeTeamMemberId(members, { userId: 'missing' })).toBe('agent-1');
  });
});
