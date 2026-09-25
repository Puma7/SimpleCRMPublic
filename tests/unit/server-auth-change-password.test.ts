import { handleAuthRoute } from '../../packages/server/src/api/auth-routes';
import type { ApiRequest, AuthApiPort, ServerApiPorts } from '../../packages/server/src/api/types';
import { bucketForApiPath } from '../../packages/server/src/security/api-rate-limit';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const principal = { userId: USER_ID, workspaceId: WORKSPACE_ID, role: 'user' as const, sessionId: 'session-1' };

function makePorts(overrides: Partial<AuthApiPort> = {}) {
  const changePassword = jest.fn<ReturnType<NonNullable<AuthApiPort['changePassword']>>, Parameters<NonNullable<AuthApiPort['changePassword']>>>(
    async () => ({ ok: true }),
  );
  const recordFailedLogin = jest.fn(async () => 1);
  const recordSuccessfulLogin = jest.fn(async () => undefined);
  const checkLoginLock = jest.fn(async () => null);
  const record = jest.fn(async () => undefined);
  const ports = {
    auth: {
      getUser: async () => ({ id: USER_ID, email: 'user@example.test', role: 'user' as const, disabledAt: null }),
      changePassword,
      recordFailedLogin,
      recordSuccessfulLogin,
      checkLoginLock,
      ...overrides,
    },
    audit: { record },
  } as unknown as ServerApiPorts;
  return { ports, changePassword, recordFailedLogin, recordSuccessfulLogin, checkLoginLock, record };
}

function changePasswordRequest(body: Record<string, unknown>): ApiRequest {
  return {
    method: 'POST',
    path: '/api/v1/auth/change-password',
    ip: '203.0.113.5',
    headers: {},
    body,
    principal,
  };
}

describe('POST /api/v1/auth/change-password password rules', () => {
  // F-A1-07: change-password accepted 10-character passwords (setup/invitation require 12).
  test('rejects a new password shorter than the shared minimum', async () => {
    const { ports, changePassword } = makePorts();

    const response = await handleAuthRoute(changePasswordRequest({
      currentPassword: 'aktuelles-passwort',
      newPassword: '01234567890',
    }), ports);

    expect(response?.status).toBe(400);
    expect((response?.body as { error: { code: string; message: string } }).error)
      .toEqual({ code: 'validation_error', message: 'Das neue Passwort muss mindestens 12 Zeichen haben' });
    expect(changePassword).not.toHaveBeenCalled();
  });

  // F-A1-07: change-password had no upper bound (setup/invitation cap at 1000).
  test('rejects a new password longer than the shared maximum', async () => {
    const { ports, changePassword } = makePorts();

    const response = await handleAuthRoute(changePasswordRequest({
      currentPassword: 'aktuelles-passwort',
      newPassword: 'a'.repeat(1001),
    }), ports);

    expect(response?.status).toBe(400);
    expect((response?.body as { error: { code: string } }).error.code).toBe('validation_error');
    expect(changePassword).not.toHaveBeenCalled();
  });

  test('accepts a new password of exactly the minimum length', async () => {
    const { ports, changePassword, recordSuccessfulLogin } = makePorts();

    const response = await handleAuthRoute(changePasswordRequest({
      currentPassword: 'aktuelles-passwort',
      newPassword: '012345678901',
    }), ports);

    expect(response?.status).toBe(200);
    expect(changePassword).toHaveBeenCalledTimes(1);
    // A correct current password clears the (email, ip) failure counter like a login.
    expect(recordSuccessfulLogin).toHaveBeenCalledWith({ userId: USER_ID, email: 'user@example.test', ip: '203.0.113.5' });
  });

  // F-A1-07: wrong current passwords were neither counted nor locked, so a stolen access token allowed unlimited guessing.
  test('feeds a wrong current password into the login lockout and the audit log', async () => {
    const { ports, changePassword, recordFailedLogin, record } = makePorts();
    changePassword.mockResolvedValueOnce({ ok: false, code: 'invalid_current' });

    const response = await handleAuthRoute(changePasswordRequest({
      currentPassword: 'falsch-geraten-1',
      newPassword: 'neues-passwort-123',
    }), ports);

    expect(response?.status).toBe(403);
    expect((response?.body as { error: { code: string } }).error.code).toBe('invalid_current_password');
    expect(recordFailedLogin).toHaveBeenCalledWith({ email: 'user@example.test', ip: '203.0.113.5', userId: USER_ID });
    expect(record).toHaveBeenCalledWith(expect.objectContaining({
      action: 'auth.password_change_failed',
      actorUserId: USER_ID,
      entityId: USER_ID,
    }));
  });

  test('refuses to check the current password while the login lockout is active', async () => {
    const { ports, changePassword, checkLoginLock } = makePorts();
    checkLoginLock.mockResolvedValueOnce({ kind: 'temporary', lockSeconds: 300 } as never);

    const response = await handleAuthRoute(changePasswordRequest({
      currentPassword: 'falsch-geraten-2',
      newPassword: 'neues-passwort-123',
    }), ports);

    expect(response?.status).toBe(429);
    expect((response?.body as { error: { code: string } }).error.code).toBe('rate_limited');
    expect(checkLoginLock).toHaveBeenCalledWith({ email: 'user@example.test', ip: '203.0.113.5' });
    expect(changePassword).not.toHaveBeenCalled();
  });

  test('rate-limits change-password like the other password checks', () => {
    expect(bucketForApiPath('POST', '/api/v1/auth/change-password')).toBe('auth-strict');
  });
});
