/**
 * Rollen-Grenzen der Desktop-Mail-IPC fuer Einstellungen mit Geheimnissen und
 * Kontoverwaltung. Laeuft ueber den echten registerIpcHandler (Session, Rolle,
 * Schema-Validierung), nur Electron, Konto-ACL und Speicher sind ersetzt.
 */
const mockHandlers = new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>();
const mockSyncInfo = new Map<string, string>();

jest.mock('electron', () => ({
  ipcMain: {
    removeHandler: jest.fn(),
    handle: (channel: string, handler: (event: unknown, ...args: unknown[]) => Promise<unknown>) => {
      mockHandlers.set(channel, handler);
    },
  },
  BrowserWindow: { getAllWindows: () => [] },
  dialog: {},
  shell: {},
  app: { getPath: () => '/tmp', isPackaged: false },
}));

jest.mock('../../electron/auth/auth-store', () => ({
  ...jest.requireActual('../../electron/auth/auth-store'),
  // Konto-ACL erlaubt alles: geprueft wird hier allein die Rollen-Grenze.
  canAccessLocalAccount: jest.fn(() => true),
  canUseSyntheticBootstrapAuthSession: jest.fn(() => false),
}));

jest.mock('../../electron/sqlite-service', () => ({
  ...jest.requireActual('../../electron/sqlite-service'),
  getSyncInfo: (key: string) => mockSyncInfo.get(key) ?? null,
  setSyncInfo: (key: string, value: string) => {
    mockSyncInfo.set(key, value);
  },
}));

jest.mock('../../electron/sync-info-store', () => ({
  readSyncInfo: (key: string) => mockSyncInfo.get(key) ?? null,
  writeSyncInfo: (key: string, value: string) => {
    mockSyncInfo.set(key, value);
  },
}));

import { IPCChannels } from '../../shared/ipc/channels';
import { clearAllSessions, createSession, type SessionRole } from '../../electron/auth/session-store';
import { registerEmailHandlers } from '../../electron/ipc/email';

const quietLogger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };

let nextSenderId = 100;

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

beforeAll(() => {
  registerEmailHandlers({ logger: quietLogger, isDevelopment: false });
});

beforeEach(() => {
  clearAllSessions();
  mockSyncInfo.clear();
  mockSyncInfo.set('email_google_oauth_client_id', 'google-client');
  mockSyncInfo.set('email_google_oauth_client_secret', 'google-geheim');
  mockSyncInfo.set('email_ms_oauth_client_id', 'ms-client');
  mockSyncInfo.set('email_ms_oauth_client_secret', 'ms-geheim');
  mockSyncInfo.set('email_webhook_secret', 'webhook-geheim');
  mockSyncInfo.set('email_max_attachment_mb', '30');
});

describe('OAuth-App- und Webhook-Secrets (E15)', () => {
  const getters = [
    [IPCChannels.Email.GetGoogleOAuthApp, 'google-client', 'google-geheim'],
    [IPCChannels.Email.GetMicrosoftOAuthApp, 'ms-client', 'ms-geheim'],
  ] as const;

  // N-ds-02: Die OAuth-Client-Secrets gingen an jeden angemeldeten Nutzer, auch an Agent und Viewer.
  test.each(getters)('%s liefert Nicht-Admins nur hasSecret', async (channel, clientId) => {
    for (const role of ['agent', 'viewer'] as const) {
      const result = await invoke(channel, eventFor(role));
      expect(result).toEqual({ success: true, clientId, hasSecret: true });
    }
  });

  test.each(getters)('%s liefert Owner und Admin das Secret', async (channel, clientId, clientSecret) => {
    for (const role of ['owner', 'admin'] as const) {
      const result = await invoke(channel, eventFor(role));
      expect(result).toEqual({ success: true, clientId, clientSecret, hasSecret: true });
    }
  });

  test('hasSecret ist false, solange kein Secret gespeichert ist', async () => {
    mockSyncInfo.delete('email_google_oauth_client_secret');
    mockSyncInfo.delete('email_webhook_secret');
    await expect(invoke(IPCChannels.Email.GetGoogleOAuthApp, eventFor('agent')))
      .resolves.toEqual({ success: true, clientId: 'google-client', hasSecret: false });
    await expect(invoke(IPCChannels.Email.GetEmailMiscSettings, eventFor('agent')))
      .resolves.toEqual({ maxAttachmentMb: '30', hasSecret: false });
  });

  // N-ds-02: Das Webhook-Secret der Workflow-Trigger ging an jeden angemeldeten Nutzer.
  test('GetEmailMiscSettings liefert das Webhook-Secret nur an Owner und Admin', async () => {
    await expect(invoke(IPCChannels.Email.GetEmailMiscSettings, eventFor('agent')))
      .resolves.toEqual({ maxAttachmentMb: '30', hasSecret: true });
    await expect(invoke(IPCChannels.Email.GetEmailMiscSettings, eventFor('admin')))
      .resolves.toEqual({ webhookSecret: 'webhook-geheim', maxAttachmentMb: '30', hasSecret: true });
  });

  // N-ds-02: Die Set-Kanaele prueften keine Rolle, jeder Nutzer konnte OAuth-App und Webhook-Secret ueberschreiben.
  test.each([
    [IPCChannels.Email.SetGoogleOAuthApp, { clientId: 'fremd', clientSecret: 'fremd' }],
    [IPCChannels.Email.SetMicrosoftOAuthApp, { clientId: 'fremd', clientSecret: 'fremd' }],
    [IPCChannels.Email.SetEmailMiscSettings, { webhookSecret: 'fremd', maxAttachmentMb: 99 }],
  ] as const)('%s verlangt Owner oder Admin', async (channel, payload) => {
    const before = new Map(mockSyncInfo);
    for (const role of ['agent', 'viewer'] as const) {
      await expect(invoke(channel, eventFor(role), payload)).rejects.toThrow('Keine Berechtigung');
    }
    expect(mockSyncInfo).toEqual(before);

    await expect(invoke(channel, eventFor('admin'), payload)).resolves.toEqual({ success: true });
  });

  test('ein leeres Secret-Feld behaelt das gespeicherte Secret', async () => {
    const admin = eventFor('owner');
    await invoke(IPCChannels.Email.SetGoogleOAuthApp, admin, { clientId: 'google-neu', clientSecret: '' });
    await invoke(IPCChannels.Email.SetMicrosoftOAuthApp, admin, { clientId: 'ms-neu', clientSecret: '  ' });
    await invoke(IPCChannels.Email.SetEmailMiscSettings, admin, { webhookSecret: '', maxAttachmentMb: 40 });

    expect(mockSyncInfo.get('email_google_oauth_client_id')).toBe('google-neu');
    expect(mockSyncInfo.get('email_google_oauth_client_secret')).toBe('google-geheim');
    expect(mockSyncInfo.get('email_ms_oauth_client_id')).toBe('ms-neu');
    expect(mockSyncInfo.get('email_ms_oauth_client_secret')).toBe('ms-geheim');
    expect(mockSyncInfo.get('email_webhook_secret')).toBe('webhook-geheim');
    expect(mockSyncInfo.get('email_max_attachment_mb')).toBe('40');

    await invoke(IPCChannels.Email.SetGoogleOAuthApp, admin, { clientId: 'google-neu', clientSecret: 'google-neu-geheim' });
    expect(mockSyncInfo.get('email_google_oauth_client_secret')).toBe('google-neu-geheim');
  });
});
