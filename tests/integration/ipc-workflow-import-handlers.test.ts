import fs from 'fs';
import { IPCChannels } from '../../shared/ipc/channels';

const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>();

jest.mock('../../electron/ipc/register', () => ({
  registerIpcHandler: jest.fn((channel: string, handler: (...args: unknown[]) => Promise<unknown>) => {
    handlers.set(channel, handler);
    return () => undefined;
  }),
}));

jest.mock('electron', () => ({
  dialog: {
    showOpenDialog: jest.fn(async () => ({ canceled: false, filePaths: ['/tmp/fremder-workflow.json'] })),
    showSaveDialog: jest.fn(),
  },
}));

const storeMocks = {
  getWorkflowById: jest.fn(),
  createWorkflow: jest.fn(() => 99),
  updateWorkflow: jest.fn(),
};
jest.mock('../../electron/email/email-workflow-store', () => storeMocks);

const restartEmailWorkflowCrons = jest.fn();
jest.mock('../../electron/email/email-imap-services', () => ({ restartEmailWorkflowCrons }));

jest.mock('../../electron/workflow/registry', () => ({
  listWorkflowNodeCatalog: jest.fn(() => []),
  ensureBuiltinWorkflowNodes: jest.fn(),
}));
jest.mock('../../electron/workflow/workflow-executor', () => ({
  executeWorkflowNow: jest.fn(),
  testWorkflowOnMessage: jest.fn(),
}));
jest.mock('../../electron/workflow/run-steps', () => ({
  listRecentWorkflowRuns: jest.fn(),
  listWorkflowRunSteps: jest.fn(),
  getWorkflowRunLog: jest.fn(),
}));
jest.mock('../../electron/workflow/templates', () => ({ WORKFLOW_TEMPLATES: [] }));
jest.mock('../../electron/workflow/knowledge-base', () => ({
  listKnowledgeBases: jest.fn(),
  createKnowledgeBase: jest.fn(),
  updateKnowledgeBase: jest.fn(),
  deleteKnowledgeBase: jest.fn(),
  addTextChunk: jest.fn(),
  getKnowledgeBaseDocument: jest.fn(),
  saveKnowledgeBaseDocument: jest.fn(),
  importFileToKnowledgeBase: jest.fn(),
}));
jest.mock('../../electron/workflow/plugins', () => ({
  listPluginManifests: jest.fn(),
  loadWorkflowPlugins: jest.fn(),
}));
jest.mock('../../electron/email/email-imap-move', () => ({
  isImapDeleteOptInEnabled: jest.fn(),
  setImapDeleteOptIn: jest.fn(),
}));
jest.mock('../../electron/sync-info-store', () => ({
  readSyncInfo: jest.fn(),
  writeSyncInfo: jest.fn(),
}));
jest.mock('../../electron/workflow/workflow-versions', () => ({
  listWorkflowVersions: jest.fn(),
  saveWorkflowVersion: jest.fn(),
  getWorkflowVersion: jest.fn(),
}));

const { registerWorkflowHandlers } = require('../../electron/ipc/workflow') as typeof import('../../electron/ipc/workflow');

/** Fremdes Bundle: aktiver Zeitplan-Workflow mit Code-Knoten. */
function foreignBundle(workflow: Record<string, unknown> = {}): string {
  return JSON.stringify({
    version: 1,
    exportedAt: '2026-09-01T00:00:00.000Z',
    workflow: {
      name: 'Hilfreiche Vorlage',
      trigger: 'schedule',
      priority: 1,
      enabled: true,
      definition_json: '{"version":1,"rules":[]}',
      cron_expr: '* * * * *',
      schedule_account_id: null,
      graph_json: {
        version: 1,
        nodes: [
          { id: 't', type: 'trigger', data: { kind: 'schedule' } },
          { id: 'c', type: 'registry', data: { nodeType: 'code.javascript', config: { code: 'result={a:1}' } } },
        ],
        edges: [{ id: 'e', source: 't', target: 'c' }],
      },
      ...workflow,
    },
  });
}

describe('workflow import IPC handlers', () => {
  let readFileSpy: jest.SpyInstance;

  beforeEach(() => {
    handlers.clear();
    jest.clearAllMocks();
    readFileSpy = jest.spyOn(fs.promises, 'readFile');
    registerWorkflowHandlers({ logger: console });
  });

  afterEach(() => {
    readFileSpy.mockRestore();
  });

  // F-A9-13: Der Import übernahm 'enabled' aus der Datei; ein fremder Workflow
  // (Code-Knoten, Weiterleitung) lief sofort, bevor der Nutzer ihn prüfen konnte.
  test('ImportWorkflowBundleFromFile always creates the workflow disabled', async () => {
    readFileSpy.mockResolvedValueOnce(foreignBundle());

    const handler = handlers.get(IPCChannels.Email.ImportWorkflowBundleFromFile)!;
    await expect(handler({})).resolves.toMatchObject({ success: true, id: 99 });

    expect(storeMocks.createWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Hilfreiche Vorlage (Import)', enabled: false }),
    );
  });

  test('ImportWorkflowBundleFromFile keeps a bundle without enabled field disabled', async () => {
    readFileSpy.mockResolvedValueOnce(foreignBundle({ enabled: undefined }));

    const handler = handlers.get(IPCChannels.Email.ImportWorkflowBundleFromFile)!;
    await handler({});

    expect(storeMocks.createWorkflow).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }));
  });

  test('ImportWorkflowBundle (JSON payload) always creates the workflow disabled', async () => {
    const handler = handlers.get(IPCChannels.Email.ImportWorkflowBundle)!;
    await expect(handler({}, { json: foreignBundle() })).resolves.toMatchObject({ success: true, id: 99 });

    expect(storeMocks.createWorkflow).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }));
  });
});
