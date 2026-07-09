import {
  collectRelatedIds,
  extractTicketFromSubject,
  generateTicketCode,
  normalizeMessageId,
} from '@simplecrm/core';
import { randomBytes } from 'crypto';

import type { Kysely, RawBuilder, Selectable, Updateable } from 'kysely';

import type {
  EmailAccountMailSettingsApiPort,
  EmailAccountMailSettingsMutationInput,
  EmailAccountMailSettingsRecord,
  EmailAccountSignatureApiPort,
  EmailAccountSignatureListResult,
  EmailAccountSignatureMutationInput,
  EmailAccountSignatureMutationPortResult,
  EmailAccountSignatureRecord,
  EmailCannedResponseApiPort,
  EmailCannedResponseListResult,
  EmailCannedResponseMutationInput,
  EmailCannedResponseRecord,
  EmailCategoryApiPort,
  EmailCategoryListResult,
  EmailCategoryMutationInput,
  EmailCategoryMutationPortResult,
  EmailCategoryCountRecord,
  EmailCategoryRecord,
  EmailCategoryReorderPortResult,
  EmailFolderApiPort,
  EmailFolderListResult,
  EmailFolderRecord,
  EmailInternalNoteApiPort,
  EmailInternalNoteListResult,
  EmailInternalNoteMutationInput,
  EmailInternalNoteMutationPortResult,
  EmailInternalNoteRecord,
  EmailMessageCategoryApiPort,
  EmailMessageCategoryListResult,
  EmailMessageCategoryMutationInput,
  EmailMessageCategoryMutationPortResult,
  EmailMessageCategoryRecord,
  EmailMessageTagApiPort,
  EmailMessageTagListResult,
  EmailMessageTagMutationInput,
  EmailMessageTagMutationPortResult,
  EmailMessageTagRecord,
  EmailNumericCursorListResult,
  EmailReadReceiptApiPort,
  EmailReadReceiptListResult,
  EmailReadReceiptMutationInput,
  EmailReadReceiptMutationPortResult,
  EmailReadReceiptRecord,
  EmailRemoteContentAllowlistApiPort,
  EmailRemoteContentAllowlistListResult,
  EmailRemoteContentAllowlistMutationInput,
  EmailRemoteContentAllowlistMutationPortResult,
  EmailRemoteContentAllowlistRecord,
  EmailStringCursorListResult,
  EmailTeamMemberApiPort,
  EmailTeamMemberListResult,
  EmailTeamMemberMutationInput,
  EmailTeamMemberMutationPortResult,
  EmailTeamMemberRecord,
  EmailThreadAliasApiPort,
  EmailThreadAliasListResult,
  EmailThreadMergePortResult,
  EmailThreadAliasMutationInput,
  EmailThreadAliasMutationPortResult,
  EmailThreadAliasRecord,
  EmailThreadAliasWarningRecord,
  EmailThreadApiPort,
  EmailThreadEdgeApiPort,
  EmailThreadEdgeListResult,
  EmailThreadEdgeMutationInput,
  EmailThreadEdgeMutationPortResult,
  EmailThreadEdgeRecord,
  EmailThreadListResult,
  EmailThreadRecord,
  EmailThreadSplitMessagePortResult,
} from '../api/types';
import { buildDefaultServerAccountMailSettings } from '../account-mail-settings-defaults';
import { listWorkspaceTicketPrefixes } from '../mail-ticket-prefixes';
import type {
  EmailAccountMailSettingsTable,
  EmailAccountSignaturesTable,
  EmailCannedResponsesTable,
  EmailCategoriesTable,
  EmailFoldersTable,
  EmailInternalNotesTable,
  EmailMessageCategoriesTable,
  EmailMessageTagsTable,
  EmailReadReceiptLogTable,
  EmailRemoteContentAllowlistTable,
  EmailTeamMembersTable,
  EmailThreadAliasesTable,
  EmailThreadEdgesTable,
  EmailThreadsTable,
  ServerDatabase,
} from './schema';
import {
  withWorkspaceTransaction,
  type WorkspaceSessionApplier,
  type WorkspaceTransaction,
} from './workspace-context';
import {
  resolveEmailAccountReference,
  type EmailAccountReference,
} from './resolve-email-account-reference';

export type PostgresMailMetadataReadPortOptions = Readonly<{
  db: Kysely<ServerDatabase>;
  applyWorkspaceSession?: WorkspaceSessionApplier;
}>;

type EmailAccountMailSettingsRow = Selectable<EmailAccountMailSettingsTable>;
type EmailAccountSignatureRow = Selectable<EmailAccountSignaturesTable>;
type EmailCannedResponseRow = Selectable<EmailCannedResponsesTable>;
type EmailCategoryRow = Selectable<EmailCategoriesTable>;
type EmailFolderRow = Selectable<EmailFoldersTable>;
type EmailInternalNoteRow = Selectable<EmailInternalNotesTable>;
type EmailMessageCategoryRow = Selectable<EmailMessageCategoriesTable>;
type EmailMessageTagRow = Selectable<EmailMessageTagsTable>;
type EmailReadReceiptRow = Selectable<EmailReadReceiptLogTable>;
type EmailRemoteContentAllowlistRow = Selectable<EmailRemoteContentAllowlistTable>;
type EmailTeamMemberRow = Selectable<EmailTeamMembersTable>;
type EmailThreadAliasRow = Selectable<EmailThreadAliasesTable>;
type EmailThreadEdgeRow = Selectable<EmailThreadEdgesTable>;
type EmailThreadRow = Selectable<EmailThreadsTable>;

type EmailCategoryCountRow = {
  category_id: number | string | bigint | null;
  count: number | string | bigint | null;
};
type EmailMessageReference = Readonly<{
  id: number;
  sourceSqliteId: number;
}>;
type EmailCategoryReference = Readonly<{
  id: number;
  sourceSqliteId: number;
  parentId: number | null;
}>;

const emailFolderSelectColumns = [
  'id',
  'source_sqlite_id',
  'account_source_sqlite_id',
  'account_id',
  'path',
  'delimiter',
  'uidvalidity',
  'uidvalidity_str',
  'last_uid',
  'last_synced_at',
  'pop3_uidl_str',
  'updated_at',
] as const;

const emailAccountMailSettingsSelectColumns = [
  'account_id',
  'ticket_prefix',
  'ticket_next_number',
  'ticket_number_padding',
  'thread_namespace',
  'updated_at',
] as const;

const emailTeamMemberSelectColumns = [
  'id',
  'display_name',
  'role',
  'signature_html',
  'sort_order',
  'created_at',
  'updated_at',
] as const;

const emailThreadSelectColumns = [
  'id',
  'ticket_code',
  'account_source_sqlite_id',
  'account_id',
  'root_message_source_sqlite_id',
  'root_message_id',
  'last_message_at',
  'message_count',
  'has_unread',
  'has_attachments',
  'subject_normalized',
  'created_at',
  'updated_at',
] as const;

const emailMessageTagSelectColumns = [
  'id',
  'source_sqlite_id',
  'message_source_sqlite_id',
  'message_id',
  'tag',
  'created_at',
  'updated_at',
] as const;

const emailCategorySelectColumns = [
  'id',
  'source_sqlite_id',
  'parent_source_sqlite_id',
  'parent_id',
  'name',
  'sort_order',
  'created_at',
  'updated_at',
] as const;

const emailMessageCategorySelectColumns = [
  'id',
  'source_sqlite_id',
  'message_source_sqlite_id',
  'category_source_sqlite_id',
  'message_id',
  'category_id',
  'updated_at',
] as const;

const emailInternalNoteSelectColumns = [
  'id',
  'source_sqlite_id',
  'message_source_sqlite_id',
  'message_id',
  'body',
  'created_at',
  'updated_at',
] as const;

const emailCannedResponseSelectColumns = [
  'id',
  'source_sqlite_id',
  'title',
  'body',
  'account_source_sqlite_id',
  'account_id',
  'override_key',
  'sort_order',
  'created_at',
  'updated_at',
] as const;

const emailAccountSignatureSelectColumns = [
  'source_sqlite_id',
  'account_source_sqlite_id',
  'account_id',
  'signature_html',
  'updated_at',
] as const;

const emailRemoteContentAllowlistSelectColumns = [
  'id',
  'source_sqlite_id',
  'scope',
  'value',
  'created_at',
  'updated_at',
] as const;

const emailReadReceiptSelectColumns = [
  'id',
  'source_sqlite_id',
  'message_source_sqlite_id',
  'message_id',
  'direction',
  'recipient',
  'at',
  'updated_at',
] as const;

const emailThreadEdgeSelectColumns = [
  'id',
  'source_sqlite_id',
  'parent_message_source_sqlite_id',
  'child_message_source_sqlite_id',
  'parent_message_id',
  'child_message_id',
  'updated_at',
] as const;

const emailThreadAliasSelectColumns = [
  'id',
  'source_sqlite_id',
  'account_source_sqlite_id',
  'account_id',
  'alias_thread_id',
  'canonical_thread_id',
  'confidence',
  'source',
  'created_at',
  'updated_at',
] as const;

