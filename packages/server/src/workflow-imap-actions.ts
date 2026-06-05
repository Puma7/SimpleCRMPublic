import type { Kysely } from 'kysely';

import type { PostgresSecretPort, SecretIdentifier } from './db';
import type { ServerDatabase } from './db/schema';
import { withWorkspaceTransaction } from './db/workspace-context';
import {
  resolveServerImapAuth,
  type ServerImapAuthAccount,
} from './mail-imap-append';

const WORKFLOW_IMAP_DELETE_OPT_IN_KEY = 'workflow_imap_delete_opt_in';
const WORKFLOW_IMAP_CONNECTION_TIMEOUT_MS = 60_000;
const WORKFLOW_IMAP_SOCKET_TIMEOUT_MS = 90_000;

export type ServerWorkflowImapActionAccount = ServerImapAuthAccount & Readonly<{
  protocol: string;
  imapHost: string;
  imapPort: number;
  imapTls: boolean;
}>;

export type ServerWorkflowImapActionMessage = Readonly<{
  id: number;
  accountId: number | null;
  folderId: number | null;
  uid: number;
  pop3Uidl: string | null;
  folderKind: string | null;
}>;

export type ServerWorkflowImapActionFolder = Readonly<{
  id: number;
  path: string;
}>;

export type ServerWorkflowImapActionInput = Readonly<{
  workspaceId: string;
  messageId: number;
}>;

export type ServerWorkflowImapMoveInput = ServerWorkflowImapActionInput & Readonly<{
  targetFolderPath: string;
}>;

export type ServerWorkflowImapSetSeenInput = ServerWorkflowImapActionInput & Readonly<{
  seen: boolean;
}>;

export type ServerWorkflowImapActionResult =
  | { ok: true; sourceFolderPath: string; targetFolderPath?: string }
  | { ok: false; error: string };

export type ServerWorkflowImapActionPort = Readonly<{
  move(input: ServerWorkflowImapMoveInput): Promise<ServerWorkflowImapActionResult>;
  delete(input: ServerWorkflowImapActionInput): Promise<ServerWorkflowImapActionResult>;
  setSeen(input: ServerWorkflowImapSetSeenInput): Promise<ServerWorkflowImapActionResult>;
}>;

export type ServerWorkflowImapActionStore = Readonly<{
  getMessage(input: ServerWorkflowImapActionInput): Promise<ServerWorkflowImapActionMessage | null>;
  getAccount(input: {
    workspaceId: string;
    accountId: number;
  }): Promise<ServerWorkflowImapActionAccount | null>;
  getFolder(input: {
    workspaceId: string;
    folderId: number;
  }): Promise<ServerWorkflowImapActionFolder | null>;
  readSecret?(input: SecretIdentifier): Promise<Buffer | null>;
  writeSecret?(input: SecretIdentifier & { value: string | Buffer }): Promise<unknown>;
  getSyncInfo(input: {
    workspaceId: string;
    keys: readonly string[];
  }): Promise<ReadonlyMap<string, string | null>>;
}>;

export type ServerWorkflowImapActionClientLock = Readonly<{
  release(): void;
}>;

export type ServerWorkflowImapActionClient = Readonly<{
  connect(): Promise<void>;
  getMailboxLock(path: string): Promise<ServerWorkflowImapActionClientLock>;
  messageMove(range: { uid: number }, target: string, options: { uid: true }): Promise<unknown>;
  messageDelete(range: { uid: number }, options: { uid: true }): Promise<unknown>;
  messageFlagsAdd(range: { uid: number }, flags: readonly string[], options: { uid: true }): Promise<unknown>;
  messageFlagsRemove(range: { uid: number }, flags: readonly string[], options: { uid: true }): Promise<unknown>;
  logout(): Promise<unknown>;
}>;

export type ServerWorkflowImapActionClientFactory = (input: {
  host: string;
  port: number;
  secure: boolean;
  auth:
    | { user: string; pass: string }
    | { user: string; accessToken: string };
  connectionTimeout: number;
  socketTimeout: number;
}) => ServerWorkflowImapActionClient;

export type ServerWorkflowImapActionOptions = Readonly<{
  store: ServerWorkflowImapActionStore;
  imapClientFactory?: ServerWorkflowImapActionClientFactory;
  oauthFetchImpl?: typeof fetch;
}>;

