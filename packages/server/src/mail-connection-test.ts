import net from 'node:net';
import tls from 'node:tls';

import type { Kysely } from 'kysely';

import {
  buildComposeRfc822,
  resolveConfiguredSmtpHost,
  SMTP_HOST_MISSING_ERROR,
} from '@simplecrm/core';

import type {
  EmailOAuthProvider,
  MailConnectionTestApiPort,
  MailConnectionTestInput,
  MailConnectionTestResult,
} from './api';
import type { PostgresSecretPort } from './db';
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

type SocketFactory = (input: {
  host: string;
  port: number;
  tls: boolean;
  timeoutMs: number;
}) => Promise<net.Socket>;

type ServerMailConnectionTestPortOptions = Readonly<{
  db?: Kysely<ServerDatabase>;
  secrets?: PostgresSecretPort;
  socketFactory?: SocketFactory;
  oauthFetchImpl?: typeof fetch;
  timeoutMs?: number;
}>;

type StoredAccountConnectionSettings = Readonly<{
  id: number;
  imapHost: string;
  imapPort: number;
  imapTls: boolean;
  imapUsername: string;
  smtpHost: string | null;
  smtpPort: number | null;
  smtpTls: boolean;
  smtpUsername: string | null;
  smtpUseImapAuth: boolean;
  oauthProvider: string | null;
  pop3Host: string | null;
  pop3Port: number | null;
  pop3Tls: boolean | null;
}>;

const DEFAULT_TIMEOUT_MS = 25_000;

export function createServerMailConnectionTestPort(
  options: ServerMailConnectionTestPortOptions = {},
): MailConnectionTestApiPort {
  const socketFactory = options.socketFactory ?? connectSocket;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return {
    async testImap(input) {
      const resolved = await resolveImapInput(input, options);
      if (!('resolved' in resolved)) return resolved;
      return testImapConnection({ ...resolved.value, socketFactory, timeoutMs });
    },
    async testPop3(input) {
      const resolved = await resolvePop3Input(input, options);
      if (!('resolved' in resolved)) return resolved;
      return testPop3Connection({ ...resolved.value, socketFactory, timeoutMs });
    },
    async testSmtp(input) {
      const resolved = await resolveSmtpInput(input, options);
      if (!('resolved' in resolved)) return resolved;
      return testSmtpConnection({ ...resolved.value, socketFactory, timeoutMs });
    },
  };
}

async function resolveImapInput(
  input: MailConnectionTestInput,
  options: ServerMailConnectionTestPortOptions,
): Promise<{ resolved: true; value: RequiredConnectionInput } | MailConnectionTestResult> {
  const account = await loadStoredAccount(input, options);
  if (input.accountId != null && !account) {
    return { success: false, error: 'Konto nicht gefunden' };
  }
  const password = await resolvePassword(input, account, options);
  if (!password) {
    return {
      success: false,
      error: 'Kein Passwort angegeben (Feld ausfuellen oder gespeichertes Konto testen).',
    };
  }
  return {
    resolved: true,
    value: {
      host: input.host,
      port: input.port,
      tls: input.tls,
      user: input.user,
      password,
    },
  };
}

async function resolvePop3Input(
  input: MailConnectionTestInput,
  options: ServerMailConnectionTestPortOptions,
): Promise<{ resolved: true; value: RequiredConnectionInput } | MailConnectionTestResult> {
  const account = await loadStoredAccount(input, options);
  if (input.accountId != null && !account) {
    return { success: false, error: 'Konto nicht gefunden' };
  }
  const host = input.host?.trim() || account?.pop3Host?.trim() || '';
  if (!host) {
    return { success: false, error: 'POP3-Host fehlt' };
  }
  const password = await resolvePassword(input, account, options);
  if (!password) return { success: false, error: 'Kein Passwort' };
  return {
    resolved: true,
    value: {
      host,
      port: input.port || account?.pop3Port || 995,
      tls: input.tls,
      user: input.user || account?.imapUsername || '',
      password,
    },
  };
}

