import {
  buildFeaturePreview,
  extractSpamFeatureKeys,
  normalizeSenderEmail,
  stripHtmlTagsToText,
} from '../../packages/core/src/email';

describe('core email spam feature extraction', () => {
  test('normalizes sender addresses and extracts auth/content features', () => {
    const features = extractSpamFeatureKeys({
      fromJson: JSON.stringify({ value: [{ address: 'Offer@Example.COM' }] }),
      authDmarc: 'fail',
      subject: 'Urgent bitcoin password',
      bodyText: 'Bitte sofort https://bad.example klicken',
    });

    expect(normalizeSenderEmail('Sender Name <UPPER@Example.COM>')).toBe('upper@example.com');
    expect(features).toEqual(expect.arrayContaining([
      'sender:email:offer@example.com',
      'sender:domain:example.com',
      'auth:dmarc:fail',
      'content:has_url',
      'content:suspicious_terms',
    ]));
  });

  test('extracts attachment features from imported attachment metadata shapes', () => {
    expect(buildFeaturePreview({
      fromJson: JSON.stringify({ value: [{ address: 'sender@example.com' }] }),
      attachmentsJson: JSON.stringify({
        stored: [{ name: 'invoice.exe', contentType: 'application/x-msdownload' }],
        omitted: [{ name: 'large.zip' }],
      }),
      hasAttachments: false,
    }).featureKeys).toEqual(expect.arrayContaining([
      'attachment:any',
      'attachment:ext:exe',
      'attachment:ext:zip',
      'attachment:mime:application_x-msdownload',
      'attachment:risky_type',
    ]));
  });

  // F-N-redos-01: textFromHtml strippte Tags per /<[^>]+>/g; unverschlossene '<' im HTML-Teil kosteten pro Mail Sekunden (quadratisch).
  test('stays linear for HTML bodies with unclosed tags', () => {
    for (const bodyHtml of ['<'.repeat(50_000), '<a'.repeat(25_000), `<b>dringend</b>${'<x'.repeat(24_000)}`]) {
      const started = Date.now();
      const features = extractSpamFeatureKeys({ subject: 'Hallo', bodyHtml });
      expect(Date.now() - started).toBeLessThan(500);
      expect(Array.isArray(features)).toBe(true);
    }
    expect(extractSpamFeatureKeys({ bodyHtml: '<p>konto <b>gesperrt</b></p>' }))
      .toContain('content:suspicious_terms');
    // Tags werden weiterhin durch Leerzeichen ersetzt: "in<b>voice</b>" ist kein "invoice".
    expect(extractSpamFeatureKeys({ bodyHtml: 'in<b>voice</b>' })).not.toContain('content:business_terms');
  });

  // F-N-redos-01: Der lineare Helfer muss exakt das Ergebnis der bisherigen Regex-Kette liefern.
  test('stripHtmlTagsToText matches the previous regex chain', () => {
    const legacy = (html: string): string => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const samples = [
      '',
      'Nur Text',
      '<p>Hallo <b>Welt</b></p>',
      'a <> b <<c>> d > e < f',
      '<p\nclass="x"\n>mehrzeilig</p>',
      '<html><head><style>p{}</style></head><body><p>M&uuml;ller</p><br/></body></html>',
      '<a href="https://example.com">Link</a> <img src=x>',
    ];
    const tokens = ['<', '>', '<>', 'a', ' ', '\n', '\t', '<p>', '</p>', '<b', 'x>', '&amp;', 'ü'];
    let seed = 0x5eed;
    const random = () => {
      seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
      return seed / 0x80000000;
    };
    for (let n = 0; n < 3000; n++) {
      const count = Math.floor(random() * 14);
      let html = '';
      for (let i = 0; i < count; i++) html += tokens[Math.floor(random() * tokens.length)];
      samples.push(html);
    }
    for (const html of samples) {
      expect(stripHtmlTagsToText(html)).toBe(legacy(html));
    }
  });
});
