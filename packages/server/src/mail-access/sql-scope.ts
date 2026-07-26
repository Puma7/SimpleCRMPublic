import { sql, type RawBuilder } from 'kysely';

import { hasMailBindingConstraints } from './mail-acl-constraints';
import type { MailBindingVisibilityConstraints, MailScopeActorContext, MailSqlScope } from './types';

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
      .map((clause) => clausePredicate(clause.accountIds, clause.folderIds, clause.messageIds, clause.constraints, columns, effective.actor))
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
  accountIds: readonly number[],
  folderIds: readonly number[],
  messageIds: readonly number[],
  constraints: MailBindingVisibilityConstraints | null,
  columns: MailScopeColumns,
  actor: MailScopeActorContext | undefined,
): RawBuilder<boolean> | undefined {
  const branches: RawBuilder<boolean>[] = [];
  addIdBranches(branches, columns.accountId, accountIds);
  addIdBranches(branches, columns.folderId, folderIds);
  addIdBranches(branches, columns.messageId, messageIds);
  if (branches.length === 0) return undefined;
  const resourcePred = sql<boolean>`(${sql.join(branches, sql` or `)})`;
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
  const mode = constraints.assignmentMode;
  if (mode && mode !== 'any') {
    // Fail closed: assignment filters without actor or assignee columns must not
    // widen via remaining category/tag predicates alone.
    if (!canEnforceAssignmentFilter(constraints, columns, actor)) {
      return sql<boolean>`false`;
    }
    const assignedUserCol = columns.assignedToUserId ?? null;
    const assignedCol = columns.assignedTo ?? null;
    if (mode === 'unassigned') {
      if (assignedUserCol && assignedCol) {
        parts.push(sql<boolean>`(${sql.ref(assignedUserCol)} is null and (${sql.ref(assignedCol)} is null or ${sql.ref(assignedCol)} = ''))`);
      } else if (assignedUserCol) {
        parts.push(sql<boolean>`${sql.ref(assignedUserCol)} is null`);
      } else {
        parts.push(sql<boolean>`(${sql.ref(assignedCol)} is null or ${sql.ref(assignedCol)} = '')`);
      }
    } else if (mode === 'assigned_to_me') {
      if (assignedUserCol && assignedCol) {
        parts.push(sql<boolean>`(coalesce(${sql.ref(assignedUserCol)}::text, ${sql.ref(assignedCol)}) = ${actor!.userId})`);
      } else if (assignedUserCol) {
        parts.push(sql<boolean>`${sql.ref(assignedUserCol)}::text = ${actor!.userId}`);
      } else {
        parts.push(sql<boolean>`${sql.ref(assignedCol)} = ${actor!.userId}`);
      }
    } else if (mode === 'assigned_to_my_groups') {
      const ids = actor!.groupMemberUserIds.length > 0 ? actor!.groupMemberUserIds : [actor!.userId];
      if (assignedUserCol && assignedCol) {
        parts.push(sql<boolean>`(coalesce(${sql.ref(assignedUserCol)}::text, ${sql.ref(assignedCol)}) in (${sql.join(ids)}))`);
      } else if (assignedUserCol) {
        parts.push(sql<boolean>`${sql.ref(assignedUserCol)}::text in (${sql.join(ids)})`);
      } else {
        parts.push(sql<boolean>`${sql.ref(assignedCol)} in (${sql.join(ids)})`);
      }
    }
  }

  if (constraints.categoryAllowIds.length > 0) {
    parts.push(sql<boolean>`exists (
      select 1 from email_message_categories _emc_allow
      where _emc_allow.message_id = ${sql.ref(messageCol)}
        and _emc_allow.category_id in (${sql.join(constraints.categoryAllowIds)})
    )`);
  }
  if (constraints.categoryExcludeIds.length > 0) {
    parts.push(sql<boolean>`not exists (
      select 1 from email_message_categories _emc_excl
      where _emc_excl.message_id = ${sql.ref(messageCol)}
        and _emc_excl.category_id in (${sql.join(constraints.categoryExcludeIds)})
    )`);
  }
  if (constraints.tagAllowValues.length > 0) {
    parts.push(sql<boolean>`exists (
      select 1 from email_message_tags _emt_allow
      where _emt_allow.message_id = ${sql.ref(messageCol)}
        and _emt_allow.tag in (${sql.join(constraints.tagAllowValues)})
    )`);
  }
  if (constraints.tagExcludeValues.length > 0) {
    parts.push(sql<boolean>`not exists (
      select 1 from email_message_tags _emt_excl
      where _emt_excl.message_id = ${sql.ref(messageCol)}
        and _emt_excl.tag in (${sql.join(constraints.tagExcludeValues)})
    )`);
  }

  if (parts.length === 0) return undefined;
  return sql<boolean>`(${sql.join(parts, sql` and `)})`;
}

function addIdBranches(
  branches: RawBuilder<boolean>[],
  column: string | undefined,
  ids: readonly number[],
): void {
  if (!column || ids.length === 0) return;
  branches.push(sql<boolean>`${sql.ref(column)} in (${sql.join(ids)})`);
}
