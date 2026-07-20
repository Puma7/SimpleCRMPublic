import type { MailPermission } from '../../packages/core/src/email/mail-permissions';
import { createServerApi } from '../../packages/server/src/api/server-api';
import type {
  AuthenticatedPrincipal,
  MailDelegationApiPort,
  MailDelegationBinding,
  ServerApiPorts,
} from '../../packages/server/src/api/types';
import { MailAccessDeniedError, MailAccessService } from '../../packages/server/src/mail-access/service';
import type { MailAccessGrant } from '../../packages/server/src/mail-access/types';

const WORKSPACE = '11111111-1111-4111-8111-111111111111';
const OWNER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ADMIN = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const MANAGER = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const AGENT = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const GROUP = 55;
const ACCOUNT = 101;
const FOLDER = 202;

const owner = principal(OWNER, 'owner');
const admin = principal(ADMIN, 'admin');
const manager = principal(MANAGER, 'user');

describe('server mail delegation API', () => {
  test('lists, creates, replaces, and deletes user and group bindings', async () => {
    const mailDelegation = delegationPort();
    const api = createServerApi(ports({ mailDelegation }));

    const list = await api.handle({
      method: 'GET',
      path: `/api/v1/email/access/bindings?accountId=${ACCOUNT}&cursor=800&limit=25`,
      principal: owner,
    });
    const createUser = await api.handle({
      method: 'POST',
      path: '/api/v1/email/access/bindings',
      principal: owner,
      body: {
        subject: { type: 'user', id: AGENT },
        resource: { type: 'account', accountId: ACCOUNT },
        profile: 'viewer',
      },
    });
    const createGroup = await api.handle({
      method: 'POST',
      path: '/api/v1/email/access/bindings',
      principal: owner,
      body: {
        subject: { type: 'group', id: GROUP },
        resource: { type: 'folder', accountId: ACCOUNT, folderId: FOLDER },
        permissions: ['mail.metadata.read', 'mail.triage'],
      },
    });
    const patch = await api.handle({
      method: 'PATCH',
      path: '/api/v1/email/access/bindings/900',
      principal: owner,
      body: { permissions: ['mail.metadata.read'] },
    });
    const remove = await api.handle({
      method: 'DELETE',
      path: '/api/v1/email/access/bindings/900',
      principal: owner,
    });

    expect(list.status).toBe(200);
    expect(createUser.status).toBe(201);
    expect(createGroup.status).toBe(201);
    expect(patch.status).toBe(200);
    expect(remove.status).toBe(200);
    expect(mailDelegation.listBindings).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: WORKSPACE,
      actor: expect.objectContaining({ userId: OWNER, isOwner: true }),
      resource: { type: 'account', accountId: ACCOUNT },
      cursor: 800,
      limit: 25,
    }));
    expect(list.body).toMatchObject({ data: { items: [{ id: 900 }], nextCursor: null } });
    expect(mailDelegation.replaceBinding).toHaveBeenNthCalledWith(1, expect.objectContaining({
      workspaceId: WORKSPACE,
      actor: expect.objectContaining({ userId: OWNER }),
      subject: { type: 'user', id: AGENT },
      resource: { type: 'account', accountId: ACCOUNT },
      permissions: ['mail.metadata.read', 'mail.content.read', 'mail.attachment.read'],
    }));
    expect(mailDelegation.replaceBinding).toHaveBeenNthCalledWith(2, expect.objectContaining({
      subject: { type: 'group', id: GROUP },
      resource: { type: 'folder', accountId: ACCOUNT, folderId: FOLDER },
      permissions: ['mail.metadata.read', 'mail.triage'],
    }));
    expect(mailDelegation.replaceBindingById).toHaveBeenCalledWith(expect.objectContaining({
      bindingId: 900,
      permissions: ['mail.metadata.read'],
    }));
    expect(mailDelegation.deleteBinding).toHaveBeenCalledWith(expect.objectContaining({ bindingId: 900 }));
  });

  test('rejects unknown permissions, invalid resources, and missing delegation management', async () => {
    const mailDelegation = delegationPort();
    const api = createServerApi(ports({ mailDelegation }));

    const unknownPermission = await api.handle({
      method: 'POST',
      path: '/api/v1/email/access/bindings',
      principal: admin,
      body: {
        subject: { type: 'user', id: AGENT },
        resource: { type: 'account', accountId: ACCOUNT },
        permissions: ['mail.metadata.read', 'mail.root'],
      },
    });
    const invalidFolder = await api.handle({
      method: 'POST',
      path: '/api/v1/email/access/bindings',
      principal: admin,
      body: {
        subject: { type: 'user', id: AGENT },
        resource: { type: 'folder', accountId: ACCOUNT },
        permissions: ['mail.metadata.read'],
      },
    });
    mailDelegation.replaceBinding.mockResolvedValueOnce({ ok: false, code: 'permission_denied' });
    const denied = await api.handle({
      method: 'POST',
      path: '/api/v1/email/access/bindings',
      principal: manager,
      body: {
        subject: { type: 'user', id: AGENT },
        resource: { type: 'account', accountId: ACCOUNT },
        permissions: ['mail.metadata.read'],
      },
    });

    expect(unknownPermission).toMatchObject({ status: 400, body: { error: { code: 'unknown_mail_permission' } } });
    expect(invalidFolder).toMatchObject({ status: 400, body: { error: { code: 'validation_error' } } });
    expect(denied).toMatchObject({ status: 403, body: { error: { code: 'mail_delegation_denied' } } });
  });

  test('rejects invalid delegation pagination before calling the port', async () => {
    const mailDelegation = delegationPort();
    const api = createServerApi(ports({ mailDelegation }));

    const invalidCursor = await api.handle({
      method: 'GET',
      path: '/api/v1/email/access/bindings?cursor=0',
      principal: owner,
    });
    const invalidLimit = await api.handle({
      method: 'GET',
      path: '/api/v1/email/access/bindings?limit=101',
      principal: owner,
    });

    expect(invalidCursor).toMatchObject({ status: 400, body: { error: { code: 'invalid_cursor' } } });
    expect(invalidLimit).toMatchObject({ status: 400, body: { error: { code: 'invalid_limit' } } });
    expect(mailDelegation.listBindings).not.toHaveBeenCalled();
  });

  test('prevents privilege escalation for delegated managers while owner/admin retain bypass', async () => {
    const grants = new Map<MailPermission, readonly MailAccessGrant[]>([
      ['mail.delegation.manage', [accountGrant(ACCOUNT)]],
      ['mail.metadata.read', [accountGrant(ACCOUNT)]],
    ]);
    const mailDelegation = delegationPort({
      replaceBinding: async (input) => {
        if (!input.actor.isOwner && !input.actor.isAdmin && input.permissions.includes('mail.send')) {
          return { ok: false as const, code: 'privilege_escalation' as const };
        }
        return { ok: true as const, binding: binding(901, input.permissions), affectedUserIds: [AGENT] };
      },
    });
    const api = createServerApi(ports({ mailDelegation, grants }));

    const escalated = await api.handle({
      method: 'POST',
      path: '/api/v1/email/access/bindings',
      principal: manager,
      body: {
        subject: { type: 'user', id: AGENT },
        resource: { type: 'account', accountId: ACCOUNT },
        permissions: ['mail.metadata.read', 'mail.send'],
      },
    });
    const adminAllowed = await api.handle({
      method: 'POST',
      path: '/api/v1/email/access/bindings',
      principal: admin,
      body: {
        subject: { type: 'user', id: AGENT },
        resource: { type: 'account', accountId: ACCOUNT },
        permissions: ['mail.send'],
      },
    });

    expect(escalated).toMatchObject({ status: 403, body: { error: { code: 'mail_delegation_privilege_escalation' } } });
    expect(adminAllowed.status).toBe(201);

    const access = new MailAccessService({ resolveGrants: jest.fn(async () => []) });
    await expect(access.assertPermission({
      workspaceId: WORKSPACE,
      actor: { workspaceId: WORKSPACE, userId: OWNER, isOwner: true, isAdmin: false },
      permission: 'mail.delegation.manage',
      resource: { type: 'account', accountId: String(ACCOUNT) },
    })).resolves.toBeUndefined();
    await expect(access.assertPermission({
      workspaceId: WORKSPACE,
      actor: { workspaceId: WORKSPACE, userId: AGENT, isOwner: false, isAdmin: false },
      permission: 'mail.delegation.manage',
      resource: { type: 'account', accountId: String(ACCOUNT) },
    })).rejects.toBeInstanceOf(MailAccessDeniedError);
  });

  test('audits only IDs and permission names and publishes target-user ACL invalidations', async () => {
    const audit = { record: jest.fn(async () => undefined) };
    const events = { publish: jest.fn(async () => undefined) };
    const mailDelegation = delegationPort({
      replaceBinding: async (input) => ({
        ok: true,
        binding: binding(901, input.permissions),
        affectedUserIds: [AGENT, MANAGER],
      }),
    });
    const api = createServerApi(ports({ mailDelegation, audit, events }));

    const response = await api.handle({
      method: 'POST',
      path: '/api/v1/email/access/bindings',
      principal: owner,
      body: {
        subject: { type: 'group', id: GROUP },
        resource: { type: 'folder', accountId: ACCOUNT, folderId: FOLDER },
        permissions: ['mail.metadata.read', 'mail.triage'],
      },
    });

    expect(response.status).toBe(201);
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      action: 'email_acl.binding_replaced',
      entityType: 'email_acl_binding',
      entityId: '901',
      metadata: {
        bindingId: 901,
        subjectType: 'group',
        subjectId: String(GROUP),
        resourceType: 'folder',
        accountId: ACCOUNT,
        folderId: FOLDER,
        permissionNames: ['mail.metadata.read', 'mail.triage'],
      },
    }));
    expect(JSON.stringify(audit.record.mock.calls)).not.toMatch(/@|body|filename/i);
    expect(events.publish).toHaveBeenCalledTimes(2);
    expect(events.publish).toHaveBeenCalledWith(expect.objectContaining({
      type: 'email_acl.changed',
      entityType: 'email_acl',
      entityId: '901',
      payload: { bindingId: 901, targetUserId: AGENT, state: 'changed' },
    }));
    expect(events.publish).toHaveBeenCalledWith(expect.objectContaining({
      payload: { bindingId: 901, targetUserId: MANAGER, state: 'changed' },
    }));
  });
});

