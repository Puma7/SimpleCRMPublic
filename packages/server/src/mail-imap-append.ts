import type { Kysely } from 'kysely';
import {
  findSentMailboxOnServer,
  pickFirstMailboxPathOnServer,
  resolveSentMailboxCandidates,
  type MailboxListEntry,
} from '@simplecrm/core';

import type { EmailOAuthProvider } from './api';
import type { PostgresSecretPort, SecretIdentifier } from './db';
import type { ServerDatabase } from './db/schema';
import { withWorkspaceTransaction } from './db/workspace-context';
import { refreshServerEmailOAuthAccessToken } from './email-oauth';

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

const DEFAULT_TIMEOUT_MS = 90_000;

export type ServerImapSentCopyAccount = Readonly<{
  id: number;
  protocol: string;
  imapHost: string;
  imapPort: number;
  imapTls: boolean;
  imapUsername: string;
  oauthProvider: string | null;
  sentFolderPath: string | null;
}>;

export type ServerImapAuthAccount = Pick<ServerImapSentCopyAccount, 'id' | 'imapUsername' | 'oauthProvider'>;

export type ServerImapSentCopyAppendInput = Readonly<{
  workspaceId: string;
  accountId: number;
  rfc822: string | Buffer;
  estimatedBytes?: number;
}>;

export type ServerImapSentCopyAppendResult =
  | { ok: true; mailbox: string }
  | { ok: true; skipped: true; reason: string }
  | { ok: false; error: string };

export type ServerImapSentCopyAppender = Readonly<{
  append(input: ServerImapSentCopyAppendInput): Promise<ServerImapSentCopyAppendResult>;
}>;

export type ServerImapSentCopyStore = Readonly<{
  getAccount(input: {
    workspaceId: string;
    accountId: number;
  }): Promise<ServerImapSentCopyAccount | null>;
  readSecret?(input: SecretIdentifier): Promise<Buffer | null>;
  writeSecret?(input: SecretIdentifier & { value: string | Buffer }): Promise<unknown>;
  getSyncInfo(input: {
    workspaceId: string;
    keys: readonly string[];
  }): Promise<ReadonlyMap<string, string | null>>;
}>;

export type ServerImapAppendClient = Readonly<{
  connect(): Promise<void>;
  list(): Promise<MailboxListEntry[]>;
  mailboxOpen(path: string): Promise<unknown>;
  append(path: string, source: Buffer, flags: readonly string[]): Promise<unknown>;
  logout(): Promise<unknown>;
}>;

export type ServerImapAppendClientFactory = (input: {
  host: string;
  port: number;
  secure: boolean;
  auth:
    | { user: string; pass: string }
    | { user: string; accessToken: string };
  connectionTimeout: number;
  socketTimeout: number;
}) => ServerImapAppendClient;

export type ServerImapSentCopyAppenderOptions = Readonly<{
  store: ServerImapSentCopyStore;
  imapClientFactory?: ServerImapAppendClientFactory;
  oauthFetchImpl?: typeof fetch;
}>;

export type PostgresServerImapSentCopyAppenderOptions = Readonly<{
  db: Kysely<ServerDatabase>;
  secrets?: PostgresSecretPort;
  imapClientFactory?: ServerImapAppendClientFactory;
  oauthFetchImpl?: typeof fetch;
}>;

