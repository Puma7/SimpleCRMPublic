import type { MailResource } from '@simplecrm/core';
import type { Kysely } from 'kysely';

import type { ServerDatabase } from '../db/schema';
import { resolveEmailAccountReference } from '../db/resolve-email-account-reference';
import {
  withWorkspaceTransaction,
  type WorkspaceSessionApplier,
  type WorkspaceTransaction,
} from '../db/workspace-context';
import type {
  MailResourceLookupPort,
  MailResourceLookupTarget,
  WorkflowDelayedJobMailClassification,
} from './types';

export type PostgresMailResourceLookupOptions = Readonly<{
  db: Kysely<ServerDatabase>;
  applyWorkspaceSession?: WorkspaceSessionApplier;
}>;

export function createPostgresMailResourceLookupPort(
  options: PostgresMailResourceLookupOptions,
): MailResourceLookupPort {
  return {
    async resolve(input) {
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        (trx) => resolveTarget(trx, input.workspaceId, input.target),
        { applySession: options.applyWorkspaceSession },
      );
    },
    async classifyWorkflowDelayedJob(input) {
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        (trx) => classifyWorkflowDelayedJob(
          trx,
          input.workspaceId,
          input.delayedJobId,
        ),
        { applySession: options.applyWorkspaceSession },
      );
    },
  };
}

async function classifyWorkflowDelayedJob(
  trx: WorkspaceTransaction,
  workspaceId: string,
  delayedJobId: number,
): Promise<WorkflowDelayedJobMailClassification> {
  const row = await trx
    .selectFrom('workflow_delayed_jobs as delayed_job')
    .leftJoin('email_messages as message', (join) => join
      .onRef('message.workspace_id', '=', 'delayed_job.workspace_id')
      .onRef('message.id', '=', 'delayed_job.message_id'))
    .select([
      'delayed_job.message_id as delayed_message_id',
      'message.id as message_id',
      'message.account_id as account_id',
      'message.folder_id as folder_id',
    ])
    .where('delayed_job.workspace_id', '=', workspaceId)
    .where('delayed_job.id', '=', delayedJobId)
    .executeTakeFirst();
  if (!row) return { kind: 'missing' };
  if (row.delayed_message_id === null) return { kind: 'non_mail' };
  const resource = resourceFromMessageRow(row)[0];
  return resource ? { kind: 'message', resource } : { kind: 'invalid' };
}

async function resolveTarget(
  trx: WorkspaceTransaction,
  workspaceId: string,
  target: MailResourceLookupTarget,
): Promise<readonly MailResource[]> {
  if (target.kind === 'account') {
    const account = await resolveEmailAccountReference(trx, workspaceId, target.id);
    return account ? [accountResource(account.id)] : [];
  }
  if (target.kind === 'folder') {
    const row = await trx
      .selectFrom('email_folders')
      .select(['id', 'account_id'])
      .where('workspace_id', '=', workspaceId)
      .where('id', '=', target.id)
      .executeTakeFirst();
    return row?.account_id === null || row?.account_id === undefined
      ? []
      : [folderResource(Number(row.account_id), Number(row.id))];
  }
  if (target.kind === 'message') {
    const resource = await resolveMessageByIdOrSource(trx, workspaceId, target.id);
    return resource ? [resource] : [];
  }
  if (target.kind === 'attachment') {
    const row = await trx
      .selectFrom('email_message_attachments as attachment')
      .innerJoin('email_messages as message', (join) => join
        .onRef('message.id', '=', 'attachment.message_id')
        .onRef('message.workspace_id', '=', 'attachment.workspace_id'))
      .select([
        'message.id as message_id',
        'message.account_id as account_id',
        'message.folder_id as folder_id',
      ])
      .where('attachment.workspace_id', '=', workspaceId)
      .where('attachment.id', '=', target.id)
      .executeTakeFirst();
    return row ? resourceFromMessageRow(row) : [];
  }
  if (target.kind === 'thread') {
    const canonicalThreadId = await resolveCanonicalLookupThreadId(trx, workspaceId, target.id);
    const rows = await trx
      .selectFrom('email_messages')
      .select(['id as message_id', 'account_id', 'folder_id'])
      .where('workspace_id', '=', workspaceId)
      .where((eb) => eb.or([
        eb('thread_id', '=', canonicalThreadId),
        eb('thread_id', 'in', eb
          .selectFrom('email_thread_aliases')
          .select('alias_thread_id')
          .where('workspace_id', '=', workspaceId)
          .where('canonical_thread_id', '=', canonicalThreadId)),
      ]))
      .orderBy('id', 'asc')
      .execute();
    return rows.flatMap(resourceFromMessageRow);
  }
  if (target.kind === 'canned_response') {
    const row = await trx
      .selectFrom('email_canned_responses')
      .select(['account_id', 'account_source_sqlite_id'])
      .where('workspace_id', '=', workspaceId)
      .where('id', '=', target.id)
      .executeTakeFirst();
    // Missing row → []; the enforcer maps an empty canned-response resolution to
    // the workspace-global scope gate (owner/admin for restricted writes), which
    // also covers a genuinely global (accountless) canned response.
    if (!row) return [];
    if (row.account_id === null && row.account_source_sqlite_id === null) return [];
    return resolveAccountColumns(trx, workspaceId, row.account_id, row.account_source_sqlite_id);
  }
  return resolveMetadataTarget(trx, workspaceId, target);
}

