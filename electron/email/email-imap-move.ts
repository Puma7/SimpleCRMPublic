import { ImapFlow } from 'imapflow';
import { getSyncInfo, setSyncInfo } from '../sqlite-service';
import {
  getEmailAccountById,
  getEmailMessageById,
  getFolderById,
  type EmailMessageRow,
} from './email-store';
import { resolveImapAuth } from './email-imap-auth';

const DELETE_OPT_IN_KEY = 'workflow_imap_delete_opt_in';

export function isImapDeleteOptInEnabled(): boolean {
  const v = (getSyncInfo(DELETE_OPT_IN_KEY) ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

export function setImapDeleteOptIn(enabled: boolean): void {
  setSyncInfo(DELETE_OPT_IN_KEY, enabled ? 'true' : 'false');
}

export async function moveImapMessage(
  message: Pick<EmailMessageRow, 'id' | 'account_id' | 'folder_id' | 'uid' | 'pop3_uidl'>,
  targetFolderPath: string,
): Promise<void> {
  if (message.uid < 0 || message.pop3_uidl) {
    throw new Error('POP3- oder Entwurfs-Nachrichten können nicht per IMAP verschoben werden');
  }
  const target = targetFolderPath.trim();
  if (!target) throw new Error('Zielordner fehlt');

  const account = getEmailAccountById(message.account_id);
  if (!account || (account.protocol || 'imap') !== 'imap') {
    throw new Error('Nur IMAP-Nachrichten können verschoben werden');
  }
  const sourceFolder = getFolderById(message.folder_id);
  if (!sourceFolder?.path) throw new Error('Quellordner unbekannt');

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

  await client.connect();
  try {
    const lock = await client.getMailboxLock(sourceFolder.path);
    try {
      await client.messageMove({ uid: message.uid }, target, { uid: true });
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

export async function deleteImapMessageOnServer(
  message: Pick<EmailMessageRow, 'account_id' | 'folder_id' | 'uid' | 'pop3_uidl'>,
): Promise<void> {
  if (!isImapDeleteOptInEnabled()) {
    throw new Error('Server-Löschung nicht aktiviert (workflow_imap_delete_opt_in)');
  }
  if (message.uid < 0 || message.pop3_uidl) {
    throw new Error('POP3-/Entwurfs-Nachrichten können nicht auf dem Server gelöscht werden');
  }
  const account = getEmailAccountById(message.account_id);
  if (!account || (account.protocol || 'imap') !== 'imap') {
    throw new Error('Nur IMAP-Nachrichten');
  }
  const sourceFolder = getFolderById(message.folder_id);
  if (!sourceFolder?.path) throw new Error('Quellordner unbekannt');

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

  await client.connect();
  try {
    const lock = await client.getMailboxLock(sourceFolder.path);
    try {
      await client.messageDelete({ uid: message.uid }, { uid: true });
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

export async function moveMessageToImapFolder(messageId: number, targetFolderPath: string): Promise<void> {
  const row = getEmailMessageById(messageId);
  if (!row) throw new Error('Nachricht nicht gefunden');
  await moveImapMessage(row, targetFolderPath);
}
