import net from 'node:net';
import tls from 'node:tls';
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  addressJson,
  canAdvanceImapSyncCursor,
  findSentMailboxOnServer,
  formatDate,
  normalizeMailboxName,
  parseAttachmentsMeta,
  pickFirstMailboxPathOnServer,
  rawHeadersFromParsed,
  resolveSentMailboxCandidates,
  serializePop3ServerUidls,
  serverUidValidityToString,
  snippetFromParsed,
  storedUidValidityString,
  uidValidityAsOptionalNumber,
  uidValidityMismatch,
  type MailboxListEntry,
} from '@simplecrm/core';
import { mergeSeenLocalOnMailSync } from '../../shared/mail-sync-seen';
import type { Kysely, Selectable, Transaction, Updateable } from 'kysely';

import type { EmailOAuthProvider } from './api';
import type { PostgresSecretPort, SecretIdentifier } from './db';
import { resolveAttachmentStoragePath } from './db';
import {
  MAX_SYNC_ATTACHMENT_BYTES,
  MAX_SYNC_ATTACHMENT_TOTAL_BYTES,
  parseJsonValue,
  parseMailSource,
  parsedAttachmentsForStorage,
  sanitizeAttachmentFilename,
  sourceToBuffer,
  type ServerMailSyncParsedAttachment,
  type ServerMailSyncParsedMessage,
} from './mail-parse';
export {
  MAX_SYNC_ATTACHMENT_BYTES,
  MAX_SYNC_ATTACHMENT_TOTAL_BYTES,
  parseJsonValue,
  parseMailSource,
  parsedAttachmentsForStorage,
  sanitizeAttachmentFilename,
  sourceToBuffer,
  type ServerMailSyncParsedAttachment,
  type ServerMailSyncParsedMessage,
};
import type { EmailAccountsTable, EmailFoldersTable, EmailMessagesTable, ServerDatabase } from './db/schema';
import { withWorkspaceTransaction, type WorkspaceSessionApplier } from './db/workspace-context';
import { refreshServerEmailOAuthAccessToken } from './email-oauth';
import type { MailSyncJobPlan, MailSyncJobPort, MailSyncJobResult } from './jobs';

const FIRST_SYNC_MAX_MESSAGES = 2000;
const POP3_UID_CEILING = -1_000_000;
const IMAP_CONNECTION_TIMEOUT_MS = 90_000;
const IMAP_SOCKET_TIMEOUT_MS = 120_000;
const POP3_TIMEOUT_MS = 90_000;
const UID_VALIDITY_NOTICE_PREFIX = 'uidvalidity_notice:';
const UID_VALIDITY_BACKUP_PREFIX = 'uidvalidity_backup:';

type UidValidityBackupEntry = {
  messageId: string | null;
  customerId: number | null;
  assignedTo: string | null;
  legacyAssignedToUserId: string | null;
  assignedToUserId: string | null;
  isSpam: boolean;
  spamStatus: string | null;
  spamScore: number | null;
  spamScoreLabel: string | null;
  spamDecisionSource: string | null;
  spamScoreBreakdownJson: unknown;
  spamDecidedAt: string | null;
  tags: string[];
  categories: Array<{ categoryId: number | null; categorySourceSqliteId: number }>;
  workflows: Array<{ workflowId: number | null; workflowSourceSqliteId: number }>;
};

const EMAIL_OAUTH_APP_KEYS: Record<EmailOAuthProvider, {
  clientId: string;
  clientSecret: string;
}> = {
  google: {
    clientId: 'email_google_oauth_client_id',
    clientSecret: 'email_google_oauth_client_secret',
  },
  microsoft: {
    clientId: 'email_ms_oauth_client_id',
    clientSecret: 'email_ms_oauth_client_secret',
  },
};

export type ServerMailSyncAccount = Readonly<{
  id: number;
  sourceSqliteId: number;
  protocol: string;
  imapHost: string;
  imapPort: number;
  imapTls: boolean;
  imapUsername: string;
  oauthProvider: string | null;
  pop3Host: string | null;
  pop3Port: number | null;
  pop3Tls: boolean;
  sentFolderPath: string | null;
  syncSpamFolderPath: string | null;
  syncArchiveFolderPath: string | null;
  imapSyncSent: boolean;
  imapSyncArchive: boolean;
  imapSyncSpam: boolean;
}>;

export type ServerMailSyncFolder = Readonly<{
  id: number;
  sourceSqliteId: number;
  accountSourceSqliteId: number;
  path: string;
  delimiter: string | null;
  uidvalidity: number | null;
  uidvalidityStr: string | null;
  lastUid: number;
  pop3UidlStr: string | null;
}>;


export type ServerMailSyncMessageInput = ServerMailSyncParsedMessage & Readonly<{
  workspaceId: string;
  account: ServerMailSyncAccount;
  folder: ServerMailSyncFolder;
  uid: number;
  pop3Uidl?: string | null;
  seenLocal: boolean;
  imapThreadId?: string | null;
  folderKind: ServerMailSyncFolderKind;
  archived: boolean;
  isSpam: boolean;
}>;

export type ServerMailSyncStore = Readonly<{
  getAccount(input: {
    workspaceId: string;
    accountId: number;
  }): Promise<ServerMailSyncAccount | null>;
  readSecret?(input: SecretIdentifier): Promise<Buffer | null>;
  writeSecret?(input: SecretIdentifier & { value: string | Buffer }): Promise<unknown>;
  getSyncInfo(input: {
    workspaceId: string;
    keys: readonly string[];
  }): Promise<ReadonlyMap<string, string | null>>;
  getOrCreateFolder(input: {
    workspaceId: string;
    account: ServerMailSyncAccount;
    path: string;
    delimiter?: string | null;
  }): Promise<ServerMailSyncFolder>;
  resetFolderForUidValidityChange(input: {
    workspaceId: string;
    accountId: number;
    folderId: number;
    folderPath: string;
    oldUidValidity: string | null;
    newUidValidity: string | null;
    now: Date;
  }): Promise<{ messageCount: number; backedUpCount: number }>;
  loadImapUidToId(input: {
    workspaceId: string;
    folderId: number;
    uids: readonly number[];
  }): Promise<ReadonlyMap<number, number>>;
  loadPop3UidlToId(input: {
    workspaceId: string;
    folderId: number;
  }): Promise<ReadonlyMap<string, number>>;
  allocateNextPop3Uid(input: {
    workspaceId: string;
    accountId: number;
    folderId: number;
  }): Promise<number>;
  upsertMessage(input: ServerMailSyncMessageInput, context?: ServerMailSyncUpsertContext): Promise<{
    id: number;
    isNew: boolean;
  }>;
  restoreUidValidityLocalMetadata?(input: {
    workspaceId: string;
    folderId: number;
    messageId: number;
    messageIdHeader: string | null;
    now: Date;
  }): Promise<boolean>;
  replaceMessageAttachments?(input: {
    workspaceId: string;
    messageId: number;
    attachments: readonly ServerMailSyncParsedAttachment[];
  }): Promise<void>;
  updateFolderSyncState(input: {
    workspaceId: string;
    folderId: number;
    lastUid: number;
    uidvalidity?: number | null;
    uidvalidityStr?: string | null;
    pop3UidlStr?: string | null;
    syncedAt: Date;
  }): Promise<void>;
}>;

export type ServerMailSyncImapClient = Readonly<{
  connect(): Promise<void>;
  list(): Promise<MailboxListEntry[]>;
  status(path: string, query: { uidValidity?: boolean; uidNext?: boolean; messages?: boolean }): Promise<{
    uidValidity?: bigint | number | null;
  }>;
  getMailboxLock(path: string): Promise<{ release(): void }>;
  search(query: unknown, options: { uid: boolean }): Promise<number[] | false>;
  fetchOne(
    sequence: string,
    query: { source: boolean; uid: boolean; flags: boolean; threadId: boolean },
    options: { uid: boolean },
  ): Promise<{
    source?: Buffer | Uint8Array | string | null;
    flags?: Set<string> | string[] | null;
    threadId?: string | number | bigint | null;
  } | false | null>;
  logout(): Promise<unknown>;
}>;

export type ServerMailSyncImapClientFactory = (input: {
  host: string;
  port: number;
  secure: boolean;
  auth:
    | { user: string; pass: string }
    | { user: string; accessToken: string };
  connectionTimeout: number;
  socketTimeout: number;
}) => ServerMailSyncImapClient;

export type ServerMailSyncPop3Client = Readonly<{
  connect(): Promise<void>;
  uidl(): Promise<readonly [number, string][]>;
  retr(messageNumber: number): Promise<Buffer>;
  quit(): Promise<unknown>;
}>;

export type ServerMailSyncPop3ClientFactory = (input: {
  host: string;
  port: number;
  tls: boolean;
  user: string;
  password: string;
  timeoutMs: number;
}) => ServerMailSyncPop3Client;

export type ServerMailSyncParser = (source: Buffer) => Promise<ServerMailSyncParsedMessage>;

export type ServerMailSyncPortOptions = Readonly<{
  store: ServerMailSyncStore;
  imapClientFactory?: ServerMailSyncImapClientFactory;
  pop3ClientFactory?: ServerMailSyncPop3ClientFactory;
  parser?: ServerMailSyncParser;
  oauthFetchImpl?: typeof fetch;
  firstSyncMaxMessages?: number;
  now?: () => Date;
}>;

export type PostgresMailSyncJobPortOptions = Readonly<{
  db: Kysely<ServerDatabase>;
  secrets?: PostgresSecretPort;
  imapClientFactory?: ServerMailSyncImapClientFactory;
  pop3ClientFactory?: ServerMailSyncPop3ClientFactory;
  parser?: ServerMailSyncParser;
  attachmentsRoot?: string;
  oauthFetchImpl?: typeof fetch;
  firstSyncMaxMessages?: number;
  now?: () => Date;
  applyWorkspaceSession?: WorkspaceSessionApplier;
}>;

