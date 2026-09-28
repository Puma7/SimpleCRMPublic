import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const mockInvoke = jest.fn();
jest.mock('@/services/transport', () => ({
  invokeRenderer: (...args: unknown[]) => mockInvoke(...args),
  // Desktop-Modus: Rechte kommen aus der lokalen Rolle, nicht aus Capabilities.
  getRendererTransport: () => ({ kind: 'ipc' }),
  isWorkflowListRefreshEvent: () => false,
  isAutomationApiKeyRefreshEvent: () => false,
  subscribeServerEvents: () => ({ unsubscribe: jest.fn() }),
}));
jest.mock('@/components/email/types', () => ({
  ...jest.requireActual('@/components/email/types'),
  hasLocalIpc: () => true,
  // Automation.GetSettings verlangt per IPC Owner/Admin; fuer das Gate hier ohne Belang.
  invokeIpc: jest.fn(async () => {
    throw new Error('Keine Berechtigung');
  }),
}));
// Der Editor-Kopf enthaelt einen Router-Link; ohne Router-Kontext genuegt ein Anker.
jest.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children?: React.ReactNode }) => <a>{children}</a>,
}));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn(), warning: jest.fn() } }));
jest.mock('@/components/email/workflow/workflow-run-detail-dialog', () => ({ WorkflowRunDetailDialog: mockStub('runDialog') }));
jest.mock('@/components/email/use-has-electron', () => ({ useHasElectron: () => true }));
// Der Editor zieht Monaco (Web-Worker-Imports) nach — im jsdom-Lauf nicht ladbar.
// Die Kind-Komponenten werden durch Stubs ersetzt, die ihre Props festhalten.
const mockChildProps: Record<string, Record<string, unknown>> = {};
function mockStub(name: string) {
  return (props: Record<string, unknown>) => {
    mockChildProps[name] = props;
    return null;
  };
}
jest.mock('@/components/email/workflow/workflow-canvas', () => ({ WorkflowCanvas: mockStub('canvas') }));
jest.mock('@/components/email/workflow/node-properties-panel', () => ({ NodePropertiesPanel: () => null }));
jest.mock('@/components/email/workflow/json-dev-drawer', () => ({ JsonDevDrawer: mockStub('json') }));
jest.mock('@/components/email/workflow/workflow-templates-dialog', () => ({ WorkflowTemplatesDialog: () => null }));
jest.mock('@/components/email/workflow/workflow-reference-dialog', () => ({ WorkflowReferenceDialog: () => null }));
jest.mock('@/components/email/workflow/workflow-versions-dialog', () => ({ WorkflowVersionsDialog: mockStub('versions') }));
jest.mock('@/components/email/workflow/workflow-run-history', () => ({ WorkflowRunHistory: () => null }));
jest.mock('@/components/email/workflow/node-palette', () => ({ NodePalette: mockStub('palette') }));

let mockRole = 'owner';
jest.mock('@/components/auth/auth-context', () => ({
  useAuth: () => ({
    user: { id: 'u1', role: mockRole },
    // Desktop kennt keine Capabilities; ein true hier darf nichts freischalten.
    hasCapability: () => true,
    canViewWorkflows: true,
    capabilitiesReady: true,
  }),
}));

// jsdom kennt weder ResizeObserver noch matchMedia — beides braucht das
// Panel-Layout der Shell.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;
if (!window.matchMedia) {
  (window as unknown as { matchMedia: unknown }).matchMedia = () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  });
}

import { WorkflowShell } from '@/components/email/workflow/workflow-shell';
import { IPCChannels } from '@shared/ipc/channels';

/**
 * Plan 047: Testlauf aus dem Editor – Mail per ID (Rückfall), Ergebnis im
 * Lauf-Dialog, „KI wirklich fragen“ nur bei einer KI-Entscheidung im Graph.
 */
const decideGraph = {
  version: 1,
  nodes: [
    { id: 'trigger-1', type: 'trigger', position: { x: 0, y: 0 }, data: { kind: 'inbound' } },
    {
      id: 'decide',
      type: 'registry',
      position: { x: 0, y: 100 },
      data: { nodeType: 'ai.decide', config: { question: 'Rückgabe?', threshold: 80 } },
    },
  ],
  edges: [{ id: 'edge-1', source: 'trigger-1', target: 'decide' }],
};

function workflowRow(graph: unknown) {
  return {
    id: 7,
    name: 'Rückgaben',
    trigger: 'inbound',
    enabled: 0,
    priority: 100,
    definition_json: '{"version":1,"rules":[]}',
    graph_json: graph === null ? null : JSON.stringify(graph),
    cron_expr: null,
    schedule_account_id: null,
    created_at: '',
    updated_at: '',
  };
}

let row = workflowRow(decideGraph);
let testResult: unknown = { success: true, runId: 55, log: ['dry_run:ai.decide'] };

