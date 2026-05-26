import fs from 'fs';
import os from 'os';
import path from 'path';

jest.mock('electron', () => ({
  app: {
    getPath: () => path.join(os.tmpdir(), 'simplecrm-inline-test'),
  },
}));

import {
  cleanupInlineImageTempFiles,
  extractInlineImagesFromHtml,
  MAX_INLINE_IMAGE_BYTES,
  sweepStaleInlineImageTempFiles,
} from '../../electron/email/email-inline-images';

describe('email-inline-images', () => {
  const root = path.join(os.tmpdir(), 'simplecrm-inline-test');

  beforeEach(() => {
    fs.mkdirSync(root, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('sweepStaleInlineImageTempFiles returns 0 when temp dir is absent', () => {
    fs.rmSync(root, { recursive: true, force: true });
    expect(sweepStaleInlineImageTempFiles()).toBe(0);
  });

  test('cleanupInlineImageTempFiles deletes paths under simplecrm-inline', () => {
    const f = path.join(root, 'cid-test.bin');
    fs.writeFileSync(f, Buffer.from('x'));
    cleanupInlineImageTempFiles([f]);
    expect(fs.existsSync(f)).toBe(false);
  });

  test('extractInlineImagesFromHtml converts data URL to cid attachment', () => {
    const tiny = Buffer.from('hello').toString('base64');
    const html = `<p><img src="data:image/png;base64,${tiny}" alt="x"></p>`;
    const { html: out, attachments } = extractInlineImagesFromHtml(html);
    expect(attachments).toHaveLength(1);
    expect(out).toContain('cid:inline-');
    expect(fs.existsSync(attachments[0]!.path)).toBe(true);
    cleanupInlineImageTempFiles(attachments.map((a) => a.path));
  });

  test('leaves oversized inline images unchanged', () => {
    const bigLen = MAX_INLINE_IMAGE_BYTES + 1000;
    const fakeB64 = 'A'.repeat(Math.ceil((bigLen * 4) / 3));
    const html = `<img src="data:image/png;base64,${fakeB64}">`;
    const { html: out, attachments } = extractInlineImagesFromHtml(html);
    expect(attachments).toHaveLength(0);
    expect(out).toBe(html);
  });
});
