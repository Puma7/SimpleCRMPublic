import type { MailPermission } from '../../packages/core/src/email/mail-permissions';
import {
  createPostgresMailDelegationPort,
} from '../../packages/server/src/mail-access/postgres-mail-delegation-port';

const WORKSPACE = '11111111-1111-4111-8111-111111111111';
const ACTOR = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const AGENT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

describe('createPostgresMailDelegationPort', () => {
  test('uses a workspace-bound transaction for binding replacement', async () => {
    const contexts: unknown[] = [];
    const trx = createDelegationTransaction({
      actor: { id: ACTOR, role: 'admin', disabled_at: null },
      subject: { id: AGENT, display_name: 'Agent', role: 'user', disabled_at: null },
      account: { id: 101, display_name: 'Support' },
      folder: null,
      existingBinding: null,
      affectedUsers: [{ id: AGENT }],
    });
    const db = {
      transaction: () => ({ execute: async (operation: (transaction: typeof trx) => unknown) => operation(trx) }),
    };
    const port = createPostgresMailDelegationPort({
      db: db as never,
      applyWorkspaceSession: async (_trx, command) => {
        contexts.push(command.params);
      },
    });

    const result = await port.replaceBinding({
      workspaceId: WORKSPACE,
      actor: { userId: ACTOR, isOwner: false, isAdmin: true },
      subject: { type: 'user', id: AGENT },
      resource: { type: 'account', accountId: 101 },
      permissions: ['mail.metadata.read'],
    });

    expect(result).toMatchObject({ ok: true, affectedUserIds: [AGENT] });
    expect(contexts).toEqual([[WORKSPACE, ACTOR, 'admin', 'off']]);
    expect(trx.calls).toEqual(expect.arrayContaining([
      ['deleteFrom', 'mail_acl_binding_permissions'],
      ['insertInto', 'mail_acl_bindings'],
      ['insertInto', 'mail_acl_binding_permissions'],
    ]));
  });

  test('validates active same-workspace subjects and folder-account consistency before persisting', async () => {
    const trx = createDelegationTransaction({
      actor: { id: ACTOR, role: 'admin', disabled_at: null },
      subject: null,
      account: { id: 101, display_name: 'Support' },
      folder: { id: 202, account_id: 999, path: 'INBOX' },
      existingBinding: null,
      affectedUsers: [],
    });
    const db = {
      transaction: () => ({ execute: async (operation: (transaction: typeof trx) => unknown) => operation(trx) }),
    };
    const port = createPostgresMailDelegationPort({ db: db as never, applyWorkspaceSession: async () => {} });

    await expect(port.replaceBinding({
      workspaceId: WORKSPACE,
      actor: { userId: ACTOR, isOwner: false, isAdmin: true },
      subject: { type: 'user', id: AGENT },
      resource: { type: 'folder', accountId: 101, folderId: 202 },
      permissions: ['mail.metadata.read'],
    })).resolves.toEqual({ ok: false, code: 'subject_not_found' });

    expect(trx.calls).not.toContainEqual(['insertInto', 'mail_acl_bindings']);
  });

  test('blocks delegated managers from granting permissions they do not hold', async () => {
    const trx = createDelegationTransaction({
      actor: { id: ACTOR, role: 'user', disabled_at: null },
      subject: { id: AGENT, display_name: 'Agent', role: 'user', disabled_at: null },
      account: { id: 101, display_name: 'Support' },
      folder: null,
      existingBinding: null,
      affectedUsers: [{ id: AGENT }],
      actorPermissions: ['mail.delegation.manage', 'mail.metadata.read'],
    });
    const db = {
      transaction: () => ({ execute: async (operation: (transaction: typeof trx) => unknown) => operation(trx) }),
    };
    const port = createPostgresMailDelegationPort({ db: db as never, applyWorkspaceSession: async () => {} });

    await expect(port.replaceBinding({
      workspaceId: WORKSPACE,
      actor: { userId: ACTOR, isOwner: false, isAdmin: false },
      subject: { type: 'user', id: AGENT },
      resource: { type: 'account', accountId: 101 },
      permissions: ['mail.metadata.read', 'mail.send'],
    })).resolves.toEqual({ ok: false, code: 'privilege_escalation' });
  });

  test('bulk-hydrates delegation pages with a constant query count', async () => {
    const small = createListTransaction(2);
    const large = createListTransaction(20);
    const createPort = (trx: ReturnType<typeof createListTransaction>) => createPostgresMailDelegationPort({
      db: {
        transaction: () => ({ execute: async (operation: (transaction: typeof trx) => unknown) => operation(trx) }),
      } as never,
      applyWorkspaceSession: async () => {},
    });

    const smallResult = await createPort(small).listBindings({
      workspaceId: WORKSPACE,
      actor: { userId: ACTOR, isOwner: true, isAdmin: false },
      limit: 2,
    });
    const largeResult = await createPort(large).listBindings({
      workspaceId: WORKSPACE,
      actor: { userId: ACTOR, isOwner: true, isAdmin: false },
      limit: 20,
    });

    expect(selectQueryCount(small)).toBe(6);
    expect(selectQueryCount(large)).toBe(6);
    expect(smallResult).toMatchObject({ ok: true, nextCursor: null });
    expect(largeResult).toMatchObject({ ok: true, nextCursor: null });
  });

  test('returns deterministic bounded pages after the validated id cursor', async () => {
    const trx = createListTransaction(6);
    const port = createPostgresMailDelegationPort({
      db: {
        transaction: () => ({ execute: async (operation: (transaction: typeof trx) => unknown) => operation(trx) }),
      } as never,
      applyWorkspaceSession: async () => {},
    });

    const result = await port.listBindings({
      workspaceId: WORKSPACE,
      actor: { userId: ACTOR, isOwner: false, isAdmin: true },
      cursor: 2,
      limit: 2,
    });

    expect(result).toMatchObject({
      ok: true,
      bindings: [{ id: 3 }, { id: 4 }],
      nextCursor: 4,
    });
  });

  test('locks an existing binding row before patch and delete replacement semantics', async () => {
    const existingBinding = {
      id: 901,
      workspace_id: WORKSPACE,
      subject_type: 'user' as const,
      subject_id: AGENT,
      resource_type: 'account' as const,
      account_id: 101,
      folder_id: null,
      message_id: null,
      updated_at: '2026-07-20T10:00:00.000Z',
    };
    const patchTrx = createDelegationTransaction({
      actor: { id: ACTOR, role: 'admin', disabled_at: null },
      subject: { id: AGENT, display_name: 'Agent', role: 'user', disabled_at: null },
      account: { id: 101, display_name: 'Support' },
      folder: null,
      existingBinding,
      affectedUsers: [{ id: AGENT }],
    });
    const deleteTrx = createDelegationTransaction({
      actor: { id: ACTOR, role: 'admin', disabled_at: null },
      subject: { id: AGENT, display_name: 'Agent', role: 'user', disabled_at: null },
      account: { id: 101, display_name: 'Support' },
      folder: null,
      existingBinding,
      affectedUsers: [{ id: AGENT }],
    });
    const createPort = (trx: typeof patchTrx) => createPostgresMailDelegationPort({
      db: {
        transaction: () => ({ execute: async (operation: (transaction: typeof trx) => unknown) => operation(trx) }),
      } as never,
      applyWorkspaceSession: async () => {},
    });

    await createPort(patchTrx).replaceBindingById({
      workspaceId: WORKSPACE,
      actor: { userId: ACTOR, isOwner: false, isAdmin: true },
      bindingId: 901,
      permissions: ['mail.metadata.read'],
    });
    await createPort(deleteTrx).deleteBinding({
      workspaceId: WORKSPACE,
      actor: { userId: ACTOR, isOwner: false, isAdmin: true },
      bindingId: 901,
    });

    expect(patchTrx.calls.filter(([operation]) => operation === 'forUpdate')).toHaveLength(1);
    expect(deleteTrx.calls.filter(([operation]) => operation === 'forUpdate')).toHaveLength(1);
  });
});