async function resolveSmtpInput(
  input: MailConnectionTestInput,
  options: ServerMailConnectionTestPortOptions,
): Promise<{ resolved: true; value: RequiredConnectionInput } | MailConnectionTestResult> {
  const account = await loadStoredAccount(input, options);
  if (input.accountId != null && !account) {
    return { success: false, error: 'Konto nicht gefunden' };
  }
  const auth = await resolveSmtpAuth(input, account, options);
  if (!auth.ok) return { success: false, error: auth.error };
  const user = input.user || auth.user;
  const host = input.host?.trim() || resolveConfiguredSmtpHost(account?.smtpHost) || '';
  if (!host) {
    return { success: false, error: SMTP_HOST_MISSING_ERROR };
  }
  return {
    resolved: true,
    value: {
      host,
      port: input.port || account?.smtpPort || 587,
      tls: input.tls,
      user,
      password: auth.password ?? '',
      ...(auth.accessToken ? { accessToken: auth.accessToken } : {}),
    },
  };
}

async function loadStoredAccount(
  input: MailConnectionTestInput,
  options: ServerMailConnectionTestPortOptions,
): Promise<StoredAccountConnectionSettings | null> {
  if (input.accountId == null || !options.db) return null;
  const row = await withWorkspaceTransaction(options.db, {
    workspaceId: input.workspaceId,
    role: 'system',
  }, (db) => db
      .selectFrom('email_accounts')
      .select([
        'id',
        'imap_host',
        'imap_port',
        'imap_tls',
        'imap_username',
        'smtp_host',
        'smtp_port',
        'smtp_tls',
        'smtp_username',
        'smtp_use_imap_auth',
        'oauth_provider',
        'pop3_host',
        'pop3_port',
        'pop3_tls',
      ])
      .where('workspace_id', '=', input.workspaceId)
      .where('id', '=', input.accountId ?? 0)
      .executeTakeFirst());
  if (!row) return null;
  return {
    id: Number(row.id),
    imapHost: row.imap_host,
    imapPort: Number(row.imap_port),
    imapTls: Boolean(row.imap_tls),
    imapUsername: row.imap_username,
    smtpHost: row.smtp_host,
    smtpPort: row.smtp_port == null ? null : Number(row.smtp_port),
    smtpTls: Boolean(row.smtp_tls),
    smtpUsername: row.smtp_username,
    smtpUseImapAuth: Boolean(row.smtp_use_imap_auth),
    oauthProvider: row.oauth_provider,
    pop3Host: row.pop3_host,
    pop3Port: row.pop3_port == null ? null : Number(row.pop3_port),
    pop3Tls: row.pop3_tls == null ? null : Boolean(row.pop3_tls),
  };
}

async function resolvePassword(
  input: MailConnectionTestInput,
  account: StoredAccountConnectionSettings | null,
  options: ServerMailConnectionTestPortOptions,
): Promise<string> {
  if (input.password?.trim()) return input.password;
  if (!account || !options.secrets) return '';
  const secret = await options.secrets.readSecret(emailAccountImapSecretIdentifier(input.workspaceId, account.id));
  return secret?.toString('utf8') ?? '';
}

type ResolvedSmtpAuth =
  | { ok: true; user: string; password?: string; accessToken?: string }
  | { ok: false; error: string };

async function resolveSmtpAuth(
  input: MailConnectionTestInput,
  account: StoredAccountConnectionSettings | null,
  options: ServerMailConnectionTestPortOptions,
): Promise<ResolvedSmtpAuth> {
  const user = input.user || resolveSmtpUser(input, account);
  if (input.accessToken?.trim()) return { ok: true, user, accessToken: input.accessToken.trim() };
  if (input.password?.trim()) return { ok: true, user, password: input.password };
  if (!account || !options.secrets) return { ok: false, error: 'Kein Passwort oder OAuth-Token verfuegbar' };
  const useImapAuth = input.smtpUseImapAuth ?? account.smtpUseImapAuth;
  if (!useImapAuth) {
    const smtpSecret = await options.secrets.readSecret(emailAccountSmtpSecretIdentifier(input.workspaceId, account.id));
    if (smtpSecret) return { ok: true, user, password: smtpSecret.toString('utf8') };
  }
  const imapSecret = await options.secrets.readSecret(emailAccountImapSecretIdentifier(input.workspaceId, account.id));
  if (imapSecret) return { ok: true, user, password: imapSecret.toString('utf8') };
  if (account.oauthProvider) {
    return resolveSmtpOAuthAuth({
      workspaceId: input.workspaceId,
      account,
      user,
      options,
    });
  }
  return { ok: false, error: 'Kein Passwort oder OAuth-Token verfuegbar' };
}

