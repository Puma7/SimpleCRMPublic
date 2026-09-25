/**
 * Rollen-Grenze der Desktop-Workflow-IPC: Anlegen, Aendern, Loeschen,
 * Importieren, Versionen, Backfill und Automation-Einstellungen nur fuer
 * Owner/Admin (wie workflow:execute-now). Laeuft ueber den echten
 * registerIpcHandler (Session, Rolle, Schema-Validierung); Electron,
 * Konto-ACL, Workflow-Speicher und Cron-Neustart sind ersetzt.
 */
import fs from 'fs';

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
  dialog: {
    showOpenDialog: jest.fn(async () => ({ canceled: false, filePaths: ['/tmp/workflow.json'] })),
    showSaveDialog: jest.fn(),
  },
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
  writeSyncInfo: jest.fn((key: string, value: string) => {
    mockSyncInfo.set(key, value);
  }),
}));

// Ohne requireActual: email-store haengt zirkulaer an email-message-features.
jest.mock('../../electron/email/email-store', () => ({
  listMessageIdsForWorkflowBackfill: jest.fn(() => []),
}));

const storedWorkflow = {
  id: 42,
  name: 'Eingang',
  trigger: 'inbound',
  priority: 100,
  enabled: 0,
  definition_json: '{"version":1,"rules":[]}',
  graph_json: null,
  cron_expr: null,
  schedule_account_id: null,
};

jest.mock('../../electron/email/email-workflow-store', () => ({
  ...jest.requireActual('../../electron/email/email-workflow-store'),
  listAllWorkflows: jest.fn(() => [storedWorkflow]),
  getWorkflowById: jest.fn(() => storedWorkflow),
  createWorkflow: jest.fn(() => 42),
  updateWorkflow: jest.fn(),
  deleteWorkflow: jest.fn(),
  clearInboundWorkflowAppliedForMessage: jest.fn(),
}));

jest.mock('../../electron/email/email-imap-services', () => ({
  ...jest.requireActual('../../electron/email/email-imap-services'),
  restartEmailWorkflowCrons: jest.fn(),
}));

jest.mock('../../electron/email/email-workflow-engine', () => ({
  ...jest.requireActual('../../electron/email/email-workflow-engine'),
  runInboundWorkflowsForMessage: jest.fn(async () => undefined),
}));

jest.mock('../../electron/email/email-imap-move', () => ({
  ...jest.requireActual('../../electron/email/email-imap-move'),
  isImapDeleteOptInEnabled: jest.fn(() => false),
  setImapDeleteOptIn: jest.fn(),
}));

jest.mock('../../electron/workflow/auto-reply-settings', () => ({
  loadAutoReplySettings: jest.fn(() => ({ enabled: false, maxPerSenderPerDay: 1 })),
  saveAutoReplySettings: jest.fn(),
}));

jest.mock('../../electron/workflow/workflow-versions', () => ({
  listWorkflowVersions: jest.fn(() => [{ id: 3, workflow_id: 42, label: 'v1', created_at: '' }]),
  saveWorkflowVersion: jest.fn(() => 3),
  getWorkflowVersion: jest.fn(() => ({
    id: 3,
    workflow_id: 42,
    graph_json: null,
    definition_json: '{"version":1,"rules":[]}',
  })),
}));

import { dialog } from 'electron';
import { IPCChannels } from '../../shared/ipc/channels';
import { listMessageIdsForWorkflowBackfill } from '../../electron/email/email-store';
import {
  clearInboundWorkflowAppliedForMessage,
  createWorkflow,
  deleteWorkflow,
  updateWorkflow,
} from '../../electron/email/email-workflow-store';
import { restartEmailWorkflowCrons } from '../../electron/email/email-imap-services';
import { runInboundWorkflowsForMessage } from '../../electron/email/email-workflow-engine';
import { setImapDeleteOptIn } from '../../electron/email/email-imap-move';
import { writeSyncInfo } from '../../electron/sync-info-store';
import { saveWorkflowVersion } from '../../electron/workflow/workflow-versions';
import { clearAllSessions, createSession, type SessionRole } from '../../electron/auth/session-store';
import { registerEmailHandlers } from '../../electron/ipc/email';
import { registerWorkflowHandlers } from '../../electron/ipc/workflow';

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

/** Aktiver Zeitplan-Workflow mit Code-Knoten — genau das, was ein Agent nicht anlegen darf. */
const codeGraph = JSON.stringify({
  version: 1,
  nodes: [
    { id: 't', type: 'trigger', data: { kind: 'schedule' } },
    { id: 'c', type: 'registry', data: { nodeType: 'code.javascript', config: { code: 'result={a:1}' } } },
  ],
  edges: [{ id: 'e', source: 't', target: 'c' }],
});

const bundleJson = JSON.stringify({
  version: 1,
  exportedAt: '2026-09-01T00:00:00.000Z',
  workflow: {
    name: 'Vorlage',
    trigger: 'schedule',
    priority: 1,
    enabled: true,
    definition_json: '{"version":1,"rules":[]}',
    cron_expr: '* * * * *',
    schedule_account_id: null,
    graph_json: JSON.parse(codeGraph),
  },
});

