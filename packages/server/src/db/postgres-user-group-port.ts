import type { Kysely, Selectable } from 'kysely';

import type {
  UserGroupAddMemberResult,
  UserGroupApiPort,
  UserGroupMemberRecord,
  UserGroupMutationResult,
  UserGroupRecord,
  UserGroupRemoveMemberResult,
} from '../api/types';
import type { ServerDatabase, UserGroupsTable } from './schema';
import {
  withWorkspaceTransaction,
  type WorkspaceSessionApplier,
} from './workspace-context';

export type PostgresUserGroupPortOptions = Readonly<{
  db: Kysely<ServerDatabase>;
  applyWorkspaceSession?: WorkspaceSessionApplier;
}>;

type UserGroupRow = Selectable<UserGroupsTable>;
const groupColumns = ['id', 'name', 'description', 'updated_at'] as const;

export function createPostgresUserGroupPort(options: PostgresUserGroupPortOptions): UserGroupApiPort {
  const readSession = { applySession: options.applyWorkspaceSession } as const;

  return {
    async list(input): Promise<UserGroupRecord[]> {
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          const rows = await trx
            .selectFrom('user_groups')
            .select(groupColumns)
            .where('workspace_id', '=', input.workspaceId)
            .orderBy('name', 'asc')
            .execute();
          const counts = await trx
            .selectFrom('user_group_members')
            .select((eb) => ['group_id', eb.fn.countAll<number>().as('count')])
            .where('workspace_id', '=', input.workspaceId)
            .groupBy('group_id')
            .execute();
          const countByGroup = new Map(counts.map((row) => [Number(row.group_id), Number(row.count)]));
          return rows.map((row) => mapGroupRow(row, countByGroup.get(Number(row.id)) ?? 0));
        },
        readSession,
      );
    },

    async create(input): Promise<UserGroupMutationResult> {
      const name = input.name.trim();
      if (!name) return { ok: false, code: 'invalid_name' };
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, userId: input.actorUserId, role: 'user' },
        async (trx) => {
          const now = new Date();
          try {
            const row = await trx
              .insertInto('user_groups')
              .values({
                workspace_id: input.workspaceId,
                name,
                description: input.description?.trim() || null,
                created_at: now,
                updated_at: now,
              })
              .returning(groupColumns)
              .executeTakeFirstOrThrow();
            return { ok: true, group: mapGroupRow(row, 0) };
          } catch (caught) {
            if (isUniqueViolation(caught)) return { ok: false, code: 'duplicate_name' };
            throw caught;
          }
        },
        readSession,
      );
    },

    async update(input): Promise<UserGroupMutationResult> {
      const name = input.name?.trim();
      if (input.name !== undefined && !name) return { ok: false, code: 'invalid_name' };
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, userId: input.actorUserId, role: 'user' },
        async (trx) => {
          const now = new Date();
          try {
            const row = await trx
              .updateTable('user_groups')
              .set({
                ...(name === undefined ? {} : { name }),
                ...(input.description === undefined ? {} : { description: input.description?.trim() || null }),
                updated_at: now,
              })
              .where('workspace_id', '=', input.workspaceId)
              .where('id', '=', input.id)
              .returning(groupColumns)
              .executeTakeFirst();
            if (!row) return { ok: false, code: 'not_found' };
            const count = await memberCount(trx, input.workspaceId, input.id);
            return { ok: true, group: mapGroupRow(row, count) };
          } catch (caught) {
            if (isUniqueViolation(caught)) return { ok: false, code: 'duplicate_name' };
            throw caught;
          }
        },
        readSession,
      );
    },

    async delete(input): Promise<UserGroupRecord | null> {
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, userId: input.actorUserId, role: 'user' },
        async (trx) => {
          const count = await memberCount(trx, input.workspaceId, input.id);
          const row = await trx
            .deleteFrom('user_groups')
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.id)
            .returning(groupColumns)
            .executeTakeFirst();
          return row ? mapGroupRow(row, count) : null;
        },
        readSession,
      );
    },

    async listMembers(input): Promise<UserGroupMemberRecord[] | null> {
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          const group = await trx
            .selectFrom('user_groups')
            .select('id')
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.groupId)
            .executeTakeFirst();
          if (!group) return null;
          const rows = await trx
            .selectFrom('user_group_members')
            .innerJoin('users', 'users.id', 'user_group_members.user_id')
            .select(['users.id as user_id', 'users.email', 'users.display_name', 'users.role'])
            .where('user_group_members.workspace_id', '=', input.workspaceId)
            .where('user_group_members.group_id', '=', input.groupId)
            .orderBy('users.display_name', 'asc')
            .execute();
          return rows.map((row) => ({
            userId: String(row.user_id),
            email: row.email,
            displayName: row.display_name,
            role: row.role,
          }));
        },
        readSession,
      );
    },

    async addMember(input): Promise<UserGroupAddMemberResult> {
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, userId: input.actorUserId, role: 'user' },
        async (trx) => {
          const group = await trx
            .selectFrom('user_groups')
            .select('id')
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.groupId)
            .executeTakeFirst();
          if (!group) return { ok: false, code: 'group_not_found' };
          const user = await trx
            .selectFrom('users')
            .select('id')
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.userId)
            .executeTakeFirst();
          if (!user) return { ok: false, code: 'user_not_found' };
          await trx
            .insertInto('user_group_members')
            .values({
              workspace_id: input.workspaceId,
              group_id: input.groupId,
              user_id: input.userId,
              created_at: new Date(),
            })
            .onConflict((oc) => oc.columns(['group_id', 'user_id']).doNothing())
            .execute();
          return { ok: true };
        },
        readSession,
      );
    },

    async removeMember(input): Promise<UserGroupRemoveMemberResult> {
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, userId: input.actorUserId, role: 'user' },
        async (trx) => {
          const group = await trx
            .selectFrom('user_groups')
            .select('id')
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.groupId)
            .executeTakeFirst();
          if (!group) return { ok: false, code: 'group_not_found' };
          await trx
            .deleteFrom('user_group_members')
            .where('workspace_id', '=', input.workspaceId)
            .where('group_id', '=', input.groupId)
            .where('user_id', '=', input.userId)
            .execute();
          return { ok: true };
        },
        readSession,
      );
    },
  };
}

async function memberCount(
  trx: Parameters<Parameters<typeof withWorkspaceTransaction>[2]>[0],
  workspaceId: string,
  groupId: number,
): Promise<number> {
  const row = await trx
    .selectFrom('user_group_members')
    .select((eb) => eb.fn.countAll<number>().as('count'))
    .where('workspace_id', '=', workspaceId)
    .where('group_id', '=', groupId)
    .executeTakeFirst();
  return Number(row?.count ?? 0);
}

function mapGroupRow(
  row: Pick<UserGroupRow, typeof groupColumns[number]>,
  memberCount: number,
): UserGroupRecord {
  return {
    id: Number(row.id),
    name: row.name,
    description: row.description,
    memberCount,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
  };
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(error) && typeof error === 'object' && (error as { code?: string }).code === '23505';
}
