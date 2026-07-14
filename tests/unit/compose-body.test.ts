import {
  COMPOSE_QUOTE_MARKER,
  buildReplyComposeHtml,
  buildQuotedBlockHtml,
  mergeComposeHtml,
  plainTextToReplyHtml,
  splitComposeHtml,
  splitComposeZones,
} from '../../shared/compose-body';

describe('compose-body', () => {
  it('splits and merges around quote marker', () => {
    const html = `<p>Antwort</p>${COMPOSE_QUOTE_MARKER}<p>--- Zitat</p>`;
    const { editableHtml, quotedHtml } = splitComposeHtml(html);
    expect(editableHtml).toContain('Antwort');
    expect(quotedHtml).toContain('Zitat');
    expect(mergeComposeHtml('<p>Neu</p>', quotedHtml)).toBe(
      `<p>Neu</p>${COMPOSE_QUOTE_MARKER}<p>--- Zitat</p>`,
    );
  });

  it('builds reply above quote with signature', () => {
    const html = buildReplyComposeHtml({
      replyHtml: '<p>Hallo</p>',
      quotedPlain: 'Original',
      signatureHtml: '<p>Grüße</p>',
    });
    const zones = splitComposeZones(html);
    expect(zones.bodyHtml).toContain('Hallo');
    expect(zones.signatureHtml).toContain('Grüße');
    expect(zones.quotedHtml).toContain('Original');
  });

  it('converts plain text paragraphs to html', () => {
    expect(plainTextToReplyHtml('Zeile eins\n\nZeile zwei')).toBe(
      '<p>Zeile eins</p><p>Zeile zwei</p>',
    );
  });

  it('escapes untrusted plain text before creating compose html', () => {
    expect(plainTextToReplyHtml('<img src=x onerror=alert(1)> & "quoted"')).toBe(
      '<p>&lt;img src=x onerror=alert(1)&gt; &amp; &quot;quoted&quot;</p>',
    );
    expect(buildQuotedBlockHtml('<script>alert(1)</script>')).toBe(
      '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>',
    );
  });
});