const authoringChannels = [
  [IPCChannels.Email.CreateWorkflow, {
    name: 'Weiterleitung',
    trigger: 'schedule',
    definitionJson: '{"version":1,"rules":[]}',
    graphJson: codeGraph,
    cronExpr: '* * * * *',
    enabled: true,
  }],
  [IPCChannels.Email.UpdateWorkflow, { id: 42, enabled: true, graphJson: codeGraph }],
  [IPCChannels.Email.DeleteWorkflow, 42],
  [IPCChannels.Email.BackfillInboundWorkflows, undefined],
  [IPCChannels.Email.ImportWorkflowBundle, { json: bundleJson }],
  [IPCChannels.Email.ImportWorkflowBundleFromFile, undefined],
  [IPCChannels.Email.SaveWorkflowVersion, { workflowId: 42 }],
  [IPCChannels.Email.RestoreWorkflowVersion, { versionId: 3 }],
  [IPCChannels.Email.SetWorkflowAutomationSettings, { imapDeleteOptIn: true, httpAllowlist: 'evil.example' }],
] as const;

function expectNothingTouched(): void {
  expect(createWorkflow).not.toHaveBeenCalled();
  expect(updateWorkflow).not.toHaveBeenCalled();
  expect(deleteWorkflow).not.toHaveBeenCalled();
  expect(restartEmailWorkflowCrons).not.toHaveBeenCalled();
  expect(listMessageIdsForWorkflowBackfill).not.toHaveBeenCalled();
  expect(clearInboundWorkflowAppliedForMessage).not.toHaveBeenCalled();
  expect(runInboundWorkflowsForMessage).not.toHaveBeenCalled();
  expect(saveWorkflowVersion).not.toHaveBeenCalled();
  expect(setImapDeleteOptIn).not.toHaveBeenCalled();
  expect(writeSyncInfo).not.toHaveBeenCalled();
  expect(dialog.showOpenDialog).not.toHaveBeenCalled();
}

let readFileSpy: jest.SpyInstance;

beforeAll(() => {
  registerEmailHandlers({ logger: quietLogger, isDevelopment: false });
  registerWorkflowHandlers({ logger: quietLogger });
});

beforeEach(() => {
  clearAllSessions();
  mockSyncInfo.clear();
  jest.clearAllMocks();
  readFileSpy = jest.spyOn(fs.promises, 'readFile').mockResolvedValue(bundleJson);
  jest.mocked(listMessageIdsForWorkflowBackfill)
    .mockReset()
    .mockReturnValueOnce([5])
    .mockReturnValue([]);
});

afterEach(() => {
  readFileSpy.mockRestore();
});

describe('Desktop-Workflow-Autorenkanaele (G1)', () => {
  // C-A1: Agent/Viewer legten per IPC einen aktiven Cron-/Inbound-Workflow mit Code-Knoten an, den Cron/Inbound im Main-Prozess ausfuehrten.
  // C-A37: Ebenso eine globale Weiterleitungsregel ueber alle Konten; Import, Versionen, Backfill und Automation-Einstellungen prueften keine Rolle.
  test.each(authoringChannels)('%s lehnt Agent und Viewer ab, ohne Speicher oder Cron anzufassen', async (channel, payload) => {
    for (const role of ['agent', 'viewer'] as const) {
      await expect(invoke(channel, eventFor(role), payload)).rejects.toThrow('Keine Berechtigung');
    }
    expectNothingTouched();
    expect(readFileSpy).not.toHaveBeenCalled();
    expect(mockSyncInfo.size).toBe(0);
  });

  test.each(authoringChannels)('%s bleibt fuer Owner und Admin offen', async (channel, payload) => {
    for (const role of ['owner', 'admin'] as const) {
      jest.mocked(listMessageIdsForWorkflowBackfill)
        .mockReset()
        .mockReturnValueOnce([5])
        .mockReturnValue([]);
      await expect(invoke(channel, eventFor(role), payload)).resolves.toMatchObject({ success: true });
    }
  });

  test('Owner/Admin-Aufrufe erreichen Speicher und Cron-Neustart', async () => {
    const admin = eventFor('admin');
    await invoke(IPCChannels.Email.CreateWorkflow, admin, authoringChannels[0][1]);
    await invoke(IPCChannels.Email.UpdateWorkflow, admin, authoringChannels[1][1]);
    await invoke(IPCChannels.Email.DeleteWorkflow, admin, 42);
    await invoke(IPCChannels.Email.BackfillInboundWorkflows, admin);
    await invoke(IPCChannels.Email.RestoreWorkflowVersion, admin, { versionId: 3 });
    await invoke(IPCChannels.Email.SetWorkflowAutomationSettings, admin, { imapDeleteOptIn: true });

    expect(createWorkflow).toHaveBeenCalledWith(expect.objectContaining({ name: 'Weiterleitung', enabled: true }));
    expect(updateWorkflow).toHaveBeenCalledWith(42, expect.objectContaining({ enabled: true }));
    expect(deleteWorkflow).toHaveBeenCalledWith(42);
    expect(runInboundWorkflowsForMessage).toHaveBeenCalledWith(5);
    expect(setImapDeleteOptIn).toHaveBeenCalledWith(true);
    expect(restartEmailWorkflowCrons).toHaveBeenCalledTimes(4);
  });

  test('lesende Workflow-Kanaele bleiben fuer alle Rollen offen', async () => {
    for (const role of ['agent', 'viewer'] as const) {
      const event = eventFor(role);
      await expect(invoke(IPCChannels.Email.ListWorkflows, event)).resolves.toEqual([storedWorkflow]);
      await expect(invoke(IPCChannels.Email.GetWorkflow, event, 42)).resolves.toEqual(storedWorkflow);
      await expect(invoke(IPCChannels.Email.ListWorkflowVersions, event, 42)).resolves.toHaveLength(1);
      await expect(invoke(IPCChannels.Email.GetWorkflowAutomationSettings, event))
        .resolves.toMatchObject({ imapDeleteOptIn: false, httpAllowlist: '' });
      await expect(invoke(IPCChannels.Email.ExportWorkflowBundle, event, 42))
        .resolves.toMatchObject({ success: true });
    }
  });
});
