import type { Kysely, RawBuilder } from 'kysely';

import {
  dispositionNotificationMatchesSender,
  domainTrusted,
  extractDispositionNotificationEmail,
  generateOutboundMessageId,
  normalizeMessageIdHeader,
  parseDispositionNotificationTo,
  resolveConfiguredSmtpHost,
  senderEmailFromAddressJson,
  SMTP_HOST_MISSING_ERROR,
} from '@simplecrm/core';

import type {
  EmailOAuthProvider,
  EmailReadReceiptRecord,
  EmailReadReceiptResponderApiPort,
} from './api';
import type { PostgresSecretPort, SecretIdentifier } from './db';
import type { ServerDatabase } from './db/schema';
import { withWorkspaceTransaction, type WorkspaceSessionApplier } from './db/workspace-context';
import { refreshServerEmailOAuthAccessToken } from './email-oauth';
import { sendSmtpMessage, type ServerSmtpSendInput } from './mail-smtp-send';

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

const MAX_READ_RECEIPT_OUTBOUND_WORKFLOWS = 50;
const MAX_READ_RECEIPT_OUTBOUND_CONTEXT_TEXT = 20_000;
const READ_RECEIPT_OUTBOUND_REVIEW_REASON =
  'Ausgangspruefung fuer Lesebestaetigung wird serverseitig ausgefuehrt; Versand bleibt blockiert, bis die Pruefung abgeschlossen ist.';

export type ReadReceiptResponderMessage = Readonly<{
  id: number;
  accountId: number | null;
  subject: string | null;
  messageIdHeader: string | null;
  referencesHeader: string | null;
  rawHeaders: string | null;
  fromJson: unknown | null;
  isSpam: boolean;
  folderKind: string;
  softDeleted: boolean;
}>;

export type ReadReceiptResponderAccount = Readonly<{
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
  respondToReadReceipts: string;
  readReceiptTrustedDomains: string | null;
}>;

export type ReadReceiptResponderStore = Readonly<{
  getMessage(input: {
    workspaceId: string;
    messageId: number;
  }): Promise<ReadReceiptResponderMessage | null>;
  getAccount(input: {
    workspaceId: string;
    accountId: number;
  }): Promise<ReadReceiptResponderAccount | null>;
  readSecret?(input: SecretIdentifier): Promise<Buffer | null>;
  writeSecret?(input: SecretIdentifier & { value: string | Buffer }): Promise<unknown>;
  getSyncInfo?(input: {
    workspaceId: string;
    keys: readonly string[];
  }): Promise<ReadonlyMap<string, string | null>>;
  recordSentBack(input: {
    workspaceId: string;
    actorUserId: string;
    messageId: number;
    recipient: string;
  }): Promise<EmailReadReceiptRecord>;
}>;

export type ReadReceiptOutboundReviewInput = Readonly<{
  workspaceId: string;
  actorUserId: string;
  messageId: number;
  subject: string;
  bodyText: string;
  to: string;
}>;

export type ReadReceiptOutboundReviewResult =
  | { allowed: true }
  | { allowed: false; error: string; workflowRunId?: number | null };

export type ReadReceiptOutboundReviewPort = Readonly<{
  review(input: ReadReceiptOutboundReviewInput): Promise<ReadReceiptOutboundReviewResult>;
}>;

export type ReadReceiptResponderOptions = Readonly<{
  store: ReadReceiptResponderStore;
  smtpSend?: (input: ServerSmtpSendInput) => Promise<void>;
  outboundReview?: ReadReceiptOutboundReviewPort;
  oauthFetchImpl?: typeof fetch;
  now?: () => Date;
}>;

export type PostgresReadReceiptResponderOptions = Readonly<{
  db: Kysely<ServerDatabase>;
  secrets?: PostgresSecretPort;
  smtpSend?: (input: ServerSmtpSendInput) => Promise<void>;
  outboundReview?: ReadReceiptOutboundReviewPort;
  oauthFetchImpl?: typeof fetch;
  now?: () => Date;
}>;

