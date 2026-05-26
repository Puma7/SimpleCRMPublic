import fs from 'fs';
import os from 'os';
import path from 'path';

jest.mock('electron', () => ({
  app: { getPath: () => path.join(os.tmpdir(), 'simplecrm-test') },
}));

import {
  cleanupInlineImageTempFiles,
  extractInlineImagesFromHtml,
  MAX_INLINE_IMAGE_BYTES,
  sweepStaleInlineImageTempFiles,
} from '../../electron/email/email-inline-images';

describe('email-inline-images', () => {
  test('extractInlineImagesFromHtml converts data url to cid attachment', () => {
    const tiny = Buffer.from('png').toString('base64');
    const html = `<p>Hi</p><img alt="x" src="data:image/png;base64,${tiny}">`;
    const r = extractInlineImagesFromHtml(html);
    expect(r.attachments).toHaveLength(1);
    expect(r.html).toContain('cid:inline-');
    expect(fs.existsSync(r.attachments[0]!.path)).toBe(true);
    cleanupInlineImageTempFiles([r.attachments[0]!.path]);
  });

  test('skips oversized inline images', () => {
    const big = 'A'.repeat(Math.ceil((MAX_INLINE_IMAGE_BYTES * 4) / 3) + 10);
    const html = `<img src="data:image/png;base64,${big}">`;
    const r = extractInlineImagesFromHtml(html);
    expect(r.attachments).toHaveLength(0);
    expect(r.html).toContain('data:image/png');
  });

  test('sweepStaleInlineImageTempFiles removes old files', () => {
    const root = path.join(os.tmpdir(), 'simplecrm-test', 'simplecrm-inline');
    fs.mkdirSync(root, { recursive: true });
    const oldFile = path.join(root, 'old.png');
    fs.writeFileSync(oldFile, 'x');
    const oldTime = Date.now() - 48 * 60 * 60 * 1000;
    fs.utimesSync(oldFile, oldTime / 1000, oldTime / 1000);
    const removed = sweepStaleInlineImageTempFiles(24 * 60 * 60 * 1000, { debug: jest.fn(), warn: jest.fn() });
    expect(removed).toBeGreaterThanOrEqual(1);
    expect(fs.existsSync(oldFile)).toBe(false);
  });

  test('cleanupInlineImageTempFiles ignores non-inline paths', () => {
    const p = path.join(os.tmpdir(), 'other.txt');
    fs.writeFileSync(p, 'x');
    cleanupInlineImageTempFiles([p]);
    expect(fs.existsSync(p)).toBe(true);
    fs.unlinkSync(p);
  });
});
