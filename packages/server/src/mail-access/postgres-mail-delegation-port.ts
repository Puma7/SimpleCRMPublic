import { sql, type Kysely, type Transaction } from 'kysely';

import type { MailPermission } from '@simplecrm/core';

import type {
  MailDelegationActor,
  MailDelegationApiPort,
  MailDelegationBinding,
  MailDelegationMutationCode,
  MailDelegationResource,
  MailDelegationResourceOption,
  MailDelegationSubject,
  MailDelegationSubjectOption,
} from '../api/types';
import type { ServerDatabase } from '../db/schema';
import {
  withWorkspaceTransaction,
  type WorkspaceSessionApplier,
} from '../db/workspace-context';

export type PostgresMailDelegationPortOptions = Readonly<{
  db: Kysely<ServerDatabase>;
  applyWorkspaceSession?: WorkspaceSessionApplier;
  now?: () => Date;
}>;

type Trx = Transaction<ServerDatabase>;

type BindingRow = Readonly<{
  id: number;
  workspace_id: string;
  subject_type: 'user' | 'group';
  subject_id: string;
  resource_type: 'account' | 'folder' | 'message';
  account_id: number;
  folder_id: number | null;
  message_id: number | null;
  updated_at: Date | string;
  subject_label?: string | null;
  resource_label?: string | null;
}>;

type UserRow = Readonly<{
  id: string;
  display_name: string;
  role: 'owner' | 'admin' | 'user';
  disabled_at: Date | string | null;
}>;

type GroupRow = Readonly<{ id: number; name: string }>;
type AccountRow = Readonly<{ id: number; display_name: string }>;
type FolderRow = Readonly<{ id: number; account_id: number | null; path: string }>;

const MANAGE_PERMISSION: MailPermission = 'mail.delegation.manage';

