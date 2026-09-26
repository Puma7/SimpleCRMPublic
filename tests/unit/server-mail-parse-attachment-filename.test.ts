/**
 * @jest-environment node
 */
import { isPotentiallyDangerousAttachment } from '@simplecrm/core';
import { parsedAttachmentsForStorage, sanitizeAttachmentFilename } from '../../packages/server/src/mail-parse';

describe('server attachment filename sanitizer', () => {
  // F-A5-13: Umlaute/Unicode wurden zu '_' und fuehrende Unterstriche entfernt; '报价.exe' wurde zu '.exe' und entging der Gefahrenerkennung.
  test('keeps umlauts and other unicode letters', () => {
    expect(sanitizeAttachmentFilename('Rechnung_März.pdf')).toBe('Rechnung_März.pdf');
    expect(sanitizeAttachmentFilename('Übersicht.pdf')).toBe('Übersicht.pdf');
    expect(sanitizeAttachmentFilename('报价.pdf')).toBe('报价.pdf');
  });

  test('dangerous executables stay recognisable after sanitizing', () => {
    for (const raw of ['报价.exe', 'ü.exe', 'evil.exe.', 'evil.exe..', 'evil.exe . ', 'rechnung\u202Efdp.exe']) {
      const sanitized = sanitizeAttachmentFilename(raw);
      expect({ raw, sanitized, dangerous: isPotentiallyDangerousAttachment(sanitized) })
        .toEqual({ raw, sanitized, dangerous: true });
    }
    const [stored] = parsedAttachmentsForStorage([{ filename: '报价.exe', content: Buffer.from('MZ') }]);
    expect(stored!.filename.startsWith('.')).toBe(false);
    expect(isPotentiallyDangerousAttachment(stored!.filename)).toBe(true);
  });

  test('still strips path components and control characters', () => {
    expect(sanitizeAttachmentFilename('../../etc/passwd')).toBe('passwd');
    expect(sanitizeAttachmentFilename('C:\\Users\\x\\evil.exe')).toBe('evil.exe');
    expect(sanitizeAttachmentFilename('a\r\nb\u0000.txt')).toBe('ab.txt');
    expect(sanitizeAttachmentFilename('..')).toBe('attachment');
  });
});
