import {
  SERVER_ACCESS_TOKEN_STORAGE_KEY,
  SERVER_AUTH_SESSION_STORAGE_KEY,
  SERVER_CSRF_TOKEN_STORAGE_KEY,
  buildServerAuthSession,
  clearServerAuthSession,
  createServerAuthClient,
  getServerAccessToken,
  readServerAuthSession,
  readServerCsrfToken,
  saveServerAuthSession,
  type BrowserStorageLike,
  type ServerAuthUser,
} from '@/services/transport';

describe('server auth session', () => {
  afterEach(() => {
    clearServerAuthSession(null, null);
  });

  test('keeps access tokens in memory and never writes tokens to Web Storage', () => {
    const persistent = memoryStorage();
    const volatile = memoryStorage();
    const session = buildServerAuthSession({
      user: user(),
      tokens: tokens('access-1'),
      now: new Date('2026-06-03T10:00:00.000Z'),
    });

    saveServerAuthSession(session, 'csrf-1', persistent, volatile);

    expect(readServerAuthSession(persistent)).toEqual(session);
    expect(getServerAccessToken(persistent, volatile)).toBe('access-1');
    expect(persistent.getItem(SERVER_AUTH_SESSION_STORAGE_KEY)).toBeNull();
    expect(volatile.getItem(SERVER_ACCESS_TOKEN_STORAGE_KEY)).toBeNull();
    expect(persistent.getItem(SERVER_CSRF_TOKEN_STORAGE_KEY)).toBe('csrf-1');

    clearServerAuthSession(persistent, volatile);
    expect(persistent.getItem(SERVER_AUTH_SESSION_STORAGE_KEY)).toBeNull();
    expect(volatile.getItem(SERVER_ACCESS_TOKEN_STORAGE_KEY)).toBeNull();
  });

  test('does not expose an in-memory access token to a different server origin', () => {
    const session = buildServerAuthSession({
      user: user(),
      tokens: tokens('access-origin-a'),
    });
    saveServerAuthSession(session, 'csrf-a', null, null, 'https://a.example.com/api');

    expect(getServerAccessToken(null, null, 'https://a.example.com/other')).toBe('access-origin-a');
    expect(getServerAccessToken(null, null, 'https://b.example.com')).toBeNull();
    expect(readServerAuthSession(null, 'https://b.example.com')).toBeNull();
  });

  test('does not reuse a CSRF token for a different server origin', () => {
    const persistent = memoryStorage();
    const session = buildServerAuthSession({
      user: user(),
      tokens: tokens('access-origin-a'),
    });
    saveServerAuthSession(
      session,
      'csrf-origin-a',
      persistent,
      null,
      'https://a.example.com/api',
    );

    expect(readServerCsrfToken(persistent, 'https://a.example.com/other')).toBe('csrf-origin-a');
    expect(readServerCsrfToken(persistent, 'https://b.example.com')).toBeNull();
  });
});