export function createPostgresEmailFolderReadPort(options: PostgresMailMetadataReadPortOptions): EmailFolderApiPort {
  return {
    async list(input): Promise<EmailFolderListResult> {
      const limit = normalizeLimit(input.limit, 'email folder');
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          let query = trx
            .selectFrom('email_folders')
            .select(emailFolderSelectColumns)
            .where('workspace_id', '=', input.workspaceId)
            .orderBy('id', 'asc')
            .limit(limit + 1);

          if (input.cursor !== undefined) query = query.where('id', '>', input.cursor);
          if (input.accountId !== undefined) query = query.where('account_id', '=', input.accountId);
          const search = input.search?.trim();
          if (search) query = query.where('path', 'ilike', `%${search}%`);

          const rows = await query.execute();
          return pageNumeric(rows, limit, (row) => Number(row.id), mapEmailFolderRow);
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async get(input): Promise<EmailFolderRecord | null> {
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          const row = await trx
            .selectFrom('email_folders')
            .select(emailFolderSelectColumns)
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.id)
            .executeTakeFirst();
          return row ? mapEmailFolderRow(row) : null;
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
  };
}

export function createPostgresEmailTeamMemberReadPort(options: PostgresMailMetadataReadPortOptions): EmailTeamMemberApiPort {
  return {
    async list(input): Promise<EmailTeamMemberListResult> {
      const limit = normalizeLimit(input.limit, 'email team member');
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          let query = trx
            .selectFrom('email_team_members')
            .select(emailTeamMemberSelectColumns)
            .where('workspace_id', '=', input.workspaceId)
            .orderBy('id', 'asc')
            .limit(limit + 1);

          if (input.cursor !== undefined) query = query.where('id', '>', input.cursor);
          if (input.role !== undefined) query = query.where('role', '=', input.role);
          const search = input.search?.trim();
          if (search) {
            const pattern = `%${search}%`;
            query = query.where((eb) => eb.or([
              eb('id', 'ilike', pattern),
              eb('display_name', 'ilike', pattern),
            ]));
          }

          const rows = await query.execute();
          return pageString(rows, limit, (row) => row.id, mapEmailTeamMemberRow);
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async get(input): Promise<EmailTeamMemberRecord | null> {
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          const row = await trx
            .selectFrom('email_team_members')
            .select(emailTeamMemberSelectColumns)
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.id)
            .executeTakeFirst();
          return row ? mapEmailTeamMemberRow(row) : null;
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async create(input): Promise<EmailTeamMemberMutationPortResult> {
      const values = normalizeEmailTeamMemberMutation(input.values, {
        requireId: true,
        requireDisplayName: true,
      });
      return withWorkspaceTransaction(
        options.db,
        {
          workspaceId: input.workspaceId,
          userId: input.actorUserId,
          role: 'user',
        },
        async (trx) => {
          const existing = await trx
            .selectFrom('email_team_members')
            .select('id')
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', values.id as string)
            .executeTakeFirst();
          if (existing) return { ok: false, code: 'team_member_conflict' };

          const now = new Date();
          const row = await trx
            .insertInto('email_team_members')
            .values({
              workspace_id: input.workspaceId,
              id: values.id as string,
              display_name: values.displayName as string,
              role: values.role ?? 'agent',
              signature_html: values.signatureHtml ?? null,
              sort_order: values.sortOrder ?? 0,
              source_row: serverApiSourceRow(),
              created_at: now,
              updated_at: now,
            })
            .returning(emailTeamMemberSelectColumns)
            .executeTakeFirstOrThrow();
          return { ok: true, member: mapEmailTeamMemberRow(row) };
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async update(input): Promise<EmailTeamMemberRecord | null> {
      const values = normalizeEmailTeamMemberMutation(input.values, {
        requireId: false,
        requireDisplayName: false,
      });
      return withWorkspaceTransaction(
        options.db,
        {
          workspaceId: input.workspaceId,
          userId: input.actorUserId,
          role: 'user',
        },
        async (trx) => {
          const row = await trx
            .updateTable('email_team_members')
            .set({
              ...mutationToEmailTeamMemberPatch(values),
              updated_at: new Date(),
            })
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.id)
            .returning(emailTeamMemberSelectColumns)
            .executeTakeFirst();
          return row ? mapEmailTeamMemberRow(row) : null;
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async delete(input): Promise<EmailTeamMemberRecord | null> {
      return withWorkspaceTransaction(
        options.db,
        {
          workspaceId: input.workspaceId,
          userId: input.actorUserId,
          role: 'user',
        },
        async (trx) => {
          const row = await trx
            .deleteFrom('email_team_members')
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.id)
            .returning(emailTeamMemberSelectColumns)
            .executeTakeFirst();
          return row ? mapEmailTeamMemberRow(row) : null;
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
  };
}

export function createPostgresEmailThreadReadPort(options: PostgresMailMetadataReadPortOptions): EmailThreadApiPort {
  return {
    async list(input): Promise<EmailThreadListResult> {
      const limit = normalizeLimit(input.limit, 'email thread');
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          let query = trx
            .selectFrom('email_threads')
            .select(emailThreadSelectColumns)
            .where('workspace_id', '=', input.workspaceId)
            .orderBy('id', 'asc')
            .limit(limit + 1);

          if (input.cursor !== undefined) query = query.where('id', '>', input.cursor);
          if (input.offset !== undefined) query = query.offset(input.offset);
          if (input.hasUnread !== undefined) query = query.where('has_unread', '=', input.hasUnread);
          if (input.hasAttachments !== undefined) query = query.where('has_attachments', '=', input.hasAttachments);
          if (input.accountId !== undefined || input.view !== undefined) {
            query = query.where(threadMessageExistsPredicate(input.workspaceId, input.accountId, input.view));
          }
          const search = input.search?.trim();
          if (search) {
            const pattern = `%${search}%`;
            query = query.where((eb) => eb.or([
              eb('id', 'ilike', pattern),
              eb('ticket_code', 'ilike', pattern),
              eb('subject_normalized', 'ilike', pattern),
            ]));
          }

          const rows = await query.execute();
          return pageString(rows, limit, (row) => row.id, mapEmailThreadRow);
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async get(input): Promise<EmailThreadRecord | null> {
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          const row = await trx
            .selectFrom('email_threads')
            .select(emailThreadSelectColumns)
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.id)
            .executeTakeFirst();
          return row ? mapEmailThreadRow(row) : null;
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async splitMessage(input): Promise<EmailThreadSplitMessagePortResult> {
      if (!Number.isSafeInteger(input.messageId) || input.messageId <= 0) {
        return { ok: false, code: 'message_not_found' };
      }
      return withWorkspaceTransaction(
        options.db,
        {
          workspaceId: input.workspaceId,
          userId: input.actorUserId,
          role: 'user',
        },
        async (trx) => {
          const message = await trx
            .selectFrom('email_messages')
            .select(['id', 'thread_id as previousThreadId'])
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.messageId)
            .executeTakeFirst();
          if (!message) return { ok: false, code: 'message_not_found' };

          const now = new Date();
          const ticketCode = generateTicketCode();
          const threadId = await getOrCreateThreadForTicket(trx, input.workspaceId, ticketCode, now);
          await trx
            .updateTable('email_messages')
            .set({
              thread_id: threadId,
              ticket_code: ticketCode,
              updated_at: now,
            })
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.messageId)
            .executeTakeFirst();

          await rebuildThreadEdgesForCanonicalThread(trx, input.workspaceId, threadId);
          await upsertThreadAggregateForCanonicalThread(trx, input.workspaceId, threadId, now);

          const previousRawThreadId = message.previousThreadId?.trim() || null;
          const previousThreadId = previousRawThreadId
            ? await resolveCanonicalThreadId(trx, input.workspaceId, previousRawThreadId)
            : null;
          if (previousThreadId && previousThreadId !== threadId) {
            await upsertThreadAggregateForCanonicalThread(trx, input.workspaceId, previousThreadId, now);
          }

          const threadRow = await trx
            .selectFrom('email_threads')
            .select(emailThreadSelectColumns)
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', threadId)
            .executeTakeFirstOrThrow();
          const thread = mapEmailThreadRow(threadRow);
          return {
            ok: true,
            threadId,
            ticketCode,
            previousThreadId,
            thread,
          };
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
  };
}

function threadMessageExistsPredicate(
  workspaceId: string,
  accountId: number | undefined,
  view: Parameters<EmailThreadApiPort['list']>[0]['view'],
): RawBuilder<boolean> {
  const { sql: kyselySql } = require('kysely') as typeof import('kysely');
  const accountPredicate = accountId === undefined
    ? kyselySql<boolean>`true`
    : kyselySql<boolean>`m.account_id = ${accountId}`;
  return kyselySql<boolean>`exists (
    select 1
    from email_messages m
    where m.workspace_id = ${workspaceId}::uuid
      and m.thread_id = email_threads.id
      and ${accountPredicate}
      and ${threadMessageViewPredicate(view)}
  )`;
}

function threadMessageViewPredicate(
  view: Parameters<EmailThreadApiPort['list']>[0]['view'],
): RawBuilder<boolean> {
  const { sql: kyselySql } = require('kysely') as typeof import('kysely');
  const nonDraftMail = kyselySql<boolean>`(m.uid >= 0 OR m.pop3_uidl IS NOT NULL)`;
  const activeSnooze = kyselySql<boolean>`(m.snoozed_until IS NOT NULL AND m.snoozed_until > now())`;
  const inactiveSnooze = kyselySql<boolean>`(m.snoozed_until IS NULL OR m.snoozed_until <= now())`;
  if (view === undefined || view === 'all') return kyselySql<boolean>`true`;
  if (view === 'trash') return kyselySql<boolean>`m.soft_deleted = true`;
  if (view === 'snoozed') return kyselySql<boolean>`m.soft_deleted = false AND ${activeSnooze}`;
  if (view === 'inbox') {
    return kyselySql<boolean>`m.soft_deleted = false AND ${inactiveSnooze} AND (
      ((${nonDraftMail}) AND (m.folder_kind = 'inbox' OR m.folder_kind IS NULL OR m.folder_kind = '') AND m.archived = false AND m.is_spam = false AND coalesce(m.spam_status, 'clean') = 'clean')
      OR (m.uid < 0 AND m.folder_kind = 'draft' AND m.outbound_hold = true AND m.scheduled_send_at IS NULL)
    )`;
  }
  if (view === 'sent') {
    return kyselySql<boolean>`m.soft_deleted = false AND ${inactiveSnooze} AND m.folder_kind = 'sent' AND m.is_spam = false`;
  }
  if (view === 'archived') {
    return kyselySql<boolean>`m.soft_deleted = false AND ${inactiveSnooze} AND ${nonDraftMail} AND m.archived = true AND m.is_spam = false AND coalesce(m.spam_status, 'clean') = 'clean'`;
  }
  if (view === 'drafts') {
    return kyselySql<boolean>`m.soft_deleted = false AND ${inactiveSnooze} AND m.folder_kind = 'draft' AND m.scheduled_send_at IS NULL`;
  }
  if (view === 'scheduled_send') {
    return kyselySql<boolean>`m.soft_deleted = false AND ${inactiveSnooze} AND m.folder_kind = 'draft' AND m.scheduled_send_at IS NOT NULL`;
  }
  if (view === 'spam_review') {
    return kyselySql<boolean>`m.soft_deleted = false AND ${inactiveSnooze} AND ${nonDraftMail} AND coalesce(m.spam_status, 'clean') = 'review'`;
  }
  if (view === 'spam') {
    return kyselySql<boolean>`m.soft_deleted = false AND ${inactiveSnooze} AND ${nonDraftMail} AND (m.is_spam = true OR coalesce(m.spam_status, 'clean') = 'spam')`;
  }
  return kyselySql<boolean>`m.soft_deleted = false AND ${inactiveSnooze} AND ${nonDraftMail}`;
}

export function createPostgresEmailMessageTagReadPort(options: PostgresMailMetadataReadPortOptions): EmailMessageTagApiPort {
  return {
    async list(input): Promise<EmailMessageTagListResult> {
      const limit = normalizeLimit(input.limit, 'email message tag');
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          let query = trx
            .selectFrom('email_message_tags')
            .select(emailMessageTagSelectColumns)
            .where('workspace_id', '=', input.workspaceId)
            .orderBy('id', 'asc')
            .limit(limit + 1);

          if (input.cursor !== undefined) query = query.where('id', '>', input.cursor);
          if (input.messageId !== undefined) query = query.where('message_id', '=', input.messageId);
          if (input.tag !== undefined) query = query.where('tag', '=', input.tag);
          const search = input.search?.trim();
          if (search) query = query.where('tag', 'ilike', `%${search}%`);

          const rows = await query.execute();
          return pageNumeric(rows, limit, (row) => Number(row.id), mapEmailMessageTagRow);
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async get(input): Promise<EmailMessageTagRecord | null> {
      return getNumericById(options, 'email_message_tags', emailMessageTagSelectColumns, input, mapEmailMessageTagRow);
    },
    async create(input): Promise<EmailMessageTagMutationPortResult> {
      const values = normalizeEmailMessageTagMutation(input.values);
      return withWorkspaceTransaction(
        options.db,
        {
          workspaceId: input.workspaceId,
          userId: input.actorUserId,
          role: 'user',
        },
        async (trx) => {
          const message = await resolveEmailMessageReference(trx, input.workspaceId, values.messageId as number);
          if (!message) return { ok: false, code: 'message_not_found' };

          const existing = await trx
            .selectFrom('email_message_tags')
            .select('id')
            .where('workspace_id', '=', input.workspaceId)
            .where('message_source_sqlite_id', '=', message.sourceSqliteId)
            .where('tag', '=', values.tag as string)
            .executeTakeFirst();
          if (existing) return { ok: false, code: 'tag_conflict' };

          const now = new Date();
          const row = await trx
            .insertInto('email_message_tags')
            .values({
              workspace_id: input.workspaceId,
              source_sqlite_id: serverCreatedEmailMessageTagSourceSqliteId(),
              message_source_sqlite_id: message.sourceSqliteId,
              message_id: message.id,
              tag: values.tag as string,
              source_row: serverApiSourceRow(),
              created_at: now,
              updated_at: now,
            })
            .returning(emailMessageTagSelectColumns)
            .executeTakeFirstOrThrow();
          return { ok: true, tag: mapEmailMessageTagRow(row) };
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async delete(input): Promise<EmailMessageTagRecord | null> {
      return withWorkspaceTransaction(
        options.db,
        {
          workspaceId: input.workspaceId,
          userId: input.actorUserId,
          role: 'user',
        },
        async (trx) => {
          const row = await trx
            .deleteFrom('email_message_tags')
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.id)
            .returning(emailMessageTagSelectColumns)
            .executeTakeFirst();
          return row ? mapEmailMessageTagRow(row) : null;
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
  };
}

export function createPostgresEmailCategoryReadPort(options: PostgresMailMetadataReadPortOptions): EmailCategoryApiPort {
  return {
    async list(input): Promise<EmailCategoryListResult> {
      const limit = normalizeLimit(input.limit, 'email category');
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          let query = trx
            .selectFrom('email_categories')
            .select(emailCategorySelectColumns)
            .where('workspace_id', '=', input.workspaceId)
            .orderBy('id', 'asc')
            .limit(limit + 1);

          if (input.cursor !== undefined) query = query.where('id', '>', input.cursor);
          if (input.parentId !== undefined) query = query.where('parent_id', '=', input.parentId);
          const search = input.search?.trim();
          if (search) query = query.where('name', 'ilike', `%${search}%`);

          const rows = await query.execute();
          return pageNumeric(rows, limit, (row) => Number(row.id), mapEmailCategoryRow);
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async get(input): Promise<EmailCategoryRecord | null> {
      return getNumericById(options, 'email_categories', emailCategorySelectColumns, input, mapEmailCategoryRow);
    },
    async create(input): Promise<EmailCategoryMutationPortResult> {
      const values = normalizeEmailCategoryMutation(input.values, {
        requireName: true,
      });
      return withWorkspaceTransaction(
        options.db,
        {
          workspaceId: input.workspaceId,
          userId: input.actorUserId,
          role: 'user',
        },
        async (trx) => {
          const parent = values.parentId === undefined || values.parentId === null
            ? null
            : await resolveEmailCategoryReference(trx, input.workspaceId, values.parentId);
          if (values.parentId !== undefined && values.parentId !== null && !parent) {
            return { ok: false, code: 'parent_not_found' };
          }

          const now = new Date();
          const row = await trx
            .insertInto('email_categories')
            .values({
              workspace_id: input.workspaceId,
              source_sqlite_id: serverCreatedEmailCategorySourceSqliteId(),
              parent_source_sqlite_id: parent?.sourceSqliteId ?? null,
              parent_id: parent?.id ?? null,
              name: values.name as string,
              sort_order: values.sortOrder ?? 0,
              source_row: serverApiSourceRow(),
              created_at: now,
              updated_at: now,
            })
            .returning(emailCategorySelectColumns)
            .executeTakeFirstOrThrow();
          return { ok: true, category: mapEmailCategoryRow(row) };
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async update(input): Promise<EmailCategoryMutationPortResult | null> {
      const values = normalizeEmailCategoryMutation(input.values, {
        requireName: false,
      });
      return withWorkspaceTransaction(
        options.db,
        {
          workspaceId: input.workspaceId,
          userId: input.actorUserId,
          role: 'user',
        },
        async (trx) => {
          const current = await resolveEmailCategoryReference(trx, input.workspaceId, input.id);
          if (!current) return null;

          let parentPatch: Pick<EmailCategoriesTable, 'parent_id' | 'parent_source_sqlite_id'> | undefined;
          if (values.parentId !== undefined) {
            if (values.parentId === null) {
              parentPatch = { parent_id: null, parent_source_sqlite_id: null };
            } else {
              if (values.parentId === input.id) return { ok: false, code: 'invalid_parent' };
              const parent = await resolveEmailCategoryReference(trx, input.workspaceId, values.parentId);
              if (!parent) return { ok: false, code: 'parent_not_found' };
              const wouldCycle = await wouldCreateEmailCategoryCycle(trx, input.workspaceId, input.id, parent.id);
              if (wouldCycle) return { ok: false, code: 'invalid_parent' };
              parentPatch = {
                parent_id: parent.id,
                parent_source_sqlite_id: parent.sourceSqliteId,
              };
            }
          }

          const now = new Date();
          const row = await trx
            .updateTable('email_categories')
            .set({
              ...mutationToEmailCategoryPatch(values),
              ...parentPatch,
              updated_at: now,
            })
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.id)
            .returning(emailCategorySelectColumns)
            .executeTakeFirst();
          return row ? { ok: true, category: mapEmailCategoryRow(row) } : null;
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async reorder(input): Promise<EmailCategoryReorderPortResult> {
      if (input.updates.length === 0) return { ok: true, categories: [] };
      return withWorkspaceTransaction(
        options.db,
        {
          workspaceId: input.workspaceId,
          userId: input.actorUserId,
          role: 'user',
        },
        async (trx) => {
          const rows = await trx
            .selectFrom('email_categories')
            .select(['id', 'parent_id', 'source_sqlite_id'])
            .where('workspace_id', '=', input.workspaceId)
            .execute();
          const byId = new Map(rows.map((row) => [Number(row.id), {
            id: Number(row.id),
            parentId: row.parent_id === null ? null : Number(row.parent_id),
            sourceSqliteId: Number(row.source_sqlite_id),
          }]));

          const parentById = new Map<number, number | null>();
          for (const row of byId.values()) parentById.set(row.id, row.parentId);

          for (const update of input.updates) {
            if (!byId.has(update.id)) return { ok: false, code: 'category_not_found', id: update.id };
            if (update.parentId !== null && !byId.has(update.parentId)) {
              return { ok: false, code: 'parent_not_found', id: update.parentId };
            }
            parentById.set(update.id, update.parentId);
          }

          for (const update of input.updates) {
            if (emailCategoryParentMapHasCycle(parentById, update.id)) {
              return { ok: false, code: 'invalid_parent', id: update.id };
            }
          }

          const updated: EmailCategoryRecord[] = [];
          const now = new Date();
          for (const update of input.updates) {
            const parent = update.parentId === null ? null : byId.get(update.parentId);
            const row = await trx
              .updateTable('email_categories')
              .set({
                parent_id: parent?.id ?? null,
                parent_source_sqlite_id: parent?.sourceSqliteId ?? null,
                sort_order: update.sortOrder,
                updated_at: now,
              })
              .where('workspace_id', '=', input.workspaceId)
              .where('id', '=', update.id)
              .returning(emailCategorySelectColumns)
              .executeTakeFirstOrThrow();
            updated.push(mapEmailCategoryRow(row));
          }
          return { ok: true, categories: updated };
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async delete(input): Promise<EmailCategoryRecord | null> {
      return withWorkspaceTransaction(
        options.db,
        {
          workspaceId: input.workspaceId,
          userId: input.actorUserId,
          role: 'user',
        },
        async (trx) => {
          const row = await trx
            .deleteFrom('email_categories')
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.id)
            .returning(emailCategorySelectColumns)
            .executeTakeFirst();
          return row ? mapEmailCategoryRow(row) : null;
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
  };
}

export function createPostgresEmailMessageCategoryReadPort(options: PostgresMailMetadataReadPortOptions): EmailMessageCategoryApiPort {
  return {
    async list(input): Promise<EmailMessageCategoryListResult> {
      const limit = normalizeLimit(input.limit, 'email message category');
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          let query = trx
            .selectFrom('email_message_categories')
            .select(emailMessageCategorySelectColumns)
            .where('workspace_id', '=', input.workspaceId)
            .orderBy('id', 'asc')
            .limit(limit + 1);

          if (input.cursor !== undefined) query = query.where('id', '>', input.cursor);
          if (input.messageId !== undefined) query = query.where('message_id', '=', input.messageId);
          if (input.categoryId !== undefined) query = query.where('category_id', '=', input.categoryId);

          const rows = await query.execute();
          return pageNumeric(rows, limit, (row) => Number(row.id), mapEmailMessageCategoryRow);
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async get(input): Promise<EmailMessageCategoryRecord | null> {
      return getNumericById(options, 'email_message_categories', emailMessageCategorySelectColumns, input, mapEmailMessageCategoryRow);
    },
    async listCounts(input): Promise<readonly EmailCategoryCountRecord[]> {
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          const { sql: kyselySql } = require('kysely') as typeof import('kysely');
          let query = trx
            .selectFrom('email_message_categories as mc')
            .innerJoin('email_messages as m', (join) => join
              .onRef('m.id', '=', 'mc.message_id')
              .onRef('m.workspace_id', '=', 'mc.workspace_id'))
            .select([
              'mc.category_id',
              kyselySql<number | string | bigint>`count(distinct mc.message_id)`.as('count'),
            ])
            .where('mc.workspace_id', '=', input.workspaceId)
            .where('m.soft_deleted', '=', false)
            .where((eb) => eb.or([
              eb('m.folder_kind', '=', 'inbox'),
              eb('m.folder_kind', 'is', null),
              eb('m.folder_kind', '=', ''),
            ]))
            .where('m.archived', '=', false)
            .where('m.is_spam', '=', false)
            .where(kyselySql<boolean>`(m.uid >= 0 or m.pop3_uidl is not null)`)
            .where(kyselySql<boolean>`coalesce(m.done_local, false) = false`)
            .where(kyselySql<boolean>`(m.snoozed_until is null or m.snoozed_until <= now())`)
            .groupBy('mc.category_id')
            .orderBy('mc.category_id', 'asc');

          if (input.accountId !== undefined) query = query.where('m.account_id', '=', input.accountId);
          const rows = await query.execute();
          return rows.map(mapEmailCategoryCountRow);
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async create(input): Promise<EmailMessageCategoryMutationPortResult> {
      const values = normalizeEmailMessageCategoryMutation(input.values);
      return withWorkspaceTransaction(
        options.db,
        {
          workspaceId: input.workspaceId,
          userId: input.actorUserId,
          role: 'user',
        },
        async (trx) => {
          const message = await resolveEmailMessageReference(trx, input.workspaceId, values.messageId as number);
          if (!message) return { ok: false, code: 'message_not_found' };
          const category = await resolveEmailCategoryReference(trx, input.workspaceId, values.categoryId as number);
          if (!category) return { ok: false, code: 'category_not_found' };

          const existing = await trx
            .selectFrom('email_message_categories')
            .select('id')
            .where('workspace_id', '=', input.workspaceId)
            .where('message_source_sqlite_id', '=', message.sourceSqliteId)
            .where('category_source_sqlite_id', '=', category.sourceSqliteId)
            .executeTakeFirst();
          if (existing) return { ok: false, code: 'category_conflict' };

          const row = await trx
            .insertInto('email_message_categories')
            .values({
              workspace_id: input.workspaceId,
              source_sqlite_id: serverCreatedEmailMessageCategorySourceSqliteId(),
              message_source_sqlite_id: message.sourceSqliteId,
              category_source_sqlite_id: category.sourceSqliteId,
              message_id: message.id,
              category_id: category.id,
              source_row: serverApiSourceRow(),
              updated_at: new Date(),
            })
            .returning(emailMessageCategorySelectColumns)
            .executeTakeFirstOrThrow();
          return { ok: true, category: mapEmailMessageCategoryRow(row) };
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async delete(input): Promise<EmailMessageCategoryRecord | null> {
      return withWorkspaceTransaction(
        options.db,
        {
          workspaceId: input.workspaceId,
          userId: input.actorUserId,
          role: 'user',
        },
        async (trx) => {
          const row = await trx
            .deleteFrom('email_message_categories')
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.id)
            .returning(emailMessageCategorySelectColumns)
            .executeTakeFirst();
          return row ? mapEmailMessageCategoryRow(row) : null;
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
  };
}

export function createPostgresEmailInternalNoteReadPort(options: PostgresMailMetadataReadPortOptions): EmailInternalNoteApiPort {
  return {
    async list(input): Promise<EmailInternalNoteListResult> {
      const limit = normalizeLimit(input.limit, 'email internal note');
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          let query = trx
            .selectFrom('email_internal_notes')
            .select(emailInternalNoteSelectColumns)
            .where('workspace_id', '=', input.workspaceId)
            .orderBy('id', 'asc')
            .limit(limit + 1);

          if (input.cursor !== undefined) query = query.where('id', '>', input.cursor);
          if (input.messageId !== undefined) query = query.where('message_id', '=', input.messageId);
          const search = input.search?.trim();
          if (search) query = query.where('body', 'ilike', `%${search}%`);

          const rows = await query.execute();
          return pageNumeric(rows, limit, (row) => Number(row.id), mapEmailInternalNoteRow);
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async get(input): Promise<EmailInternalNoteRecord | null> {
      return getNumericById(options, 'email_internal_notes', emailInternalNoteSelectColumns, input, mapEmailInternalNoteRow);
    },
    async create(input): Promise<EmailInternalNoteMutationPortResult> {
      const values = normalizeEmailInternalNoteMutation(input.values, {
        requireMessage: true,
        requireBody: true,
      });
      return withWorkspaceTransaction(
        options.db,
        {
          workspaceId: input.workspaceId,
          userId: input.actorUserId,
          role: 'user',
        },
        async (trx) => {
          const message = await resolveEmailMessageReference(trx, input.workspaceId, values.messageId as number);
          if (!message) return { ok: false, code: 'message_not_found' };

          const now = new Date();
          const row = await trx
            .insertInto('email_internal_notes')
            .values({
              workspace_id: input.workspaceId,
              source_sqlite_id: serverCreatedEmailInternalNoteSourceSqliteId(),
              message_source_sqlite_id: message.sourceSqliteId,
              message_id: message.id,
              body: values.body ?? '',
              source_row: serverApiSourceRow(),
              created_at: now,
              updated_at: now,
            })
            .returning(emailInternalNoteSelectColumns)
            .executeTakeFirstOrThrow();
          return { ok: true, note: mapEmailInternalNoteRow(row) };
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async update(input): Promise<EmailInternalNoteRecord | null> {
      const values = normalizeEmailInternalNoteMutation(input.values, {
        requireMessage: false,
        requireBody: true,
      });
      return withWorkspaceTransaction(
        options.db,
        {
          workspaceId: input.workspaceId,
          userId: input.actorUserId,
          role: 'user',
        },
        async (trx) => {
          const now = new Date();
          const row = await trx
            .updateTable('email_internal_notes')
            .set({
              ...mutationToEmailInternalNotePatch(values),
              updated_at: now,
            })
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.id)
            .returning(emailInternalNoteSelectColumns)
            .executeTakeFirst();
          return row ? mapEmailInternalNoteRow(row) : null;
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async delete(input): Promise<EmailInternalNoteRecord | null> {
      return withWorkspaceTransaction(
        options.db,
        {
          workspaceId: input.workspaceId,
          userId: input.actorUserId,
          role: 'user',
        },
        async (trx) => {
          const row = await trx
            .deleteFrom('email_internal_notes')
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.id)
            .returning(emailInternalNoteSelectColumns)
            .executeTakeFirst();
          return row ? mapEmailInternalNoteRow(row) : null;
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
  };
}

export function createPostgresEmailCannedResponseReadPort(options: PostgresMailMetadataReadPortOptions): EmailCannedResponseApiPort {
  return {
    async list(input): Promise<EmailCannedResponseListResult> {
      const limit = normalizeLimit(input.limit, 'email canned response');
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          let query = trx
            .selectFrom('email_canned_responses')
            .select(emailCannedResponseSelectColumns)
            .where('workspace_id', '=', input.workspaceId)
            .orderBy('id', 'asc')
            .limit(limit + 1);

          if (input.cursor !== undefined) query = query.where('id', '>', input.cursor);
          if (input.accountId === undefined) {
            query = query.where('account_id', 'is', null);
          } else {
            const account = await resolveEmailAccountReference(trx, input.workspaceId, input.accountId);
            if (!account) return { items: [], nextCursor: null };
            query = query.where((eb) => eb.or([
              eb('account_id', 'is', null),
              eb('account_id', '=', account.id),
            ]));
          }
          const search = input.search?.trim();
          if (search) {
            const pattern = `%${search}%`;
            query = query.where((eb) => eb.or([
              eb('title', 'ilike', pattern),
              eb('body', 'ilike', pattern),
            ]));
          }

          const rows = await query.execute();
          return pageNumeric(rows, limit, (row) => Number(row.id), mapEmailCannedResponseRow);
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async get(input): Promise<EmailCannedResponseRecord | null> {
      return getNumericById(options, 'email_canned_responses', emailCannedResponseSelectColumns, input, mapEmailCannedResponseRow);
    },
    async create(input): Promise<EmailCannedResponseRecord> {
      const values = normalizeEmailCannedResponseMutation(input.values, {
        requireTitle: true,
        requireBody: true,
      });
      return withWorkspaceTransaction(
        options.db,
        {
          workspaceId: input.workspaceId,
          userId: input.actorUserId,
          role: 'user',
        },
        async (trx) => {
          const now = new Date();
          const account = values.accountId === undefined || values.accountId === null
            ? null
            : await resolveEmailAccountReference(trx, input.workspaceId, values.accountId);
          if (values.accountId !== undefined && values.accountId !== null && !account) {
            throw new Error('email account not found for canned response');
          }
          const row = await trx
            .insertInto('email_canned_responses')
            .values({
              workspace_id: input.workspaceId,
              source_sqlite_id: serverCreatedEmailCannedResponseSourceSqliteId(),
              title: values.title as string,
              body: values.body as string,
              account_source_sqlite_id: account?.sourceSqliteId ?? null,
              account_id: account?.id ?? null,
              override_key: values.overrideKey ?? null,
              sort_order: values.sortOrder ?? 0,
              source_row: serverApiSourceRow(),
              created_at: now,
              updated_at: now,
            })
            .returning(emailCannedResponseSelectColumns)
            .executeTakeFirstOrThrow();
          return mapEmailCannedResponseRow(row);
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async update(input): Promise<EmailCannedResponseRecord | null> {
      const values = normalizeEmailCannedResponseMutation(input.values, {
        requireTitle: false,
        requireBody: false,
      });
      return withWorkspaceTransaction(
        options.db,
        {
          workspaceId: input.workspaceId,
          userId: input.actorUserId,
          role: 'user',
        },
        async (trx) => {
          const account = values.accountId === undefined
            ? undefined
            : values.accountId === null
              ? null
              : await resolveEmailAccountReference(trx, input.workspaceId, values.accountId);
          if (values.accountId !== undefined && values.accountId !== null && !account) {
            throw new Error('email account not found for canned response');
          }
          const row = await trx
            .updateTable('email_canned_responses')
            .set({
              ...mutationToEmailCannedResponsePatch(values, account),
              updated_at: new Date(),
            })
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.id)
            .returning(emailCannedResponseSelectColumns)
            .executeTakeFirst();
          return row ? mapEmailCannedResponseRow(row) : null;
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async delete(input): Promise<EmailCannedResponseRecord | null> {
      return withWorkspaceTransaction(
        options.db,
        {
          workspaceId: input.workspaceId,
          userId: input.actorUserId,
          role: 'user',
        },
        async (trx) => {
          const row = await trx
            .deleteFrom('email_canned_responses')
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.id)
            .returning(emailCannedResponseSelectColumns)
            .executeTakeFirst();
          return row ? mapEmailCannedResponseRow(row) : null;
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
  };
}


export function createPostgresEmailAccountMailSettingsPort(options: PostgresMailMetadataReadPortOptions): EmailAccountMailSettingsApiPort {
  return {
    async get(input): Promise<EmailAccountMailSettingsRecord | null> {
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          const row = await trx
            .selectFrom('email_account_mail_settings')
            .select(emailAccountMailSettingsSelectColumns)
            .where('workspace_id', '=', input.workspaceId)
            .where((eb) => eb.or([
              eb('account_id', '=', input.accountId),
              eb('account_source_sqlite_id', '=', input.accountId),
            ]))
            .executeTakeFirst();
          return row ? mapEmailAccountMailSettingsRow(row) : null;
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async set(input): Promise<EmailAccountMailSettingsRecord> {
      const values = normalizeEmailAccountMailSettingsMutation(input.values);
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, userId: input.actorUserId, role: 'user' },
        async (trx) => {
          const account = await trx
            .selectFrom('email_accounts')
            .select(['id', 'source_sqlite_id', 'display_name', 'email_address'])
            .where('workspace_id', '=', input.workspaceId)
            .where((eb) => eb.or([
              eb('id', '=', values.accountId),
              eb('source_sqlite_id', '=', values.accountId),
            ]))
            .executeTakeFirstOrThrow();
          const now = new Date();
          const current = await trx
            .selectFrom('email_account_mail_settings')
            .select(emailAccountMailSettingsSelectColumns)
            .where('workspace_id', '=', input.workspaceId)
            .where('account_id', '=', account.id)
            .executeTakeFirst();
          const defaultSettings = buildDefaultServerAccountMailSettings({
            id: Number(account.id),
            displayName: account.display_name,
            emailAddress: account.email_address,
          });
          const next = {
            ticket_prefix: values.ticketPrefix ?? current?.ticket_prefix ?? defaultSettings.ticketPrefix,
            ticket_next_number: values.ticketNextNumber ?? Number(current?.ticket_next_number ?? defaultSettings.ticketNextNumber),
            ticket_number_padding: values.ticketNumberPadding ?? Number(current?.ticket_number_padding ?? defaultSettings.ticketNumberPadding),
            thread_namespace: values.threadNamespace ?? current?.thread_namespace ?? defaultSettings.threadNamespace,
          };
          const conflicting = await trx
            .selectFrom('email_account_mail_settings')
            .select(['account_id', 'ticket_prefix', 'thread_namespace'])
            .where('workspace_id', '=', input.workspaceId)
            .where('account_id', '!=', account.id)
            .where((eb) => eb.or([
              eb('ticket_prefix', '=', next.ticket_prefix),
              eb('thread_namespace', '=', next.thread_namespace),
            ]))
            .executeTakeFirst();
          if (conflicting) {
            if (conflicting.ticket_prefix === next.ticket_prefix) throw new Error('ticketPrefix already used by another account');
            throw new Error('threadNamespace already used by another account');
          }
          const row = await trx
            .insertInto('email_account_mail_settings')
            .values({
              workspace_id: input.workspaceId,
              account_source_sqlite_id: Number(account.source_sqlite_id ?? account.id),
              account_id: account.id,
              ...next,
              source_row: serverApiSourceRow(),
              imported_in_run_id: null,
              created_at: current ? null : now,
              updated_at: now,
            })
            .onConflict((oc) => oc.columns(['workspace_id', 'account_id']).doUpdateSet({
              ...next,
              updated_at: now,
            }))
            .returning(emailAccountMailSettingsSelectColumns)
            .executeTakeFirstOrThrow();
          return mapEmailAccountMailSettingsRow(row);
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
  };
}

function normalizeEmailAccountMailSettingsMutation(values: EmailAccountMailSettingsMutationInput): EmailAccountMailSettingsMutationInput {
  if (!Number.isSafeInteger(values.accountId) || values.accountId <= 0) throw new Error('accountId must be positive');
  return {
    accountId: values.accountId,
    ...(values.ticketPrefix === undefined ? {} : { ticketPrefix: values.ticketPrefix.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12) || 'SCR' }),
    ...(values.ticketNextNumber === undefined ? {} : { ticketNextNumber: Math.max(1, Math.floor(values.ticketNextNumber)) }),
    ...(values.ticketNumberPadding === undefined ? {} : { ticketNumberPadding: Math.min(12, Math.max(1, Math.floor(values.ticketNumberPadding))) }),
    ...(values.threadNamespace === undefined ? {} : { threadNamespace: values.threadNamespace.trim() || `account-${values.accountId}` }),
  };
}

function mapEmailAccountMailSettingsRow(row: Pick<EmailAccountMailSettingsRow, typeof emailAccountMailSettingsSelectColumns[number]>): EmailAccountMailSettingsRecord {
  return {
    accountId: Number(row.account_id),
    ticketPrefix: row.ticket_prefix,
    ticketNextNumber: Number(row.ticket_next_number),
    ticketNumberPadding: Number(row.ticket_number_padding),
    threadNamespace: row.thread_namespace,
    updatedAt: timestampToIsoOrNull(row.updated_at),
  };
}

export function createPostgresEmailAccountSignatureReadPort(options: PostgresMailMetadataReadPortOptions): EmailAccountSignatureApiPort {
  return {
    async list(input): Promise<EmailAccountSignatureListResult> {
      const limit = normalizeLimit(input.limit, 'email account signature');
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          let query = trx
            .selectFrom('email_account_signatures')
            .select(emailAccountSignatureSelectColumns)
            .where('workspace_id', '=', input.workspaceId)
            .orderBy('source_sqlite_id', 'asc')
            .limit(limit + 1);

          if (input.cursor !== undefined) query = query.where('source_sqlite_id', '>', input.cursor);
          if (input.accountId !== undefined) query = query.where('account_id', '=', input.accountId);

          const rows = await query.execute();
          return pageNumeric(rows, limit, (row) => Number(row.source_sqlite_id), mapEmailAccountSignatureRow);
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async get(input): Promise<EmailAccountSignatureRecord | null> {
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          const row = await trx
            .selectFrom('email_account_signatures')
            .select(emailAccountSignatureSelectColumns)
            .where('workspace_id', '=', input.workspaceId)
            .where('source_sqlite_id', '=', input.id)
            .executeTakeFirst();
          return row ? mapEmailAccountSignatureRow(row) : null;
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async create(input): Promise<EmailAccountSignatureMutationPortResult> {
      const values = normalizeEmailAccountSignatureMutation(input.values, {
        requireAccountId: true,
      });
      return withWorkspaceTransaction(
        options.db,
        {
          workspaceId: input.workspaceId,
          userId: input.actorUserId,
          role: 'user',
        },
        async (trx) => {
          const account = await resolveEmailAccountReference(trx, input.workspaceId, values.accountId as number);
          if (!account) return { ok: false, code: 'account_not_found' };
          const existing = await resolveAccountSignatureConflict(trx, input.workspaceId, account.sourceSqliteId);
          if (existing) return { ok: false, code: 'signature_conflict' };

          const row = await trx
            .insertInto('email_account_signatures')
            .values({
              workspace_id: input.workspaceId,
              source_sqlite_id: serverCreatedEmailAccountSignatureSourceSqliteId(),
              account_source_sqlite_id: account.sourceSqliteId,
              account_id: account.id,
              signature_html: values.signatureHtml ?? null,
              source_row: serverApiSourceRow(),
              updated_at: new Date(),
            })
            .returning(emailAccountSignatureSelectColumns)
            .executeTakeFirstOrThrow();
          return { ok: true, signature: mapEmailAccountSignatureRow(row) };
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async update(input): Promise<EmailAccountSignatureMutationPortResult | null> {
      const values = normalizeEmailAccountSignatureMutation(input.values, {
        requireAccountId: false,
      });
      return withWorkspaceTransaction(
        options.db,
        {
          workspaceId: input.workspaceId,
          userId: input.actorUserId,
          role: 'user',
        },
        async (trx) => {
          const current = await trx
            .selectFrom('email_account_signatures')
            .select(emailAccountSignatureSelectColumns)
            .where('workspace_id', '=', input.workspaceId)
            .where('source_sqlite_id', '=', input.id)
            .executeTakeFirst();
          if (!current) return null;

          let accountPatch: Pick<EmailAccountSignaturesTable, 'account_id' | 'account_source_sqlite_id'> | undefined;
          if (values.accountId !== undefined) {
            const account = await resolveEmailAccountReference(trx, input.workspaceId, values.accountId);
            if (!account) return { ok: false, code: 'account_not_found' };
            const conflict = await resolveAccountSignatureConflict(
              trx,
              input.workspaceId,
              account.sourceSqliteId,
              input.id,
            );
            if (conflict) return { ok: false, code: 'signature_conflict' };
            accountPatch = {
              account_id: account.id,
              account_source_sqlite_id: account.sourceSqliteId,
            };
          }

          const row = await trx
            .updateTable('email_account_signatures')
            .set({
              ...mutationToEmailAccountSignaturePatch(values),
              ...accountPatch,
              updated_at: new Date(),
            })
            .where('workspace_id', '=', input.workspaceId)
            .where('source_sqlite_id', '=', input.id)
            .returning(emailAccountSignatureSelectColumns)
            .executeTakeFirstOrThrow();
          return { ok: true, signature: mapEmailAccountSignatureRow(row) };
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async delete(input): Promise<EmailAccountSignatureRecord | null> {
      return withWorkspaceTransaction(
        options.db,
        {
          workspaceId: input.workspaceId,
          userId: input.actorUserId,
          role: 'user',
        },
        async (trx) => {
          const row = await trx
            .deleteFrom('email_account_signatures')
            .where('workspace_id', '=', input.workspaceId)
            .where('source_sqlite_id', '=', input.id)
            .returning(emailAccountSignatureSelectColumns)
            .executeTakeFirst();
          return row ? mapEmailAccountSignatureRow(row) : null;
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
  };
}

export function createPostgresEmailRemoteContentAllowlistReadPort(
  options: PostgresMailMetadataReadPortOptions,
): EmailRemoteContentAllowlistApiPort {
  return {
    async list(input): Promise<EmailRemoteContentAllowlistListResult> {
      const limit = normalizeLimit(input.limit, 'email remote content allowlist');
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          let query = trx
            .selectFrom('email_remote_content_allowlist')
            .select(emailRemoteContentAllowlistSelectColumns)
            .where('workspace_id', '=', input.workspaceId)
            .orderBy('id', 'asc')
            .limit(limit + 1);

          if (input.cursor !== undefined) query = query.where('id', '>', input.cursor);
          if (input.scope !== undefined) query = query.where('scope', '=', input.scope);
          const search = input.search?.trim();
          if (search) {
            const pattern = `%${search}%`;
            query = query.where((eb) => eb.or([
              eb('scope', 'ilike', pattern),
              eb('value', 'ilike', pattern),
            ]));
          }

          const rows = await query.execute();
          return pageNumeric(rows, limit, (row) => Number(row.id), mapEmailRemoteContentAllowlistRow);
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async get(input): Promise<EmailRemoteContentAllowlistRecord | null> {
      return getNumericById(
        options,
        'email_remote_content_allowlist',
        emailRemoteContentAllowlistSelectColumns,
        input,
        mapEmailRemoteContentAllowlistRow,
      );
    },
    async create(input): Promise<EmailRemoteContentAllowlistMutationPortResult> {
      const values = normalizeEmailRemoteContentAllowlistMutation(input.values, {
        requireScope: true,
        requireValue: true,
      });
      return withWorkspaceTransaction(
        options.db,
        {
          workspaceId: input.workspaceId,
          userId: input.actorUserId,
          role: 'user',
        },
        async (trx) => {
          const existing = await resolveRemoteContentAllowlistConflict(
            trx,
            input.workspaceId,
            values.scope as string,
            values.value as string,
          );
          if (existing) return { ok: false, code: 'allowlist_conflict' };

          const now = new Date();
          const row = await trx
            .insertInto('email_remote_content_allowlist')
            .values({
              workspace_id: input.workspaceId,
              source_sqlite_id: serverCreatedEmailRemoteContentAllowlistSourceSqliteId(),
              scope: values.scope as string,
              value: values.value as string,
              source_row: serverApiSourceRow(),
              created_at: now,
              updated_at: now,
            })
            .returning(emailRemoteContentAllowlistSelectColumns)
            .executeTakeFirstOrThrow();
          return { ok: true, entry: mapEmailRemoteContentAllowlistRow(row) };
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async update(input): Promise<EmailRemoteContentAllowlistMutationPortResult | null> {
      const values = normalizeEmailRemoteContentAllowlistMutation(input.values, {
        requireScope: false,
        requireValue: false,
      });
      return withWorkspaceTransaction(
        options.db,
        {
          workspaceId: input.workspaceId,
          userId: input.actorUserId,
          role: 'user',
        },
        async (trx) => {
          const current = await trx
            .selectFrom('email_remote_content_allowlist')
            .select(emailRemoteContentAllowlistSelectColumns)
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.id)
            .executeTakeFirst();
          if (!current) return null;

          const effectiveScope = values.scope ?? current.scope;
          const effectiveValue = values.value ?? current.value;
          const conflict = await resolveRemoteContentAllowlistConflict(
            trx,
            input.workspaceId,
            effectiveScope,
            effectiveValue,
            input.id,
          );
          if (conflict) return { ok: false, code: 'allowlist_conflict' };

          const row = await trx
            .updateTable('email_remote_content_allowlist')
            .set({
              ...mutationToEmailRemoteContentAllowlistPatch(values),
              updated_at: new Date(),
            })
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.id)
            .returning(emailRemoteContentAllowlistSelectColumns)
            .executeTakeFirstOrThrow();
          return { ok: true, entry: mapEmailRemoteContentAllowlistRow(row) };
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async delete(input): Promise<EmailRemoteContentAllowlistRecord | null> {
      return withWorkspaceTransaction(
        options.db,
        {
          workspaceId: input.workspaceId,
          userId: input.actorUserId,
          role: 'user',
        },
        async (trx) => {
          const row = await trx
            .deleteFrom('email_remote_content_allowlist')
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.id)
            .returning(emailRemoteContentAllowlistSelectColumns)
            .executeTakeFirst();
          return row ? mapEmailRemoteContentAllowlistRow(row) : null;
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
  };
}

export function createPostgresEmailReadReceiptReadPort(options: PostgresMailMetadataReadPortOptions): EmailReadReceiptApiPort {
  return {
    async list(input): Promise<EmailReadReceiptListResult> {
      const limit = normalizeLimit(input.limit, 'email read receipt');
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          let query = trx
            .selectFrom('email_read_receipt_log')
            .select(emailReadReceiptSelectColumns)
            .where('workspace_id', '=', input.workspaceId)
            .orderBy('id', 'asc')
            .limit(limit + 1);

          if (input.cursor !== undefined) query = query.where('id', '>', input.cursor);
          if (input.messageId !== undefined) query = query.where('message_id', '=', input.messageId);
          if (input.direction !== undefined) query = query.where('direction', '=', input.direction);

          const rows = await query.execute();
          return pageNumeric(rows, limit, (row) => Number(row.id), mapEmailReadReceiptRow);
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async get(input): Promise<EmailReadReceiptRecord | null> {
      return getNumericById(options, 'email_read_receipt_log', emailReadReceiptSelectColumns, input, mapEmailReadReceiptRow);
    },
    async create(input): Promise<EmailReadReceiptMutationPortResult> {
      const values = normalizeEmailReadReceiptMutation(input.values);
      return withWorkspaceTransaction(
        options.db,
        {
          workspaceId: input.workspaceId,
          userId: input.actorUserId,
          role: 'user',
        },
        async (trx) => {
          const message = await resolveEmailMessageReference(trx, input.workspaceId, values.messageId as number);
          if (!message) return { ok: false, code: 'message_not_found' };

          const now = new Date();
          const row = await trx
            .insertInto('email_read_receipt_log')
            .values({
              workspace_id: input.workspaceId,
              source_sqlite_id: serverCreatedEmailReadReceiptSourceSqliteId(),
              message_source_sqlite_id: message.sourceSqliteId,
              message_id: message.id,
              direction: values.direction as string,
              recipient: values.recipient ?? null,
              at: values.at === undefined ? now : values.at,
              source_row: serverApiSourceRow(),
              updated_at: now,
            })
            .returning(emailReadReceiptSelectColumns)
            .executeTakeFirstOrThrow();
          return { ok: true, receipt: mapEmailReadReceiptRow(row) };
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
  };
}

export function createPostgresEmailThreadEdgeReadPort(options: PostgresMailMetadataReadPortOptions): EmailThreadEdgeApiPort {
  return {
    async list(input): Promise<EmailThreadEdgeListResult> {
      const limit = normalizeLimit(input.limit, 'email thread edge');
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          let query = trx
            .selectFrom('email_thread_edges')
            .select(emailThreadEdgeSelectColumns)
            .where('workspace_id', '=', input.workspaceId)
            .orderBy('id', 'asc')
            .limit(limit + 1);

          if (input.cursor !== undefined) query = query.where('id', '>', input.cursor);
          if (input.parentMessageId !== undefined) query = query.where('parent_message_id', '=', input.parentMessageId);
          if (input.childMessageId !== undefined) query = query.where('child_message_id', '=', input.childMessageId);

          const rows = await query.execute();
          return pageNumeric(rows, limit, (row) => Number(row.id), mapEmailThreadEdgeRow);
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async get(input): Promise<EmailThreadEdgeRecord | null> {
      return getNumericById(options, 'email_thread_edges', emailThreadEdgeSelectColumns, input, mapEmailThreadEdgeRow);
    },
    async create(input): Promise<EmailThreadEdgeMutationPortResult> {
      const values = normalizeEmailThreadEdgeMutation(input.values);
      return withWorkspaceTransaction(
        options.db,
        {
          workspaceId: input.workspaceId,
          userId: input.actorUserId,
          role: 'user',
        },
        async (trx) => {
          if (values.parentMessageId === values.childMessageId) return { ok: false, code: 'invalid_edge' };
          const parent = await resolveEmailMessageReference(trx, input.workspaceId, values.parentMessageId as number);
          if (!parent) return { ok: false, code: 'parent_message_not_found' };
          const child = await resolveEmailMessageReference(trx, input.workspaceId, values.childMessageId as number);
          if (!child) return { ok: false, code: 'child_message_not_found' };
          const existing = await trx
            .selectFrom('email_thread_edges')
            .select('id')
            .where('workspace_id', '=', input.workspaceId)
            .where('parent_message_source_sqlite_id', '=', parent.sourceSqliteId)
            .where('child_message_source_sqlite_id', '=', child.sourceSqliteId)
            .executeTakeFirst();
          if (existing) return { ok: false, code: 'edge_conflict' };

          const row = await trx
            .insertInto('email_thread_edges')
            .values({
              workspace_id: input.workspaceId,
              source_sqlite_id: serverCreatedEmailThreadEdgeSourceSqliteId(),
              parent_message_source_sqlite_id: parent.sourceSqliteId,
              child_message_source_sqlite_id: child.sourceSqliteId,
              parent_message_id: parent.id,
              child_message_id: child.id,
              source_row: serverApiSourceRow(),
              updated_at: new Date(),
            })
            .returning(emailThreadEdgeSelectColumns)
            .executeTakeFirstOrThrow();
          return { ok: true, edge: mapEmailThreadEdgeRow(row) };
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async delete(input): Promise<EmailThreadEdgeRecord | null> {
      return withWorkspaceTransaction(
        options.db,
        {
          workspaceId: input.workspaceId,
          userId: input.actorUserId,
          role: 'user',
        },
        async (trx) => {
          const row = await trx
            .deleteFrom('email_thread_edges')
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.id)
            .returning(emailThreadEdgeSelectColumns)
            .executeTakeFirst();
          return row ? mapEmailThreadEdgeRow(row) : null;
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
  };
}

export function createPostgresEmailThreadAliasReadPort(options: PostgresMailMetadataReadPortOptions): EmailThreadAliasApiPort {
  return {
    async list(input): Promise<EmailThreadAliasListResult> {
      const limit = normalizeLimit(input.limit, 'email thread alias');
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          let query = trx
            .selectFrom('email_thread_aliases')
            .select(emailThreadAliasSelectColumns)
            .where('workspace_id', '=', input.workspaceId)
            .orderBy('id', 'asc')
            .limit(limit + 1);

          if (input.cursor !== undefined) query = query.where('id', '>', input.cursor);
          if (input.aliasThreadId !== undefined) query = query.where('alias_thread_id', '=', input.aliasThreadId);
          if (input.canonicalThreadId !== undefined) query = query.where('canonical_thread_id', '=', input.canonicalThreadId);
          if (input.confidence !== undefined) query = query.where('confidence', '=', input.confidence);
          if (input.source !== undefined) query = query.where('source', '=', input.source);

          const rows = await query.execute();
          return pageNumeric(rows, limit, (row) => Number(row.id), mapEmailThreadAliasRow);
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async get(input): Promise<EmailThreadAliasRecord | null> {
      return getNumericById(options, 'email_thread_aliases', emailThreadAliasSelectColumns, input, mapEmailThreadAliasRow);
    },
    async listWarnings(input): Promise<readonly EmailThreadAliasWarningRecord[]> {
      const limit = normalizeLimit(input.limit ?? 50, 'email thread alias warning');
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          const rows = await trx
            .selectFrom('email_thread_aliases')
            .innerJoin('email_messages', (join) => join
              .onRef('email_messages.workspace_id', '=', 'email_thread_aliases.workspace_id')
              .onRef('email_messages.thread_id', '=', 'email_thread_aliases.alias_thread_id'))
            .select([
              'email_messages.id as messageId',
              'email_messages.account_id as accountId',
              'email_messages.subject as subject',
              'email_thread_aliases.alias_thread_id as aliasThreadId',
              'email_thread_aliases.canonical_thread_id as canonicalThreadId',
              'email_thread_aliases.confidence as confidence',
            ])
            .where('email_thread_aliases.workspace_id', '=', input.workspaceId)
            .where('email_thread_aliases.source', 'like', 'cross_account%')
            .orderBy('email_thread_aliases.created_at', 'desc')
            .orderBy('email_thread_aliases.id', 'desc')
            .limit(limit)
            .execute();
          return rows.map(mapEmailThreadAliasWarningRow);
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async merge(input): Promise<EmailThreadMergePortResult> {
      const aliasThreadId = input.aliasThreadId.trim();
      const canonicalThreadId = input.canonicalThreadId.trim();
      if (!aliasThreadId || !canonicalThreadId || aliasThreadId === canonicalThreadId) {
        return { ok: false, code: 'invalid_alias' };
      }
      if (!Number.isSafeInteger(input.accountId) || input.accountId <= 0) {
        return { ok: false, code: 'account_not_found' };
      }

      return withWorkspaceTransaction(
        options.db,
        {
          workspaceId: input.workspaceId,
          userId: input.actorUserId,
          role: 'user',
        },
        async (trx) => {
          const account = await trx
            .selectFrom('email_accounts')
            .select('id')
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.accountId)
            .executeTakeFirst();
          if (!account) return { ok: false, code: 'account_not_found' };

          const wouldCycle = await wouldCreateThreadAliasCycle(
            trx,
            input.workspaceId,
            aliasThreadId,
            canonicalThreadId,
          );
          if (wouldCycle) return { ok: false, code: 'alias_cycle' };

          const now = new Date();
          const aliasRow = await trx
            .insertInto('email_thread_aliases')
            .values({
              workspace_id: input.workspaceId,
              source_sqlite_id: serverCreatedEmailThreadAliasSourceSqliteId(),
              account_id: input.accountId,
              alias_thread_id: aliasThreadId,
              canonical_thread_id: canonicalThreadId,
              confidence: 'high',
              source: 'manual_merge',
              source_row: serverApiSourceRow(),
              created_at: now,
              updated_at: now,
            })
            .onConflict((oc) => oc
              .columns(['workspace_id', 'account_id', 'alias_thread_id', 'canonical_thread_id'])
              .doUpdateSet({
                confidence: 'high',
                source: 'manual_merge',
                updated_at: now,
              }))
            .returning(emailThreadAliasSelectColumns)
            .executeTakeFirstOrThrow();

          const updateResult = await trx
            .updateTable('email_messages')
            .set({
              thread_id: canonicalThreadId,
              updated_at: now,
            })
            .where('workspace_id', '=', input.workspaceId)
            .where('account_id', '=', input.accountId)
            .where('thread_id', '=', aliasThreadId)
            .executeTakeFirst();
          const movedMessageCount = Number(updateResult.numUpdatedRows ?? 0);

          const orphan = await trx
            .selectFrom('email_messages')
            .select('id')
            .where('workspace_id', '=', input.workspaceId)
            .where('thread_id', '=', aliasThreadId)
            .limit(1)
            .executeTakeFirst();
          let orphanThreadDeleted = false;
          if (!orphan) {
            const deleteResult = await trx
              .deleteFrom('email_threads')
              .where('workspace_id', '=', input.workspaceId)
              .where('id', '=', aliasThreadId)
              .executeTakeFirst();
            orphanThreadDeleted = Number(deleteResult.numDeletedRows ?? 0) > 0;
          }

          await rebuildThreadEdgesForCanonicalThread(trx, input.workspaceId, canonicalThreadId);
          await upsertThreadAggregateForCanonicalThread(trx, input.workspaceId, canonicalThreadId, now);

          return {
            ok: true,
            alias: mapEmailThreadAliasRow(aliasRow),
            movedMessageCount,
            orphanThreadDeleted,
          };
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async create(input): Promise<EmailThreadAliasMutationPortResult> {
      const values = normalizeEmailThreadAliasMutation(input.values, {
        requireAliasThreadId: true,
        requireCanonicalThreadId: true,
      });
      return withWorkspaceTransaction(
        options.db,
        {
          workspaceId: input.workspaceId,
          userId: input.actorUserId,
          role: 'user',
        },
        async (trx) => {
          if (values.aliasThreadId === values.canonicalThreadId) return { ok: false, code: 'invalid_alias' };
          const existing = await resolveThreadAliasConflict(
            trx,
            input.workspaceId,
            values.aliasThreadId as string,
            values.canonicalThreadId as string,
          );
          if (existing) return { ok: false, code: 'alias_conflict' };

          const now = new Date();
          const row = await trx
            .insertInto('email_thread_aliases')
            .values({
              workspace_id: input.workspaceId,
              source_sqlite_id: serverCreatedEmailThreadAliasSourceSqliteId(),
              alias_thread_id: values.aliasThreadId as string,
              canonical_thread_id: values.canonicalThreadId as string,
              confidence: values.confidence ?? 'high',
              source: values.source ?? 'manual',
              source_row: serverApiSourceRow(),
              created_at: now,
              updated_at: now,
            })
            .returning(emailThreadAliasSelectColumns)
            .executeTakeFirstOrThrow();
          return { ok: true, alias: mapEmailThreadAliasRow(row) };
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async update(input): Promise<EmailThreadAliasMutationPortResult | null> {
      const values = normalizeEmailThreadAliasMutation(input.values, {
        requireAliasThreadId: false,
        requireCanonicalThreadId: false,
      });
      return withWorkspaceTransaction(
        options.db,
        {
          workspaceId: input.workspaceId,
          userId: input.actorUserId,
          role: 'user',
        },
        async (trx) => {
          const current = await trx
            .selectFrom('email_thread_aliases')
            .select(emailThreadAliasSelectColumns)
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.id)
            .executeTakeFirst();
          if (!current) return null;

          const effectiveAliasThreadId = values.aliasThreadId ?? current.alias_thread_id;
          const effectiveCanonicalThreadId = values.canonicalThreadId ?? current.canonical_thread_id;
          if (effectiveAliasThreadId === effectiveCanonicalThreadId) return { ok: false, code: 'invalid_alias' };
          const conflict = await resolveThreadAliasConflict(
            trx,
            input.workspaceId,
            effectiveAliasThreadId,
            effectiveCanonicalThreadId,
            input.id,
          );
          if (conflict) return { ok: false, code: 'alias_conflict' };

          const row = await trx
            .updateTable('email_thread_aliases')
            .set({
              ...mutationToEmailThreadAliasPatch(values),
              updated_at: new Date(),
            })
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.id)
            .returning(emailThreadAliasSelectColumns)
            .executeTakeFirstOrThrow();
          return { ok: true, alias: mapEmailThreadAliasRow(row) };
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async delete(input): Promise<EmailThreadAliasRecord | null> {
      return withWorkspaceTransaction(
        options.db,
        {
          workspaceId: input.workspaceId,
          userId: input.actorUserId,
          role: 'user',
        },
        async (trx) => {
          const row = await trx
            .deleteFrom('email_thread_aliases')
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.id)
            .returning(emailThreadAliasSelectColumns)
            .executeTakeFirst();
          return row ? mapEmailThreadAliasRow(row) : null;
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
  };
}

async function getNumericById<TRow, TRecord>(
  options: PostgresMailMetadataReadPortOptions,
  table: keyof ServerDatabase & string,
  columns: readonly string[],
  input: { workspaceId: string; id: number },
  map: (row: TRow) => TRecord,
): Promise<TRecord | null> {
  return withWorkspaceTransaction(
    options.db,
    { workspaceId: input.workspaceId, role: 'system' },
    async (trx) => {
      const row = await trx
        .selectFrom(table as any)
        .select(columns as any)
        .where('workspace_id', '=', input.workspaceId)
        .where('id', '=', input.id)
        .executeTakeFirst();
      return row ? map(row as TRow) : null;
    },
    { applySession: options.applyWorkspaceSession },
  );
}

function pageNumeric<TRow, TRecord>(
  rows: readonly TRow[],
  limit: number,
  cursorValue: (row: TRow) => number,
  map: (row: TRow) => TRecord,
): EmailNumericCursorListResult<TRecord> {
  const pageRows = rows.slice(0, limit);
  return {
    items: pageRows.map(map),
    nextCursor: rows.length > limit ? cursorValue(pageRows[pageRows.length - 1] as TRow) : null,
  };
}

function pageString<TRow, TRecord>(
  rows: readonly TRow[],
  limit: number,
  cursorValue: (row: TRow) => string,
  map: (row: TRow) => TRecord,
): EmailStringCursorListResult<TRecord> {
  const pageRows = rows.slice(0, limit);
  return {
    items: pageRows.map(map),
    nextCursor: rows.length > limit ? cursorValue(pageRows[pageRows.length - 1] as TRow) : null,
  };
}

function normalizeLimit(limit: number, resource: string): number {
  if (!Number.isInteger(limit) || limit <= 0 || limit > 100) {
    throw new Error(`${resource} list limit must be between 1 and 100`);
  }
  return limit;
}

function normalizeEmailTeamMemberMutation(
  values: EmailTeamMemberMutationInput,
  options: {
    requireId: boolean;
    requireDisplayName: boolean;
  },
): EmailTeamMemberMutationInput {
  const normalized = { ...values };
  if (normalized.id !== undefined) {
    normalized.id = normalized.id.trim();
    if (!normalized.id) throw new Error('email team member id must not be empty');
    if (normalized.id.length > 100) throw new Error('email team member id must not exceed 100 characters');
  }
  if (normalized.displayName !== undefined) {
    normalized.displayName = normalized.displayName.trim();
    if (!normalized.displayName) throw new Error('email team member displayName must not be empty');
    if (normalized.displayName.length > 200) throw new Error('email team member displayName must not exceed 200 characters');
  }
  if (normalized.role !== undefined) {
    normalized.role = normalized.role.trim();
    if (!normalized.role) throw new Error('email team member role must not be empty');
    if (normalized.role.length > 50) throw new Error('email team member role must not exceed 50 characters');
  }
  if (normalized.signatureHtml !== undefined && normalized.signatureHtml !== null) {
    normalized.signatureHtml = normalized.signatureHtml.trim();
    if (!normalized.signatureHtml) normalized.signatureHtml = null;
    else if (normalized.signatureHtml.length > 20000) throw new Error('email team member signatureHtml must not exceed 20000 characters');
  }
  if (options.requireId && !normalized.id) throw new Error('email team member id is required');
  if (options.requireDisplayName && !normalized.displayName) throw new Error('email team member displayName is required');
  if (normalized.sortOrder !== undefined && (!Number.isSafeInteger(normalized.sortOrder) || normalized.sortOrder < 0)) {
    throw new Error('email team member sortOrder must be a non-negative integer');
  }
  return normalized;
}

function mutationToEmailTeamMemberPatch(
  values: EmailTeamMemberMutationInput,
): Partial<Updateable<EmailTeamMembersTable>> {
  return {
    ...(values.displayName === undefined ? {} : { display_name: values.displayName }),
    ...(values.role === undefined ? {} : { role: values.role }),
    ...(values.signatureHtml === undefined ? {} : { signature_html: values.signatureHtml }),
    ...(values.sortOrder === undefined ? {} : { sort_order: values.sortOrder }),
  };
}

function normalizeEmailThreadEdgeMutation(values: EmailThreadEdgeMutationInput): EmailThreadEdgeMutationInput {
  const normalized = { ...values };
  if (normalized.parentMessageId === undefined) throw new Error('email thread edge parentMessageId is required');
  if (!Number.isSafeInteger(normalized.parentMessageId) || normalized.parentMessageId <= 0) {
    throw new Error('email thread edge parentMessageId must be a positive integer');
  }
  if (normalized.childMessageId === undefined) throw new Error('email thread edge childMessageId is required');
  if (!Number.isSafeInteger(normalized.childMessageId) || normalized.childMessageId <= 0) {
    throw new Error('email thread edge childMessageId must be a positive integer');
  }
  return normalized;
}

function normalizeEmailThreadAliasMutation(
  values: EmailThreadAliasMutationInput,
  options: {
    requireAliasThreadId: boolean;
    requireCanonicalThreadId: boolean;
  },
): EmailThreadAliasMutationInput {
  const normalized = { ...values };
  if (normalized.aliasThreadId !== undefined) {
    normalized.aliasThreadId = normalized.aliasThreadId.trim();
    if (!normalized.aliasThreadId) throw new Error('email thread alias aliasThreadId must not be empty');
    if (normalized.aliasThreadId.length > 300) throw new Error('email thread alias aliasThreadId must not exceed 300 characters');
  }
  if (normalized.canonicalThreadId !== undefined) {
    normalized.canonicalThreadId = normalized.canonicalThreadId.trim();
    if (!normalized.canonicalThreadId) throw new Error('email thread alias canonicalThreadId must not be empty');
    if (normalized.canonicalThreadId.length > 300) throw new Error('email thread alias canonicalThreadId must not exceed 300 characters');
  }
  if (normalized.confidence !== undefined) {
    normalized.confidence = normalized.confidence.trim();
    if (!normalized.confidence) throw new Error('email thread alias confidence must not be empty');
    if (normalized.confidence.length > 50) throw new Error('email thread alias confidence must not exceed 50 characters');
  }
  if (normalized.source !== undefined) {
    normalized.source = normalized.source.trim();
    if (!normalized.source) throw new Error('email thread alias source must not be empty');
    if (normalized.source.length > 100) throw new Error('email thread alias source must not exceed 100 characters');
  }
  if (options.requireAliasThreadId && !normalized.aliasThreadId) {
    throw new Error('email thread alias aliasThreadId is required');
  }
  if (options.requireCanonicalThreadId && !normalized.canonicalThreadId) {
    throw new Error('email thread alias canonicalThreadId is required');
  }
  return normalized;
}

function mutationToEmailThreadAliasPatch(
  values: EmailThreadAliasMutationInput,
): Partial<Updateable<EmailThreadAliasesTable>> {
  return {
    ...(values.aliasThreadId === undefined ? {} : { alias_thread_id: values.aliasThreadId }),
    ...(values.canonicalThreadId === undefined ? {} : { canonical_thread_id: values.canonicalThreadId }),
    ...(values.confidence === undefined ? {} : { confidence: values.confidence }),
    ...(values.source === undefined ? {} : { source: values.source }),
  };
}

function normalizeEmailAccountSignatureMutation(
  values: EmailAccountSignatureMutationInput,
  options: {
    requireAccountId: boolean;
  },
): EmailAccountSignatureMutationInput {
  const normalized = { ...values };
  if (normalized.accountId !== undefined && (!Number.isSafeInteger(normalized.accountId) || normalized.accountId <= 0)) {
    throw new Error('email account signature accountId must be a positive integer');
  }
  if (options.requireAccountId && normalized.accountId === undefined) {
    throw new Error('email account signature accountId is required');
  }
  if (normalized.signatureHtml !== undefined && normalized.signatureHtml !== null) {
    normalized.signatureHtml = normalized.signatureHtml.trim();
    if (!normalized.signatureHtml) normalized.signatureHtml = null;
    else if (normalized.signatureHtml.length > 20000) {
      throw new Error('email account signature signatureHtml must not exceed 20000 characters');
    }
  }
  return normalized;
}

function mutationToEmailAccountSignaturePatch(
  values: EmailAccountSignatureMutationInput,
): Partial<Updateable<EmailAccountSignaturesTable>> {
  return {
    ...(values.signatureHtml === undefined ? {} : { signature_html: values.signatureHtml }),
  };
}

function normalizeEmailReadReceiptMutation(values: EmailReadReceiptMutationInput): EmailReadReceiptMutationInput {
  const normalized = { ...values };
  if (normalized.messageId === undefined) throw new Error('email read receipt messageId is required');
  if (!Number.isSafeInteger(normalized.messageId) || normalized.messageId <= 0) {
    throw new Error('email read receipt messageId must be a positive integer');
  }
  if (!normalized.direction) throw new Error('email read receipt direction is required');
  normalized.direction = normalized.direction.trim();
  if (!normalized.direction) throw new Error('email read receipt direction must not be empty');
  if (normalized.direction.length > 50) throw new Error('email read receipt direction must not exceed 50 characters');
  if (normalized.recipient !== undefined && normalized.recipient !== null) {
    normalized.recipient = normalized.recipient.trim();
    if (!normalized.recipient) normalized.recipient = null;
    else if (normalized.recipient.length > 300) throw new Error('email read receipt recipient must not exceed 300 characters');
  }
  if (normalized.at !== undefined && normalized.at !== null && Number.isNaN(new Date(normalized.at).getTime())) {
    throw new Error('email read receipt at must be a valid timestamp');
  }
  return normalized;
}

function normalizeEmailMessageTagMutation(values: EmailMessageTagMutationInput): EmailMessageTagMutationInput {
  const normalized = { ...values };
  if (normalized.messageId === undefined) throw new Error('email message tag messageId is required');
  if (!Number.isSafeInteger(normalized.messageId) || normalized.messageId <= 0) {
    throw new Error('email message tag messageId must be a positive integer');
  }
  if (!normalized.tag) throw new Error('email message tag is required');
  normalized.tag = normalized.tag.trim();
  if (!normalized.tag) throw new Error('email message tag must not be empty');
  if (normalized.tag.length > 100) throw new Error('email message tag must not exceed 100 characters');
  return normalized;
}

function normalizeEmailCategoryMutation(
  values: EmailCategoryMutationInput,
  options: {
    requireName: boolean;
  },
): EmailCategoryMutationInput {
  const normalized = { ...values };
  if (normalized.parentId !== undefined && normalized.parentId !== null) {
    if (!Number.isSafeInteger(normalized.parentId) || normalized.parentId <= 0) {
      throw new Error('email category parentId must be a positive integer');
    }
  }
  if (normalized.name !== undefined) {
    normalized.name = normalized.name.trim();
    if (!normalized.name) throw new Error('email category name must not be empty');
    if (normalized.name.length > 200) throw new Error('email category name must not exceed 200 characters');
  }
  if (options.requireName && !normalized.name) throw new Error('email category name is required');
  if (normalized.sortOrder !== undefined && (!Number.isSafeInteger(normalized.sortOrder) || normalized.sortOrder < 0)) {
    throw new Error('email category sortOrder must be a non-negative integer');
  }
  return normalized;
}

function mutationToEmailCategoryPatch(
  values: EmailCategoryMutationInput,
): Partial<Updateable<EmailCategoriesTable>> {
  return {
    ...(values.name === undefined ? {} : { name: values.name }),
    ...(values.sortOrder === undefined ? {} : { sort_order: values.sortOrder }),
  };
}

function normalizeEmailMessageCategoryMutation(
  values: EmailMessageCategoryMutationInput,
): EmailMessageCategoryMutationInput {
  const normalized = { ...values };
  if (normalized.messageId === undefined) throw new Error('email message category messageId is required');
  if (!Number.isSafeInteger(normalized.messageId) || normalized.messageId <= 0) {
    throw new Error('email message category messageId must be a positive integer');
  }
  if (normalized.categoryId === undefined) throw new Error('email message category categoryId is required');
  if (!Number.isSafeInteger(normalized.categoryId) || normalized.categoryId <= 0) {
    throw new Error('email message category categoryId must be a positive integer');
  }
  return normalized;
}

function normalizeEmailCannedResponseMutation(
  values: EmailCannedResponseMutationInput,
  options: {
    requireTitle: boolean;
    requireBody: boolean;
  },
): EmailCannedResponseMutationInput {
  const normalized = { ...values };
  if (normalized.title !== undefined) {
    normalized.title = normalized.title.trim();
    if (!normalized.title) throw new Error('email canned response title must not be empty');
    if (normalized.title.length > 200) throw new Error('email canned response title must not exceed 200 characters');
  }
  if (normalized.body !== undefined) {
    normalized.body = normalized.body.trim();
    if (!normalized.body) throw new Error('email canned response body must not be empty');
    if (normalized.body.length > 20000) throw new Error('email canned response body must not exceed 20000 characters');
  }
  if (options.requireTitle && !normalized.title) throw new Error('email canned response title is required');
  if (options.requireBody && !normalized.body) throw new Error('email canned response body is required');
  if (normalized.sortOrder !== undefined && (!Number.isSafeInteger(normalized.sortOrder) || normalized.sortOrder < 0)) {
    throw new Error('email canned response sortOrder must be a non-negative integer');
  }
  return normalized;
}

function mutationToEmailCannedResponsePatch(
  values: EmailCannedResponseMutationInput,
  account?: EmailAccountReference | null,
): Partial<Updateable<EmailCannedResponsesTable>> {
  return {
    ...(values.title === undefined ? {} : { title: values.title }),
    ...(values.body === undefined ? {} : { body: values.body }),
    ...(values.sortOrder === undefined ? {} : { sort_order: values.sortOrder }),
    ...(values.accountId === undefined
      ? {}
      : {
          account_id: account?.id ?? null,
          account_source_sqlite_id: account?.sourceSqliteId ?? null,
        }),
    ...(values.overrideKey === undefined ? {} : { override_key: values.overrideKey }),
  };
}

function normalizeEmailRemoteContentAllowlistMutation(
  values: EmailRemoteContentAllowlistMutationInput,
  options: {
    requireScope: boolean;
    requireValue: boolean;
  },
): EmailRemoteContentAllowlistMutationInput {
  const normalized = { ...values };
  if (normalized.scope !== undefined) {
    normalized.scope = normalized.scope.trim();
    if (!normalized.scope) throw new Error('email remote content allowlist scope must not be empty');
    if (normalized.scope.length > 50) throw new Error('email remote content allowlist scope must not exceed 50 characters');
  }
  if (normalized.value !== undefined) {
    normalized.value = normalized.value.trim();
    if (!normalized.value) throw new Error('email remote content allowlist value must not be empty');
    if (normalized.value.length > 300) throw new Error('email remote content allowlist value must not exceed 300 characters');
  }
  if (options.requireScope && !normalized.scope) throw new Error('email remote content allowlist scope is required');
  if (options.requireValue && !normalized.value) throw new Error('email remote content allowlist value is required');
  return normalized;
}

function mutationToEmailRemoteContentAllowlistPatch(
  values: EmailRemoteContentAllowlistMutationInput,
): Partial<Updateable<EmailRemoteContentAllowlistTable>> {
  return {
    ...(values.scope === undefined ? {} : { scope: values.scope }),
    ...(values.value === undefined ? {} : { value: values.value }),
  };
}

function normalizeEmailInternalNoteMutation(
  values: EmailInternalNoteMutationInput,
  options: {
    requireMessage: boolean;
    requireBody: boolean;
  },
): EmailInternalNoteMutationInput {
  const normalized = { ...values };
  if (options.requireMessage && normalized.messageId === undefined) {
    throw new Error('email internal note messageId is required');
  }
  if (normalized.messageId !== undefined && (!Number.isSafeInteger(normalized.messageId) || normalized.messageId <= 0)) {
    throw new Error('email internal note messageId must be a positive integer');
  }
  if (options.requireBody && !normalized.body) {
    throw new Error('email internal note body is required');
  }
  if (normalized.body !== undefined && normalized.body.trim() === '') {
    throw new Error('email internal note body must not be empty');
  }
  return normalized;
}

function mutationToEmailInternalNotePatch(
  values: EmailInternalNoteMutationInput,
): Partial<Updateable<EmailInternalNotesTable>> {
  return {
    ...(values.body === undefined ? {} : { body: values.body }),
  };
}

async function resolveEmailMessageReference(
  trx: WorkspaceTransaction,
  workspaceId: string,
  messageId: number,
): Promise<EmailMessageReference | null> {
  const row = await trx
    .selectFrom('email_messages')
    .select(['id', 'source_sqlite_id'])
    .where('workspace_id', '=', workspaceId)
    .where('id', '=', messageId)
    .executeTakeFirst();
  if (!row) return null;
  return {
    id: Number(row.id),
    sourceSqliteId: Number(row.source_sqlite_id),
  };
}

async function resolveEmailCategoryReference(
  trx: WorkspaceTransaction,
  workspaceId: string,
  categoryId: number,
): Promise<EmailCategoryReference | null> {
  const row = await trx
    .selectFrom('email_categories')
    .select(['id', 'source_sqlite_id', 'parent_id'])
    .where('workspace_id', '=', workspaceId)
    .where('id', '=', categoryId)
    .executeTakeFirst();
  if (!row) return null;
  return {
    id: Number(row.id),
    sourceSqliteId: Number(row.source_sqlite_id),
    parentId: row.parent_id === null ? null : Number(row.parent_id),
  };
}

async function wouldCreateEmailCategoryCycle(
  trx: WorkspaceTransaction,
  workspaceId: string,
  categoryId: number,
  candidateParentId: number,
): Promise<boolean> {
  let nextParentId: number | null = candidateParentId;
  const seen = new Set<number>();
  for (let depth = 0; nextParentId !== null && depth < 100; depth += 1) {
    if (nextParentId === categoryId) return true;
    if (seen.has(nextParentId)) return true;
    seen.add(nextParentId);
    const row = await trx
      .selectFrom('email_categories')
      .select('parent_id')
      .where('workspace_id', '=', workspaceId)
      .where('id', '=', nextParentId)
      .executeTakeFirst();
    if (!row) return false;
    nextParentId = row.parent_id === null ? null : Number(row.parent_id);
  }
  return nextParentId !== null;
}

function emailCategoryParentMapHasCycle(
  parentById: ReadonlyMap<number, number | null>,
  categoryId: number,
): boolean {
  let nextParentId = parentById.get(categoryId) ?? null;
  const seen = new Set<number>();
  for (let depth = 0; nextParentId !== null && depth < 100; depth += 1) {
    if (nextParentId === categoryId) return true;
    if (seen.has(nextParentId)) return true;
    seen.add(nextParentId);
    nextParentId = parentById.get(nextParentId) ?? null;
  }
  return nextParentId !== null;
}

async function resolveRemoteContentAllowlistConflict(
  trx: WorkspaceTransaction,
  workspaceId: string,
  scope: string,
  value: string,
  excludeId?: number,
): Promise<{ id: number } | null> {
  let query = trx
    .selectFrom('email_remote_content_allowlist')
    .select('id')
    .where('workspace_id', '=', workspaceId)
    .where('scope', '=', scope)
    .where('value', '=', value);
  if (excludeId !== undefined) query = query.where('id', '!=', excludeId);
  const row = await query.executeTakeFirst();
  return row ? { id: Number(row.id) } : null;
}

async function resolveAccountSignatureConflict(
  trx: WorkspaceTransaction,
  workspaceId: string,
  accountSourceSqliteId: number,
  excludeSourceSqliteId?: number,
): Promise<{ sourceSqliteId: number } | null> {
  let query = trx
    .selectFrom('email_account_signatures')
    .select('source_sqlite_id')
    .where('workspace_id', '=', workspaceId)
    .where('account_source_sqlite_id', '=', accountSourceSqliteId);
  if (excludeSourceSqliteId !== undefined) query = query.where('source_sqlite_id', '!=', excludeSourceSqliteId);
  const row = await query.executeTakeFirst();
  return row ? { sourceSqliteId: Number(row.source_sqlite_id) } : null;
}

async function wouldCreateThreadAliasCycle(
  trx: WorkspaceTransaction,
  workspaceId: string,
  aliasThreadId: string,
  canonicalThreadId: string,
): Promise<boolean> {
  if (aliasThreadId === canonicalThreadId) return true;
  let walk = canonicalThreadId;
  const visited = new Set<string>();
  for (let i = 0; i < 64; i += 1) {
    if (walk === aliasThreadId) return true;
    if (visited.has(walk)) return false;
    visited.add(walk);
    const row = await trx
      .selectFrom('email_thread_aliases')
      .select('canonical_thread_id')
      .where('workspace_id', '=', workspaceId)
      .where('alias_thread_id', '=', walk)
      .orderBy('id', 'asc')
      .executeTakeFirst();
    if (!row) return false;
    walk = row.canonical_thread_id;
  }
  return false;
}

async function getOrCreateThreadForTicket(
  trx: WorkspaceTransaction,
  workspaceId: string,
  ticketCode: string,
  now: Date,
): Promise<string> {
  const existing = await trx
    .selectFrom('email_threads')
    .select('id')
    .where('workspace_id', '=', workspaceId)
    .where('ticket_code', '=', ticketCode)
    .where('account_id', 'is', null)
    .executeTakeFirst();
  if (existing?.id) return existing.id;

  const threadId = `th-${randomBytes(8).toString('hex')}`;
  const inserted = await trx
    .insertInto('email_threads')
    .values({
      workspace_id: workspaceId,
      id: threadId,
      ticket_code: ticketCode,
      root_message_source_sqlite_id: null,
      root_message_id: null,
      last_message_at: null,
      message_count: 0,
      has_unread: false,
      has_attachments: false,
      subject_normalized: null,
      source_row: serverApiSourceRow(),
      imported_in_run_id: null,
      created_at: now,
      updated_at: now,
    })
    .onConflict((oc) => oc
      .columns(['workspace_id', 'ticket_code'])
      .where('account_id', 'is', null)
      .doNothing())
    .returning('id')
    .executeTakeFirst();
  if (inserted?.id) return inserted.id;

  const existingAfterConflict = await trx
    .selectFrom('email_threads')
    .select('id')
    .where('workspace_id', '=', workspaceId)
    .where('ticket_code', '=', ticketCode)
    .where('account_id', 'is', null)
    .executeTakeFirst();
  if (existingAfterConflict?.id) return existingAfterConflict.id;
  throw new Error('email thread ticket insert failed');
}

async function resolveCanonicalThreadId(
  trx: WorkspaceTransaction,
  workspaceId: string,
  threadId: string,
): Promise<string> {
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

/**
 * Reference-thread a freshly-synced message: find its conversation siblings in
 * the same account by normalized Message-ID / In-Reply-To / References, and
 *  - inherit an existing thread_id (backfilling any thread-less siblings), or
 *  - mint a new thread once a 2nd message of the conversation is seen, or
 *  - honor a ticket carried in the subject, or
 *  - leave thread_id = null for standalone / headerless (POP3) mail (as before).
 *
 * Runs inside the caller's sync transaction (so a query error aborts that one
 * message's sync — it retries). When siblings span more than one existing
 * thread we pick the lexicographically-smallest and deliberately DO NOT merge
 * the others: an under-merge from imperfect headers is safe; a mis-merge is not.
 * The heavy alias-based merge stays in the explicit user "merge threads" action.
 */
export async function resolveReferenceThreadForSync(
  trx: WorkspaceTransaction,
  args: {
    workspaceId: string;
    accountId: number;
    messageId: string | null;
    inReplyTo: string | null;
    referencesHeader: string | null;
    subject: string | null;
    now: Date;
  },
): Promise<{ threadId: string | null; ticketCode: string | null }> {
  const related = collectRelatedIds(args.messageId, args.inReplyTo, args.referencesHeader);
  // Recognize the same custom per-account ticket prefixes the rest of the app
  // uses, not just the legacy `SCR` default. Fast path: try the default first;
  // only when the subject carries a bracketed ticket token the default missed do
  // we load the workspace's configured prefixes (2 extra queries) and retry, so
  // ordinary mail without a ticket bracket stays query-free on the hot sync path.
  let subjectTicket = extractTicketFromSubject(args.subject);
  if (
    !subjectTicket
    && args.subject
    && /\[[A-Za-z0-9]{1,12}-[A-Za-z0-9]{1,20}\]/.test(args.subject)
  ) {
    const allowedPrefixes = await listWorkspaceTicketPrefixes(trx, args.workspaceId);
    subjectTicket = extractTicketFromSubject(args.subject, { allowedPrefixes });
  }

  const { sql: kyselySql } = require('kysely') as typeof import('kysely');

  let siblings: { id: number; thread_id: string | null }[] = [];
  if (related.length > 0) {
    // Match siblings by NORMALIZED Message-ID / In-Reply-To (strip <>, trim,
    // lowercase). The normalized expressions MUST equal the functional indexes
    // in migration 0025 so the lookup stays index-backed. `sql.join` binds each
    // id as its own parameter (an IN-list) — avoids `any(array)` colliding with
    // the pool's jsonb-array plugin.
    const relatedList = () => kyselySql.join(related);
    siblings = (await trx
      .selectFrom('email_messages')
      .select(['id', 'thread_id'])
      .where('workspace_id', '=', args.workspaceId)
      .where('account_id', '=', args.accountId)
      .where(
        // The `IS NOT NULL` guards let Postgres use the partial functional
        // indexes from migration 0025 (which are `WHERE message_id IS NOT NULL`
        // / `WHERE in_reply_to IS NOT NULL`) instead of a full scan.
        kyselySql<boolean>`(
          (message_id IS NOT NULL
            AND lower(btrim(replace(replace(coalesce(message_id, ''), '<', ''), '>', ''))) in (${relatedList()}))
          OR (in_reply_to IS NOT NULL
            AND lower(btrim(replace(replace(coalesce(in_reply_to, ''), '<', ''), '>', ''))) in (${relatedList()}))
        )`,
      )
      // Prioritize siblings that already carry a `thread_id` before the cap so a
      // huge (>500 message) conversation can't drop its single threaded row and
      // mint a duplicate thread. `thread_id IS NULL` sorts `false` (non-null)
      // first under Postgres' default ASC ordering.
      .orderBy(kyselySql`(thread_id is null)`)
      .limit(500)
      .execute()) as { id: number; thread_id: string | null }[];
  }

  const canonicalThreads: string[] = [];
  const seenCanonical = new Set<string>();
  const nullSiblingIds: number[] = [];
  for (const sibling of siblings) {
    const tid = sibling.thread_id?.trim();
    if (!tid) {
      nullSiblingIds.push(sibling.id);
      continue;
    }
    const canonical = await resolveCanonicalThreadId(trx, args.workspaceId, tid);
    if (!seenCanonical.has(canonical)) {
      seenCanonical.add(canonical);
      canonicalThreads.push(canonical);
    }
  }

  const backfillNullSiblings = async (threadId: string): Promise<void> => {
    if (nullSiblingIds.length === 0) return;
    await trx
      .updateTable('email_messages')
      .set({ thread_id: threadId, updated_at: args.now })
      .where('workspace_id', '=', args.workspaceId)
      .where('id', 'in', nullSiblingIds)
      .execute();
  };

  // (1) Inherit an existing conversation thread. Preserve a subject-carried
  // ticket on the message (don't drop it just because we inherited by headers).
  if (canonicalThreads.length > 0) {
    const canonical = canonicalThreads.slice().sort()[0]!;
    await backfillNullSiblings(canonical);
    return { threadId: canonical, ticketCode: subjectTicket ?? null };
  }

  // (2) 2+ messages of a brand-new conversation, none threaded yet → mint one.
  // The email_threads row needs a ticket_code, but we only denormalize a
  // ticket onto the MESSAGE when it is meaningful (carried in the subject);
  // an arbitrary generated code is not copied, so siblings stay consistent.
  if (nullSiblingIds.length > 0) {
    const ticket = subjectTicket ?? generateTicketCode();
    const canonical = await getOrCreateThreadForTicket(trx, args.workspaceId, ticket, args.now);
    await backfillNullSiblings(canonical);
    return { threadId: canonical, ticketCode: subjectTicket ?? null };
  }

  // (3) Subject carries a known ticket → attach to (or open) that thread.
  if (subjectTicket) {
    const canonical = await getOrCreateThreadForTicket(trx, args.workspaceId, subjectTicket, args.now);
    return { threadId: canonical, ticketCode: subjectTicket };
  }

  // (4) Standalone / headerless mail → leave unthreaded, exactly as before.
  return { threadId: null, ticketCode: null };
}

/**
 * Recompute a thread's aggregate row (message_count, last_message_at, unread,
 * attachments, …) after sync threading assigned/backfilled thread_id. Call this
 * AFTER the current message is inserted so the counts include it; otherwise the
 * freshly-minted email_threads row keeps message_count = 0 / last_message_at =
 * null and the thread APIs return stale values.
 */
export async function refreshThreadAggregateAfterSync(
  trx: WorkspaceTransaction,
  workspaceId: string,
  threadId: string,
  now: Date,
): Promise<void> {
  const canonical = await resolveCanonicalThreadId(trx, workspaceId, threadId);
  await upsertThreadAggregateForCanonicalThread(trx, workspaceId, canonical, now);
}

type ThreadAdminMessageRow = {
  id: number;
  sourceSqliteId: number;
  messageId: string | null;
  inReplyTo: string | null;
  referencesHeader: string | null;
  dateReceived: Date | string | null;
  seenLocal: boolean;
  uid: number;
  hasAttachments: boolean;
  ticketCode: string | null;
  normalizedSubject: string | null;
  subject: string | null;
};

async function loadCanonicalThreadMessages(
  trx: WorkspaceTransaction,
  workspaceId: string,
  canonicalThreadId: string,
): Promise<ThreadAdminMessageRow[]> {
  const aliases = await trx
    .selectFrom('email_thread_aliases')
    .select('alias_thread_id')
    .where('workspace_id', '=', workspaceId)
    .where('canonical_thread_id', '=', canonicalThreadId)
    .execute();
  const threadIds = [
    canonicalThreadId,
    ...aliases.map((row) => row.alias_thread_id).filter((id) => id !== canonicalThreadId),
  ];
  const rows = await trx
    .selectFrom('email_messages')
    .select([
      'id',
      'source_sqlite_id as sourceSqliteId',
      'message_id as messageId',
      'in_reply_to as inReplyTo',
      'references_header as referencesHeader',
      'date_received as dateReceived',
      'seen_local as seenLocal',
      'uid',
      'has_attachments as hasAttachments',
      'ticket_code as ticketCode',
      'normalized_subject as normalizedSubject',
      'subject',
    ])
    .where('workspace_id', '=', workspaceId)
    .where('thread_id', 'in', threadIds)
    .orderBy('date_received', 'asc')
    .orderBy('id', 'asc')
    .execute();
  return rows.map((row) => ({
    id: Number(row.id),
    sourceSqliteId: Number(row.sourceSqliteId),
    messageId: row.messageId,
    inReplyTo: row.inReplyTo,
    referencesHeader: row.referencesHeader,
    dateReceived: row.dateReceived,
    seenLocal: row.seenLocal,
    uid: Number(row.uid),
    hasAttachments: row.hasAttachments,
    ticketCode: row.ticketCode,
    normalizedSubject: row.normalizedSubject,
    subject: row.subject,
  }));
}

async function rebuildThreadEdgesForCanonicalThread(
  trx: WorkspaceTransaction,
  workspaceId: string,
  canonicalThreadId: string,
): Promise<void> {
  const messages = await loadCanonicalThreadMessages(trx, workspaceId, canonicalThreadId);
  if (messages.length === 0) return;

  const messageIds = messages.map((message) => message.id);
  await trx
    .deleteFrom('email_thread_edges')
    .where('workspace_id', '=', workspaceId)
    .where('child_message_id', 'in', messageIds)
    .execute();

  const byMessageId = new Map<string, ThreadAdminMessageRow>();
  for (const message of messages) {
    const normalized = message.messageId?.trim().toLowerCase();
    if (normalized) byMessageId.set(normalized, message);
  }

  const edgeRows = [];
  const seenEdges = new Set<string>();
  for (const child of messages) {
    const parent = findThreadParent(child, byMessageId);
    if (!parent || parent.id === child.id) continue;
    const edgeKey = `${parent.sourceSqliteId}:${child.sourceSqliteId}`;
    if (seenEdges.has(edgeKey)) continue;
    seenEdges.add(edgeKey);
    edgeRows.push({
      workspace_id: workspaceId,
      source_sqlite_id: serverCreatedEmailThreadEdgeSourceSqliteId(),
      parent_message_source_sqlite_id: parent.sourceSqliteId,
      child_message_source_sqlite_id: child.sourceSqliteId,
      parent_message_id: parent.id,
      child_message_id: child.id,
      source_row: serverApiSourceRow(),
      imported_in_run_id: null,
      updated_at: new Date(),
    });
  }

  if (edgeRows.length === 0) return;
  await trx
    .insertInto('email_thread_edges')
    .values(edgeRows)
    .onConflict((oc) => oc
      .columns(['workspace_id', 'parent_message_source_sqlite_id', 'child_message_source_sqlite_id'])
      .doNothing())
    .execute();
}

function findThreadParent(
  child: ThreadAdminMessageRow,
  byMessageId: Map<string, ThreadAdminMessageRow>,
): ThreadAdminMessageRow | null {
  const refs: string[] = [];
  if (child.inReplyTo?.trim()) refs.push(child.inReplyTo.trim());
  if (child.referencesHeader?.trim()) {
    for (const part of child.referencesHeader.split(/\s+/)) {
      const ref = part.trim();
      if (ref) refs.push(ref);
      if (refs.length >= 64) break;
    }
  }
  for (const ref of refs) {
    const parent = byMessageId.get(ref.toLowerCase());
    if (parent && parent.id !== child.id) return parent;
  }
  return null;
}

async function upsertThreadAggregateForCanonicalThread(
  trx: WorkspaceTransaction,
  workspaceId: string,
  canonicalThreadId: string,
  now: Date,
): Promise<void> {
  const messages = await loadCanonicalThreadMessages(trx, workspaceId, canonicalThreadId);
  if (messages.length === 0) return;

  const current = await trx
    .selectFrom('email_threads')
    .select(['ticket_code', 'created_at'])
    .where('workspace_id', '=', workspaceId)
    .where('id', '=', canonicalThreadId)
    .executeTakeFirst();
  const firstMessage = messages[0]!;
  const lastMessage = messages.reduce((latest, message) => (
    timestampSortValue(message.dateReceived) >= timestampSortValue(latest.dateReceived) ? message : latest
  ), firstMessage);
  const ticketCode = current?.ticket_code
    ?? messages.find((message) => message.ticketCode?.trim())?.ticketCode
    ?? generateTicketCode();
  const subjectNormalized = messages.find((message) => message.normalizedSubject?.trim())?.normalizedSubject
    ?? messages.find((message) => message.subject?.trim())?.subject
    ?? null;

  await trx
    .insertInto('email_threads')
    .values({
      workspace_id: workspaceId,
      id: canonicalThreadId,
      ticket_code: ticketCode,
      root_message_source_sqlite_id: firstMessage.sourceSqliteId,
      root_message_id: firstMessage.id,
      last_message_at: lastMessage.dateReceived,
      message_count: messages.length,
      has_unread: messages.some((message) => !message.seenLocal && message.uid >= 0),
      has_attachments: messages.some((message) => message.hasAttachments),
      subject_normalized: subjectNormalized,
      source_row: serverApiSourceRow(),
      imported_in_run_id: null,
      created_at: current?.created_at ?? now,
      updated_at: now,
    })
    .onConflict((oc) => oc.columns(['workspace_id', 'id']).doUpdateSet({
      root_message_source_sqlite_id: firstMessage.sourceSqliteId,
      root_message_id: firstMessage.id,
      last_message_at: lastMessage.dateReceived,
      message_count: messages.length,
      has_unread: messages.some((message) => !message.seenLocal && message.uid >= 0),
      has_attachments: messages.some((message) => message.hasAttachments),
      subject_normalized: subjectNormalized,
      updated_at: now,
    }))
    .execute();
}

function timestampSortValue(value: Date | string | null): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

async function resolveThreadAliasConflict(
  trx: WorkspaceTransaction,
  workspaceId: string,
  aliasThreadId: string,
  canonicalThreadId: string,
  excludeId?: number,
): Promise<{ id: number } | null> {
  let query = trx
    .selectFrom('email_thread_aliases')
    .select('id')
    .where('workspace_id', '=', workspaceId)
    .where('alias_thread_id', '=', aliasThreadId)
    .where('canonical_thread_id', '=', canonicalThreadId);
  if (excludeId !== undefined) query = query.where('id', '!=', excludeId);
  const row = await query.executeTakeFirst();
  return row ? { id: Number(row.id) } : null;
}

function serverCreatedEmailMessageTagSourceSqliteId(): RawBuilder<number> {
  const { sql: kyselySql } = require('kysely') as typeof import('kysely');
  return kyselySql<number>`-nextval(pg_get_serial_sequence('email_message_tags', 'id'))`;
}

function serverCreatedEmailCategorySourceSqliteId(): RawBuilder<number> {
  const { sql: kyselySql } = require('kysely') as typeof import('kysely');
  return kyselySql<number>`-nextval(pg_get_serial_sequence('email_categories', 'id'))`;
}

function serverCreatedEmailMessageCategorySourceSqliteId(): RawBuilder<number> {
  const { sql: kyselySql } = require('kysely') as typeof import('kysely');
  return kyselySql<number>`-nextval(pg_get_serial_sequence('email_message_categories', 'id'))`;
}

function serverCreatedEmailCannedResponseSourceSqliteId(): RawBuilder<number> {
  const { sql: kyselySql } = require('kysely') as typeof import('kysely');
  return kyselySql<number>`-nextval(pg_get_serial_sequence('email_canned_responses', 'id'))`;
}

function serverCreatedEmailRemoteContentAllowlistSourceSqliteId(): RawBuilder<number> {
  const { sql: kyselySql } = require('kysely') as typeof import('kysely');
  return kyselySql<number>`-nextval(pg_get_serial_sequence('email_remote_content_allowlist', 'id'))`;
}

function serverCreatedEmailThreadEdgeSourceSqliteId(): RawBuilder<number> {
  const { sql: kyselySql } = require('kysely') as typeof import('kysely');
  return kyselySql<number>`-nextval(pg_get_serial_sequence('email_thread_edges', 'id'))`;
}

function serverCreatedEmailThreadAliasSourceSqliteId(): RawBuilder<number> {
  const { sql: kyselySql } = require('kysely') as typeof import('kysely');
  return kyselySql<number>`-nextval(pg_get_serial_sequence('email_thread_aliases', 'id'))`;
}

function serverCreatedEmailAccountSignatureSourceSqliteId(): RawBuilder<number> {
  const { sql: kyselySql } = require('kysely') as typeof import('kysely');
  return kyselySql<number>`-nextval('email_account_signatures_server_source_sqlite_id_seq')`;
}

function serverCreatedEmailReadReceiptSourceSqliteId(): RawBuilder<number> {
  const { sql: kyselySql } = require('kysely') as typeof import('kysely');
  return kyselySql<number>`-nextval(pg_get_serial_sequence('email_read_receipt_log', 'id'))`;
}

function serverCreatedEmailInternalNoteSourceSqliteId(): RawBuilder<number> {
  const { sql: kyselySql } = require('kysely') as typeof import('kysely');
  return kyselySql<number>`-nextval(pg_get_serial_sequence('email_internal_notes', 'id'))`;
}

function serverApiSourceRow(): RawBuilder<unknown> {
  const { sql: kyselySql } = require('kysely') as typeof import('kysely');
  return kyselySql`jsonb_build_object('origin', 'server_api')`;
}

function mapEmailFolderRow(row: Pick<EmailFolderRow, typeof emailFolderSelectColumns[number]>): EmailFolderRecord {
  return {
    id: Number(row.id),
    sourceSqliteId: Number(row.source_sqlite_id),
    accountSourceSqliteId: Number(row.account_source_sqlite_id),
    accountId: row.account_id === null ? null : Number(row.account_id),
    path: row.path,
    delimiter: row.delimiter,
    uidValidity: row.uidvalidity === null ? null : Number(row.uidvalidity),
    uidValidityText: row.uidvalidity_str,
    lastUid: Number(row.last_uid),
    lastSyncedAt: timestampToIsoOrNull(row.last_synced_at),
    pop3Uidl: row.pop3_uidl_str,
    updatedAt: timestampToIso(row.updated_at),
  };
}

function mapEmailTeamMemberRow(row: Pick<EmailTeamMemberRow, typeof emailTeamMemberSelectColumns[number]>): EmailTeamMemberRecord {
  return {
    id: row.id,
    displayName: row.display_name,
    role: row.role,
    signatureHtml: row.signature_html,
    sortOrder: row.sort_order,
    createdAt: timestampToIsoOrNull(row.created_at),
    updatedAt: timestampToIso(row.updated_at),
  };
}

function mapEmailThreadRow(row: Pick<EmailThreadRow, typeof emailThreadSelectColumns[number]>): EmailThreadRecord {
  return {
    id: row.id,
    ticketCode: row.ticket_code,
    accountSourceSqliteId: row.account_source_sqlite_id === null ? null : Number(row.account_source_sqlite_id),
    accountId: row.account_id === null ? null : Number(row.account_id),
    rootMessageSourceSqliteId: row.root_message_source_sqlite_id === null ? null : Number(row.root_message_source_sqlite_id),
    rootMessageId: row.root_message_id === null ? null : Number(row.root_message_id),
    lastMessageAt: timestampToIsoOrNull(row.last_message_at),
    messageCount: row.message_count,
    hasUnread: row.has_unread,
    hasAttachments: row.has_attachments,
    subjectNormalized: row.subject_normalized,
    createdAt: timestampToIsoOrNull(row.created_at),
    updatedAt: timestampToIso(row.updated_at),
  };
}

function mapEmailMessageTagRow(row: Pick<EmailMessageTagRow, typeof emailMessageTagSelectColumns[number]>): EmailMessageTagRecord {
  return {
    id: Number(row.id),
    sourceSqliteId: Number(row.source_sqlite_id),
    messageSourceSqliteId: Number(row.message_source_sqlite_id),
    messageId: row.message_id === null ? null : Number(row.message_id),
    tag: row.tag,
    createdAt: timestampToIsoOrNull(row.created_at),
    updatedAt: timestampToIso(row.updated_at),
  };
}

function mapEmailCategoryRow(row: Pick<EmailCategoryRow, typeof emailCategorySelectColumns[number]>): EmailCategoryRecord {
  return {
    id: Number(row.id),
    sourceSqliteId: Number(row.source_sqlite_id),
    parentSourceSqliteId: row.parent_source_sqlite_id === null ? null : Number(row.parent_source_sqlite_id),
    parentId: row.parent_id === null ? null : Number(row.parent_id),
    name: row.name,
    sortOrder: row.sort_order,
    createdAt: timestampToIsoOrNull(row.created_at),
    updatedAt: timestampToIso(row.updated_at),
  };
}

function mapEmailMessageCategoryRow(
  row: Pick<EmailMessageCategoryRow, typeof emailMessageCategorySelectColumns[number]>,
): EmailMessageCategoryRecord {
  return {
    id: Number(row.id),
    sourceSqliteId: Number(row.source_sqlite_id),
    messageSourceSqliteId: Number(row.message_source_sqlite_id),
    categorySourceSqliteId: Number(row.category_source_sqlite_id),
    messageId: row.message_id === null ? null : Number(row.message_id),
    categoryId: row.category_id === null ? null : Number(row.category_id),
    updatedAt: timestampToIso(row.updated_at),
  };
}

function mapEmailCategoryCountRow(row: EmailCategoryCountRow): EmailCategoryCountRecord {
  return {
    categoryId: countValue(row.category_id),
    count: countValue(row.count),
  };
}

function countValue(value: number | string | bigint | null | undefined): number {
  const count = typeof value === 'bigint' ? Number(value) : Number(value ?? 0);
  return Number.isFinite(count) && count >= 0 ? count : 0;
}

function mapEmailInternalNoteRow(row: Pick<EmailInternalNoteRow, typeof emailInternalNoteSelectColumns[number]>): EmailInternalNoteRecord {
  return {
    id: Number(row.id),
    sourceSqliteId: Number(row.source_sqlite_id),
    messageSourceSqliteId: Number(row.message_source_sqlite_id),
    messageId: row.message_id === null ? null : Number(row.message_id),
    body: row.body,
    createdAt: timestampToIsoOrNull(row.created_at),
    updatedAt: timestampToIso(row.updated_at),
  };
}

function mapEmailCannedResponseRow(
  row: Pick<EmailCannedResponseRow, typeof emailCannedResponseSelectColumns[number]>,
): EmailCannedResponseRecord {
  return {
    id: Number(row.id),
    sourceSqliteId: Number(row.source_sqlite_id),
    title: row.title,
    body: row.body,
    accountSourceSqliteId: row.account_source_sqlite_id === null ? null : Number(row.account_source_sqlite_id),
    accountId: row.account_id === null ? null : Number(row.account_id),
    overrideKey: row.override_key,
    sortOrder: row.sort_order,
    createdAt: timestampToIsoOrNull(row.created_at),
    updatedAt: timestampToIso(row.updated_at),
  };
}

function mapEmailAccountSignatureRow(
  row: Pick<EmailAccountSignatureRow, typeof emailAccountSignatureSelectColumns[number]>,
): EmailAccountSignatureRecord {
  return {
    sourceSqliteId: Number(row.source_sqlite_id),
    accountSourceSqliteId: Number(row.account_source_sqlite_id),
    accountId: row.account_id === null ? null : Number(row.account_id),
    signatureHtml: row.signature_html,
    updatedAt: timestampToIso(row.updated_at),
  };
}

function mapEmailRemoteContentAllowlistRow(
  row: Pick<EmailRemoteContentAllowlistRow, typeof emailRemoteContentAllowlistSelectColumns[number]>,
): EmailRemoteContentAllowlistRecord {
  return {
    id: Number(row.id),
    sourceSqliteId: Number(row.source_sqlite_id),
    scope: row.scope,
    value: row.value,
    createdAt: timestampToIsoOrNull(row.created_at),
    updatedAt: timestampToIso(row.updated_at),
  };
}

function mapEmailReadReceiptRow(row: Pick<EmailReadReceiptRow, typeof emailReadReceiptSelectColumns[number]>): EmailReadReceiptRecord {
  return {
    id: Number(row.id),
    sourceSqliteId: Number(row.source_sqlite_id),
    messageSourceSqliteId: Number(row.message_source_sqlite_id),
    messageId: row.message_id === null ? null : Number(row.message_id),
    direction: row.direction,
    recipient: row.recipient,
    at: timestampToIsoOrNull(row.at),
    updatedAt: timestampToIso(row.updated_at),
  };
}

function mapEmailThreadEdgeRow(row: Pick<EmailThreadEdgeRow, typeof emailThreadEdgeSelectColumns[number]>): EmailThreadEdgeRecord {
  return {
    id: Number(row.id),
    sourceSqliteId: Number(row.source_sqlite_id),
    parentMessageSourceSqliteId: Number(row.parent_message_source_sqlite_id),
    childMessageSourceSqliteId: Number(row.child_message_source_sqlite_id),
    parentMessageId: row.parent_message_id === null ? null : Number(row.parent_message_id),
    childMessageId: row.child_message_id === null ? null : Number(row.child_message_id),
    updatedAt: timestampToIso(row.updated_at),
  };
}

function mapEmailThreadAliasRow(row: Pick<EmailThreadAliasRow, typeof emailThreadAliasSelectColumns[number]>): EmailThreadAliasRecord {
  return {
    id: Number(row.id),
    sourceSqliteId: Number(row.source_sqlite_id),
    accountSourceSqliteId: row.account_source_sqlite_id === null ? null : Number(row.account_source_sqlite_id),
    accountId: row.account_id === null ? null : Number(row.account_id),
    aliasThreadId: row.alias_thread_id,
    canonicalThreadId: row.canonical_thread_id,
    confidence: row.confidence,
    source: row.source,
    createdAt: timestampToIsoOrNull(row.created_at),
    updatedAt: timestampToIso(row.updated_at),
  };
}

function mapEmailThreadAliasWarningRow(row: {
  messageId: number | string;
  accountId: number | string | null;
  subject: string | null;
  aliasThreadId: string;
  canonicalThreadId: string;
  confidence: string;
}): EmailThreadAliasWarningRecord {
  return {
    messageId: Number(row.messageId),
    accountId: row.accountId === null ? null : Number(row.accountId),
    subject: row.subject,
    aliasThreadId: row.aliasThreadId,
    canonicalThreadId: row.canonicalThreadId,
    confidence: row.confidence,
  };
}

function timestampToIsoOrNull(value: Date | string | null): string | null {
  return value === null ? null : timestampToIso(value);
}

function timestampToIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}
