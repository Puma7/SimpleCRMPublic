import type { Kysely } from 'kysely';
import { randomBytes } from 'crypto';

import type {
  EmailOAuthProvider,
  EmailVacationTestApiPort,
} from './api';
import type { PostgresSecretPort, SecretIdentifier } from './db';
import type { ServerDatabase } from './db/schema';
import {
  withWorkspaceTransaction,
  type WorkspaceSessionApplier,
  type WorkspaceTransaction,
} from './db/workspace-context';
import { refreshServerEmailOAuthAccessToken } from './email-oauth';
import type { MailVacationAutoReplyJobPort } from './jobs';
import { sendSmtpMessage, type ServerSmtpSendInput } from './mail-smtp-send';
import { resolveConfiguredSmtpHost, SMTP_HOST_MISSING_ERROR } from '@simplecrm/core';

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

const DEFAULT_VACATION_SUBJECT = 'Abwesenheit: Automatische Antwort';
const DEFAULT_VACATION_BODY =
  'Vielen Dank fuer Ihre Nachricht. Ich bin derzeit nicht erreichbar und melde mich schnellstmoeglich.';
const TEST_SUFFIX = 'Test der Abwesenheitsantwort (SimpleCRM)';
const VACATION_FAIL_TTL_MS = 60 * 60 * 1000;
const VACATION_DEDUP_TTL_MS = 24 * 60 * 60 * 1000;

let serverCreatedVacationSourceCounter = 0;

type VacationAccount = Readonly<{
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
  vacationEnabled: boolean;
  vacationSubject: string | null;
  vacationBodyText: string | null;
}>;

type VacationMessage = Readonly<{
  id: number;
  sourceSqliteId: number;
  accountId: number;
  uid: number;
  pop3Uidl: string | null;
  messageId: string | null;
  fromJson: unknown;
  rawHeaders: string | null;
  customerId: number | null;
  customerSourceSqliteId: number | null;
  archived: boolean;
  softDeleted: boolean;
  isSpam: boolean;
  spamStatus: string;
  spamScoreLabel: string | null;
  folderKind: string;
}>;

type VacationAutoReplyContext = Readonly<{
  account: VacationAccount;
  message: VacationMessage;
}>;

type ResolvedSmtpAuth =
  | { ok: true; user: string; password?: string; accessToken?: string }
  | { ok: false; error: string };

export type PostgresEmailVacationTestPortOptions = Readonly<{
  db: Kysely<ServerDatabase>;
  secrets?: PostgresSecretPort;
  smtpSend?: (input: ServerSmtpSendInput) => Promise<void>;
  oauthFetchImpl?: typeof fetch;
  applyWorkspaceSession?: WorkspaceSessionApplier;
  now?: () => Date;
}>;

export type PostgresEmailVacationAutoReplyPortOptions = PostgresEmailVacationTestPortOptions;

