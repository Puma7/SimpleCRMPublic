import { ImapFlow } from 'imapflow';
import { resolveImapAuth } from './email-imap-auth';
import { getEmailAccountById } from './email-store';
import { buildComposeRfc822, type ComposeRfc822Attachment } from './mail-rfc822-compose';
import {
  resolveSentMailboxCandidates,
  type MailboxListEntry,
} from './imap-mailbox-names';

export type { MailboxListEntry } from './imap-mailbox-names';
export { resolveSentMailboxCandidates } from './imap-mailbox-names';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function appendSentToImap(input: {
  accountId: number;
  from: string;
  to: string;
  cc?: string;
  bcc?: string;
  /** When false, Bcc is omitted from the RFC822 stored on the server (privacy on shared mailboxes). */
  includeBccInHeaders?: boolean;
  subject: string;
  text?: string;
  html?: string;
  messageId?: string;
  inReplyTo?: string;
  references?: string;
  attachments?: ComposeRfc822Attachment[];
  requestReadReceipt?: boolean;
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

  const source = buildComposeRfc822({
    ...input,
    bcc: input.includeBccInHeaders === false ? undefined : input.bcc,
  });
  try {
    await client.connect();
    let listedMailboxes: MailboxListEntry[] = [];
    try {
      listedMailboxes = await client.list();
    } catch {
      listedMailboxes = [];
    }
    const candidates = resolveSentMailboxCandidates(folder, listedMailboxes);
    const failures: string[] = [];
    for (const appendMailbox of candidates) {
      try {
        await client.mailboxOpen(appendMailbox);
        const appended = await client.append(appendMailbox, source, ['\\Seen']);
        if (appended === false) {
          throw new Error('IMAP APPEND wurde vom Server abgelehnt.');
        }
        return;
      } catch (error) {
        failures.push(`${appendMailbox}: ${errorMessage(error)}`);
      }
    }
    throw new Error(
      `Kein beschreibbarer IMAP-Gesendet-Ordner gefunden. Versucht: ${failures.join('; ')}`,
    );
  } finally {
    await client.logout().catch(() => undefined);
  }
}