type ServerMailSyncFolderKind = 'inbox' | 'sent' | 'draft';

type ImapFolderSyncSpec = Readonly<{
  path: string;
  folderKind: ServerMailSyncFolderKind;
  archived: boolean;
  isSpam: boolean;
  runPostSync: boolean;
}>;

type ServerMailSyncUpsertContext = {
  imapUidToId?: Map<number, number>;
  pop3UidlToId?: Map<string, number>;
  nextPop3Uid?: number;
  reconcileSeenFromServer?: boolean;
};

type ResolvedMailAuth =
  | { ok: true; user: string; password: string; accessToken?: undefined }
  | { ok: true; user: string; accessToken: string; password?: undefined }
  | { ok: false; error: string };

type EmailAccountRow = Selectable<EmailAccountsTable>;
type EmailFolderRow = Selectable<EmailFoldersTable>;
type EmailMessageRow = Selectable<EmailMessagesTable>;
type MailSyncTransaction = Transaction<ServerDatabase>;

let serverMailSyncSourceCounter = 0;

export function createServerMailSyncJobPort(options: ServerMailSyncPortOptions): MailSyncJobPort {
  const imapClientFactory = options.imapClientFactory ?? createDefaultImapClient;
  const pop3ClientFactory = options.pop3ClientFactory ?? createDefaultPop3Client;
  const parser = options.parser ?? parseMailSource;
  const firstSyncMaxMessages = normalizeFirstSyncMaxMessages(options.firstSyncMaxMessages);
  const now = options.now ?? (() => new Date());

  return {
    async sync(input): Promise<MailSyncJobResult> {
      const account = await options.store.getAccount({
        workspaceId: input.workspaceId,
        accountId: input.accountId,
      });
      if (!account) throw new Error('Email account nicht gefunden');
      if ((account.protocol || 'imap') !== input.protocol) {
        throw new Error(`Email account protocol ist ${account.protocol || 'imap'}, Job erwartet ${input.protocol}`);
      }
      return input.protocol === 'imap'
        ? syncImapAccount({
          plan: input,
          account,
          store: options.store,
          imapClientFactory,
          parser,
          firstSyncMaxMessages,
          oauthFetchImpl: options.oauthFetchImpl,
          now,
        })
        : syncPop3Account({
          plan: input,
          account,
          store: options.store,
          pop3ClientFactory,
          parser,
          oauthFetchImpl: options.oauthFetchImpl,
          now,
        });
    },
  };
}

export function createPostgresMailSyncJobPort(options: PostgresMailSyncJobPortOptions): MailSyncJobPort {
  return createServerMailSyncJobPort({
    store: createPostgresMailSyncStore(options),
    imapClientFactory: options.imapClientFactory,
    pop3ClientFactory: options.pop3ClientFactory,
    parser: options.parser,
    oauthFetchImpl: options.oauthFetchImpl,
    firstSyncMaxMessages: options.firstSyncMaxMessages,
    now: options.now,
  });
}

async function syncImapAccount(input: {
  plan: MailSyncJobPlan;
  account: ServerMailSyncAccount;
  store: ServerMailSyncStore;
  imapClientFactory: ServerMailSyncImapClientFactory;
  parser: ServerMailSyncParser;
  firstSyncMaxMessages: number;
  oauthFetchImpl?: typeof fetch;
  now: () => Date;
}): Promise<MailSyncJobResult> {
  const auth = await resolveMailAuth({
    workspaceId: input.plan.workspaceId,
    account: input.account,
    store: input.store,
    oauthFetchImpl: input.oauthFetchImpl,
  });
  if (!auth.ok) throw new Error(auth.error);

  const client = input.imapClientFactory({
    host: input.account.imapHost,
    port: input.account.imapPort,
    secure: input.account.imapTls,
    auth: auth.accessToken != null
      ? { user: auth.user, accessToken: auth.accessToken }
      : { user: auth.user, pass: auth.password },
    connectionTimeout: IMAP_CONNECTION_TIMEOUT_MS,
    socketTimeout: IMAP_SOCKET_TIMEOUT_MS,
  });

  const inboundMessageIds: number[] = [];
  try {
    await client.connect();
    let listedMailboxes: MailboxListEntry[] = [];
    try {
      listedMailboxes = await client.list();
    } catch {
      listedMailboxes = [];
    }
    const specs = resolveImapSyncFolders(input.account, listedMailboxes);
    for (const spec of specs) {
      try {
        const result = await syncImapFolder({ ...input, client, spec });
        if (spec.runPostSync) inboundMessageIds.push(...result.newMessageIds);
      } catch (error) {
        if (spec.runPostSync) throw error;
      }
    }
  } finally {
    await client.logout().catch(() => undefined);
  }

  return { inboundMessageIds: uniquePositiveIds(inboundMessageIds) };
}