export function createPostgresMailDelegationPort(
  options: PostgresMailDelegationPortOptions,
): MailDelegationApiPort {
  const sessionOptions = { applySession: options.applyWorkspaceSession } as const;

  return {
    async listResourceOptions(input) {
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, userId: input.actor.userId, role: actorRole(input.actor) },
        async (trx) => {
          if (input.resourceType === 'account') {
            let query = trx
              .selectFrom('email_accounts')
              .select(['id', 'display_name'])
              .where('workspace_id', '=', input.workspaceId);
            if (input.cursor !== undefined) query = query.where('id', '>', input.cursor);
            if (!input.actor.isOwner && !input.actor.isAdmin) {
              query = query.where(sql<boolean>`exists (
                select 1
                from mail_acl_bindings actor_binding
                inner join mail_acl_binding_permissions actor_permission
                  on actor_permission.binding_id = actor_binding.id
                where actor_binding.workspace_id = ${input.workspaceId}
                  and actor_permission.permission_key = ${MANAGE_PERMISSION}
                  and ${actorSubjectSql(input.workspaceId, input.actor.userId)}
                  and actor_binding.resource_type = 'account'
                  and actor_binding.account_id = email_accounts.id
              )`);
            }
            const rows = await query.orderBy('id', 'asc').limit(input.limit + 1).execute();
            const hasMore = rows.length > input.limit;
            const page = (hasMore ? rows.slice(0, input.limit) : rows).map((row) => ({
              type: 'account' as const,
              accountId: dbInteger(row.id, 'email account id'),
              label: row.display_name,
            }));
            return {
              ok: true as const,
              resources: page satisfies MailDelegationResourceOption[],
              nextCursor: hasMore ? page.at(-1)?.accountId ?? null : null,
            };
          }

          let query = trx
            .selectFrom('email_folders')
            .innerJoin('email_accounts', (join) => join
              .onRef('email_accounts.id', '=', 'email_folders.account_id')
              .onRef('email_accounts.workspace_id', '=', 'email_folders.workspace_id'))
            .select([
              'email_folders.id',
              'email_folders.account_id',
              'email_folders.path',
              'email_accounts.display_name as account_label',
            ])
            .where('email_folders.workspace_id', '=', input.workspaceId);
          if (input.cursor !== undefined) query = query.where('email_folders.id', '>', input.cursor);
          if (!input.actor.isOwner && !input.actor.isAdmin) {
            query = query.where(sql<boolean>`exists (
              select 1
              from mail_acl_bindings actor_binding
              inner join mail_acl_binding_permissions actor_permission
                on actor_permission.binding_id = actor_binding.id
              where actor_binding.workspace_id = ${input.workspaceId}
                and actor_permission.permission_key = ${MANAGE_PERMISSION}
                and ${actorSubjectSql(input.workspaceId, input.actor.userId)}
                and actor_binding.account_id = email_folders.account_id
                and (
                  actor_binding.resource_type = 'account'
                  or (
                    actor_binding.resource_type = 'folder'
                    and actor_binding.folder_id = email_folders.id
                  )
                )
            )`);
          }
          const rows = await query.orderBy('email_folders.id', 'asc').limit(input.limit + 1).execute();
          const hasMore = rows.length > input.limit;
          const page = (hasMore ? rows.slice(0, input.limit) : rows).map((row) => ({
            type: 'folder' as const,
            accountId: dbInteger(row.account_id, 'email folder account id'),
            folderId: dbInteger(row.id, 'email folder id'),
            accountLabel: row.account_label,
            label: row.path,
          }));
          return {
            ok: true as const,
            resources: page satisfies MailDelegationResourceOption[],
            nextCursor: hasMore ? page.at(-1)?.folderId ?? null : null,
          };
        },
        sessionOptions,
      );
    },

    async listSubjectOptions(input) {
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, userId: input.actor.userId, role: actorRole(input.actor) },
        async (trx) => {
          const resource = await validateResource(trx, input.workspaceId, input.resource);
          if (!resource.ok) return resource;
          if (!await canManageResource(trx, input.workspaceId, input.actor, input.resource, [])) {
            return { ok: false as const, code: 'permission_denied' as const };
          }

          if (input.subjectType === 'user') {
            let query = trx
              .selectFrom('users')
              .select(['id', 'display_name'])
              .where('workspace_id', '=', input.workspaceId)
              .where('role', '=', 'user')
              .where('disabled_at', 'is', null);
            if (input.cursor !== undefined) query = query.where('id', '>', input.cursor);
            const rows = await query.orderBy('id', 'asc').limit(input.limit + 1).execute();
            const hasMore = rows.length > input.limit;
            const page = (hasMore ? rows.slice(0, input.limit) : rows).map((row) => ({
              type: 'user' as const,
              id: row.id,
              label: row.display_name,
            }));
            return {
              ok: true as const,
              subjects: page satisfies MailDelegationSubjectOption[],
              nextCursor: hasMore ? page.at(-1)?.id ?? null : null,
            };
          }

          const numericCursor = input.cursor === undefined ? undefined : dbInteger(input.cursor, 'group cursor');
          let query = trx
            .selectFrom('user_groups')
            .select(['id', 'name'])
            .where('workspace_id', '=', input.workspaceId);
          if (numericCursor !== undefined) query = query.where('id', '>', numericCursor);
          const rows = await query.orderBy('id', 'asc').limit(input.limit + 1).execute();
          const hasMore = rows.length > input.limit;
          const page = (hasMore ? rows.slice(0, input.limit) : rows).map((row) => ({
            type: 'group' as const,
            id: dbInteger(row.id, 'user group id'),
            label: row.name,
          }));
          return {
            ok: true as const,
            subjects: page satisfies MailDelegationSubjectOption[],
            nextCursor: hasMore ? String(page.at(-1)?.id) : null,
          };
        },
        sessionOptions,
      );
    },

    async listBindings(input) {
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, userId: input.actor.userId, role: actorRole(input.actor) },
        async (trx) => {
          if (input.resource) {
            const resource = await validateResource(trx, input.workspaceId, input.resource);
            if (!resource.ok) return resource;
            if (!await canManageResource(trx, input.workspaceId, input.actor, input.resource, [])) {
              return { ok: false as const, code: 'permission_denied' as const };
            }
          }

          let query = trx
            .selectFrom('mail_acl_bindings')
            .selectAll()
            .where('workspace_id', '=', input.workspaceId)
            .where('resource_type', 'in', ['account', 'folder']);
          if (input.cursor !== undefined) query = query.where('id', '>', input.cursor);
          if (input.resource) {
            query = query
              .where('resource_type', '=', input.resource.type)
              .where('account_id', '=', input.resource.accountId);
            query = input.resource.type === 'folder'
              ? query.where('folder_id', '=', input.resource.folderId)
              : query.where('folder_id', 'is', null);
          }
          if (!input.actor.isOwner && !input.actor.isAdmin) {
            query = query.where(sql<boolean>`exists (
              select 1
              from mail_acl_bindings actor_binding
              inner join mail_acl_binding_permissions actor_permission
                on actor_permission.binding_id = actor_binding.id
              where actor_binding.workspace_id = ${input.workspaceId}
                and actor_permission.permission_key = ${MANAGE_PERMISSION}
                and (
                  (actor_binding.subject_type = 'user' and actor_binding.subject_id = ${input.actor.userId})
                  or (
                    actor_binding.subject_type = 'group'
                    and exists (
                      select 1
                      from user_group_members actor_membership
                      where actor_membership.workspace_id = ${input.workspaceId}
                        and actor_membership.user_id = ${input.actor.userId}
                        and actor_binding.subject_id = cast(actor_membership.group_id as text)
                    )
                  )
                )
                and actor_binding.account_id = mail_acl_bindings.account_id
                and (
                  actor_binding.resource_type = 'account'
                  or (
                    actor_binding.resource_type = 'folder'
                    and mail_acl_bindings.resource_type = 'folder'
                    and actor_binding.folder_id = mail_acl_bindings.folder_id
                  )
                )
            )`);
          }

          const rows = (await query
            .orderBy('id', 'asc')
            .limit(input.limit + 1)
            .execute()).map((row) => normalizeBindingRow(row));
          const hasMore = rows.length > input.limit;
          const pageRows = hasMore ? rows.slice(0, input.limit) : rows;
          return {
            ok: true as const,
            bindings: await hydrateBindings(trx, input.workspaceId, pageRows),
            nextCursor: hasMore ? pageRows.at(-1)?.id ?? null : null,
          };
        },
        sessionOptions,
      );
    },

    async replaceBinding(input) {
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, userId: input.actor.userId, role: actorRole(input.actor) },
        async (trx) => replaceBySubjectResource(trx, input.workspaceId, input.actor, {
          subject: input.subject,
          resource: input.resource,
          permissions: uniquePermissions(input.permissions),
        }),
        sessionOptions,
      );
    },

    async replaceBindingById(input) {
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, userId: input.actor.userId, role: actorRole(input.actor) },
        async (trx) => {
          const existing = await findBindingById(trx, input.workspaceId, input.bindingId);
          if (!existing) return { ok: false as const, code: 'binding_not_found' as const };
          return replaceBySubjectResource(trx, input.workspaceId, input.actor, {
            subject: rowSubject(existing),
            resource: rowResource(existing),
            permissions: uniquePermissions(input.permissions),
            existing,
          });
        },
        sessionOptions,
      );
    },

    async deleteBinding(input) {
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, userId: input.actor.userId, role: actorRole(input.actor) },
        async (trx) => {
          const existing = await findBindingById(trx, input.workspaceId, input.bindingId);
          if (!existing) return { ok: false as const, code: 'binding_not_found' as const };
          const resource = rowResource(existing);
          if (!await canManageResource(trx, input.workspaceId, input.actor, resource, [])) {
            return { ok: false as const, code: 'permission_denied' as const };
          }
          const affectedUserIds = await affectedUsersForSubject(trx, input.workspaceId, rowSubject(existing));
          await trx.deleteFrom('mail_acl_bindings').where('id', '=', input.bindingId).execute();
          return { ok: true as const, bindingId: input.bindingId, affectedUserIds };
        },
        sessionOptions,
      );
    },
  };

  async function replaceBySubjectResource(
    trx: Trx,
    workspaceId: string,
    actor: MailDelegationActor,
    input: {
      subject: MailDelegationSubject;
      resource: MailDelegationResource;
      permissions: readonly MailPermission[];
      existing?: BindingRow;
    },
  ): Promise<
    | { ok: true; binding: MailDelegationBinding | null; affectedUserIds: readonly string[]; deleted: boolean }
    | { ok: false; code: MailDelegationMutationCode }
  > {
    const subject = await validateSubject(trx, workspaceId, input.subject);
    if (!subject.ok) return subject;
    const resource = await validateResource(trx, workspaceId, input.resource);
    if (!resource.ok) return resource;
    const manage = await canManageResource(trx, workspaceId, actor, input.resource, []);
    if (!manage) return { ok: false as const, code: 'permission_denied' };
    if (!actor.isOwner && !actor.isAdmin) {
      const held = await heldPermissionsForResource(trx, workspaceId, actor.userId, input.resource);
      if (input.permissions.some((permission) => !held.has(permission))) {
        return { ok: false as const, code: 'privilege_escalation' };
      }
    }

    const existing = input.existing
      ?? await findBinding(trx, workspaceId, input.subject, input.resource);
    const affectedUserIds = await affectedUsersForSubject(trx, workspaceId, input.subject);
    if (input.permissions.length === 0) {
      if (existing) await trx.deleteFrom('mail_acl_bindings').where('id', '=', existing.id).execute();
      return { ok: true as const, binding: null, affectedUserIds, deleted: Boolean(existing) };
    }

    const now = options.now?.() ?? new Date();
    let bindingRow: BindingRow | null;
    if (existing) {
      const updated = await trx
        .updateTable('mail_acl_bindings')
        .set({ updated_at: now })
        .where('id', '=', existing.id)
        .returningAll()
        .executeTakeFirst();
      bindingRow = updated ? normalizeBindingRow(updated) : null;
    } else {
      const upserted = await trx
        .insertInto('mail_acl_bindings')
        .values({
          workspace_id: workspaceId,
          subject_type: input.subject.type,
          subject_id: subjectId(input.subject),
          resource_type: input.resource.type,
          account_id: input.resource.accountId,
          folder_id: input.resource.type === 'folder' ? input.resource.folderId : null,
          message_id: null,
          created_by: actor.userId,
          created_at: now,
          updated_at: now,
        })
        .onConflict((conflict) => conflict
          .columns([
            'workspace_id',
            'subject_type',
            'subject_id',
            'resource_type',
            'account_id',
            'folder_id',
            'message_id',
          ])
          .doUpdateSet({ updated_at: now }))
        .returningAll()
        .executeTakeFirst();
      bindingRow = upserted ? normalizeBindingRow(upserted) : null;
    }
    if (!bindingRow) return { ok: false as const, code: 'binding_conflict' as const };

    await trx.deleteFrom('mail_acl_binding_permissions').where('binding_id', '=', bindingRow.id).execute();
    await trx
      .insertInto('mail_acl_binding_permissions')
      .values(input.permissions.map((permission) => ({
        binding_id: bindingRow.id,
        permission_key: permission,
      })))
      .execute();

    return {
      ok: true as const,
      binding: (await hydrateBindings(trx, workspaceId, [bindingRow]))[0] ?? null,
      affectedUserIds,
      deleted: false,
    };
  }
}

