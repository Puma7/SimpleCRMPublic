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
  incrementFailure?: 'throw' | 'zero_rows' | 'counter_saturated';
  markTelemetryFailure?: boolean;
  diagnosticReporterFailure?: boolean;
}> = {}) {
  const increments: Array<Record<string, bigint | string>> = [];
  const unhealthyMarks: string[] = [];
  const diagnostics: string[] = [];
  const state = {
    async withSharedEvaluation<T>(
      workspaceId: string,
      operation: (context: { workspaceId: string }) => Promise<{
        value: T;
        delta?: Readonly<Partial<{
          evaluated: bigint;
          legacyAllowNewDeny: bigint;
          legacyDenyNewAllow: bigint;
          notComparable: bigint;
        }>>;
      }>,
    ) {
      const outcome = await operation({ workspaceId });
      if (outcome.delta) increments.push({ workspaceId, ...outcome.delta });
      if (input.incrementFailure === 'throw') {
        unhealthyMarks.push('counter_update_failed');
        return {
          value: outcome.value,
          telemetry: { healthy: false as const, code: 'counter_update_failed' as const },
        };
      }
      if (input.incrementFailure === 'zero_rows') {
        return {
          value: outcome.value,
          telemetry: { healthy: false as const, code: 'counter_update_zero_rows' as const },
        };
      }
      if (input.incrementFailure === 'counter_saturated') {
        return {
          value: outcome.value,
          telemetry: { healthy: false as const, code: 'counter_saturated' as const },
        };
      }
      return { value: outcome.value, telemetry: { healthy: true as const } };
    },
    async getState(workspaceId: string) {
      if (input.corruptState) {
        return {
          mode: 'enforce',
          evaluated: 0n,
          legacyAllowNewDeny: 0n,
          legacyDenyNewAllow: 0n,
          notComparable: 0n,
          observationStartedAt: null,
          observationUpdatedAt: null,
          telemetryHealthy: false,
          diagnosticCode: 'rollout_state_invalid' as const,
          diagnosticAt: null,
          diagnostic: 'invalid rollout mode: legacy',
        };
      }
      return {
        mode: input.mode ?? 'shadow',
        evaluated: 0n,
        legacyAllowNewDeny: 0n,
        legacyDenyNewAllow: 0n,
        notComparable: 0n,
        inFlight: 0n,
        observationStartedAt: null,
        observationUpdatedAt: null,
        telemetryHealthy: true,
        diagnosticCode: null,
        diagnosticAt: null,
      };
    },
    async increment(
      workspaceId: string,
      delta: Readonly<Partial<{
        evaluated: bigint;
        legacyAllowNewDeny: bigint;
        legacyDenyNewAllow: bigint;
        notComparable: bigint;
      }>>,
    ) {
      increments.push({ workspaceId, ...delta });
      if (input.incrementFailure === 'throw') throw new Error('counter unavailable');
      if (input.incrementFailure === 'zero_rows') {
        return { healthy: false as const, code: 'counter_update_zero_rows' as const };
      }
      if (input.incrementFailure === 'counter_saturated') {
        return { healthy: false as const, code: 'counter_saturated' as const };
      }
      return { healthy: true as const };
    },
    async markTelemetryUnhealthy(_workspaceId: string, code: string) {
      unhealthyMarks.push(code);
      if (input.markTelemetryFailure) throw new Error('diagnostic store unavailable');
    },
    async getReadiness(workspaceId: string) {
      return {
        workspaceId,
        mode: input.mode ?? 'shadow',
        evaluated: 0n,
        legacyAllowNewDeny: 0n,
        legacyDenyNewAllow: 0n,
        notComparable: 0n,
        inFlight: 0n,
        observationStartedAt: null,
        observationUpdatedAt: null,
        ready: false,
        enforced: false,
        telemetryHealthy: true,
        diagnosticCode: null,
        diagnosticAt: null,
      };
    },
    async transitionToEnforce() {
      return { ok: true };
    },
    async resetShadowCounters() {
      return { ok: true };
    },
  } as unknown as MailAclRolloutStatePort;
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
  const serviceOptions = {
    state,
    legacy,
    newAcl: newPort,
    onTelemetryDiagnostic(event: { code: string }) {
      diagnostics.push(event.code);
      if (input.diagnosticReporterFailure) throw new Error('logger unavailable');
    },
  };
  return {
    increments,
    unhealthyMarks,
    diagnostics,
    legacy,
    newPort,
    service: new MailAccessRolloutService(serviceOptions),
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

  test('counter exceptions and failed diagnostic persistence preserve a shadow legacy allow', async () => {
    const fixture = createRolloutFixture({
      mode: 'shadow',
      newGrants: [],
      legacyReadAccounts: [ACCOUNT_A],
      incrementFailure: 'throw',
      markTelemetryFailure: true,
    });

    await expect(fixture.service.assertPermission({
      workspaceId: WORKSPACE_A,
      actor: USER_ACTOR,
      permission: 'mail.content.read',
      resource: messageResource(),
    })).resolves.toBeUndefined();

    expect(fixture.unhealthyMarks).toEqual(['counter_update_failed']);
    expect(fixture.diagnostics).toEqual(['counter_update_failed']);
  });

  test('counter exceptions preserve a shadow legacy deny instead of replacing it with telemetry failure', async () => {
    const fixture = createRolloutFixture({
      mode: 'shadow',
      newGrants: [accountGrant(ACCOUNT_A)],
      legacyReadAccounts: [],
      incrementFailure: 'throw',
    });

    await expect(fixture.service.assertPermission({
      workspaceId: WORKSPACE_A,
      actor: USER_ACTOR,
      permission: 'mail.metadata.read',
      resource: messageResource(),
    })).rejects.toBeInstanceOf(MailAccessDeniedError);

    expect(fixture.unhealthyMarks).toEqual(['counter_update_failed']);
    expect(fixture.diagnostics).toEqual(['counter_update_failed']);
  });

  test('zero-row telemetry leaves the legacy decision unchanged and reports a bounded diagnostic', async () => {
    const fixture = createRolloutFixture({
      mode: 'shadow',
      newGrants: [],
      legacyReadAccounts: [ACCOUNT_A],
      incrementFailure: 'zero_rows',
    });

    await expect(fixture.service.assertPermission({
      workspaceId: WORKSPACE_A,
      actor: USER_ACTOR,
      permission: 'mail.content.read',
      resource: messageResource(),
    })).resolves.toBeUndefined();
    expect(fixture.diagnostics).toEqual(['counter_update_zero_rows']);
  });

  test('non-comparable new ACL allow and deny survive counter and logger failures exactly', async () => {
    const allowed = createRolloutFixture({
      mode: 'shadow',
      newGrants: [accountGrant(ACCOUNT_A)],
      incrementFailure: 'throw',
      diagnosticReporterFailure: true,
    });
    const denied = createRolloutFixture({
      mode: 'shadow',
      newGrants: [],
      incrementFailure: 'throw',
      diagnosticReporterFailure: true,
    });

    await expect(allowed.service.assertPermission({
      workspaceId: WORKSPACE_A,
      actor: USER_ACTOR,
      permission: 'mail.delete',
      resource: messageResource(),
    })).resolves.toBeUndefined();
    await expect(denied.service.assertPermission({
      workspaceId: WORKSPACE_A,
      actor: USER_ACTOR,
      permission: 'mail.delete',
      resource: messageResource(),
    })).rejects.toBeInstanceOf(MailAccessDeniedError);
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
      // GET /messages authorizes on mail.metadata.read but also resolves the
      // mail.content.read scope so the read port can redact body-derived content
      // per row for a metadata-only delegate.
      'scope:mail.metadata.read',
      'scope:mail.content.read',
      // mail.spam.score (user-attributed): base mail.triage, then the content-read
      // supplemental because scoring reads the body and ships raw content to Rspamd.
      'assert:mail.triage:message',
      'assert:mail.content.read:message',
      'assert:mail.metadata.read:message',
    ]);
  });

  test('thread-alias DELETE authorizes every message in both stored threads', async () => {
    const deniedMessages = new Set<string>();
    const mailAccess: MailAccessService = {
      async assertPermission(input) {
        if (input.resource.type === 'message' && deniedMessages.has(input.resource.messageId)) {
          throw new MailAccessDeniedError();
        }
      },
      async resolveScope() {
        return { kind: 'all' };
      },
    };
    const aliasRecord = {
      id: 9500,
      sourceSqliteId: 9500,
      accountSourceSqliteId: null,
      accountId: ACCOUNT_A,
      aliasThreadId: 'thread-alias',
      canonicalThreadId: 'thread-canonical',
      confidence: 'high',
      source: 'manual_merge',
      createdAt: '2026-07-20T10:00:00.000Z',
      updatedAt: '2026-07-20T10:00:00.000Z',
    };
    const deleteAlias = jest.fn(async () => aliasRecord);
    const ports: ServerApiPorts = {
      ...makeCentralPorts(mailAccess),
      mailResourceLookup: {
        async resolve(input) {
          const target = input.target;
          // Base metadata resolution → the alias's own account (accessible).
          if (target.kind === 'metadata' && target.entity === 'thread_alias') {
            return [{ type: 'account', accountId: String(ACCOUNT_A) }];
          }
          // The canonical thread spans a second account the delegate cannot triage.
          if (target.kind === 'thread' && target.id === 'thread-canonical') {
            return [messageResource(ACCOUNT_A, FOLDER_A, 501), messageResource(ACCOUNT_B, 505, 502)];
          }
          if (target.kind === 'thread' && target.id === 'thread-alias') {
            return [messageResource(ACCOUNT_A, FOLDER_A, 503)];
          }
          return [];
        },
        async resolveThreadAliasThreadIds(input) {
          return input.aliasId === 9500
            ? { aliasThreadId: 'thread-alias', canonicalThreadId: 'thread-canonical' }
            : null;
        },
      },
      emailThreadAliases: {
        async list() {
          return { items: [], nextCursor: null };
        },
        async get() {
          return null;
        },
        async delete() {
          return deleteAlias();
        },
      } as unknown as ServerApiPorts['emailThreadAliases'],
    };
    const api = createServerApi(ports);

    // A message in the canonical thread lives in an account the delegate cannot
    // triage → the DELETE is denied and the alias is never removed.
    deniedMessages.add('502');
    await expect(api.handle({
      method: 'DELETE',
      path: '/api/v1/email/thread-aliases/9500',
      principal: principal(),
    })).resolves.toMatchObject({ status: 404 });
    expect(deleteAlias).not.toHaveBeenCalled();

    // With triage on every message in both stored threads, the delete proceeds.
    deniedMessages.clear();
    await expect(api.handle({
      method: 'DELETE',
      path: '/api/v1/email/thread-aliases/9500',
      principal: principal(),
    })).resolves.toMatchObject({ status: 200 });
    expect(deleteAlias).toHaveBeenCalledTimes(1);
  });

  test('security-check POST requires content-read in addition to triage', async () => {
    // The scan reconstructs the raw message and returns content-derived Rspamd
    // symbols, so a triage-only delegate without content access must be blocked
    // before the handler runs — mirroring the sibling GET /security route.
    const runSecurityCheck = jest.fn(async () => null);
    const withMailAccess = (mailAccess: MailAccessService) => createServerApi({
      ...makeCentralPorts(mailAccess),
      emailMessages: {
        async list() { return { items: [], nextCursor: null }; },
        async get() { return null; },
        runSecurityCheck,
      } as unknown as ServerApiPorts['emailMessages'],
    });

    // content-read denied → the supplemental gate rejects before the handler,
    // so runSecurityCheck is never reached.
    const denyContentRead = withMailAccess({
      async assertPermission(input) {
        if (input.permission === 'mail.content.read') throw new MailAccessDeniedError();
      },
      async resolveScope() { return { kind: 'all' }; },
    });
    await expect(denyContentRead.handle({
      method: 'POST',
      path: `/api/v1/email/messages/${MESSAGE_A}/security/check`,
      body: { applyStatus: true },
      principal: principal(),
    })).resolves.toMatchObject({ status: 404 });
    expect(runSecurityCheck).not.toHaveBeenCalled();

    // With both grants the enforcer asserts triage AND content-read on the message
    // before dispatching to the handler.
    const calls: string[] = [];
    const allowAll = withMailAccess({
      async assertPermission(input) { calls.push(`assert:${input.permission}:${input.resource.type}`); },
      async resolveScope() { return { kind: 'all' }; },
    });
    await allowAll.handle({
      method: 'POST',
      path: `/api/v1/email/messages/${MESSAGE_A}/security/check`,
      body: { applyStatus: true },
      principal: principal(),
    });
    expect(calls).toEqual(expect.arrayContaining([
      'assert:mail.triage:message',
      'assert:mail.content.read:message',
    ]));
    expect(runSecurityCheck).toHaveBeenCalledTimes(1);
  });

  test('pgp verify POST requires content-read in addition to triage', async () => {
    // verifyMessage parses the hidden signed body and returns signature validity +
    // signer fingerprint, so a triage-only delegate without content access must be
    // blocked before the handler runs — the mutation gate supplements, not replaces,
    // the read gate.
    const verifyMessage = jest.fn(async () => ({ ok: true as const, result: { verified: true } }));
    const withMailAccess = (mailAccess: MailAccessService) => createServerApi({
      ...makeCentralPorts(mailAccess),
      pgpMessages: { verifyMessage } as unknown as ServerApiPorts['pgpMessages'],
    });

    const denyContentRead = withMailAccess({
      async assertPermission(input) {
        if (input.permission === 'mail.content.read') throw new MailAccessDeniedError();
      },
      async resolveScope() { return { kind: 'all' }; },
    } as unknown as MailAccessService);
    await expect(denyContentRead.handle({
      method: 'POST',
      path: `/api/v1/pgp/messages/${MESSAGE_A}/verify`,
      body: {},
      principal: principal(),
    })).resolves.toMatchObject({ status: 404 });
    expect(verifyMessage).not.toHaveBeenCalled();

    const calls: string[] = [];
    const allowAll = withMailAccess({
      async assertPermission(input) { calls.push(`assert:${input.permission}:${input.resource.type}`); },
      async resolveScope() { return { kind: 'all' }; },
    } as unknown as MailAccessService);
    await allowAll.handle({
      method: 'POST',
      path: `/api/v1/pgp/messages/${MESSAGE_A}/verify`,
      body: {},
      principal: principal(),
    });
    expect(calls).toEqual(expect.arrayContaining([
      'assert:mail.triage:message',
      'assert:mail.content.read:message',
    ]));
    expect(verifyMessage).toHaveBeenCalledTimes(1);
  });

  test('spam decision item GET requires content-read in addition to metadata', async () => {
    // sanitizeDecision returns the whole breakdown, whose featureKeys are derived
    // from the hidden body/HTML, so a metadata-only delegate that obtains a decision
    // id from spam_decision.created must not read the item without content access.
    const getDecision = jest.fn(async () => ({
      id: 77,
      sourceSqliteId: 77,
      messageSourceSqliteId: null,
      accountSourceSqliteId: null,
      messageId: MESSAGE_A,
      accountId: ACCOUNT_A,
      score: 5,
      status: 'review' as const,
      source: 'server_api',
      breakdown: { featureKeys: ['token:secret'] },
      modelVersion: 1,
      createdAt: null,
      updatedAt: '2026-07-20T10:00:00.000Z',
    }));
    const withMailAccess = (mailAccess: MailAccessService) => createServerApi({
      ...makeCentralPorts(mailAccess),
      mailResourceLookup: {
        async resolve(input) {
          if (input.target.kind === 'metadata' && input.target.entity === 'spam_decision') {
            return [messageResource(ACCOUNT_A, FOLDER_A, MESSAGE_A)];
          }
          if (input.target.kind === 'message') return [messageResource(ACCOUNT_A, FOLDER_A, Number(input.target.id))];
          return [];
        },
      },
      spamDecisions: { get: getDecision } as unknown as ServerApiPorts['spamDecisions'],
    });

    const denyContentRead = withMailAccess({
      async assertPermission(input) {
        if (input.permission === 'mail.content.read') throw new MailAccessDeniedError();
      },
      async resolveScope() { return { kind: 'all' }; },
    } as unknown as MailAccessService);
    await expect(denyContentRead.handle({
      method: 'GET',
      path: '/api/v1/spam/decisions/77',
      principal: principal(),
    })).resolves.toMatchObject({ status: 404 });
    expect(getDecision).not.toHaveBeenCalled();

    const calls: string[] = [];
    const allowAll = withMailAccess({
      async assertPermission(input) { calls.push(`assert:${input.permission}:${input.resource.type}`); },
      async resolveScope() { return { kind: 'all' }; },
    } as unknown as MailAccessService);
    await allowAll.handle({
      method: 'GET',
      path: '/api/v1/spam/decisions/77',
      principal: principal(),
    });
    expect(calls).toEqual(expect.arrayContaining([
      'assert:mail.metadata.read:message',
      'assert:mail.content.read:message',
    ]));
    expect(getDecision).toHaveBeenCalledTimes(1);
  });

  test('spam learning-event item GET requires content-read in addition to metadata', async () => {
    // sanitizeLearningEvent returns featureKeys derived from the hidden body/HTML
    // (buildFeaturePreview), so a metadata-only delegate that obtains a learning
    // event id from spam_learning_event.created must not read the item without
    // content access — the same exposure as spam decisions above.
    const getLearningEvent = jest.fn(async () => ({
      id: 88,
      sourceSqliteId: 88,
      messageSourceSqliteId: null,
      accountSourceSqliteId: 1,
      messageId: MESSAGE_A,
      accountId: ACCOUNT_A,
      label: 'spam' as const,
      source: 'manual',
      featureKeys: ['token:secret'],
      createdAt: null,
      updatedAt: '2026-07-20T10:00:00.000Z',
    }));
    const withMailAccess = (mailAccess: MailAccessService) => createServerApi({
      ...makeCentralPorts(mailAccess),
      mailResourceLookup: {
        async resolve(input) {
          if (input.target.kind === 'metadata' && input.target.entity === 'spam_learning_event') {
            return [messageResource(ACCOUNT_A, FOLDER_A, MESSAGE_A)];
          }
          if (input.target.kind === 'message') return [messageResource(ACCOUNT_A, FOLDER_A, Number(input.target.id))];
          return [];
        },
      },
      spamLearningEvents: { get: getLearningEvent } as unknown as ServerApiPorts['spamLearningEvents'],
    });

    const denyContentRead = withMailAccess({
      async assertPermission(input) {
        if (input.permission === 'mail.content.read') throw new MailAccessDeniedError();
      },
      async resolveScope() { return { kind: 'all' }; },
    } as unknown as MailAccessService);
    await expect(denyContentRead.handle({
      method: 'GET',
      path: '/api/v1/spam/learning-events/88',
      principal: principal(),
    })).resolves.toMatchObject({ status: 404 });
    expect(getLearningEvent).not.toHaveBeenCalled();

    const calls: string[] = [];
    const allowAll = withMailAccess({
      async assertPermission(input) { calls.push(`assert:${input.permission}:${input.resource.type}`); },
      async resolveScope() { return { kind: 'all' }; },
    } as unknown as MailAccessService);
    await allowAll.handle({
      method: 'GET',
      path: '/api/v1/spam/learning-events/88',
      principal: principal(),
    });
    expect(calls).toEqual(expect.arrayContaining([
      'assert:mail.metadata.read:message',
      'assert:mail.content.read:message',
    ]));
    expect(getLearningEvent).toHaveBeenCalledTimes(1);
  });

  test('scoped delegates fetch in-scope or global canned responses by id but not out-of-scope ones', async () => {
    const cannedRecord = (id: number, accountId: number | null) => ({
      id,
      sourceSqliteId: id,
      title: 'T',
      body: 'B',
      accountSourceSqliteId: null,
      accountId,
      overrideKey: null,
      sortOrder: 0,
      createdAt: null,
      updatedAt: '2026-07-20T10:00:00.000Z',
    });
    const mailAccess: MailAccessService = {
      async assertPermission(input) {
        // The delegate holds mail.draft.create on account A only.
        if (input.resource.type === 'account' && input.resource.accountId !== String(ACCOUNT_A)) {
          throw new MailAccessDeniedError();
        }
      },
      async resolveScope() {
        return { kind: 'restricted', accountIds: [ACCOUNT_A], folderIds: [], messageIds: [] };
      },
    };
    const ports: ServerApiPorts = {
      ...makeCentralPorts(mailAccess),
      mailResourceLookup: {
        async resolve(input) {
          if (input.target.kind === 'canned_response') {
            if (input.target.id === 55) return [{ type: 'account', accountId: String(ACCOUNT_A) }];
            if (input.target.id === 66) return [{ type: 'account', accountId: String(ACCOUNT_B) }];
          }
          return []; // id 77 → global/accountless (or missing) → scope gate
        },
      },
      emailCannedResponses: {
        async list() { return { items: [], nextCursor: null }; },
        async get(input) {
          if (input.id === 55) return cannedRecord(55, ACCOUNT_A);
          if (input.id === 77) return cannedRecord(77, null);
          return null;
        },
      } as unknown as ServerApiPorts['emailCannedResponses'],
    };
    const api = createServerApi(ports);

    // An account-A override the delegate can reach → authorized per account.
    await expect(api.handle({
      method: 'GET',
      path: '/api/v1/email/canned-responses/55',
      principal: principal(),
    })).resolves.toMatchObject({ status: 200 });

    // An account-B override the delegate cannot reach → denied, no cross-account leak.
    await expect(api.handle({
      method: 'GET',
      path: '/api/v1/email/canned-responses/66',
      principal: principal(),
    })).resolves.toMatchObject({ status: 404 });

    // A global template → admitted for the restricted reader (matches the collection).
    await expect(api.handle({
      method: 'GET',
      path: '/api/v1/email/canned-responses/77',
      principal: principal(),
    })).resolves.toMatchObject({ status: 200 });
  });

  test('scope-none user cannot read a global canned response by id', async () => {
    // A user with no mail.draft.create grant anywhere resolves to scope 'none'. The
    // collection read port returns no rows for them, but the item's unscoped get()
    // returns the full global template body — so the item must require a nonempty
    // draft-create scope (kept out of EMPTY_SCOPE_READ_PATHS) and deny scope 'none'
    // before the handler runs.
    const getCanned = jest.fn(async () => ({
      id: 77,
      sourceSqliteId: 77,
      title: 'T',
      body: 'B',
      accountSourceSqliteId: null,
      accountId: null,
      overrideKey: null,
      sortOrder: 0,
      createdAt: null,
      updatedAt: '2026-07-20T10:00:00.000Z',
    }));
    const api = createServerApi({
      ...makeCentralPorts({
        async assertPermission() {},
        async resolveScope() { return { kind: 'none' }; },
      } as unknown as MailAccessService),
      mailResourceLookup: {
        async resolve() { return []; }, // global/accountless → scope gate
      },
      emailCannedResponses: {
        async list() { return { items: [], nextCursor: null }; },
        get: getCanned,
      } as unknown as ServerApiPorts['emailCannedResponses'],
    });

    await expect(api.handle({
      method: 'GET',
      path: '/api/v1/email/canned-responses/77',
      principal: principal(),
    })).resolves.toMatchObject({ status: 404 });
    expect(getCanned).not.toHaveBeenCalled();
  });

  test('scope-none user cannot read a team member by id', async () => {
    // Same asymmetry as the canned item: the collection read port returns no rows for
    // scope 'none', but the item's unscoped get() returns the member's display name,
    // role, and signatureHtml. The item requires a nonempty metadata.read scope (kept
    // out of EMPTY_SCOPE_READ_PATHS), so scope 'none' 404s before the handler runs.
    const getTeamMember = jest.fn(async () => ({
      id: 9,
      sourceSqliteId: 9,
      name: 'Member',
      email: 'member@example.test',
      role: 'agent',
      signatureHtml: '<p>secret sig</p>',
      createdAt: null,
      updatedAt: '2026-07-20T10:00:00.000Z',
    }));
    const api = createServerApi({
      ...makeCentralPorts({
        async assertPermission() {},
        async resolveScope() { return { kind: 'none' }; },
      } as unknown as MailAccessService),
      emailTeamMembers: {
        async list() { return { items: [], nextCursor: null }; },
        get: getTeamMember,
      } as unknown as ServerApiPorts['emailTeamMembers'],
    });

    await expect(api.handle({
      method: 'GET',
      path: '/api/v1/email/team-members/9',
      principal: principal(),
    })).resolves.toMatchObject({ status: 404 });
    expect(getTeamMember).not.toHaveBeenCalled();
  });

  test('top-level tag creation authorizes the body message, not the workspace scope', async () => {
    // POST /api/v1/email/tags shares handleCreateEmailMessageTag with POST
    // /messages/:messageId/tags and takes the messageId in its body, so it must
    // authorize that message (mail.triage on the message resource) — a message-scoped
    // delegate can then tag a message it can reach, which the workspace-scope write
    // gate would otherwise deny.
    const createTag = jest.fn(async () => ({
      ok: true as const,
      tag: {
        id: 55,
        sourceSqliteId: 55,
        messageSourceSqliteId: 404,
        messageId: MESSAGE_A,
        tag: 'Priority',
        createdAt: null,
        updatedAt: '2026-07-20T10:00:00.000Z',
      },
    }));
    const withTags = (mailAccess: MailAccessService) => createServerApi({
      ...makeCentralPorts(mailAccess),
      emailMessageTags: { create: createTag } as unknown as ServerApiPorts['emailMessageTags'],
    });

    const calls: string[] = [];
    const allow = withTags({
      async assertPermission(input) { calls.push(`assert:${input.permission}:${input.resource.type}`); },
      async resolveScope() { return { kind: 'all' }; },
    } as unknown as MailAccessService);
    const created = await allow.handle({
      method: 'POST',
      path: '/api/v1/email/tags',
      principal: principal(),
      body: { messageId: MESSAGE_A, tag: 'Priority' },
    });
    expect(created.status).toBe(201);
    expect(calls).toContain('assert:mail.triage:message');
    expect(createTag).toHaveBeenCalledTimes(1);

    // A delegate without mail.triage on that message is denied before the handler.
    const deny = withTags({
      async assertPermission(input) {
        if (input.permission === 'mail.triage') throw new MailAccessDeniedError();
      },
      async resolveScope() { return { kind: 'all' }; },
    } as unknown as MailAccessService);
    const denied = await deny.handle({
      method: 'POST',
      path: '/api/v1/email/tags',
      principal: principal(),
      body: { messageId: MESSAGE_A, tag: 'Priority' },
    });
    expect(denied.status).toBe(404);
    expect(createTag).toHaveBeenCalledTimes(1);
  });

  test('scope-none user cannot read a category by id', async () => {
    // Same asymmetry as the team member above: the collection read port returns no
    // rows for scope 'none', but the item's unscoped get() returns the category name
    // and hierarchy. The item requires a nonempty metadata.read scope (kept out of
    // EMPTY_SCOPE_READ_PATHS), so scope 'none' 404s before the handler runs.
    const getCategory = jest.fn(async () => ({
      id: 5,
      sourceSqliteId: 5,
      parentSourceSqliteId: null,
      parentId: null,
      name: 'Confidential',
      sortOrder: 0,
      createdAt: null,
      updatedAt: '2026-07-20T10:00:00.000Z',
    }));
    const api = createServerApi({
      ...makeCentralPorts({
        async assertPermission() {},
        async resolveScope() { return { kind: 'none' }; },
      } as unknown as MailAccessService),
      emailCategories: {
        async list() { return { items: [], nextCursor: null }; },
        get: getCategory,
      } as unknown as ServerApiPorts['emailCategories'],
    });

    await expect(api.handle({
      method: 'GET',
      path: '/api/v1/email/categories/5',
      principal: principal(),
    })).resolves.toMatchObject({ status: 404 });
    expect(getCategory).not.toHaveBeenCalled();
  });

  test('imap auth notices are filtered to accounts a restricted delegate can read', async () => {
    // getByPrefix returns every account's notices workspace-wide; a restricted
    // delegate reaches this route (RESTRICTED_SCOPE_READ_PATHS) but must only see
    // notices for accounts it can read — mailResourceLookup resolves each account and
    // assertPermission(mail.metadata.read) denies account 999.
    const api = createServerApi({
      ...makeCentralPorts({
        async assertPermission(input) {
          if (
            typeof input.resource === 'object' && input.resource !== null
            && (input.resource as { type?: unknown }).type === 'account'
            && (input.resource as { accountId?: unknown }).accountId === '999'
          ) {
            throw new MailAccessDeniedError();
          }
        },
        async resolveScope() { return { kind: 'restricted', accountIds: [ACCOUNT_A], folderIds: [], messageIds: [] }; },
      } as unknown as MailAccessService),
      syncInfo: {
        async getByPrefix() {
          return [
            { key: `imap_auth_notice:${ACCOUNT_A}`, value: JSON.stringify({ accountId: ACCOUNT_A, message: 'Auth failed A', at: '2026-07-20T10:00:00.000Z' }), updatedAt: '2026-07-20T10:00:00.000Z' },
            { key: 'imap_auth_notice:999', value: JSON.stringify({ accountId: 999, message: 'Auth failed B', at: '2026-07-20T11:00:00.000Z' }), updatedAt: '2026-07-20T11:00:00.000Z' },
          ];
        },
      } as unknown as ServerApiPorts['syncInfo'],
    });

    const res = await api.handle({
      method: 'GET',
      path: '/api/v1/email/notices/imap-auth',
      principal: principal(),
    });
    expect(res.status).toBe(200);
    expect((res.body as { data: { items: unknown[] } }).data.items).toEqual([
      { accountId: ACCOUNT_A, message: 'Auth failed A', at: '2026-07-20T10:00:00.000Z' },
    ]);
  });

  test('imap auth notices reach the account-scoped resolver, not owner/admin only', async () => {
    // Owner sees every account's notice with no per-account filtering.
    const api = createServerApi({
      ...makeCentralPorts({
        async assertPermission() {},
        async resolveScope() { return { kind: 'all' }; },
      } as unknown as MailAccessService),
      syncInfo: {
        async getByPrefix() {
          return [
            { key: 'imap_auth_notice:999', value: JSON.stringify({ accountId: 999, message: 'Auth failed B', at: '2026-07-20T11:00:00.000Z' }), updatedAt: '2026-07-20T11:00:00.000Z' },
          ];
        },
      } as unknown as ServerApiPorts['syncInfo'],
    });

    const res = await api.handle({
      method: 'GET',
      path: '/api/v1/email/notices/imap-auth',
      principal: principal('owner'),
    });
    expect(res.status).toBe(200);
    expect((res.body as { data: { items: unknown[] } }).data.items).toEqual([
      { accountId: 999, message: 'Auth failed B', at: '2026-07-20T11:00:00.000Z' },
    ]);
  });

  test('spam-decision POST requires content-read in addition to triage', async () => {
    // evaluateSpamDecisionForMessage reads body_text/body_html/headers/attachments and
    // returns the decision breakdown (featureKeys via buildFeaturePreview), so a
    // triage-only delegate without content access must be blocked before the handler —
    // mirroring the sibling security-check POST.
    const evaluateSpamDecision = jest.fn(async () => null);
    const withMailAccess = (mailAccess: MailAccessService) => createServerApi({
      ...makeCentralPorts(mailAccess),
      emailMessages: {
        async list() { return { items: [], nextCursor: null }; },
        async get() { return null; },
        evaluateSpamDecision,
      } as unknown as ServerApiPorts['emailMessages'],
    });

    const denyContentRead = withMailAccess({
      async assertPermission(input) {
        if (input.permission === 'mail.content.read') throw new MailAccessDeniedError();
      },
      async resolveScope() { return { kind: 'all' }; },
    } as unknown as MailAccessService);
    await expect(denyContentRead.handle({
      method: 'POST',
      path: `/api/v1/email/messages/${MESSAGE_A}/spam-decision`,
      body: { applyStatus: false },
      principal: principal(),
    })).resolves.toMatchObject({ status: 404 });
    expect(evaluateSpamDecision).not.toHaveBeenCalled();

    const calls: string[] = [];
    const allowAll = withMailAccess({
      async assertPermission(input) { calls.push(`assert:${input.permission}:${input.resource.type}`); },
      async resolveScope() { return { kind: 'all' }; },
    } as unknown as MailAccessService);
    await allowAll.handle({
      method: 'POST',
      path: `/api/v1/email/messages/${MESSAGE_A}/spam-decision`,
      body: { applyStatus: false },
      principal: principal(),
    });
    expect(calls).toEqual(expect.arrayContaining([
      'assert:mail.triage:message',
      'assert:mail.content.read:message',
    ]));
    expect(evaluateSpamDecision).toHaveBeenCalledTimes(1);
  });

  test('remote-content remember flags are denied for a scoped non-admin (owner/admin only)', async () => {
    const setRemoteContentPolicy = jest.fn();
    const api = createServerApi({
      ...makeCentralPorts({
        async assertPermission() {},
        async resolveScope() {
          return { kind: 'restricted', accountIds: [ACCOUNT_A], folderIds: [], messageIds: [] };
        },
      }),
      emailMessages: {
        async list() { return { items: [], nextCursor: null }; },
        async get() { return null; },
        setRemoteContentPolicy,
      } as unknown as ServerApiPorts['emailMessages'],
    });

    // rememberSender/rememberDomain persist a workspace-wide allowlist row, so a
    // scoped (non-admin) triage/account delegate is denied before the handler runs —
    // it cannot weaken remote-content privacy for other accounts' messages.
    await expect(api.handle({
      method: 'PATCH',
      path: `/api/v1/email/messages/${MESSAGE_A}/remote-content-policy`,
      principal: principal(),
      body: { policy: 'allowed_sender', rememberSender: true },
    })).resolves.toMatchObject({ status: 404 });
    expect(setRemoteContentPolicy).not.toHaveBeenCalled();
  });

  test('PGP identity list is scoped to the caller for non-admins and full for owner/admin', async () => {
    const listCalls: Array<Record<string, unknown>> = [];
    const makeApi = () => createServerApi({
      ...makeCentralPorts({
        async assertPermission() {},
        async resolveScope() {
          return { kind: 'restricted', accountIds: [ACCOUNT_A], folderIds: [], messageIds: [] };
        },
      }),
      pgpIdentities: {
        async list(input) { listCalls.push(input); return { items: [], nextCursor: null }; },
      } as unknown as ServerApiPorts['pgpIdentities'],
    });

    // A delegated (non-admin) key manager: the list is admitted (restricted scope)
    // and scoped to their OWN private identities.
    await expect(makeApi().handle({
      method: 'GET',
      path: '/api/v1/pgp/identities',
      principal: principal(),
    })).resolves.toMatchObject({ status: 200 });
    expect(listCalls.at(-1)).toMatchObject({ workspaceId: WORKSPACE_A, ownerUserId: USER_A });

    // Owner/admin get the full workspace list (no owner filter).
    await expect(makeApi().handle({
      method: 'GET',
      path: '/api/v1/pgp/identities',
      principal: principal('owner'),
    })).resolves.toMatchObject({ status: 200 });
    expect(listCalls.at(-1)).not.toHaveProperty('ownerUserId');
  });

  test('thread-alias PATCH authorizes the unchanged stored thread, not just the replacement', async () => {
    const deniedMessages = new Set<string>();
    const mailAccess: MailAccessService = {
      async assertPermission(input) {
        if (input.resource.type === 'message' && deniedMessages.has(input.resource.messageId)) {
          throw new MailAccessDeniedError();
        }
      },
      async resolveScope() {
        return { kind: 'all' };
      },
    };
    const updated = jest.fn(async () => ({
      ok: true as const,
      alias: {
        id: 9600,
        sourceSqliteId: 9600,
        accountSourceSqliteId: null,
        accountId: ACCOUNT_A,
        aliasThreadId: 'thread-alias-new',
        canonicalThreadId: 'thread-canonical-b',
        confidence: 'high',
        source: 'manual_merge',
        createdAt: null,
        updatedAt: '2026-07-20T10:00:00.000Z',
      },
    }));
    const ports: ServerApiPorts = {
      ...makeCentralPorts(mailAccess),
      mailResourceLookup: {
        async resolve(input) {
          const target = input.target;
          if (target.kind === 'metadata' && target.entity === 'thread_alias') {
            return [{ type: 'account', accountId: String(ACCOUNT_A) }];
          }
          // The replacement alias thread is accessible; the UNCHANGED stored
          // canonical thread spans account B.
          if (target.kind === 'thread' && target.id === 'thread-alias-new') {
            return [messageResource(ACCOUNT_A, FOLDER_A, 601)];
          }
          if (target.kind === 'thread' && target.id === 'thread-canonical-b') {
            return [messageResource(ACCOUNT_B, 505, 602)];
          }
          return [];
        },
        async resolveThreadAliasThreadIds(input) {
          return input.aliasId === 9600
            ? { aliasThreadId: 'thread-alias-old', canonicalThreadId: 'thread-canonical-b' }
            : null;
        },
      },
      emailThreadAliases: {
        async list() {
          return { items: [], nextCursor: null };
        },
        async get() {
          return null;
        },
        async update() {
          return updated();
        },
      } as unknown as ServerApiPorts['emailThreadAliases'],
    };
    const api = createServerApi(ports);
    const body = { aliasThreadId: 'thread-alias-new' };

    // Only aliasThreadId is repointed, but the stored canonical thread (account B)
    // is part of the resulting relationship and inaccessible → denied.
    deniedMessages.add('602');
    await expect(api.handle({
      method: 'PATCH',
      path: '/api/v1/email/thread-aliases/9600',
      principal: principal(),
      body,
    })).resolves.toMatchObject({ status: 404 });
    expect(updated).not.toHaveBeenCalled();

    // With triage on the stored canonical thread too, the repoint proceeds.
    deniedMessages.clear();
    await expect(api.handle({
      method: 'PATCH',
      path: '/api/v1/email/thread-aliases/9600',
      principal: principal(),
      body,
    })).resolves.toMatchObject({ status: 200 });
    expect(updated).toHaveBeenCalledTimes(1);
  });

  test('thread-alias creation denies a restricted delegate seeding an empty thread', async () => {
    const created = jest.fn(async () => ({
      ok: true as const,
      alias: {
        id: 1,
        sourceSqliteId: 1,
        accountSourceSqliteId: null,
        accountId: ACCOUNT_A,
        aliasThreadId: 'empty-thread',
        canonicalThreadId: 'thread-with-messages',
        confidence: 'high',
        source: 'manual_merge',
        createdAt: null,
        updatedAt: '2026-07-20T10:00:00.000Z',
      },
    }));
    const mailAccess: MailAccessService = {
      async assertPermission() {},
      async resolveScope() {
        return { kind: 'restricted', accountIds: [ACCOUNT_A], folderIds: [], messageIds: [] };
      },
    };
    const ports: ServerApiPorts = {
      ...makeCentralPorts(mailAccess),
      mailResourceLookup: {
        async resolve(input) {
          const target = input.target;
          if (target.kind === 'account') return [{ type: 'account', accountId: String(target.id) }];
          // 'thread-with-messages' is populated; 'empty-thread' has no messages.
          if (target.kind === 'thread' && target.id === 'thread-with-messages') {
            return [messageResource(ACCOUNT_A, FOLDER_A, 501)];
          }
          return [];
        },
      },
      emailThreadAliases: {
        async list() {
          return { items: [], nextCursor: null };
        },
        async get() {
          return null;
        },
        async create() {
          return created();
        },
      } as unknown as ServerApiPorts['emailThreadAliases'],
    };
    const api = createServerApi(ports);
    const body = { accountId: ACCOUNT_A, aliasThreadId: 'empty-thread', canonicalThreadId: 'thread-with-messages' };

    // A restricted delegate cannot authorize the empty aliasThreadId, so the alias
    // is never planted — otherwise a later thread with that id in an inaccessible
    // account would silently inherit the alias.
    await expect(api.handle({
      method: 'POST',
      path: '/api/v1/email/thread-aliases',
      principal: principal(),
      body,
    })).resolves.toMatchObject({ status: 404 });
    expect(created).not.toHaveBeenCalled();

    // An owner has full workspace access and may seed it.
    await expect(api.handle({
      method: 'POST',
      path: '/api/v1/email/thread-aliases',
      principal: principal('owner'),
      body,
    })).resolves.toMatchObject({ status: 201 });
    expect(created).toHaveBeenCalledTimes(1);
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

  test('readiness routes pass the actor to atomic admin operations without post-commit audit', async () => {
    const auditRecord = jest.fn(async () => {
      throw new Error('route must not write a second audit event');
    });
    const rollout = {
      getReadiness: jest.fn(async () => ({
        workspaceId: WORKSPACE_A,
        mode: 'shadow' as const,
        evaluated: 7n,
        legacyAllowNewDeny: 0n,
        legacyDenyNewAllow: 0n,
        notComparable: 2n,
        inFlight: 0n,
        observationStartedAt: '2026-07-20T10:00:00.000Z',
        observationUpdatedAt: '2026-07-20T10:05:00.000Z',
        ready: true,
        enforced: false,
        telemetryHealthy: true,
        diagnosticCode: null,
        diagnosticAt: null,
      })),
      transitionToEnforce: jest.fn()
        .mockResolvedValueOnce({ ok: false as const, code: 'telemetry_unhealthy' as const })
        .mockResolvedValueOnce({ ok: true as const }),
      resetShadowCounters: jest.fn(async () => ({ ok: true as const })),
    };
    const api = createServerApi({
      ...makeCentralPorts({
        async assertPermission() {},
        async resolveScope() { return { kind: 'all' }; },
      }),
      mailAclRollout: rollout,
      audit: {
        record: auditRecord,
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
          inFlight: '0',
          ready: true,
          telemetryHealthy: true,
          diagnosticCode: null,
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
    })).resolves.toMatchObject({
      status: 409,
      body: { error: { code: 'telemetry_unhealthy' } },
    });
    await expect(api.handle({
      method: 'POST',
      path: '/api/v1/email/acl-rollout/enforce',
      principal: principal('owner'),
    })).resolves.toMatchObject({ status: 200 });

    expect(rollout.transitionToEnforce).toHaveBeenCalledTimes(2);
    expect(rollout.transitionToEnforce).toHaveBeenCalledWith({
      workspaceId: WORKSPACE_A,
      actorUserId: OWNER_A,
    });
    expect(rollout.resetShadowCounters).toHaveBeenCalledWith({
      workspaceId: WORKSPACE_A,
      actorUserId: OWNER_A,
    });
    expect(auditRecord).not.toHaveBeenCalled();
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
