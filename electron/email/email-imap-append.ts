import { ImapFlow, type ListResponse } from 'imapflow';
import { resolveImapAuth } from './email-imap-auth';
import { getEmailAccountById } from './email-store';
import { buildComposeRfc822, type ComposeRfc822Attachment } from './mail-rfc822-compose';

export type MailboxListEntry = Pick<ListResponse, 'path' | 'name' | 'delimiter' | 'specialUse' | 'flags'>;

const SENT_MAILBOX_NAMES = new Set(
  [
    'sent',
    'sent items',
    'sent mail',
    'sent messages',
    'gesendet',
    'gesendete objekte',
    'gesendete elemente',
    'gesendete nachrichten',
  ].map(normalizeMailboxName),
);

function normalizeMailboxName(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function mailboxHasSentSpecialUse(entry: MailboxListEntry): boolean {
  if (entry.specialUse?.toLowerCase() === '\\sent') return true;
  return entry.flags?.has?.('\\Sent') || entry.flags?.has?.('\\sent') || false;
}

function isSentLikeMailboxName(value: string | undefined): boolean {
  if (!value) return false;
  return SENT_MAILBOX_NAMES.has(normalizeMailboxName(value));
}

function pathLeaf(pathValue: string, delimiter: string | undefined): string {
  const delimiters = [delimiter, '/', '.'].filter(Boolean) as string[];
  let leaf = pathValue;
  for (const d of delimiters) {
    const idx = leaf.lastIndexOf(d);
    if (idx >= 0) {
      leaf = leaf.slice(idx + d.length);
    }
  }
  return leaf;
}

function pushUnique(target: string[], seen: Set<string>, value: string | undefined): void {
  const trimmed = value?.trim();
  if (!trimmed) return;
  const key = trimmed.toLowerCase();
  if (seen.has(key)) return;
  seen.add(key);
  target.push(trimmed);
}

export function resolveSentMailboxCandidates(
  configuredFolder: string,
  listedMailboxes: MailboxListEntry[] = [],
): string[] {
  const candidates: string[] = [];
  const seen = new Set<string>();
  const configured = configuredFolder.trim() || 'Sent';
  pushUnique(candidates, seen, configured);

  for (const entry of listedMailboxes) {
    if (mailboxHasSentSpecialUse(entry)) {
      pushUnique(candidates, seen, entry.path);
    }
  }

  for (const entry of listedMailboxes) {
    if (
      isSentLikeMailboxName(entry.name) ||
      isSentLikeMailboxName(pathLeaf(entry.path, entry.delimiter))
    ) {
      pushUnique(candidates, seen, entry.path);
    }
  }

  const delimiters = new Set<string>(['.', '/']);
  for (const entry of listedMailboxes) {
    if (entry.delimiter) delimiters.add(entry.delimiter);
  }

  for (const folder of ['Sent', 'Sent Items', 'Sent Mail', 'Gesendet', 'Gesendete Objekte']) {
    pushUnique(candidates, seen, folder);
    for (const delimiter of delimiters) {
      pushUnique(candidates, seen, `INBOX${delimiter}${folder}`);
    }
  }

  return candidates;
}

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
