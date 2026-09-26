import {
  OUTBOUND_REVIEW_SKIP_POLICY_KEY,
  outboundReviewSkipAllowedForRole,
  outboundReviewSkippedKey,
  parseOutboundReviewSkipPolicy,
} from '../../packages/core/src/email';

describe('Ausgangsprüfung überspringen: Richtlinie (TA-P2)', () => {
  test('Standard ist „all“; unbekannte Werte fallen auf den Standard zurück', () => {
    expect(parseOutboundReviewSkipPolicy(null)).toBe('all');
    expect(parseOutboundReviewSkipPolicy('')).toBe('all');
    expect(parseOutboundReviewSkipPolicy('bogus')).toBe('all');
    expect(parseOutboundReviewSkipPolicy(' Admins ')).toBe('admins');
    expect(parseOutboundReviewSkipPolicy('none')).toBe('none');
  });

  test('Rollen: all erlaubt jede Rolle, admins nur Owner/Admin, none niemanden', () => {
    expect(outboundReviewSkipAllowedForRole('all', 'user')).toBe(true);
    expect(outboundReviewSkipAllowedForRole('all', undefined)).toBe(true);
    expect(outboundReviewSkipAllowedForRole('admins', 'owner')).toBe(true);
    expect(outboundReviewSkipAllowedForRole('admins', 'admin')).toBe(true);
    expect(outboundReviewSkipAllowedForRole('admins', 'user')).toBe(false);
    expect(outboundReviewSkipAllowedForRole('admins', null)).toBe(false);
    expect(outboundReviewSkipAllowedForRole('none', 'owner')).toBe(false);
    expect(OUTBOUND_REVIEW_SKIP_POLICY_KEY).toBe('outbound_review_skip_policy');
    expect(outboundReviewSkippedKey(7)).toBe('outbound_review_skipped:7');
  });
});
