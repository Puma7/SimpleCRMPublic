import { createRequire } from 'module';
import { simpleParser } from 'mailparser';

const requireCjs = createRequire(__filename);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Pop3Command = requireCjs('node-pop3') as typeof import('node-pop3').default;
import { EMAIL_MESSAGES_TABLE } from '../database-schema';
import { getDb } from '../sqlite-service';
import { getEmailPassword } from './email-keytar';
import {
  getEmailAccountById,
  getFolderByAccountAndPath,
  upsertEmailFolder,
  updateFolderSyncState,
  insertOrUpdateEmailMessage,
  type EmailAccountRow,
} from './email-store';
import { withEmailAccountSyncLock } from './email-sync-mutex';
import { addressJson, formatDate, parseAttachmentsMeta, snippetFromParsed } from './email-parse-utils';

const POP_FOLDER = 'INBOX';

type UidlEntry = [string, string];

export type Pop3SyncResult = { fetched: number; folderId: number };

async function syncInboxPop3Internal(accountId: number): Promise<Pop3SyncResult> {
  const account = getEmailAccountById(accountId);
  if (!account) throw new Error('Unbekanntes E-Mail-Konto');
  if ((account.protocol || 'imap') !== 'pop3') {
    throw new Error('Konto ist kein POP3-Konto');
  }

  const password = await getEmailPassword(account.keytar_account_key);
  if (!password) throw new Error('Kein gespeichertes Passwort für dieses Konto');

  const host = (account.pop3_host || account.imap_host).trim();
  const port = account.pop3_port ?? 995;
  const tls = (account.pop3_tls ?? 1) === 1;

  const pop3 = new Pop3Command({
    user: account.imap_username,
    password,
    host,
    port,
    tls,
    timeout: 90_000,
  });

  let folderRow = getFolderByAccountAndPath(accountId, POP_FOLDER);
  if (!folderRow) {
    folderRow = upsertEmailFolder({ accountId, path: POP_FOLDER, lastUid: 0 });
  }

  let known = new Set<string>();
  try {
    const prev = folderRow.pop3_uidl_str;
    if (prev) {
      const parsed = JSON.parse(prev) as string[];
      if (Array.isArray(parsed)) known = new Set(parsed);
    }
  } catch {
    known = new Set();
  }

  const uidlRaw = (await pop3.UIDL()) as unknown;
  const list: UidlEntry[] = Array.isArray(uidlRaw) ? (uidlRaw as UidlEntry[]) : [];
  let fetched = 0;
  let maxNum = folderRow.last_uid;

  for (const [numStr, uidl] of list) {
    const num = parseInt(numStr, 10);
    if (!uidl || Number.isNaN(num)) continue;
    if (known.has(uidl)) {
      maxNum = Math.max(maxNum, num);
      continue;
    }

    const raw = await pop3.RETR(num);
    const parsed = await simpleParser(typeof raw === 'string' ? Buffer.from(raw) : Buffer.from(raw as Buffer));
    const messageId = parsed.messageId ?? null;
    const inReplyTo = parsed.inReplyTo ?? null;
    const refs = parsed.references
      ? Array.isArray(parsed.references)
        ? parsed.references.join(' ')
        : String(parsed.references)
      : null;
    const textBody = parsed.text?.trim() || null;
    const htmlBody = typeof parsed.html === 'string' ? parsed.html : null;
    const snippet = snippetFromParsed(textBody, htmlBody);
    const { hasAttachments, json: attachmentsJson } = parseAttachmentsMeta(parsed);

    const { id: localMsgId, isNew } = insertOrUpdateEmailMessage({
      accountId,
      folderId: folderRow.id,
      uid: 0,
      pop3Uidl: uidl,
      messageId,
      inReplyTo,
      referencesHeader: refs,
      subject: parsed.subject ?? null,
      fromJson: addressJson(parsed.from),
      toJson: addressJson(parsed.to),
      ccJson: addressJson(parsed.cc),
      dateReceived: formatDate(parsed.date),
      snippet,
      bodyText: textBody,
      bodyHtml: htmlBody,
      seenLocal: false,
      hasAttachments,
      attachmentsJson,
    });

    if (isNew && localMsgId > 0) {
      const { persistParsedAttachments } = await import('./email-message-attachments-store');
      await persistParsedAttachments(localMsgId, parsed.attachments);
      const { assignJwzThreadAndTicket } = await import('./email-threading-jwz');
      assignJwzThreadAndTicket(localMsgId, accountId, {
        messageIdHeader: messageId,
        inReplyTo,
        referencesHeader: refs,
        subject: parsed.subject ?? null,
      });
      const { tryLinkMessageToCustomer } = await import('./email-crm-store');
      tryLinkMessageToCustomer(localMsgId);
      const { runInboundWorkflowsForMessage } = await import('./email-workflow-engine');
      await runInboundWorkflowsForMessage(localMsgId);
    }

    known.add(uidl);
    maxNum = Math.max(maxNum, num);
    fetched += 1;
  }

  await pop3.QUIT().catch(() => undefined);

  const uidlArr = [...known].sort();
  const uidlStr = JSON.stringify(uidlArr);

  updateFolderSyncState(folderRow.id, {
    lastUid: maxNum,
    pop3UidlStr: uidlStr,
  });

  return { fetched, folderId: folderRow.id };
}

export function syncInboxPop3(accountId: number): Promise<Pop3SyncResult> {
  return withEmailAccountSyncLock(accountId, () => syncInboxPop3Internal(accountId));
}

export async function testPop3Connection(account: EmailAccountRow, password: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const host = (account.pop3_host || account.imap_host).trim();
  const port = account.pop3_port ?? 995;
  const tls = (account.pop3_tls ?? 1) === 1;
  const pop3 = new Pop3Command({
    user: account.imap_username,
    password,
    host,
    port,
    tls,
    timeout: 90_000,
  });
  try {
    await pop3.UIDL();
    await pop3.QUIT();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
