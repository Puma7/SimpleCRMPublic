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
  createImapUpsertContext,
  type EmailAccountRow,
} from './email-store';
import {
  processNewMessagesAfterSync,
  type SyncNewMessageItem,
} from './email-sync-post-process';
import {
  serverUidValidityToString,
  storedUidValidityString,
  uidValidityMismatch,
  uidValidityAsOptionalNumber,
} from './email-uidvalidity';
import { resolveImapAuth } from './email-imap-auth';
import { clearImapAuthNotice, maybeRecordImapAuthNotice } from './email-imap-auth-notice';
import { reconcileSeenFlagsForFolder } from './email-seen-reconcile';
import {
  assertSyncNotAborted,
  EmailSyncAbortedError,
  isEmailSyncAbortedError,
  withEmailAccountSyncLock,
} from './email-sync-mutex';
import {
  addressJson,
  formatDate,
  parseAttachmentsMeta,
  rawHeadersFromParsed,
  snippetFromParsed,
} from './email-parse-utils';
import { canAdvanceImapSyncCursor } from './imap-sync-cursor';
import {
  clearImapUidFetchFailure,
  IMAP_UID_MAX_FAILURES,
  recordImapUidFetchFailure,
  shouldSkipImapUidAfterFailures,
} from './imap-uid-failure';
import {
  backupFolderLocalMetaBeforeUidValidityReset,
  recordUidValidityResetNotice,
  tryRestoreLocalMetaFromUidValidityBackup,
} from './email-uidvalidity-reset';
import { rfc822SourceToStorageB64 } from './mail-eml-build';
import type { MailboxListEntry } from './imap-mailbox-names';
import {
  resolveSyncFoldersForAccount,
  type ImapFolderSyncSpec,
} from './imap-mailbox-resolve';

/** First sync: fetch up to this many newest messages (not entire mailbox). */
const FIRST_SYNC_MAX_MESSAGES = 2000;

export type ImapSyncResult = {
  fetched: number;
  folderId: number;
  lastUid: number;
  folderPath: string;
};

export type ImapAccountSyncResult = {
  folders: ImapSyncResult[];
  totalFetched: number;
};

