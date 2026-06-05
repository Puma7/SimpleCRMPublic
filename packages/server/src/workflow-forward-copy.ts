import type { Kysely } from 'kysely';
import {
  addressesFromRecipientJson,
  generateOutboundMessageId,
  normalizeEmailAddress,
} from '@simplecrm/core';

import type { EmailOAuthProvider } from './api';
import type { PostgresSecretPort, SecretIdentifier, ServerDatabase } from './db';
import {
  withWorkspaceTransaction,
  type WorkspaceSessionApplier,
  type WorkspaceTransaction,
} from './db/workspace-context';
import { refreshServerEmailOAuthAccessToken } from './email-oauth';
import { sendSmtpMessage, type ServerSmtpSendInput } from './mail-smtp-send';
import type { JobPayload } from './jobs/types';

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

const FORWARD_COPY_BODY_MAX = 500_000;

export type WorkflowForwardCopyContinuation = Readonly<{
  workflowId: number;
  triggerName?: string;
  resumeNodeId: string;
  eventStrings?: JobPayload;
  eventVariables?: JobPayload;
}>;

export type WorkflowForwardCopyJobPlan = Readonly<{
  workspaceId: string;
  workflowId: number;
  messageId: number;
  actorUserId?: string;
  to: string;
  eventStrings?: JobPayload;
  eventVariables?: JobPayload;
  continuation?: WorkflowForwardCopyContinuation;
}>;

export type WorkflowForwardCopyJobPort = Readonly<{
  forwardCopy(input: WorkflowForwardCopyJobPlan): Promise<void>;
}>;

export type PostgresWorkflowForwardCopyPortOptions = Readonly<{
  db: Kysely<ServerDatabase>;
  secrets?: PostgresSecretPort;
  smtpSend?: (input: ServerSmtpSendInput) => Promise<void>;
  oauthFetchImpl?: typeof fetch;
  now?: () => Date;
  applyWorkspaceSession?: WorkspaceSessionApplier;
}>;

type ForwardCopyMessage = Readonly<{
  id: number;
  sourceSqliteId: number;
  accountId: number | null;
  subject: string | null;
  fromJson: unknown | null;
  snippet: string | null;
  bodyText: string | null;
}>;

type ForwardCopyAccount = Readonly<{
  id: number;
  displayName: string;
  emailAddress: string;
  imapHost: string;
  imapUsername: string;
  smtpHost: string | null;
  smtpPort: number | null;
  smtpTls: boolean;
  smtpUsername: string | null;
  smtpUseImapAuth: boolean;
  oauthProvider: string | null;
}>;

type PreparedForwardCopy =
  | {
    ok: true;
    duplicate: boolean;
    workflowSourceSqliteId: number;
    message: ForwardCopyMessage;
    account: ForwardCopyAccount;
    destination: string;
    subject: string;
    bodyText: string;
    rfc822: string;
  }
  | { ok: false; error: string };

type ResolvedSmtpAuth =
  | { ok: true; user: string; password?: string; accessToken?: string }
  | { ok: false; error: string };

export function createPostgresWorkflowForwardCopyPort(
  options: PostgresWorkflowForwardCopyPortOptions,
): WorkflowForwardCopyJobPort {
  const now = () => options.now?.() ?? new Date();
  const smtpSend = options.smtpSend ?? sendSmtpMessage;

  return {
    async forwardCopy(input): Promise<void> {
      const prepared = await withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => prepareForwardCopy(trx, input, now()),
        { applySession: options.applyWorkspaceSession },
      );

      if (!prepared.ok) {
        await enqueueForwardCopyContinuation(options, input, {
          ok: false,
          error: prepared.error,
          duplicate: false,
          now: now(),
        });
        return;
      }

      if (prepared.duplicate) {
        await enqueueForwardCopyContinuation(options, input, {
          ok: true,
          error: null,
          duplicate: true,
          now: now(),
        });
        return;
      }

      const auth = await resolveSmtpAuth({
        workspaceId: input.workspaceId,
        account: prepared.account,
        secrets: options.secrets,
        oauthFetchImpl: options.oauthFetchImpl,
        db: options.db,
        applyWorkspaceSession: options.applyWorkspaceSession,
      });
      if (!auth.ok) {
        await enqueueForwardCopyContinuation(options, input, {
          ok: false,
          error: auth.error,
          duplicate: false,
          now: now(),
        });
        return;
      }

      await smtpSend({
        host: prepared.account.smtpHost?.trim() || prepared.account.imapHost,
        port: prepared.account.smtpPort ?? 587,
        tls: prepared.account.smtpTls,
        user: auth.user,
        envelopeFrom: prepared.account.emailAddress,
        recipients: [prepared.destination],
        rfc822: prepared.rfc822,
        ...(auth.password !== undefined ? { password: auth.password } : {}),
        ...(auth.accessToken !== undefined ? { accessToken: auth.accessToken } : {}),
      });

      await withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          await insertForwardCopyDedup(trx, input, prepared, now());
          await enqueueForwardCopyContinuationInTransaction(trx, input, {
            ok: true,
            error: null,
            duplicate: false,
            now: now(),
          });
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
  };
}

