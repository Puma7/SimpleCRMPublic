import fs from 'fs';
import os from 'os';
import path from 'path';
import { buildComposeRfc822 } from '../../electron/email/mail-rfc822-compose';

describe('buildComposeRfc822', () => {
  it('includes file attachments in multipart/mixed', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rfc822-'));
    const attPath = path.join(dir, 'doc.txt');
    fs.writeFileSync(attPath, 'hello attachment');

    const buf = buildComposeRfc822({
      from: 'me@example.com',
      to: 'you@example.com',
      subject: 'Test',
      text: 'Body',
      attachments: [{ filename: 'doc.txt', path: attPath }],
    });

    const raw = buf.toString('utf-8');
    expect(raw).toContain('multipart/mixed');
    expect(raw).toContain('aGVsbG8gYXR0YWNobWVudA==');
    expect(raw).toContain('Content-Disposition: attachment');

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('encodes non-ASCII display names in From/To/Cc', () => {
    const buf = buildComposeRfc822({
      from: 'Müller GmbH <mueller@example.com>',
      to: 'Käufer <buyer@example.com>',
      cc: 'François <fr@example.com>',
      subject: 'Test',
      text: 'Body',
    });
    const raw = buf.toString('utf-8');
    expect(raw).toMatch(/^From: =\?UTF-8\?B\?/m);
    expect(raw).toMatch(/^To: =\?UTF-8\?B\?/m);
    expect(raw).toMatch(/^Cc: =\?UTF-8\?B\?/m);
    expect(raw).toContain('mueller@example.com');
    expect(raw).toContain('buyer@example.com');
    expect(raw).toContain('fr@example.com');
  });
});
