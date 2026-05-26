import fs from 'fs';
import path from 'path';
import os from 'os';
import { randomUUID } from 'crypto';
import { app } from 'electron';

/** Max decoded bytes per inline data-URL image (before base64 decode). */
export const MAX_INLINE_IMAGE_BYTES = 8 * 1024 * 1024;

/** Do not run regex on individual base64 payloads larger than this (stack/memory guard). */
const MAX_INLINE_B64_PARSE_CHARS = MAX_INLINE_IMAGE_BYTES * 2;

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

const INLINE_TEMP_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** Delete stale files under simplecrm-inline temp (call on app boot). */
export function sweepStaleInlineImageTempFiles(
  maxAgeMs = INLINE_TEMP_MAX_AGE_MS,
  logger?: Pick<typeof console, 'debug' | 'warn'>,
): number {
  const root = inlineTempRoot();
  let removed = 0;
  try {
    if (!fs.existsSync(root)) return 0;
    const cutoff = Date.now() - maxAgeMs;
    for (const name of fs.readdirSync(root)) {
      const full = path.join(root, name);
      try {
        const st = fs.statSync(full);
        if (st.isFile() && st.mtimeMs < cutoff) {
          fs.unlinkSync(full);
          removed += 1;
        }
      } catch (e) {
        logger?.debug?.('[email] inline temp sweep skip', full, e);
      }
    }
  } catch (e) {
    logger?.warn?.('[email] inline temp sweep failed', e);
  }
  return removed;
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

type DataUrlInTag = { mime: string; b64: string; fullMatch: string };

/** Parse data-URL src from a single img tag without regex on megabyte base64 strings. */
function parseDataUrlFromImgTag(tag: string): DataUrlInTag | null {
  const lower = tag.toLowerCase();
  let srcIdx = lower.indexOf('src="data:');
  let quote: '"' | "'" = '"';
  if (srcIdx < 0) {
    srcIdx = lower.indexOf("src='data:");
    quote = "'";
  }
  if (srcIdx < 0) return null;

  const afterData = srcIdx + (quote === '"' ? 'src="data:'.length : "src='data:".length);
  const base64Marker = ';base64,';
  const markerIdx = lower.indexOf(base64Marker, afterData);
  if (markerIdx < 0) return null;

  const mime = tag.slice(afterData, markerIdx).trim();
  const b64Start = markerIdx + base64Marker.length;
  const closeIdx = tag.indexOf(quote, b64Start);
  if (closeIdx < 0) return null;

  const b64 = tag.slice(b64Start, closeIdx);
  if (b64.length > MAX_INLINE_B64_PARSE_CHARS) return null;

  const fullMatch = tag.slice(srcIdx, closeIdx + 1);
  return { mime, b64, fullMatch };
}

function writeInlineAttachment(mime: string, b64: string): InlineImageAttachment {
  const cid = `inline-${randomUUID()}@simplecrm`;
  const ext = extensionForMime(mime);
  const filename = `inline.${ext}`;
  const tmpPath = path.join(inlineTempRoot(), `${cid}.${ext}`);
  fs.mkdirSync(path.dirname(tmpPath), { recursive: true });
  fs.writeFileSync(tmpPath, Buffer.from(b64, 'base64'));
  return { filename, path: tmpPath, cid };
}

/** Convert data: URLs in HTML to CID references + temp file attachments for nodemailer. */
export function extractInlineImagesFromHtml(html: string): {
  html: string;
  attachments: InlineImageAttachment[];
} {
  const attachments: InlineImageAttachment[] = [];
  let out = '';
  let pos = 0;
  const lower = html.toLowerCase();

  while (pos < html.length) {
    const imgStart = lower.indexOf('<img', pos);
    if (imgStart < 0) {
      out += html.slice(pos);
      break;
    }
    out += html.slice(pos, imgStart);
    const tagEnd = html.indexOf('>', imgStart);
    if (tagEnd < 0) {
      out += html.slice(imgStart);
      break;
    }
    const tag = html.slice(imgStart, tagEnd + 1);
    const parsed = parseDataUrlFromImgTag(tag);
    if (!parsed) {
      out += tag;
      pos = tagEnd + 1;
      continue;
    }

    const estimatedBytes = Math.floor((parsed.b64.length * 3) / 4);
    if (estimatedBytes > MAX_INLINE_IMAGE_BYTES) {
      console.warn(
        `[email] inline image skipped (>${MAX_INLINE_IMAGE_BYTES} bytes estimated): ${parsed.mime}`,
      );
      out += tag;
      pos = tagEnd + 1;
      continue;
    }

    try {
      const att = writeInlineAttachment(parsed.mime, parsed.b64);
      attachments.push(att);
      const replacement = `src="cid:${att.cid}"`;
      const newTag = tag.replace(parsed.fullMatch, replacement);
      out += newTag;
    } catch (e) {
      console.warn('[email] inline image decode failed', e);
      out += tag;
    }
    pos = tagEnd + 1;
  }

  return { html: out, attachments };
}
