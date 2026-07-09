import {
  createPortalRateLimiter,
  handlePublicPortalRoute,
  handleReturnsRoute,
  resetPortalRateLimitersForTests,
} from '../../packages/server/src/api/returns-routes';
import type {
  ApiRequest,
  PortalReturnRecord,
  ReturnsApiPort,
  ReturnsPortalSettings,
  ReturnsPortalSettingsApiPort,
  ServerApiPorts,
} from '../../packages/server/src/api/types';

const TOKEN = 'a'.repeat(64);
const WS_ID = 'ws-1';

function makeRecord(over: Partial<PortalReturnRecord> = {}): PortalReturnRecord {
  return {
    returnNumber: 'R-AAAA0001',
    status: 'pending',
    outcome: null,
    jtlOrderNumber: null,
    createdAt: '2026-06-09T05:00:00.000Z',
    updatedAt: '2026-06-09T05:00:00.000Z',
    items: [],
    ...over,
  };
}

function makeReturnsPort(over: Partial<ReturnsApiPort> = {}): ReturnsApiPort {
  return {
    async list() { return { items: [], totalCount: 0 }; },
    async get() { return null; },
    async create() { return { ok: false, error: 'internal-only' }; },
    async update() { return { ok: false, error: 'internal-only' }; },
    async analytics() { return { totalCount: 0, byStatus: [], byOutcome: [], topReasons: [], generatedAt: '' }; },
    async getPublicByReturnNumber() { return null; },
    async createPublic() { return { ok: true, record: makeRecord() }; },
    ...over,
  };
}

type Resolution =
  | { ok: true; workspaceId: string; enabled: true }
  | { ok: false; reason: 'unknown_token' | 'portal_disabled' };

function makePortalSettings(resolution: Resolution): ReturnsPortalSettingsApiPort {
  const empty: ReturnsPortalSettings = { enabled: false, token: null, hasToken: false, updatedAt: null };
  return {
    async get() { return empty; },
    async rotate() { return { ...empty, token: TOKEN, hasToken: true, enabled: true }; },
    async setEnabled(input) { return { ...empty, enabled: input.enabled }; },
    async revoke() { return empty; },
    async resolveByToken() { return resolution; },
  };
}

function req(path: string, init: Partial<ApiRequest> = {}): ApiRequest {
  return { method: 'GET', path, ...init };
}

beforeEach(() => {
  resetPortalRateLimitersForTests();
});

describe('createPortalRateLimiter', () => {
  test('allows up to the limit within the window, then blocks with a retry hint', () => {
    const limiter = createPortalRateLimiter({ limit: 3, windowMs: 60_000 });
    const t0 = 1_000_000;
    expect(limiter.check('k', t0)).toEqual({ ok: true });
    expect(limiter.check('k', t0 + 1)).toEqual({ ok: true });
    expect(limiter.check('k', t0 + 2)).toEqual({ ok: true });
    const blocked = limiter.check('k', t0 + 3);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    // Different key is unaffected.
    expect(limiter.check('other', t0 + 3)).toEqual({ ok: true });
  });

  test('frees the slot once the window has passed', () => {
    const limiter = createPortalRateLimiter({ limit: 1, windowMs: 60_000 });
    const t0 = 1_000_000;
    expect(limiter.check('k', t0)).toEqual({ ok: true });
    expect(limiter.check('k', t0 + 30_000).ok).toBe(false);
    expect(limiter.check('k', t0 + 60_001)).toEqual({ ok: true });
  });
});

