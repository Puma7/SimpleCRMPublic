import { readFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';

import {
  buildFeaturePreview,
  buildSpamDecision,
  evaluatePreWorkflowMailSecurity,
  evaluateSenderFilterFromLists,
  isCorruptRawHeaders,
  isSpamLearningFeatureKey,
  normalizeAddressJson,
  addressJson,
  normalizeEmailAddress,
  parseSenderList,
  parseScheduledSendDraftStateFromValues,
  scheduledSendFailuresKey,
  scheduledSendLastErrorKey,
  scheduledSendStatusKey,
  scheduledSendSyncInfoKeys,
  shouldAutoApplySpamStatus,
  shouldRunInitialSpamScoring,
  SPAM_ENGINE_MODEL_VERSION,
  type SpamEngineSettings,
  type SpamListMatch,
  type SpamScoreBreakdown,
  type SenderFilterResult,
} from '@simplecrm/core';
import { sql as kyselySql, type Kysely, type Selectable, type Updateable } from 'kysely';

import type {
  EmailAttachmentContentApiPort,
  EmailAttachmentContentResult,
  EmailAttachmentApiPort,
  EmailAttachmentListResult,
  EmailAttachmentRecord,
  EmailAccountApiPort,
  EmailAccountListResult,
  EmailAccountMutationInput,
  EmailAccountMutationPortResult,
  EmailAccountRecord,
  EmailMessageApiPort,
  EmailInboxArchiveRecoveryPreview,
  EmailMailFolderCounts,
  EmailMessageListResult,
  EmailMessageRecord,
  EmailMessageRawHeadersRecord,
  EmailReadReceiptStateResult,
  EmailRemoteContentPolicy,
  EmailRemoteContentPolicyMutationResult,
  EmailRemoteContentPolicyResult,
  EmailMessageSecurityRecord,
  EmailMessageSecurityCheckResult,
  EmailMessageSpamDecisionResult,
  EmailMessageSpamStatusMutationInput,
  EmailComposeDraftCreateInput,
  EmailComposeDraftMutationResult,
  SpamDecisionRecord,
} from '../api/types';
import type {
  EmailAccountsTable,
  EmailFoldersTable,
  EmailMessageAttachmentsTable,
  EmailMessagesTable,
  ServerDatabase,
} from './schema';
import type { PostgresSecretPort } from './postgres-secret-port';
import {
  withWorkspaceTransaction,
  type WorkspaceSessionApplier,
  type WorkspaceTransaction,
} from './workspace-context';
import {
  learnMessageWithRspamd,
  runStoredMailSecurityChecks,
  type MailAuthVerification,
  type RspamdCheckResult,
  type RspamdLearnLabel,
} from '../mail-security-check';
import type { ServerWorkflowImapActionPort } from '../workflow-imap-actions';

export type PostgresMailReadPortOptions = Readonly<{
  db: Kysely<ServerDatabase>;
  applyWorkspaceSession?: WorkspaceSessionApplier;
  rspamdFetch?: typeof fetch;
  seenFlagSync?: Pick<ServerWorkflowImapActionPort, 'setSeen'>;
}>;

export type PostgresEmailAccountReadPortOptions = PostgresMailReadPortOptions & Readonly<{
  secrets?: PostgresSecretPort;
}>;

export type PostgresEmailAttachmentContentPortOptions = PostgresMailReadPortOptions & Readonly<{
  attachmentsRoot: string;
  readFile?: (path: string) => Promise<Uint8Array>;
}>;

type EmailAccountRow = Selectable<EmailAccountsTable>;
type EmailAttachmentRow = Selectable<EmailMessageAttachmentsTable>;
type EmailFolderRow = Selectable<EmailFoldersTable>;
type EmailMessageRow = Selectable<EmailMessagesTable>;

let serverCreatedSourceCounter = 0;

const emailAccountSelectColumns = [
  'id',
  'source_sqlite_id',
  'display_name',
  'email_address',
  'imap_host',
  'imap_port',
  'imap_tls',
  'imap_username',
  'keytar_account_key',
  'imap_password_secret_id',
  'smtp_host',
  'smtp_port',
  'smtp_tls',
  'smtp_username',
  'smtp_use_imap_auth',
  'smtp_keytar_account_key',
  'smtp_password_secret_id',
  'protocol',
  'pop3_host',
  'pop3_port',
  'pop3_tls',
  'oauth_provider',
  'oauth_refresh_keytar_key',
  'oauth_refresh_secret_id',
  'sent_folder_path',
  'sync_spam_folder_path',
  'sync_archive_folder_path',
  'imap_sync_sent',
  'imap_sync_archive',
  'imap_sync_spam',
  'imap_sync_seen_on_open',
  'vacation_enabled',
  'vacation_subject',
  'vacation_body_text',
  'request_read_receipt',
  'imap_delete_opt_in',
  'default_remote_content_policy',
  'respond_to_read_receipts',
  'updated_at',
] as const;

const emailMessageSummaryColumns = [
  'id',
  'source_sqlite_id',
  'account_id',
  'folder_id',
  'uid',
  'message_id',
  'subject',
  'from_json',
  'to_json',
  'cc_json',
  'bcc_json',
  'date_received',
  'snippet',
  'seen_local',
  'done_local',
  'archived',
  'soft_deleted',
  'folder_kind',
  'thread_id',
  'imap_thread_id',
  'ticket_code',
  'customer_id',
  'has_attachments',
  'assigned_to',
  'assigned_to_user_id',
  'is_spam',
  'spam_status',
  'pgp_status',
  'remote_content_policy',
  'read_receipt_requested',
  'snoozed_until',
  'draft_attachment_paths_json',
  'reply_parent_message_id',
  'updated_at',
] as const;

const emailMessageDetailColumns = [
  ...emailMessageSummaryColumns,
  'body_text',
  'body_html',
] as const;

const emailMessageSpamStatusMutationColumns = [
  ...emailMessageSummaryColumns,
  'account_source_sqlite_id',
  'body_text',
  'body_html',
  'auth_spf',
  'auth_dkim',
  'auth_dmarc',
  'auth_arc',
  'attachments_json',
  'rspamd_score',
  'rspamd_action',
  'raw_headers',
  'raw_rfc822_b64',
  'spam_score',
  'spam_score_label',
  'spam_decision_source',
  'spam_score_breakdown_json',
  'spam_decided_at',
] as const;

const emailMessageSecurityCheckColumns = [
  ...emailMessageSpamStatusMutationColumns,
] as const;

const emailMessageSecurityColumns = [
  'auth_spf',
  'auth_dkim',
  'auth_dmarc',
  'auth_arc',
  'auth_dkim_domains',
  'auth_error',
  'rspamd_score',
  'rspamd_action',
  'rspamd_symbols',
  'rspamd_error',
  'security_checked_at',
  'spam_status',
  'spam_score',
  'spam_score_label',
  'spam_decision_source',
  'spam_score_breakdown_json',
  'spam_decided_at',
] as const;

const emailMessageRawHeadersColumns = [
  'id',
  'account_id',
  'folder_id',
  'uid',
  'message_id',
  'in_reply_to',
  'references_header',
  'subject',
  'from_json',
  'to_json',
  'cc_json',
  'date_received',
  'body_text',
  'body_html',
  'pop3_uidl',
  'raw_headers',
  'raw_rfc822_b64',
  'auth_spf',
  'auth_dkim',
  'auth_dmarc',
] as const;

const emailAttachmentSelectColumns = [
  'id',
  'source_sqlite_id',
  'message_source_sqlite_id',
  'message_id',
  'filename_display',
  'content_type',
  'size_bytes',
  'content_sha256',
  'storage_path',
  'updated_at',
] as const;

const emailAttachmentContentSelectColumns = [
  ...emailAttachmentSelectColumns,
] as const;

const MAX_EMAIL_MESSAGE_LIST_LIMIT = 500;
const POP3_UID_CEILING = -1_000_000;
const DEFAULT_RSPAMD_URL = 'http://127.0.0.1:11333';
const DEFAULT_RSPAMD_TIMEOUT_MS = 8000;

type EmailMessageApiRow =
  & Pick<EmailMessageRow, typeof emailMessageSummaryColumns[number]>
  & Partial<Pick<EmailMessageRow, 'body_text' | 'body_html'>>;

type LocalDraftMutationRow = Pick<EmailMessageRow, typeof emailMessageDetailColumns[number]>;

type EmailMessageSpamStatusMutationRow = Pick<EmailMessageRow, typeof emailMessageSpamStatusMutationColumns[number]>;
type EmailMessageSecurityRow = Pick<EmailMessageRow, typeof emailMessageSecurityColumns[number]>;
type EmailMessageRawHeadersRow = Pick<EmailMessageRow, typeof emailMessageRawHeadersColumns[number]>;
type EmailReadReceiptStateRow = Pick<EmailMessageRow, 'read_receipt_requested'> & {
  respond_to_read_receipts: string | null;
  read_receipt_trusted_domains: string | null;
};

type EmailMailFolderCountsRow = {
  inbox: number | string | bigint | null;
  inbox_unread: number | string | bigint | null;
  sent_failed: number | string | bigint | null;
  drafts: number | string | bigint | null;
  scheduled_send: number | string | bigint | null;
  archived: number | string | bigint | null;
  spam_review: number | string | bigint | null;
  spam: number | string | bigint | null;
  trash: number | string | bigint | null;
  snoozed: number | string | bigint | null;
};

type MailSecurityCheckSettings = {
  mailauthEnabled: boolean;
  rspamdEnabled: boolean;
  rspamdUrl: string;
  rspamdTimeoutMs: number;
  rspamdSpamScore: number;
  autoSpamDmarcFail: boolean;
  autoSpamSpfFail: boolean;
  autoSpamRspamd: boolean;
  senderWhitelist: string;
  senderBlacklist: string;
};

type SpamLearningSettings = {
  localLearningEnabled: boolean;
  rspamdLearningEnabled: boolean;
  rspamdUrl: string;
  rspamdTimeoutMs: number;
};

type RspamdLearningRequest = {
  label: RspamdLearnLabel;
  rawRfc822B64: string | null;
  rawHeaders: string | null;
  bodyText: string | null;
  bodyHtml: string | null;
  rspamdUrl: string;
  rspamdTimeoutMs: number;
};

type ServerMailSecurityAutomationResult = {
  skippedWorkflows: boolean;
  tags: string[];
};

type EmailRemoteContentPolicyRow = Pick<EmailMessageRow, 'id' | 'from_json' | 'remote_content_policy'> & {
  default_remote_content_policy: string | null;
};

export function createPostgresEmailAccountReadPort(options: PostgresEmailAccountReadPortOptions): EmailAccountApiPort {
  return {
    async list(input): Promise<EmailAccountListResult> {
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          const rows = await trx
            .selectFrom('email_accounts')
            .select(emailAccountSelectColumns)
            .where('workspace_id', '=', input.workspaceId)
            .orderBy('id', 'asc')
            .execute();
          return { items: rows.map(mapEmailAccountRow) };
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async get(input): Promise<EmailAccountRecord | null> {
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          const row = await selectEmailAccountByPublicId(trx, input.workspaceId, input.id);
          return row ? mapEmailAccountRow(row) : null;
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async create(input): Promise<EmailAccountMutationPortResult> {
      const writesSecret = passwordShouldBeStored(input.values.imapPassword)
        || passwordShouldBeStored(input.values.smtpPassword);
      if (writesSecret && !options.secrets) {
        return { ok: false, code: 'secret_port_unavailable' };
      }

      let inserted: Pick<EmailAccountRow, typeof emailAccountSelectColumns[number]> | undefined;
      let insertedId: number | undefined;
      let imapSecretName: { workspaceId: string; kind: string; name: string } | undefined;
      let smtpSecretName: { workspaceId: string; kind: string; name: string } | undefined;
      try {
        inserted = await withWorkspaceTransaction(
          options.db,
          {
            workspaceId: input.workspaceId,
            userId: input.actorUserId,
            role: 'user',
          },
          async (trx) => {
            const now = new Date();
            return trx
              .insertInto('email_accounts')
              .values({
                workspace_id: input.workspaceId,
                source_sqlite_id: serverCreatedEmailAccountSourceSqliteId(),
                display_name: input.values.displayName ?? '',
                email_address: input.values.emailAddress ?? '',
                imap_host: input.values.imapHost ?? '',
                imap_port: input.values.imapPort ?? 993,
                imap_tls: input.values.imapTls ?? true,
                imap_username: input.values.imapUsername ?? '',
                keytar_account_key: null,
                imap_password_secret_id: null,
                smtp_host: input.values.smtpHost ?? null,
                smtp_port: input.values.smtpPort ?? 587,
                smtp_tls: input.values.smtpTls ?? true,
                smtp_username: input.values.smtpUsername ?? null,
                smtp_use_imap_auth: input.values.smtpUseImapAuth ?? true,
                smtp_keytar_account_key: null,
                smtp_password_secret_id: null,
                protocol: input.values.protocol ?? 'imap',
                pop3_host: input.values.pop3Host ?? null,
                pop3_port: input.values.pop3Port ?? 995,
                pop3_tls: input.values.pop3Tls ?? true,
                oauth_provider: null,
                oauth_refresh_keytar_key: null,
                oauth_refresh_secret_id: null,
                sent_folder_path: input.values.sentFolderPath ?? 'Sent',
                sync_spam_folder_path: input.values.syncSpamFolderPath ?? null,
                sync_archive_folder_path: input.values.syncArchiveFolderPath ?? null,
                imap_sync_sent: input.values.imapSyncSent ?? false,
                imap_sync_archive: input.values.imapSyncArchive ?? false,
                imap_sync_spam: input.values.imapSyncSpam ?? false,
                imap_sync_seen_on_open: input.values.imapSyncSeenOnOpen ?? true,
                vacation_enabled: input.values.vacationEnabled ?? false,
                vacation_subject: input.values.vacationSubject ?? null,
                vacation_body_text: input.values.vacationBodyText ?? null,
                request_read_receipt: input.values.requestReadReceipt ?? false,
                imap_delete_opt_in: input.values.imapDeleteOptIn ?? false,
                default_remote_content_policy: 'blocked',
                respond_to_read_receipts: 'never',
                read_receipt_trusted_domains: null,
                source_row: serverApiSourceRow(),
                imported_in_run_id: null,
                created_at: now,
                updated_at: now,
              })
              .returning(emailAccountSelectColumns)
              .executeTakeFirstOrThrow();
          },
          { applySession: options.applyWorkspaceSession },
        );
        const accountId = Number(inserted.id);
        insertedId = accountId;

        let imapSecretId: string | undefined;
        if (passwordShouldBeStored(input.values.imapPassword)) {
          imapSecretName = emailAccountSecretIdentifier(input.workspaceId, accountId, 'imap');
          const secret = await options.secrets?.writeSecret({
            ...imapSecretName,
            value: input.values.imapPassword as string,
          });
          imapSecretId = secret?.id;
        }

        let smtpSecretId: string | undefined;
        if (passwordShouldBeStored(input.values.smtpPassword)) {
          smtpSecretName = emailAccountSecretIdentifier(input.workspaceId, accountId, 'smtp');
          const secret = await options.secrets?.writeSecret({
            ...smtpSecretName,
            value: input.values.smtpPassword as string,
          });
          smtpSecretId = secret?.id;
        }

        const account = await withWorkspaceTransaction(
          options.db,
          {
            workspaceId: input.workspaceId,
            userId: input.actorUserId,
            role: 'user',
          },
          async (trx) => {
            const row = await trx
              .updateTable('email_accounts')
              .set({
                ...(imapSecretId === undefined ? {} : { imap_password_secret_id: imapSecretId }),
                ...(smtpSecretId === undefined ? {} : { smtp_password_secret_id: smtpSecretId }),
                updated_at: new Date(),
              })
              .where('workspace_id', '=', input.workspaceId)
              .where('id', '=', accountId)
              .returning(emailAccountSelectColumns)
              .executeTakeFirstOrThrow();
            return mapEmailAccountRow(row);
          },
          { applySession: options.applyWorkspaceSession },
        );

        return { ok: true, account };
      } catch (cause) {
        if (insertedId !== undefined) {
          const accountId = insertedId;
          await withWorkspaceTransaction(
            options.db,
            { workspaceId: input.workspaceId, userId: input.actorUserId, role: 'user' },
            async (trx) => {
              await trx
                .deleteFrom('email_accounts')
                .where('workspace_id', '=', input.workspaceId)
                .where('id', '=', accountId)
                .executeTakeFirst();
            },
            { applySession: options.applyWorkspaceSession },
          ).catch(() => undefined);
        }
        await Promise.all([
          imapSecretName ? options.secrets?.deleteSecret(imapSecretName) : undefined,
          smtpSecretName ? options.secrets?.deleteSecret(smtpSecretName) : undefined,
        ].filter(Boolean).map((promise) => (promise as Promise<unknown>).catch(() => undefined)));
        throw cause;
      }
    },
    async update(input): Promise<EmailAccountMutationPortResult | null> {
      const current = await withWorkspaceTransaction(
        options.db,
        {
          workspaceId: input.workspaceId,
          userId: input.actorUserId,
          role: 'user',
        },
        async (trx) => selectEmailAccountByPublicId(trx, input.workspaceId, input.id),
        { applySession: options.applyWorkspaceSession },
      );
      if (!current) return null;

      const patch = mutationToEmailAccountPatch(input.values);
      const writesSecret = passwordShouldBeStored(input.values.imapPassword)
        || passwordShouldBeStored(input.values.smtpPassword);
      if (writesSecret && !options.secrets) {
        return { ok: false, code: 'secret_port_unavailable' };
      }

      let imapSecretId: string | undefined;
      if (passwordShouldBeStored(input.values.imapPassword)) {
        const secret = await options.secrets?.writeSecret({
          ...emailAccountSecretIdentifier(input.workspaceId, Number(current.id), 'imap'),
          value: input.values.imapPassword as string,
        });
        imapSecretId = secret?.id;
      }

      let smtpSecretId: string | undefined;
      if (passwordShouldBeStored(input.values.smtpPassword)) {
        const secret = await options.secrets?.writeSecret({
          ...emailAccountSecretIdentifier(input.workspaceId, Number(current.id), 'smtp'),
          value: input.values.smtpPassword as string,
        });
        smtpSecretId = secret?.id;
      }

      const account = await withWorkspaceTransaction(
        options.db,
        {
          workspaceId: input.workspaceId,
          userId: input.actorUserId,
          role: 'user',
        },
        async (trx) => {
          const now = new Date();
          const row = await trx
            .updateTable('email_accounts')
            .set({
              ...patch,
              ...(imapSecretId === undefined ? {} : {
                keytar_account_key: null,
                imap_password_secret_id: imapSecretId,
              }),
              ...(smtpSecretId === undefined ? {} : {
                smtp_keytar_account_key: null,
                smtp_password_secret_id: smtpSecretId,
              }),
              updated_at: now,
            })
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', Number(current.id))
            .returning(emailAccountSelectColumns)
            .executeTakeFirstOrThrow();
          return mapEmailAccountRow(row);
        },
        { applySession: options.applyWorkspaceSession },
      );

      return { ok: true, account };
    },
    async setOAuthRefreshToken(input): Promise<EmailAccountMutationPortResult | null> {
      const current = await withWorkspaceTransaction(
        options.db,
        {
          workspaceId: input.workspaceId,
          userId: input.actorUserId,
          role: 'user',
        },
        async (trx) => selectEmailAccountByPublicId(trx, input.workspaceId, input.id),
        { applySession: options.applyWorkspaceSession },
      );
      if (!current) return null;
      if (!options.secrets) return { ok: false, code: 'secret_port_unavailable' };

      const secret = await options.secrets.writeSecret({
        ...emailAccountSecretIdentifier(input.workspaceId, Number(current.id), 'oauth_refresh'),
        value: input.refreshToken,
      });

      const account = await withWorkspaceTransaction(
        options.db,
        {
          workspaceId: input.workspaceId,
          userId: input.actorUserId,
          role: 'user',
        },
        async (trx) => {
          const row = await trx
            .updateTable('email_accounts')
            .set({
              oauth_provider: input.provider,
              oauth_refresh_keytar_key: null,
              oauth_refresh_secret_id: secret.id,
              updated_at: new Date(),
            })
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', Number(current.id))
            .returning(emailAccountSelectColumns)
            .executeTakeFirstOrThrow();
          return mapEmailAccountRow(row);
        },
        { applySession: options.applyWorkspaceSession },
      );

      return { ok: true, account };
    },
    async delete(input): Promise<EmailAccountMutationPortResult | null> {
      const current = await withWorkspaceTransaction(
        options.db,
        {
          workspaceId: input.workspaceId,
          userId: input.actorUserId,
          role: 'user',
        },
        async (trx) => selectEmailAccountByPublicId(trx, input.workspaceId, input.id),
        { applySession: options.applyWorkspaceSession },
      );
      if (!current) return null;
      const hasServerSecrets = current.imap_password_secret_id !== null
        || current.smtp_password_secret_id !== null
        || current.oauth_refresh_secret_id !== null;
      if (hasServerSecrets && !options.secrets) {
        return { ok: false, code: 'secret_port_unavailable' };
      }

      await withWorkspaceTransaction(
        options.db,
        {
          workspaceId: input.workspaceId,
          userId: input.actorUserId,
          role: 'user',
        },
        async (trx) => {
          await trx
            .deleteFrom('email_accounts')
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', Number(current.id))
            .executeTakeFirst();
        },
        { applySession: options.applyWorkspaceSession },
      );

      if (options.secrets) {
        await Promise.all([
          options.secrets.deleteSecret(emailAccountSecretIdentifier(input.workspaceId, Number(current.id), 'imap')),
          options.secrets.deleteSecret(emailAccountSecretIdentifier(input.workspaceId, Number(current.id), 'smtp')),
          options.secrets.deleteSecret(emailAccountSecretIdentifier(input.workspaceId, Number(current.id), 'oauth_refresh')),
        ].map((promise) => promise.catch(() => false)));
      }

      return { ok: true, account: mapEmailAccountRow(current) };
    },
  };
}

export function createPostgresEmailMessageReadPort(options: PostgresMailReadPortOptions): EmailMessageApiPort {
  return {
    async list(input): Promise<EmailMessageListResult> {
      const limit = normalizeLimit(input.limit);
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          const search = input.search?.trim();
          const searchMode = search ? messageSearchMode(search) : undefined;
          let query = trx
            .selectFrom('email_messages')
            .select(emailMessageSummaryColumns)
            .where('workspace_id', '=', input.workspaceId)
            .limit(limit + 1);

          if (input.offset !== undefined) query = query.offset(input.offset);
          if (input.accountId !== undefined) query = query.where('account_id', '=', input.accountId);
          if (input.folderPath !== undefined) {
            query = query.where('folder_id', 'in', (eb) => eb
              .selectFrom('email_folders')
              .select('id')
              .where('workspace_id', '=', input.workspaceId)
              .where('path', '=', input.folderPath!)
              .$if(input.accountId !== undefined, (folderQuery) => folderQuery.where('account_id', '=', input.accountId!)));
          }
          if (input.folderKind !== undefined) query = query.where('folder_kind', '=', input.folderKind);
          query = applyMessageViewFilter(query, input.view);
          query = applyMessageCategoryFilter(query, input.workspaceId, input.categoryId, input.view);
          query = applyMessageListFilter(query, input.listFilter);
          query = applyMessageDoneFilter(query, input.doneFilter, input.view);
          if (input.seen !== undefined) query = query.where('seen_local', '=', input.seen);
          if (input.done !== undefined) query = query.where('done_local', '=', input.done);
          if (input.spam !== undefined) query = query.where('is_spam', '=', input.spam);
          if (search) {
            query = applyMessageSearchFilter(query, search, searchMode ?? 'like');
          }
          const priorityCursor =
            input.cursor !== undefined && input.sort === 'priority'
              ? await fetchPriorityCursorAnchor(trx, input.workspaceId, input.cursor)
              : undefined;
          query = applyMessageCursor(
            query,
            input.workspaceId,
            input.cursor,
            input.sort,
            input.view,
            priorityCursor,
          );
          query = applyMessageListOrder(query, input.sort, input.view);

          const rows = await query.execute();
          const pageRows = rows.slice(0, limit);
          return {
            items: pageRows.map((row) => mapEmailMessageRow(row, false)),
            nextCursor: rows.length > limit ? pageRows[pageRows.length - 1]?.id ?? null : null,
            ...(searchMode === undefined ? {} : { searchMode }),
          };
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async get(input): Promise<EmailMessageRecord | null> {
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          const row = await trx
            .selectFrom('email_messages')
            .select(input.includeBody ? emailMessageDetailColumns : emailMessageSummaryColumns)
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.id)
            .executeTakeFirst();
          return row ? mapEmailMessageRow(row, input.includeBody) : null;
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async createComposeDraft(input) {
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => createPostgresComposeDraftInTransaction(trx, input),
        { applySession: options.applyWorkspaceSession },
      );
    },
    async updateComposeDraft(input) {
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          const current = await selectLocalDraftForMutation(trx, input.workspaceId, input.messageId);
          if (!current) return { ok: false as const, reason: 'not_found' as const };
          if (!isLocalDraftUid(current)) return { ok: false as const, reason: 'not_local_draft' as const };
          const bodyText = input.values.bodyText ?? current.body_text ?? '';
          const snippet = bodyText.trim()
            ? (bodyText.length > 220 ? `${bodyText.slice(0, 217)}...` : bodyText)
            : current.snippet;
          const row = await trx
            .updateTable('email_messages')
            .set({
              subject: input.values.subject ?? current.subject,
              body_text: bodyText,
              snippet,
              ...(input.values.bodyHtml === undefined ? {} : { body_html: input.values.bodyHtml }),
              ...(input.values.toJson === undefined ? {} : { to_json: input.values.toJson }),
              ...(input.values.fromJson === undefined ? {} : { from_json: input.values.fromJson }),
              ...(input.values.ccJson === undefined ? {} : { cc_json: input.values.ccJson }),
              ...(input.values.bccJson === undefined ? {} : { bcc_json: input.values.bccJson }),
              ...(input.values.draftAttachmentPaths === undefined ? {} : {
                draft_attachment_paths_json: draftAttachmentPathsToJsonValue(input.values.draftAttachmentPaths),
              }),
              ...(input.values.replyParentMessageId === undefined ? {} : {
                reply_parent_message_id: input.values.replyParentMessageId,
              }),
              updated_at: new Date(),
            })
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.messageId)
            .returning(emailMessageDetailColumns)
            .executeTakeFirstOrThrow();
          return { ok: true as const, message: mapEmailMessageRow(row, true) };
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async scheduleDraftSend(input) {
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          const current = await selectLocalDraftForMutation(trx, input.workspaceId, input.messageId);
          if (!current) return { ok: false as const, reason: 'not_found' as const };
          if (!isSchedulableLocalDraft(current)) return { ok: false as const, reason: 'not_local_draft' as const };
          const row = await trx
            .updateTable('email_messages')
            .set({
              scheduled_send_at: input.sendAt,
              outbound_hold: false,
              outbound_block_reason: null,
              updated_at: new Date(),
            })
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.messageId)
            .returning(emailMessageDetailColumns)
            .executeTakeFirstOrThrow();
          if (input.sendAt) await clearScheduledSendDraftMeta(trx, input.workspaceId, input.messageId);
          return { ok: true as const, message: mapEmailMessageRow(row, true) };
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async getScheduledSendDraftState(input) {
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => getScheduledSendDraftStateFromSyncInfo(trx, input.workspaceId, input.messageId),
        { applySession: options.applyWorkspaceSession },
      );
    },
    async getComposeDraftRecoveryState(input) {
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => getComposeDraftRecoveryStateFromSyncInfo(trx, input.workspaceId, input.messageId),
        { applySession: options.applyWorkspaceSession },
      );
    },
    async clearScheduledSendDraftFailure(input) {
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          await clearScheduledSendDraftMeta(trx, input.workspaceId, input.messageId);
          return { success: true as const };
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async retryScheduledSendDraft(input) {
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          const current = await selectLocalDraftForMutation(trx, input.workspaceId, input.messageId);
          if (!current) return { ok: false as const, reason: 'not_found' as const };
          if (!isSchedulableLocalDraft(current)) return { ok: false as const, reason: 'not_local_draft' as const };
          await clearScheduledSendDraftMeta(trx, input.workspaceId, input.messageId);
          const row = await trx
            .updateTable('email_messages')
            .set({
              scheduled_send_at: new Date(),
              updated_at: new Date(),
            })
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.messageId)
            .returning(emailMessageDetailColumns)
            .executeTakeFirstOrThrow();
          return { ok: true as const, message: mapEmailMessageRow(row, true) };
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async getSecurity(input): Promise<EmailMessageSecurityRecord | null> {
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          const row = await trx
            .selectFrom('email_messages')
            .select(emailMessageSecurityColumns)
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.id)
            .executeTakeFirst();
          return row ? mapEmailMessageSecurityRow(row) : null;
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async runSecurityCheck(input): Promise<EmailMessageSecurityCheckResult | null> {
      const values = normalizeEmailMessageSpamDecisionMutation(input.values);
      return withWorkspaceTransaction(
        options.db,
        {
          workspaceId: input.workspaceId,
          userId: input.actorUserId,
          role: input.actorUserId ? 'user' : 'system',
        },
        async (trx) => runPostgresMailSecurityCheck(
          trx,
          input.workspaceId,
          input.messageId,
          values,
          new Date(),
        ),
        { applySession: options.applyWorkspaceSession },
      );
    },
    async getRawHeaders(input): Promise<EmailMessageRawHeadersRecord | null> {
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          const row = await trx
            .selectFrom('email_messages')
            .select(emailMessageRawHeadersColumns)
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.id)
            .executeTakeFirst();
          return row ? mapEmailMessageRawHeadersRow(row) : null;
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async getReadReceiptState(input): Promise<EmailReadReceiptStateResult | null> {
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          const row = await trx
            .selectFrom('email_messages')
            .leftJoin('email_accounts', (join) => join
              .onRef('email_accounts.id', '=', 'email_messages.account_id')
              .on('email_accounts.workspace_id', '=', input.workspaceId))
            .select([
              'email_messages.read_receipt_requested as read_receipt_requested',
              'email_accounts.respond_to_read_receipts as respond_to_read_receipts',
              'email_accounts.read_receipt_trusted_domains as read_receipt_trusted_domains',
            ])
            .where('email_messages.workspace_id', '=', input.workspaceId)
            .where('email_messages.id', '=', input.messageId)
            .executeTakeFirst();
          return row ? mapEmailReadReceiptStateRow(row) : null;
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async getFolderCounts(input): Promise<EmailMailFolderCounts> {
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => selectMailFolderCounts(trx, input),
        { applySession: options.applyWorkspaceSession },
      );
    },
    async consumeRemoteContentPolicy(input): Promise<EmailRemoteContentPolicyResult | null> {
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          const row = await selectRemoteContentPolicyRow(trx, input.workspaceId, input.messageId);
          if (!row) return null;
          const result = await resolveRemoteContentPolicy(trx, input.workspaceId, row);
          if (result.policy === 'allowed_once' && result.allowRemote) {
            await trx
              .updateTable('email_messages')
              .set({ remote_content_policy: 'blocked', updated_at: new Date() })
              .where('workspace_id', '=', input.workspaceId)
              .where('id', '=', input.messageId)
              .executeTakeFirst();
          }
          return result;
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async setRemoteContentPolicy(input): Promise<EmailRemoteContentPolicyMutationResult> {
      return withWorkspaceTransaction(
        options.db,
        {
          workspaceId: input.workspaceId,
          userId: input.actorUserId,
          role: 'user',
        },
        async (trx) => {
          const current = await selectRemoteContentPolicyRow(trx, input.workspaceId, input.messageId);
          if (!current) return { ok: false, reason: 'not_found' };

          const sender = extractFirstEmailAddress(current.from_json);
          const domain = sender ? domainOf(sender) : '';
          const remember = input.values.rememberSender && sender
            ? { scope: 'sender' as const, value: sender }
            : input.values.rememberDomain && domain
              ? { scope: 'domain' as const, value: domain }
              : null;
          const now = new Date();
          if (remember) {
            await trx
              .insertInto('email_remote_content_allowlist')
              .values({
                workspace_id: input.workspaceId,
                source_sqlite_id: serverCreatedEmailRemoteContentAllowlistSourceSqliteId(),
                scope: remember.scope,
                value: remember.value,
                source_row: serverApiSourceRow(),
                imported_in_run_id: null,
                created_at: now,
                updated_at: now,
              })
              .onConflict((oc) => oc.columns(['workspace_id', 'scope', 'value']).doNothing())
              .executeTakeFirst();
          }

          const row = await trx
            .updateTable('email_messages')
            .set({
              remote_content_policy: input.values.policy,
              updated_at: now,
            })
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.messageId)
            .returning(emailMessageSummaryColumns)
            .executeTakeFirstOrThrow();
          const message = mapEmailMessageRow(row, false);
          const result = await resolveRemoteContentPolicy(trx, input.workspaceId, {
            ...current,
            remote_content_policy: input.values.policy,
          });
          return { ok: true, result, message };
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async listConversation(input): Promise<EmailMessageListResult> {
      const limit = normalizeLimit(input.limit);
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          const rows = await selectConversationMessages(trx, input, limit);
          return { items: rows.map((row) => mapEmailMessageRow(row, false)), nextCursor: null };
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async listThread(input): Promise<EmailMessageListResult> {
      const limit = normalizeLimit(input.limit);
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          const threadId = input.threadId.trim();
          if (!threadId) return { items: [], nextCursor: null };
          const canonicalThreadId = await resolveCanonicalThreadId(trx, input.workspaceId, threadId);
          const { sql: kyselySql } = require('kysely') as typeof import('kysely');
          const rows = await trx
            .selectFrom('email_messages')
            .select(emailMessageSummaryColumns)
            .where('workspace_id', '=', input.workspaceId)
            .where(kyselySql<boolean>`(
              thread_id = ${canonicalThreadId}
              OR thread_id IN (
                SELECT alias_thread_id
                FROM email_thread_aliases
                WHERE workspace_id = ${input.workspaceId}::uuid
                  AND canonical_thread_id = ${canonicalThreadId}
              )
            )`)
            .orderBy(kyselySql`coalesce(date_received, created_at)`, 'asc')
            .orderBy('id', 'asc')
            .limit(limit)
            .offset(input.offset ?? 0)
            .execute();
          return { items: rows.map((row) => mapEmailMessageRow(row, false)), nextCursor: null };
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async bulkSoftDelete(input) {
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => softDeleteMessageRows(trx, input, {
          syncableOnly: true,
        }),
        { applySession: options.applyWorkspaceSession },
      );
    },
    async bulkSetArchived(input) {
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => updateMessageRows(trx, input, {
          archived: input.archived,
          done_local: input.archived,
          ...(input.archived ? { is_spam: false, spam_status: 'clean' } : {}),
          updated_at: new Date(),
        }, {
          syncableOnly: true,
          requireNotSoftDeleted: true,
        }),
        { applySession: options.applyWorkspaceSession },
      );
    },
    async bulkSetDone(input) {
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => updateMessageRows(trx, input, {
          done_local: input.done,
          updated_at: new Date(),
        }, {
          syncableOnly: true,
          requireNotSoftDeleted: true,
        }),
        { applySession: options.applyWorkspaceSession },
      );
    },
    async bulkSetSpamStatus(input) {
      const values = normalizeEmailMessageSpamStatusMutation(input.values);
      const result = await withWorkspaceTransaction(
        options.db,
        {
          workspaceId: input.workspaceId,
          userId: input.actorUserId,
          role: input.actorUserId ? 'user' : 'system',
        },
        async (trx) => bulkSetSpamStatusRows(trx, {
          workspaceId: input.workspaceId,
          messageIds: input.messageIds,
          values,
          ...(input.accountId === undefined ? {} : { accountId: input.accountId }),
        }),
        { applySession: options.applyWorkspaceSession },
      );
      await runRspamdLearningBestEffort(result.rspamdLearningRequests, options);
      return { count: result.count };
    },
    async bulkDeleteLocalDrafts(input) {
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => deleteLocalDraftRows(trx, {
          workspaceId: input.workspaceId,
          messageIds: input.messageIds,
        }),
        { applySession: options.applyWorkspaceSession },
      );
    },
    async deleteLocalDraft(input) {
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          if (!Number.isSafeInteger(input.messageId) || input.messageId <= 0) {
            throw new Error('email message id muss eine positive Ganzzahl sein');
          }
          const row = await trx
            .selectFrom('email_messages')
            .select(['id', 'uid'])
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.messageId)
            .executeTakeFirst();
          if (!row) return { ok: false as const, reason: 'not_found' as const };
          if (Number(row.uid) >= 0) return { ok: false as const, reason: 'not_local_draft' as const };
          const result = await deleteLocalDraftRows(trx, {
            workspaceId: input.workspaceId,
            messageIds: [input.messageId],
          });
          return { ok: true as const, count: result.count };
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async snooze(input) {
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          const rows = await trx
            .updateTable('email_messages')
            .set({
              snoozed_until: input.until,
              updated_at: new Date(),
            })
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.messageId)
            .returning('id')
            .execute();
          return { count: rows.length };
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async softDelete(input) {
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => softDeleteMessageRows(trx, {
          workspaceId: input.workspaceId,
          messageIds: [input.messageId],
        }),
        { applySession: options.applyWorkspaceSession },
      );
    },
    async restore(input) {
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => restoreMessageFromTrash(trx, input),
        { applySession: options.applyWorkspaceSession },
      );
    },
    async linkCustomer(input) {
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => linkMessageCustomer(trx, input),
        { applySession: options.applyWorkspaceSession },
      );
    },
    async backfillCustomerLinks(input) {
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => backfillMessageCustomerLinks(trx, input),
        { applySession: options.applyWorkspaceSession },
      );
    },
    async assign(input) {
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => assignMessageTeamMember(trx, input),
        { applySession: options.applyWorkspaceSession },
      );
    },
    async setArchived(input) {
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => updateMessageRows(trx, {
          workspaceId: input.workspaceId,
          messageIds: [input.messageId],
        }, {
          archived: input.archived,
          done_local: input.archived,
          ...(input.archived ? { is_spam: false, spam_status: 'clean' } : {}),
          updated_at: new Date(),
        }),
        { applySession: options.applyWorkspaceSession },
      );
    },
    async setSeen(input) {
      let syncToServer = false;
      const result = await withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          const result = await updateMessageRows(trx, {
            workspaceId: input.workspaceId,
            messageIds: [input.messageId],
          }, {
            seen_local: input.seen,
            updated_at: new Date(),
          });
          if (result.count > 0 && options.seenFlagSync) {
            syncToServer = await shouldSyncSeenFlagToServer(trx, input);
          }
          return result;
        },
        { applySession: options.applyWorkspaceSession },
      );
      if (syncToServer && options.seenFlagSync) {
        await options.seenFlagSync.setSeen({
          workspaceId: input.workspaceId,
          messageId: input.messageId,
          seen: input.seen,
        }).catch(() => undefined);
      }
      return result;
    },
    async setDone(input) {
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => updateMessageRows(trx, {
          workspaceId: input.workspaceId,
          messageIds: [input.messageId],
        }, {
          done_local: input.done,
          updated_at: new Date(),
        }),
        { applySession: options.applyWorkspaceSession },
      );
    },
    async moveToView(input) {
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          if (input.view === 'trash') {
            return softDeleteMessageRows(trx, {
              workspaceId: input.workspaceId,
              messageIds: [input.messageId],
            });
          }
          if (input.view === 'archived') {
            return updateMessageRows(trx, {
              workspaceId: input.workspaceId,
              messageIds: [input.messageId],
            }, {
              soft_deleted: false,
              archived: true,
              is_spam: false,
              spam_status: 'clean',
              done_local: true,
              trash_prev_archived: null,
              trash_prev_is_spam: null,
              trash_prev_folder_kind: null,
              updated_at: new Date(),
            });
          }
          if (input.view === 'spam' || input.view === 'spam_review') {
            return updateMessageRows(trx, {
              workspaceId: input.workspaceId,
              messageIds: [input.messageId],
            }, {
              ...spamStatusPatch(input.view === 'spam' ? 'spam' : 'review', 'inbox'),
              trash_prev_archived: null,
              trash_prev_is_spam: null,
              trash_prev_folder_kind: null,
              updated_at: new Date(),
            });
          }
          return updateMessageRows(trx, {
            workspaceId: input.workspaceId,
            messageIds: [input.messageId],
          }, {
            soft_deleted: false,
            archived: false,
            is_spam: false,
            spam_status: 'clean',
            done_local: false,
            folder_kind: 'inbox',
            trash_prev_archived: null,
            trash_prev_is_spam: null,
            trash_prev_folder_kind: null,
            updated_at: new Date(),
          });
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async previewInboxArchiveRecovery(input) {
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => previewInboxArchiveRecoveryRows(trx, input),
        { applySession: options.applyWorkspaceSession },
      );
    },
    async restoreInboxFromArchive(input) {
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => restoreInboxMessagesFromArchiveRows(trx, input),
        { applySession: options.applyWorkspaceSession },
      );
    },
    async setSpamStatus(input): Promise<EmailMessageRecord | null> {
      const values = normalizeEmailMessageSpamStatusMutation(input.values);
      const result = await withWorkspaceTransaction(
        options.db,
        {
          workspaceId: input.workspaceId,
          userId: input.actorUserId,
          role: input.actorUserId ? 'user' : 'system',
        },
        async (trx) => {
          const current = await trx
            .selectFrom('email_messages')
            .select(emailMessageSpamStatusMutationColumns)
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.messageId)
            .executeTakeFirst();
          if (!current) return null;
          const rspamdLearningRequests: RspamdLearningRequest[] = [];

          const now = new Date();
          const updated = await trx
            .updateTable('email_messages')
            .set({
              ...spamStatusPatch(values.status as 'clean' | 'review' | 'spam', current.folder_kind),
              spam_decided_at: now,
              updated_at: now,
            })
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.messageId)
            .returning(emailMessageSummaryColumns)
            .executeTakeFirstOrThrow();

          if (values.train !== false) {
            const label = learningLabelForSpamStatusTransition(
              current.spam_status ?? (current.is_spam ? 'spam' : 'clean'),
              values.status as 'clean' | 'review' | 'spam',
            );
            if (label) {
              const learningSettings = await loadSpamLearningSettings(trx, input.workspaceId);
              if (learningSettings.localLearningEnabled && current.account_id !== null) {
                const featureKeys = values.featureKeys === undefined || values.featureKeys === null
                  ? buildFeaturePreview({
                    fromJson: current.from_json,
                    subject: current.subject,
                    snippet: current.snippet,
                    bodyText: current.body_text,
                    bodyHtml: current.body_html,
                    authSpf: current.auth_spf,
                    authDkim: current.auth_dkim,
                    authDmarc: current.auth_dmarc,
                    authArc: current.auth_arc,
                    attachmentsJson: current.attachments_json,
                    hasAttachments: current.has_attachments,
                  }).featureKeys
                  : normalizeFeatureKeys(values.featureKeys);
                await insertSpamLearningEventForMessage(trx, input.workspaceId, current, {
                  label,
                  source: values.source ?? 'manual',
                  featureKeys,
                  now,
                });
              }
              const rspamdLearning = rspamdLearningRequestForMessage(current, label, learningSettings);
              if (rspamdLearning) rspamdLearningRequests.push(rspamdLearning);
            }
          }

          return {
            message: mapEmailMessageRow(updated, false),
            rspamdLearningRequests,
          };
        },
        { applySession: options.applyWorkspaceSession },
      );
      if (!result) return null;
      await runRspamdLearningBestEffort(result.rspamdLearningRequests, options);
      return result.message;
    },
    async evaluateSpamDecision(input): Promise<EmailMessageSpamDecisionResult | null> {
      const values = normalizeEmailMessageSpamDecisionMutation(input.values);
      return withWorkspaceTransaction(
        options.db,
        {
          workspaceId: input.workspaceId,
          userId: input.actorUserId,
          role: 'user',
        },
        async (trx) => {
          const current = await trx
            .selectFrom('email_messages')
            .select(emailMessageSpamStatusMutationColumns)
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.messageId)
            .executeTakeFirst();
          if (!current) return null;

          return evaluateSpamDecisionForMessage(trx, input.workspaceId, current, values.applyStatus, new Date());
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
  };
}