async function syncImapFolder(input: {
  plan: MailSyncJobPlan;
  account: ServerMailSyncAccount;
  store: ServerMailSyncStore;
  client: ServerMailSyncImapClient;
  parser: ServerMailSyncParser;
  firstSyncMaxMessages: number;
  spec: ImapFolderSyncSpec;
  now: () => Date;
}): Promise<{ newMessageIds: number[] }> {
  let folder = await input.store.getOrCreateFolder({
    workspaceId: input.plan.workspaceId,
    account: input.account,
    path: input.spec.path,
  });
  let lastUid = folder.lastUid;
  let uidValidityNum: number | null | undefined;
  let uidValidityStr: string | null | undefined;
  let uidValidityReset = false;

  type FetchedImapMessage = Readonly<{
    uid: number;
    source: Buffer;
    flags: Set<string> | string[] | null | undefined;
    threadId: string | null;
  }>;

  const fullInbox = input.plan.fullInbox === true && input.spec.runPostSync === true;
  let sorted: number[] = [];
  let sortedSet = new Set<number>();
  let imapUidToId = new Map<number, number>();
  let toProcess: number[] = [];
  const fetchedMessages: FetchedImapMessage[] = [];
  const skippedUids = new Set<number>();
  let chainEnd = lastUid;

  const lock = await input.client.getMailboxLock(input.spec.path);
  try {
    const status = await input.client.status(input.spec.path, {
      uidValidity: true,
      uidNext: true,
      messages: true,
    });
    uidValidityStr = serverUidValidityToString(status.uidValidity ?? null);
    uidValidityNum = uidValidityAsOptionalNumber(status.uidValidity ?? null);
    const storedStr = storedUidValidityString({
      uidvalidity: folder.uidvalidity,
      uidvalidity_str: folder.uidvalidityStr,
    });
    if (uidValidityMismatch(storedStr, uidValidityStr)) {
      await input.store.resetFolderForUidValidityChange({
        workspaceId: input.plan.workspaceId,
        accountId: input.account.id,
        folderId: folder.id,
        folderPath: input.spec.path,
        oldUidValidity: storedStr,
        newUidValidity: uidValidityStr ?? null,
        now: input.now(),
      });
      uidValidityReset = true;
      lastUid = 0;
      folder = {
        ...folder,
        lastUid: 0,
        uidvalidity: uidValidityNum ?? null,
        uidvalidityStr: uidValidityStr ?? null,
      };
    }

    let uids: number[];
    if (fullInbox) {
      const searchResult = await input.client.search({ all: true }, { uid: true });
      uids = searchResult === false ? [] : searchResult;
    } else if (lastUid > 0) {
      const searchResult = await input.client.search({ uid: `${lastUid + 1}:*` }, { uid: true });
      uids = searchResult === false ? [] : searchResult;
    } else {
      const searchResult = await input.client.search({ all: true }, { uid: true });
      const allUids = searchResult === false ? [] : searchResult;
      uids = [...allUids].sort((a, b) => a - b).slice(-input.firstSyncMaxMessages);
    }

    sorted = [...uids].sort((a, b) => a - b).filter((uid) => Number.isSafeInteger(uid) && uid > 0);
    sortedSet = new Set(sorted);
    imapUidToId = new Map(await input.store.loadImapUidToId({
      workspaceId: input.plan.workspaceId,
      folderId: folder.id,
      uids: sorted,
    }));
    toProcess = fullInbox ? sorted.filter((uid) => !imapUidToId.has(uid)) : sorted;
    chainEnd = lastUid;

    for (const uid of toProcess) {
      try {
        const fetched = await input.client.fetchOne(
          String(uid),
          { source: true, uid: true, flags: true, threadId: true },
          { uid: true },
        );
        if (!fetched || !fetched.source) throw new Error(`empty source for UID ${uid}`);
        fetchedMessages.push({
          uid,
          source: sourceToBuffer(fetched.source),
          flags: fetched.flags,
          threadId: fetched.threadId == null ? null : String(fetched.threadId),
        });
      } catch (error) {
        skippedUids.add(uid);
        console.warn(
          `[mail-sync] skipped message UID ${uid} in "${input.spec.path}" (account ${input.account.id}): ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  } finally {
    lock.release();
  }

  const context: ServerMailSyncUpsertContext = {
    imapUidToId,
    reconcileSeenFromServer: true,
  };
  const newMessageIds: number[] = [];

  for (const item of fetchedMessages) {
    try {
      const parsed = await input.parser(item.source);
      const upserted = await input.store.upsertMessage({
        workspaceId: input.plan.workspaceId,
        account: input.account,
        folder,
        uid: item.uid,
        ...parsed,
        seenLocal: flagsContainSeen(item.flags),
        imapThreadId: item.threadId,
        folderKind: input.spec.folderKind,
        archived: input.spec.archived,
        isSpam: input.spec.isSpam,
      }, context);
      await replaceMessageAttachmentsIfPresent(input.store, {
        workspaceId: input.plan.workspaceId,
        messageId: upserted.id,
        attachments: parsed.attachments,
      });
      if (uidValidityReset && input.store.restoreUidValidityLocalMetadata) {
        await input.store.restoreUidValidityLocalMetadata({
          workspaceId: input.plan.workspaceId,
          folderId: folder.id,
          messageId: upserted.id,
          messageIdHeader: parsed.messageId,
          now: input.now(),
        });
      }
      if (upserted.isNew && upserted.id > 0) newMessageIds.push(upserted.id);
      if (canAdvanceImapSyncCursor(chainEnd, item.uid, sortedSet, skippedUids)) chainEnd = item.uid;
    } catch (error) {
      skippedUids.add(item.uid);
      console.warn(
        `[mail-sync] skipped message UID ${item.uid} in "${input.spec.path}" (account ${input.account.id}): ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  if (!fullInbox) {
    if (sorted.length > 0) {
      lastUid = chainEnd;
    } else if (lastUid === 0) {
      const lockForRefresh = await input.client.getMailboxLock(input.spec.path);
      try {
        const refresh = await input.client.search({ all: true }, { uid: true });
        const all = refresh === false ? [] : refresh;
        if (all.length > 0) lastUid = Math.max(...all);
      } finally {
        lockForRefresh.release();
      }
    }
  }

  await input.store.updateFolderSyncState({
    workspaceId: input.plan.workspaceId,
    folderId: folder.id,
    lastUid,
    uidvalidity: uidValidityNum,
    uidvalidityStr: uidValidityStr,
    syncedAt: input.now(),
  });

  return { newMessageIds: fullInbox ? [] : newMessageIds };
}

async function syncPop3Account(input: {
  plan: MailSyncJobPlan;
  account: ServerMailSyncAccount;
  store: ServerMailSyncStore;
  pop3ClientFactory: ServerMailSyncPop3ClientFactory;
  parser: ServerMailSyncParser;
  oauthFetchImpl?: typeof fetch;
  now: () => Date;
}): Promise<MailSyncJobResult> {
  const auth = await resolveMailAuth({
    workspaceId: input.plan.workspaceId,
    account: input.account,
    store: input.store,
    oauthFetchImpl: input.oauthFetchImpl,
  });
  if (!auth.ok) throw new Error(auth.error);

  const client = input.pop3ClientFactory({
    host: input.account.pop3Host?.trim() || input.account.imapHost,
    port: input.account.pop3Port ?? 995,
    tls: input.account.pop3Tls,
    user: auth.user,
    password: auth.accessToken ?? auth.password,
    timeoutMs: POP3_TIMEOUT_MS,
  });

  const folder = await input.store.getOrCreateFolder({
    workspaceId: input.plan.workspaceId,
    account: input.account,
    path: 'INBOX',
  });
  const known = new Map(await input.store.loadPop3UidlToId({
    workspaceId: input.plan.workspaceId,
    folderId: folder.id,
  }));
  const context: ServerMailSyncUpsertContext = {
    pop3UidlToId: known,
    nextPop3Uid: await input.store.allocateNextPop3Uid({
      workspaceId: input.plan.workspaceId,
      accountId: input.account.id,
      folderId: folder.id,
    }),
  };
  const inboundMessageIds: number[] = [];

  try {
    await client.connect();
    const uidls = await client.uidl();
    const serverUidls: string[] = [];
    let maxMessageNumber = folder.lastUid;
    for (const [messageNumber, uidlRaw] of uidls) {
      const uidl = String(uidlRaw ?? '').trim();
      if (!uidl || !Number.isSafeInteger(messageNumber) || messageNumber <= 0) continue;
      serverUidls.push(uidl);
      maxMessageNumber = Math.max(maxMessageNumber, messageNumber);
      if (known.has(uidl)) continue;
      try {
        const source = await client.retr(messageNumber);
        const parsed = await input.parser(source);
        const upserted = await input.store.upsertMessage({
          workspaceId: input.plan.workspaceId,
          account: input.account,
          folder,
          uid: 0,
          pop3Uidl: uidl,
          ...parsed,
          seenLocal: false,
          imapThreadId: null,
          folderKind: 'inbox',
          archived: false,
          isSpam: false,
        }, context);
        await replaceMessageAttachmentsIfPresent(input.store, {
          workspaceId: input.plan.workspaceId,
          messageId: upserted.id,
          attachments: parsed.attachments,
        });
        if (upserted.id > 0 && upserted.isNew) inboundMessageIds.push(upserted.id);
      } catch {
        // Per-message POP3 failures should not abort the whole mailbox; the UIDL remains unpersisted as a row.
      }
    }

    await input.store.updateFolderSyncState({
      workspaceId: input.plan.workspaceId,
      folderId: folder.id,
      lastUid: maxMessageNumber,
      pop3UidlStr: serializePop3ServerUidls(serverUidls),
      syncedAt: input.now(),
    });
  } finally {
    await client.quit().catch(() => undefined);
  }

  return { inboundMessageIds: uniquePositiveIds(inboundMessageIds) };
}

function createPostgresMailSyncStore(options: PostgresMailSyncJobPortOptions): ServerMailSyncStore {
  const withWorkspace = <T>(
    workspaceId: string,
    operation: (trx: MailSyncTransaction) => Promise<T>,
  ): Promise<T> => withWorkspaceTransaction(
      options.db,
      { workspaceId, role: 'system' },
      operation,
      { applySession: options.applyWorkspaceSession },
    );

  return {
    async getAccount(input) {
      return withWorkspace(input.workspaceId, async (trx) => {
        const row = await trx
          .selectFrom('email_accounts')
          .select([
            'id',
            'source_sqlite_id',
            'protocol',
            'imap_host',
            'imap_port',
            'imap_tls',
            'imap_username',
            'oauth_provider',
            'pop3_host',
            'pop3_port',
            'pop3_tls',
            'sent_folder_path',
            'sync_spam_folder_path',
            'sync_archive_folder_path',
            'imap_sync_sent',
            'imap_sync_archive',
            'imap_sync_spam',
          ])
          .where('workspace_id', '=', input.workspaceId)
          .where('id', '=', input.accountId)
          .executeTakeFirst();
        return row ? mapMailSyncAccount(row) : null;
      });
    },
    async readSecret(input) {
      return options.secrets?.readSecret(input) ?? null;
    },
    async writeSecret(input) {
      await options.secrets?.writeSecret(input);
    },
    async getSyncInfo(input) {
      return withWorkspace(input.workspaceId, async (trx) => {
        const rows = await trx
          .selectFrom('sync_info')
          .select(['key', 'value'])
          .where('workspace_id', '=', input.workspaceId)
          .where('key', 'in', input.keys)
          .execute();
        const values = new Map<string, string | null>();
        for (const key of input.keys) values.set(key, null);
        for (const row of rows) values.set(row.key, row.value);
        return values;
      });
    },
    async getOrCreateFolder(input) {
      return withWorkspace(input.workspaceId, async (trx) => getOrCreatePostgresMailSyncFolder(trx, input));
    },
    async resetFolderForUidValidityChange(input) {
      return withWorkspace(input.workspaceId, async (trx) => resetPostgresFolderForUidValidityChange(trx, input));
    },
    async loadImapUidToId(input) {
      if (input.uids.length === 0) return new Map();
      // Chunk the uid list: the full-inbox backfill can pass tens of thousands
      // of UIDs, and a single `WHERE uid IN (...)` would exceed Postgres'
      // 65535-bind-parameter limit (and build a huge query) for exactly the
      // large/old accounts the backfill is meant to recover.
      const CHUNK = 1000;
      const result = new Map<number, number>();
      for (let i = 0; i < input.uids.length; i += CHUNK) {
        const chunk = input.uids.slice(i, i + CHUNK);
        const rows = await withWorkspace(input.workspaceId, async (trx) => trx
          .selectFrom('email_messages')
          .select(['uid', 'id'])
          .where('workspace_id', '=', input.workspaceId)
          .where('folder_id', '=', input.folderId)
          .where('pop3_uidl', 'is', null)
          .where('uid', 'in', [...chunk])
          .execute());
        for (const row of rows) result.set(Number(row.uid), Number(row.id));
      }
      return result;
    },
    async loadPop3UidlToId(input) {
      const rows = await withWorkspace(input.workspaceId, async (trx) => trx
        .selectFrom('email_messages')
        .select(['pop3_uidl', 'id'])
        .where('workspace_id', '=', input.workspaceId)
        .where('folder_id', '=', input.folderId)
        .where('pop3_uidl', 'is not', null)
        .execute());
      return new Map(rows
        .map((row) => [row.pop3_uidl?.trim() ?? '', Number(row.id)] as const)
        .filter(([uidl]) => Boolean(uidl)));
    },
    async allocateNextPop3Uid(input) {
      const row = await withWorkspace(input.workspaceId, async (trx) => trx
        .selectFrom('email_messages')
        .select((eb) => eb.fn.min<number>('uid').as('min_uid'))
        .where('workspace_id', '=', input.workspaceId)
        .where('account_id', '=', input.accountId)
        .where('folder_id', '=', input.folderId)
        .where('uid', '<=', POP3_UID_CEILING)
        .executeTakeFirst());
      return row?.min_uid != null ? Number(row.min_uid) - 1 : POP3_UID_CEILING;
    },
    async upsertMessage(input, context) {
      return withWorkspace(input.workspaceId, async (trx) => upsertPostgresMailSyncMessage(trx, input, context));
    },
    async restoreUidValidityLocalMetadata(input) {
      return withWorkspace(input.workspaceId, async (trx) => restorePostgresUidValidityLocalMetadata(trx, input));
    },
    ...(options.attachmentsRoot ? {
      async replaceMessageAttachments(input) {
        await replacePostgresMailSyncAttachments({
          db: options.db,
          attachmentsRoot: options.attachmentsRoot ?? '',
          applyWorkspaceSession: options.applyWorkspaceSession,
          ...input,
        });
      },
    } : {}),
    async updateFolderSyncState(input) {
      await withWorkspace(input.workspaceId, async (trx) => {
        const values: Partial<Updateable<EmailFoldersTable>> = {
          last_uid: input.lastUid,
          last_synced_at: input.syncedAt,
          updated_at: input.syncedAt,
        };
        if ('uidvalidity' in input) values.uidvalidity = input.uidvalidity ?? null;
        if ('uidvalidityStr' in input) values.uidvalidity_str = input.uidvalidityStr ?? null;
        if ('pop3UidlStr' in input) values.pop3_uidl_str = input.pop3UidlStr ?? null;
        await trx
          .updateTable('email_folders')
          .set(values)
          .where('workspace_id', '=', input.workspaceId)
          .where('id', '=', input.folderId)
          .execute();
      });
    },
  };
}

async function getOrCreatePostgresMailSyncFolder(
  trx: MailSyncTransaction,
  input: {
    workspaceId: string;
    account: ServerMailSyncAccount;
    path: string;
    delimiter?: string | null;
  },
): Promise<ServerMailSyncFolder> {
  const now = new Date();
  const path = input.path.trim() || 'INBOX';
  const existing = await trx
    .selectFrom('email_folders')
    .selectAll()
    .where('workspace_id', '=', input.workspaceId)
    .where('account_source_sqlite_id', '=', input.account.sourceSqliteId)
    .where('path', '=', path)
    .executeTakeFirst();
  if (existing) return mapMailSyncFolder(existing);

  const row = await trx
    .insertInto('email_folders')
    .values({
      workspace_id: input.workspaceId,
      source_sqlite_id: serverCreatedSourceSqliteId('email_folders'),
      account_source_sqlite_id: input.account.sourceSqliteId,
      account_id: input.account.id,
      path,
      delimiter: input.delimiter ?? '/',
      uidvalidity: null,
      uidvalidity_str: null,
      last_uid: 0,
      last_synced_at: null,
      pop3_uidl_str: null,
      source_row: serverMailSyncSourceRow(),
      imported_in_run_id: null,
      updated_at: now,
    })
    .onConflict((oc) => oc.columns(['workspace_id', 'account_source_sqlite_id', 'path']).doUpdateSet({
      account_id: input.account.id,
      updated_at: now,
    }))
    .returningAll()
    .executeTakeFirstOrThrow();
  return mapMailSyncFolder(row);
}

async function resetPostgresFolderForUidValidityChange(
  trx: MailSyncTransaction,
  input: {
    workspaceId: string;
    accountId: number;
    folderId: number;
    folderPath: string;
    oldUidValidity: string | null;
    newUidValidity: string | null;
    now: Date;
  },
): Promise<{ messageCount: number; backedUpCount: number }> {
  const messages = await trx
    .selectFrom('email_messages')
    .select([
      'id',
      'source_sqlite_id',
      'message_id',
      'customer_id',
      'assigned_to',
      'legacy_assigned_to_user_id',
      'assigned_to_user_id',
      'is_spam',
      'spam_status',
      'spam_score',
      'spam_score_label',
      'spam_decision_source',
      'spam_score_breakdown_json',
      'spam_decided_at',
    ])
    .where('workspace_id', '=', input.workspaceId)
    .where('folder_id', '=', input.folderId)
    .where((eb) => eb.or([
      eb('uid', '>=', 0),
      eb('pop3_uidl', 'is not', null),
    ]))
    .execute();
  const messageIds = messages.map((row) => Number(row.id)).filter((id) => Number.isSafeInteger(id) && id > 0);
  const tagsByMessage = await loadUidValidityTagsByMessage(trx, input.workspaceId, messageIds);
  const categoriesByMessage = await loadUidValidityCategoriesByMessage(trx, input.workspaceId, messageIds);
  const workflowsByMessage = await loadUidValidityWorkflowsByMessage(trx, input.workspaceId, messageIds);
  const entries: UidValidityBackupEntry[] = messages.map((row) => ({
    messageId: row.message_id,
    customerId: row.customer_id == null ? null : Number(row.customer_id),
    assignedTo: row.assigned_to,
    legacyAssignedToUserId: row.legacy_assigned_to_user_id,
    assignedToUserId: row.assigned_to_user_id,
    isSpam: Boolean(row.is_spam),
    spamStatus: row.spam_status,
    spamScore: row.spam_score == null ? null : Number(row.spam_score),
    spamScoreLabel: row.spam_score_label,
    spamDecisionSource: row.spam_decision_source,
    spamScoreBreakdownJson: row.spam_score_breakdown_json ?? null,
    spamDecidedAt: timestampToIsoString(row.spam_decided_at),
    tags: tagsByMessage.get(Number(row.id)) ?? [],
    categories: categoriesByMessage.get(Number(row.id)) ?? [],
    workflows: workflowsByMessage.get(Number(row.id)) ?? [],
  }));

  await setPostgresSyncInfoValue(trx, input.workspaceId, uidValidityBackupKey(input.folderId), JSON.stringify(entries), input.now);
  await appendPostgresUidValidityNotice(trx, {
    ...input,
    messageCount: messages.length,
    backedUpCount: entries.length,
  });

  await trx
    .deleteFrom('email_messages')
    .where('workspace_id', '=', input.workspaceId)
    .where('folder_id', '=', input.folderId)
    .where((eb) => eb.or([
      eb('uid', '>=', 0),
      eb('pop3_uidl', 'is not', null),
    ]))
    .execute();

  return { messageCount: messages.length, backedUpCount: entries.length };
}

async function restorePostgresUidValidityLocalMetadata(
  trx: MailSyncTransaction,
  input: {
    workspaceId: string;
    folderId: number;
    messageId: number;
    messageIdHeader: string | null;
    now: Date;
  },
): Promise<boolean> {
  const messageIdHeader = input.messageIdHeader?.trim();
  if (!messageIdHeader) return false;
  const raw = await trx
    .selectFrom('sync_info')
    .select('value')
    .where('workspace_id', '=', input.workspaceId)
    .where('key', '=', uidValidityBackupKey(input.folderId))
    .executeTakeFirst();
  const entries = parseUidValidityBackupEntries(raw?.value);
  const entry = entries.find((item) => item.messageId === messageIdHeader);
  if (!entry) return false;

  const message = await trx
    .selectFrom('email_messages')
    .select(['id', 'source_sqlite_id'])
    .where('workspace_id', '=', input.workspaceId)
    .where('id', '=', input.messageId)
    .executeTakeFirst();
  if (!message) return false;
  const messageSourceSqliteId = Number(message.source_sqlite_id);

  await trx
    .updateTable('email_messages')
    .set({
      ...(entry.customerId == null ? {} : { customer_id: entry.customerId }),
      ...(entry.assignedTo == null ? {} : { assigned_to: entry.assignedTo }),
      ...(entry.legacyAssignedToUserId == null ? {} : { legacy_assigned_to_user_id: entry.legacyAssignedToUserId }),
      ...(entry.assignedToUserId == null ? {} : { assigned_to_user_id: entry.assignedToUserId }),
      is_spam: entry.isSpam,
      spam_status: entry.spamStatus ?? (entry.isSpam ? 'spam' : 'clean'),
      spam_score: entry.spamScore,
      spam_score_label: entry.spamScoreLabel,
      spam_decision_source: entry.spamDecisionSource,
      spam_score_breakdown_json: entry.spamScoreBreakdownJson,
      spam_decided_at: entry.spamDecidedAt == null ? null : new Date(entry.spamDecidedAt),
      updated_at: input.now,
    })
    .where('workspace_id', '=', input.workspaceId)
    .where('id', '=', input.messageId)
    .execute();

  if (entry.tags.length > 0) {
    await trx
      .insertInto('email_message_tags')
      .values(entry.tags.map((tag) => ({
        workspace_id: input.workspaceId,
        source_sqlite_id: serverCreatedSourceSqliteId('email_message_tags'),
        message_source_sqlite_id: messageSourceSqliteId,
        message_id: input.messageId,
        tag,
        source_row: serverMailSyncSourceRow(),
        imported_in_run_id: null,
        created_at: input.now,
        updated_at: input.now,
      })))
      .onConflict((oc) => oc.columns(['workspace_id', 'message_source_sqlite_id', 'tag']).doNothing())
      .execute();
  }

  const categoryIdsBySource = await loadUidValidityCategoryIdsBySource(
    trx,
    input.workspaceId,
    entry.categories.map((category) => category.categorySourceSqliteId),
  );
  const categoryRows = entry.categories
    .flatMap((category) => {
      const categoryId = categoryIdsBySource.get(category.categorySourceSqliteId);
      if (categoryId == null) return [];
      return [{
        workspace_id: input.workspaceId,
        source_sqlite_id: serverCreatedSourceSqliteId('email_message_categories'),
        message_source_sqlite_id: messageSourceSqliteId,
        category_source_sqlite_id: category.categorySourceSqliteId,
        message_id: input.messageId,
        category_id: categoryId,
        source_row: serverMailSyncSourceRow(),
        imported_in_run_id: null,
        updated_at: input.now,
      }];
    });
  if (categoryRows.length > 0) {
    await trx
      .insertInto('email_message_categories')
      .values(categoryRows)
      .onConflict((oc) => oc.columns(['workspace_id', 'message_source_sqlite_id', 'category_source_sqlite_id']).doNothing())
      .execute();
  }

  const workflowIdsBySource = await loadUidValidityWorkflowIdsBySource(
    trx,
    input.workspaceId,
    entry.workflows.map((workflow) => workflow.workflowSourceSqliteId),
  );
  const workflowRows = entry.workflows
    .flatMap((workflow) => {
      const workflowId = workflowIdsBySource.get(workflow.workflowSourceSqliteId);
      if (workflowId == null) return [];
      return [{
        workspace_id: input.workspaceId,
        source_sqlite_id: serverCreatedSourceSqliteId('email_message_workflow_applied'),
        message_source_sqlite_id: messageSourceSqliteId,
        workflow_source_sqlite_id: workflow.workflowSourceSqliteId,
        message_id: input.messageId,
        workflow_id: workflowId,
        source_row: serverMailSyncSourceRow(),
        imported_in_run_id: null,
        applied_at: input.now,
        updated_at: input.now,
      }];
    });
  if (workflowRows.length > 0) {
    await trx
      .insertInto('email_message_workflow_applied')
      .values(workflowRows)
      .onConflict((oc) => oc.columns(['workspace_id', 'message_source_sqlite_id', 'workflow_source_sqlite_id']).doNothing())
      .execute();
  }

  return true;
}

async function loadUidValidityTagsByMessage(
  trx: MailSyncTransaction,
  workspaceId: string,
  messageIds: readonly number[],
): Promise<Map<number, string[]>> {
  if (messageIds.length === 0) return new Map();
  const rows = await trx
    .selectFrom('email_message_tags')
    .select(['message_id', 'tag'])
    .where('workspace_id', '=', workspaceId)
    .where('message_id', 'in', [...messageIds])
    .execute();
  const result = new Map<number, string[]>();
  for (const row of rows) {
    if (row.message_id == null) continue;
    const messageId = Number(row.message_id);
    const current = result.get(messageId) ?? [];
    current.push(row.tag);
    result.set(messageId, current);
  }
  return result;
}

async function loadUidValidityCategoriesByMessage(
  trx: MailSyncTransaction,
  workspaceId: string,
  messageIds: readonly number[],
): Promise<Map<number, Array<{ categoryId: number | null; categorySourceSqliteId: number }>>> {
  if (messageIds.length === 0) return new Map();
  const rows = await trx
    .selectFrom('email_message_categories')
    .select(['message_id', 'category_id', 'category_source_sqlite_id'])
    .where('workspace_id', '=', workspaceId)
    .where('message_id', 'in', [...messageIds])
    .execute();
  const result = new Map<number, Array<{ categoryId: number | null; categorySourceSqliteId: number }>>();
  for (const row of rows) {
    if (row.message_id == null) continue;
    const messageId = Number(row.message_id);
    const current = result.get(messageId) ?? [];
    current.push({
      categoryId: row.category_id == null ? null : Number(row.category_id),
      categorySourceSqliteId: Number(row.category_source_sqlite_id),
    });
    result.set(messageId, current);
  }
  return result;
}

async function loadUidValidityWorkflowsByMessage(
  trx: MailSyncTransaction,
  workspaceId: string,
  messageIds: readonly number[],
): Promise<Map<number, Array<{ workflowId: number | null; workflowSourceSqliteId: number }>>> {
  if (messageIds.length === 0) return new Map();
  const rows = await trx
    .selectFrom('email_message_workflow_applied')
    .select(['message_id', 'workflow_id', 'workflow_source_sqlite_id'])
    .where('workspace_id', '=', workspaceId)
    .where('message_id', 'in', [...messageIds])
    .execute();
  const result = new Map<number, Array<{ workflowId: number | null; workflowSourceSqliteId: number }>>();
  for (const row of rows) {
    if (row.message_id == null) continue;
    const messageId = Number(row.message_id);
    const current = result.get(messageId) ?? [];
    current.push({
      workflowId: row.workflow_id == null ? null : Number(row.workflow_id),
      workflowSourceSqliteId: Number(row.workflow_source_sqlite_id),
    });
    result.set(messageId, current);
  }
  return result;
}

async function loadUidValidityCategoryIdsBySource(
  trx: MailSyncTransaction,
  workspaceId: string,
  sourceSqliteIds: readonly number[],
): Promise<Map<number, number>> {
  const ids = uniqueSafeIntegers(sourceSqliteIds);
  if (ids.length === 0) return new Map();
  const rows = await trx
    .selectFrom('email_categories')
    .select(['id', 'source_sqlite_id'])
    .where('workspace_id', '=', workspaceId)
    .where('source_sqlite_id', 'in', ids)
    .execute();
  return new Map(rows.map((row) => [Number(row.source_sqlite_id), Number(row.id)]));
}

async function loadUidValidityWorkflowIdsBySource(
  trx: MailSyncTransaction,
  workspaceId: string,
  sourceSqliteIds: readonly number[],
): Promise<Map<number, number>> {
  const ids = uniqueSafeIntegers(sourceSqliteIds);
  if (ids.length === 0) return new Map();
  const rows = await trx
    .selectFrom('email_workflows')
    .select(['id', 'source_sqlite_id'])
    .where('workspace_id', '=', workspaceId)
    .where('source_sqlite_id', 'in', ids)
    .execute();
  return new Map(rows.map((row) => [Number(row.source_sqlite_id), Number(row.id)]));
}

async function setPostgresSyncInfoValue(
  trx: MailSyncTransaction,
  workspaceId: string,
  key: string,
  value: string,
  now: Date,
): Promise<void> {
  await trx
    .insertInto('sync_info')
    .values({
      workspace_id: workspaceId,
      key,
      value,
      last_updated: now,
      source_row: serverMailSyncSourceRow(),
      imported_in_run_id: null,
      updated_at: now,
    })
    .onConflict((oc) => oc.columns(['workspace_id', 'key']).doUpdateSet({
      value: (eb) => eb.ref('excluded.value'),
      last_updated: now,
      updated_at: now,
    }))
    .execute();
}

async function appendPostgresUidValidityNotice(
  trx: MailSyncTransaction,
  input: {
    workspaceId: string;
    accountId: number;
    folderId: number;
    folderPath: string;
    oldUidValidity: string | null;
    newUidValidity: string | null;
    messageCount: number;
    backedUpCount: number;
    now: Date;
  },
): Promise<void> {
  const key = uidValidityNoticeKey(input.accountId);
  const existing = await trx
    .selectFrom('sync_info')
    .select('value')
    .where('workspace_id', '=', input.workspaceId)
    .where('key', '=', key)
    .executeTakeFirst();
  const notices = parseUidValidityNoticeValues(existing?.value);
  const notice = {
    id: `${input.accountId}:${input.folderId}:${input.now.getTime()}`,
    accountId: input.accountId,
    folderPath: input.folderPath,
    oldValidity: input.oldUidValidity,
    newValidity: input.newUidValidity,
    messageCount: input.messageCount,
    backedUpCount: input.backedUpCount,
    at: input.now.toISOString(),
  };
  await setPostgresSyncInfoValue(trx, input.workspaceId, key, JSON.stringify([notice, ...notices].slice(0, 10)), input.now);
}

function parseUidValidityBackupEntries(raw: string | null | undefined): UidValidityBackupEntry[] {
  if (!raw?.trim()) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map(normalizeUidValidityBackupEntry)
    .filter((entry): entry is UidValidityBackupEntry => entry !== null);
}

function normalizeUidValidityBackupEntry(value: unknown): UidValidityBackupEntry | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const messageId = nullableString(record.messageId ?? record.message_id);
  const isSpam = record.isSpam ?? record.is_spam;
  return {
    messageId,
    customerId: nullableInteger(record.customerId ?? record.customer_id),
    assignedTo: nullableString(record.assignedTo ?? record.assigned_to),
    legacyAssignedToUserId: nullableString(record.legacyAssignedToUserId ?? record.legacy_assigned_to_user_id),
    assignedToUserId: nullableString(record.assignedToUserId ?? record.assigned_to_user_id),
    isSpam: isSpam === true || isSpam === 1,
    spamStatus: nullableString(record.spamStatus ?? record.spam_status),
    spamScore: nullableFiniteNumber(record.spamScore ?? record.spam_score),
    spamScoreLabel: nullableString(record.spamScoreLabel ?? record.spam_score_label),
    spamDecisionSource: nullableString(record.spamDecisionSource ?? record.spam_decision_source),
    spamScoreBreakdownJson: record.spamScoreBreakdownJson ?? record.spam_score_breakdown_json ?? null,
    spamDecidedAt: nullableString(record.spamDecidedAt ?? record.spam_decided_at),
    tags: Array.isArray(record.tags) ? record.tags.filter((tag): tag is string => typeof tag === 'string' && tag.trim().length > 0) : [],
    categories: Array.isArray(record.categories)
      ? record.categories
        .map(normalizeUidValidityCategory)
        .filter((category): category is { categoryId: number | null; categorySourceSqliteId: number } => category !== null)
      : Array.isArray(record.category_ids)
        ? record.category_ids
          .map(normalizeUidValidityLegacyCategory)
          .filter((category): category is { categoryId: null; categorySourceSqliteId: number } => category !== null)
        : [],
    workflows: Array.isArray(record.workflows)
      ? record.workflows
        .map(normalizeUidValidityWorkflow)
        .filter((workflow): workflow is { workflowId: number | null; workflowSourceSqliteId: number } => workflow !== null)
      : Array.isArray(record.workflow_ids)
        ? record.workflow_ids
          .map(normalizeUidValidityLegacyWorkflow)
          .filter((workflow): workflow is { workflowId: null; workflowSourceSqliteId: number } => workflow !== null)
        : [],
  };
}

function normalizeUidValidityCategory(value: unknown): { categoryId: number | null; categorySourceSqliteId: number } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const categoryId = nullableInteger(record.categoryId ?? record.category_id);
  const categorySourceSqliteId = nullableInteger(record.categorySourceSqliteId ?? record.category_source_sqlite_id);
  return categorySourceSqliteId === null ? null : { categoryId, categorySourceSqliteId };
}

function normalizeUidValidityLegacyCategory(value: unknown): { categoryId: null; categorySourceSqliteId: number } | null {
  const categorySourceSqliteId = nullableInteger(value);
  return categorySourceSqliteId === null ? null : { categoryId: null, categorySourceSqliteId };
}

function normalizeUidValidityWorkflow(value: unknown): { workflowId: number | null; workflowSourceSqliteId: number } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const workflowId = nullableInteger(record.workflowId ?? record.workflow_id);
  const workflowSourceSqliteId = nullableInteger(record.workflowSourceSqliteId ?? record.workflow_source_sqlite_id);
  return workflowSourceSqliteId === null ? null : { workflowId, workflowSourceSqliteId };
}

function normalizeUidValidityLegacyWorkflow(value: unknown): { workflowId: null; workflowSourceSqliteId: number } | null {
  const workflowSourceSqliteId = nullableInteger(value);
  return workflowSourceSqliteId === null ? null : { workflowId: null, workflowSourceSqliteId };
}

function parseUidValidityNoticeValues(raw: string | null | undefined): unknown[] {
  if (!raw?.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function uidValidityBackupKey(folderId: number): string {
  return `${UID_VALIDITY_BACKUP_PREFIX}${folderId}`;
}

function uidValidityNoticeKey(accountId: number): string {
  return `${UID_VALIDITY_NOTICE_PREFIX}${accountId}`;
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function nullableInteger(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function nullableFiniteNumber(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function timestampToIsoString(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string' && value.trim()) return value;
  return null;
}

async function upsertPostgresMailSyncMessage(
  trx: MailSyncTransaction,
  input: ServerMailSyncMessageInput,
  context: ServerMailSyncUpsertContext | undefined,
): Promise<{ id: number; isNew: boolean }> {
  const pop3Uidl = input.pop3Uidl?.trim() || null;
  if (pop3Uidl) {
    const cachedId = context?.pop3UidlToId?.get(pop3Uidl);
    const existing = cachedId != null
      ? { id: cachedId }
      : await trx
        .selectFrom('email_messages')
        .select(['id'])
        .where('workspace_id', '=', input.workspaceId)
        .where('account_id', '=', input.account.id)
        .where('folder_id', '=', input.folder.id)
        .where('pop3_uidl', '=', pop3Uidl)
        .executeTakeFirst();
    if (existing) {
      await updateExistingPostgresMailSyncMessage(trx, input, Number(existing.id), false);
      context?.pop3UidlToId?.set(pop3Uidl, Number(existing.id));
      return { id: Number(existing.id), isNew: false };
    }
  }

  let uidForRow = input.uid;
  if (pop3Uidl) {
    uidForRow = context?.nextPop3Uid ?? await nextPostgresPop3Uid(trx, input);
    if (context?.nextPop3Uid != null) context.nextPop3Uid -= 1;
  }

  const cachedImapId = !pop3Uidl ? context?.imapUidToId?.get(uidForRow) : undefined;
  const existing = cachedImapId != null
    ? { id: cachedImapId }
    : !pop3Uidl
      ? await trx
        .selectFrom('email_messages')
        .select(['id'])
        .where('workspace_id', '=', input.workspaceId)
        .where('account_id', '=', input.account.id)
        .where('folder_id', '=', input.folder.id)
        .where('uid', '=', uidForRow)
        .executeTakeFirst()
      : undefined;
  if (existing) {
    await updateExistingPostgresMailSyncMessage(trx, { ...input, uid: uidForRow }, Number(existing.id), Boolean(context?.reconcileSeenFromServer));
    if (pop3Uidl) context?.pop3UidlToId?.set(pop3Uidl, Number(existing.id));
    else context?.imapUidToId?.set(uidForRow, Number(existing.id));
    return { id: Number(existing.id), isNew: false };
  }

  const now = new Date();
  const row = await trx
    .insertInto('email_messages')
    .values({
      workspace_id: input.workspaceId,
      source_sqlite_id: serverCreatedSourceSqliteId('email_messages'),
      account_source_sqlite_id: input.account.sourceSqliteId,
      folder_source_sqlite_id: input.folder.sourceSqliteId,
      account_id: input.account.id,
      folder_id: input.folder.id,
      uid: uidForRow,
      message_id: input.messageId,
      in_reply_to: input.inReplyTo,
      references_header: input.referencesHeader,
      subject: input.subject,
      from_json: input.fromJson,
      to_json: input.toJson,
      cc_json: input.ccJson,
      bcc_json: input.bccJson,
      date_received: input.dateReceived ? new Date(input.dateReceived) : null,
      snippet: input.snippet,
      body_text: input.bodyText,
      body_html: input.bodyHtml,
      seen_local: input.seenLocal,
      done_local: false,
      sent_imap_sync_failed: false,
      archived: input.archived,
      soft_deleted: false,
      outbound_hold: false,
      outbound_block_reason: null,
      thread_id: null,
      ticket_code: null,
      customer_source_sqlite_id: null,
      customer_id: null,
      folder_kind: input.folderKind,
      imap_thread_id: input.imapThreadId ?? null,
      has_attachments: input.hasAttachments,
      attachments_json: input.attachmentsJson,
      draft_attachment_paths_json: null,
      post_process_done: false,
      reply_parent_message_id: null,
      assigned_to: null,
      legacy_assigned_to_user_id: null,
      assigned_to_user_id: null,
      is_spam: input.isSpam,
      spam_status: input.isSpam ? 'spam' : 'clean',
      snoozed_until: null,
      scheduled_send_at: null,
      pop3_uidl: pop3Uidl,
      raw_headers: input.rawHeaders,
      raw_rfc822_b64: input.rawRfc822B64,
      remote_content_policy: 'blocked',
      read_receipt_requested: false,
      thread_resolver_version: 0,
      source_row: serverMailSyncSourceRow(),
      imported_in_run_id: null,
      created_at: now,
      updated_at: now,
    })
    .returning(['id'])
    .executeTakeFirstOrThrow();
  const id = Number(row.id);
  if (pop3Uidl) context?.pop3UidlToId?.set(pop3Uidl, id);
  else context?.imapUidToId?.set(uidForRow, id);
  return { id, isNew: true };
}

async function updateExistingPostgresMailSyncMessage(
  trx: MailSyncTransaction,
  input: ServerMailSyncMessageInput,
  id: number,
  reconcileSeenFromServer: boolean,
): Promise<void> {
  const current = await trx
    .selectFrom('email_messages')
    .select(['seen_local', 'is_spam', 'spam_status'])
    .where('workspace_id', '=', input.workspaceId)
    .where('id', '=', id)
    .executeTakeFirst() as Pick<EmailMessageRow, 'seen_local' | 'is_spam' | 'spam_status'> | undefined;
  const now = new Date();
  await trx
    .updateTable('email_messages')
    .set({
      message_id: input.messageId,
      in_reply_to: input.inReplyTo,
      references_header: input.referencesHeader,
      subject: input.subject,
      from_json: input.fromJson,
      to_json: input.toJson,
      cc_json: input.ccJson,
      bcc_json: input.bccJson ?? undefined,
      date_received: input.dateReceived ? new Date(input.dateReceived) : null,
      snippet: input.snippet,
      body_text: input.bodyText,
      body_html: input.bodyHtml,
      seen_local: mergeSeenLocalOnMailSync({
        currentSeenLocal: Boolean(current?.seen_local),
        incomingSeenLocal: input.seenLocal,
        spamStatus: current?.spam_status,
        reconcileSeenFromServer,
      }),
      imap_thread_id: input.imapThreadId ?? undefined,
      has_attachments: input.hasAttachments,
      attachments_json: input.attachmentsJson ?? undefined,
      pop3_uidl: input.pop3Uidl?.trim() || undefined,
      raw_headers: input.rawHeaders ?? undefined,
      raw_rfc822_b64: input.rawRfc822B64 ?? undefined,
      uid: input.pop3Uidl?.trim() ? undefined : input.uid,
      folder_kind: input.folderKind,
      archived: input.archived,
      is_spam: input.isSpam ? true : Boolean(current?.is_spam),
      spam_status: input.isSpam ? 'spam' : current?.spam_status ?? 'clean',
      soft_deleted: false,
      updated_at: now,
    })
    .where('workspace_id', '=', input.workspaceId)
    .where('id', '=', id)
    .execute();
}

async function nextPostgresPop3Uid(
  trx: MailSyncTransaction,
  input: Pick<ServerMailSyncMessageInput, 'workspaceId' | 'account' | 'folder'>,
): Promise<number> {
  const row = await trx
    .selectFrom('email_messages')
    .select((eb) => eb.fn.min<number>('uid').as('min_uid'))
    .where('workspace_id', '=', input.workspaceId)
    .where('account_id', '=', input.account.id)
    .where('folder_id', '=', input.folder.id)
    .where('uid', '<=', POP3_UID_CEILING)
    .executeTakeFirst();
  return row?.min_uid != null ? Number(row.min_uid) - 1 : POP3_UID_CEILING;
}

async function resolveMailAuth(input: {
  workspaceId: string;
  account: ServerMailSyncAccount;
  store: Pick<ServerMailSyncStore, 'readSecret' | 'writeSecret' | 'getSyncInfo'>;
  oauthFetchImpl?: typeof fetch;
}): Promise<ResolvedMailAuth> {
  const unsafeUser = validateAuthValue(input.account.imapUsername, 'Benutzername');
  if (unsafeUser) return { ok: false, error: unsafeUser };
  if (!input.store.readSecret) return { ok: false, error: 'Email account secret storage ist nicht konfiguriert' };

  const imapSecret = await input.store.readSecret(emailAccountSecretIdentifier(input.workspaceId, input.account.id, 'imap'));
  if (imapSecret) {
    const password = imapSecret.toString('utf8');
    const unsafePassword = validateAuthValue(password, 'Passwort');
    if (unsafePassword) return { ok: false, error: unsafePassword };
    return { ok: true, user: input.account.imapUsername, password };
  }

  if (input.account.oauthProvider) {
    return resolveOAuthMailAuth({
      workspaceId: input.workspaceId,
      account: input.account,
      store: input.store,
      oauthFetchImpl: input.oauthFetchImpl,
    });
  }
  return { ok: false, error: 'Kein IMAP-Passwort verfuegbar' };
}

async function resolveOAuthMailAuth(input: {
  workspaceId: string;
  account: ServerMailSyncAccount;
  store: Pick<ServerMailSyncStore, 'readSecret' | 'writeSecret' | 'getSyncInfo'>;
  oauthFetchImpl?: typeof fetch;
}): Promise<ResolvedMailAuth> {
  const provider = normalizeEmailOAuthProvider(input.account.oauthProvider);
  if (!provider) return { ok: false, error: 'OAuth-Provider wird serverseitig nicht unterstuetzt' };
  if (!input.store.readSecret) return { ok: false, error: 'Email account secret storage ist nicht konfiguriert' };
  const refreshIdentifier = emailAccountSecretIdentifier(input.workspaceId, input.account.id, 'oauth_refresh');
  const refreshSecret = await input.store.readSecret(refreshIdentifier);
  if (!refreshSecret) return { ok: false, error: 'OAuth-Refresh-Token fehlt' };
  const keys = EMAIL_OAUTH_APP_KEYS[provider];
  const settings = await input.store.getSyncInfo({
    workspaceId: input.workspaceId,
    keys: [keys.clientId, keys.clientSecret],
  });
  const clientId = settings.get(keys.clientId)?.trim() ?? '';
  const clientSecret = settings.get(keys.clientSecret)?.trim() ?? '';
  if (!clientId || !clientSecret) return { ok: false, error: 'OAuth-Appdaten sind serverseitig nicht konfiguriert' };
  const refreshToken = refreshSecret.toString('utf8');
  try {
    const refreshed = await refreshServerEmailOAuthAccessToken({
      provider,
      clientId,
      clientSecret,
      refreshToken,
      fetchImpl: input.oauthFetchImpl,
    });
    if (refreshed.refreshToken && refreshed.refreshToken !== refreshToken) {
      await input.store.writeSecret?.({ ...refreshIdentifier, value: refreshed.refreshToken });
    }
    return { ok: true, user: input.account.imapUsername, accessToken: refreshed.accessToken };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}

async function replaceMessageAttachmentsIfPresent(
  store: ServerMailSyncStore,
  input: {
    workspaceId: string;
    messageId: number;
    attachments: readonly ServerMailSyncParsedAttachment[] | undefined;
  },
): Promise<void> {
  if (!store.replaceMessageAttachments || input.messageId <= 0 || !input.attachments?.length) return;
  await store.replaceMessageAttachments({
    workspaceId: input.workspaceId,
    messageId: input.messageId,
    attachments: input.attachments,
  });
}

export async function replacePostgresMailSyncAttachments(input: {
  db: Kysely<ServerDatabase>;
  attachmentsRoot: string;
  workspaceId: string;
  messageId: number;
  attachments: readonly ServerMailSyncParsedAttachment[];
  applyWorkspaceSession?: WorkspaceSessionApplier;
}): Promise<void> {
  const message = await withWorkspaceTransaction(
    input.db,
    { workspaceId: input.workspaceId, role: 'system' },
    async (trx) => trx
      .selectFrom('email_messages')
      .select(['id', 'source_sqlite_id'])
      .where('workspace_id', '=', input.workspaceId)
      .where('id', '=', input.messageId)
      .executeTakeFirst(),
    { applySession: input.applyWorkspaceSession },
  );
  if (!message) return;

  const now = new Date();
  const rows: Array<{
    workspace_id: string;
    source_sqlite_id: number;
    message_source_sqlite_id: number;
    message_id: number;
    filename_display: string;
    content_type: string | null;
    size_bytes: number;
    storage_path: string;
    content_sha256: string;
    source_row: Record<string, string>;
    imported_in_run_id: null;
    created_at: Date;
    updated_at: Date;
  }> = [];
  const writtenPaths: string[] = [];

  for (const attachment of input.attachments) {
    const filename = sanitizeAttachmentFilename(attachment.filename);
    const storagePath = [
      input.workspaceId,
      'mail-sync',
      String(input.messageId),
      `${randomBytes(8).toString('hex')}-${filename}`,
    ].join('/');
    const resolvedPath = resolveAttachmentStoragePath(input.attachmentsRoot, storagePath);
    if (!resolvedPath) throw new Error('Anhangspeicherpfad ist ungueltig');
    await mkdir(path.dirname(resolvedPath), { recursive: true });
    await writeFile(resolvedPath, attachment.content, { flag: 'wx' });
    writtenPaths.push(resolvedPath);
    rows.push({
      workspace_id: input.workspaceId,
      source_sqlite_id: serverCreatedSourceSqliteId('email_message_attachments'),
      message_source_sqlite_id: Number(message.source_sqlite_id),
      message_id: input.messageId,
      filename_display: filename,
      content_type: attachment.contentType,
      size_bytes: attachment.sizeBytes,
      storage_path: storagePath,
      content_sha256: attachment.contentSha256,
      source_row: serverMailSyncSourceRow(),
      imported_in_run_id: null,
      created_at: now,
      updated_at: now,
    });
  }

  try {
    await withWorkspaceTransaction(
      input.db,
      { workspaceId: input.workspaceId, role: 'system' },
      async (trx) => {
        await trx
          .deleteFrom('email_message_attachments')
          .where('workspace_id', '=', input.workspaceId)
          .where('message_id', '=', input.messageId)
          .execute();
        if (rows.length > 0) {
          await trx.insertInto('email_message_attachments').values(rows).execute();
        }
      },
      { applySession: input.applyWorkspaceSession },
    );
  } catch (error) {
    await Promise.allSettled(writtenPaths.map((filePath) => rm(filePath, { force: true })));
    throw error;
  }
}

function resolveImapSyncFolders(
  account: ServerMailSyncAccount,
  listed: readonly MailboxListEntry[],
): ImapFolderSyncSpec[] {
  const specs: ImapFolderSyncSpec[] = [{
    path: 'INBOX',
    folderKind: 'inbox',
    archived: false,
    isSpam: false,
    runPostSync: true,
  }];
  const seen = new Set<string>(['inbox']);
  const push = (spec: ImapFolderSyncSpec | null): void => {
    if (!spec?.path.trim()) return;
    const key = spec.path.trim().toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    specs.push({ ...spec, path: spec.path.trim() });
  };
  if (account.imapSyncSent) {
    const path = resolveSentMailboxPath(account.sentFolderPath || 'Sent', listed);
    push(path ? {
      path,
      folderKind: 'sent',
      archived: false,
      isSpam: false,
      runPostSync: false,
    } : null);
  }
  if (account.imapSyncArchive) {
    const path = resolveMailboxBySpecialUseOrName(
      account.syncArchiveFolderPath,
      listed,
      '\\Archive',
      new Set(['archive', 'archives', 'archiv', 'all mail', 'all'].map(normalizeMailboxName)),
      ['Archive', 'Archiv'],
    );
    push(path ? {
      path,
      folderKind: 'inbox',
      archived: true,
      isSpam: false,
      runPostSync: false,
    } : null);
  }
  if (account.imapSyncSpam) {
    const path = resolveMailboxBySpecialUseOrName(
      account.syncSpamFolderPath,
      listed,
      '\\Junk',
      new Set(['spam', 'junk', 'bulk', 'unwanted', 'ungewollt'].map(normalizeMailboxName)),
      ['Spam', 'Junk'],
    );
    push(path ? {
      path,
      folderKind: 'inbox',
      archived: false,
      isSpam: true,
      runPostSync: false,
    } : null);
  }
  return specs;
}

function resolveSentMailboxPath(configuredFolder: string, listed: readonly MailboxListEntry[]): string | null {
  const mutableListed = [...listed];
  const candidates = resolveSentMailboxCandidates(configuredFolder, mutableListed);
  return pickFirstMailboxPathOnServer(candidates, mutableListed)
    ?? (listed.length > 0 ? findSentMailboxOnServer(mutableListed) : null)
    ?? candidates[0]
    ?? null;
}

function resolveMailboxBySpecialUseOrName(
  configured: string | null,
  listed: readonly MailboxListEntry[],
  specialUse: string,
  normalizedNames: ReadonlySet<string>,
  fallbacks: readonly string[],
): string | null {
  const candidates: string[] = [];
  const seen = new Set<string>();
  const push = (value: string | null | undefined): void => {
    const trimmed = value?.trim();
    if (!trimmed) return;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push(trimmed);
  };
  push(configured);
  for (const entry of listed) {
    if (mailboxHasSpecialUse(entry, specialUse)) push(entry.path);
  }
  for (const entry of listed) {
    const leaf = pathLeaf(entry.path, entry.delimiter);
    if (normalizedNames.has(normalizeMailboxName(entry.name)) || normalizedNames.has(normalizeMailboxName(leaf))) {
      push(entry.path);
    }
  }
  for (const fallback of fallbacks) push(fallback);
  return candidates[0] ?? null;
}

function createDefaultImapClient(input: Parameters<ServerMailSyncImapClientFactory>[0]): ServerMailSyncImapClient {
  const { ImapFlow } = require('imapflow') as {
    ImapFlow: new (options: Record<string, unknown>) => ServerMailSyncImapClient;
  };
  return new ImapFlow({
    host: input.host,
    port: input.port,
    secure: input.secure,
    auth: input.auth,
    logger: false,
    connectionTimeout: input.connectionTimeout,
    socketTimeout: input.socketTimeout,
  });
}

function createDefaultPop3Client(input: Parameters<ServerMailSyncPop3ClientFactory>[0]): ServerMailSyncPop3Client {
  return new LineProtocolPop3Client(input);
}

class LineProtocolPop3Client implements ServerMailSyncPop3Client {
  private socket: net.Socket | null = null;
  private buffer = '';
  private waiters: Array<(line: string) => void> = [];
  private errorWaiters: Array<(error: Error) => void> = [];
  private closedError: Error | null = null;
  private readonly onData = (chunk: Buffer | string): void => this.pushData(String(chunk));
  private readonly onError = (error: Error): void => this.rejectAll(error);
  private readonly onEnd = (): void => this.rejectAll(new Error('Connection closed'));

  constructor(private readonly input: Parameters<ServerMailSyncPop3ClientFactory>[0]) {}

  async connect(): Promise<void> {
    const unsafeUser = validateAuthValue(this.input.user, 'Benutzername')
      ?? validateAuthValue(this.input.password, 'Passwort');
    if (unsafeUser) throw new Error(unsafeUser);
    this.socket = await connectSocket(this.input);
    this.socket.setEncoding('latin1');
    this.socket.on('data', this.onData);
    this.socket.on('error', this.onError);
    this.socket.on('end', this.onEnd);
    const greeting = await this.readLine();
    assertPop3Ok(greeting);
    assertPop3Ok(await this.command(`USER ${this.input.user}`));
    assertPop3Ok(await this.command(`PASS ${this.input.password}`));
  }

  async uidl(): Promise<readonly [number, string][]> {
    await this.writeLine('UIDL');
    assertPop3Ok(await this.readLine());
    const lines = await this.readMultiline();
    return lines.map((line) => {
      const match = /^(\d+)\s+(.+)$/.exec(line);
      return match ? [Number(match[1]), match[2].trim()] as [number, string] : null;
    }).filter((entry): entry is [number, string] => entry !== null);
  }

  async retr(messageNumber: number): Promise<Buffer> {
    await this.writeLine(`RETR ${messageNumber}`);
    assertPop3Ok(await this.readLine());
    const lines = await this.readMultiline();
    return Buffer.from(lines.join('\r\n'), 'latin1');
  }

  async quit(): Promise<void> {
    try {
      if (this.socket && !this.socket.destroyed) await this.command('QUIT').catch(() => undefined);
    } finally {
      this.close();
    }
  }

  private async command(command: string): Promise<string> {
    await this.writeLine(command);
    return this.readLine();
  }

  private async writeLine(command: string): Promise<void> {
    if (!this.socket || this.socket.destroyed) throw new Error('POP3 connection is closed');
    this.socket.write(`${command}\r\n`, 'latin1');
  }

  private async readMultiline(): Promise<string[]> {
    const lines: string[] = [];
    for (;;) {
      const line = await this.readLine();
      if (line === '.') return lines;
      lines.push(line.startsWith('..') ? line.slice(1) : line);
    }
  }

  private async readLine(): Promise<string> {
    if (this.closedError) throw this.closedError;
    const existing = this.shiftLine();
    if (existing !== null) return existing;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('Connection timed out'));
      }, this.input.timeoutMs);
      const cleanup = (): void => {
        clearTimeout(timer);
        const resolveIndex = this.waiters.indexOf(onLine);
        if (resolveIndex >= 0) this.waiters.splice(resolveIndex, 1);
        const rejectIndex = this.errorWaiters.indexOf(onError);
        if (rejectIndex >= 0) this.errorWaiters.splice(rejectIndex, 1);
      };
      const onLine = (line: string): void => {
        cleanup();
        resolve(line);
      };
      const onError = (error: Error): void => {
        cleanup();
        reject(error);
      };
      this.waiters.push(onLine);
      this.errorWaiters.push(onError);
    });
  }

  private pushData(chunk: string): void {
    this.buffer += chunk;
    for (;;) {
      const line = this.shiftLine();
      if (line === null) return;
      const waiter = this.waiters.shift();
      if (!waiter) {
        this.buffer = `${line}\r\n${this.buffer}`;
        return;
      }
      waiter(line);
    }
  }

  private shiftLine(): string | null {
    const crlf = this.buffer.indexOf('\r\n');
    const lf = this.buffer.indexOf('\n');
    const index = crlf >= 0 ? crlf : lf;
    if (index < 0) return null;
    const line = this.buffer.slice(0, index).replace(/\r$/, '');
    this.buffer = this.buffer.slice(index + (crlf >= 0 ? 2 : 1));
    return line;
  }

  private rejectAll(error: Error): void {
    this.closedError = error;
    const waiters = [...this.errorWaiters];
    this.waiters = [];
    this.errorWaiters = [];
    waiters.forEach((waiter) => waiter(error));
  }

  private close(): void {
    if (!this.socket) return;
    this.socket.off('data', this.onData);
    this.socket.off('error', this.onError);
    this.socket.off('end', this.onEnd);
    this.socket.end();
    this.socket.destroy();
  }
}

async function connectSocket(input: {
  host: string;
  port: number;
  tls: boolean;
  timeoutMs: number;
}): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error): void => {
      socket.destroy();
      reject(error);
    };
    const socket = input.tls
      ? tls.connect({ host: input.host, port: input.port, servername: input.host })
      : net.connect({ host: input.host, port: input.port });
    socket.setTimeout(input.timeoutMs, () => onError(new Error('Connection timed out')));
    socket.once('error', onError);
    socket.once(input.tls ? 'secureConnect' : 'connect', () => {
      socket.off('error', onError);
      socket.setTimeout(0);
      resolve(socket);
    });
  });
}

