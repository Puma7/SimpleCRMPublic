import type { Kysely, Transaction } from 'kysely';

import type { ServerDatabase } from './schema';

export type ServerSessionRole = 'owner' | 'admin' | 'user' | 'system';

export type WorkspaceSessionContext = Readonly<{
  workspaceId: string;
  userId?: string;
  role?: ServerSessionRole;
  crossWorkspaceAccess?: boolean;
}>;

export type WorkspaceSessionCommand = Readonly<{
  sql: string;
  params: readonly [string, string, ServerSessionRole, 'on' | 'off'];
}>;

export type WorkspaceTransaction = Transaction<ServerDatabase>;

export type WorkspaceSessionApplier = (
  trx: WorkspaceTransaction,
  command: WorkspaceSessionCommand,
) => Promise<void>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function buildWorkspaceSessionCommand(input: WorkspaceSessionContext): WorkspaceSessionCommand {
  const workspaceId = normalizeUuid(input.workspaceId, 'workspaceId');
  const userId = input.userId === undefined ? '' : normalizeUuid(input.userId, 'userId');
  const role = input.role ?? 'system';
  assertServerSessionRole(role);
  const crossWorkspaceAccess = input.crossWorkspaceAccess === true ? 'on' : 'off';
  return {
    sql: [
      "SELECT set_config('app.workspace_id', $1, true),",
      "set_config('app.user_id', $2, true),",
      "set_config('app.role', $3, true),",
      "set_config('app.cross_workspace_access', $4, true);",
    ].join(' '),
    params: [workspaceId, userId, role, crossWorkspaceAccess],
  };
}

export async function withWorkspaceTransaction<T>(
  db: Kysely<ServerDatabase>,
  context: WorkspaceSessionContext,
  operation: (trx: WorkspaceTransaction) => Promise<T>,
  options: { applySession?: WorkspaceSessionApplier } = {},
): Promise<T> {
  const command = buildWorkspaceSessionCommand(context);
  return db.transaction().execute(async (trx) => {
    await (options.applySession ?? applyWorkspaceSessionCommand)(trx, command);
    return operation(trx);
  });
}

async function applyWorkspaceSessionCommand(
  trx: WorkspaceTransaction,
  command: WorkspaceSessionCommand,
): Promise<void> {
  const { sql: kyselySql } = require('kysely') as typeof import('kysely');
  await kyselySql`
    SELECT
      set_config('app.workspace_id', ${command.params[0]}, true),
      set_config('app.user_id', ${command.params[1]}, true),
      set_config('app.role', ${command.params[2]}, true),
      set_config('app.cross_workspace_access', ${command.params[3]}, true)
  `.execute(trx);
}

function normalizeUuid(value: string, key: string): string {
  const normalized = value.trim();
  if (!UUID_RE.test(normalized)) {
    throw new Error(`${key} must be a UUID`);
  }
  return normalized.toLowerCase();
}

function assertServerSessionRole(value: string): asserts value is ServerSessionRole {
  if (!['owner', 'admin', 'user', 'system'].includes(value)) {
    throw new Error('role must be owner, admin, user, or system');
  }
}