async function runPostgresMailSecurityCheck(
  trx: WorkspaceTransaction,
  workspaceId: string,
  messageId: number,
  values: { applyStatus: boolean },
  now: Date,
): Promise<EmailMessageSecurityCheckResult | null> {
  const current = await trx
    .selectFrom('email_messages')
    .select(emailMessageSecurityCheckColumns)
    .where('workspace_id', '=', workspaceId)
    .where('id', '=', messageId)
    .executeTakeFirst();
  if (!current) return null;

  const settings = await loadMailSecurityCheckSettings(trx, workspaceId);
  const checks = await runStoredMailSecurityChecks({
    rawRfc822B64: current.raw_rfc822_b64,
    rawHeaders: current.raw_headers,
    bodyText: current.body_text,
    bodyHtml: current.body_html,
    mailauthEnabled: settings.mailauthEnabled,
    rspamdEnabled: settings.rspamdEnabled,
    rspamdUrl: settings.rspamdUrl,
    rspamdTimeoutMs: settings.rspamdTimeoutMs,
  });
  const securityPatch = mailSecurityPatch(checks.auth, checks.rspamd, now);
  const currentForSpam = mailSecuritySpamRow(current, checks.auth, checks.rspamd);

  if (checks.auth || checks.rspamd) {
    await trx
      .updateTable('email_messages')
      .set(securityPatch)
      .where('workspace_id', '=', workspaceId)
      .where('id', '=', messageId)
      .execute();
  }

  const spam = await evaluateSpamDecisionForMessage(
    trx,
    workspaceId,
    currentForSpam,
    values.applyStatus,
    now,
  );
  const automation = values.applyStatus
    ? await applyPostgresPreWorkflowMailSecurity(trx, workspaceId, currentForSpam, settings, now)
    : { skippedWorkflows: false, tags: [] };
  const message = automation.tags.length === 0
    ? spam.message
    : await selectEmailMessageSummary(trx, workspaceId, messageId) ?? spam.message;
  const security = await selectEmailMessageSecurity(trx, workspaceId, messageId);
  if (!security) return null;
  return {
    message,
    decision: spam.decision,
    security,
    authChecked: checks.authChecked,
    rspamdChecked: checks.rspamdChecked,
  };
}

