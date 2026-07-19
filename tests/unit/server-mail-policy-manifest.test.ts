import {
  SERVER_EVENT_TYPES,
  SERVER_MAIL_ROUTE_INVENTORY,
  type CanonicalApiRoute,
} from '../../packages/server/src/api';
import {
  MAIL_EVENT_POLICY_MANIFEST,
  MAIL_ROUTE_POLICY_MANIFEST,
  assertMailEventPolicy,
  assertMailRoutePolicy,
  createMailEventPolicyIndex,
  createMailRoutePolicyIndex,
  mailRoutePolicyKey,
} from '../../packages/server/src/mail-access/policy-manifest';
import {
  SERVER_JOB_POLICIES,
  SERVER_JOB_TYPES,
  assertServerJobPolicy,
  createServerJobPolicyIndex,
} from '../../packages/server/src/jobs/policy';

describe('server mail policy manifest', () => {
  test('classifies every canonical mail route exactly once', () => {
    const registeredKeys = SERVER_MAIL_ROUTE_INVENTORY.map(mailRoutePolicyKey);
    const policyKeys = MAIL_ROUTE_POLICY_MANIFEST.map(({ route }) => mailRoutePolicyKey(route));

    expect(new Set(registeredKeys).size).toBe(registeredKeys.length);
    expect(policyKeys.sort()).toEqual(registeredKeys.sort());
  });

  test('classifies every canonical job type exactly once', () => {
    expect(SERVER_JOB_POLICIES.map(({ type }) => type).sort()).toEqual([...SERVER_JOB_TYPES].sort());
    for (const policy of SERVER_JOB_POLICIES) {
      expect(['initiating_user', 'initiating_user_or_service', 'service']).toContain(policy.actorMode);
      if (policy.kind === 'mail') {
        expect(policy.permission).toMatch(/^mail\./);
        expect(policy.resource.kind).toBeTruthy();
      } else {
        expect(['non_mail', 'system_maintenance']).toContain(policy.classification);
      }
    }
  });

  test('classifies every mail event type exactly once', () => {
    const mailEventTypes = SERVER_EVENT_TYPES.filter(isMailEventType);
    expect(MAIL_EVENT_POLICY_MANIFEST.map(({ type }) => type).sort()).toEqual(mailEventTypes.sort());
    expect(MAIL_EVENT_POLICY_MANIFEST.every(({ permission }) => (
      permission === 'mail.metadata.read'
      || permission === 'mail.content.read'
      || permission === 'mail.attachment.read'
    ))).toBe(true);
  });

  test('rejects duplicate route, job and event policy keys', () => {
    const route = syntheticRoute('GET', '/api/v1/email/synthetic');
    const routeEntry = {
      route,
      policy: {
        kind: 'permission' as const,
        permission: 'mail.metadata.read' as const,
        resource: { kind: 'mail_scope' as const },
      },
    };
    expect(() => createMailRoutePolicyIndex([routeEntry, routeEntry])).toThrow(/duplicate/i);

    const jobEntry = SERVER_JOB_POLICIES[0]!;
    expect(() => createServerJobPolicyIndex([jobEntry, jobEntry])).toThrow(/duplicate/i);

    const eventEntry = MAIL_EVENT_POLICY_MANIFEST[0]!;
    expect(() => createMailEventPolicyIndex([eventEntry, eventEntry])).toThrow(/duplicate/i);
  });

  test('fails closed for unknown routes, jobs and mail events', () => {
    expect(() => assertMailRoutePolicy('GET', '/api/v1/email/synthetic')).toThrow(/unclassified/i);
    expect(() => assertServerJobPolicy('mail.synthetic')).toThrow(/unsupported|unclassified/i);
    expect(() => assertMailEventPolicy('email_synthetic.updated')).toThrow(/unclassified/i);
  });

  test('keeps public tracking and auth/setup exemptions explicit and narrow', () => {
    const publicTracking = MAIL_ROUTE_POLICY_MANIFEST.filter(
      ({ policy }) => policy.kind === 'exempt' && policy.reason === 'signed_public_tracking',
    );
    expect(publicTracking.map(({ route }) => `${route.method} ${route.path}`).sort()).toEqual([
      'GET /t/c/:token',
      'GET /t/o/:token.gif',
    ]);

    const authSetup = MAIL_ROUTE_POLICY_MANIFEST.filter(
      ({ policy }) => policy.kind === 'exempt' && policy.reason === 'mail_auth_setup',
    );
    expect(authSetup).not.toHaveLength(0);
    expect(authSetup.every(({ route }) => (
      route.path.startsWith('/api/v1/email/oauth/')
      || route.path.startsWith('/api/v1/email/accounts/test-')
    ))).toBe(true);

    const workspaceAdmin = MAIL_ROUTE_POLICY_MANIFEST.filter(
      ({ policy }) => policy.kind === 'exempt' && policy.reason === 'workspace_admin_security',
    );
    expect(workspaceAdmin).not.toHaveLength(0);
    expect(workspaceAdmin.every(({ route }) => [
      'email-tracking-routes',
      'relay-routes',
      'settings-routes',
    ].includes(route.source))).toBe(true);
  });

  test('protected routes declare one permission and a typed resource resolution', () => {
    const protectedRoutes = MAIL_ROUTE_POLICY_MANIFEST.filter(
      (entry): entry is Extract<(typeof MAIL_ROUTE_POLICY_MANIFEST)[number], { policy: { kind: 'permission' } }> => (
        entry.policy.kind === 'permission'
      ),
    );
    expect(protectedRoutes).not.toHaveLength(0);
    for (const { policy } of protectedRoutes) {
      expect(typeof policy.permission).toBe('string');
      expect(typeof policy.resource.kind).toBe('string');
      expect(Object.keys(policy).sort()).toEqual(['kind', 'permission', 'resource']);
    }
  });

  test('requires authoritative lookups for resources whose parents are not in the route', () => {
    expect(assertMailRoutePolicy('GET', '/api/v1/email/messages/42').policy).toMatchObject({
      kind: 'permission',
      resource: { kind: 'message_lookup', messageId: { source: 'path', field: 'messageId' } },
    });
    expect(assertMailRoutePolicy('GET', '/api/v1/email/attachments/7/content').policy).toMatchObject({
      kind: 'permission',
      resource: { kind: 'attachment_lookup', attachmentId: { source: 'path', field: 'attachmentId' } },
    });
    expect(assertMailRoutePolicy('GET', '/api/v1/email/folders/9').policy).toMatchObject({
      kind: 'permission',
      resource: { kind: 'folder_lookup', folderId: { source: 'path', field: 'id' } },
    });
    expect(assertMailRoutePolicy('POST', '/api/v1/email/compose/send').policy).toMatchObject({
      kind: 'permission',
      resource: { kind: 'message_lookup', messageId: { source: 'body', field: 'draftMessageId' } },
    });
  });
});

function isMailEventType(type: string): boolean {
  return type.startsWith('email_') || type.startsWith('conversation_lock.');
}

function syntheticRoute(method: CanonicalApiRoute['method'], path: string): CanonicalApiRoute {
  return {
    source: 'synthetic',
    method,
    path,
    pattern: /^\/api\/v1\/email\/synthetic$/,
  };
}
