import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

export type InlineImageAttachment = {
  filename: string;
  path: string;
  cid: string;
};

/** Convert data: URLs in HTML to CID references + temp file attachments for nodemailer. */
export function extractInlineImagesFromHtml(html: string): {
  html: string;
  attachments: InlineImageAttachment[];
} {
  const attachments: InlineImageAttachment[] = [];
  let out = html;
  const re = /<img([^>]*)\ssrc=["']data:([^;]+);base64,([^"']+)["']([^>]*)>/gi;
  out = out.replace(re, (_full, before, mime, b64, after) => {
    const cid = `inline-${randomUUID()}@simplecrm`;
    const ext = mime.includes('png') ? 'png' : mime.includes('gif') ? 'gif' : 'jpg';
    const filename = `inline.${ext}`;
    const tmpPath = path.join(process.cwd(), '.simplecrm-inline', `${cid}.${ext}`);
    fs.mkdirSync(path.dirname(tmpPath), { recursive: true });
    fs.writeFileSync(tmpPath, Buffer.from(b64, 'base64'));
    attachments.push({ filename, path: tmpPath, cid });
    return `<img${before} src="cid:${cid}"${after}>`;
  });
  return { html: out, attachments };
}