beforeEach(() => {
  for (const key of Object.keys(mockChildProps)) delete mockChildProps[key];
  row = workflowRow(decideGraph);
  testResult = { success: true, runId: 55, log: ['dry_run:ai.decide'] };
  mockInvoke.mockReset();
  mockInvoke.mockImplementation(async (channel: string) => {
    if (channel === IPCChannels.Email.ListWorkflows) return [row];
    if (channel === IPCChannels.Email.GetWorkflow) return row;
    if (channel === IPCChannels.Email.TestWorkflowOnMessage) return testResult;
    if (channel === IPCChannels.Email.GetWorkflowAutomationSettings) {
      return { imapDeleteOptIn: false, httpAllowlist: '', autoReplyEnabled: false, autoReplyMaxPerSenderPerDay: 1 };
    }
    if (channel === IPCChannels.Email.GetEmailMiscSettings) return { maxAttachmentMb: '25', hasSecret: false };
    return [];
  });
});

async function openWorkflowWithMessage(): Promise<void> {
  render(<WorkflowShell />);
  fireEvent.click(await screen.findByText('Rückgaben'));
  fireEvent.click(await screen.findByRole('button', { name: /Erweitert/ }));
  await screen.findByText('Test-Mail');
  fireEvent.change(screen.getByLabelText('Test-Mail'), { target: { value: '__manual__' } });
  fireEvent.change(screen.getByPlaceholderText('aus Details-Panel'), { target: { value: '12' } });
}

test('Testlauf öffnet den Lauf-Dialog; „KI wirklich fragen“ geht nur auf Wunsch mit', async () => {
  await openWorkflowWithMessage();
  const realAi = await screen.findByRole('checkbox', { name: /KI wirklich fragen/ });
  expect(realAi).not.toBeChecked();
  expect(screen.getByText('Kostet KI-Tokens; es wird trotzdem nichts gesendet oder verändert.')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Testlauf' }));
  await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith(
    IPCChannels.Email.TestWorkflowOnMessage,
    { workflowId: 7, messageId: 12, dryRun: true },
  ));
  await waitFor(() => expect(mockChildProps.runDialog).toMatchObject({
    runId: 55,
    open: true,
    title: 'Testlauf – Rückgaben',
  }));

  fireEvent.click(realAi);
  fireEvent.click(screen.getByRole('button', { name: 'Testlauf' }));
  await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith(
    IPCChannels.Email.TestWorkflowOnMessage,
    { workflowId: 7, messageId: 12, dryRun: true, realAi: true },
  ));
});

test('Fehler im Testlauf: Meldung statt Dialog', async () => {
  const { toast } = jest.requireMock('sonner') as { toast: { error: jest.Mock } };
  toast.error.mockReset();
  testResult = { success: false, error: 'Nachricht nicht gefunden' };
  await openWorkflowWithMessage();
  fireEvent.click(screen.getByRole('button', { name: 'Testlauf' }));
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Nachricht nicht gefunden'));
  expect(mockChildProps.runDialog).toBeUndefined();
});

test('ohne KI-Entscheidung im Graph kein „KI wirklich fragen“', async () => {
  row = workflowRow({
    version: 1,
    nodes: [{ id: 'trigger-1', type: 'trigger', position: { x: 0, y: 0 }, data: { kind: 'inbound' } }],
    edges: [],
  });
  await openWorkflowWithMessage();
  expect(screen.queryByRole('checkbox', { name: /KI wirklich fragen/ })).not.toBeInTheDocument();
});

// Gatekeeper (Plan 047): Mit „KI wirklich fragen“ dauert ein Testlauf Sekunden
// und kostet Tokens. Solange er läuft, ist der Knopf gesperrt – ein zweiter
// Klick startet keinen zweiten (kostenpflichtigen) Aufruf.
test('Testlauf sperrt den Knopf, solange der Aufruf läuft', async () => {
  let finish: (value: unknown) => void = () => undefined;
  const pending = new Promise((resolve) => {
    finish = resolve;
  });
  mockInvoke.mockImplementation(async (channel: string) => {
    if (channel === IPCChannels.Email.ListWorkflows) return [row];
    if (channel === IPCChannels.Email.GetWorkflow) return row;
    if (channel === IPCChannels.Email.TestWorkflowOnMessage) return pending;
    if (channel === IPCChannels.Email.GetWorkflowAutomationSettings) {
      return { imapDeleteOptIn: false, httpAllowlist: '', autoReplyEnabled: false, autoReplyMaxPerSenderPerDay: 1 };
    }
    if (channel === IPCChannels.Email.GetEmailMiscSettings) return { maxAttachmentMb: '25', hasSecret: false };
    return [];
  });
  await openWorkflowWithMessage();
  const button = screen.getByRole('button', { name: 'Testlauf' });
  fireEvent.click(button);
  fireEvent.click(button);
  const running = await screen.findByRole('button', { name: /Testlauf läuft/ });
  expect(running).toBeDisabled();
  fireEvent.click(running);
  const testCalls = () => mockInvoke.mock.calls.filter(([channel]) => channel === IPCChannels.Email.TestWorkflowOnMessage);
  expect(testCalls()).toHaveLength(1);

  finish({ success: true, runId: 56, log: [] });
  const again = await screen.findByRole('button', { name: 'Testlauf' });
  await waitFor(() => expect(again).not.toBeDisabled());
  expect(testCalls()).toHaveLength(1);
});