export type PostgresWorkflowImapActionOptions = Readonly<{
  db: Kysely<ServerDatabase>;
  secrets?: PostgresSecretPort;
  imapClientFactory?: ServerWorkflowImapActionClientFactory;
  oauthFetchImpl?: typeof fetch;
}>;

export function createServerWorkflowImapActionPort(
  options: ServerWorkflowImapActionOptions,
): ServerWorkflowImapActionPort {
  const imapClientFactory = options.imapClientFactory ?? createDefaultImapActionClient;

  return {
    async move(input) {
      const target = input.targetFolderPath.trim();
      if (!target) return { ok: false, error: 'Zielordner fehlt' };
      return runImapAction({
        store: options.store,
        imapClientFactory,
        oauthFetchImpl: options.oauthFetchImpl,
        input,
        action: async (client, message) => {
          const sourceFolderPath = await resolveSourceFolderPath(options.store, input.workspaceId, message);
          const lock = await client.getMailboxLock(sourceFolderPath);
          try {
            await client.messageMove({ uid: message.uid }, target, { uid: true });
          } finally {
            lock.release();
          }
          return { ok: true, sourceFolderPath, targetFolderPath: target };
        },
      });
    },
    async delete(input) {
      const settings = await options.store.getSyncInfo({
        workspaceId: input.workspaceId,
        keys: [WORKFLOW_IMAP_DELETE_OPT_IN_KEY],
      });
      if (!syncInfoFlag(settings.get(WORKFLOW_IMAP_DELETE_OPT_IN_KEY), false)) {
        return { ok: false, error: 'Server-Loeschung nicht aktiviert (workflow_imap_delete_opt_in)' };
      }
      return runImapAction({
        store: options.store,
        imapClientFactory,
        oauthFetchImpl: options.oauthFetchImpl,
        input,
        action: async (client, message) => {
          const sourceFolderPath = await resolveSourceFolderPath(options.store, input.workspaceId, message);
          const lock = await client.getMailboxLock(sourceFolderPath);
          try {
            await client.messageDelete({ uid: message.uid }, { uid: true });
          } finally {
            lock.release();
          }
          return { ok: true, sourceFolderPath };
        },
      });
    },
    async setSeen(input) {
      return runImapAction({
        store: options.store,
        imapClientFactory,
        oauthFetchImpl: options.oauthFetchImpl,
        input,
        action: async (client, message) => {
          const sourceFolderPath = await resolveSourceFolderPath(options.store, input.workspaceId, message);
          const lock = await client.getMailboxLock(sourceFolderPath);
          try {
            if (input.seen) {
              await client.messageFlagsAdd({ uid: message.uid }, ['\\Seen'], { uid: true });
            } else {
              await client.messageFlagsRemove({ uid: message.uid }, ['\\Seen'], { uid: true });
            }
          } finally {
            lock.release();
          }
          return { ok: true, sourceFolderPath };
        },
      });
    },
  };
}

export function createPostgresWorkflowImapActionPort(
  options: PostgresWorkflowImapActionOptions,
): ServerWorkflowImapActionPort {
  return createServerWorkflowImapActionPort({
    imapClientFactory: options.imapClientFactory,
    oauthFetchImpl: options.oauthFetchImpl,
    store: createPostgresWorkflowImapActionStore(options),
  });
}

