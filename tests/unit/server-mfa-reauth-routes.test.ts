import { handleAuthSecurityRoute } from '../../packages/server/src/api/auth-security-routes';
import type { ApiRequest, AuthenticatedPrincipal, ServerApiPorts } from '../../packages/server/src/api/types';
import { bucketForApiPath } from '../../packages/server/src/security/api-rate-limit';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const ADMIN_ID = '33333333-3333-4333-8333-333333333333';
const IP = '203.0.113.61';
const USER_PASSWORD = 'richtiges-passwort-1';
const ADMIN_PASSWORD = 'admin-passwort-geheim-2';

const self: AuthenticatedPrincipal = { userId: USER_ID, workspaceId: WORKSPACE_ID, role: 'user' };
const admin: AuthenticatedPrincipal = { userId: ADMIN_ID, workspaceId: WORKSPACE_ID, role: 'admin' };

function makePorts() {
  const accounts = new Map([
    [USER_ID, { email: 'user@example.test', password: USER_PASSWORD, role: 'user' as const }],
    [ADMIN_ID, { email: 'admin@example.test', password: ADMIN_PASSWORD, role: 'admin' as const }],
  ]);
  const byEmail = (email: string) => [...accounts.entries()].find(([, account]) => account.email === email);
  const auth = {
    getUser: jest.fn(async ({ userId }: { userId: string }) => {
      const account = accounts.get(userId);
      return account ? { id: userId, email: account.email, role: account.role, disabledAt: null } : null;
    }),
    findUserByEmail: jest.fn(async (email: string) => {
      const entry = byEmail(email);
      if (!entry) return null;
      const [id, account] = entry;
      return {
        id,
        workspaceId: WORKSPACE_ID,
        email: account.email,
        displayName: id,
        role: account.role,
        passwordHash: `hash:${account.password}`,
        disabledAt: null,
      };
    }),
    verifyPassword: jest.fn(async (password: string, hash: string) => hash === `hash:${password}`),
    checkLoginLock: jest.fn(async () => null as unknown),
    recordFailedLogin: jest.fn(async () => 1),
    recordSuccessfulLogin: jest.fn(async () => undefined),
  };
  const loginSecurity = {
    disableUserMfa: jest.fn(async () => undefined),
    confirmTotpSetup: jest.fn(async () => true),
    enableEmailMfa: jest.fn(async () => true),
    verifyCurrentTotpCode: jest.fn(async ({ code }: { code: string }) => code === '424242'),
  };
  const record = jest.fn(async () => undefined);
  const ports = { auth, loginSecurity, audit: { record } } as unknown as ServerApiPorts;
  return { ports, auth, loginSecurity, record };
}

function request(
  principal: AuthenticatedPrincipal,
  method: ApiRequest['method'],
  path: string,
  body?: Record<string, unknown>,
): ApiRequest {
  return { method, path, ip: IP, headers: {}, principal, ...(body ? { body } : {}) };
}

function errorCode(response: Awaited<ReturnType<typeof handleAuthSecurityRoute>>): string | undefined {
  return (response?.body as { error?: { code: string } } | undefined)?.error?.code;
}

const disablePath = `/api/v1/auth/users/${USER_ID}/mfa`;
const confirmPath = `/api/v1/auth/users/${USER_ID}/mfa/totp/confirm`;
const emailPath = `/api/v1/auth/users/${USER_ID}/mfa/email`;

