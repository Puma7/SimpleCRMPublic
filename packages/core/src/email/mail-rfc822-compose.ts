import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export type ComposeRfc822Attachment = {
  filename: string;
  path?: string;
  content?: Buffer | Uint8Array;
  cid?: string;
  contentType?: string;
};

export function encodeRfc2047(text: string): string {
  const sanitized = sanitizeHeaderValue(text);
  if (/^[\x20-\x7E]*$/.test(sanitized)) return sanitized;
  const buf = Buffer.from(sanitized, 'utf-8');
  const chunk = 45;
  const parts: string[] = [];
  let offset = 0;
  while (offset < buf.length) {
    let end = Math.min(offset + chunk, buf.length);
    while (end < buf.length && end > offset && (buf[end]! & 0xC0) === 0x80) {
      end -= 1;
    }
    if (end === offset) end = Math.min(offset + chunk, buf.length);
    parts.push(`=?UTF-8?B?${buf.subarray(offset, end).toString('base64')}?=`);
    offset = end;
  }
  return parts.join('\r\n ');
}

/** Encode display names in mailbox lists (From/To/Cc) for SMTP and Sent-folder append. */
export function encodeMailboxListHeader(value: string): string {
  const trimmed = sanitizeHeaderValue(value);
  if (!trimmed) return trimmed;
  return splitMailboxList(trimmed).map(encodeSingleMailbox).join(', ');
}

/** Rough upper bound for RFC822 size (base64 overhead on attachments + headers). */
export function estimateComposeRfc822Bytes(input: {
  text?: string;
  html?: string;
  attachments?: ComposeRfc822Attachment[];
}): number {
  let bytes = 12_000;
  bytes += Buffer.byteLength(input.text ?? '', 'utf8');
  bytes += Buffer.byteLength(input.html ?? '', 'utf8');
  for (const att of input.attachments ?? []) {
    if (att.content) {
      bytes += Math.ceil((att.content.byteLength * 4) / 3) + 600;
    } else if (att.path) {
      try {
        const st = fs.statSync(att.path);
        if (st.isFile()) {
          bytes += Math.ceil((st.size * 4) / 3) + 600;
        }
      } catch {
        /* unreadable path: caller validation should surface this */
      }
    }
  }
  return bytes;
}