async function resolveMetadataTarget(
  trx: WorkspaceTransaction,
  workspaceId: string,
  target: Extract<MailResourceLookupTarget, { kind: 'metadata' }>,
): Promise<readonly MailResource[]> {
  if (target.entity === 'thread_edge') {
    const edge = await trx
      .selectFrom('email_thread_edges')
      .select([
        'parent_message_id',
        'parent_message_source_sqlite_id',
        'child_message_id',
        'child_message_source_sqlite_id',
      ])
      .where('workspace_id', '=', workspaceId)
      .where('id', '=', target.id)
      .executeTakeFirst();
    if (!edge) return [];
    const resources = await Promise.all([
      resolveMessageByStoredColumns(
        trx,
        workspaceId,
        edge.parent_message_id,
        edge.parent_message_source_sqlite_id,
      ),
      resolveMessageByStoredColumns(
        trx,
        workspaceId,
        edge.child_message_id,
        edge.child_message_source_sqlite_id,
      ),
    ]);
    return resources.every((resource) => resource !== null)
      ? resources.flatMap((resource) => resource ? [resource] : [])
      : [];
  }

  if (target.entity === 'thread_alias') {
    const row = await trx
      .selectFrom('email_thread_aliases')
      .select(['account_id', 'account_source_sqlite_id', 'alias_thread_id', 'canonical_thread_id'])
      .where('workspace_id', '=', workspaceId)
      .where('id', '=', target.id)
      .executeTakeFirst();
    if (!row) return [];
    if (row.account_id !== null || row.account_source_sqlite_id !== null) {
      return resolveAccountColumns(trx, workspaceId, row.account_id, row.account_source_sqlite_id);
    }
    const messages = await trx
      .selectFrom('email_messages')
      .select(['id as message_id', 'account_id', 'folder_id'])
      .where('workspace_id', '=', workspaceId)
      .where('thread_id', 'in', [row.alias_thread_id, row.canonical_thread_id])
      .orderBy('id', 'asc')
      .execute();
    return messages.flatMap(resourceFromMessageRow);
  }

  if (target.entity === 'account_signature') {
    const row = await trx
      .selectFrom('email_account_signatures')
      .select(['account_id', 'account_source_sqlite_id'])
      .where('workspace_id', '=', workspaceId)
      .where('source_sqlite_id', '=', target.id)
      .executeTakeFirst();
    return row ? resolveAccountColumns(trx, workspaceId, row.account_id, row.account_source_sqlite_id) : [];
  }

  if (target.entity === 'spam_decision' || target.entity === 'spam_learning_event') {
    const row = target.entity === 'spam_decision'
      ? await trx
        .selectFrom('email_spam_decisions')
        .select(['message_id', 'message_source_sqlite_id', 'account_id', 'account_source_sqlite_id'])
        .where('workspace_id', '=', workspaceId)
        .where('id', '=', target.id)
        .executeTakeFirst()
      : await trx
        .selectFrom('email_spam_learning_events')
        .select(['message_id', 'message_source_sqlite_id', 'account_id', 'account_source_sqlite_id'])
        .where('workspace_id', '=', workspaceId)
        .where('id', '=', target.id)
        .executeTakeFirst();
    if (!row) return [];
    const message = await resolveMessageByStoredColumns(
      trx,
      workspaceId,
      row.message_id,
      row.message_source_sqlite_id,
    );
    return message ? [message] : resolveAccountColumns(
      trx,
      workspaceId,
      row.account_id,
      row.account_source_sqlite_id,
    );
  }

  const row = target.entity === 'message_tag'
    ? await trx
      .selectFrom('email_message_tags')
      .select(['message_id', 'message_source_sqlite_id'])
      .where('workspace_id', '=', workspaceId)
      .where('id', '=', target.id)
      .executeTakeFirst()
    : target.entity === 'message_category'
      ? await trx
        .selectFrom('email_message_categories')
        .select(['message_id', 'message_source_sqlite_id'])
        .where('workspace_id', '=', workspaceId)
        .where('id', '=', target.id)
        .executeTakeFirst()
      : target.entity === 'internal_note'
        ? await trx
          .selectFrom('email_internal_notes')
          .select(['message_id', 'message_source_sqlite_id'])
          .where('workspace_id', '=', workspaceId)
          .where('id', '=', target.id)
          .executeTakeFirst()
        : target.entity === 'read_receipt'
          ? await trx
            .selectFrom('email_read_receipt_log')
            .select(['message_id', 'message_source_sqlite_id'])
            .where('workspace_id', '=', workspaceId)
            .where('id', '=', target.id)
            .executeTakeFirst()
          : undefined;
  if (!row) return [];
  const message = await resolveMessageByStoredColumns(
    trx,
    workspaceId,
    row.message_id,
    row.message_source_sqlite_id,
  );
  return message ? [message] : [];
}

