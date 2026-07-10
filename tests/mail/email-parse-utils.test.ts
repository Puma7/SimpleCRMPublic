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