async function syncFolderImapInternal(
  account: EmailAccountRow,
  client: ImapFlow,
  spec: ImapFolderSyncSpec,
  signal?: AbortSignal,
): Promise<ImapSyncResult> {
  const accountId = account.id;
  const folderPath = spec.path;
  let folderRow = getFolderByAccountAndPath(accountId, folderPath);
  let lastUid = folderRow?.last_uid ?? 0;
  let fetched = 0;

  const lock = await client.getMailboxLock(folderPath);
  try {
      const status = await client.status(folderPath, { uidValidity: true, uidNext: true, messages: true });
      const uidValidityRaw = status.uidValidity;
      const uidValidityStr = serverUidValidityToString(uidValidityRaw ?? null);
      const uidValidityNum = uidValidityAsOptionalNumber(uidValidityRaw ?? null);

      const storedStr = folderRow ? storedUidValidityString(folderRow) : null;
      if (folderRow && uidValidityMismatch(storedStr, uidValidityStr)) {
        const toDrop = getDb()
          .prepare(
            `SELECT COUNT(*) AS c FROM ${EMAIL_MESSAGES_TABLE}
             WHERE folder_id = ? AND (uid >= 0 OR pop3_uidl IS NOT NULL)`,
          )
          .get(folderRow.id) as { c: number };
        const backedUp = backupFolderLocalMetaBeforeUidValidityReset(folderRow.id);
        getDb()
          .prepare(
            `UPDATE ${EMAIL_MESSAGES_TABLE}
             SET uid = -ABS(id)
             WHERE folder_id = ? AND uid >= 0`,
          )
          .run(folderRow.id);
        recordUidValidityResetNotice({
          accountId,
          folderPath,
          oldValidity: storedStr,
          newValidity: uidValidityStr,
          messageCount: toDrop?.c ?? 0,
          backedUpCount: backedUp.length,
        });
        console.warn(
          `[imap-sync] UIDVALIDITY changed account ${accountId} ${folderPath}: ` +
            `${toDrop?.c ?? 0} local messages preserved for re-index (${backedUp.length} metadata backups)`,
        );
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
      const sortedSet = new Set(sorted);
      const toFetch = sorted;
      const upsertCtx = createImapUpsertContext(folderRow.id, toFetch);
      const newAfterSync: SyncNewMessageItem[] = [];

      let chainEnd = lastUid;
      const skippedUids = new Set<number>();
      for (const uid of toFetch) {
        assertSyncNotAborted(signal);
        if (shouldSkipImapUidAfterFailures(folderRow.id, uid)) {
          skippedUids.add(uid);
          console.warn(
            `[imap-sync] UID ${uid} account ${accountId} skipped after ${IMAP_UID_MAX_FAILURES} failures`,
          );
          if (canAdvanceImapSyncCursor(chainEnd, uid, sortedSet, skippedUids)) {
            chainEnd = uid;
          }
          continue;
        }
        try {
        const msg = await client.fetchOne(
          String(uid),
          { source: true, uid: true, flags: true, threadId: true },
          { uid: true },
        );
        if (!msg || !msg.source) {
          throw new Error(`empty source for UID ${uid}`);
        }
        const sourceBuf = Buffer.isBuffer(msg.source) ? msg.source : Buffer.from(msg.source as Buffer);
        const parsed = await simpleParser(sourceBuf);
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

        const { id: localMsgId, isNew } = insertOrUpdateEmailMessage(
          {
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
            bccJson: addressJson((parsed as { bcc?: typeof parsed.to }).bcc),
            dateReceived: formatDate(parsed.date),
            snippet,
            bodyText: textBody,
            bodyHtml: htmlBody,
            seenLocal: Boolean(msg.flags?.has('\\Seen')),
            imapThreadId,
            hasAttachments,
            attachmentsJson,
            rawHeaders: rawHeadersFromParsed(parsed),
            rawRfc822B64: rfc822SourceToStorageB64(sourceBuf),
            folderKind: spec.folderKind,
            archived: spec.archived,
            isSpam: spec.isSpam,
          },
          upsertCtx,
        );
        if (isNew && localMsgId > 0) {
          tryRestoreLocalMetaFromUidValidityBackup(folderRow.id, localMsgId, messageId);
          newAfterSync.push({
            localMsgId,
            parsedAttachments: parsed.attachments,
            threading: {
              messageIdHeader: messageId,
              inReplyTo,
              referencesHeader: refs,
              subject: parsed.subject ?? null,
            },
          });
        }
        fetched += 1;
        clearImapUidFetchFailure(folderRow.id, uid);
        if (canAdvanceImapSyncCursor(chainEnd, uid, sortedSet, skippedUids)) {
          chainEnd = uid;
        }
        } catch (perMsgErr) {
          if (isEmailSyncAbortedError(perMsgErr)) throw perMsgErr;
          const fails = recordImapUidFetchFailure(folderRow.id, uid);
          console.warn(
            `[imap-sync] UID ${uid} account ${accountId} failed (${fails}/${IMAP_UID_MAX_FAILURES}):`,
            perMsgErr instanceof Error ? perMsgErr.message : perMsgErr,
          );
          if (shouldSkipImapUidAfterFailures(folderRow.id, uid)) {
            skippedUids.add(uid);
            if (canAdvanceImapSyncCursor(chainEnd, uid, sortedSet, skippedUids)) {
              chainEnd = uid;
            }
          }
        }
      }

      try {
        await processNewMessagesAfterSync(accountId, newAfterSync, folderRow.id, {
          runInboundWorkflows: spec.runInboundWorkflows,
        });
      } catch (postErr) {
        console.error(
          `[imap-sync] post-process failed account ${accountId} folder ${folderPath}:`,
          postErr instanceof Error ? postErr.message : postErr,
        );
      }

      if (toFetch.length > 0) {
        lastUid = chainEnd;
      } else if (sorted.length === 0 && lastUid === 0) {
        const refresh = await client.search({ all: true }, { uid: true });
        const all = refresh === false ? [] : refresh;
        if (all.length > 0) {
          lastUid = Math.max(...all);
        }
      }

      try {
        const seenReconciled = await reconcileSeenFlagsForFolder(
          client,
          folderRow.id,
          folderPath,
          signal,
        );
        if (seenReconciled > 0) {
          console.log(
            `[imap-sync] reconciled seen_local for ${seenReconciled} message(s) in ${folderPath}`,
          );
        }
      } catch (reconcileErr) {
        if (isEmailSyncAbortedError(reconcileErr)) throw reconcileErr;
        console.warn(
          `[imap-sync] seen reconcile failed account ${accountId} ${folderPath}:`,
          reconcileErr instanceof Error ? reconcileErr.message : reconcileErr,
        );
      }

      updateFolderSyncState(folderRow.id, {
        lastUid,
        uidvalidity: uidValidityNum ?? undefined,
        uidvalidityStr: uidValidityStr ?? undefined,
      });

      return { fetched, folderId: folderRow.id, lastUid, folderPath };
  } finally {
    lock.release();
  }
}

async function syncAccountImapInternal(
  accountId: number,
  signal?: AbortSignal,
): Promise<ImapAccountSyncResult> {
  const account = getEmailAccountById(accountId);
  if (!account) {
    throw new Error('Unbekanntes E-Mail-Konto');
  }
  if ((account.protocol || 'imap') !== 'imap') {
    throw new Error('Konto ist kein IMAP-Konto (POP3 separat synchronisieren)');
  }

  let auth: Awaited<ReturnType<typeof resolveImapAuth>>;
  try {
    auth = await resolveImapAuth(account);
    clearImapAuthNotice(accountId);
  } catch (e) {
    maybeRecordImapAuthNotice(accountId, e);
    throw e;
  }
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
    connectionTimeout: 90_000,
    socketTimeout: 120_000,
  });

  const folders: ImapSyncResult[] = [];
  let totalFetched = 0;
  try {
    await client.connect();
    let listed: MailboxListEntry[] = [];
    try {
      listed = (await client.list()) as MailboxListEntry[];
    } catch {
      listed = [];
    }
    const specs = resolveSyncFoldersForAccount(account, listed);
    for (const spec of specs) {
      assertSyncNotAborted(signal);
      try {
        const r = await syncFolderImapInternal(account, client, spec, signal);
        folders.push(r);
        totalFetched += r.fetched;
      } catch (folderErr) {
        if (isEmailSyncAbortedError(folderErr)) throw folderErr;
        console.warn(
          `[imap-sync] folder ${spec.path} account ${accountId} failed:`,
          folderErr instanceof Error ? folderErr.message : folderErr,
        );
      }
    }
  } finally {
    await client.logout().catch(() => undefined);
  }
  return { folders, totalFetched };
}