async function prepareForwardCopy(
  trx: WorkspaceTransaction,
  input: WorkflowForwardCopyJobPlan,
  now: Date,
): Promise<PreparedForwardCopy> {
  const destination = normalizeForwardCopyDestination(input.to);
  if (!destination) return { ok: false, error: 'Empfaenger fehlt oder ist ungueltig' };

  const message = await loadForwardCopyMessage(trx, input.workspaceId, input.messageId);
  if (!message) return { ok: false, error: 'Nachricht nicht gefunden' };
  if (message.accountId === null) return { ok: false, error: 'Konto fehlt' };

  const account = await loadForwardCopyAccount(trx, input.workspaceId, message.accountId);
  if (!account) return { ok: false, error: 'Konto fehlt' };

  const workflowSourceSqliteId = await loadWorkflowSourceSqliteId(trx, input.workspaceId, input.workflowId);
  if (workflowSourceSqliteId === null) return { ok: false, error: 'Workflow nicht gefunden' };

  const duplicate = await hasForwardCopyDedup(trx, input.workspaceId, {
    messageSourceSqliteId: message.sourceSqliteId,
    workflowSourceSqliteId,
    destination,
  });
  if (duplicate) {
    return {
      ok: true,
      duplicate: true,
      workflowSourceSqliteId,
      message,
      account,
      destination,
      subject: '',
      bodyText: '',
      rfc822: '',
    };
  }

  const outboundWorkflowCount = await countEnabledOutboundWorkflows(trx, input.workspaceId);
  if (outboundWorkflowCount > 0) {
    return {
      ok: false,
      error: 'Outbound-Workflows sind aktiv; automatische Weiterleitung bleibt im Servermodus fail-closed',
    };
  }

  const originalFromLine = addressesFromStoredJson(message.fromJson);
  const subject = message.subject ? `Fwd: ${message.subject}` : 'Weitergeleitet';
  const bodyText = [
    message.bodyText ?? message.snippet ?? '',
    '',
    '---',
    `Original von: ${originalFromLine}`,
  ].join('\n').slice(0, FORWARD_COPY_BODY_MAX);

  return {
    ok: true,
    duplicate: false,
    workflowSourceSqliteId,
    message,
    account,
    destination,
    subject,
    bodyText,
    rfc822: buildForwardCopyRfc822({
      from: formatMailbox(account.displayName, account.emailAddress),
      to: destination,
      subject,
      bodyText,
      messageId: generateOutboundMessageId(account.emailAddress),
      date: now,
    }),
  };
}

async function loadForwardCopyMessage(
  trx: WorkspaceTransaction,
  workspaceId: string,
  messageId: number,
): Promise<ForwardCopyMessage | null> {
  const row = await trx
    .selectFrom('email_messages')
    .select(['id', 'source_sqlite_id', 'account_id', 'subject', 'from_json', 'snippet', 'body_text'])
    .where('workspace_id', '=', workspaceId)
    .where('id', '=', messageId)
    .executeTakeFirst();
  return row
    ? {
      id: Number(row.id),
      sourceSqliteId: Number(row.source_sqlite_id),
      accountId: row.account_id === null ? null : Number(row.account_id),
      subject: row.subject,
      fromJson: row.from_json,
      snippet: row.snippet,
      bodyText: row.body_text,
    }
    : null;
}