export function createEmailReadReceiptResponderPort(
  options: ReadReceiptResponderOptions,
): EmailReadReceiptResponderApiPort {
  const smtpSend = options.smtpSend ?? sendSmtpMessage;
  const now = options.now ?? (() => new Date());

  return {
    async send(input) {
      const message = await options.store.getMessage({
        workspaceId: input.workspaceId,
        messageId: input.messageId,
      });
      if (!message) return { success: false, error: 'Nachricht nicht gefunden' };
      if (message.isSpam) return { success: false, error: 'Lesebestaetigung fuer Spam-Nachrichten nicht erlaubt' };
      if (message.folderKind === 'trash' || message.softDeleted) {
        return { success: false, error: 'Lesebestaetigung fuer geloeschte Nachrichten nicht erlaubt' };
      }
      if (message.accountId === null) return { success: false, error: 'Konto nicht gefunden' };

      const account = await options.store.getAccount({
        workspaceId: input.workspaceId,
        accountId: message.accountId,
      });
      if (!account) return { success: false, error: 'Konto nicht gefunden' };
      if (account.respondToReadReceipts === 'never') {
        return { success: false, error: 'Lesebestaetigungen sind fuer dieses Konto deaktiviert' };
      }

      const fromJson = addressJsonForCore(message.fromJson);
      const senderEmail = senderEmailFromAddressJson(fromJson);
      if (account.respondToReadReceipts === 'always_trusted') {
        const senderDomain = senderEmail.split('@')[1]?.toLowerCase() ?? '';
        if (!senderDomain || !domainTrusted(account.readReceiptTrustedDomains, senderDomain)) {
          return { success: false, error: 'Absenderdomain ist nicht als vertrauenswuerdig konfiguriert' };
        }
      }

      const dispositionNotificationTo = parseDispositionNotificationTo(message.rawHeaders);
      if (!dispositionNotificationTo) return { success: false, error: 'Keine MDN-Anfrage in dieser Nachricht' };
      if (!dispositionNotificationMatchesSender(dispositionNotificationTo, fromJson)) {
        return {
          success: false,
          error: 'MDN-Empfaenger stimmt nicht mit dem Absender ueberein (RFC 8098)',
        };
      }

      const recipient = extractDispositionNotificationEmail(dispositionNotificationTo);
      if (!recipient) return { success: false, error: 'MDN-Empfaenger nicht parsebar' };

      const subject = `Gelesen: ${message.subject ?? '(ohne Betreff)'}`;
      const body = buildReadReceiptBody(message, now());
      const outboundMessageId = generateOutboundMessageId(account.emailAddress);
      const inReplyTo = normalizeMessageIdHeader(message.messageIdHeader);
      const references = normalizeReferences(message.referencesHeader, inReplyTo);

      if (options.outboundReview) {
        const review = await options.outboundReview.review({
          workspaceId: input.workspaceId,
          actorUserId: input.actorUserId,
          messageId: input.messageId,
          subject,
          bodyText: body,
          to: recipient,
        });
        if (!review.allowed) return { success: false, error: review.error };
      }

      const auth = await resolveSmtpAuth({
        workspaceId: input.workspaceId,
        account,
        readSecret: options.store.readSecret,
        writeSecret: options.store.writeSecret,
        getSyncInfo: options.store.getSyncInfo,
        oauthFetchImpl: options.oauthFetchImpl,
      });
      if (!auth.ok) return { success: false, error: auth.error };

      const smtpHost = resolveConfiguredSmtpHost(account.smtpHost);
      if (!smtpHost) return { success: false, error: SMTP_HOST_MISSING_ERROR };

      try {
        const smtpInput: ServerSmtpSendInput = {
          host: smtpHost,
          port: account.smtpPort ?? 587,
          tls: account.smtpTls,
          user: auth.user,
          envelopeFrom: account.emailAddress,
          recipients: [recipient],
          rfc822: buildReadReceiptRfc822({
            from: formatMailbox(account.displayName, account.emailAddress),
            to: recipient,
            subject,
            body,
            messageId: outboundMessageId,
            inReplyTo,
            references,
            date: now(),
          }),
        };
        await smtpSend({
          ...smtpInput,
          ...(auth.password !== undefined ? { password: auth.password } : {}),
          ...(auth.accessToken !== undefined ? { accessToken: auth.accessToken } : {}),
        });
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }

      const receipt = await options.store.recordSentBack({
        workspaceId: input.workspaceId,
        actorUserId: input.actorUserId,
        messageId: input.messageId,
        recipient,
      });
      return { success: true, receipt };
    },
  };
}

