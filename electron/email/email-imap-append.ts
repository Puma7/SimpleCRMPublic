import { ImapFlow } from 'imapflow';
import { resolveImapAuth } from './email-imap-auth';
import { getEmailAccountById } from './email-store';
import { buildComposeRfc822, type ComposeRfc822Attachment } from './mail-rfc822-compose';

export async function appendSentToImap(input: {
  accountId: number;
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

  const source = buildComposeRfc822(input);
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
