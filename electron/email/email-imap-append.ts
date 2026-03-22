import { ImapFlow } from 'imapflow';
import { resolveImapAuth } from './email-imap-auth';
import { getEmailAccountById } from './email-store';

function encodeRfc2047(text: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x20-\x7E]*$/.test(text)) return text;
  // RFC 2047: each encoded-word must be ≤75 chars.
  // `=?UTF-8?B?...?=` overhead is 12 chars, leaving 63 chars for Base64 payload.
  // 63 Base64 chars encode 47 bytes (floor(63*3/4)=47), but we must split on
  // valid UTF-8 boundaries, so use conservative 45-byte chunks.
  const buf = Buffer.from(text, 'utf-8');
  const CHUNK = 45;
  if (buf.length <= CHUNK) {
    return `=?UTF-8?B?${buf.toString('base64')}?=`;
  }
  const parts: string[] = [];
  let offset = 0;
  while (offset < buf.length) {
    let end = Math.min(offset + CHUNK, buf.length);
    // Avoid splitting in the middle of a multi-byte UTF-8 character.
    // UTF-8 continuation bytes start with 0b10xxxxxx (0x80-0xBF).
    while (end < buf.length && end > offset && (buf[end]! & 0xC0) === 0x80) {
      end--;
    }
    if (end === offset) end = Math.min(offset + CHUNK, buf.length);
    const chunk = buf.subarray(offset, end);
    parts.push(`=?UTF-8?B?${chunk.toString('base64')}?=`);
    offset = end;
  }
  return parts.join('\r\n ');
}

function buildRfc822(input: {
  from: string;
  to: string;
  cc?: string;
  subject: string;
  text?: string;
  html?: string;
}): Buffer {
  const lines: string[] = [];
  lines.push(`From: ${input.from}`);
  lines.push(`To: ${input.to}`);
  if (input.cc?.trim()) lines.push(`Cc: ${input.cc.trim()}`);
  lines.push(`Subject: ${encodeRfc2047(input.subject)}`);
  lines.push('MIME-Version: 1.0');
  if (input.html?.trim()) {
    const boundary = `b_${Math.random().toString(36).slice(2)}`;
    lines.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
    lines.push('');
    lines.push(`--${boundary}`);
    lines.push('Content-Type: text/plain; charset=utf-8');
    lines.push('');
    lines.push(input.text ?? '');
    lines.push(`--${boundary}`);
    lines.push('Content-Type: text/html; charset=utf-8');
    lines.push('');
    lines.push(input.html!);
    lines.push(`--${boundary}--`);
  } else {
    lines.push('Content-Type: text/plain; charset=utf-8');
    lines.push('');
    lines.push(input.text ?? '');
  }
  return Buffer.from(lines.join('\r\n'), 'utf-8');
}

export async function appendSentToImap(input: {
  accountId: number;
  from: string;
  to: string;
  cc?: string;
  subject: string;
  text?: string;
  html?: string;
}): Promise<void> {
  const acc = getEmailAccountById(input.accountId);
  if (!acc || (acc.protocol || 'imap') !== 'imap') return;

  const folder = (acc.sent_folder_path || 'Sent').trim() || 'Sent';
  const auth = await resolveImapAuth(acc);
  const client = new ImapFlow({
    host: acc.imap_host,
    port: acc.imap_port,
    secure: Boolean(acc.imap_tls),
    auth:
      'accessToken' in auth
        ? { user: auth.user, accessToken: auth.accessToken }
        : { user: auth.user, pass: auth.pass },
    logger: false,
    connectionTimeout: 90_000,
    socketTimeout: 120_000,
  });

  const source = buildRfc822(input);
  try {
    await client.connect();
    let appendMailbox = folder;
    try {
      await client.mailboxOpen(folder);
    } catch {
      appendMailbox = 'INBOX.Sent';
      await client.mailboxOpen(appendMailbox);
    }
    await client.append(appendMailbox, source, ['\\Seen']);
  } finally {
    await client.logout().catch(() => undefined);
  }
}