function resolveSmtpUser(
  input: MailConnectionTestInput,
  account: StoredAccountConnectionSettings | null,
): string {
  if (!account) return input.user;
  const useImapAuth = input.smtpUseImapAuth ?? account.smtpUseImapAuth;
  return useImapAuth
    ? account.imapUsername
    : account.smtpUsername?.trim() || account.imapUsername;
}

async function resolveSmtpOAuthAuth(input: {
  workspaceId: string;
  account: StoredAccountConnectionSettings;
  user: string;
  options: ServerMailConnectionTestPortOptions;
}): Promise<ResolvedSmtpAuth> {
  const provider = normalizeEmailOAuthProvider(input.account.oauthProvider);
  if (!provider) return { ok: false, error: 'OAuth-Provider wird serverseitig nicht unterstuetzt' };
  if (!input.options.db || !input.options.secrets) {
    return { ok: false, error: 'OAuth-Appdaten oder Secret Store sind serverseitig nicht konfiguriert' };
  }

  const refreshIdentifier = emailAccountOauthRefreshSecretIdentifier(input.workspaceId, input.account.id);
  const refreshSecret = await input.options.secrets.readSecret(refreshIdentifier);
  if (!refreshSecret) return { ok: false, error: 'OAuth-Refresh-Token fehlt' };

  const keys = EMAIL_OAUTH_APP_KEYS[provider];
  const settings = await loadOAuthAppSettings(input.workspaceId, keys, input.options.db);
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
      fetchImpl: input.options.oauthFetchImpl,
    });
    if (refreshed.refreshToken && refreshed.refreshToken !== refreshToken) {
      await input.options.secrets.writeSecret({ ...refreshIdentifier, value: refreshed.refreshToken });
    }
    return { ok: true, user: input.user, accessToken: refreshed.accessToken };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function normalizeEmailOAuthProvider(value: string | null): EmailOAuthProvider | null {
  return value === 'google' || value === 'microsoft' ? value : null;
}

async function loadOAuthAppSettings(
  workspaceId: string,
  keys: { clientId: string; clientSecret: string },
  db: Kysely<ServerDatabase>,
): Promise<ReadonlyMap<string, string | null>> {
  return withWorkspaceTransaction(db, { workspaceId, role: 'system' }, async (trx) => {
    const rows = await trx
      .selectFrom('sync_info')
      .select(['key', 'value'])
      .where('workspace_id', '=', workspaceId)
      .where('key', 'in', [keys.clientId, keys.clientSecret])
      .execute();
    const values = new Map<string, string | null>([
      [keys.clientId, null],
      [keys.clientSecret, null],
    ]);
    for (const row of rows) values.set(row.key, row.value);
    return values;
  });
}

type RequiredConnectionInput = Readonly<{
  host: string;
  port: number;
  tls: boolean;
  user: string;
  password: string;
  accessToken?: string;
}>;

type ProtocolTestInput = RequiredConnectionInput & Readonly<{
  socketFactory: SocketFactory;
  timeoutMs: number;
}>;

async function testImapConnection(input: ProtocolTestInput): Promise<MailConnectionTestResult> {
  const unsafe = validateCommandValue(input.user, 'Benutzername')
    ?? validateCommandValue(input.password, 'Passwort');
  if (unsafe) return unsafe;
  const socket = await input.socketFactory(input);
  const client = new LineProtocolClient(socket, input.timeoutMs);
  try {
    const greeting = await client.readLine();
    if (/^\* BYE\b/i.test(greeting)) return { success: false, error: greeting };
    const login = await client.commandUntilTagged(
      `a001 LOGIN ${quoteImapString(input.user)} ${quoteImapString(input.password)}`,
      'a001',
    );
    if (!login.ok) return { success: false, error: login.line };
    const select = await client.commandUntilTagged('a002 SELECT "INBOX"', 'a002');
    if (!select.ok) return { success: false, error: select.line };
    await client.commandUntilTagged('a003 LOGOUT', 'a003').catch(() => undefined);
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    client.close();
  }
}