/**
 * Resolve a PUBLIC message reference from a URL/target — the number may be a PG
 * id or a legacy source_sqlite_id. Fails closed on an ambiguous reference (one
 * message's PG id AND a different message's source_sqlite_id both match) so it
 * never authorizes against the wrong message. Mirrors resolveEmailAccountReference.
 */
async function resolveMessageByIdOrSource(
  trx: WorkspaceTransaction,
  workspaceId: string,
  id: number,
): Promise<Extract<MailResource, { type: 'message' }> | null> {
  const byId = await trx
    .selectFrom('email_messages')
    .select(['id as message_id', 'account_id', 'folder_id'])
    .where('workspace_id', '=', workspaceId)
    .where('id', '=', id)
    .executeTakeFirst();
  const bySource = await trx
    .selectFrom('email_messages')
    .select(['id as message_id', 'account_id', 'folder_id'])
    .where('workspace_id', '=', workspaceId)
    .where('source_sqlite_id', '=', id)
    .executeTakeFirst();
  if (byId && bySource && Number(byId.message_id) !== Number(bySource.message_id)) return null;
  return resourceFromMessageRow(byId ?? bySource)[0] ?? null;
}

/**
 * Resolve a message from a metadata row's STORED columns. `message_id` is a PG
 * foreign key (resolve by id); `message_source_sqlite_id` is a legacy import
 * reference (resolve by source_sqlite_id). Collapsing them into one number and
 * trying id-first — as `Number(message_id ?? message_source_sqlite_id)` did —
 * authorizes against an unrelated message whenever a source id collides with
 * another message's PG id, letting a delegate reach metadata of an
 * inaccessible message.
 */
