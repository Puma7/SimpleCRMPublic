import {
  COMPOSE_QUOTE_MARKER,
  buildReplyComposeHtml,
  mergeComposeHtml,
  plainTextToReplyHtml,
  splitComposeHtml,
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
    const { editableHtml, quotedHtml } = splitComposeHtml(html);
    expect(editableHtml).toContain('Hallo');
    expect(editableHtml).toContain('Grüße');
    expect(quotedHtml).toContain('Original');
  });

  it('converts plain text paragraphs to html', () => {
    expect(plainTextToReplyHtml('Zeile eins\n\nZeile zwei')).toBe(
      '<p>Zeile eins</p><p>Zeile zwei</p>',
    );
  });
});