export function createPostgresEmailVacationTestPort(
  options: PostgresEmailVacationTestPortOptions,
): EmailVacationTestApiPort {
  const smtpSend = options.smtpSend ?? sendSmtpMessage;
  const now = options.now ?? (() => new Date());

  return {
    async sendTest(input) {
      const account = await loadVacationAccount({
        db: options.db,
        workspaceId: input.workspaceId,
        accountId: input.accountId,
        applyWorkspaceSession: options.applyWorkspaceSession,
      });
      if (!account) return { success: false, error: 'Konto nicht gefunden' };

      const auth = await resolveSmtpAuth({
        workspaceId: input.workspaceId,
        account,
        readSecret: options.secrets?.readSecret
          ? options.secrets.readSecret.bind(options.secrets)
          : undefined,
        writeSecret: options.secrets?.writeSecret
          ? options.secrets.writeSecret.bind(options.secrets)
          : undefined,
        getSyncInfo: (syncInput) => loadSyncInfo({
          db: options.db,
          workspaceId: syncInput.workspaceId,
          keys: syncInput.keys,
          applyWorkspaceSession: options.applyWorkspaceSession,
        }),
        oauthFetchImpl: options.oauthFetchImpl,
      });
      if (!auth.ok) return { success: false, error: auth.error };

      const subject = account.vacationSubject?.trim() || DEFAULT_VACATION_SUBJECT;
      const body = account.vacationBodyText?.trim() || DEFAULT_VACATION_BODY;
      const date = now();
      const rfc822 = buildVacationTestRfc822({
        from: formatMailbox(account.displayName, account.emailAddress),
        to: account.emailAddress,
        subject: `[Test] ${subject}`,
        text: `${body}\n\n-- ${TEST_SUFFIX}`,
        messageId: generateVacationTestMessageId(account.emailAddress, date),
        date,
      });

      try {
        const smtpHost = resolveConfiguredSmtpHost(account.smtpHost);
        if (!smtpHost) return { success: false, error: SMTP_HOST_MISSING_ERROR };

        await smtpSend({
          host: smtpHost,
          port: account.smtpPort ?? 587,
          tls: account.smtpTls,
          user: auth.user,
          envelopeFrom: account.emailAddress,
          recipients: [account.emailAddress],
          rfc822,
          ...(auth.password === undefined ? {} : { password: auth.password }),
          ...(auth.accessToken === undefined ? {} : { accessToken: auth.accessToken }),
        });
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }

      return {
        success: true,
        accountId: account.id,
        emailAddress: account.emailAddress,
      };
    },
  };
}

async function loadVacationAccount(input: {
  db: Kysely<ServerDatabase>;
  workspaceId: string;
  accountId: number;
  applyWorkspaceSession?: WorkspaceSessionApplier;
}): Promise<VacationAccount | null> {
  return withWorkspaceTransaction(
    input.db,
    { workspaceId: input.workspaceId, role: 'system' },
    async (trx) => {
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
          'vacation_enabled',
          'vacation_subject',
          'vacation_body_text',
        ])
        .where('workspace_id', '=', input.workspaceId)
        .where('id', '=', input.accountId)
        .executeTakeFirst();

      return row
        ? {
          id: Number(row.id),
          displayName: row.display_name,
          emailAddress: row.email_address,
          imapHost: row.imap_host,
          imapUsername: row.imap_username,
          smtpHost: row.smtp_host,
          smtpPort: row.smtp_port === null ? null : Number(row.smtp_port),
          smtpTls: Boolean(row.smtp_tls),
          smtpUsername: row.smtp_username,
          smtpUseImapAuth: Boolean(row.smtp_use_imap_auth),
          oauthProvider: row.oauth_provider,
          vacationEnabled: Boolean(row.vacation_enabled),
          vacationSubject: row.vacation_subject,
          vacationBodyText: row.vacation_body_text,
        }
        : null;
    },
    { applySession: input.applyWorkspaceSession },
  );
}

