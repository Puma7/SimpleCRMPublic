import {
  addressJson,
  addressesFromRecipientJson,
  decodeHtmlEntities,
  formatDate,
  normalizeAddressJson,
  parseAttachmentsMeta,
  plainTextFromHtml,
  rawHeadersFromParsed,
  snippetFromParsed,
} from '../../electron/email/email-parse-utils';

describe('email-parse-utils', () => {
  test('normalizeAddressJson handles null, string JSON, arrays, value wrapper', () => {
    expect(normalizeAddressJson(null)).toBeNull();
    expect(normalizeAddressJson(undefined)).toBeNull();
    expect(normalizeAddressJson('not-json')).toBeNull();
    expect(normalizeAddressJson(JSON.stringify({ value: [{ address: 'a@b.de' }] }))).toEqual({
      value: [{ address: 'a@b.de' }],
    });
    expect(normalizeAddressJson(['user@test.com'])).toEqual({
      value: [{ address: 'user@test.com' }],
    });
    expect(normalizeAddressJson([{ address: 'x@y.de', name: 'X' }])).toEqual({
      value: [{ address: 'x@y.de', name: 'X' }],
    });
    expect(normalizeAddressJson([{ address: 'invalid' }])).toBeNull();
    expect(normalizeAddressJson({ value: [{ address: 'z@z.de' }] })).toEqual({
      value: [{ address: 'z@z.de' }],
    });
    expect(normalizeAddressJson({ foo: 1 })).toBeNull();
  });

  test('addressJson and addressesFromRecipientJson', () => {
    expect(addressJson(null)).toBeNull();
    expect(addressJson({ value: [{ address: 'a@b.de' }] })).toContain('a@b.de');
    expect(addressesFromRecipientJson(null)).toBe('');
    expect(addressesFromRecipientJson('bad')).toBe('');
    expect(
      addressesFromRecipientJson(JSON.stringify({ value: [{ address: 'a@b.de' }, { address: 'c@d.de' }] })),
    ).toBe('a@b.de, c@d.de');
  });

  test('formatDate', () => {
    expect(formatDate(undefined)).toBeNull();
    expect(formatDate(new Date('invalid'))).toBeNull();
    expect(formatDate(new Date('2024-01-01T00:00:00.000Z'))).toBe('2024-01-01T00:00:00.000Z');
  });

  test('snippetFromParsed prefers text and truncates', () => {
    expect(snippetFromParsed('short', null)).toBe('short');
    const long = 'x'.repeat(300);
    expect(snippetFromParsed(long, null)).toMatch(/\.\.\.$/);
    expect(snippetFromParsed(null, '<p>Hello <b>world</b></p>')).toBe('Hello world');
    expect(snippetFromParsed(null, '<p></p>')).toBeNull();
    const longHtml = `<p>${'y'.repeat(9000)}</p>`;
    expect(snippetFromParsed(null, longHtml)?.length).toBeLessThanOrEqual(220);
  });

  test('plainTextFromHtml decodes named entities (umlauts, nbsp) for indexing', () => {
    expect(plainTextFromHtml('<p>M&uuml;ller</p>')).toBe('Müller');
    expect(plainTextFromHtml('<p>&Auml;rger mit Stra&szlig;e und S&ouml;hne &Uuml;bersicht</p>'))
      .toBe('Ärger mit Straße und Söhne Übersicht');
    expect(plainTextFromHtml('Rechnung&nbsp;2026')).toBe('Rechnung 2026');
    // &lt;/&gt; werden erst NACH dem Tag-Strip decodiert — kein Re-Strip.
    expect(plainTextFromHtml('a &lt;b&gt; c')).toBe('a <b> c');
    // Unbekannte benannte Entities bleiben unangetastet.
    expect(plainTextFromHtml('bleibt &foobar; stehen')).toBe('bleibt &foobar; stehen');
  });

  test('plainTextFromHtml decodes numeric entities (decimal and hex)', () => {
    expect(plainTextFromHtml('M&#252;ller')).toBe('Müller');
    expect(plainTextFromHtml('M&#xFC;ller &#x2F; Partner')).toBe('Müller / Partner');
    expect(plainTextFromHtml('Emoji &#128512;')).toBe('Emoji 😀');
    // Ungueltige Codepoints (NUL, Surrogates, out of range) bleiben literal.
    expect(plainTextFromHtml('x&#0;y')).toBe('x&#0;y');
    expect(plainTextFromHtml('x&#xD800;y')).toBe('x&#xD800;y');
    expect(plainTextFromHtml('x&#1114112;y')).toBe('x&#1114112;y');
  });

  test('plainTextFromHtml decodes &amp; last — no double-decode', () => {
    expect(plainTextFromHtml('M&uuml;ller &amp; S&ouml;hne')).toBe('Müller & Söhne');
    // &amp;uuml; ist die Escaped-Darstellung von "&uuml;" — sie darf NICHT
    // weiter zu "ü" decodiert werden.
    expect(plainTextFromHtml('literal &amp;uuml; bleibt')).toBe('literal &uuml; bleibt');
    expect(plainTextFromHtml('literal &amp;#252; bleibt')).toBe('literal &#252; bleibt');
    expect(plainTextFromHtml('doppelt &amp;amp; bleibt einfach')).toBe('doppelt &amp; bleibt einfach');
  });

  // F-A5-05: Unverschlossene <style/<script/<-Tags liessen die Strip-Regexe fuer jedes Vorkommen bis zum Ende scannen (quadratisch) und blockierten den Prozess.
  test('plainTextFromHtml bleibt linear bei unverschlossenen <style/<script/< Tags', () => {
    const hostile = [
      '<style'.repeat(40_000),
      '<SCRIPT'.repeat(40_000),
      '<'.repeat(60_000),
      `<p>x</p>${'<a'.repeat(30_000)}`,
    ];
    for (const html of hostile) {
      const started = Date.now();
      const text = plainTextFromHtml(html);
      expect(Date.now() - started).toBeLessThan(1000);
      // Ohne schliessendes Tag bleibt der Rest literal stehen (wie bisher).
      expect(text.length).toBeGreaterThan(0);
    }
  });

  // F-A5-05: Der lineare Strip muss fuer normale und zufaellige Eingaben exakt das Ergebnis der alten Regex-Kette liefern.
  test('plainTextFromHtml liefert dieselbe Ausgabe wie die bisherige Regex-Kette', () => {
    const legacyPlainTextFromHtml = (html: string, cap = 500_000): string => {
      const stripped = html
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<[^>]+>/g, ' ');
      const text = decodeHtmlEntities(stripped).replace(/\s+/g, ' ').trim();
      return text.length > cap ? text.slice(0, cap) : text;
    };
    const normalMails = [
      '',
      'Nur Text ohne Markup',
      '<p>a</p><style>x</style>b',
      '<html><head><style type="text/css">p { color: red; }</style><script>alert(1)</script></head>' +
        '<body><p>Hallo M&uuml;ller,</p><p>anbei die Rechnung&nbsp;2026.</p><br/><div>Gru&szlig;</div></body></html>',
      '<!DOCTYPE html><!-- Kommentar --><table><tr><td>A</td><td>B</td></tr></table>',
      '<STYLE>a{}</STYLE>Text<Script type="x">1</sCrIpT>mehr<style>b{}</style>',
      '<style>unterminated <p>bleibt</p>',
      '<script>eins</script><style>zwei</script></style>drei',
      'a <> b <<c>> d > e < f',
      '<p\nclass="x"\n>mehrzeilig</p>',
      'x &lt;b&gt; y &amp;amp; z &#252; &#xFC;',
    ];
    const tokens = [
      '<', '>', '<>', 'a', ' ', '\n', '<p>', '</p>', '<style', '<STYLE>', '</style>', '</StYlE>',
      '<script', '<Script>', '</script>', '</SCRIPT>', '</style', '&amp;', '&uuml;', 'ſ', 'İ',
    ];
    let seed = 0x5eed;
    const random = () => {
      seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
      return seed / 0x80000000;
    };
    const fuzzed = Array.from({ length: 3000 }, () => {
      const count = Math.floor(random() * 14);
      let s = '';
      for (let i = 0; i < count; i++) s += tokens[Math.floor(random() * tokens.length)];
      return s;
    });
    for (const html of [...normalMails, ...fuzzed]) {
      expect(plainTextFromHtml(html)).toBe(legacyPlainTextFromHtml(html));
    }
    expect(plainTextFromHtml('<p>abcdef</p>', 3)).toBe(legacyPlainTextFromHtml('<p>abcdef</p>', 3));
  });

  test('decodeHtmlEntities standalone keeps unrelated text intact', () => {
    expect(decodeHtmlEntities('R&D ohne Semikolon & Co')).toBe('R&D ohne Semikolon & Co');
    expect(decodeHtmlEntities('a &euro; 5 &ndash; 7')).toBe('a € 5 – 7');
    expect(decodeHtmlEntities('&quot;Zitat&quot; &apos;x&apos;')).toBe('"Zitat" \'x\'');
  });

  test('rawHeadersFromParsed uses headerLines or headers map', () => {
    expect(rawHeadersFromParsed({ headerLines: ['From: a@b.de', 'To: b@c.de'] })).toBe(
      'From: a@b.de\nTo: b@c.de',
    );
    const headers = {
      get(key: string) {
        if (key === 'subject') return 'Hi';
        if (key === 'x-multi') return ['a', 'b'];
        return undefined;
      },
      [Symbol.iterator]() {
        return [['subject', 'Hi'], ['x-multi', ['a', 'b']]][Symbol.iterator]();
      },
    };
    expect(rawHeadersFromParsed({ headers: headers as never })).toContain('subject: Hi');
    expect(rawHeadersFromParsed({})).toBeNull();
  });

  test('parseAttachmentsMeta', () => {
    expect(parseAttachmentsMeta({})).toEqual({ hasAttachments: false, json: null });
    expect(parseAttachmentsMeta({ attachments: [] })).toEqual({ hasAttachments: false, json: null });
    const r = parseAttachmentsMeta({
      attachments: [{ filename: 'f.pdf', contentType: 'application/pdf', size: 10 }],
    });
    expect(r.hasAttachments).toBe(true);
    expect(JSON.parse(r.json!)).toHaveLength(1);
  });
});
