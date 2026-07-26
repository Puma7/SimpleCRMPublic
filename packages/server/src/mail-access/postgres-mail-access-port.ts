import type { Kysely } from 'kysely';
import { sql } from 'kysely';

import type { ServerDatabase } from '../db/schema';
import {
  withWorkspaceTransaction,
  type WorkspaceTransaction,
  type WorkspaceSessionApplier,
} from '../db/workspace-context';
import { requirePostgresMailAclRolloutTransaction } from './postgres-mail-acl-rollout-evaluation-context';
import {
  EMPTY_MAIL_BINDING_CONSTRAINTS,
  type MailBindingVisibilityConstraints,
} from './mail-acl-constraints';
import type {
  MailAccessGrant,
  MailAccessPort,
  MailAclRolloutEvaluationContext,
  MailMessageVisibilityFacts,
  MailScopeActorContext,
  ResolveMailAccessGrantsInput,
} from './types';

export type PostgresMailAccessPortOptions = Readonly<{
  db: Kysely<ServerDatabase>;
  applyWorkspaceSession?: WorkspaceSessionApplier;
}>;

type MailAccessGrantRow = Readonly<{
  binding_id: string;
  resource_type: string;
  account_id: string;
  folder_id: string | null;
  message_id: string | null;
}>;

type ConstraintRow = Readonly<{
  binding_id: string;
  kind: string;
  mode: string;
  assignment_mode: string | null;
  value_ids: number[] | string | null;
  value_texts: string[] | string | null;
}>;

export function createPostgresMailAccessPort(options: PostgresMailAccessPortOptions): MailAccessPort {
  const sessionOptions = { applySession: options.applyWorkspaceSession } as const;

  return {
    async resolveGrants(
      input: ResolveMailAccessGrantsInput,
      evaluationContext?: MailAclRolloutEvaluationContext,
    ): Promise<readonly MailAccessGrant[]> {
      if (evaluationContext) {
        return resolveGrants(
          requirePostgresMailAclRolloutTransaction(evaluationContext, input.workspaceId),
          input,
        );
      }
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, userId: input.userId, role: 'user' },
        (trx) => resolveGrants(trx, input),
        sessionOptions,
      );
    },

    async resolveScopeActorContext(input): Promise<MailScopeActorContext> {
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, userId: input.userId, role: 'user' },
        (trx) => resolveActorContext(trx, input.workspaceId, input.userId),
        sessionOptions,
      );
    },

    async resolveMessageVisibilityFacts(input): Promise<MailMessageVisibilityFacts | null> {
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        (trx) => resolveMessageFacts(trx, input.workspaceId, input.messageId),
        sessionOptions,
      );
    },
  };
}

async function resolveGrants(
  trx: WorkspaceTransaction,
  input: ResolveMailAccessGrantsInput,
): Promise<readonly MailAccessGrant[]> {
  const result = await sql<MailAccessGrantRow>`
    WITH active_subjects (subject_type, subject_id) AS (
      SELECT 'user'::text, active_user.id::text
      FROM users AS active_user
      WHERE active_user.workspace_id = ${input.workspaceId}::uuid
        AND active_user.id = ${input.userId}::uuid
      UNION ALL
      SELECT 'group'::text, membership.group_id::text
      FROM users AS active_user
      INNER JOIN user_group_members AS membership
        ON membership.workspace_id = active_user.workspace_id
        AND membership.user_id = active_user.id
      INNER JOIN user_groups AS active_group
        ON active_group.workspace_id = ${input.workspaceId}::uuid
        AND active_group.id = membership.group_id
      WHERE active_user.workspace_id = ${input.workspaceId}::uuid
        AND active_user.id = ${input.userId}::uuid
    )
    SELECT DISTINCT
      binding.id::text AS binding_id,
      binding.resource_type,
      binding.account_id::text AS account_id,
      binding.folder_id::text AS folder_id,
      binding.message_id::text AS message_id
    FROM active_subjects AS subject
    INNER JOIN mail_acl_bindings AS binding
      ON binding.workspace_id = ${input.workspaceId}::uuid
      AND binding.subject_type = subject.subject_type
      AND binding.subject_id = subject.subject_id
    INNER JOIN mail_acl_binding_permissions AS permission
      ON permission.binding_id = binding.id
    WHERE permission.permission_key = ${input.permission}
    ORDER BY binding_id, account_id, folder_id NULLS FIRST, message_id NULLS FIRST
  `.execute(trx);

  const grants = result.rows.map(mapGrantRow);
  if (grants.length === 0) return grants;

  const bindingIds = [...new Set(grants.map((grant) => grant.bindingId))];
  const constraintMap = await loadConstraintsByBinding(trx, bindingIds);
  return grants.map((grant) => ({
    ...grant,
    constraints: constraintMap.get(grant.bindingId) ?? null,
  }));
}