export function createPostgresEmailVacationAutoReplyPort(
  options: PostgresEmailVacationAutoReplyPortOptions,
): MailVacationAutoReplyJobPort {
  const smtpSend = options.smtpSend ?? sendSmtpMessage;
  const now = options.now ?? (() => new Date());

  return {
    async autoReply(input) {
      const context = await loadVacationAutoReplyContext({
        db: options.db,
        workspaceId: input.workspaceId,
        messageId: input.messageId,
        applyWorkspaceSession: options.applyWorkspaceSession,
      });
      if (!context) return;

      const plannedAt = now();
      const planned = await planVacationAutoReply({
        db: options.db,
        workspaceId: input.workspaceId,
        context,
        now: plannedAt,
        applyWorkspaceSession: options.applyWorkspaceSession,
      });
      if (!planned.ok) return;

      const auth = await resolveSmtpAuth({
        workspaceId: input.workspaceId,
        account: context.account,
        readSecret: options.secrets?.readSecret
          ? options.secrets.readSecret.bind(options.secrets)
          : undefined,
        writeSecret: options.secrets?.writeSecret
          ? options.secrets.writeSecret.bind(options.secrets)
          : undefined,
        getSyncInfo: (syncInput) => loadSyncInfo({
          db: options.db,
          workspaceId: syncInput.workspaceId,
          keys: syncInput.keys,
          applyWorkspaceSession: options.applyWorkspaceSession,
        }),
        oauthFetchImpl: options.oauthFetchImpl,
      });
      if (!auth.ok) {
        await recordVacationAutoReplyFailure({
          db: options.db,
          workspaceId: input.workspaceId,
          context,
          sender: planned.sender,
          error: auth.error,
          now: plannedAt,
          applyWorkspaceSession: options.applyWorkspaceSession,
        });
        return;
      }

      const subject = context.account.vacationSubject?.trim() || DEFAULT_VACATION_SUBJECT;
      const body = context.account.vacationBodyText?.trim() || DEFAULT_VACATION_BODY;
      const rfc822 = buildVacationAutoReplyRfc822({
        from: formatMailbox(context.account.displayName, context.account.emailAddress),
        to: planned.sender,
        subject,
        text: body,
        messageId: generateVacationTestMessageId(context.account.emailAddress, plannedAt),
        inReplyTo: context.message.messageId,
        date: plannedAt,
      });

      const smtpHost = resolveConfiguredSmtpHost(context.account.smtpHost);
      if (!smtpHost) {
        await recordVacationAutoReplyFailure({
          db: options.db,
          workspaceId: input.workspaceId,
          context,
          sender: planned.sender,
          error: SMTP_HOST_MISSING_ERROR,
          now: plannedAt,
          applyWorkspaceSession: options.applyWorkspaceSession,
        });
        return;
      }

      try {
        await smtpSend({
          host: smtpHost,
          port: context.account.smtpPort ?? 587,
          tls: context.account.smtpTls,
          user: auth.user,
          envelopeFrom: context.account.emailAddress,
          recipients: [planned.sender],
          rfc822,
          ...(auth.password === undefined ? {} : { password: auth.password }),
          ...(auth.accessToken === undefined ? {} : { accessToken: auth.accessToken }),
        });
      } catch (error) {
        await recordVacationAutoReplyFailure({
          db: options.db,
          workspaceId: input.workspaceId,
          context,
          sender: planned.sender,
          error: error instanceof Error ? error.message : String(error),
          now: plannedAt,
          applyWorkspaceSession: options.applyWorkspaceSession,
        });
        return;
      }

      await recordVacationAutoReplySuccess({
        db: options.db,
        workspaceId: input.workspaceId,
        context,
        sender: planned.sender,
        subject,
        now: plannedAt,
        applyWorkspaceSession: options.applyWorkspaceSession,
      });
    },
  };
}

async function loadVacationAutoReplyContext(input: {
  db: Kysely<ServerDatabase>;
  workspaceId: string;
  messageId: number;
  applyWorkspaceSession?: WorkspaceSessionApplier;
}): Promise<VacationAutoReplyContext | null> {
  return withWorkspaceTransaction(
    input.db,
    { workspaceId: input.workspaceId, role: 'system' },
    async (trx) => {
      const row = await trx
        .selectFrom('email_messages')
        .select([
          'id',
          'source_sqlite_id',
          'account_id',
          'uid',
          'pop3_uidl',
          'message_id',
          'from_json',
          'raw_headers',
          'customer_id',
          'customer_source_sqlite_id',
          'archived',
          'soft_deleted',
          'is_spam',
          'spam_status',
          'spam_score_label',
          'folder_kind',
        ])
        .where('workspace_id', '=', input.workspaceId)
        .where('id', '=', input.messageId)
        .executeTakeFirst();
      const accountId = row?.account_id === null || row?.account_id === undefined ? null : Number(row.account_id);
      if (!row || accountId === null) return null;
      const account = await loadVacationAccountInTransaction(trx, input.workspaceId, accountId);
      if (!account) return null;
      return {
        account,
        message: {
          id: Number(row.id),
          sourceSqliteId: Number(row.source_sqlite_id),
          accountId,
          uid: Number(row.uid),
          pop3Uidl: row.pop3_uidl,
          messageId: row.message_id,
          fromJson: row.from_json,
          rawHeaders: row.raw_headers,
          customerId: row.customer_id === null ? null : Number(row.customer_id),
          customerSourceSqliteId: row.customer_source_sqlite_id === null ? null : Number(row.customer_source_sqlite_id),
          archived: Boolean(row.archived),
          softDeleted: Boolean(row.soft_deleted),
          isSpam: Boolean(row.is_spam),
          spamStatus: row.spam_status,
          spamScoreLabel: row.spam_score_label,
          folderKind: row.folder_kind,
        },
      };
    },
    { applySession: input.applyWorkspaceSession },
  );
}