async function validateSubject(
  trx: Trx,
  workspaceId: string,
  subject: MailDelegationSubject,
): Promise<{ ok: true } | { ok: false; code: 'subject_not_found' | 'owner_admin_subject_forbidden' }> {
  if (subject.type === 'user') {
    const user = await trx
      .selectFrom('users')
      .select(['id', 'display_name', 'role', 'disabled_at'])
      .where('workspace_id', '=', workspaceId)
      .where('id', '=', subject.id)
      .executeTakeFirst() as UserRow | undefined;
    if (!user || user.disabled_at) return { ok: false, code: 'subject_not_found' };
    if (user.role === 'owner' || user.role === 'admin') {
      return { ok: false, code: 'owner_admin_subject_forbidden' };
    }
    return { ok: true };
  }
  const group = await trx
    .selectFrom('user_groups')
    .select(['id', 'name'])
    .where('workspace_id', '=', workspaceId)
    .where('id', '=', subject.id)
    .executeTakeFirst() as GroupRow | undefined;
  return group ? { ok: true } : { ok: false, code: 'subject_not_found' };
}

async function validateResource(
  trx: Trx,
  workspaceId: string,
  resource: MailDelegationResource,
): Promise<{ ok: true } | { ok: false; code: 'resource_not_found' }> {
  const account = await trx
    .selectFrom('email_accounts')
    .select(['id', 'display_name'])
    .where('workspace_id', '=', workspaceId)
    .where('id', '=', resource.accountId)
    .executeTakeFirst() as AccountRow | undefined;
  if (!account) return { ok: false, code: 'resource_not_found' };
  if (resource.type === 'account') return { ok: true };
  const folder = await trx
    .selectFrom('email_folders')
    .select(['id', 'account_id', 'path'])
    .where('workspace_id', '=', workspaceId)
    .where('id', '=', resource.folderId)
    .where('account_id', '=', resource.accountId)
    .executeTakeFirst() as FolderRow | undefined;
  return folder ? { ok: true } : { ok: false, code: 'resource_not_found' };
}