describe('server auth client', () => {
  afterEach(() => {
    clearServerAuthSession(null, null);
  });

  test('reads setup state through server auth endpoint', async () => {
    const fetchImpl = jest.fn().mockResolvedValueOnce(jsonResponse({
      data: { needsInitialSetup: true },
    }));
    const client = createServerAuthClient({
      baseUrl: 'https://crm.example.com',
      fetchImpl,
    });

    await expect(client.getSetupState()).resolves.toEqual({ needsInitialSetup: true });
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://crm.example.com/api/v1/auth/setup-state',
      expect.objectContaining({
        method: 'GET',
      }),
    );
  });

  test('creates initial owner through server auth endpoint and stores session', async () => {
    const persistent = memoryStorage();
    const volatile = memoryStorage();
    const fetchImpl = jest.fn().mockResolvedValueOnce(jsonResponse({
      data: {
        user: user({ email: 'owner@example.com', displayName: 'Owner' }),
        tokens: tokens('access-setup'),
        csrfToken: 'csrf-setup',
      },
    }));
    const client = createServerAuthClient({
      baseUrl: 'https://crm.example.com',
      device: 'desktop-test',
      fetchImpl,
      storage: persistent,
      accessTokenStorage: volatile,
      now: () => new Date('2026-06-03T10:00:00.000Z'),
    });

    const session = await client.createInitialOwner({
      email: 'owner@example.com',
      password: 'new-passphrase',
      displayName: 'Owner',
      setupToken: 'setup-token-secret',
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://crm.example.com/api/v1/auth/initial-setup',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          email: 'owner@example.com',
          password: 'new-passphrase',
          displayName: 'Owner',
          workspaceName: 'SimpleCRM',
          initialSetupToken: 'setup-token-secret',
          device: 'desktop-test',
        }),
      }),
    );
    expect(session.tokens.accessToken).toBe('access-setup');
    expect(readServerAuthSession(persistent)?.tokens.accessToken).toBe('access-setup');
    expect(readServerCsrfToken(persistent, 'https://crm.example.com')).toBe('csrf-setup');
    expect(volatile.getItem(SERVER_ACCESS_TOKEN_STORAGE_KEY)).toBeNull();
    expect(fetchImpl.mock.calls[0]?.[1]).toMatchObject({ credentials: 'include' });
  });

  test('reads and accepts auth invitations through server auth endpoints', async () => {
    const persistent = memoryStorage();
    const volatile = memoryStorage();
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(jsonResponse({
        data: {
          id: 'invite-1',
          email: 'agent@example.com',
          displayName: 'Agent',
          role: 'user',
          expiresAt: '2026-06-10T10:00:00.000Z',
          acceptedAt: null,
          revokedAt: null,
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          user: user({ id: 'agent-1', email: 'agent@example.com', displayName: 'Agent', role: 'user' }),
          tokens: tokens('access-invite'),
          csrfToken: 'csrf-invite',
        },
      }));
    const client = createServerAuthClient({
      baseUrl: 'https://crm.example.com',
      device: 'browser-test',
      fetchImpl,
      storage: persistent,
      accessTokenStorage: volatile,
      now: () => new Date('2026-06-03T10:00:00.000Z'),
    });

    await expect(client.getInvitation('invite-token-1')).resolves.toMatchObject({
      email: 'agent@example.com',
      displayName: 'Agent',
      role: 'user',
    });
    const session = await client.acceptInvitation('invite-token-1', {
      password: 'agent-passphrase',
    });

    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      'https://crm.example.com/api/v1/auth/invitations/invite-token-1',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      'https://crm.example.com/api/v1/auth/invitations/invite-token-1/accept',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          password: 'agent-passphrase',
          device: 'browser-test',
        }),
      }),
    );
    expect(session.user.email).toBe('agent@example.com');
    expect(readServerAuthSession(persistent)?.tokens.accessToken).toBe('access-invite');
    expect(readServerCsrfToken(persistent, 'https://crm.example.com')).toBe('csrf-invite');
    expect(volatile.getItem(SERVER_ACCESS_TOKEN_STORAGE_KEY)).toBeNull();
  });

  test('logs in through server auth endpoint and stores tokens', async () => {
    const persistent = memoryStorage();
    const volatile = memoryStorage();
    const fetchImpl = jest.fn().mockResolvedValueOnce(jsonResponse({
      data: {
        user: user(),
        tokens: tokens('access-login'),
        csrfToken: 'csrf-login',
      },
    }));
    const client = createServerAuthClient({
      baseUrl: 'https://crm.example.com',
      device: 'desktop-test',
      fetchImpl,
      storage: persistent,
      accessTokenStorage: volatile,
      now: () => new Date('2026-06-03T10:00:00.000Z'),
    });

    const session = await client.login('owner@example.com', 'passphrase');

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://crm.example.com/api/v1/auth/login',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          email: 'owner@example.com',
          password: 'passphrase',
          device: 'desktop-test',
        }),
      }),
    );
    expect(session.tokens.accessToken).toBe('access-login');
    expect(readServerAuthSession(persistent)?.tokens.accessToken).toBe('access-login');
    expect(readServerCsrfToken(persistent, 'https://crm.example.com')).toBe('csrf-login');
    expect(volatile.getItem(SERVER_ACCESS_TOKEN_STORAGE_KEY)).toBeNull();
  });

  test('reveals the PIN step only after the server accepted primary credentials', async () => {
    const fetchImpl = jest.fn().mockResolvedValueOnce(jsonResponse({
      data: { pinRequired: true, captchaChallenge: 'pin-continuation' },
    }));
    const client = createServerAuthClient({
      baseUrl: 'https://crm.example.com',
      fetchImpl,
    });

    await expect(client.loginAdvanced({
      email: 'owner@example.com',
      password: 'correct-password',
    })).resolves.toEqual({
      kind: 'pin_required',
      captchaChallenge: 'pin-continuation',
    });
  });

  test('refresh rotates stored tokens', async () => {
    const persistent = memoryStorage();
    const volatile = memoryStorage();
    saveServerAuthSession(
      buildServerAuthSession({
        user: user(),
        tokens: tokens('access-old'),
        now: new Date('2026-06-03T10:00:00.000Z'),
      }),
      'csrf-old',
      persistent,
      volatile,
      'https://crm.example.com',
    );
    const fetchImpl = jest.fn().mockResolvedValueOnce(jsonResponse({
      data: {
        user: user({ displayName: 'Owner Rotated' }),
        tokens: tokens('access-new'),
        csrfToken: 'csrf-new',
      },
    }));
    const client = createServerAuthClient({
      baseUrl: 'https://crm.example.com',
      fetchImpl,
      storage: persistent,
      accessTokenStorage: volatile,
      now: () => new Date('2026-06-03T10:05:00.000Z'),
    });

    const session = await client.refresh();

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://crm.example.com/api/v1/auth/refresh',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        headers: expect.objectContaining({
          'X-CSRF-Token': 'csrf-old',
        }),
      }),
    );
    expect(fetchImpl.mock.calls[0]?.[1]).not.toHaveProperty('body');
    expect(session?.user.displayName).toBe('Owner Rotated');
    expect(readServerAuthSession(persistent)?.tokens.accessToken).toBe('access-new');
    expect(readServerCsrfToken(persistent, 'https://crm.example.com')).toBe('csrf-new');
    expect(volatile.getItem(SERVER_ACCESS_TOKEN_STORAGE_KEY)).toBeNull();
  });

  test('bootstraps a new CSRF token after switching server origins', async () => {
    const persistent = memoryStorage();
    saveServerAuthSession(
      buildServerAuthSession({ user: user(), tokens: tokens('access-a') }),
      'csrf-a',
      persistent,
      null,
      'https://a.example.com',
    );
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(jsonResponse({ data: { csrfToken: 'csrf-b' } }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          user: user(),
          tokens: tokens('access-b'),
          csrfToken: 'csrf-b-rotated',
        },
      }));
    const client = createServerAuthClient({
      baseUrl: 'https://b.example.com',
      fetchImpl,
      storage: persistent,
      accessTokenStorage: null,
    });

    await expect(client.refresh()).resolves.toMatchObject({
      tokens: { accessToken: 'access-b' },
    });
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe('https://b.example.com/api/v1/auth/csrf');
    expect(fetchImpl.mock.calls[1]?.[1]).toEqual(expect.objectContaining({
      headers: expect.objectContaining({ 'X-CSRF-Token': 'csrf-b' }),
    }));
    expect(readServerCsrfToken(persistent, 'https://b.example.com')).toBe('csrf-b-rotated');
  });

  test('coalesces concurrent refresh rotations for the same server session', async () => {
    const persistent = memoryStorage();
    saveServerAuthSession(
      buildServerAuthSession({ user: user(), tokens: tokens('access-old') }),
      'csrf-old',
      persistent,
      null,
      'https://crm.example.com',
    );
    let resolveFetch!: (response: Response) => void;
    const fetchImpl = jest.fn(() => new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    }));
    const client = createServerAuthClient({
      baseUrl: 'https://crm.example.com',
      fetchImpl,
      storage: persistent,
      accessTokenStorage: null,
    });

    const first = client.refresh();
    const second = client.refresh();
    await Promise.resolve();
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    resolveFetch(jsonResponse({
      data: {
        user: user(),
        tokens: tokens('access-new'),
        csrfToken: 'csrf-new',
      },
    }));

    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ tokens: expect.objectContaining({ accessToken: 'access-new' }) }),
      expect.objectContaining({ tokens: expect.objectContaining({ accessToken: 'access-new' }) }),
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test('migrates one legacy localStorage refresh token into the cookie session', async () => {
    const persistent = memoryStorage();
    const volatile = memoryStorage();
    persistent.setItem(SERVER_AUTH_SESSION_STORAGE_KEY, JSON.stringify({
      user: user(),
      tokens: {
        accessToken: 'legacy-access',
        refreshToken: 'legacy-refresh',
        expiresInSeconds: 900,
      },
      savedAt: '2026-06-03T10:00:00.000Z',
      expiresAt: '2026-06-03T10:15:00.000Z',
    }));
    const fetchImpl = jest.fn().mockResolvedValueOnce(jsonResponse({
      data: {
        user: user(),
        tokens: tokens('access-migrated'),
        csrfToken: 'csrf-migrated',
      },
    }));
    const client = createServerAuthClient({
      baseUrl: 'https://crm.example.com',
      fetchImpl,
      storage: persistent,
      accessTokenStorage: volatile,
    });

    await expect(client.refresh()).resolves.toMatchObject({
      tokens: { accessToken: 'access-migrated' },
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://crm.example.com/api/v1/auth/refresh',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        headers: expect.objectContaining({
          'X-SimpleCRM-Session-Migration': '1',
        }),
        body: JSON.stringify({ refreshToken: 'legacy-refresh' }),
      }),
    );
    expect(persistent.getItem(SERVER_AUTH_SESSION_STORAGE_KEY)).toBeNull();
    expect(readServerCsrfToken(persistent, 'https://crm.example.com')).toBe('csrf-migrated');
  });

  test('does not send JSON content-type for bodyless TOTP setup requests', async () => {
    const fetchImpl = jest.fn().mockResolvedValueOnce(jsonResponse({
      data: {
        secret: 'JBSWY3DPEHPK3PXP',
        otpauthUri: 'otpauth://totp/SimpleCRM:owner@example.com?secret=JBSWY3DPEHPK3PXP',
      },
    }));
    const client = createServerAuthClient({
      baseUrl: 'https://crm.example.com',
      fetchImpl,
    });

    await expect(client.beginUserTotpSetup('access-totp', 'user-1')).resolves.toEqual({
      secret: 'JBSWY3DPEHPK3PXP',
      otpauthUri: 'otpauth://totp/SimpleCRM:owner@example.com?secret=JBSWY3DPEHPK3PXP',
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://crm.example.com/api/v1/auth/users/user-1/mfa/totp/setup',
      expect.objectContaining({
        method: 'POST',
        headers: {
          Accept: 'application/json',
          Authorization: 'Bearer access-totp',
        },
      }),
    );
    expect(fetchImpl.mock.calls[0]?.[1]).not.toHaveProperty('body');
  });

  test('logout revokes the HttpOnly cookie session with CSRF and clears memory', async () => {
    const persistent = memoryStorage();
    const volatile = memoryStorage();
    saveServerAuthSession(
      buildServerAuthSession({
        user: user(),
        tokens: tokens('access-logout'),
      }),
      'csrf-logout',
      persistent,
      volatile,
      'https://crm.example.com',
    );
    const fetchImpl = jest.fn().mockResolvedValueOnce(jsonResponse({
      data: { revoked: true },
    }));
    const client = createServerAuthClient({
      baseUrl: 'https://crm.example.com/',
      fetchImpl,
      storage: persistent,
      accessTokenStorage: volatile,
    });

    await expect(client.logout()).resolves.toEqual({ revoked: true });
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://crm.example.com/api/v1/auth/logout',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer access-logout',
          'X-CSRF-Token': 'csrf-logout',
        }),
        credentials: 'include',
      }),
    );
    expect(fetchImpl.mock.calls[0]?.[1]).not.toHaveProperty('body');
    expect(readServerAuthSession(persistent)).toBeNull();
    expect(volatile.getItem(SERVER_ACCESS_TOKEN_STORAGE_KEY)).toBeNull();
  });

  test('logout revokes a legacy localStorage refresh token without cookie CSRF bootstrap', async () => {
    const persistent = memoryStorage();
    persistent.setItem(SERVER_AUTH_SESSION_STORAGE_KEY, JSON.stringify({
      user: user(),
      tokens: {
        accessToken: 'legacy-access',
        refreshToken: 'legacy-refresh',
        expiresInSeconds: 900,
      },
      savedAt: '2026-06-03T10:00:00.000Z',
      expiresAt: '2026-06-03T10:15:00.000Z',
    }));
    const fetchImpl = jest.fn().mockResolvedValueOnce(jsonResponse({
      data: { revoked: true },
    }));
    const client = createServerAuthClient({
      baseUrl: 'https://crm.example.com',
      fetchImpl,
      storage: persistent,
    });

    await expect(client.logout()).resolves.toEqual({ revoked: true });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://crm.example.com/api/v1/auth/logout',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        headers: expect.objectContaining({
          'X-SimpleCRM-Session-Migration': '1',
        }),
        body: JSON.stringify({ refreshToken: 'legacy-refresh' }),
      }),
    );
    expect(persistent.getItem(SERVER_AUTH_SESSION_STORAGE_KEY)).toBeNull();
  });
});

function user(overrides: Partial<ServerAuthUser> = {}): ServerAuthUser {
  return {
    id: 'user-1',
    workspaceId: 'workspace-1',
    email: 'owner@example.com',
    displayName: 'Owner',
    role: 'owner',
    ...overrides,
  };
}

function tokens(accessToken: string) {
  return {
    accessToken,
    expiresInSeconds: 900,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  } as Response;
}

function memoryStorage(): BrowserStorageLike {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
}