/** Build a complete RFC822 message buffer matching SMTP DATA / Sent-folder payloads. */
export function buildComposeRfc822(input: {
  from: string;
  to: string;
  cc?: string;
  bcc?: string;
  replyTo?: string;
  subject: string;
  text?: string;
  html?: string;
  messageId?: string;
  inReplyTo?: string;
  references?: string;
  attachments?: ComposeRfc822Attachment[];
  requestReadReceipt?: boolean;
  /** Extra raw header lines (already "Name: value"), e.g. Auto-Submitted. */
  extraHeaders?: readonly string[];
  date?: Date;
}): Buffer {
  const headerLines: string[] = [];
  headerLines.push(`From: ${encodeMailboxListHeader(input.from)}`);
  headerLines.push(`To: ${encodeMailboxListHeader(input.to)}`);
  if (input.cc?.trim()) headerLines.push(`Cc: ${encodeMailboxListHeader(input.cc.trim())}`);
  if (input.bcc?.trim()) headerLines.push(`Bcc: ${encodeMailboxListHeader(input.bcc.trim())}`);
  if (input.replyTo?.trim()) headerLines.push(`Reply-To: ${encodeMailboxListHeader(input.replyTo.trim())}`);
  headerLines.push(`Subject: ${encodeRfc2047(input.subject)}`);
  if (input.messageId) headerLines.push(`Message-ID: ${sanitizeHeaderValue(input.messageId)}`);
  if (input.inReplyTo) headerLines.push(`In-Reply-To: ${sanitizeHeaderValue(input.inReplyTo)}`);
  if (input.references) headerLines.push(`References: ${sanitizeHeaderValue(input.references)}`);
  if (input.requestReadReceipt) {
    headerLines.push(`Disposition-Notification-To: ${encodeMailboxListHeader(input.from)}`);
  }
  for (const header of input.extraHeaders ?? []) {
    const clean = sanitizeHeaderValue(header);
    if (clean) headerLines.push(clean);
  }
  headerLines.push('MIME-Version: 1.0');
  headerLines.push(`Date: ${(input.date ?? new Date()).toUTCString()}`);

  const fileAttachments = (input.attachments ?? []).filter((att) => {
    if (att.content) return true;
    if (!att.path) return false;
    try {
      return fs.statSync(att.path).isFile();
    } catch {
      return false;
    }
  });
  const inlineAttachments = fileAttachments.filter((a) => a.cid);
  const regularAttachments = fileAttachments.filter((a) => !a.cid);

  const bodyParts: string[] = [];
  const altBoundary = boundary('alt');

  if (input.html?.trim()) {
    bodyParts.push(`--${altBoundary}`);
    bodyParts.push('Content-Type: text/plain; charset=utf-8');
    bodyParts.push('Content-Transfer-Encoding: 8bit');
    bodyParts.push('');
    bodyParts.push(input.text ?? '');
    bodyParts.push(`--${altBoundary}`);
    bodyParts.push('Content-Type: text/html; charset=utf-8');
    bodyParts.push('Content-Transfer-Encoding: 8bit');
    bodyParts.push('');
    bodyParts.push(input.html);
    bodyParts.push(`--${altBoundary}--`);
  } else {
    bodyParts.push('Content-Type: text/plain; charset=utf-8');
    bodyParts.push('Content-Transfer-Encoding: 8bit');
    bodyParts.push('');
    bodyParts.push(input.text ?? '');
  }

  const bodyCore = input.html?.trim()
    ? [`Content-Type: multipart/alternative; boundary="${altBoundary}"`, '', ...bodyParts]
    : bodyParts;

  const appendAttachmentPart = (lines: string[], partBoundary: string, att: ComposeRfc822Attachment): void => {
    const buf = attachmentContent(att);
    if (!buf) return;
    const filename = sanitizeFilename(att.filename || (att.path ? path.basename(att.path) : 'attachment'));
    const contentType = guessContentType(filename, att.contentType);
    lines.push(`--${partBoundary}`);
    lines.push(`Content-Type: ${contentType}; ${contentTypeNameParam(filename)}`);
    lines.push('Content-Transfer-Encoding: base64');
    if (att.cid) {
      lines.push(`Content-Disposition: inline; ${contentDispositionFilenameParam(filename)}`);
      lines.push(`Content-ID: <${sanitizeHeaderValue(att.cid)}>`);
    } else {
      lines.push(`Content-Disposition: attachment; ${contentDispositionFilenameParam(filename)}`);
    }
    lines.push('');
    lines.push(encodeBase64Lines(buf));
  };

  if (inlineAttachments.length === 0 && regularAttachments.length === 0) {
    headerLines.push(...bodyCore, '');
    return Buffer.from(headerLines.join('\r\n'), 'utf-8');
  }

  let bodyPayload: string[];
  if (inlineAttachments.length > 0) {
    const relBoundary = boundary('rel');
    bodyPayload = [
      `Content-Type: multipart/related; boundary="${relBoundary}"`,
      '',
      `--${relBoundary}`,
      ...bodyCore,
    ];
    for (const att of inlineAttachments) {
      appendAttachmentPart(bodyPayload, relBoundary, att);
    }
    bodyPayload.push(`--${relBoundary}--`);
  } else {
    bodyPayload = bodyCore;
  }

  if (regularAttachments.length === 0) {
    headerLines.push(...bodyPayload, '');
    return Buffer.from(headerLines.join('\r\n'), 'utf-8');
  }

  const mixedBoundary = boundary('mix');
  headerLines.push(`Content-Type: multipart/mixed; boundary="${mixedBoundary}"`);
  headerLines.push('');
  headerLines.push(`--${mixedBoundary}`);
  headerLines.push(...bodyPayload);
  for (const att of regularAttachments) {
    appendAttachmentPart(headerLines, mixedBoundary, att);
  }
  headerLines.push(`--${mixedBoundary}--`, '');

  return Buffer.from(headerLines.join('\r\n'), 'utf-8');
}

function attachmentContent(att: ComposeRfc822Attachment): Buffer | null {
  if (att.content) return Buffer.isBuffer(att.content) ? att.content : Buffer.from(att.content);
  if (!att.path) return null;
  return fs.readFileSync(att.path);
}

function boundary(prefix: string): string {
  return `${prefix}_${randomBytes(12).toString('hex')}`;
}

function sanitizeHeaderValue(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim();
}

function splitMailboxList(value: string): string[] {
  const parts: string[] = [];
  let current = '';
  let inQuotes = false;
  let angleDepth = 0;

  const flushIfComplete = (): void => {
    const trimmed = current.trim();
    if (!trimmed) {
      current = '';
      return;
    }
    if (isCompleteMailboxToken(trimmed)) {
      parts.push(trimmed);
      current = '';
    }
  };

  // RFC 5322 quoted-pair: a backslash escapes the next character, but ONLY inside
  // a quoted-string. Tracking this explicitly (rather than peeking at value[i-1])
  // is what makes `\\"` close the quote — the backslash is itself escaped, so the
  // quote is real. The old `value[i-1] !== '\\'` heuristic mis-read that and could
  // leave inQuotes stuck on, swallowing the next mailbox in the list.
  let escaped = false;
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i]!;
    if (escaped) {
      escaped = false;
      current += ch;
      continue;
    }
    if (inQuotes && ch === '\\') {
      escaped = true;
      current += ch;
      continue;
    }
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (!inQuotes) {
      if (ch === '<') angleDepth += 1;
      else if (ch === '>' && angleDepth > 0) angleDepth -= 1;
    }
    if (ch === ',' && !inQuotes && angleDepth === 0) {
      flushIfComplete();
      if (current) current += ch;
      continue;
    }
    current += ch;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function isCompleteMailboxToken(value: string): boolean {
  const angleMatch = /<([^>]+)>\s*$/.exec(value);
  if (angleMatch?.[1]) return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(angleMatch[1].trim());
  return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value.trim());
}