async function loadVacationAccountInTransaction(
  trx: WorkspaceTransaction,
  workspaceId: string,
  accountId: number,
): Promise<VacationAccount | null> {
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
      'vacation_enabled',
      'vacation_subject',
      'vacation_body_text',
    ])
    .where('workspace_id', '=', workspaceId)
    .where('id', '=', accountId)
    .executeTakeFirst();

  return row
    ? {
      id: Number(row.id),
      displayName: row.display_name,
      emailAddress: row.email_address,
      imapHost: row.imap_host,
      imapUsername: row.imap_username,
      smtpHost: row.smtp_host,
      smtpPort: row.smtp_port === null ? null : Number(row.smtp_port),
      smtpTls: Boolean(row.smtp_tls),
      smtpUsername: row.smtp_username,
      smtpUseImapAuth: Boolean(row.smtp_use_imap_auth),
      oauthProvider: row.oauth_provider,
      vacationEnabled: Boolean(row.vacation_enabled),
      vacationSubject: row.vacation_subject,
      vacationBodyText: row.vacation_body_text,
    }
    : null;
}

async function planVacationAutoReply(input: {
  db: Kysely<ServerDatabase>;
  workspaceId: string;
  context: VacationAutoReplyContext;
  now: Date;
  applyWorkspaceSession?: WorkspaceSessionApplier;
}): Promise<{ ok: true; sender: string } | { ok: false }> {
  const { account, message } = input.context;
  if (!account.vacationEnabled) return { ok: false };
  if (message.uid < 0 && !message.pop3Uidl) return { ok: false };
  if (!messageIsVacationEligible(message)) return { ok: false };
  if (isAutoSubmitted(message.rawHeaders)) return { ok: false };

  const sender = extractSenderEmail(message.fromJson);
  if (!sender || sender === account.emailAddress.trim().toLowerCase()) return { ok: false };

  const keys = [
    vacationSentKey(account.id, sender),
    vacationFailKey(account.id, sender),
  ];
  const values = await loadSyncInfo({
    db: input.db,
    workspaceId: input.workspaceId,
    keys,
    applyWorkspaceSession: input.applyWorkspaceSession,
  });
  if (timestampWithin(values.get(keys[0]), input.now, VACATION_DEDUP_TTL_MS)) return { ok: false };
  if (timestampWithin(values.get(keys[1]), input.now, VACATION_FAIL_TTL_MS)) return { ok: false };

  return { ok: true, sender };
}

async function recordVacationAutoReplySuccess(input: {
  db: Kysely<ServerDatabase>;
  workspaceId: string;
  context: VacationAutoReplyContext;
  sender: string;
  subject: string;
  now: Date;
  applyWorkspaceSession?: WorkspaceSessionApplier;
}): Promise<void> {
  await withWorkspaceTransaction(
    input.db,
    { workspaceId: input.workspaceId, role: 'system' },
    async (trx) => {
      await setSyncInfoValue(trx, input.workspaceId, vacationSentKey(input.context.account.id, input.sender), input.now.toISOString(), input.now);
      await insertVacationActivityLog(trx, input, {
        activityType: 'email_vacation_auto_reply',
        title: 'Abwesenheitsantwort gesendet',
        description: `Automatische Antwort an ${input.sender}`,
        metadata: {
          accountId: input.context.account.id,
          inboundMessageId: input.context.message.id,
          subject: input.subject,
        },
      });
    },
    { applySession: input.applyWorkspaceSession },
  );
}

