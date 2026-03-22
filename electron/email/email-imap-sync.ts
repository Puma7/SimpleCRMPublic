import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { EMAIL_MESSAGES_TABLE } from '../database-schema';
import { getDb } from '../sqlite-service';
import {
  getEmailAccountById,
  getFolderByAccountAndPath,
  upsertEmailFolder,
  updateFolderSyncState,
  insertOrUpdateEmailMessage,
  type EmailAccountRow,
} from './email-store';
import {
  serverUidValidityToString,
  storedUidValidityString,
  uidValidityMismatch,
  uidValidityAsOptionalNumber,
} from './email-uidvalidity';
import { resolveImapAuth } from './email-imap-auth';
import { withEmailAccountSyncLock } from './email-sync-mutex';

/** First sync: fetch up to this many newest messages (not entire mailbox). */
const FIRST_SYNC_MAX_MESSAGES = 2000;

function addressJson(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

function formatDate(d: Date | undefined): string | null {
  if (!d || Number.isNaN(d.getTime())) {
    return null;
  }
  return d.toISOString();
}

function snippetFromParsed(textBody: string | null, htmlBody: string | null): string | null {
  if (textBody?.trim()) {
    const t = textBody.trim();
    return t.length > 220 ? `${t.slice(0, 217)}...` : t;
  }
  if (htmlBody) {
    const capped = htmlBody.length > 8000 ? htmlBody.slice(0, 8000) : htmlBody;
    const plain = capped.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (!plain) return null;
    return plain.length > 220 ? `${plain.slice(0, 217)}...` : plain;
  }
  return null;
}

function parseAttachmentsMeta(parsed: {
  attachments?: { filename?: string; contentType?: string; size?: number }[];
}): { hasAttachments: boolean; json: string | null } {
  const att = parsed.attachments;
  if (!att || att.length === 0) return { hasAttachments: false, json: null };
  const meta = att.map((a) => ({
    filename: a.filename ?? null,
    contentType: a.contentType ?? null,
    size: a.size ?? null,
  }));
  return { hasAttachments: true, json: JSON.stringify(meta) };
}

export type ImapSyncResult = {
  fetched: number;
  folderId: number;
  lastUid: number;
};

async function syncInboxImapInternal(accountId: number): Promise<ImapSyncResult> {
  const account = getEmailAccountById(accountId);
  if (!account) {
    throw new Error('Unbekanntes E-Mail-Konto');
  }
  if ((account.protocol || 'imap') !== 'imap') {
    throw new Error('Konto ist kein IMAP-Konto (POP3 separat synchronisieren)');
  }

  const auth = await resolveImapAuth(account);
  const client = new ImapFlow({
    host: account.imap_host,
    port: account.imap_port,
    secure: Boolean(account.imap_tls),
    auth:
      'accessToken' in auth
        ? {
            user: auth.user,
            accessToken: auth.accessToken,
          }
        : {
            user: auth.user,
            pass: auth.pass,
          },
    logger: false,
  });

  const folderPath = 'INBOX';
  let folderRow = getFolderByAccountAndPath(accountId, folderPath);
  let lastUid = folderRow?.last_uid ?? 0;
  let fetched = 0;

  try {
    await client.connect();
    const lock = await client.getMailboxLock(folderPath);
    try {
      const status = await client.status(folderPath, { uidValidity: true, uidNext: true, messages: true });
      const uidValidityRaw = status.uidValidity;
      const uidValidityStr = serverUidValidityToString(uidValidityRaw ?? null);
      const uidValidityNum = uidValidityAsOptionalNumber(uidValidityRaw ?? null);

      const storedStr = folderRow ? storedUidValidityString(folderRow) : null;
      if (folderRow && uidValidityMismatch(storedStr, uidValidityStr)) {
        getDb().prepare(`DELETE FROM ${EMAIL_MESSAGES_TABLE} WHERE folder_id = ?`).run(folderRow.id);
        lastUid = 0;
      }

      folderRow = upsertEmailFolder({
        accountId,
        path: folderPath,
        delimiter: '/',
        uidvalidity: uidValidityNum ?? undefined,
        uidvalidityStr: uidValidityStr ?? undefined,
        lastUid,
      });

      let uids: number[];
      if (lastUid > 0) {
        const searchResult = await client.search({ uid: `${lastUid + 1}:*` }, { uid: true });
        uids = searchResult === false ? [] : searchResult;
      } else {
        const searchResult = await client.search({ all: true }, { uid: true });
        const allUids = searchResult === false ? [] : searchResult;
        const sorted = [...allUids].sort((a, b) => a - b);
        uids = sorted.slice(-FIRST_SYNC_MAX_MESSAGES);
      }

      const sorted = [...uids].sort((a, b) => a - b);
      const toFetch = sorted;

      let maxProcessed = lastUid;
      for (const uid of toFetch) {
        const msg = await client.fetchOne(
          String(uid),
          { source: true, uid: true, flags: true, threadId: true },
          { uid: true },
        );
        if (!msg || !msg.source) {
          continue;
        }
        const parsed = await simpleParser(msg.source);
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
        const imapThreadId = msg.threadId != null ? String(msg.threadId) : null;

        const { id: localMsgId, isNew } = insertOrUpdateEmailMessage({
          accountId,
          folderId: folderRow.id,
          uid,
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
          seenLocal: Boolean(msg.flags?.has('\\Seen')),
          imapThreadId,
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
        fetched += 1;
        maxProcessed = Math.max(maxProcessed, uid);
      }

      if (toFetch.length > 0) {
        lastUid = maxProcessed;
      } else if (sorted.length === 0 && lastUid === 0) {
        const refresh = await client.search({ all: true }, { uid: true });
        const all = refresh === false ? [] : refresh;
        if (all.length > 0) {
          lastUid = Math.max(...all);
        }
      } else if (sorted.length > 0) {
        lastUid = Math.max(lastUid, sorted[sorted.length - 1]!);
      }

      updateFolderSyncState(folderRow.id, {
        lastUid,
        uidvalidity: uidValidityNum ?? undefined,
        uidvalidityStr: uidValidityStr ?? undefined,
      });

      return { fetched, folderId: folderRow.id, lastUid };
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => undefined);
  }
}

/** Serialized per account with POP3/cron/IDLE to avoid overlapping IMAP sessions. */
export function syncInboxImap(accountId: number): Promise<ImapSyncResult> {
  return withEmailAccountSyncLock(accountId, () => syncInboxImapInternal(accountId));
}

export async function testImapConnection(account: EmailAccountRow, password: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const client = new ImapFlow({
    host: account.imap_host,
    port: account.imap_port,
    secure: Boolean(account.imap_tls),
    auth: {
      user: account.imap_username,
      pass: password,
    },
    logger: false,
  });
  try {
    await client.connect();
    await client.mailboxOpen('INBOX');
    return { ok: true };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, error: message };
  } finally {
    await client.logout().catch(() => undefined);
  }
}