function selectQueryCount(trx: { calls: unknown[][] }): number {
  return trx.calls.filter(([operation]) => operation === 'selectFrom').length;
}

function createListTransaction(bindingCount: number) {
  const calls: unknown[][] = [];
  const bindings = Array.from({ length: bindingCount }, (_, index) => {
    const id = index + 1;
    const group = id % 2 === 0;
    return {
      id,
      workspace_id: WORKSPACE,
      subject_type: group ? 'group' as const : 'user' as const,
      subject_id: group ? String(1000 + id) : `user-${id}`,
      resource_type: group ? 'folder' as const : 'account' as const,
      account_id: 100 + id,
      folder_id: group ? 200 + id : null,
      message_id: null,
      updated_at: '2026-07-20T10:00:00.000Z',
    };
  });
  const rowsByTable: Record<string, Array<Record<string, unknown>>> = {
    mail_acl_bindings: bindings,
    mail_acl_binding_permissions: bindings.map((row) => ({
      binding_id: row.id,
      permission_key: 'mail.metadata.read',
    })),
    users: bindings
      .filter((row) => row.subject_type === 'user')
      .map((row) => ({ id: row.subject_id, workspace_id: WORKSPACE, display_name: `User ${row.id}` })),
    user_groups: bindings
      .filter((row) => row.subject_type === 'group')
      .map((row) => ({ id: Number(row.subject_id), workspace_id: WORKSPACE, name: `Group ${row.id}` })),
    email_accounts: bindings.map((row) => ({
      id: row.account_id,
      workspace_id: WORKSPACE,
      display_name: `Account ${row.id}`,
    })),
    email_folders: bindings
      .filter((row) => row.folder_id !== null)
      .map((row) => ({ id: row.folder_id, workspace_id: WORKSPACE, path: `Folder ${row.id}` })),
  };

  const createBuilder = (table: string) => {
    const wheres: Array<[string, string, unknown]> = [];
    let rowLimit: number | undefined;
    const builder = {
      select: () => builder,
      selectAll: () => builder,
      where: (...args: unknown[]) => {
        if (typeof args[0] === 'string') wheres.push(args as [string, string, unknown]);
        return builder;
      },
      orderBy: () => builder,
      limit: (value: number) => {
        rowLimit = value;
        return builder;
      },
      execute: async () => {
        let rows = [...(rowsByTable[table] ?? [])];
        for (const [rawColumn, operator, value] of wheres) {
          const column = rawColumn.split('.').at(-1)!;
          if (operator === '=') rows = rows.filter((row) => row[column] === value);
          if (operator === '>') rows = rows.filter((row) => Number(row[column]) > Number(value));
          if (operator === 'in' && Array.isArray(value)) rows = rows.filter((row) => value.includes(row[column]));
        }
        return rowLimit === undefined ? rows : rows.slice(0, rowLimit);
      },
      executeTakeFirst: async () => {
        const rows = await builder.execute();
        return rows[0];
      },
    };
    return builder;
  };

  return {
    calls,
    selectFrom(table: string) {
      calls.push(['selectFrom', table]);
      return createBuilder(table);
    },
  };
}

