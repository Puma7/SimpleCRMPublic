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
    expect(attachmentTextKind('preisliste.TSV')).toBe('text');
    expect(attachmentTextKind('artikel.json')).toBe('text');
    expect(attachmentTextKind('preisliste.xlsx')).toBe('xlsx');
    expect(attachmentTextKind('preisliste.xlsm')).toBe('xlsx');
    expect(attachmentTextKind('preisliste.xlsb')).toBe('xlsb');
    expect(attachmentTextKind('preisliste.xls')).toBe('xls');
    expect(attachmentTextKind('preisliste.ods')).toBe('ods');
    expect(attachmentTextKind('angebot.odt')).toBe('odt');
    expect(attachmentTextKind('angebot.rtf')).toBe('rtf');
    expect(attachmentTextKind('altformat.doc')).toBe('doc');
    expect(attachmentTextKind('vortrag.pptx')).toBe('pptx');
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
    expect(attachmentTextKind('anhang', 'application/vnd.ms-excel')).toBe('xls');
    expect(attachmentTextKind('anhang', 'application/vnd.ms-excel.sheet.binary.macroEnabled.12')).toBe('xlsb');
    expect(attachmentTextKind('anhang', 'text/csv')).toBe('text');
    expect(attachmentTextKind('anhang', 'application/rtf')).toBe('rtf');
    expect(attachmentTextKind('altformat', 'application/msword')).toBe('doc');
  });

  test('unsupported types return null', () => {
    expect(attachmentTextKind('bild.png', 'image/png')).toBeNull();
    expect(attachmentTextKind('archiv.zip')).toBeNull();
    expect(attachmentTextKind('programm.exe', 'application/x-msdownload')).toBeNull();
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
