import { ImapFlow } from 'imapflow';
import { getEmailAccountById, getFolderById, type EmailMessageRow } from './email-store';
import { resolveImapAuth } from './email-imap-auth';

/**
 * Set or clear \\Seen on the IMAP server for a synced message (best-effort).
 */
export async function syncSeenFlagToServer(
  message: Pick<EmailMessageRow, 'account_id' | 'folder_id' | 'uid' | 'pop3_uidl'>,
  seen: boolean,
): Promise<void> {
  if (message.uid < 0 || message.pop3_uidl) return;
  const account = getEmailAccountById(message.account_id);
  if (!account || (account.protocol || 'imap') !== 'imap') return;

  const folder = getFolderById(message.folder_id);
  if (!folder?.path) return;

  const auth = await resolveImapAuth(account);
  const client = new ImapFlow({
    host: account.imap_host,
    port: account.imap_port,
    secure: Boolean(account.imap_tls),
    auth:
      'accessToken' in auth
        ? { user: auth.user, accessToken: auth.accessToken }
        : { user: auth.user, pass: auth.pass },
    logger: false,
    connectionTimeout: 60_000,
    socketTimeout: 90_000,
  });

  try {
    await client.connect();
    const lock = await client.getMailboxLock(folder.path);
    try {
      if (seen) {
        await client.messageFlagsAdd({ uid: message.uid }, ['\\Seen'], { uid: true });
      } else {
        await client.messageFlagsRemove({ uid: message.uid }, ['\\Seen'], { uid: true });
      }
    } finally {
      lock.release();
    }
  } finally {
    try {
      await client.logout();
    } catch {
      /* ignore */
    }
  }
}