async function loadConstraintsByBinding(
  trx: WorkspaceTransaction,
  bindingIds: readonly number[],
): Promise<Map<number, MailBindingVisibilityConstraints | null>> {
  const map = new Map<number, MailBindingVisibilityConstraints | null>();
  if (bindingIds.length === 0) return map;

  const result = await sql<ConstraintRow>`
    SELECT
      binding_id::text AS binding_id,
      kind,
      mode,
      assignment_mode,
      value_ids,
      value_texts
    FROM mail_acl_binding_constraints
    WHERE binding_id in (${sql.join(bindingIds)})
    ORDER BY binding_id, kind, mode
  `.execute(trx).catch(() => ({ rows: [] as ConstraintRow[] }));

  const builders = new Map<number, {
    assignmentMode: MailBindingVisibilityConstraints['assignmentMode'];
    categoryAllowIds: number[];
    categoryExcludeIds: number[];
    tagAllowValues: string[];
    tagExcludeValues: string[];
  }>();

  for (const row of result.rows) {
    const bindingId = parseDatabaseId(row.binding_id, 'binding_id');
    const current = builders.get(bindingId) ?? {
      assignmentMode: null,
      categoryAllowIds: [],
      categoryExcludeIds: [],
      tagAllowValues: [],
      tagExcludeValues: [],
    };
    if (row.kind === 'assignment' && row.assignment_mode) {
      current.assignmentMode = row.assignment_mode as MailBindingVisibilityConstraints['assignmentMode'];
    } else if (row.kind === 'category') {
      const ids = parseIntArray(row.value_ids);
      if (row.mode === 'allow') current.categoryAllowIds.push(...ids);
      if (row.mode === 'exclude') current.categoryExcludeIds.push(...ids);
    } else if (row.kind === 'tag') {
      const texts = parseTextArray(row.value_texts);
      if (row.mode === 'allow') current.tagAllowValues.push(...texts);
      if (row.mode === 'exclude') current.tagExcludeValues.push(...texts);
    }
    builders.set(bindingId, current);
  }

  for (const bindingId of bindingIds) {
    const built = builders.get(bindingId);
    if (!built) {
      map.set(bindingId, null);
      continue;
    }
    const constraints: MailBindingVisibilityConstraints = {
      assignmentMode: built.assignmentMode && built.assignmentMode !== 'any' ? built.assignmentMode : null,
      categoryAllowIds: [...new Set(built.categoryAllowIds)].sort((a, b) => a - b),
      categoryExcludeIds: [...new Set(built.categoryExcludeIds)].sort((a, b) => a - b),
      tagAllowValues: [...new Set(built.tagAllowValues)].sort(),
      tagExcludeValues: [...new Set(built.tagExcludeValues)].sort(),
    };
    const empty = (
      constraints.assignmentMode === null
      && constraints.categoryAllowIds.length === 0
      && constraints.categoryExcludeIds.length === 0
      && constraints.tagAllowValues.length === 0
      && constraints.tagExcludeValues.length === 0
    );
    map.set(bindingId, empty ? null : constraints);
  }
  return map;
}