function mapMailSyncAccount(row: Pick<EmailAccountRow,
  | 'id'
  | 'source_sqlite_id'
  | 'protocol'
  | 'imap_host'
  | 'imap_port'
  | 'imap_tls'
  | 'imap_username'
  | 'oauth_provider'
  | 'pop3_host'
  | 'pop3_port'
  | 'pop3_tls'
  | 'sent_folder_path'
  | 'sync_spam_folder_path'
  | 'sync_archive_folder_path'
  | 'imap_sync_sent'
  | 'imap_sync_archive'
  | 'imap_sync_spam'
>): ServerMailSyncAccount {
  return {
    id: Number(row.id),
    sourceSqliteId: Number(row.source_sqlite_id),
    protocol: row.protocol,
    imapHost: row.imap_host,
    imapPort: Number(row.imap_port),
    imapTls: Boolean(row.imap_tls),
    imapUsername: row.imap_username,
    oauthProvider: row.oauth_provider,
    pop3Host: row.pop3_host,
    pop3Port: row.pop3_port == null ? null : Number(row.pop3_port),
    pop3Tls: Boolean(row.pop3_tls),
    sentFolderPath: row.sent_folder_path,
    syncSpamFolderPath: row.sync_spam_folder_path,
    syncArchiveFolderPath: row.sync_archive_folder_path,
    imapSyncSent: Boolean(row.imap_sync_sent),
    imapSyncArchive: Boolean(row.imap_sync_archive),
    imapSyncSpam: Boolean(row.imap_sync_spam),
  };
}

