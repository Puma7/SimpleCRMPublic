import type { Kysely } from 'kysely';
import { sql } from 'kysely';

import type { ServerDatabase } from '../db/schema';
import {
  withWorkspaceTransaction,
  type WorkspaceSessionApplier,
} from '../db/workspace-context';
import type {
  MailAccessGrant,
  MailAccessPort,
  ResolveMailAccessGrantsInput,
} from './types';

export type PostgresMailAccessPortOptions = Readonly<{
  db: Kysely<ServerDatabase>;
  applyWorkspaceSession?: WorkspaceSessionApplier;
}>;

type MailAccessGrantRow = Readonly<{
  resource_type: string;
  account_id: string;
  folder_id: string | null;
  message_id: string | null;
}>;

export function createPostgresMailAccessPort(options: PostgresMailAccessPortOptions): MailAccessPort {
  const sessionOptions = { applySession: options.applyWorkspaceSession } as const;

  return {
    async resolveGrants(input: ResolveMailAccessGrantsInput): Promise<readonly MailAccessGrant[]> {
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, userId: input.userId, role: 'user' },
        async (trx) => {
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
            ORDER BY account_id, folder_id NULLS FIRST, message_id NULLS FIRST
          `.execute(trx);

          return result.rows.map(mapGrantRow);
        },
        sessionOptions,
      );
    },
  };
}

function mapGrantRow(row: MailAccessGrantRow): MailAccessGrant {
  const accountId = parseDatabaseId(row.account_id, 'account_id');

  if (row.resource_type === 'account' && row.folder_id === null && row.message_id === null) {
    return { resourceType: 'account', accountId, folderId: null, messageId: null };
  }

  const folderId = parseDatabaseId(row.folder_id, 'folder_id');
  if (row.resource_type === 'folder' && row.message_id === null) {
    return { resourceType: 'folder', accountId, folderId, messageId: null };
  }

  if (row.resource_type === 'message') {
    return {
      resourceType: 'message',
      accountId,
      folderId,
      messageId: parseDatabaseId(row.message_id, 'message_id'),
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