describe('public portal dispatcher', () => {
  test('returns null for non-portal paths so the outer dispatcher can match', async () => {
    const result = await handlePublicPortalRoute(
      req('/api/v1/customers'),
      { auth: {} as never },
    );
    expect(result).toBeNull();
  });

  test('GET on a POST-only path responds 405, not 404 — easier to debug', async () => {
    const ports: ServerApiPorts = {
      auth: {} as never,
      returns: makeReturnsPort(),
      returnsPortalSettings: makePortalSettings({ ok: true, workspaceId: WS_ID, enabled: true }),
    };
    const result = await handlePublicPortalRoute(
      req(`/api/v1/portal/returns/${TOKEN}`, { method: 'GET' }),
      ports,
    );
    expect(result?.status).toBe(405);
  });

  test('unknown portal token responds 404 (does not leak workspace existence)', async () => {
    const ports: ServerApiPorts = {
      auth: {} as never,
      returns: makeReturnsPort(),
      returnsPortalSettings: makePortalSettings({ ok: false, reason: 'unknown_token' }),
    };
    const result = await handlePublicPortalRoute(
      req(`/api/v1/portal/returns/${TOKEN}/R-ANYTHING`, { method: 'GET' }),
      ports,
    );
    expect(result?.status).toBe(404);
    expect((result?.body as { error: { code: string } }).error.code).toBe('portal_not_found');
  });

  test('disabled portal responds 403, not 404 — the admin needs the distinction', async () => {
    const ports: ServerApiPorts = {
      auth: {} as never,
      returns: makeReturnsPort(),
      returnsPortalSettings: makePortalSettings({ ok: false, reason: 'portal_disabled' }),
    };
    const result = await handlePublicPortalRoute(
      req(`/api/v1/portal/returns/${TOKEN}`, { method: 'POST', body: { items: [{ quantity: 1 }] } }),
      ports,
    );
    expect(result?.status).toBe(403);
    expect((result?.body as { error: { code: string } }).error.code).toBe('portal_disabled');
  });

  test('POST without items responds 400 (validation runs after token resolves)', async () => {
    const ports: ServerApiPorts = {
      auth: {} as never,
      returns: makeReturnsPort(),
      returnsPortalSettings: makePortalSettings({ ok: true, workspaceId: WS_ID, enabled: true }),
    };
    const result = await handlePublicPortalRoute(
      req(`/api/v1/portal/returns/${TOKEN}`, { method: 'POST', body: { items: [] } }),
      ports,
    );
    expect(result?.status).toBe(400);
    expect((result?.body as { error: { code: string } }).error.code).toBe('invalid_items');
  });

  test('POST with CAPTCHA enabled fails closed when no challenge is provided', async () => {
    const ports: ServerApiPorts = {
      auth: {} as never,
      returns: makeReturnsPort(),
      returnsPortalSettings: makePortalSettings({ ok: true, workspaceId: WS_ID, enabled: true }),
      loginSecurity: {
        async getLoginConfig() {
          return {
            captcha: { enabled: true, provider: 'turnstile', siteKey: 'site-key' },
            pinKeypad: { enabled: false },
            mfa: { enabled: false, methods: [] },
            user: null,
          };
        },
        assertCaptchaChallenge() { return false; },
      } as never,
    };
    const result = await handlePublicPortalRoute(
      req(`/api/v1/portal/returns/${TOKEN}`, { method: 'POST', body: { items: [{ quantity: 1 }] } }),
      ports,
    );
    expect(result?.status).toBe(403);
    expect((result?.body as { error: { code: string } }).error.code).toBe('captcha_required');
  });

  test('POST succeeds when CAPTCHA challenge passes, returns the narrowed PortalReturnRecord', async () => {
    const captured: Array<{ workspaceId: string; input: unknown }> = [];
    const ports: ServerApiPorts = {
      auth: {} as never,
      returns: makeReturnsPort({
        async createPublic(input) {
          captured.push({ workspaceId: input.workspaceId, input: input.input });
          return { ok: true, record: makeRecord({ returnNumber: 'R-CAFE0001' }) };
        },
      }),
      returnsPortalSettings: makePortalSettings({ ok: true, workspaceId: WS_ID, enabled: true }),
      loginSecurity: {
        async getLoginConfig() {
          return {
            captcha: { enabled: true, provider: 'turnstile', siteKey: 's' },
            pinKeypad: { enabled: false },
            mfa: { enabled: false, methods: [] },
            user: null,
          };
        },
        assertCaptchaChallenge() { return true; },
      } as never,
    };
    const result = await handlePublicPortalRoute(
      req(`/api/v1/portal/returns/${TOKEN}`, {
        method: 'POST',
        body: {
          captchaChallenge: 'challenge-xyz',
          customerEmail: 'kunde@example.com',
          items: [{ sku: 'SKU-A', quantity: 1 }],
        },
      }),
      ports,
    );
    expect(result?.status).toBe(201);
    expect((result?.body as { data: PortalReturnRecord }).data.returnNumber).toBe('R-CAFE0001');
    expect(captured).toHaveLength(1);
    expect(captured[0]!.workspaceId).toBe(WS_ID);
  });

  test('POST create is rate-limited per IP (10/hour) with a 429 + retry hint', async () => {
    const ports: ServerApiPorts = {
      auth: {} as never,
      returns: makeReturnsPort(),
      returnsPortalSettings: makePortalSettings({ ok: true, workspaceId: WS_ID, enabled: true }),
    };
    const post = (ip: string) => handlePublicPortalRoute(
      req(`/api/v1/portal/returns/${TOKEN}`, { method: 'POST', ip, body: { items: [{ quantity: 1 }] } }),
      ports,
    );
    for (let i = 0; i < 10; i++) {
      const result = await post('203.0.113.7');
      expect(result?.status).toBe(201);
    }
    const blocked = await post('203.0.113.7');
    expect(blocked?.status).toBe(429);
    const body = blocked?.body as { error: { code: string; details?: { retryAfterSeconds?: number } } };
    expect(body.error.code).toBe('rate_limited');
    // A different client IP is not affected.
    const otherIp = await post('203.0.113.8');
    expect(otherIp?.status).toBe(201);
  });

  test('GET lookup is rate-limited per IP (30/minute)', async () => {
    const ports: ServerApiPorts = {
      auth: {} as never,
      returns: makeReturnsPort({
        async getPublicByReturnNumber() { return makeRecord(); },
      }),
      returnsPortalSettings: makePortalSettings({ ok: true, workspaceId: WS_ID, enabled: true }),
    };
    const get = () => handlePublicPortalRoute(
      req(`/api/v1/portal/returns/${TOKEN}/R-CAFE0001`, { method: 'GET', ip: '203.0.113.9' }),
      ports,
    );
    for (let i = 0; i < 30; i++) {
      const result = await get();
      expect(result?.status).toBe(200);
    }
    const blocked = await get();
    expect(blocked?.status).toBe(429);
  });

  test('rate limit applies before token resolution, throttling token probing too', async () => {
    const resolveCalls: string[] = [];
    const ports: ServerApiPorts = {
      auth: {} as never,
      returns: makeReturnsPort(),
      returnsPortalSettings: {
        ...makePortalSettings({ ok: false, reason: 'unknown_token' }),
        async resolveByToken(input) {
          resolveCalls.push(input.token);
          return { ok: false, reason: 'unknown_token' };
        },
      },
    };
    for (let i = 0; i < 30; i++) {
      await handlePublicPortalRoute(
        req(`/api/v1/portal/returns/${'f'.repeat(64)}/R-PROBE`, { method: 'GET', ip: '203.0.113.10' }),
        ports,
      );
    }
    const blocked = await handlePublicPortalRoute(
      req(`/api/v1/portal/returns/${'f'.repeat(64)}/R-PROBE`, { method: 'GET', ip: '203.0.113.10' }),
      ports,
    );
    expect(blocked?.status).toBe(429);
    // The resolver was never consulted for the blocked request.
    expect(resolveCalls).toHaveLength(30);
  });

  test('create audit metadata records the captcha gate status', async () => {
    const audits: Array<Record<string, unknown>> = [];
    const auditPort = {
      async record(input: { metadata: Record<string, unknown> }) { audits.push(input.metadata); },
    } as never;
    const base = {
      auth: {} as never,
      returns: makeReturnsPort(),
      returnsPortalSettings: makePortalSettings({ ok: true, workspaceId: WS_ID, enabled: true }),
      audit: auditPort,
    };
    // No loginSecurity wired → the gate degrades open but the audit shows it.
    await handlePublicPortalRoute(
      req(`/api/v1/portal/returns/${TOKEN}`, { method: 'POST', ip: '1.1.1.1', body: { items: [{ quantity: 1 }] } }),
      base as ServerApiPorts,
    );
    expect(audits[0]!.captcha).toBe('unavailable');

    // CAPTCHA enabled and passed → 'passed'.
    await handlePublicPortalRoute(
      req(`/api/v1/portal/returns/${TOKEN}`, {
        method: 'POST',
        ip: '1.1.1.2',
        body: { captchaChallenge: 'ok', items: [{ quantity: 1 }] },
      }),
      {
        ...base,
        loginSecurity: {
          async getLoginConfig() {
            return {
              captcha: { enabled: true, provider: 'turnstile', siteKey: 's' },
              pinKeypad: { enabled: false },
              mfa: { enabled: false, methods: [] },
              user: null,
            };
          },
          assertCaptchaChallenge() { return true; },
        } as never,
      } as ServerApiPorts,
    );
    expect(audits[1]!.captcha).toBe('passed');
  });

  test('GET lookup rejects SQL-LIKE wildcards and junk shapes before the port is called', async () => {
    const lookupCalls: string[] = [];
    const ports: ServerApiPorts = {
      auth: {} as never,
      returns: makeReturnsPort({
        async getPublicByReturnNumber(input) {
          lookupCalls.push(input.returnNumber);
          return makeRecord();
        },
      }),
      returnsPortalSettings: makePortalSettings({ ok: true, workspaceId: WS_ID, enabled: true }),
    };
    // %, dots, slashes-by-encoding, overlong — all must 400 without touching the port.
    for (const bad of ['%', 'R-%', '%25', 'R-CAFE.0001', 'a'.repeat(65)]) {
      const result = await handlePublicPortalRoute(
        req(`/api/v1/portal/returns/${TOKEN}/${bad}`, { method: 'GET' }),
        ports,
      );
      expect(result?.status).toBe(400);
      expect((result?.body as { error: { code: string } }).error.code).toBe('invalid_return_number');
    }
    expect(lookupCalls).toHaveLength(0);
  });

  test('GET lookup with a valid token returns the narrowed record on hit', async () => {
    const ports: ServerApiPorts = {
      auth: {} as never,
      returns: makeReturnsPort({
        async getPublicByReturnNumber(input) {
          if (input.returnNumber.toUpperCase() === 'R-CAFE0001') {
            return makeRecord({ returnNumber: 'R-CAFE0001', status: 'received' });
          }
          return null;
        },
      }),
      returnsPortalSettings: makePortalSettings({ ok: true, workspaceId: WS_ID, enabled: true }),
    };
    const ok = await handlePublicPortalRoute(
      req(`/api/v1/portal/returns/${TOKEN}/R-CAFE0001`, { method: 'GET' }),
      ports,
    );
    expect(ok?.status).toBe(200);
    expect((ok?.body as { data: PortalReturnRecord }).data.status).toBe('received');

    const miss = await handlePublicPortalRoute(
      req(`/api/v1/portal/returns/${TOKEN}/R-NOPE`, { method: 'GET' }),
      ports,
    );
    expect(miss?.status).toBe(404);
  });
});