async function canManageResource(
  trx: Trx,
  workspaceId: string,
  actor: MailDelegationActor,
  resource: MailDelegationResource,
  permissions: readonly MailPermission[],
): Promise<boolean> {
  if (actor.isOwner || actor.isAdmin) return true;
  const held = await heldPermissionsForResource(trx, workspaceId, actor.userId, resource);
  return held.has(MANAGE_PERMISSION) && permissions.every((permission) => held.has(permission));
}

async function heldPermissionsForResource(
  trx: Trx,
  workspaceId: string,
  userId: string,
  resource: MailDelegationResource,
): Promise<ReadonlySet<MailPermission>> {
  return heldPermissionsFromRows(await heldGrantRowsForActor(trx, workspaceId, userId), resource);
}

async function heldGrantRowsForActor(
  trx: Trx,
  workspaceId: string,
  userId: string,
): Promise<Array<{
  subject_type: 'user' | 'group';
  subject_id: string;
  resource_type: 'account' | 'folder' | 'message';
  account_id: number;
  folder_id: number | null;
  permission_key: MailPermission;
}>> {
  const groupRows = await trx
    .selectFrom('user_group_members')
    .select(['group_id'])
    .where('workspace_id', '=', workspaceId)
    .where('user_id', '=', userId)
    .execute() as Array<{ group_id: number }>;
  const subjectIds = new Set<string>([userId, ...groupRows.map((row) => String(row.group_id))]);
  const rows = await trx
    .selectFrom('mail_acl_bindings')
    .innerJoin('mail_acl_binding_permissions', 'mail_acl_binding_permissions.binding_id', 'mail_acl_bindings.id')
    .select([
      'mail_acl_bindings.subject_type',
      'mail_acl_bindings.subject_id',
      'mail_acl_bindings.resource_type',
      'mail_acl_bindings.account_id',
      'mail_acl_bindings.folder_id',
      'mail_acl_binding_permissions.permission_key',
    ])
    .where('mail_acl_bindings.workspace_id', '=', workspaceId)
    .where((eb) => {
      const directUser = eb.and([
        eb('mail_acl_bindings.subject_type', '=', 'user'),
        eb('mail_acl_bindings.subject_id', '=', userId),
      ]);
      if (groupRows.length === 0) return directUser;
      return eb.or([
        directUser,
        eb.and([
          eb('mail_acl_bindings.subject_type', '=', 'group'),
          eb('mail_acl_bindings.subject_id', 'in', groupRows.map((row) => String(row.group_id))),
        ]),
      ]);
    })
    .execute() as unknown as Array<{
      subject_type: 'user' | 'group';
      subject_id: string;
      resource_type: 'account' | 'folder' | 'message';
      account_id: number | string;
      folder_id: number | string | null;
      permission_key: MailPermission;
    }>;
  return rows
    .filter((row) => subjectIds.has(row.subject_id))
    .map((row) => ({
      ...row,
      account_id: dbInteger(row.account_id, 'mail ACL grant account id'),
      folder_id: row.folder_id === null ? null : dbInteger(row.folder_id, 'mail ACL grant folder id'),
    }));
}