async function loadExistingSpamDecisionForMessage(
  trx: WorkspaceTransaction,
  workspaceId: string,
  messageId: number,
): Promise<EmailMessageSpamDecisionResult> {
  const message = await trx
    .selectFrom('email_messages')
    .select(emailMessageSummaryColumns)
    .where('workspace_id', '=', workspaceId)
    .where('id', '=', messageId)
    .executeTakeFirstOrThrow();
  const decisionRow = await trx
    .selectFrom('email_spam_decisions')
    .select([
      'id',
      'source_sqlite_id',
      'message_source_sqlite_id',
      'account_source_sqlite_id',
      'message_id',
      'account_id',
      'score',
      'status',
      'source',
      'breakdown_json',
      'model_version',
      'created_at',
      'updated_at',
    ])
    .where('workspace_id', '=', workspaceId)
    .where('message_id', '=', messageId)
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .limit(1)
    .executeTakeFirst();
  if (decisionRow) {
    return {
      message: mapEmailMessageRow(message, false),
      decision: {
        id: Number(decisionRow.id),
        sourceSqliteId: decisionRow.source_sqlite_id === null ? null : Number(decisionRow.source_sqlite_id),
        messageSourceSqliteId: decisionRow.message_source_sqlite_id === null
          ? null
          : Number(decisionRow.message_source_sqlite_id),
        accountSourceSqliteId: Number(decisionRow.account_source_sqlite_id),
        messageId: decisionRow.message_id === null ? null : Number(decisionRow.message_id),
        accountId: decisionRow.account_id === null ? null : Number(decisionRow.account_id),
        score: decisionRow.score,
        status: decisionRow.status as 'clean' | 'review' | 'spam',
        source: decisionRow.source,
        breakdown: decisionRow.breakdown_json,
        modelVersion: decisionRow.model_version,
        createdAt: timestampToIsoOrNull(decisionRow.created_at),
        updatedAt: timestampToIso(decisionRow.updated_at),
      },
    };
  }

  const stored = await trx
    .selectFrom('email_messages')
    .select([
      'spam_score',
      'spam_score_label',
      'spam_decision_source',
      'spam_score_breakdown_json',
      'spam_decided_at',
      'account_source_sqlite_id',
      'source_sqlite_id',
      'account_id',
    ])
    .where('workspace_id', '=', workspaceId)
    .where('id', '=', messageId)
    .executeTakeFirstOrThrow();

  return {
    message: mapEmailMessageRow(message, false),
    decision: {
      id: 0,
      sourceSqliteId: null,
      messageSourceSqliteId: Number(stored.source_sqlite_id),
      accountSourceSqliteId: Number(stored.account_source_sqlite_id),
      messageId,
      accountId: stored.account_id === null ? null : Number(stored.account_id),
      score: stored.spam_score ?? 0,
      status: (stored.spam_score_label ?? 'clean') as 'clean' | 'review' | 'spam',
      source: stored.spam_decision_source ?? 'stored',
      breakdown: stored.spam_score_breakdown_json,
      modelVersion: SPAM_ENGINE_MODEL_VERSION,
      createdAt: timestampToIsoOrNull(stored.spam_decided_at),
      updatedAt: timestampToIsoOrNull(stored.spam_decided_at) ?? new Date().toISOString(),
    },
  };
}

async function evaluateSpamDecisionForMessage(
  trx: WorkspaceTransaction,
  workspaceId: string,
  current: EmailMessageSpamStatusMutationRow,
  applyStatus: boolean,
  now: Date,
): Promise<EmailMessageSpamDecisionResult> {
  if (!shouldRunInitialSpamScoring({ spamDecidedAt: current.spam_decided_at })) {
    const existing = await loadExistingSpamDecisionForMessage(trx, workspaceId, Number(current.id));
    if (applyStatus && existing.decision) {
      const nextStatus = existing.decision.status;
      const currentStatus = current.spam_status ?? 'clean';
      const decisionAtMs = Date.parse(
        existing.decision.updatedAt ?? existing.decision.createdAt ?? '',
      );
      const messageDecidedAtMs = current.spam_decided_at
        ? new Date(current.spam_decided_at).getTime()
        : Number.NaN;
      const scoreStoredAwaitingApply =
        Number.isFinite(decisionAtMs) &&
        Number.isFinite(messageDecidedAtMs) &&
        messageDecidedAtMs <= decisionAtMs + 5000;
      const pendingApply =
        (nextStatus === 'review' || nextStatus === 'spam') &&
        currentStatus !== nextStatus &&
        scoreStoredAwaitingApply;
      if (
        pendingApply &&
        shouldAutoApplySpamStatus(
          {
            doneLocal: current.done_local,
            spamStatus: current.spam_status,
            isSpam: current.is_spam,
            spamDecidedAt: null,
          },
          nextStatus,
        )
      ) {
        const updated = await trx
          .updateTable('email_messages')
          .set({
            ...spamStatusPatch(nextStatus, current.folder_kind ?? 'inbox'),
            updated_at: now,
          })
          .where('workspace_id', '=', workspaceId)
          .where('id', '=', Number(current.id))
          .returning(emailMessageSummaryColumns)
          .executeTakeFirstOrThrow();
        return {
          message: mapEmailMessageRow(updated, false),
          decision: existing.decision,
        };
      }
    }
    return existing;
  }

  const preview = buildFeaturePreview(emailMessageSpamDecisionInputFromRow(current));
  const settings = await loadSpamEngineSettings(trx, workspaceId);
  const listMatch = await selectSpamListMatchForMessage(
    trx,
    workspaceId,
    current,
    preview.senderEmail,
    preview.senderDomain,
  );
  const featureStats = await loadSpamFeatureStatsForKeys(trx, workspaceId, preview.featureKeys);
  const decision = buildSpamDecision(emailMessageSpamDecisionInputFromRow(current), {
    settings,
    listMatch,
    featureStats,
  });
  const shouldApplyStatus =
    applyStatus &&
    shouldAutoApplySpamStatus(
      {
        doneLocal: current.done_local,
        spamStatus: current.spam_status,
        isSpam: current.is_spam,
        spamDecidedAt: current.spam_decided_at,
      },
      decision.status,
    );
  const messagePatch: Partial<Updateable<EmailMessagesTable>> = {
    spam_score: decision.score,
    spam_score_label: decision.status,
    spam_decision_source: decision.source,
    spam_score_breakdown_json: decision,
    spam_decided_at: now,
    updated_at: now,
    ...(shouldApplyStatus ? spamStatusPatch(decision.status, current.folder_kind) : {}),
  };

  const updated = await trx
    .updateTable('email_messages')
    .set(messagePatch)
    .where('workspace_id', '=', workspaceId)
    .where('id', '=', Number(current.id))
    .returning(emailMessageSummaryColumns)
    .executeTakeFirstOrThrow();
  const decisionRow = await insertSpamDecisionForMessage(trx, workspaceId, current, decision, now);
  await pruneSpamDecisionsForMessage(trx, workspaceId, Number(current.id));

  return {
    message: mapEmailMessageRow(updated, false),
    decision: decisionRow,
  };
}

async function selectEmailMessageSecurity(
  trx: WorkspaceTransaction,
  workspaceId: string,
  messageId: number,
): Promise<EmailMessageSecurityRecord | null> {
  const row = await trx
    .selectFrom('email_messages')
    .select(emailMessageSecurityColumns)
    .where('workspace_id', '=', workspaceId)
    .where('id', '=', messageId)
    .executeTakeFirst();
  return row ? mapEmailMessageSecurityRow(row) : null;
}

async function selectEmailMessageSummary(
  trx: WorkspaceTransaction,
  workspaceId: string,
  messageId: number,
): Promise<EmailMessageRecord | null> {
  const row = await trx
    .selectFrom('email_messages')
    .select(emailMessageSummaryColumns)
    .where('workspace_id', '=', workspaceId)
    .where('id', '=', messageId)
    .executeTakeFirst();
  return row ? mapEmailMessageRow(row, false) : null;
}

async function applyPostgresPreWorkflowMailSecurity(
  trx: WorkspaceTransaction,
  workspaceId: string,
  current: EmailMessageSpamStatusMutationRow,
  settings: MailSecurityCheckSettings,
  now: Date,
): Promise<ServerMailSecurityAutomationResult> {
  const preview = buildFeaturePreview(emailMessageSpamDecisionInputFromRow(current));
  const senderClass = await classifyPostgresMailSecuritySender(trx, workspaceId, preview.senderEmail, settings);
  const decision = evaluatePreWorkflowMailSecurity({
    senderClass,
    message: current,
    settings,
  });
  if (decision.spamStatus !== 'spam') {
    return { skippedWorkflows: decision.skippedWorkflows, tags: decision.tags };
  }

  await trx
    .updateTable('email_messages')
    .set({
      is_spam: true,
      spam_status: 'spam',
      soft_deleted: false,
      archived: false,
      done_local: true,
      spam_decided_at: now,
      updated_at: now,
    })
    .where('workspace_id', '=', workspaceId)
    .where('id', '=', Number(current.id))
    .execute();

  await addPostgresMailSecurityTags(trx, workspaceId, current, decision.tags, now);
  return { skippedWorkflows: decision.skippedWorkflows, tags: decision.tags };
}

async function classifyPostgresMailSecuritySender(
  trx: WorkspaceTransaction,
  workspaceId: string,
  senderEmail: string,
  settings: MailSecurityCheckSettings,
): Promise<SenderFilterResult> {
  const from = senderEmail.trim();
  if (!from) return 'default';
  const lists = await loadPostgresGlobalMailSecuritySenderLists(trx, workspaceId, settings);
  return evaluateSenderFilterFromLists(from, {
    whitelist: lists.whitelist,
    blacklist: lists.blacklist,
    useBuiltinTrusted: false,
  });
}

