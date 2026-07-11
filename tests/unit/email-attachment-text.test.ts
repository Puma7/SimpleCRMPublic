import {
  ATTACHMENT_TEXT_MAX_CHARS,
  attachmentTextKind,
  capAttachmentText,
} from '../../packages/core/src/email/attachment-text';

describe('attachmentTextKind', () => {
  test('maps extensions', () => {
    expect(attachmentTextKind('bericht.TXT')).toBe('text');
    expect(attachmentTextKind('notizen.md')).toBe('text');
    expect(attachmentTextKind('daten.csv')).toBe('text');
    expect(attachmentTextKind('server.log')).toBe('text');
    expect(attachmentTextKind('seite.html')).toBe('html');
    expect(attachmentTextKind('seite.htm')).toBe('html');
    expect(attachmentTextKind('rechnung.pdf')).toBe('pdf');
    expect(attachmentTextKind('vertrag.docx')).toBe('docx');
  });

  test('falls back to content type when extension is unknown', () => {
    expect(attachmentTextKind('anhang.bin', 'application/pdf')).toBe('pdf');
    expect(attachmentTextKind('anhang', 'text/plain; charset=utf-8')).toBe('text');
    expect(
      attachmentTextKind(
        null,
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      ),
    ).toBe('docx');
  });

  test('unsupported types return null', () => {
    expect(attachmentTextKind('bild.png', 'image/png')).toBeNull();
    expect(attachmentTextKind('archiv.zip')).toBeNull();
    expect(attachmentTextKind('altformat.doc', 'application/msword')).toBeNull();
    expect(attachmentTextKind(null, null)).toBeNull();
  });
});

describe('capAttachmentText', () => {
  test('collapses whitespace and trims', () => {
    expect(capAttachmentText('  Hallo\n\n  Welt\t! ')).toBe('Hallo Welt !');
  });

  test('caps at the character limit', () => {
    const long = 'x'.repeat(ATTACHMENT_TEXT_MAX_CHARS + 100);
    expect(capAttachmentText(long)).toHaveLength(ATTACHMENT_TEXT_MAX_CHARS);
    expect(capAttachmentText('abc', 2)).toBe('ab');
  });
});