async function recordVacationAutoReplyFailure(input: {
  db: Kysely<ServerDatabase>;
  workspaceId: string;
  context: VacationAutoReplyContext;
  sender: string;
  error: string;
  now: Date;
  applyWorkspaceSession?: WorkspaceSessionApplier;
}): Promise<void> {
  await withWorkspaceTransaction(
    input.db,
    { workspaceId: input.workspaceId, role: 'system' },
    async (trx) => {
      await setSyncInfoValue(trx, input.workspaceId, vacationFailKey(input.context.account.id, input.sender), input.now.toISOString(), input.now);
      await insertVacationActivityLog(trx, input, {
        activityType: 'email_vacation_auto_reply_failed',
        title: 'Abwesenheitsantwort fehlgeschlagen',
        description: input.error.slice(0, 1000),
        metadata: {
          accountId: input.context.account.id,
          inboundMessageId: input.context.message.id,
          sender: input.sender,
        },
      });
    },
    { applySession: input.applyWorkspaceSession },
  );
}

async function setSyncInfoValue(
  trx: WorkspaceTransaction,
  workspaceId: string,
  key: string,
  value: string,
  now: Date,
): Promise<void> {
  const existing = await trx
    .selectFrom('sync_info')
    .select('key')
    .where('workspace_id', '=', workspaceId)
    .where('key', '=', key)
    .executeTakeFirst();
  if (existing) {
    await trx
      .updateTable('sync_info')
      .set({ value, last_updated: now, updated_at: now })
      .where('workspace_id', '=', workspaceId)
      .where('key', '=', key)
      .execute();
    return;
  }
  await trx
    .insertInto('sync_info')
    .values({
      workspace_id: workspaceId,
      key,
      value,
      last_updated: now,
      updated_at: now,
    })
    .execute();
}

async function insertVacationActivityLog(
  trx: WorkspaceTransaction,
  input: {
    workspaceId: string;
    context: VacationAutoReplyContext;
    now: Date;
  },
  values: {
    activityType: string;
    title: string;
    description: string;
    metadata: Record<string, unknown>;
  },
): Promise<void> {
  await trx
    .insertInto('activity_log')
    .values({
      workspace_id: input.workspaceId,
      source_sqlite_id: serverCreatedVacationSourceSqliteId('activity_log'),
      customer_source_sqlite_id: input.context.message.customerSourceSqliteId,
      deal_source_sqlite_id: null,
      task_source_sqlite_id: null,
      customer_id: input.context.message.customerId,
      deal_id: null,
      task_id: null,
      activity_type: values.activityType,
      title: values.title,
      description: values.description,
      metadata: values.metadata,
      source_row: { origin: 'server_vacation_auto_reply' },
      imported_in_run_id: null,
      created_at: input.now,
      updated_at: input.now,
    })
    .execute();
}

async function loadSyncInfo(input: {
  db: Kysely<ServerDatabase>;
  workspaceId: string;
  keys: readonly string[];
  applyWorkspaceSession?: WorkspaceSessionApplier;
}): Promise<ReadonlyMap<string, string | null>> {
  return withWorkspaceTransaction(
    input.db,
    { workspaceId: input.workspaceId, role: 'system' },
    async (trx) => {
      const values = new Map<string, string | null>();
      for (const key of input.keys) values.set(key, null);
      if (input.keys.length === 0) return values;

      const rows = await trx
        .selectFrom('sync_info')
        .select(['key', 'value'])
        .where('workspace_id', '=', input.workspaceId)
        .where('key', 'in', input.keys)
        .execute();
      for (const row of rows) values.set(row.key, row.value);
      return values;
    },
    { applySession: input.applyWorkspaceSession },
  );
}

function resolveSmtpUser(account: VacationAccount): string {
  return account.smtpUseImapAuth
    ? account.imapUsername
    : account.smtpUsername?.trim() || account.imapUsername;
}

