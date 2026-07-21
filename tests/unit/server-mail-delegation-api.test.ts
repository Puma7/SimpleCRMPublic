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
  test('lists bounded policy resources and data-minimized subjects for delegated managers', async () => {
    const mailDelegation = delegationPort();
    const api = createServerApi(ports({ mailDelegation }));

    const resources = await api.handle({
      method: 'GET',
      path: '/api/v1/email/access/resources?resourceType=folder&cursor=200&limit=25',
      principal: manager,
    });
    const subjects = await api.handle({
      method: 'GET',
      path: `/api/v1/email/access/subjects?resourceType=folder&accountId=${ACCOUNT}&folderId=${FOLDER}&subjectType=user&cursor=${OWNER}&limit=25`,
      principal: manager,
    });

    expect(resources).toMatchObject({
      status: 200,
      body: {
        data: {
          items: [{ type: 'folder', accountId: ACCOUNT, folderId: FOLDER, accountLabel: 'Support', label: 'INBOX' }],
          nextCursor: null,
        },
      },
    });
    expect(subjects).toMatchObject({
      status: 200,
      body: { data: { items: [{ type: 'user', id: AGENT, label: 'Agent' }], nextCursor: null } },
    });
    expect(JSON.stringify(subjects.body)).not.toMatch(/email|role|disabled/i);
    expect(mailDelegation.listResourceOptions).toHaveBeenCalledWith({
      workspaceId: WORKSPACE,
      actor: expect.objectContaining({ userId: MANAGER, isOwner: false, isAdmin: false }),
      resourceType: 'folder',
      cursor: 200,
      limit: 25,
    });
    expect(mailDelegation.listSubjectOptions).toHaveBeenCalledWith({
      workspaceId: WORKSPACE,
      actor: expect.objectContaining({ userId: MANAGER, isOwner: false, isAdmin: false }),
      resource: { type: 'folder', accountId: ACCOUNT, folderId: FOLDER },
      subjectType: 'user',
      cursor: OWNER,
      limit: 25,
    });
  });

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

  test('validates option resource/cursors and maps policy denial and write conflicts', async () => {
    const mailDelegation = delegationPort();
    const api = createServerApi(ports({ mailDelegation }));

    const invalidResourceType = await api.handle({
      method: 'GET',
      path: '/api/v1/email/access/resources?resourceType=message',
      principal: manager,
    });
    const invalidSubjectCursor = await api.handle({
      method: 'GET',
      path: `/api/v1/email/access/subjects?resourceType=folder&accountId=${ACCOUNT}&folderId=${FOLDER}&subjectType=user&cursor=not-a-uuid`,
      principal: manager,
    });
    mailDelegation.listSubjectOptions.mockResolvedValueOnce({ ok: false, code: 'permission_denied' });
    const denied = await api.handle({
      method: 'GET',
      path: `/api/v1/email/access/subjects?resourceType=account&accountId=${ACCOUNT}&subjectType=group`,
      principal: manager,
    });
    mailDelegation.replaceBindingById.mockResolvedValueOnce({ ok: false, code: 'binding_conflict' } as never);
    const conflict = await api.handle({
      method: 'PATCH',
      path: '/api/v1/email/access/bindings/900',
      principal: owner,
      body: { permissions: ['mail.metadata.read'] },
    });

    expect(invalidResourceType).toMatchObject({ status: 400, body: { error: { code: 'validation_error' } } });
    expect(invalidSubjectCursor).toMatchObject({ status: 400, body: { error: { code: 'invalid_cursor' } } });
    expect(denied).toMatchObject({ status: 403, body: { error: { code: 'mail_delegation_denied' } } });
    expect(conflict).toMatchObject({ status: 409, body: { error: { code: 'mail_delegation_conflict' } } });
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
    // R20-1: the invalidation now also carries the binding's resource so the event
    // filter can deliver it to a scoped mail.delegation.manage holder on that folder.
    expect(events.publish).toHaveBeenCalledWith(expect.objectContaining({
      type: 'email_acl.changed',
      entityType: 'email_acl',
      entityId: '901',
      payload: {
        bindingId: 901, targetUserId: AGENT, state: 'changed',
        resourceType: 'folder', accountId: ACCOUNT, folderId: FOLDER,
      },
    }));
    expect(events.publish).toHaveBeenCalledWith(expect.objectContaining({
      payload: {
        bindingId: 901, targetUserId: MANAGER, state: 'changed',
        resourceType: 'folder', accountId: ACCOUNT, folderId: FOLDER,
      },
    }));
  });

  test('a rejecting invalidation publish for one target still fans out to the rest and does not fail the committed replace (R44-1)', async () => {
    // A group-binding replace can revoke several members at once. The mutation already
    // committed, so one target's transient publish failure must neither skip the remaining
    // members' invalidations nor surface as a request error.
    let publishCalls = 0;
    const events = { publish: jest.fn(async () => {
      publishCalls += 1;
      if (publishCalls === 1) throw new Error('event bus hiccup');
      return undefined;
    }) };
    const mailDelegation = delegationPort({
      replaceBinding: async (input) => ({
        ok: true,
        binding: binding(901, input.permissions),
        affectedUserIds: [AGENT, MANAGER],
      }),
    });
    const api = createServerApi(ports({ mailDelegation, events }));

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

    // The committed replace is NOT reported as a failure despite the first publish rejecting.
    expect(response.status).toBe(201);
    // Both members were still published (allSettled continues past the failure).
    expect(events.publish).toHaveBeenCalledTimes(2);
    expect(events.publish).toHaveBeenCalledWith(expect.objectContaining({
      payload: expect.objectContaining({ targetUserId: AGENT }),
    }));
    expect(events.publish).toHaveBeenCalledWith(expect.objectContaining({
      payload: expect.objectContaining({ targetUserId: MANAGER }),
    }));
  });

  test('a rejecting audit port does not fail the committed binding mutation (R37-1)', async () => {
    const audit = { record: jest.fn(async () => { throw new Error('audit backend down'); }) };
    const events = { publish: jest.fn(async () => undefined) };
    const mailDelegation = delegationPort({
      deleteBinding: async () => ({
        ok: true,
        bindingId: 900,
        resource: { type: 'folder', accountId: ACCOUNT, folderId: FOLDER },
        affectedUserIds: [AGENT],
      }),
    });
    const api = createServerApi(ports({ mailDelegation, audit, events }));

    // The binding delete already committed and the invalidation events already
    // published before the best-effort audit runs; a transient audit rejection must
    // NOT surface as a 500 — that would report a successful delete as a failure and
    // drive a client retry into binding_not_found.
    const res = await api.handle({ method: 'DELETE', path: '/api/v1/email/access/bindings/900', principal: owner });
    expect(res.status).toBe(200);
    expect(events.publish).toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalled();
  });

  test('empty-permission PATCH delete carries the deleted resource so scoped peer managers are invalidated (R41-2)', async () => {
    const events = { publish: jest.fn(async () => undefined) };
    const mailDelegation = delegationPort({
      // An empty permission list deletes the binding: binding is null, but the port
      // returns the deleted row's resource as tombstone data.
      replaceBindingById: async () => ({
        ok: true as const,
        binding: null,
        resource: { type: 'folder' as const, accountId: ACCOUNT, folderId: FOLDER },
        deletedBindingId: 900,
        affectedUserIds: [AGENT],
        deleted: true as const,
      }),
    });
    const api = createServerApi(ports({ mailDelegation, events }));

    const res = await api.handle({
      method: 'PATCH',
      path: '/api/v1/email/access/bindings/900',
      principal: owner,
      body: { permissions: [] },
    });
    expect(res.status).toBe(200);
    // The empty-PATCH deletion invalidation now carries the deleted binding's resource
    // (like the dedicated DELETE path), so a peer non-admin mail.delegation.manage holder
    // scoped to that folder is refreshed rather than left with the stale row.
    expect(events.publish).toHaveBeenCalledWith(expect.objectContaining({
      type: 'email_acl.changed',
      entityType: 'email_acl',
      payload: expect.objectContaining({
        targetUserId: AGENT,
        state: 'deleted',
        resourceType: 'folder',
        accountId: ACCOUNT,
        folderId: FOLDER,
      }),
    }));
  });

  test('binding deletion carries the deleted resource so scoped peer managers are invalidated', async () => {
    const events = { publish: jest.fn(async () => undefined) };
    const mailDelegation = delegationPort({
      deleteBinding: async () => ({
        ok: true,
        bindingId: 900,
        resource: { type: 'folder', accountId: ACCOUNT, folderId: FOLDER },
        affectedUserIds: [AGENT],
      }),
    });
    const api = createServerApi(ports({ mailDelegation, events }));

    const res = await api.handle({ method: 'DELETE', path: '/api/v1/email/access/bindings/900', principal: owner });
    expect(res.status).toBe(200);
    // R34-2: the deletion invalidation carries the deleted binding's resource so the
    // event filter can deliver it to a PEER non-admin mail.delegation.manage holder
    // scoped to that folder — not only the affected subject.
    expect(events.publish).toHaveBeenCalledWith(expect.objectContaining({
      type: 'email_acl.changed',
      entityType: 'email_acl',
      entityId: '900',
      payload: {
        bindingId: 900, targetUserId: AGENT, state: 'deleted',
        resourceType: 'folder', accountId: ACCOUNT, folderId: FOLDER,
      },
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
): jest.Mocked<MailDelegationApiPort> & {
  listResourceOptions: jest.Mock;
  listSubjectOptions: jest.Mock;
} {
  return {
    listBindings: jest.fn(async () => ({
      ok: true as const,
      bindings: [binding(900, ['mail.metadata.read'])],
      nextCursor: null,
    })),
    listResourceOptions: jest.fn(async () => ({
      ok: true as const,
      resources: [{
        type: 'folder' as const,
        accountId: ACCOUNT,
        folderId: FOLDER,
        accountLabel: 'Support',
        label: 'INBOX',
      }],
      nextCursor: null,
    })),
    listSubjectOptions: jest.fn(async () => ({
      ok: true as const,
      subjects: [{ type: 'user' as const, id: AGENT, label: 'Agent' }],
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
    deleteBinding: jest.fn(async () => ({ ok: true as const, bindingId: 900, resource: { type: 'folder' as const, accountId: ACCOUNT, folderId: FOLDER }, affectedUserIds: [AGENT] })),
    ...overrides,
  } as unknown as jest.Mocked<MailDelegationApiPort> & {
    listResourceOptions: jest.Mock;
    listSubjectOptions: jest.Mock;
  };
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