function createDelegationTransaction(fixtures: {
  actor: unknown;
  subject: unknown;
  account: unknown;
  folder: unknown;
  existingBinding: unknown;
  affectedUsers: unknown[];
  actorPermissions?: readonly MailPermission[];
}) {
  const calls: unknown[][] = [];
  const selectCounts = new Map<string, number>();
  const nextCount = (key: string) => {
    const current = selectCounts.get(key) ?? 0;
    selectCounts.set(key, current + 1);
    return current;
  };
  const rowsFor = (table: string, joined: string[]): unknown[] => {
    if (table === 'users') {
      const index = nextCount('users');
      if (index === 0) return fixtures.subject ? [fixtures.subject] : [];
      if (index === 1) return fixtures.affectedUsers;
      return fixtures.subject ? [fixtures.subject] : [];
    }
    if (table === 'user_groups') return fixtures.subject ? [fixtures.subject] : [];
    if (table === 'email_accounts') return fixtures.account ? [fixtures.account] : [];
    if (table === 'email_folders') return fixtures.folder ? [fixtures.folder] : [];
    if (table === 'user_group_members') {
      if (joined.includes('users')) return fixtures.affectedUsers.map((user) => ({ user_id: (user as { id: string }).id }));
      return [];
    }
    if (table === 'mail_acl_bindings' && joined.includes('mail_acl_binding_permissions')) {
      return (fixtures.actorPermissions ?? []).map((permission) => ({
        subject_type: 'user',
        subject_id: ACTOR,
        resource_type: 'account',
        account_id: 101,
        folder_id: null,
        permission_key: permission,
      }));
    }
    if (table === 'mail_acl_bindings') return fixtures.existingBinding ? [fixtures.existingBinding] : [];
    if (table === 'mail_acl_binding_permissions') {
      return [{ binding_id: (fixtures.existingBinding as { id?: number } | null)?.id ?? 901, permission_key: 'mail.metadata.read' }];
    }
    return [];
  };
  const createBuilder = (table: string, operation: 'select' | 'insert' | 'update' | 'delete') => {
    const joined: string[] = [];
    const builder = {
    select: () => builder,
    selectAll: () => builder,
    where: () => builder,
    whereRef: () => builder,
    innerJoin: (joinTable: string) => {
      joined.push(joinTable);
      return builder;
    },
    leftJoin: () => builder,
    orderBy: () => builder,
    forUpdate: () => {
      calls.push(['forUpdate', table]);
      return builder;
    },
    values: () => builder,
    returning: () => builder,
    returningAll: () => builder,
    onConflict: () => builder,
    set: () => builder,
    execute: async () => rowsFor(table, joined),
    executeTakeFirst: async () => {
      if (table === 'mail_acl_bindings' && operation === 'insert') {
        return {
          id: 901,
          workspace_id: WORKSPACE,
          subject_type: 'user',
          subject_id: AGENT,
          resource_type: 'account',
          account_id: 101,
          folder_id: null,
          message_id: null,
          updated_at: new Date('2026-07-19T12:00:00.000Z'),
        };
      }
      return rowsFor(table, joined)[0] ?? undefined;
    },
    executeTakeFirstOrThrow: async () => ({ id: 901, updated_at: new Date('2026-07-19T12:00:00.000Z') }),
  };
    return builder;
  };
  return {
    calls,
    selectFrom(table: string) {
      calls.push(['selectFrom', table]);
      return createBuilder(table, 'select');
    },
    insertInto(table: string) {
      calls.push(['insertInto', table]);
      return createBuilder(table, 'insert');
    },
    deleteFrom(table: string) {
      calls.push(['deleteFrom', table]);
      return createBuilder(table, 'delete');
    },
    updateTable(table: string) {
      calls.push(['updateTable', table]);
      return createBuilder(table, 'update');
    },
  };
}