function encodeSingleMailbox(mailbox: string): string {
  const match = /^(?:"([^"]*)"|([^<]*?))\s*<([^>]+)>$/.exec(mailbox);
  if (!match) {
    // The clean "phrase <addr>" parse failed — the usual cause is a display name
    // that itself contains angle brackets, e.g. `Attacker <evil@x> <ceo@ok>`, a
    // trick to smuggle a SECOND addr-spec into the header so an MUA renders the
    // fake address (the relay's one-address spoof check treats the bracketed
    // text as a display name and passes). Bind to the FINAL <addr> (the address
    // our caller appended) and force-quote everything before it, so it can only
    // ever be an (inert) display name — never a second address.
    const lastAngle = /^(.*)<([^<>]+)>\s*$/.exec(mailbox);
    if (lastAngle && lastAngle[2]) {
      const phrase = lastAngle[1]!.trim();
      const email = lastAngle[2].trim();
      if (!phrase) return `<${email}>`;
      const encodedPhrase = encodeRfc2047(phrase);
      return encodedPhrase === phrase
        ? `"${phrase.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}" <${email}>`
        : `${encodedPhrase} <${email}>`;
    }
    return mailbox;
  }
  const rawName = (match[1] ?? match[2] ?? '').trim();
  const email = match[3]!.trim();
  if (!rawName) return `<${email}>`;
  const encoded = encodeRfc2047(rawName);
  if (encoded === rawName) {
    // Pure-ASCII display name. RFC 5322 lets it appear unquoted only if every
    // character is "atext" (or a separating space). Anything else — @ . , ; :
    // < > ( ) [ ] \ " etc. — must be a quoted-string, or strict relays (IONOS,
    // …) reject the whole From header as syntactically invalid. A display name
    // that equals the e-mail address (contains '@') is the common trigger.
    return displayNameIsAtomSafe(rawName)
      ? `${rawName} <${email}>`
      : `"${rawName.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}" <${email}>`;
  }
  return `${encoded} <${email}>`;
}

/**
 * True when a pure-ASCII display name may appear unquoted in an RFC 5322
 * mailbox (a phrase of space-separated atoms). atext is ALPHA / DIGIT plus
 * ! # $ % & ' * + - / = ? ^ _ ` { | } ~ ; everything else needs quoting.
 */
function displayNameIsAtomSafe(name: string): boolean {
  return /^[A-Za-z0-9 !#$%&'*+/=?^_`{|}~-]+$/.test(name);
}

function sanitizeFilename(filename: string): string {
  return filename.replace(/[\r\n"/\\]+/g, '_').trim() || 'attachment';
}

function contentTypeNameParam(filename: string): string {
  return /^[\x20-\x7E]*$/.test(filename)
    ? `name="${filename}"`
    : `name*=UTF-8''${encodeURIComponent(filename)}`;
}

/** RFC 2231 / 5987 style filename for non-ASCII attachment names. */
function contentDispositionFilenameParam(filename: string): string {
  if (/^[\x20-\x7E]*$/.test(filename)) {
    return `filename="${filename}"`;
  }
  const asciiFallback = filename.replace(/[^\x20-\x7E]/g, '_') || 'attachment';
  return `filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

function guessContentType(filename: string, explicit?: string): string {
  if (explicit?.trim()) return sanitizeHeaderValue(explicit);
  const ext = path.extname(filename).toLowerCase();
  const map: Record<string, string> = {
    '.pdf': 'application/pdf',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.txt': 'text/plain; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.htm': 'text/html; charset=utf-8',
    '.json': 'application/json',
    '.zip': 'application/zip',
  };
  return map[ext] ?? 'application/octet-stream';
}

function encodeBase64Lines(buf: Buffer): string {
  const b64 = buf.toString('base64');
  const lines: string[] = [];
  for (let i = 0; i < b64.length; i += 76) {
    lines.push(b64.slice(i, i + 76));
  }
  return lines.join('\r\n');
}