export function createServerImapSentCopyAppenderPort(
  options: ServerImapSentCopyAppenderOptions,
): ServerImapSentCopyAppender {
  const imapClientFactory = options.imapClientFactory ?? createDefaultImapClient;

  return {
    async append(input) {
      const account = await options.store.getAccount({
        workspaceId: input.workspaceId,
        accountId: input.accountId,
      });
      if (!account) return { ok: false, error: 'Konto nicht gefunden' };
      if ((account.protocol || 'imap') !== 'imap') {
        return {
          ok: true,
          skipped: true,
          reason: 'POP3-Konten koennen keine Kopie per IMAP auf dem Server ablegen.',
        };
      }

      const auth = await resolveServerImapAuth({
        workspaceId: input.workspaceId,
        account,
        readSecret: options.store.readSecret,
        writeSecret: options.store.writeSecret,
        getSyncInfo: options.store.getSyncInfo,
        oauthFetchImpl: options.oauthFetchImpl,
      });
      if (!auth.ok) return { ok: false, error: auth.error };

      const source = Buffer.isBuffer(input.rfc822)
        ? input.rfc822
        : Buffer.from(input.rfc822, 'utf8');
      const timeouts = imapTimeoutsForMessageBytes(input.estimatedBytes ?? source.length);
      const client = imapClientFactory({
        host: account.imapHost,
        port: account.imapPort,
        secure: account.imapTls,
        auth: auth.accessToken
          ? { user: auth.user, accessToken: auth.accessToken }
          : { user: auth.user, pass: auth.password ?? '' },
        connectionTimeout: timeouts.connectionTimeout,
        socketTimeout: timeouts.socketTimeout,
      });

      try {
        await client.connect();
        let listedMailboxes: MailboxListEntry[] = [];
        try {
          listedMailboxes = await client.list();
        } catch {
          listedMailboxes = [];
        }

        const candidates = orderedSentMailboxCandidates(account.sentFolderPath || 'Sent', listedMailboxes);
        const failures: string[] = [];
        for (const mailbox of candidates) {
          try {
            await client.mailboxOpen(mailbox);
            const appended = await client.append(mailbox, source, ['\\Seen']);
            if (appended === false) {
              throw new Error('IMAP APPEND wurde vom Server abgelehnt.');
            }
            return { ok: true, mailbox };
          } catch (error) {
            failures.push(`${mailbox}: ${errorMessage(error)}`);
          }
        }
        return {
          ok: false,
          error: `Kein beschreibbarer IMAP-Gesendet-Ordner gefunden. Versucht: ${failures.join('; ')}`,
        };
      } catch (error) {
        return { ok: false, error: errorMessage(error) };
      } finally {
        await client.logout().catch(() => undefined);
      }
    },
  };
}

export function createPostgresServerImapSentCopyAppenderPort(
  options: PostgresServerImapSentCopyAppenderOptions,
): ServerImapSentCopyAppender {
  return createServerImapSentCopyAppenderPort({
    imapClientFactory: options.imapClientFactory,
    oauthFetchImpl: options.oauthFetchImpl,
    store: createPostgresServerImapSentCopyStore(options),
  });
}

