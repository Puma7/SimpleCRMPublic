/**
 * @jest-environment node
 */
/**
 * Desktop-Sessions nach Rollen-, Aktiv- und Passwortwechseln ueber den echten
 * registerIpcHandler, das echte session-store und das echte auth-store auf SQLite.
 * Nur Electron ist ersetzt.
 */
const mockHandlers = new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>();

jest.mock('electron', () => ({
  ipcMain: {
    removeHandler: jest.fn(),
    handle: (channel: string, handler: (event: unknown, ...args: unknown[]) => Promise<unknown>) => {
      mockHandlers.set(channel, handler);
    },
  },
  BrowserWindow: { getAllWindows: () => [] },
  app: { getPath: () => `${process.cwd()}/.tmp-tests/simplecrm-local-auth-session-revocation`, isPackaged: false },
}));

import Database from 'better-sqlite3';
import { IPCChannels } from '../../shared/ipc/channels';
import { bootstrapFreshDatabaseSchema, closeDatabase } from '../../electron/sqlite-service';
import { LOCAL_OWNER_USER_ID, LOCAL_WORKSPACE_ID } from '../../electron/mail-roadmap-migrations';
import { hashPassword } from '../../electron/auth/password-hash';
import {
  clearAllSessions,
  createSession,
  getSessionForWebContents,
  type SessionRole,
} from '../../electron/auth/session-store';
import { registerAuthHandlers } from '../../electron/ipc/auth';

const PASSWORD = 'Passwort-1234567';
const quietLogger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };

type Event = { sender: { id: number } };