async function resolveMessageByStoredColumns(
  trx: WorkspaceTransaction,
  workspaceId: string,
  messageId: number | string | null,
  messageSourceSqliteId: number | string | null,
): Promise<Extract<MailResource, { type: 'message' }> | null> {
  if (messageId !== null) {
    const row = await trx
      .selectFrom('email_messages')
      .select(['id as message_id', 'account_id', 'folder_id'])
      .where('workspace_id', '=', workspaceId)
      .where('id', '=', Number(messageId))
      .executeTakeFirst();
    return resourceFromMessageRow(row)[0] ?? null;
  }
  if (messageSourceSqliteId === null) return null;
  const row = await trx
    .selectFrom('email_messages')
    .select(['id as message_id', 'account_id', 'folder_id'])
    .where('workspace_id', '=', workspaceId)
    .where('source_sqlite_id', '=', Number(messageSourceSqliteId))
    .executeTakeFirst();
  return resourceFromMessageRow(row)[0] ?? null;
}

async function resolveCanonicalLookupThreadId(
  trx: WorkspaceTransaction,
  workspaceId: string,
  threadId: string,
): Promise<string> {
  let current = threadId;
  const seen = new Set<string>();
  for (let depth = 0; depth < 20; depth += 1) {
    if (seen.has(current)) return threadId;
    seen.add(current);
    const alias = await trx
      .selectFrom('email_thread_aliases')
      .select('canonical_thread_id')
      .where('workspace_id', '=', workspaceId)
      .where('alias_thread_id', '=', current)
      .executeTakeFirst();
    if (!alias?.canonical_thread_id) return current;
    current = alias.canonical_thread_id;
  }
  return threadId;
}

async function resolveAccountColumns(
  trx: WorkspaceTransaction,
  workspaceId: string,
  accountId: number | null,
  accountSourceSqliteId: number | null,
): Promise<readonly MailResource[]> {
  // account_id is a STORED PostgreSQL foreign key (from a signature/alias/spam
  // row), so it is unambiguous by construction — resolve it EXACTLY by id.
  // Routing it through the public-reference resolver (which fails closed on
  // ambiguity) would wrongly reject it whenever some other account's
  // source_sqlite_id equals this db id, 404-ing valid routes even for
  // owners/admins. Mirrors postgres-relay-port.ts removeAllowedAccount.
  if (accountId !== null) {
    const row = await trx
      .selectFrom('email_accounts')
      .select('id')
      .where('workspace_id', '=', workspaceId)
      .where('id', '=', accountId)
      .executeTakeFirst();
    return row ? [accountResource(Number(row.id))] : [];
  }
  // The legacy source_sqlite_id fallback IS a public reference, so keep the
  // ambiguity-rejecting resolver here.
  if (accountSourceSqliteId === null) return [];
  const account = await resolveEmailAccountReference(trx, workspaceId, Number(accountSourceSqliteId));
  return account ? [accountResource(account.id)] : [];
}

function resourceFromMessageRow(row: {
  message_id: number | null;
  account_id: number | null;
  folder_id: number | null;
} | undefined): Extract<MailResource, { type: 'message' }>[] {
  if (!row || row.message_id === null || row.account_id === null || row.folder_id === null) return [];
  return [messageResource(Number(row.account_id), Number(row.folder_id), Number(row.message_id))];
}

function accountResource(accountId: number): Extract<MailResource, { type: 'account' }> {
  return { type: 'account', accountId: String(accountId) };
}

function folderResource(accountId: number, folderId: number): Extract<MailResource, { type: 'folder' }> {
  return { type: 'folder', accountId: String(accountId), folderId: String(folderId) };
}

function messageResource(
  accountId: number,
  folderId: number,
  messageId: number,
): Extract<MailResource, { type: 'message' }> {
  return {
    type: 'message',
    accountId: String(accountId),
    folderId: String(folderId),
    messageId: String(messageId),
  };
}
