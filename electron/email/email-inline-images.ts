import fs from 'fs';
import path from 'path';
import os from 'os';
import { randomUUID } from 'crypto';
import { app } from 'electron';

/** Max decoded bytes per inline data-URL image (before base64 decode). */
export const MAX_INLINE_IMAGE_BYTES = 8 * 1024 * 1024;

export type InlineImageAttachment = {
  filename: string;
  path: string;
  cid: string;
};

function inlineTempRoot(): string {
  try {
    return path.join(app.getPath('temp'), 'simplecrm-inline');
  } catch {
    return path.join(os.tmpdir(), 'simplecrm-inline');
  }
}

function extensionForMime(mime: string): string {
  const m = mime.toLowerCase();
  if (m.includes('png')) return 'png';
  if (m.includes('gif')) return 'gif';
  if (m.includes('webp')) return 'webp';
  if (m.includes('svg')) return 'svg';
  if (m.includes('jpeg') || m.includes('jpg')) return 'jpg';
  return 'bin';
}

/** Remove temp files created for inline CID attachments (best-effort). */
export function cleanupInlineImageTempFiles(paths: string[]): void {
  for (const p of paths) {
    try {
      if (p.includes('simplecrm-inline') && fs.existsSync(p)) {
        fs.unlinkSync(p);
      }
    } catch {
      /* ignore */
    }
  }
}

/** Convert data: URLs in HTML to CID references + temp file attachments for nodemailer. */
export function extractInlineImagesFromHtml(html: string): {
  html: string;
  attachments: InlineImageAttachment[];
} {
  const attachments: InlineImageAttachment[] = [];
  let out = html;
  const re = /<img([^>]*)\ssrc=["']data:([^;]+);base64,([^"']+)["']([^>]*)>/gi;
  out = out.replace(re, (_full, before, mime, b64, after) => {
    const estimatedBytes = Math.floor((b64.length * 3) / 4);
    if (estimatedBytes > MAX_INLINE_IMAGE_BYTES) {
      return _full;
    }
    const cid = `inline-${randomUUID()}@simplecrm`;
    const ext = extensionForMime(mime);
    const filename = `inline.${ext}`;
    const tmpPath = path.join(inlineTempRoot(), `${cid}.${ext}`);
    fs.mkdirSync(path.dirname(tmpPath), { recursive: true });
    fs.writeFileSync(tmpPath, Buffer.from(b64, 'base64'));
    attachments.push({ filename, path: tmpPath, cid });
    return `<img${before} src="cid:${cid}"${after}>`;
  });
  return { html: out, attachments };
}
