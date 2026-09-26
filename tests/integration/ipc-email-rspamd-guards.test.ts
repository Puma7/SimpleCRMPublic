/**
 * @jest-environment node
 */
/**
 * Desktop-Paritaet zu settings-routes.ts (handleMailSecuritySettings,
 * handleRspamdConnectionTest): Die Rspamd-URL aendern und die Verbindung testen
 * duerfen nur Owner und Admin. Laeuft ueber den echten registerIpcHandler
 * (Session, Rolle, Schema) und eine In-Memory-Datenbank; ersetzt ist nur Electron.
 */
const mockHandlers = new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>();

jest.mock('electron', () => ({
  app: {
    getPath: () => `${process.cwd()}/.tmp-tests/simplecrm-rspamd-guards`,
    getName: () => 'simplecrm-test',
    getVersion: () => '0.0.0-test',
    isPackaged: false,
  },
  ipcMain: {
    handle: (channel: string, handler: (event: unknown, ...args: unknown[]) => Promise<unknown>) => {
      mockHandlers.set(channel, handler);
    },
    removeHandler: (channel: string) => {
      mockHandlers.delete(channel);
    },
  },
  BrowserWindow: { getAllWindows: () => [] },
  dialog: {},
  shell: {},
}));

jest.mock('../../electron/auth/auth-store', () => ({
  ...jest.requireActual('../../electron/auth/auth-store'),
  canUseSyntheticBootstrapAuthSession: () => false,
}));

import Database from 'better-sqlite3';
import { IPCChannels } from '../../shared/ipc/channels';
import { bootstrapFreshDatabaseSchema, closeDatabase } from '../../electron/sqlite-service';
import {
  getMailSecuritySettings,
  saveMailSecuritySettings,
} from '../../electron/email/mail-security-settings';
import { clearAllSessions, createSession, type SessionRole } from '../../electron/auth/session-store';
import { registerEmailHandlers } from '../../electron/ipc/email';

const quietLogger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
let nextSenderId = 500;

function eventFor(role: SessionRole) {
  const id = nextSenderId++;
  createSession(id, { id: `user-${role}`, username: role, displayName: role, role, workspaceId: 'w' });
  return { sender: { id } };
}

function invoke(channel: string, event: unknown, payload?: unknown): Promise<any> {
  const handler = mockHandlers.get(channel);
  if (!handler) throw new Error(`kein Handler fuer ${channel}`);
  return payload === undefined ? handler(event) : handler(event, payload);
}

describe('Rspamd-URL und -Verbindungstest (C-A51)', () => {
  let db: Database.Database;
  let dispose: () => void;
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    db = new Database(':memory:');
    bootstrapFreshDatabaseSchema(db, { keepDbAssigned: true });
    saveMailSecuritySettings({ rspamdEnabled: false, rspamdUrl: 'http://127.0.0.1:11333', rspamdTimeoutMs: 8000 });
    clearAllSessions();
    dispose = registerEmailHandlers({ logger: quietLogger, isDevelopment: false });
    fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    dispose();
    closeDatabase();
  });

  // C-A51: Jede Rolle konnte die Rspamd-URL auf einen eigenen Host setzen; danach ging jede eingehende Mail aller Konten roh dorthin.
  test('Agent und Viewer duerfen die Rspamd-URL nicht aendern, nichts wird gespeichert', async () => {
    const before = getMailSecuritySettings();
    for (const role of ['agent', 'viewer'] as const) {
      await expect(invoke(IPCChannels.Email.SetMailSecuritySettings, eventFor(role), {
        ...before,
        rspamdEnabled: true,
        rspamdUrl: 'https://collector.example',
        spamReviewThreshold: 30,
      })).rejects.toThrow('Die Rspamd-URL darf nur von Administratoren geändert werden');
    }

    expect(getMailSecuritySettings()).toEqual(before);
  });

  test('Agent speichert die uebrigen Felder, wenn die geladene URL unveraendert mitkommt', async () => {
    const loaded = getMailSecuritySettings();

    await expect(invoke(IPCChannels.Email.SetMailSecuritySettings, eventFor('agent'), {
      ...loaded,
      rspamdUrl: ` ${loaded.rspamdUrl}/ `,
      rspamdEnabled: true,
      spamReviewThreshold: 30,
    })).resolves.toEqual({ success: true });
    await expect(invoke(IPCChannels.Email.SetMailSecuritySettings, eventFor('viewer'), {
      senderBlacklist: 'spam.example',
    })).resolves.toEqual({ success: true });

    expect(getMailSecuritySettings()).toMatchObject({
      rspamdUrl: 'http://127.0.0.1:11333',
      rspamdEnabled: true,
      spamReviewThreshold: 30,
      senderBlacklist: 'spam.example',
    });
  });

  test('Owner und Admin duerfen die Rspamd-URL aendern', async () => {
    for (const [role, url] of [['owner', 'http://rspamd.intern:11333'], ['admin', 'https://rspamd.example']] as const) {
      await expect(invoke(IPCChannels.Email.SetMailSecuritySettings, eventFor(role), { rspamdUrl: url }))
        .resolves.toEqual({ success: true });
      expect(getMailSecuritySettings().rspamdUrl).toBe(url);
    }
  });

  // C-A51: Der Rspamd-Verbindungstest holte fuer jede Rolle eine frei waehlbare URL ab; auf dem Server ist er Admins vorbehalten.
  test('TestRspamdConnection ist nur fuer Owner und Admin', async () => {
    for (const role of ['agent', 'viewer'] as const) {
      await expect(invoke(IPCChannels.Email.TestRspamdConnection, eventFor(role), {
        rspamdUrl: 'http://169.254.169.254',
      })).rejects.toThrow('Keine Berechtigung');
    }
    expect(fetchSpy).not.toHaveBeenCalled();

    for (const role of ['owner', 'admin'] as const) {
      await expect(invoke(IPCChannels.Email.TestRspamdConnection, eventFor(role), {}))
        .resolves.toEqual({ success: true, message: 'Rspamd erreichbar (http://127.0.0.1:11333)' });
    }
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(String(fetchSpy.mock.calls[0]![0])).toBe('http://127.0.0.1:11333/stat');
  });
});
