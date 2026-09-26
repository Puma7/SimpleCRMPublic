import {
  OUTBOUND_WARNING_MARKER,
  buildOutboundWarningBanner,
  extractDraftBodyForOutboundBlock,
  stripOutboundWarningFromHtml,
  stripOutboundWarningFromPlain,
} from '../../packages/core/src/email';

/**
 * Das Entwurfsfenster formt den Hinweis „Versand blockiert“ beim Speichern um
 * (div wird Absatz, Text ohne Umbrüche und ohne „---“). Vorher erkannte das
 * Entfernen ihn dann nicht mehr: „Ohne Ausgangsprüfung senden“ aus dem
 * Fenster schickte den Hinweis an den Kunden mit (Text ohne Trenner ergab
 * sogar einen leeren Textteil).
 */
const reason = 'Preisangabe prüfen';
const composeBanner = `<p><strong>${OUTBOUND_WARNING_MARKER}</strong><br>${reason}<br><em>Bitte E-Mail prüfen, korrigieren und erneut senden.</em></p>`;
const composeBannerText = `${OUTBOUND_WARNING_MARKER} ${reason} Bitte E-Mail prüfen, korrigieren und erneut senden.`;

describe('Hinweis „Versand blockiert“ aus umgeformtem Inhalt entfernen', () => {
  test('Absatz-Form im HTML, der vorherige Absatz bleibt', () => {
    const html = `<p>Vorher</p>${composeBanner}<p>Das kostet 100 €.</p>`;
    expect(stripOutboundWarningFromHtml(html)).toBe('<p>Vorher</p><p>Das kostet 100 €.</p>');
    // Ohne umschließenden Absatz: nur der Hinweis-Text fällt weg.
    const bare = `<p>Vorher</p><strong>${OUTBOUND_WARNING_MARKER}</strong><br>${reason}<br><em>Bitte E-Mail prüfen, korrigieren und erneut senden.</em><p>Text</p>`;
    expect(stripOutboundWarningFromHtml(bare)).toContain('<p>Vorher</p>');
    expect(stripOutboundWarningFromHtml(bare)).not.toContain('AUSGANGSPR');
  });

  test('Fließtext-Form ohne „---“: nur der Hinweis fällt weg, der Text bleibt', () => {
    expect(stripOutboundWarningFromPlain(`${composeBannerText} Das kostet 100 €.`)).toBe('Das kostet 100 €.');
    // Klassische Form bleibt unverändert.
    const banner = buildOutboundWarningBanner(reason);
    expect(stripOutboundWarningFromPlain(`${banner.text}Das kostet 100 €.`)).toBe('Das kostet 100 €.');
    // Ohne Schlusssatz: bisheriges Verhalten (alles ab dem Marker weg).
    expect(stripOutboundWarningFromPlain(`Hallo ${OUTBOUND_WARNING_MARKER} Rest`)).toBe('Hallo');
  });

  test('extractDraftBodyForOutboundBlock liefert aus dem umgeformten Entwurf nur den Inhalt', () => {
    const body = extractDraftBodyForOutboundBlock({
      body_text: `${composeBannerText} Das kostet 100 €.`,
      body_html: `${composeBanner}<p>Das kostet 100 €.</p>`,
    });
    expect(body.plain).toBe('Das kostet 100 €.');
    expect(body.html).toBe('<p>Das kostet 100 €.</p>');
  });
});
