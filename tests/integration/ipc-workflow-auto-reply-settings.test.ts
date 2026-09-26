/**
 * Round-trip der Auto-Antwort-Einstellungen ueber die echten Desktop-Handler
 * workflow:get/set-automation-settings (registerIpcHandler inkl. Zod-Schema)
 * und die echte auto-reply-settings-Ablage. Nur Electron und der
 * sync_info-Speicher sind ersetzt.
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

jest.mock('../../electron/email/email-imap-move', () => ({
  ...jest.requireActual('../../electron/email/email-imap-move'),
  isImapDeleteOptInEnabled: jest.fn(() => false),
  setImapDeleteOptIn: jest.fn(),
}));

import { IPCChannels } from '../../shared/ipc/channels';
import { clearAllSessions, createSession } from '../../electron/auth/session-store';
import { registerWorkflowHandlers } from '../../electron/ipc/workflow';

const quietLogger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };

let nextSenderId = 500;

function ownerEvent() {
  const id = nextSenderId++;
  createSession(id, { id: 'user-owner', username: 'owner', displayName: 'owner', role: 'owner', workspaceId: 'w' });
  return { sender: { id } };
}

function invoke(channel: string, event: unknown, payload?: unknown): Promise<any> {
  const handler = mockHandlers.get(channel);
  if (!handler) throw new Error(`kein Handler fuer ${channel}`);
  return payload === undefined ? handler(event) : handler(event, payload);
}

beforeAll(() => {
  registerWorkflowHandlers({ logger: quietLogger });
});

beforeEach(() => {
  clearAllSessions();
  mockSyncInfo.clear();
});

describe('Auto-Antwort-Einstellungen der Workflow-Automation (Desktop-IPC)', () => {
  // N-cx-01: Das Zod-Schema kannte autoReplyEnabled/autoReplyMaxPerSenderPerDay nicht und entfernte sie beim Speichern und Lesen.
  test('Speichern und Lesen ueberstehen die Schema-Validierung', async () => {
    const owner = ownerEvent();
    await expect(invoke(IPCChannels.Email.SetWorkflowAutomationSettings, owner, {
      autoReplyEnabled: true,
      autoReplyMaxPerSenderPerDay: 3,
    })).resolves.toEqual({ success: true });

    expect(mockSyncInfo.get('auto_reply_enabled')).toBe('1');
    expect(mockSyncInfo.get('auto_reply_max_per_sender_per_day')).toBe('3');

    await expect(invoke(IPCChannels.Email.GetWorkflowAutomationSettings, owner)).resolves.toMatchObject({
      autoReplyEnabled: true,
      autoReplyMaxPerSenderPerDay: 3,
    });

    await invoke(IPCChannels.Email.SetWorkflowAutomationSettings, owner, { autoReplyEnabled: false });
    await expect(invoke(IPCChannels.Email.GetWorkflowAutomationSettings, owner)).resolves.toMatchObject({
      autoReplyEnabled: false,
      autoReplyMaxPerSenderPerDay: 3,
    });
  });

  test('das Tageslimit gilt wie auf dem Server nur als Ganzzahl von 1 bis 50', async () => {
    const owner = ownerEvent();
    for (const autoReplyMaxPerSenderPerDay of [0, 51, 2.5]) {
      await expect(invoke(IPCChannels.Email.SetWorkflowAutomationSettings, owner, { autoReplyMaxPerSenderPerDay }))
        .rejects.toThrow();
    }
    await expect(invoke(IPCChannels.Email.SetWorkflowAutomationSettings, owner, { autoReplyEnabled: 'ja' }))
      .rejects.toThrow();
    expect(mockSyncInfo.has('auto_reply_max_per_sender_per_day')).toBe(false);
    expect(mockSyncInfo.has('auto_reply_enabled')).toBe(false);
  });
});
