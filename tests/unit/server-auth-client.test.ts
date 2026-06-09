import {
  SERVER_ACCESS_TOKEN_STORAGE_KEY,
  SERVER_AUTH_SESSION_STORAGE_KEY,
  buildServerAuthSession,
  clearServerAuthSession,
  createServerAuthClient,
  getServerAccessToken,
  readServerAuthSession,
  saveServerAuthSession,
  type BrowserStorageLike,
  type ServerAuthUser,
} from '@/services/transport';

describe('server auth session', () => {
  test('saves readable session metadata and volatile access token', () => {
    const persistent = memoryStorage();
    const volatile = memoryStorage();
    const session = buildServerAuthSession({
      user: user(),
      tokens: tokens('access-1', 'refresh-1'),
      now: new Date('2026-06-03T10:00:00.000Z'),
    });

    saveServerAuthSession(session, persistent, volatile);

    expect(readServerAuthSession(persistent)).toEqual(session);
    expect(getServerAccessToken(persistent, volatile)).toBe('access-1');
    expect(JSON.parse(persistent.getItem(SERVER_AUTH_SESSION_STORAGE_KEY) ?? '{}')).toMatchObject({
      user: { email: 'owner@example.com' },
      tokens: { accessToken: 'access-1', refreshToken: 'refresh-1' },
      savedAt: '2026-06-03T10:00:00.000Z',
    });

    clearServerAuthSession(persistent, volatile);
    expect(persistent.getItem(SERVER_AUTH_SESSION_STORAGE_KEY)).toBeNull();
    expect(volatile.getItem(SERVER_ACCESS_TOKEN_STORAGE_KEY)).toBeNull();
  });
});

describe('server auth client', () => {
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
        tokens: tokens('access-setup', 'refresh-setup'),
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
    expect(readServerAuthSession(persistent)?.tokens.refreshToken).toBe('refresh-setup');
    expect(volatile.getItem(SERVER_ACCESS_TOKEN_STORAGE_KEY)).toBe('access-setup');
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
          tokens: tokens('access-invite', 'refresh-invite'),
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
    expect(readServerAuthSession(persistent)?.tokens.refreshToken).toBe('refresh-invite');
    expect(volatile.getItem(SERVER_ACCESS_TOKEN_STORAGE_KEY)).toBe('access-invite');
  });

  test('logs in through server auth endpoint and stores tokens', async () => {
    const persistent = memoryStorage();
    const volatile = memoryStorage();
    const fetchImpl = jest.fn().mockResolvedValueOnce(jsonResponse({
      data: {
        user: user(),
        tokens: tokens('access-login', 'refresh-login'),
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
    expect(readServerAuthSession(persistent)?.tokens.refreshToken).toBe('refresh-login');
    expect(volatile.getItem(SERVER_ACCESS_TOKEN_STORAGE_KEY)).toBe('access-login');
  });

  test('refresh rotates stored tokens', async () => {
    const persistent = memoryStorage();
    const volatile = memoryStorage();
    saveServerAuthSession(
      buildServerAuthSession({
        user: user(),
        tokens: tokens('access-old', 'refresh-old'),
        now: new Date('2026-06-03T10:00:00.000Z'),
      }),
      persistent,
      volatile,
    );
    const fetchImpl = jest.fn().mockResolvedValueOnce(jsonResponse({
      data: {
        user: user({ displayName: 'Owner Rotated' }),
        tokens: tokens('access-new', 'refresh-new'),
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
        body: JSON.stringify({ refreshToken: 'refresh-old' }),
      }),
    );
    expect(session?.user.displayName).toBe('Owner Rotated');
    expect(readServerAuthSession(persistent)?.tokens.accessToken).toBe('access-new');
    expect(volatile.getItem(SERVER_ACCESS_TOKEN_STORAGE_KEY)).toBe('access-new');
  });

  test('logout sends refresh token with bearer token and clears session', async () => {
    const persistent = memoryStorage();
    const volatile = memoryStorage();
    saveServerAuthSession(
      buildServerAuthSession({
        user: user(),
        tokens: tokens('access-logout', 'refresh-logout'),
      }),
      persistent,
      volatile,
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
        }),
        body: JSON.stringify({ refreshToken: 'refresh-logout' }),
      }),
    );
    expect(readServerAuthSession(persistent)).toBeNull();
    expect(volatile.getItem(SERVER_ACCESS_TOKEN_STORAGE_KEY)).toBeNull();
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

function tokens(accessToken: string, refreshToken: string) {
  return {
    accessToken,
    refreshToken,
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