async function testPop3Connection(input: ProtocolTestInput): Promise<MailConnectionTestResult> {
  const unsafe = validateCommandValue(input.user, 'Benutzername')
    ?? validateCommandValue(input.password, 'Passwort');
  if (unsafe) return unsafe;
  const socket = await input.socketFactory(input);
  const client = new LineProtocolClient(socket, input.timeoutMs);
  try {
    const greeting = await client.readLine();
    if (!isPop3Ok(greeting)) return { success: false, error: greeting };
    let line = await client.command(`USER ${input.user}`);
    if (!isPop3Ok(line)) return { success: false, error: line };
    line = await client.command(`PASS ${input.password}`);
    if (!isPop3Ok(line)) return { success: false, error: line };
    line = await client.command('UIDL');
    if (!isPop3Ok(line)) return { success: false, error: line };
    await client.command('QUIT').catch(() => undefined);
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    client.close();
  }
}

async function testSmtpConnection(input: ProtocolTestInput): Promise<MailConnectionTestResult> {
  const unsafe = validateCommandValue(input.user, 'Benutzername')
    ?? validateCommandValue(input.password, 'Passwort');
  if (unsafe) return unsafe;
  const envelopeFrom = extractSmtpEnvelopeAddress(input.user);
  if (!envelopeFrom) {
    return { success: false, error: 'SMTP-Benutzername muss eine gueltige E-Mail-Adresse sein' };
  }
  const socket = await input.socketFactory(input);
  const client = new LineProtocolClient(socket, input.timeoutMs);
  try {
    let response = await readSmtpResponse(client);
    if (response.code !== 220) return { success: false, error: response.text };

    response = await smtpEhlo(client);
    if (response.code !== 250) return { success: false, error: response.text };

    if (!input.tls && smtpSupports(response, 'STARTTLS')) {
      response = await smtpCommand(client, 'STARTTLS');
      if (response.code !== 220) return { success: false, error: response.text };
      await upgradeClientToTls(client, input.host, input.timeoutMs);
      response = await smtpEhlo(client);
      if (response.code !== 250) return { success: false, error: response.text };
    }

    const authResponse = await smtpAuthenticate(client, response, input);
    if (authResponse.code !== 235) return { success: false, error: authResponse.text };

    response = await smtpCommand(client, `MAIL FROM:<${envelopeFrom}>`);
    if (response.code !== 250) return { success: false, error: response.text };

    response = await smtpCommand(client, `RCPT TO:<${envelopeFrom}>`);
    if (response.code !== 250 && response.code !== 251) return { success: false, error: response.text };

    response = await smtpCommand(client, 'DATA');
    if (response.code !== 354) return { success: false, error: response.text };

    const probe = buildSmtpConnectionTestRfc822({
      from: envelopeFrom,
      to: envelopeFrom,
    });
    client.writeData(dotStuff(probe));
    response = await readSmtpResponse(client);
    if (response.code !== 250) return { success: false, error: response.text };

    await smtpCommand(client, 'QUIT').catch(() => undefined);
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    client.close();
  }
}

