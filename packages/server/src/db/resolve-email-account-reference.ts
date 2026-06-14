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
  const row = byId ?? await trx
    .selectFrom('email_accounts')
    .select(['id', 'source_sqlite_id'])
    .where('workspace_id', '=', workspaceId)
    .where('source_sqlite_id', '=', accountId)
    .executeTakeFirst();
  if (!row) return null;
  return {
    id: Number(row.id),
    sourceSqliteId: Number(row.source_sqlite_id ?? row.id),
  };
}