describe('MFA changes require step-up authentication', () => {
  // F-A1-06: a hijacked access token could switch off or replace the second factor without the password or a current code.
  test.each([
    ['disable MFA', 'DELETE', disablePath, {}],
    ['replace the authenticator', 'POST', confirmPath, { secret: 'JBSWY3DPEHPK3PXP', code: '123456' }],
    ['switch to e-mail MFA', 'POST', emailPath, {}],
  ] as const)('refuses to %s without the current password or code', async (_label, method, path, body) => {
    const { ports, loginSecurity } = makePorts();

    const response = await handleAuthSecurityRoute(request(self, method, path, body), ports);

    expect(response?.status).toBe(403);
    expect(errorCode(response)).toBe('reauth_required');
    expect(loginSecurity.disableUserMfa).not.toHaveBeenCalled();
    expect(loginSecurity.confirmTotpSetup).not.toHaveBeenCalled();
    expect(loginSecurity.enableEmailMfa).not.toHaveBeenCalled();
  });

  test('a wrong password counts as a failed login, is audited and changes nothing', async () => {
    const { ports, auth, loginSecurity, record } = makePorts();

    const response = await handleAuthSecurityRoute(
      request(self, 'DELETE', disablePath, { currentPassword: 'falsch-geraten' }),
      ports,
    );

    expect(response?.status).toBe(403);
    expect(errorCode(response)).toBe('reauth_failed');
    expect(auth.recordFailedLogin).toHaveBeenCalledWith({ email: 'user@example.test', ip: IP, userId: USER_ID });
    expect(record).toHaveBeenCalledWith(expect.objectContaining({
      action: 'auth.mfa_reauth_failed',
      actorUserId: USER_ID,
      metadata: expect.objectContaining({ operation: 'mfa_disable', targetUserId: USER_ID }),
    }));
    expect(loginSecurity.disableUserMfa).not.toHaveBeenCalled();
  });

  test('an active login lockout stops the check before the password is verified', async () => {
    const { ports, auth, loginSecurity } = makePorts();
    auth.checkLoginLock.mockResolvedValueOnce({ kind: 'temporary', lockSeconds: 300 });

    const response = await handleAuthSecurityRoute(
      request(self, 'DELETE', disablePath, { currentPassword: USER_PASSWORD }),
      ports,
    );

    expect(response?.status).toBe(429);
    expect(auth.verifyPassword).not.toHaveBeenCalled();
    expect(loginSecurity.disableUserMfa).not.toHaveBeenCalled();
  });

  test('the current password disables MFA and the change is audited', async () => {
    const { ports, loginSecurity, record } = makePorts();

    const response = await handleAuthSecurityRoute(
      request(self, 'DELETE', disablePath, { currentPassword: USER_PASSWORD }),
      ports,
    );

    expect(response?.status).toBe(200);
    expect(loginSecurity.disableUserMfa).toHaveBeenCalledWith({ workspaceId: WORKSPACE_ID, userId: USER_ID });
    expect(record).toHaveBeenCalledWith(expect.objectContaining({
      action: 'auth.mfa_disabled',
      actorUserId: USER_ID,
      entityId: USER_ID,
      metadata: { reauthMethod: 'password' },
    }));
  });

  test('a current authenticator code is accepted instead of the password', async () => {
    const { ports, loginSecurity, record } = makePorts();

    const response = await handleAuthSecurityRoute(
      request(self, 'POST', confirmPath, { secret: 'JBSWY3DPEHPK3PXP', code: '123456', currentMfaCode: '424242' }),
      ports,
    );

    expect(response?.status).toBe(200);
    expect(loginSecurity.verifyCurrentTotpCode).toHaveBeenCalledWith({ workspaceId: WORKSPACE_ID, userId: USER_ID, code: '424242' });
    expect(loginSecurity.confirmTotpSetup).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith(expect.objectContaining({
      action: 'auth.mfa_totp_enabled',
      metadata: { reauthMethod: 'totp' },
    }));
  });

  test('an admin confirms with the own password when switching another user to e-mail MFA', async () => {
    const { ports, loginSecurity, record } = makePorts();

    const withUserPassword = await handleAuthSecurityRoute(
      request(admin, 'POST', emailPath, { currentPassword: USER_PASSWORD }),
      ports,
    );
    expect(withUserPassword?.status).toBe(403);
    expect(loginSecurity.enableEmailMfa).not.toHaveBeenCalled();

    const withAdminPassword = await handleAuthSecurityRoute(
      request(admin, 'POST', emailPath, { currentPassword: ADMIN_PASSWORD }),
      ports,
    );
    expect(withAdminPassword?.status).toBe(200);
    expect(loginSecurity.enableEmailMfa).toHaveBeenCalledWith({ workspaceId: WORKSPACE_ID, userId: USER_ID });
    expect(record).toHaveBeenCalledWith(expect.objectContaining({
      action: 'auth.mfa_email_enabled',
      actorUserId: ADMIN_ID,
      entityId: USER_ID,
    }));
  });

  test('MFA changes share the strict login rate limit', () => {
    expect(bucketForApiPath('DELETE', disablePath)).toBe('auth-strict');
    expect(bucketForApiPath('POST', confirmPath)).toBe('auth-strict');
    expect(bucketForApiPath('POST', emailPath)).toBe('auth-strict');
  });
});
