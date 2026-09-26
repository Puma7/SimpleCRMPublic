import {
  OUTBOUND_WARNING_MARKER,
  composeOutboundHeldDraftBody,
  extractDraftBodyForOutboundBlock,
  normalizeOutboundHoldContent,
  outboundHoldContentEquals,
  outboundHoldFingerprint,
  outboundHoldFingerprintKey,
} from '../../packages/core/src/email';

/**
 * Review B3/B4: „Ohne Ausgangsprüfung senden“ nur für den unveränderten,
 * angehaltenen Inhalt. Der Vergleich darf die Umformatierung durch das
 * Entwurfsfenster nicht als Änderung werten, echte Änderungen (auch nur am
 * Textteil oder an einem Link-Ziel) aber schon.
 */
const reason = 'Preisangabe prüfen';
// So speichert das Entwurfsfenster den Hinweis-Block: als Absatz.
const composeBanner = `<p><strong>${OUTBOUND_WARNING_MARKER}</strong><br>${reason}<br><em>Bitte E-Mail prüfen, korrigieren und erneut senden.</em></p>`;
const composeBannerText = `${OUTBOUND_WARNING_MARKER} ${reason} Bitte E-Mail prüfen, korrigieren und erneut senden.`;

function held(text: string, html: string) {
  const body = composeOutboundHeldDraftBody(extractDraftBodyForOutboundBlock({ body_text: text, body_html: html }), reason);
  return {
    subject: 'Angebot',
    bodyText: body.bodyText,
    bodyHtml: body.bodyHtml,
    to: JSON.stringify({ value: [{ address: 'Kunde@Example.com', name: 'Kunde' }] }),
    attachments: JSON.stringify([{ path: '/a/preis.pdf', filename: 'preis.pdf' }]),
  };
}

describe('Inhalt eines angehaltenen Entwurfs vergleichen', () => {
  const text = 'Das kostet 100 € &amp; mehr. Angebot';
  const html = '<p>Das kostet 100 € &amp; mehr. <a href="https://shop.example.test/a">Angebot</a></p>';
  const atHold = held(text, html);

  test('Speichern im Entwurfsfenster (Hinweis als Absatz, Attribute, Leerraum) ist keine Änderung', () => {
    const saved = {
      ...atHold,
      bodyText: `${composeBannerText}  Das kostet 100 € &amp; mehr.\nAngebot`,
      bodyHtml: `${composeBanner}<p>Das kostet 100 € &amp; mehr. <a href="https://shop.example.test/a" target="_blank" rel="noopener">Angebot</a></p><p><br></p>`,
      to: { value: [{ address: 'kunde@example.com' }] },
      attachments: ['/a/preis.pdf'],
    };
    expect(outboundHoldContentEquals(atHold, saved)).toBe(true);
    expect(outboundHoldFingerprint(saved)).toBe(outboundHoldFingerprint(atHold));
  });

  test.each([
    ['Text im HTML', { bodyHtml: html.replace('100', '90'), bodyText: text.replace('100', '90') }],
    ['nur der Textteil', { bodyText: 'Das kostet 1 € & mehr. Angebot' }],
    ['nur ein Link-Ziel', { bodyHtml: html.replace('shop.example.test', 'phish.example.test') }],
    ['Betreff', { subject: 'Angebot (neu)' }],
    ['Empfänger', { to: 'andere@example.com' }],
    ['Bcc', { bcc: 'versteckt@example.com' }],
    ['Anhang', { attachments: ['/a/preis.pdf', '/a/extra.exe'] }],
  ])('%s geändert ⇒ anderer Fingerprint', (_label, patch) => {
    const changed = { ...atHold, ...patch };
    expect(outboundHoldContentEquals(atHold, changed)).toBe(false);
    expect(outboundHoldFingerprint(changed)).not.toBe(outboundHoldFingerprint(atHold));
  });

  test('Hinweis ist herausgerechnet; Schlüssel wie beim Freigabe-Marker je Entwurf', () => {
    expect(normalizeOutboundHoldContent(atHold).bodyText).toBe('Das kostet 100 € & mehr. Angebot');
    expect(outboundHoldFingerprintKey(41)).toBe('outbound_hold_fingerprint:41');
  });
});