async function loadPostgresGlobalMailSecuritySenderLists(
  trx: WorkspaceTransaction,
  workspaceId: string,
  settings: MailSecurityCheckSettings,
): Promise<{ whitelist: string[]; blacklist: string[] }> {
  const rows = await trx
    .selectFrom('email_spam_list_entries')
    .select(['list_type', 'pattern'])
    .where('workspace_id', '=', workspaceId)
    .where('account_id', 'is', null)
    .execute();
  const whitelist = parseSenderList(settings.senderWhitelist);
  const blacklist = parseSenderList(settings.senderBlacklist);
  for (const row of rows) {
    const pattern = String(row.pattern ?? '').trim();
    if (!pattern) continue;
    if (row.list_type === 'allow') whitelist.push(pattern);
    if (row.list_type === 'block') blacklist.push(pattern);
  }
  return { whitelist, blacklist };
}

async function addPostgresMailSecurityTags(
  trx: WorkspaceTransaction,
  workspaceId: string,
  message: EmailMessageSpamStatusMutationRow,
  tags: readonly string[],
  now: Date,
): Promise<void> {
  const normalized = tags
    .map((tag) => tag.trim())
    .filter((tag, index, list) => tag && list.indexOf(tag) === index);
  if (normalized.length === 0) return;
  for (const tag of normalized) {
    const existing = await trx
      .selectFrom('email_message_tags')
      .select('id')
      .where('workspace_id', '=', workspaceId)
      .where('message_source_sqlite_id', '=', Number(message.source_sqlite_id))
      .where('tag', '=', tag)
      .executeTakeFirst();
    if (existing) continue;
    await trx
      .insertInto('email_message_tags')
      .values({
        workspace_id: workspaceId,
        source_sqlite_id: serverCreatedEmailMessageTagSourceSqliteId(),
        message_source_sqlite_id: Number(message.source_sqlite_id),
        message_id: Number(message.id),
        tag,
        source_row: serverApiSourceRow(),
        imported_in_run_id: null,
        created_at: now,
        updated_at: now,
      })
      .execute();
  }
}

async function selectConversationMessages(
  trx: any,
  input: Parameters<NonNullable<EmailMessageApiPort['listConversation']>>[0],
  limit: number,
): Promise<EmailMessageApiRow[]> {
  const { sql: kyselySql } = require('kysely') as typeof import('kysely');
  const correspondentEmail = normalizeCorrespondentEmail(input.correspondentEmail);
  let query = trx
    .selectFrom('email_messages')
    .select(emailMessageSummaryColumns)
    .where('workspace_id', '=', input.workspaceId)
    .where('soft_deleted', '=', false)
    .limit(limit);

  if (input.accountId !== undefined) query = query.where('account_id', '=', input.accountId);

  if (correspondentEmail) {
    const pattern = `%${escapeLikePattern(correspondentEmail)}%`;
    return query
      .where(kyselySql<boolean>`(
        lower(coalesce(from_json::text, '')) LIKE ${pattern} ESCAPE '\\'
        OR lower(coalesce(to_json::text, '')) LIKE ${pattern} ESCAPE '\\'
        OR lower(coalesce(cc_json::text, '')) LIKE ${pattern} ESCAPE '\\'
        OR lower(coalesce(bcc_json::text, '')) LIKE ${pattern} ESCAPE '\\'
      )`)
      .orderBy(kyselySql`coalesce(date_received, created_at)`, 'desc')
      .orderBy('id', 'desc')
      .execute();
  }

  const ticketCode = input.ticketCode?.trim();
  const customerId = input.customerId;
  if (input.excludeMessageId !== undefined) query = query.where('id', '!=', input.excludeMessageId);
  if (ticketCode && customerId !== undefined) {
    query = query.where(kyselySql<boolean>`(ticket_code = ${ticketCode} OR customer_id = ${customerId})`);
  } else if (ticketCode) {
    query = query.where('ticket_code', '=', ticketCode);
  } else if (customerId !== undefined) {
    query = query.where('customer_id', '=', customerId);
  } else {
    return [];
  }

  return query
    .orderBy(kyselySql`coalesce(date_received, created_at)`, 'desc')
    .orderBy('id', 'desc')
    .execute();
}

function normalizeCorrespondentEmail(value: string | undefined): string | null {
  const normalized = value?.trim().toLowerCase();
  return normalized && normalized.includes('@') ? normalized : null;
}

async function resolveCanonicalThreadId(trx: any, workspaceId: string, threadId: string): Promise<string> {
  let current = threadId;
  const seen = new Set<string>();
  for (let depth = 0; depth < 20; depth += 1) {
    if (seen.has(current)) return threadId;
    seen.add(current);
    const row = await trx
      .selectFrom('email_thread_aliases')
      .select('canonical_thread_id')
      .where('workspace_id', '=', workspaceId)
      .where('alias_thread_id', '=', current)
      .executeTakeFirst();
    if (!row?.canonical_thread_id) return current;
    current = row.canonical_thread_id;
  }
  return current;
}

async function updateMessageRows(
  trx: any,
  input: {
    workspaceId: string;
    accountId?: number;
    messageIds: readonly number[];
  },
  values: Partial<Updateable<EmailMessagesTable>>,
  options: {
    syncableOnly?: boolean;
    requireNotSoftDeleted?: boolean;
  } = {},
): Promise<{ count: number }> {
  const ids = normalizeMessageIdList(input.messageIds);
  if (ids.length === 0) return { count: 0 };
  const { sql: kyselySql } = require('kysely') as typeof import('kysely');
  let query = trx
    .updateTable('email_messages')
    .set(values)
    .where('workspace_id', '=', input.workspaceId)
    .where('id', 'in', ids);
  if (input.accountId !== undefined) query = query.where('account_id', '=', input.accountId);
  if (options.syncableOnly) query = query.where(kyselySql<boolean>`(uid >= 0 OR pop3_uidl IS NOT NULL)`);
  if (options.requireNotSoftDeleted) query = query.where('soft_deleted', '=', false);
  const rows = await query.returning('id').execute();
  return { count: rows.length };
}

async function shouldSyncSeenFlagToServer(
  trx: any,
  input: {
    workspaceId: string;
    messageId: number;
    syncToServer?: boolean;
  },
): Promise<boolean> {
  if (input.syncToServer !== undefined) return input.syncToServer;
  const row = await trx
    .selectFrom('email_messages')
    .innerJoin('email_accounts', (join: any) => join
      .onRef('email_accounts.id', '=', 'email_messages.account_id')
      .onRef('email_accounts.workspace_id', '=', 'email_messages.workspace_id'))
    .select([
      'email_accounts.protocol as protocol',
      'email_accounts.imap_sync_seen_on_open as imap_sync_seen_on_open',
    ])
    .where('email_messages.workspace_id', '=', input.workspaceId)
    .where('email_messages.id', '=', input.messageId)
    .executeTakeFirst();
  if (!row) return false;
  return String(row.protocol || 'imap').toLowerCase() === 'imap' && row.imap_sync_seen_on_open !== false;
}

async function deleteLocalDraftRows(
  trx: any,
  input: {
    workspaceId: string;
    messageIds: readonly number[];
  },
): Promise<{ count: number }> {
  const ids = normalizeMessageIdList(input.messageIds);
  if (ids.length === 0) return { count: 0 };
  const rows = await trx
    .deleteFrom('email_messages')
    .where('workspace_id', '=', input.workspaceId)
    .where('id', 'in', ids)
    .where('uid', '<', 0)
    .returning('id')
    .execute();
  return { count: rows.length };
}

async function bulkSetSpamStatusRows(
  trx: any,
  input: {
    workspaceId: string;
    accountId?: number;
    messageIds: readonly number[];
    values: EmailMessageSpamStatusMutationInput;
  },
): Promise<{ count: number; rspamdLearningRequests: RspamdLearningRequest[] }> {
  const ids = normalizeMessageIdList(input.messageIds);
  if (ids.length === 0) return { count: 0, rspamdLearningRequests: [] };
  const status = input.values.status as 'clean' | 'review' | 'spam';
  let query = trx
    .selectFrom('email_messages')
    .select(emailMessageSpamStatusMutationColumns)
    .where('workspace_id', '=', input.workspaceId)
    .where('id', 'in', ids)
    .where((eb: any) => eb.or([
      eb('uid', '>=', 0),
      eb('pop3_uidl', 'is not', null),
    ]));
  if (input.accountId !== undefined) query = query.where('account_id', '=', input.accountId);
  const rows = await query.execute();
  if (rows.length === 0) return { count: 0, rspamdLearningRequests: [] };

  const now = new Date();
  let count = 0;
  const rspamdLearningRequests: RspamdLearningRequest[] = [];
  const learningSettings = input.values.train === false
    ? null
    : await loadSpamLearningSettings(trx, input.workspaceId);
  for (const current of rows) {
    const updated = await trx
      .updateTable('email_messages')
      .set({
        ...spamStatusPatch(status, current.folder_kind),
        spam_decided_at: now,
        updated_at: now,
      })
      .where('workspace_id', '=', input.workspaceId)
      .where('id', '=', Number(current.id))
      .returning('id')
      .executeTakeFirst();
    if (!updated) continue;
    count += 1;

    if (input.values.train !== false) {
      const label = learningLabelForSpamStatusTransition(
        current.spam_status ?? (current.is_spam ? 'spam' : 'clean'),
        status,
      );
      if (label && learningSettings) {
        if (learningSettings.localLearningEnabled && current.account_id !== null) {
          const featureKeys = input.values.featureKeys === undefined || input.values.featureKeys === null
            ? buildFeaturePreview({
              fromJson: current.from_json,
              subject: current.subject,
              snippet: current.snippet,
              bodyText: current.body_text,
              bodyHtml: current.body_html,
              authSpf: current.auth_spf,
              authDkim: current.auth_dkim,
              authDmarc: current.auth_dmarc,
              authArc: current.auth_arc,
              attachmentsJson: current.attachments_json,
              hasAttachments: current.has_attachments,
            }).featureKeys
            : normalizeFeatureKeys(input.values.featureKeys);
          await insertSpamLearningEventForMessage(trx, input.workspaceId, current, {
            label,
            source: input.values.source ?? 'bulk-manual',
            featureKeys,
            now,
          });
        }
        const rspamdLearning = rspamdLearningRequestForMessage(current, label, learningSettings);
        if (rspamdLearning) rspamdLearningRequests.push(rspamdLearning);
      }
    }
  }
  return { count, rspamdLearningRequests };
}

async function linkMessageCustomer(
  trx: any,
  input: {
    workspaceId: string;
    messageId: number;
    customerId: number | null;
  },
): Promise<NonNullable<EmailMessageApiPort['linkCustomer']> extends (arg: any) => Promise<infer R> ? R : never> {
  if (!Number.isSafeInteger(input.messageId) || input.messageId <= 0) {
    throw new Error('email message id muss eine positive Ganzzahl sein');
  }
  let customerSourceSqliteId: number | null = null;
  if (input.customerId !== null) {
    if (!Number.isSafeInteger(input.customerId) || input.customerId <= 0) {
      throw new Error('customer id muss eine positive Ganzzahl sein');
    }
    const customer = await trx
      .selectFrom('customers')
      .select(['id', 'source_sqlite_id'])
      .where('workspace_id', '=', input.workspaceId)
      .where('id', '=', input.customerId)
      .executeTakeFirst();
    if (!customer) return { ok: false as const, reason: 'customer_not_found' as const };
    customerSourceSqliteId = Number(customer.source_sqlite_id);
  }

  const updated = await trx
    .updateTable('email_messages')
    .set({
      customer_id: input.customerId,
      customer_source_sqlite_id: customerSourceSqliteId,
      updated_at: new Date(),
    })
    .where('workspace_id', '=', input.workspaceId)
    .where('id', '=', input.messageId)
    .returning(emailMessageSummaryColumns)
    .executeTakeFirst();
  return updated
    ? { ok: true as const, message: mapEmailMessageRow(updated, false) }
    : { ok: false as const, reason: 'not_found' as const };
}

async function backfillMessageCustomerLinks(
  trx: any,
  input: {
    workspaceId: string;
    accountId?: number;
    limit?: number;
  },
): Promise<NonNullable<EmailMessageApiPort['backfillCustomerLinks']> extends (arg: any) => Promise<infer R> ? R : never> {
  const limit = normalizeBackfillCustomerLinkLimit(input.limit);
  if (input.accountId !== undefined && (!Number.isSafeInteger(input.accountId) || input.accountId <= 0)) {
    throw new Error('account id muss eine positive Ganzzahl sein');
  }
  const { sql: kyselySql } = require('kysely') as typeof import('kysely');

  let messageQuery = trx
    .selectFrom('email_messages')
    .select(['id', 'from_json'])
    .where('workspace_id', '=', input.workspaceId)
    .where('customer_id', 'is', null)
    .where('soft_deleted', '=', false)
    .where(kyselySql<boolean>`(uid >= 0 OR pop3_uidl IS NOT NULL)`)
    .where(kyselySql<boolean>`(snoozed_until IS NULL OR snoozed_until <= now())`)
    .orderBy('id', 'desc')
    .limit(limit);
  if (input.accountId !== undefined) {
    messageQuery = messageQuery.where('account_id', '=', input.accountId);
  }
  const messages = await messageQuery.execute() as Array<{ id: number; from_json: unknown | null }>;
  if (messages.length === 0) return { count: 0 };

  const customers = await trx
    .selectFrom('customers')
    .select(['id', 'source_sqlite_id', 'email'])
    .where('workspace_id', '=', input.workspaceId)
    .where(kyselySql<boolean>`email IS NOT NULL AND btrim(email) <> ''`)
    .execute() as Array<{ id: number; source_sqlite_id: number; email: string | null }>;

  const customerByEmail = new Map<string, { id: number; sourceSqliteId: number }>();
  for (const customer of customers) {
    const normalized = normalizeEmailAddress(customer.email ?? '');
    if (normalized && !customerByEmail.has(normalized)) {
      customerByEmail.set(normalized, {
        id: Number(customer.id),
        sourceSqliteId: Number(customer.source_sqlite_id),
      });
    }
  }
  if (customerByEmail.size === 0) return { count: 0 };

  const now = new Date();
  let count = 0;
  for (const message of messages) {
    const sender = firstAddressFromRecipientJson(message.from_json);
    if (!sender) continue;
    const customer = customerByEmail.get(normalizeEmailAddress(sender));
    if (!customer) continue;
    const updated = await trx
      .updateTable('email_messages')
      .set({
        customer_id: customer.id,
        customer_source_sqlite_id: customer.sourceSqliteId,
        updated_at: now,
      })
      .where('workspace_id', '=', input.workspaceId)
      .where('id', '=', Number(message.id))
      .where('customer_id', 'is', null)
      .returning('id')
      .executeTakeFirst();
    if (updated) count += 1;
  }
  return { count };
}

function normalizeBackfillCustomerLinkLimit(value: number | undefined): number {
  if (value === undefined) return 500;
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error('limit muss eine positive Ganzzahl sein');
  }
  return Math.min(value, 5000);
}

function firstAddressFromRecipientJson(value: unknown): string | null {
  const parsed = typeof value === 'string' ? parseJsonObject(value) : value;
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  const recipients = (parsed as { value?: unknown }).value;
  if (!Array.isArray(recipients)) return null;
  const first = recipients[0];
  if (typeof first !== 'object' || first === null || Array.isArray(first)) return null;
  const address = (first as { address?: unknown }).address;
  if (typeof address !== 'string') return null;
  const trimmed = address.trim();
  return trimmed || null;
}