function principal(userId: string, role: AuthenticatedPrincipal['role']): AuthenticatedPrincipal {
  return { userId, workspaceId: WORKSPACE, role };
}

function accountGrant(accountId: number): MailAccessGrant {
  return { resourceType: 'account', accountId, folderId: null, messageId: null };
}

function binding(id: number, permissions: readonly MailPermission[]): MailDelegationBinding {
  return {
    id,
    subject: { type: 'user', id: AGENT, label: 'Agent' },
    resource: { type: 'account', accountId: ACCOUNT, label: 'Support' },
    permissions,
    profile: null,
    updatedAt: '2026-07-19T12:00:00.000Z',
  };
}

function delegationPort(
  overrides: Partial<jest.Mocked<MailDelegationApiPort>> & Partial<MailDelegationApiPort> = {},
): jest.Mocked<MailDelegationApiPort> {
  return {
    listBindings: jest.fn(async () => ({
      ok: true as const,
      bindings: [binding(900, ['mail.metadata.read'])],
      nextCursor: null,
    })),
    replaceBinding: jest.fn(async (input) => ({
      ok: true as const,
      binding: binding(901, input.permissions),
      affectedUserIds: [AGENT],
    })),
    replaceBindingById: jest.fn(async (input) => ({
      ok: true as const,
      binding: binding(input.bindingId, input.permissions),
      affectedUserIds: [AGENT],
      deleted: input.permissions.length === 0,
    })),
    deleteBinding: jest.fn(async () => ({ ok: true as const, bindingId: 900, affectedUserIds: [AGENT] })),
    ...overrides,
  } as jest.Mocked<MailDelegationApiPort>;
}

function ports(input: {
  mailDelegation: jest.Mocked<MailDelegationApiPort>;
  grants?: ReadonlyMap<MailPermission, readonly MailAccessGrant[]>;
  audit?: ServerApiPorts['audit'];
  events?: ServerApiPorts['events'];
}): ServerApiPorts {
  return {
    auth: {} as ServerApiPorts['auth'],
    locks: {} as ServerApiPorts['locks'],
    mailDelegation: input.mailDelegation,
    mailResourceLookup: {
      resolve: jest.fn(async (_input) => [{ type: 'account', accountId: String(ACCOUNT) }]),
    },
    mailAccess: new MailAccessService({
      resolveGrants: jest.fn(async (request) => input.grants?.get(request.permission) ?? []),
    }),
    audit: input.audit,
    events: input.events,
  } as ServerApiPorts;
}