function extractSmtpEnvelopeAddress(user: string): string | null {
  const trimmed = user.trim();
  if (!trimmed || /[\r\n<>]/.test(trimmed)) return null;
  const angle = /<([^>]+)>/.exec(trimmed);
  const email = (angle?.[1] ?? trimmed).trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

function buildSmtpConnectionTestRfc822(input: { from: string; to: string }): string {
  return buildComposeRfc822({
    from: input.from,
    to: input.to,
    subject: 'SimpleCRM SMTP-Verbindungstest',
    text: 'Dies ist ein automatischer Verbindungstest von SimpleCRM.',
    extraHeaders: ['Auto-Submitted: auto-generated'],
    date: new Date(),
  }).toString('utf8');
}

function dotStuff(value: string): string {
  const normalized = value.replace(/\r?\n/g, '\r\n').replace(/\r\n?$/g, '');
  const stuffed = normalized
    .split('\r\n')
    .map((line) => (line.startsWith('.') ? `.${line}` : line))
    .join('\r\n');
  return `${stuffed}\r\n.\r\n`;
}

type SmtpResponse = Readonly<{
  code: number;
  lines: readonly string[];
  text: string;
}>;

async function smtpEhlo(client: LineProtocolClient): Promise<SmtpResponse> {
  return smtpCommand(client, 'EHLO simplecrm.local');
}

async function smtpCommand(client: LineProtocolClient, command: string): Promise<SmtpResponse> {
  client.writeLine(command);
  return readSmtpResponse(client);
}

async function readSmtpResponse(client: LineProtocolClient): Promise<SmtpResponse> {
  const lines: string[] = [];
  for (;;) {
    const line = await client.readLine();
    lines.push(line);
    const match = /^(\d{3})([ -])(.*)$/.exec(line);
    if (!match) {
      return { code: 0, lines, text: line };
    }
    if (match[2] === ' ') {
      return {
        code: Number(match[1]),
        lines,
        text: lines.join('\n'),
      };
    }
  }
}

function smtpSupports(response: SmtpResponse, extension: string): boolean {
  const needle = extension.toUpperCase();
  return response.lines.some((line) => {
    const match = /^\d{3}[ -](.*)$/.exec(line);
    if (!match) return false;
    const [keyword] = match[1].trim().split(/\s+/, 1);
    return keyword?.toUpperCase() === needle;
  });
}

function smtpAuthMechanisms(response: SmtpResponse): Set<string> {
  const mechanisms = new Set<string>();
  for (const line of response.lines) {
    const match = /^\d{3}[ -]AUTH(?:[ =](.*))?$/i.exec(line.trim());
    if (!match) continue;
    for (const mechanism of (match[1] ?? '').split(/\s+/)) {
      if (mechanism) mechanisms.add(mechanism.toUpperCase());
    }
  }
  return mechanisms;
}

async function smtpAuthenticate(
  client: LineProtocolClient,
  ehloResponse: SmtpResponse,
  input: RequiredConnectionInput,
): Promise<SmtpResponse> {
  const mechanisms = smtpAuthMechanisms(ehloResponse);
  if (input.accessToken) {
    if (!mechanisms.has('XOAUTH2')) {
      return {
        code: 504,
        lines: ['504 AUTH XOAUTH2 not supported by SMTP server'],
        text: '504 AUTH XOAUTH2 not supported by SMTP server',
      };
    }
    const token = Buffer.from(`user=${input.user}\u0001auth=Bearer ${input.accessToken}\u0001\u0001`, 'utf8')
      .toString('base64');
    return smtpCommand(client, `AUTH XOAUTH2 ${token}`);
  }

  if (mechanisms.has('PLAIN')) {
    const token = Buffer.from(`\u0000${input.user}\u0000${input.password}`, 'utf8').toString('base64');
    return smtpCommand(client, `AUTH PLAIN ${token}`);
  }

  if (mechanisms.size > 0 && !mechanisms.has('LOGIN')) {
    return {
      code: 504,
      lines: ['504 AUTH mechanism not supported by SimpleCRM server probe'],
      text: '504 AUTH mechanism not supported by SimpleCRM server probe',
    };
  }

  let response = await smtpCommand(client, 'AUTH LOGIN');
  if (response.code !== 334) return response;
  response = await smtpCommand(client, Buffer.from(input.user, 'utf8').toString('base64'));
  if (response.code !== 334) return response;
  return smtpCommand(client, Buffer.from(input.password, 'utf8').toString('base64'));
}

async function upgradeClientToTls(
  client: LineProtocolClient,
  host: string,
  timeoutMs: number,
): Promise<void> {
  const rawSocket = client.detachSocket();
  const secureSocket = tls.connect({
    socket: rawSocket,
    servername: host,
  });
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => {
      cleanup();
      secureSocket.destroy();
      reject(error);
    };
    const timer = setTimeout(() => onError(new Error('Connection timed out')), timeoutMs);
    const cleanup = (): void => {
      clearTimeout(timer);
      secureSocket.off('error', onError);
      secureSocket.off('secureConnect', onConnect);
    };
    const onConnect = (): void => {
      cleanup();
      secureSocket.setTimeout(0);
      client.attachSocket(secureSocket);
      resolve();
    };
    secureSocket.once('error', onError);
    secureSocket.once('secureConnect', onConnect);
  });
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
      ? tls.connect({
          host: input.host,
          port: input.port,
          servername: input.host,
        })
      : net.connect({
          host: input.host,
          port: input.port,
        });
    socket.setTimeout(input.timeoutMs, () => onError(new Error('Connection timed out')));
    socket.once('error', onError);
    socket.once(input.tls ? 'secureConnect' : 'connect', () => {
      socket.off('error', onError);
      socket.setTimeout(0);
      resolve(socket);
    });
  });
}

