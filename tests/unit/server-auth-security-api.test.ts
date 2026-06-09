import {
  createServerApi,
  type AuthApiPort,
  type LoginSecurityApiPort,
  type ServerApiPorts,
} from '../../packages/server/src';

describe('server auth security API', () => {
  const admin = { userId: 'user-1', workspaceId: 'ws-1', role: 'owner' as const };
  const member = { userId: 'user-2', workspaceId: 'ws-1', role: 'user' as const };

  describe('enable email MFA', () => {
    test('allows a user to enable email MFA for their own account', async () => {
      const loginSecurity = loginSecurityPort();
      const api = createServerApi(ports({ loginSecurity }));

      const res = await api.handle({
        method: 'POST',
        path: '/api/v1/auth/users/user-2/mfa/email',
        principal: member,
      });

      expect(res.status).toBe(200);
      expect((res.body as any).data).toEqual({ enabled: true, method: 'email' });
      expect(loginSecurity.enableEmailMfa).toHaveBeenCalledWith({
        workspaceId: 'ws-1',
        userId: 'user-2',
      });
    });

    test('allows an admin to enable email MFA for another user', async () => {
      const loginSecurity = loginSecurityPort();
      const api = createServerApi(ports({ loginSecurity }));

      const res = await api.handle({
        method: 'POST',
        path: '/api/v1/auth/users/user-2/mfa/email',
        principal: admin,
      });

      expect(res.status).toBe(200);
      expect(loginSecurity.enableEmailMfa).toHaveBeenCalledWith({
        workspaceId: 'ws-1',
        userId: 'user-2',
      });
    });

    test('forbids a non-admin from enabling email MFA for another user', async () => {
      const loginSecurity = loginSecurityPort();
      const api = createServerApi(ports({ loginSecurity }));

      const res = await api.handle({
        method: 'POST',
        path: '/api/v1/auth/users/user-1/mfa/email',
        principal: member,
      });

      expect(res.status).toBe(403);
      expect((res.body as any).error.code).toBe('forbidden');
      expect(loginSecurity.enableEmailMfa).not.toHaveBeenCalled();
    });
  });

  describe('login CAPTCHA gate', () => {
    test('skips CAPTCHA for unknown emails even when workspace CAPTCHA is enabled', async () => {
      const loginSecurity = loginSecurityPort({
        captchaEnabled: true,
        assertCaptchaChallenge: jest.fn(() => false),
      });
      const auth = authPort({
        findUserByEmail: jest.fn(async () => null),
      });
      const api = createServerApi(ports({ auth, loginSecurity }));

      const res = await api.handle({
        method: 'POST',
        path: '/api/v1/auth/login',
        ip: '127.0.0.1',
        body: { email: 'unknown@example.com', password: 'wrong-password' },
      });

      expect(res.status).toBe(401);
      expect((res.body as any).error.code).toBe('invalid_credentials');
      expect(loginSecurity.assertCaptchaChallenge).not.toHaveBeenCalled();
    });

    test('requires CAPTCHA for known users when workspace CAPTCHA is enabled', async () => {
      const loginSecurity = loginSecurityPort({
        captchaEnabled: true,
        assertCaptchaChallenge: jest.fn(() => false),
      });
      const auth = authPort();
      const api = createServerApi(ports({ auth, loginSecurity }));

      const res = await api.handle({
        method: 'POST',
        path: '/api/v1/auth/login',
        ip: '127.0.0.1',
        body: { email: 'owner@example.com', password: 'wrong-password' },
      });

      expect(res.status).toBe(403);
      expect((res.body as any).error.code).toBe('captcha_required');
      expect(loginSecurity.assertCaptchaChallenge).toHaveBeenCalled();
    });
  });
});

function loginSecurityPort(overrides: Partial<{
  captchaEnabled: boolean;
  assertCaptchaChallenge: jest.Mock;
}> = {}): jest.Mocked<LoginSecurityApiPort> {
  const captchaEnabled = overrides.captchaEnabled ?? false;
  return {
    getWorkspaceSettings: jest.fn(async () => ({
      captchaEnabled,
      pinKeypadEnabled: false,
      mfaEnabled: false,
      mfaTotpEnabled: true,
      mfaEmailEnabled: true,
    })),
    setWorkspaceSettings: jest.fn(async (_workspaceId, settings) => settings),
    getLoginConfig: jest.fn(async () => ({
      captcha: { enabled: captchaEnabled, provider: null, siteKey: null },
      pinKeypad: { enabled: false },
      mfa: { enabled: false, methods: [] },
      user: null,
    })),
    verifyCaptcha: jest.fn(),
    assertCaptchaChallenge: overrides.assertCaptchaChallenge ?? jest.fn(() => true),
    assertLoginPin: jest.fn(async () => true),
    beginMfaIfRequired: jest.fn(async () => ({ kind: 'complete' as const })),
    completeMfaLogin: jest.fn(),
    setUserPin: jest.fn(),
    beginTotpSetup: jest.fn(),
    confirmTotpSetup: jest.fn(),
    enableEmailMfa: jest.fn(async () => undefined),
    disableUserMfa: jest.fn(),
  };
}

function authPort(overrides: Partial<AuthApiPort> = {}): AuthApiPort {
  const user = {
    id: 'user-a',
    workspaceId: 'ws-1',
    email: 'owner@example.com',
    displayName: 'Owner',
    role: 'owner' as const,
    passwordHash: 'hash',
    disabledAt: null,
    loginPinEnabled: false,
    mfaEnabled: false,
    mfaMethod: null,
  };

  return {
    findUserByEmail: jest.fn(async (email: string) => (
      email === 'owner@example.com' ? user : null
    )),
    verifyPassword: jest.fn(async () => false),
    recordFailedLogin: jest.fn(async () => 1),
    recordSuccessfulLogin: jest.fn(),
    issueTokenPair: jest.fn(),
    checkLoginLock: jest.fn(async () => null),
    ...overrides,
  };
}

function ports(overrides: Partial<ServerApiPorts>): ServerApiPorts {
  return {
    auth: authPort(),
    locks: {} as ServerApiPorts['locks'],
    ...overrides,
  };
}
