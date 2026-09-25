/**
 * @jest-environment node
 */
/**
 * Owner-Verwaltung der Desktop-Benutzer (G3) ueber den echten registerIpcHandler
 * (Session, Rolle) und das echte auth-store auf SQLite. Nur Electron ist ersetzt.
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
  app: { getPath: () => `${process.cwd()}/.tmp-tests/simplecrm-local-auth-owner-management`, isPackaged: false },
}));

import Database from 'better-sqlite3';
import { IPCChannels } from '../../shared/ipc/channels';
import { bootstrapFreshDatabaseSchema, closeDatabase } from '../../electron/sqlite-service';
import { LOCAL_OWNER_USER_ID, LOCAL_WORKSPACE_ID } from '../../electron/mail-roadmap-migrations';
import { hashPassword } from '../../electron/auth/password-hash';
import {
  clearAllSessions,
  createSession,
  getSessionFromEvent,
  type SessionRole,
} from '../../electron/auth/session-store';
import { registerAuthHandlers } from '../../electron/ipc/auth';

const OWNER_ONLY = 'Nur Eigentümer dürfen die Eigentümer-Rolle vergeben oder entziehen und Eigentümer-Konten ändern oder löschen';
const quietLogger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };

type Row = { username: string; display_name: string; role: string; is_active: number; password_hash: string };

// C-A72 (G3): Auf dem Desktop konnte ein Admin sich per SaveUser selbst zum Owner machen und
// Owner-Konten aendern oder loeschen; damit erreichte er Restore und Hard-Reset (nur Owner).
describe('Desktop: nur Owner verwalten die Owner-Rolle und Owner-Konten', () => {
  let db: Database.Database;
  let nextSenderId = 500;

  const row = (id: string) =>
    db.prepare('SELECT username, display_name, role, is_active, password_hash FROM users WHERE id = ?').get(id) as
      | Row
      | undefined;

  const insertUser = (id: string, role: SessionRole) => {
    db.prepare(
      `INSERT INTO users (id, username, display_name, role, password_hash, password_updated_at, is_active)
       VALUES (?, ?, ?, ?, ?, ?, 1)`,
    ).run(id, id, id, role, hashPassword('Passwort-1234567'), new Date().toISOString());
  };

  const eventFor = (userId: string, role: SessionRole) => {
    const id = nextSenderId++;
    createSession(id, { id: userId, username: userId, displayName: userId, role, workspaceId: LOCAL_WORKSPACE_ID });
    return { sender: { id } };
  };

  const invoke = (channel: string, event: unknown, payload: unknown): Promise<any> => {
    const handler = mockHandlers.get(channel);
    if (!handler) throw new Error(`kein Handler fuer ${channel}`);
    return handler(event, payload);
  };

  const save = (event: unknown, id: string, change: Record<string, unknown>) => {
    const current = row(id)!;
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
    // local-owner (Bootstrap) und owner2 sind aktive Owner: eine Ablehnung kommt
    // also aus der Owner-Regel, nicht aus dem Schutz des letzten Owners.
    insertUser('owner2', 'owner');
    insertUser('admin', 'admin');
    insertUser('admin2', 'admin');
    insertUser('agent', 'agent');
  });

  afterEach(() => {
    closeDatabase();
  });

  describe('ein Admin', () => {
    test('kann sich nicht selbst zum Owner machen', async () => {
      const admin = eventFor('admin', 'admin');

      await expect(save(admin, 'admin', { role: 'owner' })).resolves.toEqual({ success: false, error: OWNER_ONLY });
      expect(row('admin')?.role).toBe('admin');
    });

    test('kann keinen anderen Benutzer zum Owner machen', async () => {
      await expect(save(eventFor('admin', 'admin'), 'agent', { role: 'owner' }))
        .resolves.toEqual({ success: false, error: OWNER_ONLY });
      expect(row('agent')?.role).toBe('agent');
    });

    test('kann kein Owner-Konto anlegen', async () => {
      const result = await invoke(IPCChannels.Auth.SaveUser, eventFor('admin', 'admin'), {
        username: 'neu',
        displayName: 'Neu',
        role: 'owner',
        passphrase: 'Neues-Passwort-123',
      });

      expect(result).toEqual({ success: false, error: OWNER_ONLY });
      expect(db.prepare('SELECT id FROM users WHERE username = ?').get('neu')).toBeUndefined();
    });

    test.each([
      ['Passwort setzen', { passphrase: 'Uebernommen-12345' }],
      ['Deaktivieren', { isActive: false }],
      ['Herabstufen', { role: 'admin' }],
      ['Umbenennen', { displayName: 'Umbenannt' }],
    ])('kann ein Owner-Konto nicht aendern: %s', async (_label, change) => {
      const before = row('owner2');

      await expect(save(eventFor('admin', 'admin'), 'owner2', change)).resolves.toEqual({ success: false, error: OWNER_ONLY });
      expect(row('owner2')).toEqual(before);
    });

    test('kann ein Owner-Konto nicht loeschen', async () => {
      const ownerSession = eventFor('owner2', 'owner');

      const result = await invoke(IPCChannels.Auth.DeleteUser, eventFor('admin', 'admin'), { id: 'owner2' });

      expect(result).toEqual({ success: false, error: OWNER_ONLY });
      expect(row('owner2')).toBeDefined();
      expect(getSessionFromEvent(ownerSession as never)?.userId).toBe('owner2');
    });

    test('verwaltet andere Admins und Nicht-Owner weiter', async () => {
      const admin = eventFor('admin', 'admin');
      const before = row('admin2')!;

      await expect(save(admin, 'admin2', { passphrase: 'Admin2-neu-12345', isActive: false }))
        .resolves.toEqual({ success: true, id: 'admin2' });
      expect(row('admin2')).toMatchObject({ role: 'admin', is_active: 0 });
      expect(row('admin2')?.password_hash).not.toBe(before.password_hash);

      await expect(save(admin, 'admin2', { role: 'agent' })).resolves.toEqual({ success: true, id: 'admin2' });
      expect(row('admin2')?.role).toBe('agent');

      await expect(save(admin, 'agent', { role: 'admin' })).resolves.toEqual({ success: true, id: 'agent' });
      expect(row('agent')?.role).toBe('admin');

      await expect(invoke(IPCChannels.Auth.SaveUser, admin, {
        username: 'kollege',
        displayName: 'Kollege',
        role: 'admin',
        passphrase: 'Kollege-Passwort-1',
      })).resolves.toMatchObject({ success: true });

      await expect(invoke(IPCChannels.Auth.DeleteUser, admin, { id: 'admin2' }))
        .resolves.toEqual({ success: true, id: 'admin2' });
      expect(row('admin2')).toBeUndefined();
    });
  });

  describe('ein Owner', () => {
    test('vergibt die Owner-Rolle und verwaltet andere Owner-Konten', async () => {
      const owner = eventFor(LOCAL_OWNER_USER_ID, 'owner');

      await expect(save(owner, 'admin', { role: 'owner' })).resolves.toEqual({ success: true, id: 'admin' });
      expect(row('admin')?.role).toBe('owner');

      const before = row('owner2')!;
      await expect(save(owner, 'owner2', { passphrase: 'Owner2-neu-12345' })).resolves.toEqual({ success: true, id: 'owner2' });
      expect(row('owner2')?.password_hash).not.toBe(before.password_hash);

      await expect(invoke(IPCChannels.Auth.SaveUser, owner, {
        username: 'owner3',
        displayName: 'Owner 3',
        role: 'owner',
        passphrase: 'Owner3-Passwort-1',
      })).resolves.toMatchObject({ success: true });

      await expect(save(owner, 'owner2', { isActive: false })).resolves.toEqual({ success: true, id: 'owner2' });
      await expect(invoke(IPCChannels.Auth.DeleteUser, owner, { id: 'owner2' })).resolves.toEqual({ success: true, id: 'owner2' });
      expect(row('owner2')).toBeUndefined();
    });

    test('darf sich herabstufen, solange ein anderer aktiver Owner bleibt; der letzte bleibt erhalten', async () => {
      await expect(save(eventFor(LOCAL_OWNER_USER_ID, 'owner'), LOCAL_OWNER_USER_ID, { role: 'admin' }))
        .resolves.toEqual({ success: true, id: LOCAL_OWNER_USER_ID });
      expect(row(LOCAL_OWNER_USER_ID)?.role).toBe('admin');

      await expect(save(eventFor('owner2', 'owner'), 'owner2', { role: 'admin' }))
        .resolves.toEqual({ success: false, error: 'Mindestens ein aktiver Eigentümer muss bestehen bleiben' });
      expect(row('owner2')?.role).toBe('owner');
    });
  });
});
