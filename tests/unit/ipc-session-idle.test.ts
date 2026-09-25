const mockHandle = jest.fn();

jest.mock('electron', () => ({
  ipcMain: {
    removeHandler: jest.fn(),
    handle: (...args: unknown[]) => mockHandle(...args),
  },
}));

jest.mock('../../shared/ipc/schemas', () => ({
  getPayloadSchema: jest.fn(() => null),
  getResultSchema: jest.fn(() => null),
  isDeprecatedChannel: jest.fn(() => false),
}));

jest.mock('../../electron/auth/auth-store', () => ({
  canAccessLocalAccount: jest.fn(() => true),
}));

import { IPCChannels } from '../../shared/ipc/channels';
import { registerIpcHandler } from '../../electron/ipc/register';
import { clearAllSessions, createSession, SESSION_IDLE_MS } from '../../electron/auth/session-store';

const LOGIN_AT = new Date('2026-01-01T09:00:00.000Z').getTime();
const MINUTE = 60 * 1000;
const event = { sender: { id: 42 } };

function registerAndGetWrapped(channel: Parameters<typeof registerIpcHandler>[0]) {
  mockHandle.mockClear();
  registerIpcHandler(channel, async () => ({ ok: true }), { logger: { ...console, error: jest.fn() } });
  return mockHandle.mock.calls[0][1] as (e: unknown, payload?: unknown) => Promise<unknown>;
}

describe('IPC session idle timeout', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: LOGIN_AT });
    clearAllSessions();
    createSession(42, { id: 'u1', username: 'u', displayName: 'U', role: 'owner', workspaceId: 'w' });
  });

  afterEach(() => {
    clearAllSessions();
    jest.useRealTimers();
  });

  // F-A7-02: Authentifizierte IPC-Aufrufe verlaengerten das Idle-Fenster nie, die Abmeldung kam 30 Minuten nach dem Login.
  test('an authenticated call extends the idle window of the real session', async () => {
    const wrapped = registerAndGetWrapped(IPCChannels.Tasks.GetAll);

    jest.setSystemTime(LOGIN_AT + 20 * MINUTE);
    await expect(wrapped(event, undefined)).resolves.toEqual({ ok: true });

    jest.setSystemTime(LOGIN_AT + 40 * MINUTE);
    await expect(wrapped(event, undefined)).resolves.toEqual({ ok: true });
  });

  test('without any call the session still locks after the idle window', async () => {
    const wrapped = registerAndGetWrapped(IPCChannels.Tasks.GetAll);

    jest.setSystemTime(LOGIN_AT + SESSION_IDLE_MS + MINUTE);
    await expect(wrapped(event, undefined)).rejects.toThrow('Nicht angemeldet');
  });

  test('background polling channels do not keep an idle session alive', async () => {
    const poll = registerAndGetWrapped(IPCChannels.Email.ListImapAuthNotices);

    jest.setSystemTime(LOGIN_AT + 20 * MINUTE);
    await expect(poll(event, undefined)).resolves.toEqual({ ok: true });

    jest.setSystemTime(LOGIN_AT + 40 * MINUTE);
    await expect(poll(event, undefined)).rejects.toThrow('Nicht angemeldet');
  });
});
