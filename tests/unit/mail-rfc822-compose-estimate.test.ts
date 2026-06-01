import fs from 'fs';
import os from 'os';
import path from 'path';
import { estimateComposeRfc822Bytes } from '../../electron/email/mail-rfc822-compose';

describe('estimateComposeRfc822Bytes', () => {
  test('includes base64 overhead for attachments', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rfc822-est-'));
    const fp = path.join(dir, 'a.bin');
    fs.writeFileSync(fp, Buffer.alloc(100_000));
    const est = estimateComposeRfc822Bytes({
      text: 'hello',
      attachments: [{ filename: 'a.bin', path: fp }],
    });
    fs.rmSync(dir, { recursive: true, force: true });
    expect(est).toBeGreaterThan(130_000);
  });
});
