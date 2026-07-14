import {
  authSessionData,
  csrfBootstrapData,
  hasValidRefreshCsrf,
  readRefreshCredential,
} from '../../packages/server/src/api/auth-session-cookie';

describe('server auth session cookie', () => {
  test('keeps refresh credentials out of JSON and hardens HTTPS cookies', () => {
    const response = authSessionData({
      method: 'POST',
      path: '/api/v1/auth/login',
      headers: { 'x-forwarded-proto': 'https' },
    }, 200, {
      user: { id: 'user-1' },
    }, {
      accessToken: 'access-token',
      refreshToken: 'refresh/secret',
      expiresInSeconds: 900,
    });

    expect(JSON.stringify(response.body)).not.toContain('refresh/secret');
    expect(response.headers?.['Set-Cookie']).toContain('simplecrm_refresh=refresh%2Fsecret');
    expect(response.headers?.['Set-Cookie']).toContain('Path=/api/v1/auth');
    expect(response.headers?.['Set-Cookie']).toContain('HttpOnly');
    expect(response.headers?.['Set-Cookie']).toContain('Secure');
    expect(response.headers?.['Set-Cookie']).toContain('SameSite=None');
    expect(response.headers?.['Cache-Control']).toBe('no-store');
  });

  test('uses SameSite=Lax without Secure for explicit local HTTP development', () => {
    const response = authSessionData({
      method: 'POST',
      path: '/api/v1/auth/login',
      headers: { origin: 'http://localhost:5173' },
    }, 200, {}, {
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      expiresInSeconds: 900,
    });

    expect(response.headers?.['Set-Cookie']).toContain('SameSite=Lax');
    expect(response.headers?.['Set-Cookie']).not.toContain('; Secure');
  });

  test('rejects duplicate refresh cookies and accepts exactly one matching CSRF token', () => {
    const duplicate = csrfBootstrapData({
      method: 'GET',
      path: '/api/v1/auth/csrf',
      headers: { cookie: 'simplecrm_refresh=first; simplecrm_refresh=second' },
    });
    expect(duplicate.status).toBe(401);

    const bootstrap = csrfBootstrapData({
      method: 'GET',
      path: '/api/v1/auth/csrf',
      headers: { cookie: 'simplecrm_refresh=refresh-token' },
    });
    const csrfToken = (bootstrap.body as { data: { csrfToken: string } }).data.csrfToken;
    const request = {
      method: 'POST',
      path: '/api/v1/auth/refresh',
      headers: {
        cookie: 'simplecrm_refresh=refresh-token',
        'x-csrf-token': csrfToken,
      },
    };
    const credential = readRefreshCredential(request);

    expect(credential).toEqual({ refreshToken: 'refresh-token', legacyMigration: false });
    expect(credential && hasValidRefreshCsrf(request, credential)).toBe(true);
    expect(credential && hasValidRefreshCsrf({
      ...request,
      headers: { ...request.headers, 'x-csrf-token': `${csrfToken}x` },
    }, credential)).toBe(false);
  });

  test('accepts a body refresh token only on the explicit one-time migration path', () => {
    const body = { refreshToken: 'legacy-refresh-token' };
    expect(readRefreshCredential({
      method: 'POST',
      path: '/api/v1/auth/refresh',
      body,
    })).toBeNull();
    expect(readRefreshCredential({
      method: 'POST',
      path: '/api/v1/auth/refresh',
      headers: { 'x-simplecrm-session-migration': '1' },
      body,
    })).toEqual({ refreshToken: 'legacy-refresh-token', legacyMigration: true });
  });
});