function heldPermissionsFromRows(
  rows: Array<{
    resource_type: string;
    account_id: number;
    folder_id: number | null;
    permission_key: MailPermission;
  }>,
  resource: MailDelegationResource,
): ReadonlySet<MailPermission> {
  return new Set(rows
    .filter((row) => (
      rowCoversResource(row, resource)
    ))
    .map((row) => row.permission_key));
}

async function findBindingById(
  trx: Trx,
  workspaceId: string,
  bindingId: number,
): Promise<BindingRow | null> {
  const row = await trx
    .selectFrom('mail_acl_bindings')
    .selectAll()
    .where('workspace_id', '=', workspaceId)
    .where('id', '=', bindingId)
    .forUpdate()
    .executeTakeFirst();
  return row ? normalizeBindingRow(row) : null;
}

async function findBinding(
  trx: Trx,
  workspaceId: string,
  subject: MailDelegationSubject,
  resource: MailDelegationResource,
): Promise<BindingRow | null> {
  let query = trx
    .selectFrom('mail_acl_bindings')
    .selectAll()
    .where('workspace_id', '=', workspaceId)
    .where('subject_type', '=', subject.type)
    .where('subject_id', '=', subjectId(subject))
    .where('resource_type', '=', resource.type)
    .where('account_id', '=', resource.accountId);
  if (resource.type === 'account') {
    query = query.where('folder_id', 'is', null).where('message_id', 'is', null);
  } else {
    query = query.where('folder_id', '=', resource.folderId).where('message_id', 'is', null);
  }
  const row = await query.forUpdate().executeTakeFirst();
  return row ? normalizeBindingRow(row) : null;
}