function parseJsonObject(raw: string): unknown | null {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

async function assignMessageTeamMember(
  trx: any,
  input: {
    workspaceId: string;
    messageId: number;
    teamMemberId: string | null;
  },
): Promise<NonNullable<EmailMessageApiPort['assign']> extends (arg: any) => Promise<infer R> ? R : never> {
  if (!Number.isSafeInteger(input.messageId) || input.messageId <= 0) {
    throw new Error('email message id muss eine positive Ganzzahl sein');
  }
  const teamMemberId = input.teamMemberId === null ? null : input.teamMemberId.trim();
  if (teamMemberId !== null) {
    if (!teamMemberId || teamMemberId.length > 200) {
      throw new Error('team member id muss ein nicht-leerer String mit maximal 200 Zeichen sein');
    }
    const member = await trx
      .selectFrom('email_team_members')
      .select('id')
      .where('workspace_id', '=', input.workspaceId)
      .where('id', '=', teamMemberId)
      .executeTakeFirst();
    if (!member) return { ok: false as const, reason: 'team_member_not_found' as const };
  }

  const updated = await trx
    .updateTable('email_messages')
    .set({
      assigned_to: teamMemberId,
      updated_at: new Date(),
    })
    .where('workspace_id', '=', input.workspaceId)
    .where('id', '=', input.messageId)
    .returning(emailMessageSummaryColumns)
    .executeTakeFirst();
  return updated
    ? { ok: true as const, message: mapEmailMessageRow(updated, false) }
    : { ok: false as const, reason: 'not_found' as const };
}

async function previewInboxArchiveRecoveryRows(
  trx: WorkspaceTransaction,
  input: {
    workspaceId: string;
    accountId: number;
  },
): Promise<EmailInboxArchiveRecoveryPreview | null> {
  const account = await selectInboxArchiveRecoveryAccount(trx, input.workspaceId, input.accountId);
  if (!account) return null;
  const count = await countRestorableInboxArchiveMessages(trx, input.workspaceId, Number(account.id));
  return {
    accountId: account.source_sqlite_id > 0 ? Number(account.source_sqlite_id) : Number(account.id),
    count,
    accountEmail: account.email_address,
    accountLabel: account.display_name,
  };
}

async function restoreInboxMessagesFromArchiveRows(
  trx: WorkspaceTransaction,
  input: {
    workspaceId: string;
    accountId: number;
    expectedCount: number;
    confirmPhrase: string;
  },
): Promise<{ ok: true; restored: number } | { ok: false; error: string }> {
  if (!Number.isSafeInteger(input.expectedCount) || input.expectedCount < 0) {
    return { ok: false, error: 'Erwartete Anzahl ist ungueltig' };
  }
  const account = await selectInboxArchiveRecoveryAccount(trx, input.workspaceId, input.accountId);
  if (!account) return { ok: false, error: 'Konto nicht gefunden' };

  const phrase = input.confirmPhrase.trim().toLowerCase();
  const expectedEmail = account.email_address.trim().toLowerCase();
  if (!phrase || phrase !== expectedEmail) {
    return {
      ok: false,
      error: 'Bestaetigung fehlgeschlagen: E-Mail-Adresse des Kontos exakt eingeben.',
    };
  }

  const accountId = Number(account.id);
  const count = await countRestorableInboxArchiveMessages(trx, input.workspaceId, accountId);
  if (count !== input.expectedCount) {
    return {
      ok: false,
      error: 'Die Anzahl betroffener Nachrichten hat sich geaendert. Bitte Vorschau erneut ausfuehren.',
    };
  }
  if (count === 0) return { ok: true, restored: 0 };
  if (count > 10_000) {
    return {
      ok: false,
      error: `Zu viele Nachrichten (${count}). Bitte zuerst filtern oder Support kontaktieren.`,
    };
  }

  const { sql: kyselySql } = require('kysely') as typeof import('kysely');
  const updated = await trx
    .updateTable('email_messages')
    .set({
      archived: false,
      done_local: false,
      folder_kind: 'inbox',
      is_spam: false,
      spam_status: 'clean',
      updated_at: new Date(),
    })
    .where('workspace_id', '=', input.workspaceId)
    .where('account_id', '=', accountId)
    .where('archived', '=', true)
    .where('soft_deleted', '=', false)
    .where('is_spam', '=', false)
    .where((eb) => eb.or([
      eb('folder_kind', '=', 'inbox'),
      eb('folder_kind', 'is', null),
      eb('folder_kind', '=', ''),
    ]))
    .where(kyselySql<boolean>`(uid >= 0 OR pop3_uidl IS NOT NULL)`)
    .returning('id')
    .execute();
  return { ok: true, restored: updated.length };
}

async function selectInboxArchiveRecoveryAccount(
  trx: WorkspaceTransaction,
  workspaceId: string,
  accountId: number,
): Promise<Pick<EmailAccountRow, 'id' | 'source_sqlite_id' | 'email_address' | 'display_name'> | null> {
  if (!Number.isSafeInteger(accountId) || accountId <= 0) {
    throw new Error('email account id muss eine positive Ganzzahl sein');
  }
  const row = await trx
    .selectFrom('email_accounts')
    .select(['id', 'source_sqlite_id', 'email_address', 'display_name'])
    .where('workspace_id', '=', workspaceId)
    .where((eb) => eb.or([
      eb('id', '=', accountId),
      eb('source_sqlite_id', '=', accountId),
    ]))
    .executeTakeFirst();
  return row ?? null;
}

async function countRestorableInboxArchiveMessages(
  trx: WorkspaceTransaction,
  workspaceId: string,
  accountId: number,
): Promise<number> {
  const { sql: kyselySql } = require('kysely') as typeof import('kysely');
  const row = await trx
    .selectFrom('email_messages')
    .select((eb) => eb.fn.countAll<number>().as('count'))
    .where('workspace_id', '=', workspaceId)
    .where('account_id', '=', accountId)
    .where('archived', '=', true)
    .where('soft_deleted', '=', false)
    .where('is_spam', '=', false)
    .where((eb) => eb.or([
      eb('folder_kind', '=', 'inbox'),
      eb('folder_kind', 'is', null),
      eb('folder_kind', '=', ''),
    ]))
    .where(kyselySql<boolean>`(uid >= 0 OR pop3_uidl IS NOT NULL)`)
    .executeTakeFirst();
  return Number(row?.count ?? 0);
}

async function softDeleteMessageRows(
  trx: any,
  input: {
    workspaceId: string;
    accountId?: number;
    messageIds: readonly number[];
  },
  options: {
    syncableOnly?: boolean;
    requireNotSoftDeleted?: boolean;
  } = {},
): Promise<{ count: number }> {
  const ids = normalizeMessageIdList(input.messageIds);
  if (ids.length === 0) return { count: 0 };
  const { sql: kyselySql } = require('kysely') as typeof import('kysely');
  let query = trx
    .updateTable('email_messages')
    .set((eb: any) => ({
      soft_deleted: true,
      done_local: true,
      trash_prev_archived: eb.ref('archived'),
      trash_prev_is_spam: eb.ref('is_spam'),
      trash_prev_folder_kind: eb.ref('folder_kind'),
      updated_at: new Date(),
    }))
    .where('workspace_id', '=', input.workspaceId)
    .where('id', 'in', ids);
  if (input.accountId !== undefined) query = query.where('account_id', '=', input.accountId);
  if (options.syncableOnly) query = query.where(kyselySql<boolean>`(uid >= 0 OR pop3_uidl IS NOT NULL)`);
  if (options.requireNotSoftDeleted) query = query.where('soft_deleted', '=', false);
  const rows = await query.returning('id').execute();
  return { count: rows.length };
}

async function restoreMessageFromTrash(
  trx: any,
  input: {
    workspaceId: string;
    messageId: number;
  },
): Promise<{ count: number }> {
  if (!Number.isSafeInteger(input.messageId) || input.messageId <= 0) {
    throw new Error('email message id muss eine positive Ganzzahl sein');
  }

  const row = await trx
    .selectFrom('email_messages')
    .select([
      'archived',
      'is_spam',
      'folder_kind',
      'trash_prev_archived',
      'trash_prev_is_spam',
      'trash_prev_folder_kind',
    ])
    .where('workspace_id', '=', input.workspaceId)
    .where('id', '=', input.messageId)
    .executeTakeFirst();
  if (!row) return { count: 0 };

  const archived = row.trash_prev_archived ?? row.archived ?? false;
  const isSpam = row.trash_prev_is_spam ?? row.is_spam ?? false;
  const folderKind = normalizeRestoreFolderKind(row.trash_prev_folder_kind) ?? row.folder_kind ?? 'inbox';
  const backToInbox = archived === false && isSpam === false;
  const rows = await trx
    .updateTable('email_messages')
    .set({
      soft_deleted: false,
      archived,
      is_spam: isSpam,
      folder_kind: folderKind,
      done_local: backToInbox ? false : true,
      trash_prev_archived: null,
      trash_prev_is_spam: null,
      trash_prev_folder_kind: null,
      updated_at: new Date(),
    })
    .where('workspace_id', '=', input.workspaceId)
    .where('id', '=', input.messageId)
    .returning('id')
    .execute();
  return { count: rows.length };
}

async function selectMailFolderCounts(
  trx: WorkspaceTransaction,
  input: {
    workspaceId: string;
    accountId?: number;
  },
): Promise<EmailMailFolderCounts> {
  const { sql: kyselySql } = require('kysely') as typeof import('kysely');
  let query = trx
    .selectFrom('email_messages')
    .select([
      kyselySql<number | string | bigint | null>`coalesce(sum(case when soft_deleted = true then 1 else 0 end), 0)`.as('trash'),
      kyselySql<number | string | bigint | null>`coalesce(sum(case when (
        soft_deleted = false
        and (snoozed_until is null or snoozed_until <= now())
        and (
          ((uid >= 0 or pop3_uidl is not null)
            and (folder_kind = 'inbox' or folder_kind is null or folder_kind = '')
            and archived = false
            and is_spam = false
            and coalesce(spam_status, 'clean') = 'clean')
          or (uid < 0 and folder_kind = 'draft' and outbound_hold = true and scheduled_send_at is null)
        )
        and coalesce(done_local, false) = false
      ) then 1 else 0 end), 0)`.as('inbox'),
      kyselySql<number | string | bigint | null>`coalesce(sum(case when (
        soft_deleted = false
        and (snoozed_until is null or snoozed_until <= now())
        and (
          ((uid >= 0 or pop3_uidl is not null)
            and (folder_kind = 'inbox' or folder_kind is null or folder_kind = '')
            and archived = false
            and is_spam = false
            and coalesce(spam_status, 'clean') = 'clean')
          or (uid < 0 and folder_kind = 'draft' and outbound_hold = true and scheduled_send_at is null)
        )
        and coalesce(done_local, false) = false
        and seen_local = false
      ) then 1 else 0 end), 0)`.as('inbox_unread'),
      kyselySql<number | string | bigint | null>`coalesce(sum(case when (
        soft_deleted = false
        and (snoozed_until is null or snoozed_until <= now())
        and folder_kind = 'sent'
        and is_spam = false
        and coalesce(sent_imap_sync_failed, false) = true
      ) then 1 else 0 end), 0)`.as('sent_failed'),
      kyselySql<number | string | bigint | null>`coalesce(sum(case when (
        soft_deleted = false
        and (snoozed_until is null or snoozed_until <= now())
        and folder_kind = 'draft'
        and scheduled_send_at is null
      ) then 1 else 0 end), 0)`.as('drafts'),
      kyselySql<number | string | bigint | null>`coalesce(sum(case when (
        soft_deleted = false
        and (snoozed_until is null or snoozed_until <= now())
        and folder_kind = 'draft'
        and scheduled_send_at is not null
      ) then 1 else 0 end), 0)`.as('scheduled_send'),
      kyselySql<number | string | bigint | null>`coalesce(sum(case when (
        soft_deleted = false
        and (snoozed_until is null or snoozed_until <= now())
        and archived = true
        and (uid >= 0 or pop3_uidl is not null)
        and is_spam = false
        and coalesce(spam_status, 'clean') = 'clean'
        and coalesce(done_local, false) = false
      ) then 1 else 0 end), 0)`.as('archived'),
      kyselySql<number | string | bigint | null>`coalesce(sum(case when (
        soft_deleted = false
        and (snoozed_until is null or snoozed_until <= now())
        and (uid >= 0 or pop3_uidl is not null)
        and coalesce(spam_status, 'clean') = 'review'
      ) then 1 else 0 end), 0)`.as('spam_review'),
      kyselySql<number | string | bigint | null>`coalesce(sum(case when (
        soft_deleted = false
        and (snoozed_until is null or snoozed_until <= now())
        and (uid >= 0 or pop3_uidl is not null)
        and (is_spam = true or coalesce(spam_status, 'clean') = 'spam')
        and coalesce(done_local, false) = false
      ) then 1 else 0 end), 0)`.as('spam'),
      kyselySql<number | string | bigint | null>`coalesce(sum(case when (
        soft_deleted = false
        and snoozed_until is not null
        and snoozed_until > now()
      ) then 1 else 0 end), 0)`.as('snoozed'),
    ])
    .where('workspace_id', '=', input.workspaceId);

  if (input.accountId !== undefined) query = query.where('account_id', '=', input.accountId);
  const row = await query.executeTakeFirst();
  return mapEmailMailFolderCountsRow(row);
}

function normalizeRestoreFolderKind(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeMessageIdList(messageIds: readonly number[]): number[] {
  const normalized: number[] = [];
  for (const id of messageIds) {
    if (!Number.isSafeInteger(id) || id <= 0) {
      throw new Error('email message id muss eine positive Ganzzahl sein');
    }
    if (!normalized.includes(id)) normalized.push(id);
  }
  if (normalized.length > 500) throw new Error('maximal 500 Nachrichten pro Bulk-Aktion erlaubt');
  return normalized;
}

function applyMessageViewFilter(query: any, view: Parameters<EmailMessageApiPort['list']>[0]['view']): any {
  if (view === undefined) return query;
  const { sql: kyselySql } = require('kysely') as typeof import('kysely');
  const nonDraftMail = kyselySql<boolean>`(uid >= 0 OR pop3_uidl IS NOT NULL)`;
  const activeSnooze = kyselySql<boolean>`(snoozed_until IS NOT NULL AND snoozed_until > now())`;
  const inactiveSnooze = kyselySql<boolean>`(snoozed_until IS NULL OR snoozed_until <= now())`;

  if (view === 'trash') {
    return query.where('soft_deleted', '=', true);
  }
  if (view === 'snoozed') {
    return query
      .where('soft_deleted', '=', false)
      .where(activeSnooze);
  }

  query = query
    .where('soft_deleted', '=', false)
    .where(inactiveSnooze);

  if (view === 'inbox') {
    return query.where(kyselySql<boolean>`(
      ((${nonDraftMail}) AND (folder_kind = 'inbox' OR folder_kind IS NULL OR folder_kind = '') AND archived = false AND is_spam = false AND coalesce(spam_status, 'clean') = 'clean')
      OR (uid < 0 AND folder_kind = 'draft' AND outbound_hold = true AND scheduled_send_at IS NULL)
    )`);
  }
  if (view === 'sent') {
    return query.where('folder_kind', '=', 'sent').where('is_spam', '=', false);
  }
  if (view === 'archived') {
    return query
      .where(nonDraftMail)
      .where('archived', '=', true)
      .where('is_spam', '=', false)
      .where(kyselySql<boolean>`coalesce(spam_status, 'clean') = 'clean'`);
  }
  if (view === 'drafts') {
    return query
      .where('folder_kind', '=', 'draft')
      .where('scheduled_send_at', 'is', null);
  }
  if (view === 'scheduled_send') {
    return query
      .where('folder_kind', '=', 'draft')
      .where('scheduled_send_at', 'is not', null);
  }
  if (view === 'spam_review') {
    return query
      .where(nonDraftMail)
      .where(kyselySql<boolean>`coalesce(spam_status, 'clean') = 'review'`);
  }
  if (view === 'spam') {
    return query.where(nonDraftMail).where(kyselySql<boolean>`(is_spam = true OR coalesce(spam_status, 'clean') = 'spam')`);
  }
  return query.where(nonDraftMail);
}

function applyMessageCategoryFilter(
  query: any,
  workspaceId: string,
  categoryId: Parameters<EmailMessageApiPort['list']>[0]['categoryId'],
  view: Parameters<EmailMessageApiPort['list']>[0]['view'],
): any {
  if (categoryId === undefined || view === 'trash' || view === 'snoozed') return query;
  const { sql: kyselySql } = require('kysely') as typeof import('kysely');
  return query.where(kyselySql<boolean>`exists (
    select 1
    from email_message_categories mc
    where mc.workspace_id = ${workspaceId}::uuid
      and mc.message_id = email_messages.id
      and mc.category_id = ${categoryId}
  )`);
}

function applyMessageListFilter(
  query: any,
  filter: Parameters<EmailMessageApiPort['list']>[0]['listFilter'],
): any {
  if (filter === undefined || filter === 'all') return query;
  const { sql: kyselySql } = require('kysely') as typeof import('kysely');
  if (filter === 'unread') {
    return query
      .where('seen_local', '=', false)
      .where(kyselySql<boolean>`(uid >= 0 OR pop3_uidl IS NOT NULL)`);
  }
  if (filter === 'attachment') return query.where('has_attachments', '=', true);
  if (filter === 'customer') return query.where('customer_id', 'is not', null);
  return query.where(kyselySql<boolean>`(outbound_hold = true OR (ticket_code IS NOT NULL AND ticket_code <> ''))`);
}

const messagePriorityRankSql = kyselySql<number>`CASE
  WHEN EXISTS (SELECT 1 FROM email_message_tags t WHERE t.message_id = email_messages.id AND t.tag = 'priority:hoch') THEN 0
  WHEN EXISTS (SELECT 1 FROM email_message_tags t WHERE t.message_id = email_messages.id AND t.tag = 'priority:mittel') THEN 1
  WHEN EXISTS (SELECT 1 FROM email_message_tags t WHERE t.message_id = email_messages.id AND t.tag = 'priority:niedrig') THEN 2
  ELSE 3
END`;
const messageSortDateSql = kyselySql<Date | null>`coalesce(email_messages.date_received, email_messages.created_at)`;
const cursorMessageSortDateSql = kyselySql<Date | null>`coalesce(cursor_message.date_received, cursor_message.created_at)`;

type PriorityCursorAnchor = Readonly<{
  id: number;
  rank: number;
  sortDate: Date | null;
}>;

async function fetchPriorityCursorAnchor(
  trx: WorkspaceTransaction,
  workspaceId: string,
  cursor: number,
): Promise<PriorityCursorAnchor | null> {
  const row = await trx
    .selectFrom('email_messages')
    .select([
      'id',
      kyselySql<Date | null>`coalesce(date_received, created_at)`.as('sort_date'),
      messagePriorityRankSql.as('priority_rank'),
    ])
    .where('workspace_id', '=', workspaceId)
    .where('id', '=', cursor)
    .executeTakeFirst();
  if (!row) return null;
  return {
    id: row.id,
    rank: Number(row.priority_rank),
    sortDate: row.sort_date,
  };
}

function applyMessageCursor(
  query: any,
  workspaceId: string,
  cursor: number | undefined,
  sort: Parameters<EmailMessageApiPort['list']>[0]['sort'],
  view: Parameters<EmailMessageApiPort['list']>[0]['view'],
  priorityCursor?: PriorityCursorAnchor | null,
): any {
  if (cursor === undefined) return query;
  if (view === 'snoozed') {
    // Must stay aligned with applyMessageListOrder: snoozed_until ASC, id DESC tie-break.
    return query.where(kyselySql<boolean>`EXISTS (
      SELECT 1
      FROM email_messages cursor_message
      WHERE cursor_message.workspace_id = ${workspaceId}::uuid
        AND cursor_message.id = ${cursor}
        AND (
          email_messages.snoozed_until > cursor_message.snoozed_until
          OR (
            email_messages.snoozed_until = cursor_message.snoozed_until
            AND email_messages.id < cursor_message.id
          )
        )
    )`);
  }
  if (sort === 'date_asc') {
    return query.where(kyselySql<boolean>`EXISTS (
      SELECT 1
      FROM email_messages cursor_message
      WHERE cursor_message.workspace_id = ${workspaceId}::uuid
        AND cursor_message.id = ${cursor}
        AND (
          (${cursorMessageSortDateSql} IS NOT NULL AND ${messageSortDateSql} IS NULL)
          OR (
            ${messageSortDateSql} IS NULL
            AND ${cursorMessageSortDateSql} IS NULL
            AND email_messages.id > cursor_message.id
          )
          OR (
            ${cursorMessageSortDateSql} IS NOT NULL
            AND ${messageSortDateSql} > ${cursorMessageSortDateSql}
          )
          OR (
            ${cursorMessageSortDateSql} IS NOT NULL
            AND ${messageSortDateSql} = ${cursorMessageSortDateSql}
            AND email_messages.id > cursor_message.id
          )
        )
    )`);
  }
  if (sort === 'priority') {
    if (!priorityCursor) return query.where(kyselySql<boolean>`false`);
    const priorityCursorSortDate = kyselySql<Date | null>`${priorityCursor.sortDate}::timestamptz`;
    return query.where(kyselySql<boolean>`(
      ${messagePriorityRankSql}
      > ${priorityCursor.rank}
      OR (
        ${messagePriorityRankSql}
        = ${priorityCursor.rank}
        AND (
          (${priorityCursorSortDate} IS NULL AND ${messageSortDateSql} IS NOT NULL)
          OR (
            ${messageSortDateSql} IS NULL
            AND ${priorityCursorSortDate} IS NULL
            AND email_messages.id < ${priorityCursor.id}
          )
          OR (
            ${priorityCursorSortDate} IS NOT NULL
            AND ${messageSortDateSql} < ${priorityCursorSortDate}
          )
          OR (
            ${priorityCursorSortDate} IS NOT NULL
            AND ${messageSortDateSql} = ${priorityCursorSortDate}
            AND email_messages.id < ${priorityCursor.id}
          )
        )
      )
    )`);
  }
  return query.where(kyselySql<boolean>`EXISTS (
    SELECT 1
    FROM email_messages cursor_message
    WHERE cursor_message.workspace_id = ${workspaceId}::uuid
      AND cursor_message.id = ${cursor}
      AND (
        (${cursorMessageSortDateSql} IS NULL AND ${messageSortDateSql} IS NOT NULL)
        OR (
          ${messageSortDateSql} IS NULL
          AND ${cursorMessageSortDateSql} IS NULL
          AND email_messages.id < cursor_message.id
        )
        OR (
          ${cursorMessageSortDateSql} IS NOT NULL
          AND ${messageSortDateSql} < ${cursorMessageSortDateSql}
        )
        OR (
          ${cursorMessageSortDateSql} IS NOT NULL
          AND ${messageSortDateSql} = ${cursorMessageSortDateSql}
          AND email_messages.id < cursor_message.id
        )
      )
  )`);
}

function applyMessageDoneFilter(
  query: any,
  filter: Parameters<EmailMessageApiPort['list']>[0]['doneFilter'],
  view: Parameters<EmailMessageApiPort['list']>[0]['view'],
): any {
  if (filter === undefined || filter === 'all' || (view !== undefined && view !== 'inbox')) return query;
  return query.where('done_local', '=', filter === 'done');
}

function applyMessageSearchFilter(query: any, search: string, mode: 'fts' | 'like' | 'regex'): any {
  const { sql: kyselySql } = require('kysely') as typeof import('kysely');
  if (mode === 'regex') {
    const parsed = parseRegexSearch(search);
    if (parsed) {
      const operator = parsed.caseInsensitive ? kyselySql`~*` : kyselySql`~`;
      return query.where(kyselySql<boolean>`(
        coalesce(subject, '') || E'\n' ||
        coalesce(snippet, '') || E'\n' ||
        coalesce(body_text, '') || E'\n' ||
        coalesce(from_json::text, '') || E'\n' ||
        coalesce(to_json::text, '') || E'\n' ||
        coalesce(cc_json::text, '') || E'\n' ||
        coalesce(ticket_code, '')
      ) ${operator} ${parsed.pattern}`);
    }
  }
  if (mode === 'fts') {
    return query.where(kyselySql<boolean>`search_vector @@ plainto_tsquery('simple', ${search})`);
  }
  const pattern = `%${escapeLikePattern(search)}%`;
  return query.where(kyselySql<boolean>`(
    subject ILIKE ${pattern} ESCAPE '\\'
    OR snippet ILIKE ${pattern} ESCAPE '\\'
    OR body_text ILIKE ${pattern} ESCAPE '\\'
    OR from_json::text ILIKE ${pattern} ESCAPE '\\'
    OR to_json::text ILIKE ${pattern} ESCAPE '\\'
    OR cc_json::text ILIKE ${pattern} ESCAPE '\\'
    OR ticket_code ILIKE ${pattern} ESCAPE '\\'
    OR EXISTS (
      SELECT 1 FROM customers c
      WHERE c.workspace_id = email_messages.workspace_id
        AND c.id = email_messages.customer_id
        AND (
          c.name ILIKE ${pattern} ESCAPE '\\'
          OR c.first_name ILIKE ${pattern} ESCAPE '\\'
          OR c.company ILIKE ${pattern} ESCAPE '\\'
          OR c.email ILIKE ${pattern} ESCAPE '\\'
        )
    )
  )`);
}

function applyMessageListOrder(
  query: any,
  sort: Parameters<EmailMessageApiPort['list']>[0]['sort'],
  view: Parameters<EmailMessageApiPort['list']>[0]['view'],
): any {
  if (view === 'snoozed') return query.orderBy('snoozed_until', 'asc').orderBy('id', 'desc');
  if (view === 'scheduled_send') return query.orderBy('scheduled_send_at', 'asc').orderBy('id', 'asc');
  if (sort === 'priority') {
    return query
      .orderBy(messagePriorityRankSql, 'asc')
      .orderBy(kyselySql`coalesce(date_received, created_at)`, 'desc')
      .orderBy('id', 'desc');
  }
  if (sort === 'date_asc') return query.orderBy(kyselySql`coalesce(date_received, created_at)`, 'asc').orderBy('id', 'asc');
  return query.orderBy(kyselySql`coalesce(date_received, created_at)`, 'desc').orderBy('id', 'desc');
}

function messageSearchMode(search: string): 'fts' | 'like' | 'regex' {
  if (parseRegexSearch(search)) return 'regex';
  return search.trim() ? 'fts' : 'like';
}

function parseRegexSearch(search: string): { pattern: string; caseInsensitive: boolean } | null {
  const trimmed = search.trim();
  if (!trimmed.startsWith('/') || trimmed.length <= 2 || trimmed.lastIndexOf('/') <= 0) return null;
  const lastSlash = trimmed.lastIndexOf('/');
  const pattern = trimmed.slice(1, lastSlash);
  const flags = trimmed.slice(lastSlash + 1);
  try {
    // Validate the renderer-compatible syntax before handing it to PostgreSQL.
    new RegExp(pattern, flags.replace(/[^ims]/g, ''));
  } catch {
    return null;
  }
  return { pattern, caseInsensitive: !flags || flags.includes('i') };
}

function escapeLikePattern(value: string): string {
  return value.trim().replace(/[%_\\]/g, (ch) => `\\${ch}`);
}

export function createPostgresEmailAttachmentReadPort(options: PostgresMailReadPortOptions): EmailAttachmentApiPort {
  return {
    async listForMessage(input): Promise<EmailAttachmentListResult> {
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          const rows = await trx
            .selectFrom('email_message_attachments')
            .select(emailAttachmentSelectColumns)
            .where('workspace_id', '=', input.workspaceId)
            .where('message_id', '=', input.messageId)
            .orderBy('id', 'asc')
            .execute();
          return { items: rows.map(mapEmailAttachmentRow) };
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async get(input): Promise<EmailAttachmentRecord | null> {
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          const row = await trx
            .selectFrom('email_message_attachments')
            .select(emailAttachmentSelectColumns)
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.id)
            .executeTakeFirst();
          return row ? mapEmailAttachmentRow(row) : null;
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
  };
}

export function createPostgresEmailAttachmentContentPort(
  options: PostgresEmailAttachmentContentPortOptions,
): EmailAttachmentContentApiPort {
  const readAttachmentFile = options.readFile ?? readFile;
  return {
    async get(input): Promise<EmailAttachmentContentResult> {
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          const row = await trx
            .selectFrom('email_message_attachments')
            .select(emailAttachmentContentSelectColumns)
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.id)
            .executeTakeFirst();
          if (!row) return { ok: false, reason: 'not_found' };

          const resolvedPath = resolveAttachmentStoragePath(options.attachmentsRoot, row.storage_path);
          if (!resolvedPath) return { ok: false, reason: 'unsafe_path' };

          let content: Uint8Array;
          try {
            content = await readAttachmentFile(resolvedPath);
          } catch (err) {
            if (isFileMissingError(err)) return { ok: false, reason: 'file_not_found' };
            throw err;
          }

          return {
            ok: true,
            record: {
              id: Number(row.id),
              filename: row.filename_display,
              contentType: row.content_type,
              sizeBytes: row.size_bytes,
              contentSha256: row.content_sha256,
              content,
            },
          };
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
  };
}

export function resolveAttachmentStoragePath(attachmentsRoot: string, storagePath: string): string | null {
  const root = resolve(attachmentsRoot);
  const candidate = isAbsolute(storagePath)
    ? resolve(storagePath)
    : resolve(root, storagePath);
  const fromRoot = relative(root, candidate);
  if (!fromRoot || fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) return null;
  return candidate;
}

function normalizeLimit(limit: number): number {
  if (!Number.isInteger(limit) || limit <= 0 || limit > MAX_EMAIL_MESSAGE_LIST_LIMIT) {
    throw new Error(`email message list limit must be between 1 and ${MAX_EMAIL_MESSAGE_LIST_LIMIT}`);
  }
  return limit;
}

function normalizeEmailMessageSpamStatusMutation(
  values: EmailMessageSpamStatusMutationInput,
): EmailMessageSpamStatusMutationInput {
  const normalized = { ...values };
  if (normalized.status !== 'clean' && normalized.status !== 'review' && normalized.status !== 'spam') {
    throw new Error('email message spam status must be clean, review, or spam');
  }
  if (normalized.train !== undefined && typeof normalized.train !== 'boolean') {
    throw new Error('email message spam status train must be boolean');
  }
  if (normalized.source !== undefined) {
    const source = normalized.source.trim();
    if (!source) throw new Error('email message spam status source must not be empty');
    normalized.source = source;
  }
  if (normalized.featureKeys !== undefined && normalized.featureKeys !== null) {
    normalized.featureKeys = normalizeFeatureKeys(normalized.featureKeys);
  }
  if (normalized.train === undefined) normalized.train = true;
  if (normalized.source === undefined) normalized.source = 'manual';
  return normalized;
}

function normalizeEmailMessageSpamDecisionMutation(
  values: { applyStatus?: boolean },
): { applyStatus: boolean } {
  if (values.applyStatus !== undefined && typeof values.applyStatus !== 'boolean') {
    throw new Error('email message spam decision applyStatus must be boolean');
  }
  return { applyStatus: values.applyStatus === true };
}

function emailMessageSpamDecisionInputFromRow(message: EmailMessageSpamStatusMutationRow): {
  fromJson: unknown;
  subject: string | null;
  snippet: string | null;
  bodyText: string | null;
  bodyHtml: string | null;
  authSpf: string | null;
  authDkim: string | null;
  authDmarc: string | null;
  authArc: string | null;
  attachmentsJson: unknown;
  hasAttachments: boolean;
  rspamdScore: number | null;
  rspamdAction: string | null;
} {
  return {
    fromJson: message.from_json,
    subject: message.subject,
    snippet: message.snippet,
    bodyText: message.body_text,
    bodyHtml: message.body_html,
    authSpf: message.auth_spf,
    authDkim: message.auth_dkim,
    authDmarc: message.auth_dmarc,
    authArc: message.auth_arc,
    attachmentsJson: message.attachments_json,
    hasAttachments: message.has_attachments,
    rspamdScore: message.rspamd_score,
    rspamdAction: message.rspamd_action,
  };
}

async function loadSpamEngineSettings(
  trx: WorkspaceTransaction,
  workspaceId: string,
): Promise<SpamEngineSettings> {
  const keys = [
    'mail_security_rspamd_enabled',
    'mail_security_spam_engine_enabled',
    'mail_security_spam_review_threshold',
    'mail_security_spam_spam_threshold',
    'mail_security_spam_local_learning_enabled',
    'mail_security_spam_rspamd_contribution_enabled',
  ] as const;
  const rows = await trx
    .selectFrom('sync_info')
    .select(['key', 'value'])
    .where('workspace_id', '=', workspaceId)
    .where('key', 'in', [...keys])
    .execute();
  const values = new Map(rows.map((row) => [row.key, row.value]));
  const rspamdEnabled = syncInfoFlag(values.get('mail_security_rspamd_enabled'), false);
  const review = syncInfoBoundedInt(values.get('mail_security_spam_review_threshold'), 45, 0, 100);
  const spam = Math.max(review, syncInfoBoundedInt(values.get('mail_security_spam_spam_threshold'), 75, 0, 100));
  return {
    spamEngineEnabled: syncInfoFlag(values.get('mail_security_spam_engine_enabled'), true),
    spamReviewThreshold: review,
    spamSpamThreshold: spam,
    localLearningEnabled: syncInfoFlag(values.get('mail_security_spam_local_learning_enabled'), true),
    rspamdContributionEnabled: syncInfoFlag(
      values.get('mail_security_spam_rspamd_contribution_enabled'),
      rspamdEnabled,
    ),
  };
}

async function loadSpamLearningSettings(
  trx: WorkspaceTransaction,
  workspaceId: string,
): Promise<SpamLearningSettings> {
  const keys = [
    'mail_security_spam_local_learning_enabled',
    'mail_security_rspamd_enabled',
    'mail_security_rspamd_url',
    'mail_security_rspamd_timeout_ms',
    'mail_security_spam_rspamd_learning_enabled',
  ] as const;
  const rows = await trx
    .selectFrom('sync_info')
    .select(['key', 'value'])
    .where('workspace_id', '=', workspaceId)
    .where('key', 'in', [...keys])
    .execute();
  const values = new Map(rows.map((row) => [row.key, row.value]));
  const rspamdEnabled = syncInfoFlag(values.get('mail_security_rspamd_enabled'), false);
  return {
    localLearningEnabled: syncInfoFlag(values.get('mail_security_spam_local_learning_enabled'), true),
    rspamdLearningEnabled: rspamdEnabled && syncInfoFlag(
      values.get('mail_security_spam_rspamd_learning_enabled'),
      false,
    ),
    rspamdUrl: syncInfoUrl(values.get('mail_security_rspamd_url'), DEFAULT_RSPAMD_URL),
    rspamdTimeoutMs: syncInfoBoundedInt(
      values.get('mail_security_rspamd_timeout_ms'),
      DEFAULT_RSPAMD_TIMEOUT_MS,
      1000,
      60000,
    ),
  };
}

function rspamdLearningRequestForMessage(
  message: EmailMessageSpamStatusMutationRow,
  label: RspamdLearnLabel,
  settings: SpamLearningSettings,
): RspamdLearningRequest | null {
  if (!settings.rspamdLearningEnabled) return null;
  return {
    label,
    rawRfc822B64: message.raw_rfc822_b64,
    rawHeaders: message.raw_headers,
    bodyText: message.body_text,
    bodyHtml: message.body_html,
    rspamdUrl: settings.rspamdUrl,
    rspamdTimeoutMs: settings.rspamdTimeoutMs,
  };
}

async function runRspamdLearningBestEffort(
  requests: readonly RspamdLearningRequest[],
  options: Pick<PostgresMailReadPortOptions, 'rspamdFetch'>,
): Promise<void> {
  for (const request of requests) {
    await learnMessageWithRspamd({
      ...request,
      fetchImpl: options.rspamdFetch,
    }).catch(() => undefined);
  }
}

async function loadMailSecurityCheckSettings(
  trx: WorkspaceTransaction,
  workspaceId: string,
): Promise<MailSecurityCheckSettings> {
  const keys = [
    'mail_security_mailauth_enabled',
    'mail_security_rspamd_enabled',
    'mail_security_rspamd_url',
    'mail_security_rspamd_timeout_ms',
    'mail_security_rspamd_spam_score',
    'mail_security_auto_spam_dmarc_fail',
    'mail_security_auto_spam_spf_fail',
    'mail_security_auto_spam_rspamd',
    'workflow_sender_whitelist',
    'workflow_sender_blacklist',
  ] as const;
  const rows = await trx
    .selectFrom('sync_info')
    .select(['key', 'value'])
    .where('workspace_id', '=', workspaceId)
    .where('key', 'in', [...keys])
    .execute();
  const values = new Map(rows.map((row) => [row.key, row.value]));
  return {
    mailauthEnabled: syncInfoFlag(values.get('mail_security_mailauth_enabled'), true),
    rspamdEnabled: syncInfoFlag(values.get('mail_security_rspamd_enabled'), false),
    rspamdUrl: syncInfoUrl(values.get('mail_security_rspamd_url'), DEFAULT_RSPAMD_URL),
    rspamdTimeoutMs: syncInfoBoundedInt(
      values.get('mail_security_rspamd_timeout_ms'),
      DEFAULT_RSPAMD_TIMEOUT_MS,
      1000,
      60000,
    ),
    rspamdSpamScore: syncInfoBoundedFloat(values.get('mail_security_rspamd_spam_score'), 15, 1, 100),
    autoSpamDmarcFail: syncInfoFlag(values.get('mail_security_auto_spam_dmarc_fail'), false),
    autoSpamSpfFail: syncInfoFlag(values.get('mail_security_auto_spam_spf_fail'), false),
    autoSpamRspamd: syncInfoFlag(values.get('mail_security_auto_spam_rspamd'), false),
    senderWhitelist: values.get('workflow_sender_whitelist') ?? '',
    senderBlacklist: values.get('workflow_sender_blacklist') ?? '',
  };
}

function mailSecurityPatch(
  auth: MailAuthVerification | null,
  rspamd: RspamdCheckResult | null,
  now: Date,
): Partial<Updateable<EmailMessagesTable>> {
  if (!auth && !rspamd) return {};
  return {
    ...(auth ? {
      auth_spf: auth.spf,
      auth_dkim: auth.dkim,
      auth_dmarc: auth.dmarc,
      auth_arc: auth.arc,
      auth_dkim_domains: auth.dkimDomains.length ? auth.dkimDomains.join(', ') : null,
      auth_error: auth.error ?? null,
    } : {}),
    ...(rspamd ? {
      rspamd_score: rspamd.score,
      rspamd_action: rspamd.action,
      rspamd_symbols: rspamd.symbols.length ? rspamd.symbols.join(', ') : null,
      rspamd_error: rspamd.error ?? null,
    } : {}),
    security_checked_at: now,
    updated_at: now,
  };
}

function mailSecuritySpamRow(
  current: EmailMessageSpamStatusMutationRow,
  auth: MailAuthVerification | null,
  rspamd: RspamdCheckResult | null,
): EmailMessageSpamStatusMutationRow {
  return {
    ...current,
    ...(auth ? {
      auth_spf: auth.spf,
      auth_dkim: auth.dkim,
      auth_dmarc: auth.dmarc,
      auth_arc: auth.arc,
    } : {}),
    ...(rspamd ? {
      rspamd_score: rspamd.score,
      rspamd_action: rspamd.action,
    } : {}),
  };
}

function syncInfoFlag(value: string | null | undefined, defaultOn: boolean): boolean {
  if (value == null || value === '') return defaultOn;
  const normalized = value.toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

function syncInfoBoundedInt(
  value: string | null | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function syncInfoBoundedFloat(
  value: string | null | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = Number.parseFloat(value ?? '');
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function syncInfoUrl(value: string | null | undefined, fallback: string): string {
  const raw = value?.trim().replace(/\/$/, '');
  return raw || fallback;
}

async function selectSpamListMatchForMessage(
  trx: WorkspaceTransaction,
  workspaceId: string,
  message: EmailMessageSpamStatusMutationRow,
  senderEmail: string,
  senderDomain: string,
): Promise<SpamListMatch | null> {
  const rows = await trx
    .selectFrom('email_spam_list_entries')
    .select(['list_type', 'pattern_type', 'pattern'])
    .where('workspace_id', '=', workspaceId)
    .where((eb) => eb.or([
      eb('account_id', 'is', null),
      message.account_id === null
        ? eb('account_id', 'is', null)
        : eb('account_id', '=', Number(message.account_id)),
    ]))
    .execute();
  let bestAllow: SpamListMatch | null = null;
  let bestBlock: SpamListMatch | null = null;
  for (const row of rows) {
    const specificity = spamListEntrySpecificity(row.pattern_type, row.pattern, senderEmail, senderDomain);
    if (specificity <= 0) continue;
    const match = {
      listType: row.list_type,
      patternType: row.pattern_type,
      pattern: row.pattern,
      specificity,
    };
    if (row.list_type === 'allow') {
      if (!bestAllow || specificity > bestAllow.specificity) bestAllow = match;
    } else if (!bestBlock || specificity > bestBlock.specificity) {
      bestBlock = match;
    }
  }
  return bestAllow ?? bestBlock;
}

function spamListEntrySpecificity(
  patternType: 'email' | 'domain',
  pattern: string,
  senderEmail: string,
  domain: string,
): number {
  if (patternType === 'email') return senderEmail === pattern ? 100 : 0;
  if (domain === pattern) return 80;
  if (domain.endsWith(`.${pattern}`)) return 60;
  return 0;
}

async function loadSpamFeatureStatsForKeys(
  trx: WorkspaceTransaction,
  workspaceId: string,
  featureKeys: readonly string[],
): Promise<Map<string, { feature_key: string; spam_count: number; ham_count: number }>> {
  const out = new Map<string, { feature_key: string; spam_count: number; ham_count: number }>();
  if (featureKeys.length === 0) return out;
  const rows = await trx
    .selectFrom('email_spam_feature_stats')
    .select(['feature_key', 'spam_count', 'ham_count'])
    .where('workspace_id', '=', workspaceId)
    .where('feature_key', 'in', [...featureKeys])
    .execute();
  for (const row of rows) {
    out.set(row.feature_key, {
      feature_key: row.feature_key,
      spam_count: Number(row.spam_count),
      ham_count: Number(row.ham_count),
    });
  }
  return out;
}

async function insertSpamDecisionForMessage(
  trx: WorkspaceTransaction,
  workspaceId: string,
  message: EmailMessageSpamStatusMutationRow,
  decision: SpamScoreBreakdown,
  now: Date,
): Promise<SpamDecisionRecord> {
  const row = await trx
    .insertInto('email_spam_decisions')
    .values({
      workspace_id: workspaceId,
      source_sqlite_id: serverCreatedSpamDecisionSourceSqliteId(),
      message_source_sqlite_id: Number(message.source_sqlite_id),
      account_source_sqlite_id: Number(message.account_source_sqlite_id),
      message_id: Number(message.id),
      account_id: message.account_id === null ? null : Number(message.account_id),
      score: decision.score,
      status: decision.status,
      source: decision.source,
      breakdown_json: decision,
      model_version: decision.modelVersion,
      source_row: serverSpamEngineSourceRow(),
      created_at: now,
      updated_at: now,
    })
    .returning([
      'id',
      'source_sqlite_id',
      'message_source_sqlite_id',
      'account_source_sqlite_id',
      'message_id',
      'account_id',
      'score',
      'status',
      'source',
      'breakdown_json',
      'model_version',
      'created_at',
      'updated_at',
    ])
    .executeTakeFirstOrThrow();
  return {
    id: Number(row.id),
    sourceSqliteId: row.source_sqlite_id === null ? null : Number(row.source_sqlite_id),
    messageSourceSqliteId: row.message_source_sqlite_id === null ? null : Number(row.message_source_sqlite_id),
    accountSourceSqliteId: Number(row.account_source_sqlite_id),
    messageId: row.message_id === null ? null : Number(row.message_id),
    accountId: row.account_id === null ? null : Number(row.account_id),
    score: row.score,
    status: row.status,
    source: row.source,
    breakdown: row.breakdown_json,
    modelVersion: row.model_version,
    createdAt: timestampToIsoOrNull(row.created_at),
    updatedAt: timestampToIso(row.updated_at),
  };
}

async function pruneSpamDecisionsForMessage(
  trx: WorkspaceTransaction,
  workspaceId: string,
  messageId: number,
): Promise<void> {
  const { sql: kyselySql } = require('kysely') as typeof import('kysely');
  await kyselySql`
    DELETE FROM email_spam_decisions
    WHERE workspace_id = ${workspaceId}::uuid
      AND message_id = ${messageId}
      AND id NOT IN (
        SELECT id
        FROM email_spam_decisions
        WHERE workspace_id = ${workspaceId}::uuid
          AND message_id = ${messageId}
        ORDER BY created_at DESC, id DESC
        LIMIT 20
      )
  `.execute(trx);
}

function spamStatusPatch(
  status: 'clean' | 'review' | 'spam',
  currentFolderKind: string,
): Partial<Updateable<EmailMessagesTable>> {
  if (status === 'spam') {
    return {
      is_spam: true,
      spam_status: 'spam',
      soft_deleted: false,
      archived: false,
      done_local: true,
    };
  }
  if (status === 'review') {
    return {
      is_spam: false,
      spam_status: 'review',
      soft_deleted: false,
      archived: false,
      done_local: false,
      seen_local: false,
      folder_kind: 'inbox',
    };
  }
  return {
    is_spam: false,
    spam_status: 'clean',
    soft_deleted: false,
    archived: false,
    done_local: false,
    folder_kind: currentFolderKind === 'sent' || currentFolderKind === 'draft' ? currentFolderKind : 'inbox',
  };
}

function learningLabelForSpamStatusTransition(
  previous: string,
  next: 'clean' | 'review' | 'spam',
): 'spam' | 'ham' | null {
  if (next === 'spam' && previous !== 'spam') return 'spam';
  if (next === 'clean' && (previous === 'spam' || previous === 'review')) return 'ham';
  return null;
}

async function insertSpamLearningEventForMessage(
  trx: WorkspaceTransaction,
  workspaceId: string,
  message: EmailMessageSpamStatusMutationRow,
  input: {
    label: 'spam' | 'ham';
    source: string;
    featureKeys: readonly string[];
    now: Date;
  },
): Promise<void> {
  const spamInc = input.label === 'spam' ? 1 : 0;
  const hamInc = input.label === 'ham' ? 1 : 0;
  await trx
    .insertInto('email_spam_learning_events')
    .values({
      workspace_id: workspaceId,
      source_sqlite_id: serverCreatedSpamLearningEventSourceSqliteId(),
      message_source_sqlite_id: Number(message.source_sqlite_id),
      account_source_sqlite_id: Number(message.account_source_sqlite_id),
      message_id: Number(message.id),
      account_id: message.account_id === null ? null : Number(message.account_id),
      label: input.label,
      source: input.source,
      // jsonb column: a raw JS array is serialized by node-postgres as a Postgres
      // array literal ('{...}'), which fails to parse as JSON. Plain objects are
      // auto-JSON.stringified, but arrays are not — so stringify explicitly.
      feature_keys_json: input.featureKeys.length > 0 ? JSON.stringify([...input.featureKeys]) : null,
      source_row: serverApiSourceRow(),
      created_at: input.now,
      updated_at: input.now,
    })
    .execute();

  for (const featureKey of input.featureKeys) {
    if (!isSpamLearningFeatureKey(featureKey)) continue;
    await trx
      .insertInto('email_spam_feature_stats')
      .values({
        workspace_id: workspaceId,
        feature_key: featureKey,
        spam_count: spamInc,
        ham_count: hamInc,
        source_row: serverApiSourceRow(),
        imported_in_run_id: null,
        updated_at: input.now,
      })
      .onConflict((oc) => oc.columns(['workspace_id', 'feature_key']).doUpdateSet((eb) => ({
        spam_count: eb('email_spam_feature_stats.spam_count', '+', spamInc),
        ham_count: eb('email_spam_feature_stats.ham_count', '+', hamInc),
        updated_at: input.now,
      })))
      .execute();
  }
}

function normalizeFeatureKeys(rawValue: readonly string[] | null | undefined): readonly string[] {
  if (!rawValue) return [];
  const normalized: string[] = [];
  for (const item of rawValue) {
    const value = item.trim();
    if (!value) continue;
    if (value.length > 300) throw new Error('email message spam status featureKeys entries must not exceed 300 characters');
    if (!normalized.includes(value)) normalized.push(value);
  }
  if (normalized.length > 200) throw new Error('email message spam status featureKeys must not exceed 200 entries');
  return normalized;
}

export async function createPostgresComposeDraftInTransaction(
  trx: WorkspaceTransaction,
  input: {
    workspaceId: string;
    accountId: number;
    values: EmailComposeDraftCreateInput;
  },
): Promise<EmailComposeDraftMutationResult> {
  const account = await selectEmailAccountByPublicId(trx, input.workspaceId, input.accountId);
  if (!account) return { ok: false as const, reason: 'account_not_found' as const };
  const folder = await ensureServerComposeDraftFolder(trx, input.workspaceId, account);
  const uid = await nextLocalDraftUid(trx, input.workspaceId, Number(account.id), Number(folder.id));
  const now = new Date();
  const bodyText = input.values.bodyText ?? '';
  const row = await trx
    .insertInto('email_messages')
    .values({
      workspace_id: input.workspaceId,
      source_sqlite_id: serverCreatedEmailMessageSourceSqliteId(),
      account_source_sqlite_id: Number(account.source_sqlite_id),
      folder_source_sqlite_id: Number(folder.source_sqlite_id),
      account_id: Number(account.id),
      folder_id: Number(folder.id),
      uid,
      message_id: null,
      in_reply_to: null,
      references_header: null,
      subject: input.values.subject ?? '(Entwurf)',
      from_json: addressJson({
        value: [{
          address: String(account.email_address).trim(),
          ...(String(account.display_name ?? '').trim()
            ? { name: String(account.display_name).trim() }
            : {}),
        }],
      }),
      to_json: input.values.toJson ?? null,
      cc_json: null,
      bcc_json: null,
      date_received: now,
      snippet: bodyText.slice(0, 220) || null,
      body_text: bodyText,
      body_html: null,
      seen_local: true,
      done_local: false,
      sent_imap_sync_failed: false,
      archived: false,
      soft_deleted: false,
      outbound_hold: false,
      outbound_block_reason: null,
      thread_id: null,
      ticket_code: null,
      customer_source_sqlite_id: null,
      customer_id: null,
      folder_kind: 'draft',
      imap_thread_id: null,
      has_attachments: false,
      attachments_json: null,
      draft_attachment_paths_json: input.values.draftAttachmentPaths === undefined
        ? null
        : draftAttachmentPathsToJsonValue(input.values.draftAttachmentPaths),
      post_process_done: false,
      reply_parent_message_id: null,
      assigned_to: null,
      legacy_assigned_to_user_id: null,
      assigned_to_user_id: null,
      is_spam: false,
      spam_status: 'clean',
      snoozed_until: null,
      scheduled_send_at: null,
      pop3_uidl: null,
      remote_content_policy: 'blocked',
      read_receipt_requested: false,
      thread_resolver_version: 0,
      source_row: serverApiSourceRow(),
      created_at: now,
      updated_at: now,
    })
    .returning(emailMessageDetailColumns)
    .executeTakeFirstOrThrow();
  return { ok: true as const, message: mapEmailMessageRow(row, true) };
}

async function ensureServerComposeDraftFolder(
  trx: WorkspaceTransaction,
  workspaceId: string,
  account: Pick<EmailAccountRow, 'id' | 'source_sqlite_id'>,
): Promise<Pick<EmailFolderRow, 'id' | 'source_sqlite_id'>> {
  const existing = await trx
    .selectFrom('email_folders')
    .select(['id', 'source_sqlite_id'])
    .where('workspace_id', '=', workspaceId)
    .where('account_id', '=', Number(account.id))
    .where((eb) => eb.or([
      eb('path', '=', 'INBOX'),
      eb('path', '=', 'Inbox'),
      eb('path', '=', 'inbox'),
    ]))
    .orderBy('id', 'asc')
    .executeTakeFirst();
  if (existing) return existing;

  const now = new Date();
  return trx
    .insertInto('email_folders')
    .values({
      workspace_id: workspaceId,
      source_sqlite_id: serverCreatedEmailFolderSourceSqliteId(),
      account_source_sqlite_id: Number(account.source_sqlite_id),
      account_id: Number(account.id),
      path: 'INBOX',
      delimiter: '/',
      uidvalidity: null,
      uidvalidity_str: null,
      last_uid: 0,
      last_synced_at: null,
      pop3_uidl_str: null,
      source_row: serverApiSourceRow(),
      imported_in_run_id: null,
      updated_at: now,
    })
    .onConflict((oc) => oc.columns(['workspace_id', 'account_source_sqlite_id', 'path']).doUpdateSet({
      account_id: Number(account.id),
      updated_at: now,
    }))
    .returning(['id', 'source_sqlite_id'])
    .executeTakeFirstOrThrow();
}

async function nextLocalDraftUid(
  trx: WorkspaceTransaction,
  workspaceId: string,
  accountId: number,
  folderId: number,
): Promise<number> {
  const row = await trx
    .selectFrom('email_messages')
    .select((eb) => eb.fn.min<number>('uid').as('min_uid'))
    .where('workspace_id', '=', workspaceId)
    .where('account_id', '=', accountId)
    .where('folder_id', '=', folderId)
    .where('uid', '<', 0)
    .where('uid', '>', POP3_UID_CEILING)
    .executeTakeFirst();
  return row?.min_uid != null ? Number(row.min_uid) - 1 : -1;
}

async function selectLocalDraftForMutation(
  trx: WorkspaceTransaction,
  workspaceId: string,
  messageId: number,
): Promise<LocalDraftMutationRow | undefined> {
  return trx
    .selectFrom('email_messages')
    .select(emailMessageDetailColumns)
    .where('workspace_id', '=', workspaceId)
    .where('id', '=', messageId)
    .executeTakeFirst();
}

function isLocalDraftUid(row: Pick<EmailMessageRow, 'uid'>): boolean {
  return Number(row.uid) < 0;
}

function isSchedulableLocalDraft(row: Pick<EmailMessageRow, 'uid' | 'folder_kind'>): boolean {
  return Number(row.uid) < 0 && row.folder_kind === 'draft';
}

function draftAttachmentPathsToJsonValue(paths: readonly string[]): string | null {
  const unique = [...new Set(paths.map((path) => path.trim()).filter(Boolean))];
  if (unique.length === 0) return null;
  return JSON.stringify(unique.map((path) => ({
    path,
    filename: path.split(/[/\\]/).pop() ?? path,
  })));
}

function composeSmtpCommittedKey(messageId: number): string {
  return `email_compose_smtp_ok:${messageId}`;
}

async function getScheduledSendDraftStateFromSyncInfo(
  trx: WorkspaceTransaction,
  workspaceId: string,
  messageId: number,
): Promise<{ failureCount: number; status: 'ok' | 'pending' | 'failed'; lastError: string | null }> {
  const rows = await trx
    .selectFrom('sync_info')
    .select(['key', 'value'])
    .where('workspace_id', '=', workspaceId)
    .where('key', 'in', [...scheduledSendSyncInfoKeys(messageId)])
    .execute();
  const values = new Map(rows.map((row) => [row.key, row.value]));
  return parseScheduledSendDraftStateFromValues(values, messageId);
}

async function getComposeDraftRecoveryStateFromSyncInfo(
  trx: WorkspaceTransaction,
  workspaceId: string,
  messageId: number,
): Promise<{ smtpCommitted: boolean; needsResendFinalize: boolean }> {
  const draft = await trx
    .selectFrom('email_messages')
    .select(['uid', 'folder_kind'])
    .where('workspace_id', '=', workspaceId)
    .where('id', '=', messageId)
    .executeTakeFirst();
  const committed = await trx
    .selectFrom('sync_info')
    .select('value')
    .where('workspace_id', '=', workspaceId)
    .where('key', '=', composeSmtpCommittedKey(messageId))
    .executeTakeFirst();
  const smtpCommitted = committed?.value === '1';
  return {
    smtpCommitted,
    needsResendFinalize: Boolean(
      smtpCommitted &&
      draft &&
      Number(draft.uid) < 0 &&
      draft.folder_kind === 'draft',
    ),
  };
}

async function clearScheduledSendDraftMeta(
  trx: WorkspaceTransaction,
  workspaceId: string,
  messageId: number,
): Promise<void> {
  const now = new Date();
  const values = {
    [scheduledSendFailuresKey(messageId)]: '0',
    [scheduledSendStatusKey(messageId)]: '',
    [scheduledSendLastErrorKey(messageId)]: '',
  };
  await trx
    .insertInto('sync_info')
    .values(Object.entries(values).map(([key, value]) => ({
      workspace_id: workspaceId,
      key,
      value,
      last_updated: now,
      source_row: serverApiSourceRow(),
      imported_in_run_id: null,
      updated_at: now,
    })))
    .onConflict((oc) => oc.columns(['workspace_id', 'key']).doUpdateSet({
      value: (eb) => eb.ref('excluded.value'),
      last_updated: now,
      updated_at: now,
    }))
    .execute();
}

function serverCreatedEmailMessageSourceSqliteId(): number {
  return serverCreatedSourceSqliteId('email_messages');
}

function serverCreatedEmailAccountSourceSqliteId(): number {
  return serverCreatedSourceSqliteId('email_accounts');
}

function serverCreatedEmailFolderSourceSqliteId(): number {
  return serverCreatedSourceSqliteId('email_folders');
}

function serverCreatedEmailMessageTagSourceSqliteId(): number {
  return serverCreatedSourceSqliteId('email_message_tags');
}

function serverCreatedSpamLearningEventSourceSqliteId(): number {
  return serverCreatedSourceSqliteId('email_spam_learning_events');
}

function serverCreatedSpamDecisionSourceSqliteId(): number {
  return serverCreatedSourceSqliteId('email_spam_decisions');
}

function serverCreatedEmailRemoteContentAllowlistSourceSqliteId(): number {
  return serverCreatedSourceSqliteId('email_remote_content_allowlist');
}

function serverCreatedSourceSqliteId(kind: string): number {
  serverCreatedSourceCounter = (serverCreatedSourceCounter + 1) % 1_000_000;
  let hash = 14_695_981_039_346_656_037n;
  for (let index = 0; index < kind.length; index += 1) {
    hash ^= BigInt(kind.charCodeAt(index));
    hash *= 1_099_511_628_211n;
    hash &= 0xffff_ffff_ffff_ffffn;
  }
  const value = (BigInt(Date.now()) * 1000n)
    + BigInt(serverCreatedSourceCounter % 1000)
    + (hash % 997n);
  return -Number(value);
}

function serverApiSourceRow(): Record<string, string> {
  return { origin: 'server_api' };
}

function serverSpamEngineSourceRow(): Record<string, string> {
  return { origin: 'server_spam_engine' };
}

async function selectRemoteContentPolicyRow(
  trx: WorkspaceTransaction,
  workspaceId: string,
  messageId: number,
): Promise<EmailRemoteContentPolicyRow | undefined> {
  return trx
    .selectFrom('email_messages')
    .leftJoin('email_accounts', (join) => join
      .onRef('email_accounts.id', '=', 'email_messages.account_id')
      .on('email_accounts.workspace_id', '=', workspaceId))
    .select([
      'email_messages.id as id',
      'email_messages.from_json as from_json',
      'email_messages.remote_content_policy as remote_content_policy',
      'email_accounts.default_remote_content_policy as default_remote_content_policy',
    ])
    .where('email_messages.workspace_id', '=', workspaceId)
    .where('email_messages.id', '=', messageId)
    .executeTakeFirst();
}

async function resolveRemoteContentPolicy(
  trx: WorkspaceTransaction,
  workspaceId: string,
  row: EmailRemoteContentPolicyRow,
): Promise<EmailRemoteContentPolicyResult> {
  const policy = normalizeRemoteContentPolicy(row.remote_content_policy || row.default_remote_content_policy || 'blocked');
  const sender = extractFirstEmailAddress(row.from_json);
  const domain = sender ? domainOf(sender) : '';

  if (policy === 'allowed_sender' && sender && await isRemoteContentAllowlisted(trx, workspaceId, 'sender', sender)) {
    return { policy, allowRemote: true };
  }
  if (policy === 'allowed_domain' && domain && await isRemoteContentAllowlisted(trx, workspaceId, 'domain', domain)) {
    return { policy, allowRemote: true };
  }
  if (policy === 'allowed_once') return { policy, allowRemote: true };
  if (policy === 'allowed_sender' || policy === 'allowed_domain') return { policy: 'blocked', allowRemote: false };
  return { policy: 'blocked', allowRemote: false };
}

async function isRemoteContentAllowlisted(
  trx: WorkspaceTransaction,
  workspaceId: string,
  scope: 'sender' | 'domain',
  value: string,
): Promise<boolean> {
  const row = await trx
    .selectFrom('email_remote_content_allowlist')
    .select('id')
    .where('workspace_id', '=', workspaceId)
    .where('scope', '=', scope)
    .where(({ eb }) => {
      const { sql: kyselySql } = require('kysely') as typeof import('kysely');
      return eb(kyselySql<string>`lower(value)`, '=', value.toLowerCase());
    })
    .executeTakeFirst();
  return Boolean(row);
}

function normalizeRemoteContentPolicy(value: string): EmailRemoteContentPolicy {
  if (
    value === 'blocked'
    || value === 'allowed_once'
    || value === 'allowed_sender'
    || value === 'allowed_domain'
  ) {
    return value;
  }
  return 'blocked';
}

function extractFirstEmailAddress(value: unknown): string {
  const candidate = extractFirstEmailAddressCandidate(value);
  if (!candidate) return '';
  const match = candidate.match(/<([^>]+)>/);
  return (match ? match[1] : candidate).trim().toLowerCase();
}

function extractFirstEmailAddressCandidate(value: unknown): string {
  if (typeof value === 'string') {
    try {
      return extractFirstEmailAddressCandidate(JSON.parse(value));
    } catch {
      return value;
    }
  }
  if (!value || typeof value !== 'object') return '';
  if (Array.isArray(value)) return extractFirstEmailAddressCandidate(value[0]);
  const record = value as Record<string, unknown>;
  if (typeof record.address === 'string') return record.address;
  if (Array.isArray(record.value)) return extractFirstEmailAddressCandidate(record.value[0]);
  return '';
}

function domainOf(email: string): string {
  const at = email.lastIndexOf('@');
  return at >= 0 ? email.slice(at + 1) : email;
}

async function selectEmailAccountByPublicId(
  trx: WorkspaceTransaction,
  workspaceId: string,
  id: number,
): Promise<Pick<EmailAccountRow, typeof emailAccountSelectColumns[number]> | undefined> {
  const bySourceId = await trx
    .selectFrom('email_accounts')
    .select(emailAccountSelectColumns)
    .where('workspace_id', '=', workspaceId)
    .where('source_sqlite_id', '=', id)
    .executeTakeFirst();
  if (bySourceId) return bySourceId;

  return trx
    .selectFrom('email_accounts')
    .select(emailAccountSelectColumns)
    .where('workspace_id', '=', workspaceId)
    .where('id', '=', id)
    .executeTakeFirst();
}

function mutationToEmailAccountPatch(
  values: EmailAccountMutationInput,
): Partial<Updateable<EmailAccountsTable>> {
  return {
    ...(values.displayName === undefined ? {} : { display_name: values.displayName }),
    ...(values.emailAddress === undefined ? {} : { email_address: values.emailAddress }),
    ...(values.imapHost === undefined ? {} : { imap_host: values.imapHost }),
    ...(values.imapPort === undefined ? {} : { imap_port: values.imapPort }),
    ...(values.imapTls === undefined ? {} : { imap_tls: values.imapTls }),
    ...(values.imapUsername === undefined ? {} : { imap_username: values.imapUsername }),
    ...(values.smtpHost === undefined ? {} : { smtp_host: values.smtpHost }),
    ...(values.smtpPort === undefined ? {} : { smtp_port: values.smtpPort }),
    ...(values.smtpTls === undefined ? {} : { smtp_tls: values.smtpTls }),
    ...(values.smtpUsername === undefined ? {} : { smtp_username: values.smtpUsername }),
    ...(values.smtpUseImapAuth === undefined ? {} : { smtp_use_imap_auth: values.smtpUseImapAuth }),
    ...(values.protocol === undefined ? {} : { protocol: values.protocol }),
    ...(values.pop3Host === undefined ? {} : { pop3_host: values.pop3Host }),
    ...(values.pop3Port === undefined ? {} : { pop3_port: values.pop3Port }),
    ...(values.pop3Tls === undefined ? {} : { pop3_tls: values.pop3Tls }),
    ...(values.sentFolderPath === undefined ? {} : { sent_folder_path: values.sentFolderPath }),
    ...(values.syncSpamFolderPath === undefined ? {} : { sync_spam_folder_path: values.syncSpamFolderPath }),
    ...(values.syncArchiveFolderPath === undefined ? {} : { sync_archive_folder_path: values.syncArchiveFolderPath }),
    ...(values.imapSyncSent === undefined ? {} : { imap_sync_sent: values.imapSyncSent }),
    ...(values.imapSyncArchive === undefined ? {} : { imap_sync_archive: values.imapSyncArchive }),
    ...(values.imapSyncSpam === undefined ? {} : { imap_sync_spam: values.imapSyncSpam }),
    ...(values.imapSyncSeenOnOpen === undefined ? {} : { imap_sync_seen_on_open: values.imapSyncSeenOnOpen }),
    ...(values.vacationEnabled === undefined ? {} : { vacation_enabled: values.vacationEnabled }),
    ...(values.vacationSubject === undefined ? {} : { vacation_subject: values.vacationSubject }),
    ...(values.vacationBodyText === undefined ? {} : { vacation_body_text: values.vacationBodyText }),
    ...(values.requestReadReceipt === undefined ? {} : { request_read_receipt: values.requestReadReceipt }),
    ...(values.imapDeleteOptIn === undefined ? {} : { imap_delete_opt_in: values.imapDeleteOptIn }),
  };
}

function passwordShouldBeStored(value: string | undefined): boolean {
  return typeof value === 'string' && value.length > 0;
}

function emailAccountSecretIdentifier(
  workspaceId: string,
  accountId: number,
  secret: 'imap' | 'smtp' | 'oauth_refresh',
): { workspaceId: string; kind: string; name: string } {
  if (secret === 'imap') {
    return {
      workspaceId,
      kind: 'email.account.imap_password',
      name: `email_account:${accountId}:imap`,
    };
  }
  if (secret === 'smtp') {
    return {
      workspaceId,
      kind: 'email.account.smtp_password',
      name: `email_account:${accountId}:smtp`,
    };
  }
  return {
    workspaceId,
    kind: 'email.account.oauth_refresh_token',
    name: `email_account:${accountId}:oauth_refresh`,
  };
}

function mapEmailAccountRow(row: Pick<EmailAccountRow, typeof emailAccountSelectColumns[number]>): EmailAccountRecord {
  return {
    id: Number(row.id),
    sourceSqliteId: Number(row.source_sqlite_id),
    displayName: row.display_name,
    emailAddress: row.email_address,
    protocol: row.protocol,
    imapHost: row.imap_host,
    imapPort: row.imap_port,
    imapTls: row.imap_tls,
    imapUsername: row.imap_username,
    smtpHost: row.smtp_host,
    smtpPort: row.smtp_port,
    smtpTls: row.smtp_tls,
    smtpUsername: row.smtp_username,
    smtpUseImapAuth: row.smtp_use_imap_auth,
    pop3Host: row.pop3_host,
    pop3Port: row.pop3_port,
    pop3Tls: row.pop3_tls,
    oauthProvider: row.oauth_provider,
    sentFolderPath: row.sent_folder_path,
    syncSpamFolderPath: row.sync_spam_folder_path,
    syncArchiveFolderPath: row.sync_archive_folder_path,
    imapSyncSent: row.imap_sync_sent,
    imapSyncArchive: row.imap_sync_archive,
    imapSyncSpam: row.imap_sync_spam,
    imapSyncSeenOnOpen: row.imap_sync_seen_on_open,
    vacationEnabled: row.vacation_enabled,
    vacationSubject: row.vacation_subject,
    vacationBodyText: row.vacation_body_text,
    requestReadReceipt: row.request_read_receipt,
    imapDeleteOptIn: row.imap_delete_opt_in,
    defaultRemoteContentPolicy: row.default_remote_content_policy,
    respondToReadReceipts: row.respond_to_read_receipts,
    imapPasswordConfigured: Boolean(row.imap_password_secret_id ?? row.keytar_account_key),
    smtpPasswordConfigured: Boolean(row.smtp_password_secret_id ?? row.smtp_keytar_account_key),
    oauthRefreshConfigured: Boolean(row.oauth_refresh_secret_id ?? row.oauth_refresh_keytar_key),
    updatedAt: timestampToIso(row.updated_at),
  };
}

function mapEmailMessageRow(
  row: EmailMessageApiRow,
  includeBody: boolean,
): EmailMessageRecord {
  return {
    id: Number(row.id),
    sourceSqliteId: Number(row.source_sqlite_id),
    accountId: row.account_id === null ? null : Number(row.account_id),
    folderId: row.folder_id === null ? null : Number(row.folder_id),
    uid: Number(row.uid),
    messageId: row.message_id,
    subject: row.subject,
    from: row.from_json,
    to: row.to_json,
    cc: row.cc_json,
    bcc: row.bcc_json,
    dateReceived: timestampToIsoOrNull(row.date_received),
    snippet: row.snippet,
    seenLocal: row.seen_local,
    doneLocal: row.done_local,
    archived: row.archived,
    softDeleted: row.soft_deleted,
    folderKind: row.folder_kind,
    threadId: row.thread_id,
    imapThreadId: row.imap_thread_id,
    ticketCode: row.ticket_code,
    customerId: row.customer_id === null ? null : Number(row.customer_id),
    hasAttachments: row.has_attachments,
    assignedTo: row.assigned_to,
    assignedToUserId: row.assigned_to_user_id,
    isSpam: row.is_spam,
    spamStatus: row.spam_status,
    pgpStatus: row.pgp_status,
    remoteContentPolicy: row.remote_content_policy,
    readReceiptRequested: row.read_receipt_requested,
    snoozedUntil: timestampToIsoOrNull(row.snoozed_until),
    draftAttachmentPathsJson: row.draft_attachment_paths_json,
    replyParentMessageId: row.reply_parent_message_id === null ? null : Number(row.reply_parent_message_id),
    ...(includeBody ? {
      bodyText: row.body_text,
      bodyHtml: row.body_html,
    } : {}),
    updatedAt: timestampToIso(row.updated_at),
  };
}

function mapEmailMessageSecurityRow(row: EmailMessageSecurityRow): EmailMessageSecurityRecord {
  return {
    authSpf: row.auth_spf,
    authDkim: row.auth_dkim,
    authDmarc: row.auth_dmarc,
    authArc: row.auth_arc,
    authDkimDomains: row.auth_dkim_domains,
    authError: row.auth_error,
    rspamdScore: row.rspamd_score,
    rspamdAction: row.rspamd_action,
    rspamdSymbols: row.rspamd_symbols,
    rspamdError: row.rspamd_error,
    securityCheckedAt: timestampToIsoOrNull(row.security_checked_at),
    spamStatus: row.spam_status,
    spamScore: row.spam_score,
    spamScoreLabel: row.spam_score_label,
    spamDecisionSource: row.spam_decision_source,
    spamScoreBreakdownJson: row.spam_score_breakdown_json,
    spamDecidedAt: timestampToIsoOrNull(row.spam_decided_at),
  };
}

function mapEmailReadReceiptStateRow(row: EmailReadReceiptStateRow): EmailReadReceiptStateResult {
  const respond = row.respond_to_read_receipts === 'ask' || row.respond_to_read_receipts === 'always_trusted'
    ? row.respond_to_read_receipts
    : 'never';
  return {
    requested: row.read_receipt_requested,
    respond,
    trustedDomains: row.read_receipt_trusted_domains,
  };
}

function mapEmailMailFolderCountsRow(row: EmailMailFolderCountsRow | undefined): EmailMailFolderCounts {
  return {
    inbox: countValue(row?.inbox),
    inboxUnread: countValue(row?.inbox_unread),
    sentFailed: countValue(row?.sent_failed),
    drafts: countValue(row?.drafts),
    scheduledSend: countValue(row?.scheduled_send),
    archived: countValue(row?.archived),
    spamReview: countValue(row?.spam_review),
    spam: countValue(row?.spam),
    trash: countValue(row?.trash),
    snoozed: countValue(row?.snoozed),
  };
}

function countValue(value: number | string | bigint | null | undefined): number {
  const count = typeof value === 'bigint' ? Number(value) : Number(value ?? 0);
  return Number.isFinite(count) && count >= 0 ? count : 0;
}

function mapEmailMessageRawHeadersRow(row: EmailMessageRawHeadersRow): EmailMessageRawHeadersRecord {
  const original = decodeStoredRawRfc822(row.raw_rfc822_b64);
  const emlSource = original === null ? 'reconstructed' : 'original';
  const rawEml = original ?? buildServerReconstructedEml(row);
  return {
    rawEml: `${rawEml}${formatServerRawEmlAppendix(row, emlSource)}`,
    emlSource,
    rawHeaders: row.raw_headers ?? null,
    messageIdHeader: row.message_id ?? null,
    fromJson: row.from_json ?? null,
  };
}

function decodeStoredRawRfc822(rawRfc822B64: string | null): string | null {
  const encoded = rawRfc822B64?.trim();
  if (!encoded) return null;
  return Buffer.from(encoded, 'base64').toString('latin1');
}

function buildServerReconstructedEml(row: EmailMessageRawHeadersRow): string {
  const storedHeaders = row.raw_headers?.trim() && !isCorruptRawHeaders(row.raw_headers)
    ? row.raw_headers
    : null;
  const headerBlock = crlf(storedHeaders ? stripBodyContentHeaders(storedHeaders) : synthesizeServerHeaders(row))
    .replace(/\r\n+$/, '');
  const body = (row.body_text ?? '').trim() || (row.body_html ?? '').trim();
  const contentType = (row.body_html ?? '').trim() && !(row.body_text ?? '').trim()
    ? 'text/html; charset=utf-8'
    : 'text/plain; charset=utf-8';
  return [
    headerBlock,
    `Content-Type: ${contentType}`,
    'MIME-Version: 1.0',
    '',
    crlf(body).replace(/\r\n+$/, ''),
    '',
  ].join('\r\n');
}

function synthesizeServerHeaders(row: EmailMessageRawHeadersRow): string {
  const lines: string[] = [];
  const from = formatServerMailboxList(row.from_json);
  if (from) lines.push(`From: ${from}`);
  const to = formatServerMailboxList(row.to_json);
  if (to) lines.push(`To: ${to}`);
  const cc = formatServerMailboxList(row.cc_json);
  if (cc) lines.push(`Cc: ${cc}`);
  if (row.subject) lines.push(`Subject: ${sanitizeHeaderValue(row.subject)}`);
  if (row.date_received) lines.push(`Date: ${timestampToIso(row.date_received)}`);
  if (row.message_id) lines.push(`Message-ID: ${sanitizeHeaderValue(row.message_id)}`);
  if (row.in_reply_to) lines.push(`In-Reply-To: ${sanitizeHeaderValue(row.in_reply_to)}`);
  if (row.references_header) lines.push(`References: ${sanitizeHeaderValue(row.references_header)}`);
  lines.push('X-SimpleCRM-Reconstructed: 1');
  return lines.join('\r\n');
}

function formatServerMailboxList(value: unknown): string | null {
  const canonical = normalizeAddressJson(value);
  if (!canonical?.value.length) return null;
  const addresses = canonical.value
    .map((entry) => {
      const address = entry.address.trim();
      if (!address) return null;
      const name = entry.name?.trim();
      if (!name) return address;
      return `"${name.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}" <${address}>`;
    })
    .filter((entry): entry is string => Boolean(entry));
  return addresses.length > 0 ? addresses.join(', ') : null;
}

function stripBodyContentHeaders(headers: string): string {
  return headers
    .split(/\r?\n/)
    .filter((line) => !/^content-type:/i.test(line) && !/^content-transfer-encoding:/i.test(line) && !/^mime-version:/i.test(line))
    .join('\r\n');
}

function sanitizeHeaderValue(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim();
}

function crlf(value: string): string {
  return value.replace(/\r?\n/g, '\r\n');
}

function formatServerRawEmlAppendix(row: EmailMessageRawHeadersRow, source: 'original' | 'reconstructed'): string {
  const lines: string[] = [
    '',
    '--- SimpleCRM (Zusatz, nicht Teil der Original-RFC822-Nachricht) ---',
    `Quelle: ${source === 'original' ? 'Original-Rohmail vom Sync' : 'Server-Rekonstruktion aus DB'}`,
    `Lokale Nachrichten-ID: ${row.id}`,
    `Account-ID: ${row.account_id ?? ''}`,
    `Ordner-ID: ${row.folder_id ?? ''}`,
    `IMAP/POP3 UID: ${row.uid}`,
  ];
  if (row.pop3_uidl) lines.push(`POP3 UIDL: ${row.pop3_uidl}`);
  if (source === 'reconstructed') {
    lines.push('Hinweis: Server-Rekonstruktion bettet keine lokalen Attachment-Dateien ein.');
  }
  if (row.auth_spf || row.auth_dkim || row.auth_dmarc) {
    lines.push(`Auth: SPF=${row.auth_spf ?? '-'} DKIM=${row.auth_dkim ?? '-'} DMARC=${row.auth_dmarc ?? '-'}`);
  }
  return lines.join('\r\n');
}

function mapEmailAttachmentRow(
  row: Pick<EmailAttachmentRow, typeof emailAttachmentSelectColumns[number]>,
): EmailAttachmentRecord {
  return {
    id: Number(row.id),
    sourceSqliteId: Number(row.source_sqlite_id),
    messageSourceSqliteId: Number(row.message_source_sqlite_id),
    messageId: row.message_id === null ? null : Number(row.message_id),
    filename: row.filename_display,
    contentType: row.content_type,
    sizeBytes: row.size_bytes,
    contentSha256: row.content_sha256,
    storagePath: row.storage_path,
    updatedAt: timestampToIso(row.updated_at),
  };
}

function timestampToIsoOrNull(value: Date | string | null): string | null {
  return value === null ? null : timestampToIso(value);
}

function timestampToIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function isFileMissingError(err: unknown): boolean {
  return typeof err === 'object'
    && err !== null
    && 'code' in err
    && (err as { code?: unknown }).code === 'ENOENT';
}