async function resolveActorContext(
  trx: WorkspaceTransaction,
  workspaceId: string,
  userId: string,
): Promise<MailScopeActorContext> {
  const rows = await sql<{ user_id: string }>`
    SELECT DISTINCT member.user_id::text AS user_id
    FROM user_group_members AS mine
    INNER JOIN user_group_members AS member
      ON member.workspace_id = mine.workspace_id
      AND member.group_id = mine.group_id
    WHERE mine.workspace_id = ${workspaceId}::uuid
      AND mine.user_id = ${userId}::uuid
    UNION
    SELECT ${userId}::text AS user_id
  `.execute(trx);
  return {
    userId,
    groupMemberUserIds: rows.rows.map((row) => row.user_id).sort(),
  };
}

async function resolveMessageFacts(
  trx: WorkspaceTransaction,
  workspaceId: string,
  messageId: number,
): Promise<MailMessageVisibilityFacts | null> {
  const message = await sql<{
    assigned_to_user_id: string | null;
    assigned_to: string | null;
  }>`
    SELECT assigned_to_user_id::text AS assigned_to_user_id, assigned_to
    FROM email_messages
    WHERE workspace_id = ${workspaceId}::uuid
      AND id = ${messageId}
  `.execute(trx);
  const row = message.rows[0];
  if (!row) return null;

  const categories = await sql<{ category_id: string }>`
    SELECT category_id::text AS category_id
    FROM email_message_categories
    WHERE workspace_id = ${workspaceId}::uuid
      AND message_id = ${messageId}
      AND category_id IS NOT NULL
  `.execute(trx);

  const tags = await sql<{ tag: string }>`
    SELECT tag
    FROM email_message_tags
    WHERE workspace_id = ${workspaceId}::uuid
      AND message_id = ${messageId}
  `.execute(trx);

  return {
    assignedToUserId: row.assigned_to_user_id,
    assignedTo: row.assigned_to,
    categoryIds: categories.rows
      .map((entry) => Number(entry.category_id))
      .filter((id) => Number.isSafeInteger(id) && id > 0),
    tags: tags.rows.map((entry) => entry.tag),
  };
}

function mapGrantRow(row: MailAccessGrantRow): MailAccessGrant {
  const bindingId = parseDatabaseId(row.binding_id, 'binding_id');
  const accountId = parseDatabaseId(row.account_id, 'account_id');
  const constraints = null;

  if (row.resource_type === 'account' && row.folder_id === null && row.message_id === null) {
    return { bindingId, resourceType: 'account', accountId, folderId: null, messageId: null, constraints };
  }

  const folderId = parseDatabaseId(row.folder_id, 'folder_id');
  if (row.resource_type === 'folder' && row.message_id === null) {
    return { bindingId, resourceType: 'folder', accountId, folderId, messageId: null, constraints };
  }

  if (row.resource_type === 'message') {
    return {
      bindingId,
      resourceType: 'message',
      accountId,
      folderId,
      messageId: parseDatabaseId(row.message_id, 'message_id'),
      constraints,
    };
  }

  throw new Error('mail access query returned an invalid resource shape');
}

function parseDatabaseId(value: string | null, field: string): number {
  if (value === null || !/^[1-9]\d*$/.test(value)) {
    throw new Error(`mail access query returned an invalid ${field}`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || String(parsed) !== value) {
    throw new Error(`mail access query returned an unsafe ${field}`);
  }
  return parsed;
}

function parseIntArray(value: number[] | string | null): number[] {
  if (Array.isArray(value)) {
    return value.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0);
  }
  if (typeof value === 'string') {
    // Postgres may return "{1,2}" style.
    const inner = value.replace(/^\{|\}$/g, '');
    if (!inner) return [];
    return inner.split(',').map(Number).filter((id) => Number.isSafeInteger(id) && id > 0);
  }
  return [];
}

function parseTextArray(value: string[] | string | null): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value === 'string') {
    const inner = value.replace(/^\{|\}$/g, '');
    if (!inner) return [];
    return inner.split(',').map((part) => part.replace(/^"|"$/g, '').replace(/\\"/g, '"')).filter(Boolean);
  }
  return [];
}

export { EMPTY_MAIL_BINDING_CONSTRAINTS };
