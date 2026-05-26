import fs from 'fs';
import path from 'path';

export type ComposeRfc822Attachment = {
  filename: string;
  path: string;
  cid?: string;
  contentType?: string;
};

export function encodeRfc2047(text: string): string {
  if (/^[\x20-\x7E]*$/.test(text)) return text;
  const buf = Buffer.from(text, 'utf-8');
  const CHUNK = 45;
  if (buf.length <= CHUNK) {
    return `=?UTF-8?B?${buf.toString('base64')}?=`;
  }
  const parts: string[] = [];
  let offset = 0;
  while (offset < buf.length) {
    let end = Math.min(offset + CHUNK, buf.length);
    while (end < buf.length && end > offset && (buf[end]! & 0xC0) === 0x80) {
      end--;
    }
    if (end === offset) end = Math.min(offset + CHUNK, buf.length);
    parts.push(`=?UTF-8?B?${buf.subarray(offset, end).toString('base64')}?=`);
    offset = end;
  }
  return parts.join('\r\n ');
}

/** Encode display names in mailbox lists (From/To/Cc) for non-ASCII Sent-folder append. */
export function encodeMailboxListHeader(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  const parts: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i]!;
    if (ch === '"') inQuotes = !inQuotes;
    if (ch === ',' && !inQuotes) {
      parts.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) parts.push(current.trim());
  return parts.map(encodeSingleMailbox).join(', ');
}

function encodeSingleMailbox(mailbox: string): string {
  const m = mailbox.match(/^(?:"([^"]*)"|([^<]*?))\s*<([^>]+)>$/);
  if (!m) return mailbox;
  const rawName = (m[1] ?? m[2] ?? '').trim();
  const email = m[3]!.trim();
  if (!rawName) return `<${email}>`;
  const encoded = encodeRfc2047(rawName);
  if (encoded === rawName) {
    return /[,;"]/.test(rawName) ? `"${rawName}" <${email}>` : `${rawName} <${email}>`;
  }
  return `${encoded} <${email}>`;
}

function guessContentType(filename: string, explicit?: string): string {
  if (explicit?.trim()) return explicit.trim();
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

/** Build a complete RFC822 message buffer for Sent-folder append (matches SMTP parts). */
export function buildComposeRfc822(input: {
  from: string;
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  text?: string;
  html?: string;
  messageId?: string;
  inReplyTo?: string;
  references?: string;
  attachments?: ComposeRfc822Attachment[];
}): Buffer {
  const headerLines: string[] = [];
  headerLines.push(`From: ${encodeMailboxListHeader(input.from)}`);
  headerLines.push(`To: ${encodeMailboxListHeader(input.to)}`);
  if (input.cc?.trim()) headerLines.push(`Cc: ${encodeMailboxListHeader(input.cc.trim())}`);
  if (input.bcc?.trim()) headerLines.push(`Bcc: ${encodeMailboxListHeader(input.bcc.trim())}`);
  headerLines.push(`Subject: ${encodeRfc2047(input.subject)}`);
  if (input.messageId) headerLines.push(`Message-ID: ${input.messageId}`);
  if (input.inReplyTo) headerLines.push(`In-Reply-To: ${input.inReplyTo}`);
  if (input.references) headerLines.push(`References: ${input.references}`);
  headerLines.push('MIME-Version: 1.0');
  headerLines.push(`Date: ${new Date().toUTCString()}`);

  const fileAttachments = (input.attachments ?? []).filter((a) => {
    try {
      return fs.existsSync(a.path) && fs.statSync(a.path).isFile();
    } catch {
      return false;
    }
  });

  const bodyParts: string[] = [];
  const altBoundary = `alt_${Math.random().toString(36).slice(2)}`;

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

  if (fileAttachments.length === 0) {
    headerLines.push(...bodyCore);
    return Buffer.from(headerLines.join('\r\n'), 'utf-8');
  }

  const mixedBoundary = `mix_${Math.random().toString(36).slice(2)}`;
  headerLines.push(`Content-Type: multipart/mixed; boundary="${mixedBoundary}"`);
  headerLines.push('');
  headerLines.push(`--${mixedBoundary}`);
  headerLines.push(...bodyCore);
  for (const att of fileAttachments) {
    const buf = fs.readFileSync(att.path);
    const filename = att.filename || path.basename(att.path);
    const ctype = guessContentType(filename, att.contentType);
    headerLines.push(`--${mixedBoundary}`);
    headerLines.push(`Content-Type: ${ctype}; name="${filename}"`);
    headerLines.push('Content-Transfer-Encoding: base64');
    if (att.cid) {
      headerLines.push(`Content-Disposition: inline; filename="${filename}"`);
      headerLines.push(`Content-ID: <${att.cid}>`);
    } else {
      headerLines.push(`Content-Disposition: attachment; filename="${filename}"`);
    }
    headerLines.push('');
    headerLines.push(encodeBase64Lines(buf));
  }
  headerLines.push(`--${mixedBoundary}--`);

  return Buffer.from(headerLines.join('\r\n'), 'utf-8');
}
