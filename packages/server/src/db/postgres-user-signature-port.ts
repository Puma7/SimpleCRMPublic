import type { Kysely } from 'kysely';

import type {
  EmailUserSignatureApiPort,
  EmailUserSignatureListResult,
  EmailUserSignatureRecord,
} from '../api/types';
import type { ServerDatabase } from './schema';
import { resolveEmailAccountReference } from './resolve-email-account-reference';
import {
  withWorkspaceTransaction,
  type WorkspaceSessionApplier,
} from './workspace-context';

export type PostgresUserSignaturePortOptions = Readonly<{
  db: Kysely<ServerDatabase>;
  applyWorkspaceSession?: WorkspaceSessionApplier;
}>;

const MAX_SIGNATURE_HTML = 20_000;

// Mirror mapEmailAccountRecord on the client: the UI keys accounts by the
// legacy source_sqlite_id when present (>0), else the postgres id. Per-user
// signatures must report the same id so the compose lookup matches.
function legacyAccountId(row: { id: number | string; source_sqlite_id: number | string | null }): number {
  const sourceId = row.source_sqlite_id == null ? null : Number(row.source_sqlite_id);
  if (sourceId != null && sourceId > 0) return sourceId;
  return Number(row.id);
}

export function createPostgresUserSignaturePort(
  options: PostgresUserSignaturePortOptions,
): EmailUserSignatureApiPort {
  const readSession = { applySession: options.applyWorkspaceSession } as const;

  return {
    async listForUser(input): Promise<EmailUserSignatureListResult> {
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, userId: input.userId, role: 'user' },
        async (trx) => {
          const user = await trx
            .selectFrom('users')
            .select(['display_name', 'public_name'])
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.userId)
            .executeTakeFirst();
          const rows = await trx
            .selectFrom('user_account_signatures')
            .innerJoin('email_accounts', 'email_accounts.id', 'user_account_signatures.account_id')
            .select([
              'email_accounts.id as id',
              'email_accounts.source_sqlite_id as source_sqlite_id',
              'user_account_signatures.signature_html as signature_html',
              'user_account_signatures.updated_at as updated_at',
            ])
            .where('user_account_signatures.workspace_id', '=', input.workspaceId)
            .where('user_account_signatures.user_id', '=', input.userId)
            .execute();
          const signatures: EmailUserSignatureRecord[] = rows.map((row) => ({
            accountId: legacyAccountId(row),
            signatureHtml: row.signature_html ?? '',
            updatedAt: row.updated_at ? new Date(row.updated_at as unknown as string).toISOString() : null,
          }));
          return {
            user: {
              displayName: user?.display_name ?? '',
              publicName: user?.public_name ?? null,
            },
            signatures,
          };
        },
        readSession,
      );
    },

    async upsert(input) {
      const html = (input.signatureHtml ?? '').trim().slice(0, MAX_SIGNATURE_HTML);
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, userId: input.userId, role: 'user' },
        async (trx) => {
          const account = await resolveEmailAccountReference(trx, input.workspaceId, input.accountId);
          if (!account) return { ok: false as const, code: 'account_not_found' as const };
          if (!html) {
            await trx
              .deleteFrom('user_account_signatures')
              .where('workspace_id', '=', input.workspaceId)
              .where('user_id', '=', input.userId)
              .where('account_id', '=', account.id)
              .execute();
            return { ok: true as const };
          }
          await trx
            .insertInto('user_account_signatures')
            .values({
              workspace_id: input.workspaceId,
              user_id: input.userId,
              account_id: account.id,
              signature_html: html,
              updated_at: new Date(),
            })
            .onConflict((oc) => oc
              .columns(['workspace_id', 'user_id', 'account_id'])
              .doUpdateSet({ signature_html: html, updated_at: new Date() }))
            .execute();
          return { ok: true as const };
        },
        readSession,
      );
    },
  };
}
