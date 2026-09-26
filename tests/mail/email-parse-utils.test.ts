import {
  addressJson,
  addressesFromRecipientJson,
  CID_INLINE_MIN_BUDGET_BYTES,
  cidInlineBudgetBytes,
  decodeHtmlEntities,
  formatDate,
  inlineCidImages,
  normalizeAddressJson,
  parseAttachmentsMeta,
  plainTextFromHtml,
  rawHeadersFromParsed,
  snippetFromParsed,
} from '../../electron/email/email-parse-utils';

type TestAttachment = { cid?: string; contentType?: string; content: Buffer };

/** mailparser's own cid: replacement (MailParser#updateImageLinks with simpleParser's default callback). */
function mailparserDefaultInline(html: string, attachments: TestAttachment[]): Promise<string | false> {
  const { MailParser } = jest.requireActual('mailparser') as {
    MailParser: {
      prototype: {
        updateImageLinks(
          this: unknown,
          replace: (attachment: TestAttachment, done: (err: unknown, url?: string) => void) => void,
          done: (err: unknown, html: string | false) => void,
        ): void;
      };
    };
  };
  return new Promise((resolve, reject) => {
    MailParser.prototype.updateImageLinks.call(
      { html, attachmentList: attachments, options: {} },
      (attachment, done) =>
        done(false, 'data:' + attachment.contentType + ';base64,' + attachment.content.toString('base64')),
      (err, out) => (err ? reject(err) : resolve(out)),
    );
  });
}

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

  // C-A71: mailparser ersetzte jede cid:-Referenz ohne Grenze durch die volle data:-URL; ein 1000-fach referenziertes Bild vervielfachte den HTML-Body.
  test('inlineCidImages bounds repeated references by the byte budget', () => {
    const image = Buffer.alloc(100 * 1024, 7);
    const html = '<img src="cid:a">'.repeat(1000);
    const url = `data:image/png;base64,${image.toString('base64')}`;
    const out = inlineCidImages(html, [{ cid: 'a', contentType: 'image/png', content: image }], CID_INLINE_MIN_BUDGET_BYTES);
    const inlined = Math.floor(CID_INLINE_MIN_BUDGET_BYTES / url.length);
    expect(out.length).toBeLessThanOrEqual(html.length + CID_INLINE_MIN_BUDGET_BYTES);
    expect(out).toBe(`<img src="${url}">`.repeat(inlined) + '<img src="cid:a">'.repeat(1000 - inlined));
  });

  // C-A71: Ein Bild, das nicht mehr ins Budget passt, bleibt cid:; kleinere spaetere Bilder werden weiter eingebettet.
  test('inlineCidImages keeps references that no longer fit as cid and still inlines smaller images', () => {
    const big = Buffer.alloc(3000, 1);
    const small = Buffer.from([1, 2, 3]);
    const attachments = [
      { cid: 'big', contentType: 'image/png', content: big },
      { cid: 'small', contentType: 'image/gif', content: small },
    ];
    const bigUrl = `data:image/png;base64,${big.toString('base64')}`;
    const smallUrl = 'data:image/gif;base64,AQID';
    const html = '<img src="cid:big"><img src="cid:big"><img src="cid:small">';
    expect(inlineCidImages(html, attachments, bigUrl.length + smallUrl.length)).toBe(
      `<img src="${bigUrl}"><img src="cid:big"><img src="${smallUrl}">`,
    );
    expect(inlineCidImages(html, attachments, bigUrl.length - 1)).toBe(
      `<img src="cid:big"><img src="cid:big"><img src="${smallUrl}">`,
    );
    expect(inlineCidImages(html, attachments, 0)).toBe(html);
    expect(inlineCidImages(html, undefined, Infinity)).toBe(html);
    expect(inlineCidImages('<img src="cid:u8">', [{ cid: 'u8', contentType: 'image/png', content: new Uint8Array([1, 2, 3]) }], Infinity))
      .toBe('<img src="data:image/png;base64,AQID">');
  });

  test('cidInlineBudgetBytes is 16 MiB or twice the raw size', () => {
    expect(CID_INLINE_MIN_BUDGET_BYTES).toBe(16 * 1024 * 1024);
    expect(cidInlineBudgetBytes(0)).toBe(16 * 1024 * 1024);
    expect(cidInlineBudgetBytes(157_000)).toBe(16 * 1024 * 1024);
    expect(cidInlineBudgetBytes(20 * 1024 * 1024)).toBe(40 * 1024 * 1024);
  });

  // C-A71: Ohne Budgetgrenze muss die Ersetzung exakt mailparsers Standardausgabe liefern (normale Mails unveraendert).
  test('inlineCidImages matches mailparser default inlining for normal and random html', async () => {
    const attachments: TestAttachment[] = [
      { contentType: 'image/png', content: Buffer.from([9]) },
      { cid: 'a', contentType: 'image/png', content: Buffer.from([1, 2, 3, 4]) },
      { cid: 'b', contentType: 'application/pdf', content: Buffer.from('%PDF') },
      { cid: 'b', contentType: 'image/gif', content: Buffer.from([5]) },
      { cid: 'b', contentType: 'image/jpeg', content: Buffer.from([6]) },
      { cid: 'a@x', contentType: 'image/svg+xml', content: Buffer.from('<svg/>') },
      { cid: 'a>', contentType: 'IMAGE/JPEG', content: Buffer.from([7, 8]) },
      { cid: 'c_1', contentType: 'image/x-icon', content: Buffer.from([0]) },
      { cid: 'c_1', contentType: 'image/webp', content: Buffer.from([10, 11]) },
    ];
    const normalMails = [
      '<p>Hallo</p><img src="cid:a" alt="Logo">',
      "<img src='cid:b'><img src=\"cid:a\"><img src=cid:a alt=x><img src=cid:a>",
      '<div style="background:url(\'cid:a\')">x</div><div style="background:url(cid:a)">y</div>',
      '<img src="cid:a@x"><img src="cid:missing"><img src="CID:a"><img src="xcid:a"><img src="-cid:a">',
      '<img src="cid:c_1"><img src="cid:c_1">',
      'kein Verweis',
    ];
    const tokens = ['cid:', 'cid:a', 'cid:b', 'a', 'b', '@x', '>', '<img src="', '"', "'", ' ', '\n', '\t', '\u00a0', 'x', ')', '_1', 'CID:', 'ä', '$&'];
    let seed = 0xc1d;
    const random = () => {
      seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
      return seed / 0x80000000;
    };
    const fuzzed = Array.from({ length: 2000 }, () => {
      const count = 1 + Math.floor(random() * 12);
      let s = '';
      for (let i = 0; i < count; i++) s += tokens[Math.floor(random() * tokens.length)];
      return s;
    });
    fuzzed.push(`<img src="cid:${'a'.repeat(300)}">`, `cid:a${'b'.repeat(255)}`);
    for (const html of [...normalMails, ...fuzzed]) {
      expect({ html, out: inlineCidImages(html, attachments, Infinity) })
        .toEqual({ html, out: await mailparserDefaultInline(html, attachments) });
    }
  });

  // C-A71: Die Ersetzung laeuft in einem linearen Durchgang (mailparser suchte pro Verweis alle Anhaenge ab).
  test('inlineCidImages stays linear for many references and attachments', () => {
    const tiny = [{ cid: 'a', contentType: 'image/png', content: Buffer.from([1, 2, 3]) }];
    let started = Date.now();
    const out = inlineCidImages('<img src="cid:a">'.repeat(200_000), tiny, CID_INLINE_MIN_BUDGET_BYTES);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(out).toBe('<img src="data:image/png;base64,AQID">'.repeat(200_000));

    const many = Array.from({ length: 20_000 }, (_, i) => ({
      cid: `c${i}`,
      contentType: 'image/png',
      content: Buffer.from([i & 0xff]),
    }));
    const html = many.map((a) => `<img src="cid:${a.cid}">`).join('');
    started = Date.now();
    const manyOut = inlineCidImages(html, many, CID_INLINE_MIN_BUDGET_BYTES);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(manyOut).not.toContain('cid:');
  });
});
