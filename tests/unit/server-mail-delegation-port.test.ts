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
});

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
    if (table === 'mail_acl_binding_permissions') return [{ permission_key: 'mail.metadata.read' }];
    return [];
  };
  const createBuilder = (table: string) => {
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
    values: () => builder,
    returning: () => builder,
    returningAll: () => builder,
    onConflict: () => builder,
    set: () => builder,
    execute: async () => rowsFor(table, joined),
    executeTakeFirst: async () => rowsFor(table, joined)[0] ?? undefined,
    executeTakeFirstOrThrow: async () => ({ id: 901, updated_at: new Date('2026-07-19T12:00:00.000Z') }),
  };
    return builder;
  };
  return {
    calls,
    selectFrom(table: string) {
      calls.push(['selectFrom', table]);
      return createBuilder(table);
    },
    insertInto(table: string) {
      calls.push(['insertInto', table]);
      return createBuilder(table);
    },
    deleteFrom(table: string) {
      calls.push(['deleteFrom', table]);
      return createBuilder(table);
    },
    updateTable(table: string) {
      calls.push(['updateTable', table]);
      return createBuilder(table);
    },
  };
}
