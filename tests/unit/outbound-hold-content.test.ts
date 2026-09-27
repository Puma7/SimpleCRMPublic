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
    accountId: 7,
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
      // Server liefert die Konto-ID als Zahl, die Oberfläche als Text.
      accountId: '7',
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
    ['Absenderkonto („Von“)', { accountId: 8 }],
  ])('%s geändert ⇒ anderer Fingerprint', (_label, patch) => {
    const changed = { ...atHold, ...patch };
    expect(outboundHoldContentEquals(atHold, changed)).toBe(false);
    expect(outboundHoldFingerprint(changed)).not.toBe(outboundHoldFingerprint(atHold));
  });

  // Plan 026: verlustbehafteter Vergleich — versteckter Hinweis mit Text dahinter,
  // Stile und weitere URL-Attribute zählten nicht als Änderung.
  test.each([
    ['versteckter Hinweis mit angehängtem Text', {
      bodyHtml: `${atHold.bodyHtml}<p><span style="font-size:0">${OUTBOUND_WARNING_MARKER}</span> Neue Bankverbindung: DE00 1234</p>`,
    }],
    ['Text im Textteil hinter einem Hinweis ohne Schlusssatz', {
      bodyText: `${atHold.bodyText}\n${OUTBOUND_WARNING_MARKER} Neue Bankverbindung`,
    }],
    ['style-Block', { bodyHtml: `${atHold.bodyHtml}<style>p::after{content:"Neue IBAN"}</style>` }],
    ['Stil-Attribut mit url()', {
      bodyHtml: atHold.bodyHtml.replace('<p>Das kostet', '<p style="background:url(https://evil.example/b.png)">Das kostet'),
    }],
    ['srcset', { bodyHtml: `${atHold.bodyHtml}<img srcset="https://evil.example/x.png 1x">` }],
    ['background-Attribut', { bodyHtml: `${atHold.bodyHtml}<table background="https://evil.example/t.png"></table>` }],
    ['Formularziel', { bodyHtml: `${atHold.bodyHtml}<form action="https://evil.example/f"></form>` }],
  ])('%s ⇒ Änderung', (_label, patch) => {
    const changed = { ...atHold, ...patch };
    expect(outboundHoldContentEquals(atHold, changed)).toBe(false);
    expect(outboundHoldFingerprint(changed)).not.toBe(outboundHoldFingerprint(atHold));
  });

  test('unveränderter Inhalt ergibt dieselbe Normalform wie bisher (gespeicherte Fingerprints bleiben gültig)', () => {
    expect(JSON.stringify(normalizeOutboundHoldContent(atHold))).toBe(
      '{"accountId":"7","subject":"Angebot","bodyText":"Das kostet 100 € & mehr. Angebot","bodyHtml":"{\\"text\\":\\"Das kostet 100 € & mehr. Angebot\\",\\"links\\":[\\"https://shop.example.test/a\\"]}","to":"kunde@example.com","cc":"","bcc":"","attachmentPaths":["/a/preis.pdf"]}',
    );
  });

  test('bleibt linear bei feindlichem Inhalt', () => {
    const hostile = `${'<style'.repeat(20_000)}${'url('.repeat(10_000)}${' srcset='.repeat(10_000)}`;
    const started = Date.now();
    normalizeOutboundHoldContent({ ...atHold, bodyHtml: hostile });
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  test('Hinweis ist herausgerechnet; Schlüssel wie beim Freigabe-Marker je Entwurf', () => {
    expect(normalizeOutboundHoldContent(atHold).bodyText).toBe('Das kostet 100 € & mehr. Angebot');
    expect(outboundHoldFingerprintKey(41)).toBe('outbound_hold_fingerprint:41');
  });
});