class LineProtocolClient {
  private buffer = '';
  private waiters: Array<(line: string) => void> = [];
  private errorWaiters: Array<(error: Error) => void> = [];
  private closedError: Error | null = null;
  private socket: net.Socket;
  private readonly onData = (chunk: Buffer | string): void => this.pushData(String(chunk));
  private readonly onError = (error: Error): void => this.rejectAll(error);
  private readonly onEnd = (): void => this.rejectAll(new Error('Connection closed'));

  constructor(
    socket: net.Socket,
    private readonly timeoutMs: number,
  ) {
    this.socket = socket;
    this.attachSocket(socket);
  }

  attachSocket(socket: net.Socket): void {
    this.socket = socket;
    this.closedError = null;
    socket.setEncoding('utf8');
    socket.on('data', this.onData);
    socket.on('error', this.onError);
    socket.on('end', this.onEnd);
  }

  detachSocket(): net.Socket {
    this.socket.off('data', this.onData);
    this.socket.off('error', this.onError);
    this.socket.off('end', this.onEnd);
    return this.socket;
  }

  async command(command: string): Promise<string> {
    this.writeLine(command);
    return this.readLine();
  }

  writeLine(command: string): void {
    this.socket.write(`${command}\r\n`);
  }

  writeData(data: string): void {
    this.socket.write(data);
  }

  async commandUntilTagged(command: string, tag: string): Promise<{ ok: boolean; line: string }> {
    this.writeLine(command);
    for (;;) {
      const line = await this.readLine();
      if (line.toUpperCase().startsWith(`${tag.toUpperCase()} `)) {
        return { ok: new RegExp(`^${escapeRegExp(tag)}\\s+OK\\b`, 'i').test(line), line };
      }
    }
  }

  async readLine(): Promise<string> {
    if (this.closedError) throw this.closedError;
    const existing = this.shiftLine();
    if (existing !== null) return existing;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('Connection timed out'));
      }, this.timeoutMs);
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

  close(): void {
    this.socket.end();
    this.socket.destroy();
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
}

function quoteImapString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function isPop3Ok(line: string): boolean {
  return /^\+OK\b/i.test(line);
}

function validateCommandValue(value: string, label: string): MailConnectionTestResult | null {
  return /[\r\n]/.test(value)
    ? { success: false, error: `${label} darf keine Zeilenumbrueche enthalten` }
    : null;
}

function emailAccountImapSecretIdentifier(
  workspaceId: string,
  accountId: number,
): { workspaceId: string; kind: string; name: string } {
  return {
    workspaceId,
    kind: 'email.account.imap_password',
    name: `email_account:${accountId}:imap`,
  };
}

function emailAccountSmtpSecretIdentifier(
  workspaceId: string,
  accountId: number,
): { workspaceId: string; kind: string; name: string } {
  return {
    workspaceId,
    kind: 'email.account.smtp_password',
    name: `email_account:${accountId}:smtp`,
  };
}

function emailAccountOauthRefreshSecretIdentifier(
  workspaceId: string,
  accountId: number,
): { workspaceId: string; kind: string; name: string } {
  return {
    workspaceId,
    kind: 'email.account.oauth_refresh_token',
    name: `email_account:${accountId}:oauth_refresh`,
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