function mapMailSyncFolder(row: Pick<EmailFolderRow,
  | 'id'
  | 'source_sqlite_id'
  | 'account_source_sqlite_id'
  | 'path'
  | 'delimiter'
  | 'uidvalidity'
  | 'uidvalidity_str'
  | 'last_uid'
  | 'pop3_uidl_str'
>): ServerMailSyncFolder {
  return {
    id: Number(row.id),
    sourceSqliteId: Number(row.source_sqlite_id),
    accountSourceSqliteId: Number(row.account_source_sqlite_id),
    path: row.path,
    delimiter: row.delimiter,
    uidvalidity: row.uidvalidity == null ? null : Number(row.uidvalidity),
    uidvalidityStr: row.uidvalidity_str,
    lastUid: Number(row.last_uid),
    pop3UidlStr: row.pop3_uidl_str,
  };
}

function flagsContainSeen(flags: Set<string> | string[] | null | undefined): boolean {
  if (!flags) return false;
  const values = Array.isArray(flags) ? flags : [...flags];
  return values.some((flag) => flag.toLowerCase() === '\\seen');
}

function mailboxHasSpecialUse(entry: MailboxListEntry, token: string): boolean {
  const normalized = token.toLowerCase();
  if (entry.specialUse?.toLowerCase() === normalized) return true;
  const flag = token.startsWith('\\') ? token : `\\${token}`;
  return entry.flags?.has?.(flag) || entry.flags?.has?.(flag.toLowerCase()) || false;
}

