import type { Kysely } from 'kysely';

import type { ConversationLockApiPort, ConversationLockRecord } from '../api';
import type { ConversationLockReason } from '../locks';
import type { ConversationLockRow, ServerDatabase } from './schema';
import { withWorkspaceTransaction, type WorkspaceTransaction } from './workspace-context';

export type PostgresConversationLockPortOptions = Readonly<{
  db: Kysely<ServerDatabase>;
}>;

export function createPostgresConversationLockPort(
  options: PostgresConversationLockPortOptions,
): ConversationLockApiPort {
  return {
    async list(input) {
      const messageIds = uniquePositiveIds(input.messageIds);
      if (messageIds.length === 0) return [];
      return withWorkspaceTransaction(options.db, {
        workspaceId: input.workspaceId,
        role: 'system',
      }, async (db) => {
        const rows = await baseLockSelect(db)
          .where('l.message_id', 'in', messageIds)
          .where('l.workspace_id', '=', input.workspaceId)
          .execute();
        return rows.map(mapLock);
      });
    },

    async acquire(input) {
      return withWorkspaceTransaction(options.db, {
        workspaceId: input.workspaceId,
        userId: input.userId,
        role: 'user',
      }, async (db) => {
        const inserted = await db
          .insertInto('conversation_locks')
          .values({
            message_id: input.messageId,
            user_id: input.userId,
            workspace_id: input.workspaceId,
            reason: input.reason,
          })
          .onConflict((oc) => oc.column('message_id').doNothing())
          .returning([
            'message_id',
            'user_id',
            'workspace_id',
            'acquired_at',
            'last_heartbeat_at',
            'reason',
            'takeover_count',
          ])
          .executeTakeFirst();

        if (inserted) return { ok: true, lock: mapLock(inserted) };

        const existing = await selectLock(db, {
          messageId: input.messageId,
          workspaceId: input.workspaceId,
        });
        if (!existing) {
          throw new Error('conversation lock conflict row was not visible');
        }
        return { ok: false, existing };
      });
    },

    async get(input) {
      return withWorkspaceTransaction(options.db, {
        workspaceId: input.workspaceId,
        role: 'system',
      }, (db) => selectLock(db, input));
    },

    async heartbeat(input) {
      return withWorkspaceTransaction(options.db, {
        workspaceId: input.workspaceId,
        userId: input.userId,
        role: 'user',
      }, async (db) => {
        const row = await db
          .updateTable('conversation_locks')
          .set({ last_heartbeat_at: new Date() })
          .where('message_id', '=', input.messageId)
          .where('user_id', '=', input.userId)
          .where('workspace_id', '=', input.workspaceId)
          .returning([
            'message_id',
            'user_id',
            'workspace_id',
            'acquired_at',
            'last_heartbeat_at',
            'reason',
            'takeover_count',
          ])
          .executeTakeFirst();

        return row ? mapLock(row) : null;
      });
    },

    async release(input) {
      return withWorkspaceTransaction(options.db, {
        workspaceId: input.workspaceId,
        userId: input.userId,
        role: input.allowAdminOverride ? 'admin' : 'user',
      }, async (db) => {
        let query = db
          .deleteFrom('conversation_locks')
          .where('message_id', '=', input.messageId)
          .where('workspace_id', '=', input.workspaceId);

        if (!input.allowAdminOverride) {
          query = query.where('user_id', '=', input.userId);
        }

        const row = await query
          .returning([
            'message_id',
            'user_id',
            'workspace_id',
            'acquired_at',
            'last_heartbeat_at',
            'reason',
            'takeover_count',
          ])
          .executeTakeFirst();

        return row ? mapLock(row) : null;
      });
    },

    async forceTakeover(input) {
      return withWorkspaceTransaction(options.db, {
        workspaceId: input.workspaceId,
        userId: input.newUserId,
        role: 'admin',
      }, async (db) => {
        const removed = await db
          .deleteFrom('conversation_locks')
          .where('message_id', '=', input.messageId)
          .where('workspace_id', '=', input.workspaceId)
          .returning(['takeover_count'])
          .executeTakeFirst();

        const row = await db
          .insertInto('conversation_locks')
          .values({
            message_id: input.messageId,
            user_id: input.newUserId,
            workspace_id: input.workspaceId,
            reason: input.reason,
            takeover_count: (removed?.takeover_count ?? 0) + 1,
          })
          .returning([
            'message_id',
            'user_id',
            'workspace_id',
            'acquired_at',
            'last_heartbeat_at',
            'reason',
            'takeover_count',
          ])
          .executeTakeFirstOrThrow();

        return mapLock(row);
      });
    },
  };
}

async function selectLock(
  db: WorkspaceTransaction,
  input: {
    messageId: number;
    workspaceId: string;
  },
): Promise<ConversationLockRecord | null> {
  const row = await baseLockSelect(db)
    .where('l.message_id', '=', input.messageId)
    .where('l.workspace_id', '=', input.workspaceId)
    .executeTakeFirst();

  return row ? mapLock(row) : null;
}

function baseLockSelect(db: WorkspaceTransaction) {
  return db
    .selectFrom('conversation_locks as l')
    .innerJoin('users as u', (join) => join
      .onRef('u.id', '=', 'l.user_id')
      .onRef('u.workspace_id', '=', 'l.workspace_id'))
    .select([
      'l.message_id as message_id',
      'l.user_id as user_id',
      'l.workspace_id as workspace_id',
      'l.acquired_at as acquired_at',
      'l.last_heartbeat_at as last_heartbeat_at',
      'l.reason as reason',
      'l.takeover_count as takeover_count',
      'u.display_name as display_name',
      'u.email as email',
    ]);
}

function uniquePositiveIds(values: readonly number[]): number[] {
  return [...new Set(values)]
    .filter((value) => Number.isSafeInteger(value) && value > 0)
    .slice(0, 500);
}

function mapLock(row: ConversationLockRow): ConversationLockRecord {
  return {
    messageId: Number(row.message_id),
    userId: row.user_id,
    workspaceId: row.workspace_id,
    acquiredAt: toDate(row.acquired_at).toISOString(),
    lastHeartbeatAt: toDate(row.last_heartbeat_at).toISOString(),
    reason: row.reason as ConversationLockReason,
    takeoverCount: row.takeover_count,
    displayName: row.display_name ?? undefined,
    email: row.email ?? undefined,
  };
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}
