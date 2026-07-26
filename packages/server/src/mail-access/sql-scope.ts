import { sql, type RawBuilder } from 'kysely';

import { hasMailBindingConstraints, isDenyAllCategoryAllowlist, isDenyAllTagAllowlist } from './mail-acl-constraints';
import type {
  MailBindingVisibilityConstraints,
  MailScopeActorContext,
  MailScopeClause,
  MailSqlScope,
} from './types';

export type MailScopeColumns = Readonly<{
  accountId?: string;
  folderId?: string;
  messageId?: string;
  /** Required for assignment filters when constraints are present. */
  assignedToUserId?: string;
  assignedTo?: string;
}>;

/** True when assignment constraints can be applied with the given columns/actor. */
export function canEnforceAssignmentFilter(
  constraints: MailBindingVisibilityConstraints | null | undefined,
  columns: MailScopeColumns,
  actor: MailScopeActorContext | undefined,
): boolean {
  const mode = constraints?.assignmentMode;
  if (!mode || mode === 'any') return true;
  if (!actor) return false;
  return Boolean(columns.assignedToUserId || columns.assignedTo);
}

export function effectiveMailScope(scope: MailSqlScope | undefined): MailSqlScope {
  return scope ?? { kind: 'all' };
}

/** Returns undefined for unrestricted access so existing queries stay byte-for-byte equivalent. */
export function mailScopePredicate(
  scope: MailSqlScope | undefined,
  columns: MailScopeColumns,
): RawBuilder<boolean> | undefined {
  const effective = effectiveMailScope(scope);
  if (effective.kind === 'all') return undefined;
  if (effective.kind === 'none') return sql<boolean>`false`;

  if (effective.clauses && effective.clauses.length > 0) {
    const clausePreds = effective.clauses
      .map((clause) => clausePredicate(clause, columns, effective.actor))
      .filter((pred): pred is RawBuilder<boolean> => pred !== undefined);
    if (clausePreds.length === 0) return sql<boolean>`false`;
    return sql<boolean>`(${sql.join(clausePreds, sql` or `)})`;
  }

  const branches: RawBuilder<boolean>[] = [];
  addIdBranches(branches, columns.accountId, effective.accountIds);
  addIdBranches(branches, columns.folderId, effective.folderIds);
  addIdBranches(branches, columns.messageId, effective.messageIds);
  if (branches.length === 0) return sql<boolean>`false`;
  return sql<boolean>`(${sql.join(branches, sql` or `)})`;
}

function clausePredicate(
  clause: MailScopeClause,
  columns: MailScopeColumns,
  actor: MailScopeActorContext | undefined,
): RawBuilder<boolean> | undefined {
  const branches: RawBuilder<boolean>[] = [];
  addIdBranches(branches, columns.accountId, clause.accountIds);
  addIdBranches(branches, columns.folderId, clause.folderIds);
  addIdBranches(branches, columns.messageId, clause.messageIds);
  if (branches.length === 0) return undefined;
  let resourcePred = sql<boolean>`(${sql.join(branches, sql` or `)})`;
  const excludeFolderIds = clause.excludeFolderIds ?? [];
  const excludeMessageIds = clause.excludeMessageIds ?? [];
  if (excludeFolderIds.length > 0 && columns.folderId) {
    resourcePred = sql<boolean>`(${resourcePred} and ${sql.ref(columns.folderId)} not in (${sql.join(excludeFolderIds)}))`;
  }
  if (excludeMessageIds.length > 0 && columns.messageId) {
    resourcePred = sql<boolean>`(${resourcePred} and ${sql.ref(columns.messageId)} not in (${sql.join(excludeMessageIds)}))`;
  }
  const constraints = clause.constraints;
  if (!hasMailBindingConstraints(constraints) || !constraints) return resourcePred;
  // Account/folder listings without a message id column cannot apply message filters.
  if (!columns.messageId) return resourcePred;
  const visibility = visibilityPredicate(constraints, columns, actor);
  // Fail closed: assignment filters without assignee columns must not widen access.
  if (!visibility) {
    const mode = constraints.assignmentMode;
    if (mode && mode !== 'any') return sql<boolean>`false`;
    return resourcePred;
  }
  return sql<boolean>`(${resourcePred} and ${visibility})`;
}

