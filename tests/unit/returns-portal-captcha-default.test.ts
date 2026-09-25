import {
  AUTH_SECURITY_SYNC_KEYS,
  DEFAULT_AUTH_SECURITY_WORKSPACE_SETTINGS,
  parseAuthSecuritySyncValues,
  serializeAuthSecuritySyncValues,
} from '@simplecrm/core';

import { handleAuthSecurityRoute } from '../../packages/server/src/api/auth-security-routes';
import {
  handlePublicPortalRoute,
  resetPortalRateLimitersForTests,
} from '../../packages/server/src/api/returns-routes';
import type {
  ApiRequest,
  PortalReturnRecord,
  ReturnsApiPort,
  ReturnsPortalSettingsApiPort,
  ServerApiPorts,
} from '../../packages/server/src/api/types';

const TOKEN = 'b'.repeat(64);
const WS_ID = '11111111-1111-4111-8111-1111111111e7';
const ADMIN_ID = '22222222-2222-4222-8222-2222222222e7';

function portalRecord(): PortalReturnRecord {
  return {
    returnNumber: 'R-E7000001',
    status: 'pending',
    outcome: null,
    jtlOrderNumber: null,
    createdAt: '2026-09-25T10:00:00.000Z',
    updatedAt: '2026-09-25T10:00:00.000Z',
    items: [],
  };
}

// The workspace settings come from sync_info exactly as the server stores them.
function loginSecurity(input: { turnstileConfigured: boolean; syncValues: Record<string, string> }) {
  const stored = { ...input.syncValues };
  return {
    stored,
    port: {
      async getLoginConfig() {
        return {
          captcha: {
            enabled: false,
            provider: input.turnstileConfigured ? 'turnstile' : null,
            siteKey: input.turnstileConfigured ? 'site-key' : null,
          },
          pinKeypad: { enabled: false },
          mfa: { enabled: false, methods: [] },
          user: null,
        };
      },
      async getWorkspaceSettings() {
        return parseAuthSecuritySyncValues(stored);
      },
      async setWorkspaceSettings(_workspaceId: string, settings: typeof DEFAULT_AUTH_SECURITY_WORKSPACE_SETTINGS) {
        Object.assign(stored, serializeAuthSecuritySyncValues(settings));
        return settings;
      },
      async assertCaptchaChallenge(challenge: { challenge?: string }) {
        return challenge.challenge === 'valid-challenge';
      },
    },
  };
}

function ports(security: ReturnType<typeof loginSecurity>): ServerApiPorts {
  return {
    auth: { listUsers: async () => [] },
    returns: { async createPublic() { return { ok: true, record: portalRecord() }; } } as unknown as ReturnsApiPort,
    returnsPortalSettings: {
      async resolveByToken() { return { ok: true, workspaceId: WS_ID, enabled: true }; },
    } as unknown as ReturnsPortalSettingsApiPort,
    loginSecurity: security.port,
  } as unknown as ServerApiPorts;
}

function create(body: Record<string, unknown> = {}): ApiRequest {
  return {
    method: 'POST',
    path: `/api/v1/portal/returns/${TOKEN}`,
    ip: '198.51.100.7',
    body: { items: [{ quantity: 1 }], ...body },
  };
}

function config(): ApiRequest {
  return { method: 'GET', path: `/api/v1/portal/returns/${TOKEN}/config`, ip: '198.51.100.7' };
}

beforeEach(() => {
  resetPortalRateLimitersForTests();
});

// F-A3a-07 (E7): the public returns portal accepted anonymous creates without a
// CAPTCHA unless the workspace had switched on its LOGIN captcha (default off),
// even with Turnstile configured on the instance.
describe('portal CAPTCHA is on by default once Turnstile is configured', () => {
  test('a workspace without any setting requires the challenge', async () => {
    const security = loginSecurity({ turnstileConfigured: true, syncValues: {} });

    const configResult = await handlePublicPortalRoute(config(), ports(security));
    expect(configResult?.body).toEqual({ data: { captchaRequired: true, siteKey: 'site-key' } });

    const withoutChallenge = await handlePublicPortalRoute(create(), ports(security));
    expect(withoutChallenge).toMatchObject({ status: 403, body: { error: { code: 'captcha_required' } } });

    const withChallenge = await handlePublicPortalRoute(create({ captchaChallenge: 'valid-challenge' }), ports(security));
    expect(withChallenge?.status).toBe(201);
  });

  test('the login CAPTCHA setting no longer switches the portal CAPTCHA off', async () => {
    const security = loginSecurity({
      turnstileConfigured: true,
      syncValues: { [AUTH_SECURITY_SYNC_KEYS.captchaEnabled]: 'false' },
    });

    const result = await handlePublicPortalRoute(create(), ports(security));
    expect(result?.status).toBe(403);
  });

  test('the workspace can switch the portal CAPTCHA off', async () => {
    const security = loginSecurity({
      turnstileConfigured: true,
      syncValues: { [AUTH_SECURITY_SYNC_KEYS.portalCaptchaEnabled]: 'false' },
    });

    const configResult = await handlePublicPortalRoute(config(), ports(security));
    expect(configResult?.body).toEqual({ data: { captchaRequired: false, siteKey: null } });
    const result = await handlePublicPortalRoute(create(), ports(security));
    expect(result?.status).toBe(201);
  });

  test('without Turnstile the portal stays usable without a challenge', async () => {
    const security = loginSecurity({ turnstileConfigured: false, syncValues: {} });

    const configResult = await handlePublicPortalRoute(config(), ports(security));
    expect(configResult?.body).toEqual({ data: { captchaRequired: false, siteKey: null } });
    expect((await handlePublicPortalRoute(create(), ports(security)))?.status).toBe(201);
  });

  test('the security settings API reads and writes portalCaptchaEnabled additively', async () => {
    const security = loginSecurity({ turnstileConfigured: true, syncValues: {} });
    const admin = { userId: ADMIN_ID, workspaceId: WS_ID, role: 'owner' as const };

    const read = await handleAuthSecurityRoute(
      { method: 'GET', path: '/api/v1/auth/security-settings', principal: admin },
      ports(security),
    );
    expect(read).toMatchObject({ status: 200, body: { data: { settings: { portalCaptchaEnabled: true, captchaEnabled: false } } } });

    const off = await handleAuthSecurityRoute(
      { method: 'PATCH', path: '/api/v1/auth/security-settings', principal: admin, body: { portalCaptchaEnabled: false } },
      ports(security),
    );
    expect(off).toMatchObject({ status: 200, body: { data: { settings: { portalCaptchaEnabled: false } } } });
    expect(security.stored[AUTH_SECURITY_SYNC_KEYS.portalCaptchaEnabled]).toBe('false');

    // Old clients that do not know the field keep the stored value.
    const unrelated = await handleAuthSecurityRoute(
      { method: 'PATCH', path: '/api/v1/auth/security-settings', principal: admin, body: { mfaEnabled: true } },
      ports(security),
    );
    expect(unrelated).toMatchObject({ status: 200, body: { data: { settings: { portalCaptchaEnabled: false, mfaEnabled: true } } } });
  });
});