async function loadForwardCopyAccount(
  trx: WorkspaceTransaction,
  workspaceId: string,
  accountId: number,
): Promise<ForwardCopyAccount | null> {
  const row = await trx
    .selectFrom('email_accounts')
    .select([
      'id',
      'display_name',
      'email_address',
      'imap_host',
      'imap_username',
      'smtp_host',
      'smtp_port',
      'smtp_tls',
      'smtp_username',
      'smtp_use_imap_auth',
      'oauth_provider',
    ])
    .where('workspace_id', '=', workspaceId)
    .where('id', '=', accountId)
    .executeTakeFirst();
  return row
    ? {
      id: Number(row.id),
      displayName: String(row.display_name ?? ''),
      emailAddress: String(row.email_address ?? ''),
      imapHost: String(row.imap_host ?? ''),
      imapUsername: String(row.imap_username ?? ''),
      smtpHost: row.smtp_host,
      smtpPort: row.smtp_port === null ? null : Number(row.smtp_port),
      smtpTls: Boolean(row.smtp_tls),
      smtpUsername: row.smtp_username,
      smtpUseImapAuth: Boolean(row.smtp_use_imap_auth),
      oauthProvider: row.oauth_provider,
    }
    : null;
}

async function loadWorkflowSourceSqliteId(
  trx: WorkspaceTransaction,
  workspaceId: string,
  workflowId: number,
): Promise<number | null> {
  const row = await trx
    .selectFrom('email_workflows')
    .select(['id', 'source_sqlite_id'])
    .where('workspace_id', '=', workspaceId)
    .where('id', '=', workflowId)
    .executeTakeFirst();
  if (!row) return null;
  return row.source_sqlite_id === null ? -Number(row.id) : Number(row.source_sqlite_id);
}

async function hasForwardCopyDedup(
  trx: WorkspaceTransaction,
  workspaceId: string,
  input: {
    messageSourceSqliteId: number;
    workflowSourceSqliteId: number;
    destination: string;
  },
): Promise<boolean> {
  const row = await trx
    .selectFrom('email_workflow_forward_dedup')
    .select('id')
    .where('workspace_id', '=', workspaceId)
    .where('message_source_sqlite_id', '=', input.messageSourceSqliteId)
    .where('workflow_source_sqlite_id', '=', input.workflowSourceSqliteId)
    .where('dest', '=', input.destination)
    .executeTakeFirst();
  return Boolean(row);
}

async function countEnabledOutboundWorkflows(
  trx: WorkspaceTransaction,
  workspaceId: string,
): Promise<number> {
  const rows = await trx
    .selectFrom('email_workflows')
    .select('id')
    .where('workspace_id', '=', workspaceId)
    .where('trigger_name', '=', 'outbound')
    .where('enabled', '=', true)
    .limit(1)
    .execute();
  return rows.length;
}

async function insertForwardCopyDedup(
  trx: WorkspaceTransaction,
  input: WorkflowForwardCopyJobPlan,
  prepared: Extract<PreparedForwardCopy, { ok: true }>,
  now: Date,
): Promise<void> {
  if (await hasForwardCopyDedup(trx, input.workspaceId, {
    messageSourceSqliteId: prepared.message.sourceSqliteId,
    workflowSourceSqliteId: prepared.workflowSourceSqliteId,
    destination: prepared.destination,
  })) {
    return;
  }
  await trx
    .insertInto('email_workflow_forward_dedup')
    .values({
      workspace_id: input.workspaceId,
      source_sqlite_id: serverCreatedWorkflowForwardDedupSourceSqliteId(
        input.workspaceId,
        prepared.message.sourceSqliteId,
        prepared.workflowSourceSqliteId,
        prepared.destination,
      ),
      message_source_sqlite_id: prepared.message.sourceSqliteId,
      workflow_source_sqlite_id: prepared.workflowSourceSqliteId,
      message_id: input.messageId,
      workflow_id: input.workflowId,
      dest: prepared.destination,
      source_row: serverWorkerSourceRow(),
      imported_in_run_id: null,
      created_at: now,
      updated_at: now,
    })
    .execute();
}