async function affectedUsersForSubject(
  trx: Trx,
  workspaceId: string,
  subject: MailDelegationSubject,
): Promise<readonly string[]> {
  if (subject.type === 'user') {
    const user = await trx
      .selectFrom('users')
      .select(['id'])
      .where('workspace_id', '=', workspaceId)
      .where('id', '=', subject.id)
      .where('disabled_at', 'is', null)
      .executeTakeFirst() as { id: string } | undefined;
    return user ? [user.id] : [];
  }
  const rows = await trx
    .selectFrom('user_group_members')
    .innerJoin('users', 'users.id', 'user_group_members.user_id')
    .select(['user_group_members.user_id'])
    .where('user_group_members.workspace_id', '=', workspaceId)
    .where('user_group_members.group_id', '=', subject.id)
    .where('users.workspace_id', '=', workspaceId)
    .where('users.disabled_at', 'is', null)
    .orderBy('user_group_members.user_id', 'asc')
    .execute() as Array<{ user_id: string }>;
  return rows.map((row) => row.user_id);
}

async function hydrateBindings(
  trx: Trx,
  workspaceId: string,
  rows: readonly BindingRow[],
): Promise<MailDelegationBinding[]> {
  if (rows.length === 0) return [];
  const bindingIds = rows.map((row) => row.id);
  const userIds = unique(rows.filter((row) => row.subject_type === 'user').map((row) => row.subject_id));
  const groupIds = unique(rows
    .filter((row) => row.subject_type === 'group')
    .map((row) => Number(row.subject_id))
    .filter(Number.isSafeInteger));
  const accountIds = unique(rows.filter((row) => row.resource_type === 'account').map((row) => row.account_id));
  const folderIds = unique(rows
    .filter((row) => row.resource_type === 'folder' && row.folder_id !== null)
    .map((row) => row.folder_id!));

  const permissionRows = await trx
    .selectFrom('mail_acl_binding_permissions')
    .select(['binding_id', 'permission_key'])
    .where('binding_id', 'in', bindingIds)
    .orderBy('binding_id', 'asc')
    .orderBy('permission_key', 'asc')
    .execute() as unknown as Array<{ binding_id: number | string; permission_key: MailPermission }>;
  const users = userIds.length === 0 ? [] : await trx
    .selectFrom('users')
    .select(['id', 'display_name'])
    .where('workspace_id', '=', workspaceId)
    .where('id', 'in', userIds)
    .execute() as Array<{ id: string; display_name: string }>;
  const groups = groupIds.length === 0 ? [] : await trx
      .selectFrom('user_groups')
      .select(['id', 'name'])
      .where('workspace_id', '=', workspaceId)
      .where('id', 'in', groupIds)
      .execute() as unknown as Array<{ id: number | string; name: string }>;
  const accounts = accountIds.length === 0 ? [] : await trx
    .selectFrom('email_accounts')
    .select(['id', 'display_name'])
    .where('workspace_id', '=', workspaceId)
    .where('id', 'in', accountIds)
    .execute() as unknown as Array<{ id: number | string; display_name: string }>;
  const folders = folderIds.length === 0 ? [] : await trx
      .selectFrom('email_folders')
      .select(['id', 'path'])
      .where('workspace_id', '=', workspaceId)
      .where('id', 'in', folderIds)
      .execute() as unknown as Array<{ id: number | string; path: string }>;

  const permissionMap = new Map<number, MailPermission[]>();
  for (const permission of permissionRows) {
    const bindingId = dbInteger(permission.binding_id, 'mail ACL permission binding id');
    const entries = permissionMap.get(bindingId) ?? [];
    entries.push(permission.permission_key);
    permissionMap.set(bindingId, entries);
  }
  const userLabels = new Map(users.map((user) => [user.id, user.display_name]));
  const groupLabels = new Map(groups.map((group) => [dbInteger(group.id, 'user group id'), group.name]));
  const accountLabels = new Map(accounts.map((account) => [dbInteger(account.id, 'email account id'), account.display_name]));
  const folderLabels = new Map(folders.map((folder) => [dbInteger(folder.id, 'email folder id'), folder.path]));

  return rows.map((row) => ({
    id: row.id,
    subject: row.subject_type === 'group'
      ? { type: 'group', id: Number(row.subject_id), label: groupLabels.get(Number(row.subject_id)) }
      : { type: 'user', id: row.subject_id, label: userLabels.get(row.subject_id) },
    resource: row.resource_type === 'folder' && row.folder_id !== null
      ? { type: 'folder', accountId: row.account_id, folderId: row.folder_id, label: folderLabels.get(row.folder_id) }
      : { type: 'account', accountId: row.account_id, label: accountLabels.get(row.account_id) },
    permissions: permissionMap.get(row.id) ?? [],
    profile: null,
    updatedAt: formatTimestamp(row.updated_at),
  }));
}

