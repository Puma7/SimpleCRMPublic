import { isPotentiallyDangerousAttachment, sanitizeAttachmentFilename } from '@simplecrm/core';

describe('sanitizeAttachmentFilename (core)', () => {
  // F-A7b-15 / F-A5-13: gemeinsamer Sanitizer, der Unicode behaelt und die echte Endung nicht verliert.
  test('keeps unicode names and normalizes them to NFC', () => {
    expect(sanitizeAttachmentFilename('Angebot_Müller_Größe.pdf')).toBe('Angebot_Müller_Größe.pdf');
    expect(sanitizeAttachmentFilename('Prüfbericht.pdf')).toBe('Prüfbericht.pdf');
    expect(sanitizeAttachmentFilename('Отчёт 2026.docx')).toBe('Отчёт 2026.docx');
  });

  test('removes bidi overrides, zero-width and control characters so the real extension shows', () => {
    const sanitized = sanitizeAttachmentFilename('rechnung‮fdp.exe');
    expect(sanitized).toBe('rechnungfdp.exe');
    expect(isPotentiallyDangerousAttachment(sanitized)).toBe(true);
    expect(sanitizeAttachmentFilename('a​b\u0007c.txt')).toBe('abc.txt');
  });

  test('handles separators, reserved characters and names, and empty input', () => {
    expect(sanitizeAttachmentFilename('dir/sub\\file.txt')).toBe('file.txt');
    expect(sanitizeAttachmentFilename('a<b>:c"d|e?f*.txt')).toBe('a_b__c_d_e_f_.txt');
    expect(sanitizeAttachmentFilename('CON.txt')).toBe('_CON.txt');
    expect(sanitizeAttachmentFilename('...')).toBe('attachment');
    expect(sanitizeAttachmentFilename(null)).toBe('attachment');
  });

  test('truncates long names but keeps the extension', () => {
    const long = `${'ä'.repeat(300)}.exe`;
    const sanitized = sanitizeAttachmentFilename(long);
    expect(Array.from(sanitized)).toHaveLength(180);
    expect(sanitized.endsWith('.exe')).toBe(true);
    expect(isPotentiallyDangerousAttachment(sanitized)).toBe(true);
  });
});