/** Sync INBOX plus optional Sent/Archive/Spam folders (account settings). */
export function syncAccountImap(accountId: number): Promise<ImapAccountSyncResult> {
  return withEmailAccountSyncLock(accountId, (signal) => syncAccountImapInternal(accountId, signal));
}

/** @deprecated Use syncAccountImap — kept for callers expecting a single-folder result. */
export async function syncInboxImap(accountId: number): Promise<ImapSyncResult> {
  const r = await syncAccountImap(accountId);
  const inbox =
    r.folders.find((f) => f.folderPath.toUpperCase() === 'INBOX') ?? r.folders[0];
  if (!inbox) {
    return { fetched: 0, folderId: 0, lastUid: 0, folderPath: 'INBOX' };
  }
  return inbox;
}

export async function testImapConnection(account: EmailAccountRow, password: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!password?.trim()) {
    return { ok: false, error: 'Kein Passwort angegeben (Feld ausfüllen oder gespeichertes Konto testen).' };
  }
  const client = new ImapFlow({
    host: account.imap_host,
    port: account.imap_port,
    secure: Boolean(account.imap_tls),
    auth: {
      user: account.imap_username,
      pass: password,
    },
    logger: false,
    connectionTimeout: 25_000,
    socketTimeout: 30_000,
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