// C-A72-Folge (Paritaet F-A1-02): Desktop-Sessions behielten nach Rollenwechsel, Deaktivierung
// oder Passwort-Reset ihre alte Rolle bis zum Logout; ein herabgestufter Owner blieb im offenen
// Fenster Owner, eine uebernommene Sitzung ueberlebte die Passwortaenderung.
describe('Desktop: Rollen-, Aktiv- und Passwortwechsel beenden die Sessions des Ziels', () => {
  let db: Database.Database;
  let nextSenderId = 900;

  const roleOf = (id: string) =>
    (db.prepare('SELECT role FROM users WHERE id = ?').get(id) as { role: string } | undefined)?.role;

  const insertUser = (id: string, role: SessionRole) => {
    db.prepare(
      `INSERT INTO users (id, username, display_name, role, password_hash, password_updated_at, is_active)
       VALUES (?, ?, ?, ?, ?, ?, 1)`,
    ).run(id, id, id, role, hashPassword(PASSWORD), new Date().toISOString());
  };

  const login = (userId: string, role: SessionRole): Event => {
    const id = nextSenderId++;
    createSession(id, { id: userId, username: userId, displayName: userId, role, workspaceId: LOCAL_WORKSPACE_ID });
    return { sender: { id } };
  };

  const alive = (event: Event) => getSessionForWebContents(event.sender.id);

  const invoke = (channel: string, event: Event, payload?: unknown): Promise<any> => {
    const handler = mockHandlers.get(channel);
    if (!handler) throw new Error(`kein Handler fuer ${channel}`);
    return payload === undefined ? handler(event) : handler(event, payload);
  };

  const save = (event: Event, id: string, change: Record<string, unknown>) => {
    const current = db.prepare('SELECT username, display_name, role, is_active FROM users WHERE id = ?').get(id) as {
      username: string;
      display_name: string;
      role: string;
      is_active: number;
    };
    return invoke(IPCChannels.Auth.SaveUser, event, {
      id,
      username: current.username,
      displayName: current.display_name,
      role: current.role,
      isActive: current.is_active === 1,
      ...change,
    });
  };

  beforeAll(() => {
    registerAuthHandlers({ logger: quietLogger });
  });

  beforeEach(() => {
    clearAllSessions();
    db = new Database(':memory:');
    bootstrapFreshDatabaseSchema(db, { keepDbAssigned: true });
    insertUser('owner2', 'owner');
    insertUser('admin', 'admin');
    insertUser('agent', 'agent');
  });

  afterEach(() => {
    closeDatabase();
  });

  describe('fremdes Konto', () => {
    test.each([
      ['Passwort setzen', { passphrase: 'Neu-gesetzt-12345' }],
      ['Rolle aendern', { role: 'viewer' }],
      ['Deaktivieren', { isActive: false }],
    ])('%s beendet alle Sessions des Ziels, nicht die des Handelnden', async (_label, change) => {
      const owner = login(LOCAL_OWNER_USER_ID, 'owner');
      const agentWindow = login('agent', 'agent');
      const agentSecondWindow = login('agent', 'agent');
      const bystander = login('admin', 'admin');

      await expect(save(owner, 'agent', change)).resolves.toEqual({ success: true, id: 'agent' });

      expect(alive(agentWindow)).toBeNull();
      expect(alive(agentSecondWindow)).toBeNull();
      expect(alive(owner)).toMatchObject({ userId: LOCAL_OWNER_USER_ID, role: 'owner' });
      expect(alive(bystander)).toMatchObject({ userId: 'admin' });
    });

    test('ein herabgestufter Owner verliert sein offenes Fenster und damit die Owner-Rechte', async () => {
      const owner = login(LOCAL_OWNER_USER_ID, 'owner');
      const demotedOwner = login('owner2', 'owner');

      await expect(save(owner, 'owner2', { role: 'admin' })).resolves.toEqual({ success: true, id: 'owner2' });
      expect(alive(demotedOwner)).toBeNull();
      await expect(save(demotedOwner, 'owner2', { role: 'owner' })).rejects.toThrow('Nicht angemeldet');
      expect(roleOf('owner2')).toBe('admin');
    });

    test('Umbenennen laesst die Sessions des Ziels bestehen', async () => {
      const owner = login(LOCAL_OWNER_USER_ID, 'owner');
      const agentWindow = login('agent', 'agent');

      await expect(save(owner, 'agent', { displayName: 'Umbenannt' })).resolves.toEqual({ success: true, id: 'agent' });

      expect(alive(agentWindow)).toMatchObject({ userId: 'agent', role: 'agent' });
    });

    test('eine abgelehnte Aenderung beendet keine Session', async () => {
      const admin = login('admin', 'admin');
      const ownerWindow = login('owner2', 'owner');

      await expect(save(admin, 'owner2', { passphrase: 'Uebernommen-12345' })).resolves.toMatchObject({ success: false });

      expect(alive(ownerWindow)).toMatchObject({ userId: 'owner2' });
    });
  });

  describe('eigenes Konto', () => {
    test('Herabstufen behaelt das aktuelle Fenster mit der neuen Rolle, andere Fenster enden', async () => {
      const current = login('owner2', 'owner');
      const otherWindow = login('owner2', 'owner');

      await expect(save(current, 'owner2', { role: 'admin' })).resolves.toEqual({ success: true, id: 'owner2' });

      expect(alive(current)).toMatchObject({ userId: 'owner2', role: 'admin' });
      expect(alive(otherWindow)).toBeNull();
      await expect(invoke(IPCChannels.Auth.GetSession, current)).resolves.toMatchObject({ user: { id: 'owner2', role: 'admin' } });
      // Die neue Rolle gilt sofort: Owner-Rechte sind weg.
      await expect(save(current, 'owner2', { role: 'owner' })).resolves.toMatchObject({ success: false });
      expect(roleOf('owner2')).toBe('admin');
    });

    test('Passwort setzen behaelt das aktuelle Fenster, andere Fenster enden', async () => {
      const current = login('admin', 'admin');
      const otherWindow = login('admin', 'admin');

      await expect(save(current, 'admin', { passphrase: 'Eigenes-neues-123' })).resolves.toEqual({ success: true, id: 'admin' });

      expect(alive(current)).toMatchObject({ userId: 'admin', role: 'admin' });
      expect(alive(otherWindow)).toBeNull();
    });

    test('sich selbst deaktivieren beendet auch das aktuelle Fenster', async () => {
      const current = login('admin', 'admin');

      await expect(save(current, 'admin', { isActive: false })).resolves.toEqual({ success: true, id: 'admin' });

      expect(alive(current)).toBeNull();
    });
  });

  describe('ChangePassword', () => {
    test('beendet die anderen Sessions des Nutzers, die aktuelle bleibt', async () => {
      const current = login('agent', 'agent');
      const otherWindow = login('agent', 'agent');
      const someoneElse = login('admin', 'admin');

      await expect(invoke(IPCChannels.Auth.ChangePassword, current, {
        currentPassword: PASSWORD,
        newPassword: 'Ganz-neues-Passwort-1',
      })).resolves.toEqual({ success: true, id: 'agent' });

      expect(alive(current)).toMatchObject({ userId: 'agent' });
      expect(alive(otherWindow)).toBeNull();
      expect(alive(someoneElse)).toMatchObject({ userId: 'admin' });
    });

    test('ein falsches aktuelles Passwort beendet keine Session', async () => {
      const current = login('agent', 'agent');
      const otherWindow = login('agent', 'agent');

      await expect(invoke(IPCChannels.Auth.ChangePassword, current, {
        currentPassword: 'falsch-geraten-123',
        newPassword: 'Ganz-neues-Passwort-1',
      })).resolves.toMatchObject({ success: false });

      expect(alive(otherWindow)).toMatchObject({ userId: 'agent' });
    });
  });
});
