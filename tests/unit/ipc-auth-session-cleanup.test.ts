import { IPCChannels } from '../../shared/ipc/channels';

const handlers = new Map<string, (...args: any[]) => unknown>();
const revokeSession = jest.fn();

jest.mock('../../electron/ipc/register', () => ({
  registerIpcHandler: jest.fn((channel: string, handler: (...args: any[]) => unknown) => {
    handlers.set(channel, handler);
    return () => undefined;
  }),
}));

jest.mock('../../electron/auth/password-hash', () => ({
  verifyPassword: jest.fn(() => true),
}));

jest.mock('../../electron/auth/session-store', () => ({
  createSession: jest.fn(() => ({ expiresAt: '2026-07-14T12:00:00.000Z' })),
  revokeSession: (...args: unknown[]) => revokeSession(...args),
  revokeSessionsForUser: jest.fn(),
  getSessionFromEvent: jest.fn(() => null),
  touchSession: jest.fn(),
}));

jest.mock('../../electron/auth/auth-store', () => ({
  changeLocalAuthPassword: jest.fn(),
  deleteLocalAuthUser: jest.fn(),
  enableAuthMiddleware: jest.fn(),
  findLocalLoginUser: jest.fn(() => ({
    id: 'user-1',
    username: 'pascal',
    display_name: 'Pascal',
    role: 'owner',
    is_active: 1,
    must_set_password: 0,
    password_hash: 'hash',
  })),
  isAuthMiddlewareEnabled: jest.fn(() => true),
  listLocalAuthAuditLog: jest.fn(),
  listLocalAuthUsers: jest.fn(),
  readLocalSetupState: jest.fn(),
  readOrCreateOneTimeSetupPassword: jest.fn(),
  recordLocalLoginFailure: jest.fn(),
  recordLocalLoginSuccess: jest.fn(),
  recordLocalLogout: jest.fn(),
  saveLocalAuthUser: jest.fn(),
  setInitialOwnerPassword: jest.fn(),
  verifyLocalAuthAuditChain: jest.fn(),
}));

jest.mock('../../electron/auth/login-guard', () => ({
  checkLoginAllowed: jest.fn(() => ({ ok: true })),
  recordLoginFailure: jest.fn(),
  clearLoginFailures: jest.fn(),
}));

import { registerAuthHandlers } from '../../electron/ipc/auth';

describe('Electron auth session cleanup', () => {
  beforeEach(() => {
    handlers.clear();
    revokeSession.mockClear();
    registerAuthHandlers({ logger: console });
  });

  test('registers one destroyed listener across repeated logins of the same renderer', async () => {
    const destroyedListeners: Array<() => void> = [];
    const sender = {
      id: 17,
      once: jest.fn((event: string, listener: () => void) => {
        if (event === 'destroyed') destroyedListeners.push(listener);
      }),
    };
    const login = handlers.get(IPCChannels.Auth.Login);
    if (!login) throw new Error('login handler missing');

    await login({ sender }, { username: 'pascal', passphrase: 'secret' });
    await login({ sender }, { username: 'pascal', passphrase: 'secret' });

    expect(sender.once).toHaveBeenCalledTimes(1);
    destroyedListeners[0]?.();
    expect(revokeSession).toHaveBeenCalledTimes(1);
    expect(revokeSession).toHaveBeenCalledWith(17);
  });
});
