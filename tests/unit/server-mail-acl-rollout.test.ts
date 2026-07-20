import type { MailPermission, MailResource } from '../../packages/core/src/email/mail-permissions';
import { createServerApi } from '../../packages/server/src/api/server-api';
import type {
  AuthenticatedPrincipal,
  ServerApiPorts,
  ServerEvent,
} from '../../packages/server/src/api/types';
import {
  enforceMailJobPolicy,
  filterMailEventForPrincipal,
} from '../../packages/server/src/mail-access/async-policy-enforcer';
import { MailAccessDeniedError } from '../../packages/server/src/mail-access/service';
import {
  MailAccessRolloutService,
  type MailAclRolloutLegacyPort,
  type MailAclRolloutStatePort,
} from '../../packages/server/src/mail-access/rollout-service';
import type {
  MailAccessGrant,
  MailAccessPort,
  MailAccessService,
  MailSqlScope,
} from '../../packages/server/src/mail-access/types';
import { buildTrustedServiceJobPayload, type QueuedJob } from '../../packages/server/src/jobs';

const WORKSPACE_A = '11111111-1111-4111-8111-111111111111';
const WORKSPACE_B = '22222222-2222-4222-8222-222222222222';
const USER_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OWNER_A = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ACCOUNT_A = 101;
const ACCOUNT_B = 202;
const FOLDER_A = 303;
const MESSAGE_A = 404;

const USER_ACTOR = Object.freeze({
  workspaceId: WORKSPACE_A,
  userId: USER_A,
  isOwner: false,
  isAdmin: false,
});

function accountGrant(accountId: number): MailAccessGrant {
  return { resourceType: 'account', accountId, folderId: null, messageId: null };
}

function folderGrant(accountId: number, folderId: number): MailAccessGrant {
  return { resourceType: 'folder', accountId, folderId, messageId: null };
}

function messageGrant(accountId: number, folderId: number, messageId: number): MailAccessGrant {
  return { resourceType: 'message', accountId, folderId, messageId };
}

function messageResource(
  accountId = ACCOUNT_A,
  folderId = FOLDER_A,
  messageId = MESSAGE_A,
): MailResource {
  return {
    type: 'message',
    accountId: String(accountId),
    folderId: String(folderId),
    messageId: String(messageId),
  };
}

function createRolloutFixture(input: Readonly<{
  mode?: 'shadow' | 'enforce';
  newGrants?: readonly MailAccessGrant[];
  legacyReadAccounts?: readonly number[];
  legacySendAccounts?: readonly number[];
  corruptState?: boolean;
}> = {}) {
  const increments: Array<Record<string, bigint | string>> = [];
  const state: MailAclRolloutStatePort = {
    async getState(workspaceId) {
      if (input.corruptState) {
        return {
          mode: 'enforce',
          evaluated: 0n,
          legacyAllowNewDeny: 0n,
          legacyDenyNewAllow: 0n,
          notComparable: 0n,
          observationStartedAt: null,
          observationUpdatedAt: null,
          diagnostic: 'invalid rollout mode: legacy',
        };
      }
      return {
        mode: input.mode ?? 'shadow',
        evaluated: 0n,
        legacyAllowNewDeny: 0n,
        legacyDenyNewAllow: 0n,
        notComparable: 0n,
        observationStartedAt: null,
        observationUpdatedAt: null,
      };
    },
    async increment(workspaceId, delta) {
      increments.push({ workspaceId, ...delta });
    },
    async getReadiness(workspaceId) {
      return {
        workspaceId,
        mode: input.mode ?? 'shadow',
        evaluated: 0n,
        legacyAllowNewDeny: 0n,
        legacyDenyNewAllow: 0n,
        notComparable: 0n,
        observationStartedAt: null,
        observationUpdatedAt: null,
        ready: false,
        enforced: false,
      };
    },
    async transitionToEnforce() {
      return { ok: true };
    },
    async resetShadowCounters() {
      return { ok: true };
    },
  };
  const legacy: MailAclRolloutLegacyPort & {
    calls: Array<{ permission: MailPermission; accountId?: number }>;
  } = {
    calls: [],
    async canAccessAccount(request) {
      this.calls.push({ permission: request.permission, accountId: request.accountId });
      const accounts = legacyFlagForPermission(request.permission) === 'can_read'
        ? input.legacyReadAccounts ?? []
        : input.legacySendAccounts ?? [];
      return accounts.includes(request.accountId);
    },
    async resolveAccountScope(request) {
      this.calls.push({ permission: request.permission });
      const accounts = legacyFlagForPermission(request.permission) === 'can_read'
        ? input.legacyReadAccounts ?? []
        : input.legacySendAccounts ?? [];
      return [...accounts];
    },
  };
  const newPort: MailAccessPort & {
    calls: Array<{ permission: MailPermission }>;
  } = {
    calls: [],
    async resolveGrants(request) {
      this.calls.push({ permission: request.permission });
      return input.newGrants ?? [];
    },
  };
  return {
    increments,
    legacy,
    newPort,
    service: new MailAccessRolloutService({ state, legacy, newAcl: newPort }),
  };
}