async function enqueueForwardCopyContinuation(
  options: PostgresWorkflowForwardCopyPortOptions,
  input: WorkflowForwardCopyJobPlan,
  result: { ok: boolean; error: string | null; duplicate: boolean; now: Date },
): Promise<void> {
  if (!input.continuation) return;
  await withWorkspaceTransaction(
    options.db,
    { workspaceId: input.workspaceId, role: 'system' },
    async (trx) => enqueueForwardCopyContinuationInTransaction(trx, input, result),
    { applySession: options.applyWorkspaceSession },
  );
}

async function enqueueForwardCopyContinuationInTransaction(
  trx: WorkspaceTransaction,
  input: WorkflowForwardCopyJobPlan,
  result: { ok: boolean; error: string | null; duplicate: boolean; now: Date },
): Promise<void> {
  const continuation = input.continuation;
  if (!continuation) return;

  await trx
    .insertInto('job_queue')
    .values({
      type: 'workflow.execute',
      payload: {
        workspaceId: input.workspaceId,
        workflowId: continuation.workflowId,
        messageId: input.messageId,
        ...(continuation.triggerName ? { triggerName: continuation.triggerName } : {}),
        context: {
          resumeNodeId: continuation.resumeNodeId,
          eventStrings: continuation.eventStrings ?? {},
          eventVariables: {
            ...(continuation.eventVariables ?? {}),
            'forward_copy.ok': result.ok,
            'forward_copy.to': normalizeForwardCopyDestination(input.to) ?? input.to.trim().toLowerCase(),
            'forward_copy.duplicate': result.duplicate,
            ...(result.error ? { 'forward_copy.error': result.error } : {}),
          },
        },
      },
      run_after: result.now,
      max_attempts: 3,
      workspace_id: input.workspaceId,
      updated_at: result.now,
    })
    .execute();
}

async function resolveSmtpAuth(input: {
  workspaceId: string;
  account: ForwardCopyAccount;
  secrets?: PostgresSecretPort;
  db: Kysely<ServerDatabase>;
  applyWorkspaceSession?: WorkspaceSessionApplier;
  oauthFetchImpl?: typeof fetch;
}): Promise<ResolvedSmtpAuth> {
  if (!input.secrets) {
    return { ok: false, error: 'Email account secret storage ist nicht konfiguriert' };
  }

  const user = resolveSmtpUser(input.account);
  if (!input.account.smtpUseImapAuth) {
    const smtpSecret = await input.secrets.readSecret(
      emailAccountSecretIdentifier(input.workspaceId, input.account.id, 'smtp'),
    );
    if (smtpSecret) return { ok: true, user, password: smtpSecret.toString('utf8') };
  }

  const imapSecret = await input.secrets.readSecret(
    emailAccountSecretIdentifier(input.workspaceId, input.account.id, 'imap'),
  );
  if (imapSecret) return { ok: true, user, password: imapSecret.toString('utf8') };

  if (input.account.oauthProvider) {
    return resolveOAuthSmtpAuth({
      workspaceId: input.workspaceId,
      account: input.account,
      user,
      secrets: input.secrets,
      db: input.db,
      applyWorkspaceSession: input.applyWorkspaceSession,
      oauthFetchImpl: input.oauthFetchImpl,
    });
  }
  return { ok: false, error: 'Kein SMTP-Passwort verfuegbar' };
}

async function resolveOAuthSmtpAuth(input: {
  workspaceId: string;
  account: ForwardCopyAccount;
  user: string;
  secrets: PostgresSecretPort;
  db: Kysely<ServerDatabase>;
  applyWorkspaceSession?: WorkspaceSessionApplier;
  oauthFetchImpl?: typeof fetch;
}): Promise<ResolvedSmtpAuth> {
  const provider = normalizeEmailOAuthProvider(input.account.oauthProvider);
  if (!provider) return { ok: false, error: 'OAuth-Provider wird serverseitig nicht unterstuetzt' };

  const refreshIdentifier = emailAccountSecretIdentifier(input.workspaceId, input.account.id, 'oauth_refresh');
  const refreshSecret = await input.secrets.readSecret(refreshIdentifier);
  if (!refreshSecret) return { ok: false, error: 'OAuth-Refresh-Token fehlt' };

  const keys = EMAIL_OAUTH_APP_KEYS[provider];
  const settings = await withWorkspaceTransaction(
    input.db,
    { workspaceId: input.workspaceId, role: 'system' },
    async (trx) => readSyncInfoMap(trx, input.workspaceId, [keys.clientId, keys.clientSecret]),
    { applySession: input.applyWorkspaceSession },
  );
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
      await input.secrets.writeSecret({ ...refreshIdentifier, value: refreshed.refreshToken });
    }
    return { ok: true, user: input.user, accessToken: refreshed.accessToken };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function readSyncInfoMap(
  trx: WorkspaceTransaction,
  workspaceId: string,
  keys: readonly string[],
): Promise<ReadonlyMap<string, string | null>> {
  const rows = await trx
    .selectFrom('sync_info')
    .select(['key', 'value'])
    .where('workspace_id', '=', workspaceId)
    .where('key', 'in', keys)
    .execute();
  const values = new Map<string, string | null>();
  for (const key of keys) values.set(key, null);
  for (const row of rows) values.set(String(row.key), row.value === null ? null : String(row.value));
  return values;
}

