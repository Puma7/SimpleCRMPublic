import {
  createServerApi,
  type AuthApiPort,
  type ServerApiPorts,
} from '../../packages/server/src';

// Characterization test for the mail read-route dispatcher (plan 014).
//
// This test locks the ordering-sensitive dispatch behavior of
// `handleMailReadRoute` so the "if-cascade → ordered route table" refactor is
// provably behavior-preserving. Every assertion drives the public entry point
// `createServerApi(...).handle(...)`; the internal handlers are not imported.
//
// The expected {status, error.code} values below were RECORDED against the
// unmodified dispatcher (commit f24fb27) and must remain unchanged after the
// refactor.

describe('mail read-route dispatch ordering', () => {
  const principal = {
    userId: 'u1',
    workspaceId: 'w1',
    role: 'owner' as const,
  };

  function api() {
    // No email ports configured: every dispatched handler falls through to its
    // own port-availability / method guard, which is exactly what lets us
    // observe *which* handler a path reaches.
    return createServerApi(ports());
  }

  test('ordering lock A: …/messages/conversation precedes the generic …/messages/:id', async () => {
    // If shadowed by the generic `…/messages/:id`, this would return
    // 400 invalid_email_message_id (positiveIntFromPath('conversation') is null).
    const res = await api().handle({
      method: 'GET',
      path: '/api/v1/email/messages/conversation',
      principal,
    });
    expect(res.status).toBe(503);
    expect((res.body as any).error.code).toBe('email_messages_unavailable');
  });

  test('ordering lock B: …/messages/backfill-customer-links precedes the generic GET …/messages/:id', async () => {
    // If shadowed by the generic GET handler, a POST would return 405.
    const res = await api().handle({
      method: 'POST',
      path: '/api/v1/email/messages/backfill-customer-links',
      principal,
    });
    expect(res.status).toBe(503);
    expect((res.body as any).error.code).toBe('email_messages_unavailable');
  });

  test('metadata delegate still runs for …/messages/:id/tags', async () => {
    // Handled by the handleMailMetadataReadRoute delegate; must not fall through
    // to the generic …/messages/:id or to the 404 fallback.
    const res = await api().handle({
      method: 'GET',
      path: '/api/v1/email/messages/5/tags',
      principal,
    });
    expect(res.status).not.toBe(404);
    expect(res.status).toBe(503);
    expect((res.body as any).error.code).toBe('email_message_tags_unavailable');
  });

  test('non-messages route still dispatches: …/reporting', async () => {
    const res = await api().handle({
      method: 'GET',
      path: '/api/v1/email/reporting',
      principal,
    });
    expect(res.status).toBe(503);
    expect((res.body as any).error.code).toBe('email_reporting_unavailable');
  });

  // Recorded-and-locked representative routes across the resource groups. Each
  // {status, error.code} pair was observed against the unmodified dispatcher.
  const locked: Array<{
    label: string;
    method: string;
    path: string;
    status: number;
    code: string;
  }> = [
    {
      label: 'oauth app',
      method: 'GET',
      path: '/api/v1/email/oauth/google/app',
      status: 503,
      code: 'sync_info_unavailable',
    },
    {
      label: 'account sub-route sync',
      method: 'POST',
      path: '/api/v1/email/accounts/5/sync',
      status: 503,
      code: 'email_accounts_unavailable',
    },
    {
      label: 'bulk archive',
      method: 'POST',
      path: '/api/v1/email/messages/bulk/archive',
      status: 405,
      code: 'method_not_allowed',
    },
    {
      label: 'compose send',
      method: 'POST',
      path: '/api/v1/email/compose/send',
      status: 503,
      code: 'email_compose_send_unavailable',
    },
    {
      label: 'scheduled-send',
      method: 'POST',
      path: '/api/v1/email/messages/5/scheduled-send',
      status: 405,
      code: 'method_not_allowed',
    },
    {
      label: 'attachment item',
      method: 'GET',
      path: '/api/v1/email/attachments/5',
      status: 503,
      code: 'email_attachments_unavailable',
    },
    {
      label: 'generic messages/:id',
      method: 'GET',
      path: '/api/v1/email/messages/5',
      status: 503,
      code: 'email_messages_unavailable',
    },
    {
      label: 'accounts collection',
      method: 'GET',
      path: '/api/v1/email/accounts',
      status: 503,
      code: 'email_accounts_unavailable',
    },
  ];

  test.each(locked)(
    'locked route $label ($method $path) → $status/$code',
    async ({ method, path, status, code }) => {
      const res = await api().handle({ method, path, principal });
      expect(res.status).toBe(status);
      expect((res.body as any).error.code).toBe(code);
    },
  );
});

function ports(overrides: Partial<ServerApiPorts> = {}): ServerApiPorts {
  return {
    auth: authPort(),
    locks: {} as ServerApiPorts['locks'],
    ...overrides,
  };
}

function authPort(): AuthApiPort {
  return {
    findUserByEmail: async () => null,
    verifyPassword: async () => false,
    recordFailedLogin: async () => 1,
    recordSuccessfulLogin: async () => undefined,
    issueTokenPair: async () => ({
      accessToken: 'access',
      refreshToken: 'refresh',
      expiresInSeconds: 900,
    }),
    rotateRefreshToken: async () => null,
    revokeRefreshToken: async () => false,
  };
}
