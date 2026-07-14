import { sanitizeEmailHtml } from '../../src/lib/sanitize-email-html';

describe('sanitizeEmailHtml', () => {
  it('removes executable markup and unsafe URLs while preserving email formatting', () => {
    const clean = sanitizeEmailHtml(
      '<p onclick="alert(1)"><strong>Viele Grüße</strong>'
      + '<img src="x" onerror="alert(2)">'
      + '<a href="javascript:alert(3)">Link</a>'
      + '<script>alert(4)</script></p>',
    );

    expect(clean).toContain('<strong>Viele Grüße</strong>');
    expect(clean).not.toMatch(/onclick|onerror|javascript:|<script/i);
  });
});