async function runImapAction(input: {
  store: ServerWorkflowImapActionStore;
  imapClientFactory: ServerWorkflowImapActionClientFactory;
  oauthFetchImpl?: typeof fetch;
  input: ServerWorkflowImapActionInput;
  action(
    client: ServerWorkflowImapActionClient,
    message: ServerWorkflowImapActionMessage,
  ): Promise<ServerWorkflowImapActionResult>;
}): Promise<ServerWorkflowImapActionResult> {
  const message = await input.store.getMessage(input.input);
  if (!message) return { ok: false, error: 'Nachricht nicht gefunden' };
  if (!message.accountId) return { ok: false, error: 'Nachricht hat kein Email-Konto' };
  if (message.uid < 0 || message.pop3Uidl) {
    return { ok: false, error: 'POP3- oder Entwurfs-Nachrichten koennen nicht per IMAP veraendert werden' };
  }

  const account = await input.store.getAccount({
    workspaceId: input.input.workspaceId,
    accountId: message.accountId,
  });
  if (!account) return { ok: false, error: 'Konto nicht gefunden' };
  if ((account.protocol || 'imap') !== 'imap') {
    return { ok: false, error: 'Nur IMAP-Nachrichten koennen auf dem Server veraendert werden' };
  }

  const auth = await resolveServerImapAuth({
    workspaceId: input.input.workspaceId,
    account,
    readSecret: input.store.readSecret,
    writeSecret: input.store.writeSecret,
    getSyncInfo: input.store.getSyncInfo,
    oauthFetchImpl: input.oauthFetchImpl,
  });
  if (!auth.ok) return { ok: false, error: auth.error };

  const client = input.imapClientFactory({
    host: account.imapHost,
    port: account.imapPort,
    secure: account.imapTls,
    auth: auth.accessToken
      ? { user: auth.user, accessToken: auth.accessToken }
      : { user: auth.user, pass: auth.password ?? '' },
    connectionTimeout: WORKFLOW_IMAP_CONNECTION_TIMEOUT_MS,
    socketTimeout: WORKFLOW_IMAP_SOCKET_TIMEOUT_MS,
  });

  try {
    await client.connect();
    return await input.action(client, message);
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  } finally {
    await client.logout().catch(() => undefined);
  }
}

async function resolveSourceFolderPath(
  store: ServerWorkflowImapActionStore,
  workspaceId: string,
  message: ServerWorkflowImapActionMessage,
): Promise<string> {
  if (message.folderId) {
    const folder = await store.getFolder({ workspaceId, folderId: message.folderId });
    if (folder?.path.trim()) return folder.path.trim();
  }
  const folderKind = String(message.folderKind ?? '').trim().toLowerCase();
  if (!folderKind || folderKind === 'inbox') return 'INBOX';
  throw new Error('Quellordner unbekannt');
}

function createPostgresWorkflowImapActionStore(
  options: PostgresWorkflowImapActionOptions,
): ServerWorkflowImapActionStore {
  return {
    async getMessage(input) {
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          const row = await trx
            .selectFrom('email_messages')
            .select(['id', 'account_id', 'folder_id', 'uid', 'pop3_uidl', 'folder_kind'])
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.messageId)
            .executeTakeFirst();
          return row
            ? {
              id: Number(row.id),
              accountId: row.account_id === null || row.account_id === undefined ? null : Number(row.account_id),
              folderId: row.folder_id === null || row.folder_id === undefined ? null : Number(row.folder_id),
              uid: Number(row.uid),
              pop3Uidl: row.pop3_uidl,
              folderKind: row.folder_kind,
            }
            : null;
        },
      );
    },
    async getAccount(input) {
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          const row = await trx
            .selectFrom('email_accounts')
            .select([
              'id',
              'protocol',
              'imap_host',
              'imap_port',
              'imap_tls',
              'imap_username',
              'oauth_provider',
            ])
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.accountId)
            .executeTakeFirst();
          return row
            ? {
              id: Number(row.id),
              protocol: row.protocol,
              imapHost: row.imap_host,
              imapPort: Number(row.imap_port),
              imapTls: Boolean(row.imap_tls),
              imapUsername: row.imap_username,
              oauthProvider: row.oauth_provider,
            }
            : null;
        },
      );
    },
    async getFolder(input) {
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          const row = await trx
            .selectFrom('email_folders')
            .select(['id', 'path'])
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.folderId)
            .executeTakeFirst();
          return row
            ? { id: Number(row.id), path: row.path }
            : null;
        },
      );
    },
    async readSecret(input) {
      return options.secrets?.readSecret(input) ?? null;
    },
    async writeSecret(input) {
      await options.secrets?.writeSecret(input);
    },
    async getSyncInfo(input) {
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
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
        },
      );
    },
  };
}

function createDefaultImapActionClient(
  input: Parameters<ServerWorkflowImapActionClientFactory>[0],
): ServerWorkflowImapActionClient {
  const { ImapFlow } = require('imapflow') as {
    ImapFlow: new (options: Record<string, unknown>) => ServerWorkflowImapActionClient;
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

function syncInfoFlag(value: string | null | undefined, fallback: boolean): boolean {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized) return fallback;
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
