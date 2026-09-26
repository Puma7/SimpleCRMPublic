/**
 * pgp:set-peer-key-trust ueber den echten registerIpcHandler (Session, Rolle,
 * Schema). Der PGP-Dienst selbst ist ersetzt; seine Semantik pruefen
 * tests/mail/pgp-service-openpgp.test.ts.
 */
const mockHandlers = new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>();

jest.mock('electron', () => ({
  ipcMain: {
    removeHandler: jest.fn(),
    handle: (channel: string, handler: (event: unknown, ...args: unknown[]) => Promise<unknown>) => {
      mockHandlers.set(channel, handler);
    },
  },
}));

jest.mock('../../electron/auth/auth-store', () => ({
  canAccessLocalAccount: jest.fn(() => true),
  canUseSyntheticBootstrapAuthSession: jest.fn(() => false),
  getLocalAuthDbOrThrow: jest.fn(),
}));

jest.mock('../../electron/email/email-store', () => ({ getEmailMessageById: jest.fn() }));

jest.mock('../../electron/pgp/pgp-service', () => ({
  setPgpPeerKeyTrust: jest.fn((_id: number, trustLevel: string) => ({ trustLevel })),
}));

import { IPCChannels } from '../../shared/ipc/channels';
import { clearAllSessions, createSession, type SessionRole } from '../../electron/auth/session-store';
import { setPgpPeerKeyTrust } from '../../electron/pgp/pgp-service';
import { registerPgpHandlers } from '../../electron/ipc/pgp';

let nextSenderId = 200;

function eventFor(role: SessionRole) {
  const id = nextSenderId++;
  createSession(id, { id: `user-${role}`, username: role, displayName: role, role, workspaceId: 'w' });
  return { sender: { id } };
}

function setTrust(event: unknown, payload: unknown): Promise<unknown> {
  const handler = mockHandlers.get(IPCChannels.Pgp.SetPeerKeyTrust);
  if (!handler) throw new Error('kein Handler fuer pgp:set-peer-key-trust');
  return handler(event, payload);
}

beforeAll(() => {
  registerPgpHandlers({ logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() } });
});

beforeEach(() => {
  clearAllSessions();
  jest.mocked(setPgpPeerKeyTrust).mockClear();
});

describe('pgp:set-peer-key-trust (E21)', () => {
  // F-A7b-08: Kein Desktop-Pfad setzte den Vertrauensstatus eines Peer-Schluessels; gueltige Signaturen wurden nie gruen.
  test('Owner und Admin markieren einen Schluessel als verifiziert oder entziehen das Vertrauen', async () => {
    await expect(setTrust(eventFor('admin'), { id: 3, trustLevel: 'verified' }))
      .resolves.toEqual({ success: true, trustLevel: 'verified' });
    expect(setPgpPeerKeyTrust).toHaveBeenLastCalledWith(3, 'verified', 'user-admin');

    await expect(setTrust(eventFor('owner'), { id: 3, trustLevel: 'imported' }))
      .resolves.toEqual({ success: true, trustLevel: 'imported' });
    expect(setPgpPeerKeyTrust).toHaveBeenLastCalledWith(3, 'imported', 'user-owner');
  });

  test('andere Rollen duerfen den Vertrauensstatus nicht setzen (wie Import und Loeschen)', async () => {
    for (const role of ['agent', 'viewer'] as const) {
      await expect(setTrust(eventFor(role), { id: 3, trustLevel: 'verified' })).rejects.toThrow('Keine Berechtigung');
    }
    expect(setPgpPeerKeyTrust).not.toHaveBeenCalled();
  });

  test('nur verified und imported sind als Stufe erlaubt', async () => {
    for (const trustLevel of ['tofu', 'unknown', '']) {
      await expect(setTrust(eventFor('owner'), { id: 3, trustLevel })).rejects.toThrow();
    }
    expect(setPgpPeerKeyTrust).not.toHaveBeenCalled();
  });
});
