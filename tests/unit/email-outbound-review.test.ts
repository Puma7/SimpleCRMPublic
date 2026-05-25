import {
  OUTBOUND_WARNING_MARKER,
  buildOutboundWarningBanner,
  parseOutboundReviewResponse,
} from '../../electron/email/email-outbound-review-parse';

describe('email outbound review', () => {
  test('parseOutboundReviewResponse accepts STATUS: OK', () => {
    expect(parseOutboundReviewResponse('STATUS: OK')).toEqual({
      ok: true,
      reason: null,
      code: null,
    });
  });

  test('parseOutboundReviewResponse parses BLOCK with REASON and CODE', () => {
    const r = parseOutboundReviewResponse(
      'STATUS: BLOCK\nREASON: Anhang fehlt\nCODE: MISSING_ATTACHMENT',
    );
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('Anhang fehlt');
    expect(r.code).toBe('MISSING_ATTACHMENT');
  });

  test('buildOutboundWarningBanner includes marker and reason', () => {
    const b = buildOutboundWarningBanner('Falscher Name in Anrede');
    expect(b.text).toContain(OUTBOUND_WARNING_MARKER);
    expect(b.text).toContain('Falscher Name in Anrede');
    expect(b.html).toContain('AUSGANGSPRÜFUNG');
  });
});