function resolveSmtpUser(account: ForwardCopyAccount): string {
  return account.smtpUseImapAuth
    ? account.imapUsername
    : account.smtpUsername?.trim() || account.imapUsername;
}

function normalizeForwardCopyDestination(value: string): string | null {
  const normalized = normalizeEmailAddress(value);
  return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(normalized) ? normalized : null;
}

function normalizeEmailOAuthProvider(value: string | null): EmailOAuthProvider | null {
  return value === 'google' || value === 'microsoft' ? value : null;
}

function emailAccountSecretIdentifier(
  workspaceId: string,
  accountId: number,
  secret: 'imap' | 'smtp' | 'oauth_refresh',
): SecretIdentifier {
  const kind = secret === 'imap'
    ? 'email.account.imap_password'
    : secret === 'smtp'
      ? 'email.account.smtp_password'
      : 'email.account.oauth_refresh_token';
  return {
    workspaceId,
    kind,
    name: `email_account:${accountId}:${secret}`,
  };
}

function buildForwardCopyRfc822(input: {
  from: string;
  to: string;
  subject: string;
  bodyText: string;
  messageId: string;
  date: Date;
}): string {
  const headers = [
    `From: ${input.from}`,
    `To: ${input.to}`,
    `Subject: ${encodeHeaderValue(input.subject)}`,
    `Message-ID: ${input.messageId}`,
    `Date: ${input.date.toUTCString()}`,
    'Auto-Submitted: auto-forwarded',
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
  ];
  return `${headers.join('\r\n')}\r\n\r\n${input.bodyText.replace(/\r?\n/g, '\r\n')}`;
}

function formatMailbox(displayName: string, emailAddress: string): string {
  const cleanEmail = normalizeEmailAddress(emailAddress) ?? emailAddress.trim();
  const cleanName = sanitizeHeader(displayName);
  return cleanName ? `${encodeHeaderValue(cleanName)} <${cleanEmail}>` : cleanEmail;
}

function encodeHeaderValue(value: string): string {
  const clean = sanitizeHeader(value);
  return /^[\x20-\x7e]*$/.test(clean)
    ? clean
    : `=?UTF-8?B?${Buffer.from(clean, 'utf8').toString('base64')}?=`;
}

function sanitizeHeader(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim();
}

function addressesFromStoredJson(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return addressesFromRecipientJson(value);
  try {
    return addressesFromRecipientJson(JSON.stringify(value));
  } catch {
    return '';
  }
}

function serverWorkerSourceRow(): Record<string, string> {
  return { origin: 'server_worker' };
}

function serverCreatedWorkflowForwardDedupSourceSqliteId(
  workspaceId: string,
  messageSourceSqliteId: number,
  workflowSourceSqliteId: number,
  destination: string,
): number {
  return serverCreatedSourceSqliteId(
    'email_workflow_forward_dedup',
    workspaceId,
    String(messageSourceSqliteId),
    String(workflowSourceSqliteId),
    destination,
  );
}

function serverCreatedSourceSqliteId(kind: string, ...parts: string[]): number {
  const value = [kind, ...parts].join('\u001f');
  let hash = 14_695_981_039_346_656_037n;
  for (let index = 0; index < value.length; index++) {
    hash ^= BigInt(value.charCodeAt(index));
    hash *= 1_099_511_628_211n;
    hash &= 0xffff_ffff_ffff_ffffn;
  }
  return -Number(1_000_000_000_000n + (hash % 7_000_000_000_000_000n));
}