describe('MailAccessRolloutService', () => {
  test('shadow uses legacy allow as runtime decision and counts legacy-allow/new-deny mismatches', async () => {
    const fixture = createRolloutFixture({
      mode: 'shadow',
      newGrants: [],
      legacyReadAccounts: [ACCOUNT_A],
    });

    await expect(fixture.service.assertPermission({
      workspaceId: WORKSPACE_A,
      actor: USER_ACTOR,
      permission: 'mail.content.read',
      resource: messageResource(),
    })).resolves.toBeUndefined();

    expect(fixture.legacy.calls).toEqual([{ permission: 'mail.content.read', accountId: ACCOUNT_A }]);
    expect(fixture.newPort.calls).toEqual([{ permission: 'mail.content.read' }]);
    expect(fixture.increments).toEqual([{
      workspaceId: WORKSPACE_A,
      evaluated: 1n,
      legacyAllowNewDeny: 1n,
      legacyDenyNewAllow: 0n,
    }]);
  });

  test('shadow uses legacy deny as runtime decision and counts legacy-deny/new-allow mismatches', async () => {
    const fixture = createRolloutFixture({
      mode: 'shadow',
      newGrants: [accountGrant(ACCOUNT_A)],
      legacyReadAccounts: [],
    });

    await expect(fixture.service.assertPermission({
      workspaceId: WORKSPACE_A,
      actor: USER_ACTOR,
      permission: 'mail.metadata.read',
      resource: messageResource(),
    })).rejects.toBeInstanceOf(MailAccessDeniedError);

    expect(fixture.increments).toEqual([{
      workspaceId: WORKSPACE_A,
      evaluated: 1n,
      legacyAllowNewDeny: 0n,
      legacyDenyNewAllow: 1n,
    }]);
  });

  test.each([
    ['mail.metadata.read', 'can_read'],
    ['mail.content.read', 'can_read'],
    ['mail.attachment.read', 'can_read'],
    ['mail.draft.create', 'can_send'],
    ['mail.draft.edit', 'can_send'],
    ['mail.send', 'can_send'],
  ] as const)('maps %s exactly to legacy %s', async (permission, _legacyFlag) => {
    const fixture = createRolloutFixture({
      mode: 'shadow',
      newGrants: [],
      legacyReadAccounts: ['mail.metadata.read', 'mail.content.read', 'mail.attachment.read'].includes(permission)
        ? [ACCOUNT_A]
        : [],
      legacySendAccounts: ['mail.draft.create', 'mail.draft.edit', 'mail.send'].includes(permission)
        ? [ACCOUNT_A]
        : [],
    });

    await expect(fixture.service.assertPermission({
      workspaceId: WORKSPACE_A,
      actor: USER_ACTOR,
      permission,
      resource: { type: 'account', accountId: String(ACCOUNT_A) },
    })).resolves.toBeUndefined();
  });

  test('non-comparable permissions are new-ACL-enforced in shadow and increment only notComparable', async () => {
    const fixture = createRolloutFixture({
      mode: 'shadow',
      newGrants: [],
      legacyReadAccounts: [ACCOUNT_A],
      legacySendAccounts: [ACCOUNT_A],
    });

    await expect(fixture.service.assertPermission({
      workspaceId: WORKSPACE_A,
      actor: USER_ACTOR,
      permission: 'mail.delete',
      resource: messageResource(),
    })).rejects.toBeInstanceOf(MailAccessDeniedError);

    expect(fixture.legacy.calls).toEqual([]);
    expect(fixture.increments).toEqual([{ workspaceId: WORKSPACE_A, notComparable: 1n }]);
  });

  test('owner and admin bypass both ACL systems and do not affect counters', async () => {
    for (const actor of [
      { workspaceId: WORKSPACE_A, userId: OWNER_A, isOwner: true, isAdmin: false },
      { workspaceId: WORKSPACE_A, userId: OWNER_A, isOwner: false, isAdmin: true },
    ]) {
      const fixture = createRolloutFixture({ mode: 'shadow' });
      await expect(fixture.service.resolveScope({
        workspaceId: WORKSPACE_A,
        actor,
        permission: 'mail.metadata.read',
      })).resolves.toEqual({ kind: 'all' });
      await expect(fixture.service.assertPermission({
        workspaceId: WORKSPACE_A,
        actor,
        permission: 'mail.metadata.read',
        resource: messageResource(),
      })).resolves.toBeUndefined();
      expect(fixture.legacy.calls).toEqual([]);
      expect(fixture.newPort.calls).toEqual([]);
      expect(fixture.increments).toEqual([]);
    }
  });

  test('shadow resolveScope returns account-bound legacy scope and counts both hierarchical mismatch directions', async () => {
    const fixture = createRolloutFixture({
      mode: 'shadow',
      legacyReadAccounts: [ACCOUNT_A],
      newGrants: [
        folderGrant(ACCOUNT_A, FOLDER_A),
        messageGrant(ACCOUNT_B, 909, 808),
      ],
    });

    await expect(fixture.service.resolveScope({
      workspaceId: WORKSPACE_A,
      actor: USER_ACTOR,
      permission: 'mail.metadata.read',
    })).resolves.toEqual({
      kind: 'restricted',
      accountIds: [ACCOUNT_A],
      folderIds: [],
      messageIds: [],
    });

    expect(fixture.increments).toEqual([{
      workspaceId: WORKSPACE_A,
      evaluated: 1n,
      legacyAllowNewDeny: 1n,
      legacyDenyNewAllow: 1n,
    }]);
  });

  test('enforce mode uses only the new ACL and never calls the legacy port', async () => {
    const fixture = createRolloutFixture({
      mode: 'enforce',
      newGrants: [accountGrant(ACCOUNT_A)],
      legacyReadAccounts: [],
    });

    await expect(fixture.service.assertPermission({
      workspaceId: WORKSPACE_A,
      actor: USER_ACTOR,
      permission: 'mail.content.read',
      resource: messageResource(),
    })).resolves.toBeUndefined();
    await expect(fixture.service.resolveScope({
      workspaceId: WORKSPACE_A,
      actor: USER_ACTOR,
      permission: 'mail.content.read',
    })).resolves.toEqual({
      kind: 'restricted',
      accountIds: [ACCOUNT_A],
      folderIds: [],
      messageIds: [],
    });

    expect(fixture.legacy.calls).toEqual([]);
    expect(fixture.increments).toEqual([]);
  });

  test('cross-workspace and corrupt state fail closed to enforce without legacy fallback', async () => {
    const crossWorkspace = createRolloutFixture({
      mode: 'shadow',
      newGrants: [accountGrant(ACCOUNT_A)],
      legacyReadAccounts: [ACCOUNT_A],
    });
    await expect(crossWorkspace.service.assertPermission({
      workspaceId: WORKSPACE_B,
      actor: USER_ACTOR,
      permission: 'mail.content.read',
      resource: messageResource(),
    })).rejects.toBeInstanceOf(MailAccessDeniedError);
    expect(crossWorkspace.legacy.calls).toEqual([]);
    expect(crossWorkspace.increments).toEqual([]);

    const corrupt = createRolloutFixture({
      corruptState: true,
      newGrants: [],
      legacyReadAccounts: [ACCOUNT_A],
    });
    await expect(corrupt.service.assertPermission({
      workspaceId: WORKSPACE_A,
      actor: USER_ACTOR,
      permission: 'mail.content.read',
      resource: messageResource(),
    })).rejects.toBeInstanceOf(MailAccessDeniedError);
    expect(corrupt.legacy.calls).toEqual([]);
  });
});