function visibilityPredicate(
  constraints: MailBindingVisibilityConstraints,
  columns: MailScopeColumns,
  actor: MailScopeActorContext | undefined,
): RawBuilder<boolean> | undefined {
  const parts: RawBuilder<boolean>[] = [];
  const messageCol = columns.messageId!;
  const messageIdRef = outerColumnRef(messageCol);
  const mode = constraints.assignmentMode;
  if (mode && mode !== 'any') {
    // Fail closed: assignment filters without actor or assignee columns must not
    // widen via remaining category/tag predicates alone.
    if (!canEnforceAssignmentFilter(constraints, columns, actor)) {
      return sql<boolean>`false`;
    }
    const assignedUserCol = columns.assignedToUserId;
    const assignedCol = columns.assignedTo;
    const actorId = actor!.userId;
    if (mode === 'unassigned') {
      if (assignedUserCol && assignedCol) {
        parts.push(sql<boolean>`(${sql.ref(assignedUserCol)} is null and (${sql.ref(assignedCol)} is null or ${sql.ref(assignedCol)} = ''))`);
      } else if (assignedUserCol) {
        parts.push(sql<boolean>`${sql.ref(assignedUserCol)} is null`);
      } else if (assignedCol) {
        parts.push(sql<boolean>`(${sql.ref(assignedCol)} is null or ${sql.ref(assignedCol)} = '')`);
      }
    } else if (mode === 'assigned_to_me') {
      if (assignedUserCol && assignedCol) {
        // Prefer assigned_to_user_id (linked workspace UUID). Free-text assigned_to
        // (e.g. agent-2) is only a fallback when no user link is stored.
        parts.push(sql<boolean>`(coalesce(${sql.ref(assignedUserCol)}::text, nullif(${sql.ref(assignedCol)}, '')) = ${actorId})`);
      } else if (assignedUserCol) {
        parts.push(sql<boolean>`${sql.ref(assignedUserCol)}::text = ${actorId}`);
      } else if (assignedCol) {
        parts.push(sql<boolean>`${sql.ref(assignedCol)} = ${actorId}`);
      }
    } else if (mode === 'assigned_to_my_groups') {
      const ids = actor!.groupMemberUserIds.length > 0 ? actor!.groupMemberUserIds : [actorId];
      if (assignedUserCol && assignedCol) {
        parts.push(sql<boolean>`(coalesce(${sql.ref(assignedUserCol)}::text, nullif(${sql.ref(assignedCol)}, '')) in (${sql.join(ids)}))`);
      } else if (assignedUserCol) {
        parts.push(sql<boolean>`${sql.ref(assignedUserCol)}::text in (${sql.join(ids)})`);
      } else if (assignedCol) {
        parts.push(sql<boolean>`${sql.ref(assignedCol)} in (${sql.join(ids)})`);
      }
    }
  }

  if (constraints.categoryAllowIds.length > 0) {
    if (isDenyAllCategoryAllowlist(constraints.categoryAllowIds)) {
      parts.push(sql<boolean>`false`);
    } else {
      parts.push(sql<boolean>`exists (
        select 1 from email_message_categories _emc_allow
        where _emc_allow.message_id = ${messageIdRef}
          and _emc_allow.category_id in (${sql.join(constraints.categoryAllowIds)})
      )`);
    }
  }
  if (constraints.categoryExcludeIds.length > 0) {
    parts.push(sql<boolean>`not exists (
      select 1 from email_message_categories _emc_excl
      where _emc_excl.message_id = ${messageIdRef}
        and _emc_excl.category_id in (${sql.join(constraints.categoryExcludeIds)})
    )`);
  }
  if (constraints.tagAllowValues.length > 0) {
    if (isDenyAllTagAllowlist(constraints.tagAllowValues)) {
      parts.push(sql<boolean>`false`);
    } else {
      parts.push(sql<boolean>`exists (
        select 1 from email_message_tags _emt_allow
        where _emt_allow.message_id = ${messageIdRef}
          and _emt_allow.tag in (${sql.join(constraints.tagAllowValues)})
      )`);
    }
  }
  if (constraints.tagExcludeValues.length > 0) {
    parts.push(sql<boolean>`not exists (
      select 1 from email_message_tags _emt_excl
      where _emt_excl.message_id = ${messageIdRef}
        and _emt_excl.tag in (${sql.join(constraints.tagExcludeValues)})
    )`);
  }

  if (parts.length === 0) return undefined;
  return sql<boolean>`(${sql.join(parts, sql` and `)})`;
}

/**
 * Correlate constraint subqueries to the outer message row. Unqualified names
 * like `id` would otherwise resolve to the nearer category/tag table's `id`.
 */
function outerColumnRef(column: string): RawBuilder<unknown> {
  const qualified = column.includes('.') ? column : `email_messages.${column}`;
  return sql.ref(qualified);
}

function addIdBranches(
  branches: RawBuilder<boolean>[],
  column: string | undefined,
  ids: readonly number[],
): void {
  if (!column || ids.length === 0) return;
  branches.push(sql<boolean>`${sql.ref(column)} in (${sql.join(ids)})`);
}