export function createPostgresEmailReadReceiptResponderPort(
  options: PostgresReadReceiptResponderOptions,
): EmailReadReceiptResponderApiPort {
  return createEmailReadReceiptResponderPort({
    smtpSend: options.smtpSend,
    outboundReview: options.outboundReview ?? createPostgresReadReceiptOutboundReviewPort({
      db: options.db,
      now: options.now,
    }),
    oauthFetchImpl: options.oauthFetchImpl,
    now: options.now,
    store: {
      async getMessage(input) {
        return withWorkspaceTransaction(
          options.db,
          { workspaceId: input.workspaceId, role: 'system' },
          async (trx) => {
            const row = await trx
              .selectFrom('email_messages')
              .select([
                'id',
                'account_id',
                'subject',
                'message_id',
                'references_header',
                'raw_headers',
                'from_json',
                'is_spam',
                'folder_kind',
                'soft_deleted',
              ])
              .where('workspace_id', '=', input.workspaceId)
              .where('id', '=', input.messageId)
              .executeTakeFirst();
            return row
              ? {
                id: Number(row.id),
                accountId: row.account_id === null ? null : Number(row.account_id),
                subject: row.subject,
                messageIdHeader: row.message_id,
                referencesHeader: row.references_header,
                rawHeaders: row.raw_headers,
                fromJson: row.from_json,
                isSpam: Boolean(row.is_spam),
                folderKind: row.folder_kind,
                softDeleted: Boolean(row.soft_deleted),
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
                'respond_to_read_receipts',
                'read_receipt_trusted_domains',
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
                respondToReadReceipts: row.respond_to_read_receipts,
                readReceiptTrustedDomains: row.read_receipt_trusted_domains,
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
      async recordSentBack(input) {
        return withWorkspaceTransaction(
          options.db,
          { workspaceId: input.workspaceId, role: 'system' },
          async (trx) => {
            const receiptRow = await trx
              .insertInto('email_read_receipt_log')
              .values({
                workspace_id: input.workspaceId,
                source_sqlite_id: serverCreatedEmailReadReceiptSourceSqliteId(),
                message_source_sqlite_id: emailMessageSourceSqliteId(input.workspaceId, input.messageId),
                message_id: input.messageId,
                direction: 'sent_back',
                recipient: input.recipient,
                at: options.now?.() ?? new Date(),
                source_row: {},
                imported_in_run_id: null,
                updated_at: options.now?.() ?? new Date(),
              })
              .returning([
                'id',
                'source_sqlite_id',
                'message_source_sqlite_id',
                'message_id',
                'direction',
                'recipient',
                'at',
                'updated_at',
              ])
              .executeTakeFirstOrThrow();

            await trx
              .updateTable('email_messages')
              .set({
                read_receipt_requested: false,
                updated_at: options.now?.() ?? new Date(),
              })
              .where('workspace_id', '=', input.workspaceId)
              .where('id', '=', input.messageId)
              .executeTakeFirst();

            return mapEmailReadReceiptRow(receiptRow);
          },
        );
      },
    },
  });
}

export function createPostgresReadReceiptOutboundReviewPort(options: {
  db: Kysely<ServerDatabase>;
  applyWorkspaceSession?: WorkspaceSessionApplier;
  now?: () => Date;
}): ReadReceiptOutboundReviewPort {
  return {
    async review(input) {
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          const now = options.now?.() ?? new Date();
          const workflows = await trx
            .selectFrom('email_workflows')
            .select(['id', 'source_sqlite_id', 'name', 'priority'])
            .where('workspace_id', '=', input.workspaceId)
            .where('trigger_name', '=', 'outbound')
            .where('enabled', '=', true)
            .orderBy('priority', 'asc')
            .orderBy('id', 'asc')
            .limit(MAX_READ_RECEIPT_OUTBOUND_WORKFLOWS)
            .execute();

          if (workflows.length === 0) return { allowed: true };

          const message = await trx
            .selectFrom('email_messages')
            .select(['id', 'source_sqlite_id'])
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.messageId)
            .executeTakeFirst();
          if (!message) return { allowed: false, error: 'Nachricht nicht gefunden' };

          let firstRunId: number | null = null;
          for (const workflow of workflows) {
            const workflowId = Number(workflow.id);
            const workflowSourceSqliteId = workflow.source_sqlite_id === null
              ? -workflowId
              : Number(workflow.source_sqlite_id);
            const run = await trx
              .insertInto('email_workflow_runs')
              .values({
                workspace_id: input.workspaceId,
                source_sqlite_id: null,
                workflow_source_sqlite_id: workflowSourceSqliteId,
                message_source_sqlite_id: Number(message.source_sqlite_id),
                workflow_id: workflowId,
                message_id: input.messageId,
                direction: 'outbound',
                status: 'queued',
                // jsonb column: stringify the array so node-postgres sends
                // valid JSON instead of a Postgres array literal ({...}).
                log_json: JSON.stringify(['queued:server_read_receipt_outbound_review']),
                source_row: { origin: 'server_read_receipt_outbound_review' },
                imported_in_run_id: null,
                started_at: null,
                finished_at: null,
                updated_at: now,
              })
              .returning('id')
              .executeTakeFirstOrThrow();
            const runId = Number(run.id);
            if (firstRunId === null) firstRunId = runId;

            await trx
              .insertInto('job_queue')
              .values({
                type: 'workflow.execute',
                payload: readReceiptOutboundWorkflowJobPayload(input, workflowId, runId),
                run_after: now,
                max_attempts: 5,
                workspace_id: input.workspaceId,
                updated_at: now,
              })
              .execute();
          }

          return {
            allowed: false,
            error: READ_RECEIPT_OUTBOUND_REVIEW_REASON,
            workflowRunId: firstRunId,
          };
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
  };
}

function readReceiptOutboundWorkflowJobPayload(
  input: ReadReceiptOutboundReviewInput,
  workflowId: number,
  runId: number,
): Record<string, unknown> {
  return {
    workspaceId: input.workspaceId,
    workflowId,
    messageId: input.messageId,
    runId,
    triggerName: 'outbound',
    actorUserId: input.actorUserId,
    context: {
      outbound: {
        messageId: input.messageId,
        subject: input.subject,
        bodyText: truncateReadReceiptOutboundContextText(input.bodyText),
        bodyHtml: null,
        to: input.to,
        cc: '',
        bcc: '',
        inReplyToMessageId: null,
        attachmentCount: 0,
        attachmentPaths: [],
      },
      readReceipt: true,
      source: 'server_read_receipt_outbound_review',
    },
  };
}

function truncateReadReceiptOutboundContextText(value: string): string {
  return value.length > MAX_READ_RECEIPT_OUTBOUND_CONTEXT_TEXT
    ? `${value.slice(0, MAX_READ_RECEIPT_OUTBOUND_CONTEXT_TEXT)}...`
    : value;
}

function resolveSmtpUser(account: ReadReceiptResponderAccount): string {
  return account.smtpUseImapAuth
    ? account.imapUsername
    : account.smtpUsername?.trim() || account.imapUsername;
}

type ResolvedSmtpAuth =
  | { ok: true; user: string; password?: string; accessToken?: string }
  | { ok: false; error: string };

async function resolveSmtpAuth(input: {
  workspaceId: string;
  account: ReadReceiptResponderAccount;
  readSecret?: (input: SecretIdentifier) => Promise<Buffer | null>;
  writeSecret?: (input: SecretIdentifier & { value: string | Buffer }) => Promise<unknown>;
  getSyncInfo?: (input: {
    workspaceId: string;
    keys: readonly string[];
  }) => Promise<ReadonlyMap<string, string | null>>;
  oauthFetchImpl?: typeof fetch;
}): Promise<ResolvedSmtpAuth> {
  if (!input.readSecret) {
    return { ok: false, error: 'Email account secret storage ist nicht konfiguriert' };
  }

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
  account: ReadReceiptResponderAccount;
  user: string;
  readSecret: (input: SecretIdentifier) => Promise<Buffer | null>;
  writeSecret?: (input: SecretIdentifier & { value: string | Buffer }) => Promise<unknown>;
  getSyncInfo?: (input: {
    workspaceId: string;
    keys: readonly string[];
  }) => Promise<ReadonlyMap<string, string | null>>;
  oauthFetchImpl?: typeof fetch;
}): Promise<ResolvedSmtpAuth> {
  const provider = normalizeEmailOAuthProvider(input.account.oauthProvider);
  if (!provider) return { ok: false, error: 'OAuth-Provider wird serverseitig nicht unterstuetzt' };
  if (!input.getSyncInfo) return { ok: false, error: 'OAuth-Appdaten sind serverseitig nicht konfiguriert' };

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

function serverCreatedEmailReadReceiptSourceSqliteId(): RawBuilder<number> {
  const { sql: kyselySql } = require('kysely') as typeof import('kysely');
  return kyselySql<number>`-nextval(pg_get_serial_sequence('email_read_receipt_log', 'id'))`;
}

function emailMessageSourceSqliteId(workspaceId: string, messageId: number): RawBuilder<number> {
  const { sql: kyselySql } = require('kysely') as typeof import('kysely');
  return kyselySql<number>`(
    SELECT source_sqlite_id FROM email_messages
    WHERE workspace_id = ${workspaceId} AND id = ${messageId}
  )`;
}

function buildReadReceiptBody(message: ReadReceiptResponderMessage, readAt: Date): string {
  return [
    'Dies ist eine Lesebestaetigung fuer Ihre Nachricht.',
    '',
    message.messageIdHeader?.trim() ? `Original-Message-ID: ${message.messageIdHeader.trim()}` : '',
    `Gelesen am: ${readAt.toISOString()}`,
  ]
    .filter(Boolean)
    .join('\n');
}

function buildReadReceiptRfc822(input: {
  from: string;
  to: string;
  subject: string;
  body: string;
  messageId: string;
  inReplyTo: string | null;
  references: string | undefined;
  date: Date;
}): string {
  const lines = [
    `From: ${encodeMailboxListHeader(input.from)}`,
    `To: ${encodeMailboxListHeader(input.to)}`,
    `Subject: ${encodeRfc2047(input.subject)}`,
    `Message-ID: ${sanitizeHeaderValue(input.messageId)}`,
    ...(input.inReplyTo ? [`In-Reply-To: ${sanitizeHeaderValue(input.inReplyTo)}`] : []),
    ...(input.references ? [`References: ${sanitizeHeaderValue(input.references)}`] : []),
    'Auto-Submitted: auto-replied',
    'MIME-Version: 1.0',
    `Date: ${input.date.toUTCString()}`,
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    input.body,
    '',
  ];
  return lines.join('\r\n');
}

function normalizeReferences(rawReferences: string | null, inReplyTo: string | null): string | undefined {
  const references = (rawReferences ?? '')
    .split(/\s+/)
    .map((reference) => normalizeMessageIdHeader(reference))
    .filter((reference): reference is string => Boolean(reference));
  if (inReplyTo) references.push(inReplyTo);
  return references.length > 0 ? Array.from(new Set(references)).join(' ') : undefined;
}

function formatMailbox(displayName: string, emailAddress: string): string {
  const name = displayName.trim();
  if (!name) return emailAddress.trim();
  return `${name.replace(/[\r\n"]/g, ' ').trim()} <${emailAddress.trim()}>`;
}

function addressJsonForCore(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return null;
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

function sanitizeHeaderValue(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim();
}

function encodeRfc2047(text: string): string {
  if (/^[\x20-\x7E]*$/.test(text)) return sanitizeHeaderValue(text);
  const buf = Buffer.from(text, 'utf-8');
  const chunk = 45;
  const parts: string[] = [];
  let offset = 0;
  while (offset < buf.length) {
    let end = Math.min(offset + chunk, buf.length);
    while (end < buf.length && end > offset && (buf[end]! & 0xC0) === 0x80) end -= 1;
    if (end === offset) end = Math.min(offset + chunk, buf.length);
    parts.push(`=?UTF-8?B?${buf.subarray(offset, end).toString('base64')}?=`);
    offset = end;
  }
  return parts.join('\r\n ');
}

function encodeMailboxListHeader(value: string): string {
  const trimmed = sanitizeHeaderValue(value);
  const match = /^(.*)<([^>]+)>$/.exec(trimmed);
  if (!match) return trimmed;
  const rawName = match[1]!.trim();
  const email = match[2]!.trim();
  if (!rawName) return `<${email}>`;
  const encoded = encodeRfc2047(rawName);
  return `${encoded} <${email}>`;
}

function mapEmailReadReceiptRow(row: {
  id: number;
  source_sqlite_id: number;
  message_source_sqlite_id: number;
  message_id: number | null;
  direction: string;
  recipient: string | null;
  at: Date | string | null;
  updated_at: Date | string;
}): EmailReadReceiptRecord {
  return {
    id: Number(row.id),
    sourceSqliteId: Number(row.source_sqlite_id),
    messageSourceSqliteId: Number(row.message_source_sqlite_id),
    messageId: row.message_id === null ? null : Number(row.message_id),
    direction: row.direction,
    recipient: row.recipient,
    at: row.at === null ? null : toDate(row.at).toISOString(),
    updatedAt: toDate(row.updated_at).toISOString(),
  };
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}
