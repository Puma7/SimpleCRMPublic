import { ImapFlow } from 'imapflow';
import { resolveImapAuth } from './email-imap-auth';
import { getEmailAccountById } from './email-store';

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
  lines.push(`Subject: ${input.subject}`);
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
