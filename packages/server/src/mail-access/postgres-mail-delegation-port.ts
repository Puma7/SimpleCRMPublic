import type { Kysely, Transaction } from 'kysely';

import type { MailPermission } from '@simplecrm/core';

import type {
  MailDelegationActor,
  MailDelegationApiPort,
  MailDelegationBinding,
  MailDelegationMutationCode,
  MailDelegationResource,
  MailDelegationSubject,
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

          const rows = await trx
            .selectFrom('mail_acl_bindings')
            .selectAll()
            .where('workspace_id', '=', input.workspaceId)
            .orderBy('id', 'asc')
            .execute() as BindingRow[];

          const bindings: MailDelegationBinding[] = [];
          const actorGrants = !input.actor.isOwner && !input.actor.isAdmin
            ? await heldGrantRowsForActor(trx, input.workspaceId, input.actor.userId)
            : null;
          for (const row of rows) {
            if (row.resource_type === 'message') continue;
            const resource = rowResource(row);
            if (input.resource && !sameResource(input.resource, resource)) continue;
            if (actorGrants && !heldPermissionsFromRows(actorGrants, resource).has(MANAGE_PERMISSION)) continue;
            bindings.push(await hydrateBinding(trx, input.workspaceId, row));
          }
          return { ok: true as const, bindings };
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
    let bindingRow: BindingRow;
    if (existing) {
      bindingRow = await trx
        .updateTable('mail_acl_bindings')
        .set({ updated_at: now })
        .where('id', '=', existing.id)
        .returningAll()
        .executeTakeFirstOrThrow() as BindingRow;
    } else {
      bindingRow = await trx
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
        .returningAll()
        .executeTakeFirstOrThrow() as BindingRow;
    }

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
      binding: await hydrateBinding(trx, workspaceId, bindingRow),
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
    .execute() as Array<{
      subject_type: 'user' | 'group';
      subject_id: string;
      resource_type: 'account' | 'folder' | 'message';
      account_id: number;
      folder_id: number | null;
      permission_key: MailPermission;
    }>;
  return rows.filter((row) => subjectIds.has(row.subject_id));
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
    .executeTakeFirst() as BindingRow | undefined;
  return row ?? null;
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
  const row = await query.executeTakeFirst() as BindingRow | undefined;
  return row ?? null;
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

async function hydrateBinding(
  trx: Trx,
  workspaceId: string,
  row: BindingRow,
): Promise<MailDelegationBinding> {
  const permissions = await trx
    .selectFrom('mail_acl_binding_permissions')
    .select(['permission_key'])
    .where('binding_id', '=', row.id)
    .orderBy('permission_key', 'asc')
    .execute() as Array<{ permission_key: MailPermission }>;
  return {
    id: row.id,
    subject: await hydrateSubject(trx, workspaceId, row),
    resource: await hydrateResource(trx, workspaceId, row),
    permissions: permissions.map((permission) => permission.permission_key),
    profile: null,
    updatedAt: formatTimestamp(row.updated_at),
  };
}

async function hydrateSubject(
  trx: Trx,
  workspaceId: string,
  row: BindingRow,
): Promise<MailDelegationSubject> {
  if (row.subject_type === 'group') {
    const group = await trx
      .selectFrom('user_groups')
      .select(['name'])
      .where('workspace_id', '=', workspaceId)
      .where('id', '=', Number(row.subject_id))
      .executeTakeFirst() as { name: string } | undefined;
    return { type: 'group', id: Number(row.subject_id), label: group?.name };
  }
  const user = await trx
    .selectFrom('users')
    .select(['display_name'])
    .where('workspace_id', '=', workspaceId)
    .where('id', '=', row.subject_id)
    .executeTakeFirst() as { display_name: string } | undefined;
  return { type: 'user', id: row.subject_id, label: user?.display_name };
}

async function hydrateResource(
  trx: Trx,
  workspaceId: string,
  row: BindingRow,
): Promise<MailDelegationResource> {
  if (row.resource_type === 'folder' && row.folder_id !== null) {
    const folder = await trx
      .selectFrom('email_folders')
      .select(['path'])
      .where('workspace_id', '=', workspaceId)
      .where('id', '=', row.folder_id)
      .executeTakeFirst() as { path: string } | undefined;
    return { type: 'folder', accountId: row.account_id, folderId: row.folder_id, label: folder?.path };
  }
  const account = await trx
    .selectFrom('email_accounts')
    .select(['display_name'])
    .where('workspace_id', '=', workspaceId)
    .where('id', '=', row.account_id)
    .executeTakeFirst() as { display_name: string } | undefined;
  return { type: 'account', accountId: row.account_id, label: account?.display_name };
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

function sameResource(left: MailDelegationResource, right: MailDelegationResource): boolean {
  return left.type === right.type
    && left.accountId === right.accountId
    && (left.type === 'account' || right.type === 'account' || left.folderId === right.folderId);
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

function formatTimestamp(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}