function pathLeaf(pathValue: string, delimiter: string | undefined): string {
  const delimiters = [delimiter, '/', '.'].filter(Boolean) as string[];
  let leaf = pathValue;
  for (const delimiterValue of delimiters) {
    const index = leaf.lastIndexOf(delimiterValue);
    if (index >= 0) leaf = leaf.slice(index + delimiterValue.length);
  }
  return leaf;
}

function normalizeFirstSyncMaxMessages(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return FIRST_SYNC_MAX_MESSAGES;
  return Math.max(1, Math.min(20_000, Math.trunc(value)));
}

function uniquePositiveIds(values: readonly number[]): number[] {
  const seen = new Set<number>();
  const result: number[] = [];
  for (const value of values) {
    if (!Number.isSafeInteger(value) || value <= 0 || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

function uniqueSafeIntegers(values: readonly number[]): number[] {
  const seen = new Set<number>();
  const result: number[] = [];
  for (const value of values) {
    if (!Number.isSafeInteger(value) || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

function normalizeEmailOAuthProvider(value: string | null): EmailOAuthProvider | null {
  return value === 'google' || value === 'microsoft' ? value : null;
}

function emailAccountSecretIdentifier(
  workspaceId: string,
  accountId: number,
  secret: 'imap' | 'oauth_refresh',
): SecretIdentifier {
  return {
    workspaceId,
    kind: secret === 'imap'
      ? 'email.account.imap_password'
      : 'email.account.oauth_refresh_token',
    name: `email_account:${accountId}:${secret}`,
  };
}

function serverCreatedSourceSqliteId(kind: string): number {
  serverMailSyncSourceCounter = (serverMailSyncSourceCounter + 1) % 1_000_000;
  let hash = 14_695_981_039_346_656_037n;
  for (let index = 0; index < kind.length; index += 1) {
    hash ^= BigInt(kind.charCodeAt(index));
    hash *= 1_099_511_628_211n;
    hash &= 0xffff_ffff_ffff_ffffn;
  }
  return -Number((BigInt(Date.now()) * 1000n) + BigInt(serverMailSyncSourceCounter % 1000) + (hash % 997n));
}

function serverMailSyncSourceRow(): Record<string, string> {
  return { origin: 'server_mail_sync' };
}

function validateAuthValue(value: string, label: string): string | null {
  return /[\r\n]/.test(value) ? `${label} enthaelt ungueltige Zeilenumbrueche` : null;
}

function assertPop3Ok(line: string): void {
  if (!/^\+OK\b/i.test(line)) throw new Error(line);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