async function resolveSmtpAuth(input: {
  workspaceId: string;
  account: VacationAccount;
  readSecret?: (input: SecretIdentifier) => Promise<Buffer | null>;
  writeSecret?: (input: SecretIdentifier & { value: string | Buffer }) => Promise<unknown>;
  getSyncInfo: (input: {
    workspaceId: string;
    keys: readonly string[];
  }) => Promise<ReadonlyMap<string, string | null>>;
  oauthFetchImpl?: typeof fetch;
}): Promise<ResolvedSmtpAuth> {
  if (!input.readSecret) return { ok: false, error: 'Email account secret storage ist nicht konfiguriert' };

  const user = resolveSmtpUser(input.account);
  if (!input.account.smtpUseImapAuth) {
    const smtpSecret = await input.readSecret(emailAccountSecretIdentifier(input.workspaceId, input.account.id, 'smtp'));
    if (smtpSecret) {
      return {
        ok: true,
        user,
        password: smtpSecret.toString('utf8'),
      };
    }
  }

  const imapSecret = await input.readSecret(emailAccountSecretIdentifier(input.workspaceId, input.account.id, 'imap'));
  if (imapSecret) {
    return {
      ok: true,
      user,
      password: imapSecret.toString('utf8'),
    };
  }

  if (input.account.oauthProvider) {
    return resolveOAuthSmtpAuth({
      workspaceId: input.workspaceId,
      account: input.account,
      user,
      readSecret: input.readSecret,
      writeSecret: input.writeSecret,
      getSyncInfo: input.getSyncInfo,
      oauthFetchImpl: input.oauthFetchImpl,
    });
  }

  return { ok: false, error: 'Kein SMTP-Passwort verfuegbar' };
}

