import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  buildComposeRfc822,
  encodeMailboxListHeader,
  encodeRfc2047,
} from '../../electron/email/mail-rfc822-compose';

describe('mail-rfc822-compose', () => {
  test('encodeRfc2047 ascii passthrough and utf8', () => {
    expect(encodeRfc2047('Hello')).toBe('Hello');
    expect(encodeRfc2047('Grüße')).toContain('=?UTF-8?B?');
    const long = 'ä'.repeat(80);
    expect(encodeRfc2047(long).split('\r\n ').length).toBeGreaterThan(1);
  });

  test('encodeMailboxListHeader encodes display names', () => {
    expect(encodeMailboxListHeader('User <a@b.de>')).toContain('a@b.de');
    expect(encodeMailboxListHeader('"Last, First" <a@b.de>')).toContain('a@b.de');
    expect(encodeMailboxListHeader('Müller <a@b.de>')).toContain('=?UTF-8?B?');
  });

  test('buildComposeRfc822 plain only', () => {
    const buf = buildComposeRfc822({
      from: 'me@test.de',
      to: 'to@test.de',
      subject: 'Subj',
      text: 'Body',
    });
    const s = buf.toString('utf8');
    expect(s).toContain('Content-Type: text/plain');
    expect(s).toContain('Body');
  });

  test('buildComposeRfc822 multipart with inline and regular attachments', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rfc822-'));
    const inlinePath = path.join(tmp, 'inline.png');
    const filePath = path.join(tmp, 'doc.pdf');
    fs.writeFileSync(inlinePath, Buffer.from('PNG'));
    fs.writeFileSync(filePath, Buffer.from('%PDF'));

    const buf = buildComposeRfc822({
      from: 'me@test.de',
      to: 'to@test.de',
      subject: 'Anhang',
      text: 'Text',
      html: '<p>Html</p>',
      messageId: '<id@test>',
      inReplyTo: '<parent@test>',
      references: '<parent@test>',
      requestReadReceipt: true,
      attachments: [
        { filename: 'inline.png', path: inlinePath, cid: 'cid1@inline' },
        { filename: 'doc.pdf', path: filePath },
        { filename: 'missing.bin', path: path.join(tmp, 'missing.bin') },
      ],
    });
    const s = buf.toString('utf8');
    expect(s).toContain('multipart/mixed');
    expect(s).toContain('multipart/related');
    expect(s).toContain('Content-ID: <cid1@inline>');
    expect(s).toContain('doc.pdf');
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
