import { ImapFlow } from 'imapflow';
import {
  clearMessageSeenSyncPending,
  getEmailAccountById,
  getFolderById,
  setMessageSeenLocal,
  type EmailMessageRow,
} from './email-store';
import { resolveImapAuth } from './email-imap-auth';

export function accountWantsImapSeenSync(accountId: number): boolean {
  const acc = getEmailAccountById(accountId);
  return (
    acc != null &&
    (acc.protocol || 'imap') === 'imap' &&
    (acc.imap_sync_seen_on_open ?? 1) !== 0
  );
}

/**
 * Sets local seen state and protects unpushed changes from IMAP reconcile until
 * a best-effort server sync succeeds (mirrors IPC SetMessageSeen handler).
 */
export async function markMessageSeenWithOptionalServerSync(
  message: Pick<EmailMessageRow, 'id' | 'account_id' | 'folder_id' | 'uid' | 'pop3_uidl'>,
  seen: boolean,
): Promise<void> {
  const syncToServer = accountWantsImapSeenSync(message.account_id);
  setMessageSeenLocal(message.id, seen, syncToServer);
  if (!syncToServer) return;
  try {
    await syncSeenFlagToServer(message, seen);
    clearMessageSeenSyncPending(message.id);
  } catch {
    /* best-effort — seen_sync_pending keeps reconcile from overwriting */
  }
}

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