async function resolveOAuthSmtpAuth(input: {
  workspaceId: string;
  account: VacationAccount;
  user: string;
  readSecret: (input: SecretIdentifier) => Promise<Buffer | null>;
  writeSecret?: (input: SecretIdentifier & { value: string | Buffer }) => Promise<unknown>;
  getSyncInfo: (input: {
    workspaceId: string;
    keys: readonly string[];
  }) => Promise<ReadonlyMap<string, string | null>>;
  oauthFetchImpl?: typeof fetch;
}): Promise<ResolvedSmtpAuth> {
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
      await input.writeSecret?.({ ...refreshIdentifier, value: refreshed.refreshToken });
    }
    return {
      ok: true,
      user: input.user,
      accessToken: refreshed.accessToken,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function normalizeEmailOAuthProvider(value: string | null): EmailOAuthProvider | null {
  return value === 'google' || value === 'microsoft' ? value : null;
}

function generateVacationTestMessageId(fromAddress: string, date: Date): string {
  const trimmed = fromAddress.trim();
  const angle = /<([^>]+)>/.exec(trimmed);
  const email = (angle?.[1] ?? trimmed).trim().toLowerCase();
  const at = email.lastIndexOf('@');
  const domain = at >= 0 ? email.slice(at + 1).replace(/[>]+$/, '') : 'simplecrm.local';
  return `<${date.getTime()}.${randomBytes(12).toString('hex')}@${domain}>`;
}

function extractSenderEmail(fromJson: unknown): string {
  const value = typeof fromJson === 'string' ? parseJson(fromJson) : fromJson;
  const recipients = isRecord(value) && Array.isArray(value.value)
    ? value.value
    : Array.isArray(value)
      ? value
      : [];
  for (const item of recipients) {
    if (!isRecord(item)) continue;
    const address = typeof item.address === 'string' ? item.address.trim() : '';
    if (address && /[\w.+-]+@[\w.-]+\.\w+/i.test(address)) return address.toLowerCase();
  }
  const raw = typeof fromJson === 'string' ? fromJson : JSON.stringify(fromJson ?? '');
  const match = raw.match(/[\w.+-]+@[\w.-]+\.\w+/i);
  return match?.[0]?.toLowerCase() ?? '';
}

function messageIsVacationEligible(message: VacationMessage): boolean {
  if (message.isSpam) return false;
  if (message.spamStatus === 'spam' || message.spamStatus === 'review') return false;
  if (message.spamScoreLabel === 'spam' || message.spamScoreLabel === 'review') return false;
  if (message.archived || message.softDeleted) return false;
  return message.folderKind === 'inbox';
}

function isAutoSubmitted(rawHeaders: string | null): boolean {
  const headers = (rawHeaders ?? '').toLowerCase();
  return headers.includes('auto-submitted:')
    || headers.includes('x-auto-response-suppress:')
    || headers.includes('precedence: bulk')
    || headers.includes('precedence: junk');
}

function vacationSentKey(accountId: number, sender: string): string {
  return `vacation_reply_sent:${accountId}:${sender}`;
}

function vacationFailKey(accountId: number, sender: string): string {
  return `vacation_smtp_fail:${accountId}:${sender}`;
}

function timestampWithin(value: string | null | undefined, now: Date, ttlMs: number): boolean {
  if (!value) return false;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) && now.getTime() - timestamp < ttlMs;
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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

function buildVacationTestRfc822(input: {
  from: string;
  to: string;
  subject: string;
  text: string;
  messageId: string;
  date: Date;
}): string {
  return [
    `From: ${encodeSingleMailbox(input.from)}`,
    `To: ${encodeSingleMailbox(input.to)}`,
    `Subject: ${encodeRfc2047(input.subject)}`,
    `Message-ID: ${normalizeHeaderValue(input.messageId)}`,
    `Date: ${input.date.toUTCString()}`,
    'MIME-Version: 1.0',
    'Auto-Submitted: auto-replied',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    normalizeBodyText(input.text),
  ].join('\r\n');
}

function buildVacationAutoReplyRfc822(input: {
  from: string;
  to: string;
  subject: string;
  text: string;
  messageId: string;
  inReplyTo: string | null;
  date: Date;
}): string {
  return [
    `From: ${encodeSingleMailbox(input.from)}`,
    `To: ${encodeSingleMailbox(input.to)}`,
    `Subject: ${encodeRfc2047(input.subject)}`,
    `Message-ID: ${normalizeHeaderValue(input.messageId)}`,
    ...(input.inReplyTo ? [`In-Reply-To: ${normalizeHeaderValue(input.inReplyTo)}`] : []),
    `Date: ${input.date.toUTCString()}`,
    'MIME-Version: 1.0',
    'Auto-Submitted: auto-replied',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    normalizeBodyText(input.text),
  ].join('\r\n');
}

function formatMailbox(displayName: string, emailAddress: string): string {
  const name = normalizeHeaderValue(displayName).replace(/[<>]+/g, ' ').replace(/\s+/g, ' ').trim();
  const email = emailAddress.trim();
  if (!name) return email;
  return `"${name.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}" <${email}>`;
}

function encodeRfc2047(text: string): string {
  const normalized = normalizeHeaderValue(text);
  if (/^[\x20-\x7e]*$/.test(normalized)) return normalized;
  return `=?UTF-8?B?${Buffer.from(normalized, 'utf8').toString('base64')}?=`;
}

function encodeSingleMailbox(mailbox: string): string {
  const match = /^(?:"?([^"]*?)"?\s*)?<([^<>@\s]+@[^<>@\s]+)>$/.exec(mailbox);
  if (!match) return normalizeHeaderValue(mailbox);
  const rawName = (match[1] ?? '').trim();
  const email = match[2];
  if (!rawName) return email;
  return `${encodeDisplayName(rawName)} <${email}>`;
}

function encodeDisplayName(text: string): string {
  const normalized = normalizeHeaderValue(text);
  if (/^[\x20-\x7e]*$/.test(normalized) && !/[()<>@,;:\\[\]"]/.test(normalized)) return normalized;
  return `=?UTF-8?B?${Buffer.from(normalized, 'utf8').toString('base64')}?=`;
}

function normalizeHeaderValue(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim();
}

function normalizeBodyText(value: string): string {
  return value.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').join('\r\n');
}

function serverCreatedVacationSourceSqliteId(kind: string): number {
  serverCreatedVacationSourceCounter = (serverCreatedVacationSourceCounter + 1) % 1000;
  let hash = 14_695_981_039_346_656_037n;
  for (let index = 0; index < kind.length; index += 1) {
    hash ^= BigInt(kind.charCodeAt(index));
    hash *= 1_099_511_628_211n;
    hash &= 0xffff_ffff_ffff_ffffn;
  }
  const value = (BigInt(Date.now()) * 1000n)
    + BigInt(serverCreatedVacationSourceCounter)
    + (hash % 997n);
  return -Number(value);
}