describe('admin portal-settings route', () => {
  const PRINCIPAL = { userId: 'admin-1', workspaceId: WS_ID, role: 'owner' as const };

  test('GET returns the current settings', async () => {
    const ports: ServerApiPorts = {
      auth: {} as never,
      returnsPortalSettings: makePortalSettings({ ok: true, workspaceId: WS_ID, enabled: true }),
    };
    const result = await handleReturnsRoute(
      { method: 'GET', path: '/api/v1/returns/portal-settings', principal: PRINCIPAL },
      ports,
    );
    expect(result?.status).toBe(200);
    expect((result?.body as { data: ReturnsPortalSettings }).data).toMatchObject({
      enabled: false,
      hasToken: false,
    });
  });

  test('POST action=rotate audits the rotation and returns the freshly issued token once', async () => {
    const audited: Array<{ action: string }> = [];
    const ports: ServerApiPorts = {
      auth: {} as never,
      returnsPortalSettings: makePortalSettings({ ok: true, workspaceId: WS_ID, enabled: true }),
      audit: { async record(input: { action: string }) { audited.push({ action: input.action }); } } as never,
    };
    const result = await handleReturnsRoute(
      {
        method: 'POST',
        path: '/api/v1/returns/portal-settings',
        principal: PRINCIPAL,
        body: { action: 'rotate', enable: true },
      },
      ports,
    );
    expect(result?.status).toBe(200);
    const body = (result?.body as { data: ReturnsPortalSettings }).data;
    expect(body.token).toBe(TOKEN);
    expect(body.hasToken).toBe(true);
    expect(audited).toEqual([{ action: 'returns.portal_settings.rotate' }]);
  });

  test('POST without action responds 400', async () => {
    const ports: ServerApiPorts = {
      auth: {} as never,
      returnsPortalSettings: makePortalSettings({ ok: true, workspaceId: WS_ID, enabled: true }),
    };
    const result = await handleReturnsRoute(
      {
        method: 'POST',
        path: '/api/v1/returns/portal-settings',
        principal: PRINCIPAL,
        body: { not_action: true },
      },
      ports,
    );
    expect(result?.status).toBe(400);
    expect((result?.body as { error: { code: string } }).error.code).toBe('invalid_action');
  });

  test('GET without a principal responds 401', async () => {
    const ports: ServerApiPorts = {
      auth: {} as never,
      returnsPortalSettings: makePortalSettings({ ok: true, workspaceId: WS_ID, enabled: true }),
    };
    const result = await handleReturnsRoute(
      { method: 'GET', path: '/api/v1/returns/portal-settings' },
      ports,
    );
    expect(result?.status).toBe(401);
  });
});