describe('mail ACL rollout central use', () => {
  test('HTTP, user jobs, and user event filters all use the injected rollout service', async () => {
    const calls: string[] = [];
    const mailAccess: MailAccessService = {
      async assertPermission(input) {
        calls.push(`assert:${input.permission}:${input.resource.type}`);
      },
      async resolveScope(input) {
        calls.push(`scope:${input.permission}`);
        return { kind: 'restricted', accountIds: [ACCOUNT_A], folderIds: [], messageIds: [] };
      },
    };
    const ports = makeCentralPorts(mailAccess);
    const api = createServerApi(ports);

    await api.handle({
      method: 'GET',
      path: '/api/v1/email/messages',
      principal: principal(),
    });
    await enforceMailJobPolicy(job({
      type: 'mail.spam.score',
      payload: { workspaceId: WORKSPACE_A, actorUserId: USER_A, messageId: MESSAGE_A },
    }), ports);
    await filterMailEventForPrincipal(mailEvent(), { principal: principal(), ports });

    expect(calls).toEqual([
      'scope:mail.metadata.read',
      'assert:mail.triage:message',
      'assert:mail.metadata.read:message',
    ]);
  });

  test('service jobs stay on Task-6 new ACL semantics and never increment rollout counters', async () => {
    const fixture = createRolloutFixture({ mode: 'shadow', newGrants: [], legacyReadAccounts: [ACCOUNT_A] });
    const ports = makeCentralPorts(fixture.service);

    await expect(enforceMailJobPolicy(job({
      type: 'mail.sync.imap',
      payload: buildTrustedServiceJobPayload({
        workspaceId: WORKSPACE_A,
        accountId: ACCOUNT_A,
      }),
    }), ports)).resolves.toBeUndefined();

    expect(fixture.legacy.calls).toEqual([]);
    expect(fixture.increments).toEqual([]);
  });

  test('readiness and one-way transition admin API are owner/admin-only and audited', async () => {
    const auditEvents: Array<Record<string, unknown>> = [];
    const rollout = {
      getReadiness: jest.fn(async () => ({
        workspaceId: WORKSPACE_A,
        mode: 'shadow' as const,
        evaluated: 7n,
        legacyAllowNewDeny: 0n,
        legacyDenyNewAllow: 0n,
        notComparable: 2n,
        observationStartedAt: '2026-07-20T10:00:00.000Z',
        observationUpdatedAt: '2026-07-20T10:05:00.000Z',
        ready: true,
        enforced: false,
      })),
      transitionToEnforce: jest.fn(async () => ({ ok: true as const })),
      resetShadowCounters: jest.fn(async () => ({ ok: true as const })),
    };
    const api = createServerApi({
      ...makeCentralPorts({
        async assertPermission() {},
        async resolveScope() { return { kind: 'all' }; },
      }),
      mailAclRollout: rollout,
      audit: {
        async record(event) {
          auditEvents.push(event);
        },
      },
    } as ServerApiPorts);

    await expect(api.handle({
      method: 'GET',
      path: '/api/v1/email/acl-rollout/readiness',
      principal: principal('user'),
    })).resolves.toMatchObject({ status: 403 });

    await expect(api.handle({
      method: 'GET',
      path: '/api/v1/email/acl-rollout/readiness',
      principal: principal('admin'),
    })).resolves.toMatchObject({
      status: 200,
      body: {
        data: expect.objectContaining({
          mode: 'shadow',
          evaluated: '7',
          legacyAllowNewDeny: '0',
          legacyDenyNewAllow: '0',
          notComparable: '2',
          ready: true,
        }),
      },
    });
    await expect(api.handle({
      method: 'POST',
      path: '/api/v1/email/acl-rollout/reset-counters',
      principal: principal('owner'),
    })).resolves.toMatchObject({ status: 200 });
    await expect(api.handle({
      method: 'POST',
      path: '/api/v1/email/acl-rollout/enforce',
      principal: principal('owner'),
    })).resolves.toMatchObject({ status: 200 });

    expect(rollout.transitionToEnforce).toHaveBeenCalledWith({ workspaceId: WORKSPACE_A });
    expect(rollout.resetShadowCounters).toHaveBeenCalledWith({ workspaceId: WORKSPACE_A });
    expect(auditEvents.map((event) => event.action)).toEqual([
      'mail_acl_rollout.counters_reset',
      'mail_acl_rollout.enforced',
    ]);
    expect(JSON.stringify(auditEvents)).not.toContain(String(MESSAGE_A));
  });
});

