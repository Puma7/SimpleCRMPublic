import { handleAuthRoute } from '../../packages/server/src/api/auth-routes';
import type { ApiRequest, AuthUserRecord, ServerApiPorts } from '../../packages/server/src/api/types';

const KNOWN_USER: AuthUserRecord = {
  id: '22222222-2222-4222-8222-222222222222',
  workspaceId: '11111111-1111-4111-8111-111111111111',
  email: 'known@example.test',
  displayName: 'Known',
  role: 'user',
  passwordHash: 'scrypt:v1:salt:hash',
  disabledAt: null,
};

function loginRequest(email: string): ApiRequest {
  return {
    method: 'POST',
    path: '/api/v1/auth/login',
    ip: '198.51.100.30',
    headers: {},
    body: { email, password: 'falsch-geraten' },
  };
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | 'timeout'> {
  return Promise.race([promise, new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), ms))]);
}

describe('failed login response timing', () => {
  // F-A1-08: only failed logins of existing accounts waited for an extra audit transaction, so the response time revealed which e-mail addresses exist.
  test('a failed login of an existing account does not wait for the audit write', async () => {
    const record = jest.fn(() => new Promise<void>(() => undefined));
    const ports = {
      auth: {
        findUserByEmail: async (email: string) => (email === KNOWN_USER.email ? KNOWN_USER : null),
        verifyPassword: async () => false,
        recordFailedLogin: async () => 1,
      },
      audit: { record },
    } as unknown as ServerApiPorts;

    const known = await withTimeout(Promise.resolve(handleAuthRoute(loginRequest(KNOWN_USER.email), ports)), 200);
    const unknown = await withTimeout(Promise.resolve(handleAuthRoute(loginRequest('missing@example.test'), ports)), 200);

    expect(known).not.toBe('timeout');
    expect(unknown).not.toBe('timeout');
    expect(known !== 'timeout' && known?.status).toBe(401);
    expect(unknown !== 'timeout' && unknown?.status).toBe(401);
    // The audit trail for the existing account is still written.
    expect(record).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ action: 'auth.login_failed', entityId: KNOWN_USER.id }));
  });

  test('a failing audit write does not turn the failed login into a server error', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const ports = {
      auth: {
        findUserByEmail: async () => KNOWN_USER,
        verifyPassword: async () => false,
        recordFailedLogin: async () => 1,
      },
      audit: { record: jest.fn(async () => { throw new Error('audit down'); }) },
    } as unknown as ServerApiPorts;

    const response = await handleAuthRoute(loginRequest(KNOWN_USER.email), ports);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(response?.status).toBe(401);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
