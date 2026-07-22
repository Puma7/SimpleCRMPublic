import { sql, type RawBuilder } from 'kysely';

import type { MailSqlScope } from './types';

export type MailScopeColumns = Readonly<{
  accountId?: string;
  folderId?: string;
  messageId?: string;
}>;

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

  const branches: RawBuilder<boolean>[] = [];
  addIdBranches(branches, columns.accountId, effective.accountIds);
  addIdBranches(branches, columns.folderId, effective.folderIds);
  addIdBranches(branches, columns.messageId, effective.messageIds);
  if (branches.length === 0) return sql<boolean>`false`;
  return sql<boolean>`(${sql.join(branches, sql` or `)})`;
}

function addIdBranches(
  branches: RawBuilder<boolean>[],
  column: string | undefined,
  ids: readonly number[],
): void {
  if (!column || ids.length === 0) return;
  branches.push(sql<boolean>`${sql.ref(column)} in (${sql.join(ids)})`);
}
