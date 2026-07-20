import type { WorkspaceTransaction } from './workspace-context';

export type EmailAccountReference = Readonly<{
  id: number;
  sourceSqliteId: number;
}>;

/** Accepts postgres id or legacy public id (source_sqlite_id) from migrated workspaces. */
export async function resolveEmailAccountReference(
  trx: WorkspaceTransaction,
  workspaceId: string,
  accountId: number,
): Promise<EmailAccountReference | null> {
  const byId = await trx
    .selectFrom('email_accounts')
    .select(['id', 'source_sqlite_id'])
    .where('workspace_id', '=', workspaceId)
    .where('id', '=', accountId)
    .executeTakeFirst();
  const bySource = await trx
    .selectFrom('email_accounts')
    .select(['id', 'source_sqlite_id'])
    .where('workspace_id', '=', workspaceId)
    .where('source_sqlite_id', '=', accountId)
    .executeTakeFirst();
  // Fail closed on an ambiguous reference: if `accountId` matches one account by
  // postgres id AND a *different* account by legacy source_sqlite_id, this
  // resolver (used by the mail ACL layer) and the route handlers
  // (selectEmailAccountByPublicId, which prefers source_sqlite_id) would resolve
  // to different accounts — a confused-deputy authorization bypass. Refuse
  // rather than silently pick one.
  if (byId && bySource && Number(byId.id) !== Number(bySource.id)) return null;
  const row = byId ?? bySource;
  if (!row) return null;
  return {
    id: Number(row.id),
    sourceSqliteId: Number(row.source_sqlite_id ?? row.id),
  };
}
