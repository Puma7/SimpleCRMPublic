import {
  OUTBOUND_WARNING_MARKER,
  buildOutboundWarningBanner,
  extractDraftBodyForOutboundBlock,
  parseOutboundReviewResponse,
} from '../../packages/core/src/email';

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

  test('extractDraftBodyForOutboundBlock uses body_html when body_text is empty', () => {
    const row = {
      body_text: '',
      body_html: '<p>Meine Antwort</p><p>---</p><p>Zitierte Originalmail</p>',
    };
    const r = extractDraftBodyForOutboundBlock(row);
    expect(r.plain).toContain('Meine Antwort');
    expect(r.plain).toContain('Zitierte Originalmail');
    expect(r.html).toContain('Meine Antwort');
  });

  test('extractDraftBodyForOutboundBlock prefers fresh send payload', () => {
    const row = { body_text: 'alt', body_html: '<p>alt</p>' };
    const r = extractDraftBodyForOutboundBlock(row, {
      bodyText: '',
      bodyHtml: '<p>Neuer Entwurf mit Zitat</p>',
    });
    expect(r.plain).toContain('Neuer Entwurf');
    expect(r.html).toContain('Neuer Entwurf');
  });

  test('extractDraftBodyForOutboundBlock strips prior warning from plain text', () => {
    const banner = buildOutboundWarningBanner('Blockiert');
    const row = {
      body_text: `${banner.text}Eigentlicher Inhalt`,
      body_html: null,
    };
    const r = extractDraftBodyForOutboundBlock(row);
    expect(r.plain).toBe('Eigentlicher Inhalt');
    expect(r.plain).not.toContain(OUTBOUND_WARNING_MARKER);
  });
});