function actorRole(actor: MailDelegationActor): 'owner' | 'admin' | 'user' {
  if (actor.isOwner) return 'owner';
  if (actor.isAdmin) return 'admin';
  return 'user';
}

function subjectId(subject: MailDelegationSubject): string {
  return subject.type === 'group' ? String(subject.id) : subject.id;
}

function rowSubject(row: BindingRow): MailDelegationSubject {
  return row.subject_type === 'group'
    ? { type: 'group', id: Number(row.subject_id) }
    : { type: 'user', id: row.subject_id };
}

function rowResource(row: BindingRow): MailDelegationResource {
  if (row.resource_type === 'folder' && row.folder_id !== null) {
    return { type: 'folder', accountId: row.account_id, folderId: row.folder_id };
  }
  return { type: 'account', accountId: row.account_id };
}

function rowCoversResource(
  row: { resource_type: string; account_id: number; folder_id: number | null },
  resource: MailDelegationResource,
): boolean {
  if (row.account_id !== resource.accountId) return false;
  if (row.resource_type === 'account') return true;
  return resource.type === 'folder'
    && row.resource_type === 'folder'
    && row.folder_id === resource.folderId;
}

function uniquePermissions(input: readonly MailPermission[]): readonly MailPermission[] {
  return [...new Set(input)].sort();
}

function unique<T>(input: readonly T[]): T[] {
  return [...new Set(input)];
}

function actorSubjectSql(workspaceId: string, userId: string) {
  return sql<boolean>`(
    (actor_binding.subject_type = 'user' and actor_binding.subject_id = ${userId})
    or (
      actor_binding.subject_type = 'group'
      and exists (
        select 1
        from user_group_members actor_membership
        where actor_membership.workspace_id = ${workspaceId}
          and actor_membership.user_id = ${userId}
          and actor_binding.subject_id = cast(actor_membership.group_id as text)
      )
    )
  )`;
}

function normalizeBindingRow(row: {
  id: number | string;
  workspace_id: string;
  subject_type: 'user' | 'group';
  subject_id: string;
  resource_type: 'account' | 'folder' | 'message';
  account_id: number | string;
  folder_id: number | string | null;
  message_id: number | string | null;
  updated_at: Date | string;
}): BindingRow {
  return {
    ...row,
    id: dbInteger(row.id, 'mail ACL binding id'),
    account_id: dbInteger(row.account_id, 'mail ACL account id'),
    folder_id: row.folder_id === null ? null : dbInteger(row.folder_id, 'mail ACL folder id'),
    message_id: row.message_id === null ? null : dbInteger(row.message_id, 'mail ACL message id'),
  };
}

function dbInteger(value: number | string | null, label: string): number {
  if (value === null) throw new Error(`Invalid ${label}`);
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(numeric) || numeric <= 0) throw new Error(`Invalid ${label}`);
  return numeric;
}

function formatTimestamp(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}