function legacyFlagForPermission(permission: MailPermission): 'can_read' | 'can_send' {
  return ['mail.metadata.read', 'mail.content.read', 'mail.attachment.read'].includes(permission)
    ? 'can_read'
    : 'can_send';
}

function principal(role: AuthenticatedPrincipal['role'] = 'user'): AuthenticatedPrincipal {
  return {
    workspaceId: WORKSPACE_A,
    userId: role === 'user' ? USER_A : OWNER_A,
    role,
  };
}

function makeCentralPorts(mailAccess: MailAccessService): ServerApiPorts {
  return {
    auth: {
      async listUsers() {
        return [
          { id: USER_A, email: 'user@example.test', displayName: 'User', role: 'user', disabledAt: null, loginPinEnabled: false, mfaEnabled: false, mfaMethod: null },
        ];
      },
    } as ServerApiPorts['auth'],
    locks: {} as ServerApiPorts['locks'],
    mailAccess,
    mailResourceLookup: {
      async resolve(input) {
        if (input.target.kind === 'message') return [messageResource(ACCOUNT_A, FOLDER_A, Number(input.target.id))];
        if (input.target.kind === 'account') return [{ type: 'account', accountId: String(input.target.id) }];
        return [];
      },
    },
    emailMessages: {
      async list() {
        return { items: [], nextCursor: null };
      },
      async get() {
        return null;
      },
    } as ServerApiPorts['emailMessages'],
  } as ServerApiPorts;
}

function mailEvent(): ServerEvent {
  return {
    type: 'email_message.updated',
    workspaceId: WORKSPACE_A,
    entityType: 'email_message',
    entityId: String(MESSAGE_A),
    actorUserId: USER_A,
    occurredAt: '2026-07-20T10:00:00.000Z',
    payload: { messageId: MESSAGE_A, state: 'updated' },
  };
}

function job(input: {
  type: string;
  payload: Record<string, unknown>;
}): QueuedJob {
  return {
    id: 1,
    type: input.type,
    payload: input.payload,
    workspaceId: String(input.payload.workspaceId ?? WORKSPACE_A),
    runAfter: '2026-07-20T10:00:00.000Z',
    attempts: 0,
    maxAttempts: 5,
    lockedAt: null,
    lockedBy: null,
    lastError: null,
    createdAt: '2026-07-20T10:00:00.000Z',
    updatedAt: '2026-07-20T10:00:00.000Z',
  };
}