function createPostgresServerImapSentCopyStore(
  options: PostgresServerImapSentCopyAppenderOptions,
): ServerImapSentCopyStore {
  return {
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
              'sent_folder_path',
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
              sentFolderPath: row.sent_folder_path,
            }
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

export function imapTimeoutsForMessageBytes(bytes: number): {
  connectionTimeout: number;
  socketTimeout: number;
} {
  const baseConn = DEFAULT_TIMEOUT_MS;
  const baseSock = 120_000;
  const mb = Math.max(0, bytes / (1024 * 1024));
  const extra = Math.min(Math.ceil(mb) * 45_000, 600_000);
  return {
    connectionTimeout: baseConn + extra,
    socketTimeout: baseSock + extra,
  };
}

function orderedSentMailboxCandidates(
  configuredFolder: string,
  listedMailboxes: MailboxListEntry[],
): string[] {
  const candidates = resolveSentMailboxCandidates(configuredFolder, listedMailboxes);
  const primary = pickFirstMailboxPathOnServer(candidates, listedMailboxes)
    ?? (listedMailboxes.length > 0 ? findSentMailboxOnServer(listedMailboxes) : null)
    ?? candidates[0]
    ?? null;
  const ordered: string[] = [];
  const seen = new Set<string>();
  const push = (value: string | null | undefined): void => {
    const trimmed = value?.trim();
    if (!trimmed) return;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    ordered.push(trimmed);
  };
  push(primary);
  for (const candidate of candidates) push(candidate);
  return ordered;
}

export type ResolvedServerImapAuth =
  | { ok: true; user: string; password: string; accessToken?: undefined }
  | { ok: true; user: string; accessToken: string; password?: undefined }
  | { ok: false; error: string };

export async function resolveServerImapAuth(input: {
  workspaceId: string;
  account: ServerImapAuthAccount;
  readSecret?: (input: SecretIdentifier) => Promise<Buffer | null>;
  writeSecret?: (input: SecretIdentifier & { value: string | Buffer }) => Promise<unknown>;
  getSyncInfo: (input: {
    workspaceId: string;
    keys: readonly string[];
  }) => Promise<ReadonlyMap<string, string | null>>;
  oauthFetchImpl?: typeof fetch;
}): Promise<ResolvedServerImapAuth> {
  const unsafeUser = validateAuthValue(input.account.imapUsername, 'Benutzername');
  if (unsafeUser) return { ok: false, error: unsafeUser };
  if (!input.readSecret) {
    return { ok: false, error: 'Email account secret storage ist nicht konfiguriert' };
  }

  const imapSecret = await input.readSecret(emailAccountSecretIdentifier(input.workspaceId, input.account.id, 'imap'));
  if (imapSecret) {
    const password = imapSecret.toString('utf8');
    const unsafePassword = validateAuthValue(password, 'Passwort');
    if (unsafePassword) return { ok: false, error: unsafePassword };
    return {
      ok: true,
      user: input.account.imapUsername,
      password,
    };
  }

  if (input.account.oauthProvider) {
    return resolveOAuthImapAuth({
      workspaceId: input.workspaceId,
      account: input.account,
      readSecret: input.readSecret,
      writeSecret: input.writeSecret,
      getSyncInfo: input.getSyncInfo,
      oauthFetchImpl: input.oauthFetchImpl,
    });
  }
  return { ok: false, error: 'Kein IMAP-Passwort verfuegbar' };
}

async function resolveOAuthImapAuth(input: {
  workspaceId: string;
  account: ServerImapAuthAccount;
  readSecret: (input: SecretIdentifier) => Promise<Buffer | null>;
  writeSecret?: (input: SecretIdentifier & { value: string | Buffer }) => Promise<unknown>;
  getSyncInfo: (input: {
    workspaceId: string;
    keys: readonly string[];
  }) => Promise<ReadonlyMap<string, string | null>>;
  oauthFetchImpl?: typeof fetch;
}): Promise<ResolvedServerImapAuth> {
  const provider = normalizeEmailOAuthProvider(input.account.oauthProvider);
  if (!provider) return { ok: false, error: 'OAuth-Provider wird serverseitig nicht unterstuetzt' };

  const refreshIdentifier = emailAccountSecretIdentifier(input.workspaceId, input.account.id, 'oauth_refresh');
  const refreshSecret = await input.readSecret(refreshIdentifier);
  if (!refreshSecret) return { ok: false, error: 'OAuth-Refresh-Token fehlt' };

  const keys = EMAIL_OAUTH_APP_KEYS[provider];
  const settings = await input.getSyncInfo({
    workspaceId: input.workspaceId,
    keys: [keys.clientId, keys.clientSecret],
  });
  const clientId = settings.get(keys.clientId)?.trim() ?? '';
  const clientSecret = settings.get(keys.clientSecret)?.trim() ?? '';
  if (!clientId || !clientSecret) {
    return { ok: false, error: 'OAuth-Appdaten sind serverseitig nicht konfiguriert' };
  }

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
      await input.writeSecret?.({ ...refreshIdentifier, value: refreshed.refreshToken });
    }
    return {
      ok: true,
      user: input.account.imapUsername,
      accessToken: refreshed.accessToken,
    };
  } catch (error) {
    return {
      ok: false,
      error: errorMessage(error),
    };
  }
}

function normalizeEmailOAuthProvider(value: string | null): EmailOAuthProvider | null {
  return value === 'google' || value === 'microsoft' ? value : null;
}

export function emailAccountSecretIdentifier(
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

function createDefaultImapClient(
  input: Parameters<ServerImapAppendClientFactory>[0],
): ServerImapAppendClient {
  const { ImapFlow } = require('imapflow') as {
    ImapFlow: new (options: Record<string, unknown>) => ServerImapAppendClient;
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

function validateAuthValue(value: string, label: string): string | null {
  return /[\r\n]/.test(value) ? `${label} enthaelt ungueltige Zeilenumbrueche` : null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
