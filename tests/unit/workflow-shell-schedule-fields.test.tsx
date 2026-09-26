import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const mockInvoke = jest.fn();
let mockTransportKind: 'http' | 'ipc' = 'http';
jest.mock('@/services/transport', () => ({
  invokeRenderer: (...args: unknown[]) => mockInvoke(...args),
  getRendererTransport: () => ({ kind: mockTransportKind }),
  isWorkflowListRefreshEvent: () => false,
  subscribeServerEvents: () => ({ unsubscribe: jest.fn() }),
}));
// Der Editor-Kopf enthaelt einen Router-Link; ohne Router-Kontext genuegt ein Anker.
jest.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children?: React.ReactNode }) => <a>{children}</a>,
}));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn(), warning: jest.fn() } }));
jest.mock('@/components/email/workflow/workflow-canvas', () => ({ WorkflowCanvas: () => null }));
jest.mock('@/components/email/use-has-electron', () => ({ useHasElectron: () => false }));
// Der Editor zieht Monaco (Web-Worker-Imports) nach — im jsdom-Lauf nicht ladbar
// und fuer dieses Gate ohne Belang.
jest.mock('@/components/email/workflow/node-properties-panel', () => ({ NodePropertiesPanel: () => null }));
jest.mock('@/components/email/workflow/json-dev-drawer', () => ({ JsonDevDrawer: () => null }));
jest.mock('@/components/email/workflow/workflow-templates-dialog', () => ({ WorkflowTemplatesDialog: () => null }));
jest.mock('@/components/email/workflow/workflow-reference-dialog', () => ({ WorkflowReferenceDialog: () => null }));
jest.mock('@/components/email/workflow/workflow-versions-dialog', () => ({ WorkflowVersionsDialog: () => null }));
jest.mock('@/components/email/workflow/workflow-run-history', () => ({ WorkflowRunHistory: () => null }));
jest.mock('@/components/email/workflow/node-palette', () => ({ NodePalette: () => null }));

let mockCanView = true;
let mockReady = true;
let mockRole = 'user';
jest.mock('@/components/auth/auth-context', () => ({
  useAuth: () => ({
    user: { id: 'u1', role: mockRole },
    hasCapability: () => true,
    canViewWorkflows: mockCanView,
    capabilitiesReady: mockReady,
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

import { toast } from 'sonner';
import { WorkflowShell } from '@/components/email/workflow/workflow-shell';
import { IPCChannels } from '@shared/ipc/channels';

const row = {
  id: 7,
  name: 'Eingang sortieren',
  trigger: 'inbound',
  enabled: 1,
  priority: 100,
  definition_json: '{"version":1,"rules":[]}',
  graph_json: null,
  cron_expr: null,
  schedule_account_id: null,
  created_at: '',
  updated_at: '',
};

const scheduleRow = {
  ...row,
  id: 8,
  name: 'Morgens abholen',
  trigger: 'schedule',
  graph_json: JSON.stringify({
    version: 1,
    nodes: [{ id: 't1', type: 'trigger', data: { kind: 'schedule' } }],
    edges: [],
  }),
  cron_expr: '0 6 * * 1-5',
};

async function openAdvanced(name = 'Eingang sortieren'): Promise<void> {
  render(<WorkflowShell />);
  fireEvent.click(await screen.findByText(name));
  fireEvent.click(await screen.findByRole('button', { name: /Erweitert/ }));
  await screen.findByText('Test-Nachricht-ID');
}

// F-A9-01 (E30): Im Server-Modus war das Cron-Feld sichtbar, obwohl der Server
// keinen Zeitplan-Trigger ausloeste; ein eingetragener Zeitplan lief nie.
// TA-P4: Seit dem Server-Taktgeber gilt der Zeitplan in beiden Editionen —
// das Feld ist im Server-Modus wieder da, geprueft wie auf dem Server.
describe('workflow shell schedule fields', () => {
  let rows: Array<typeof row>;
  beforeEach(() => {
    rows = [row, scheduleRow];
    mockRole = 'user';
    mockInvoke.mockReset();
    (toast.error as jest.Mock).mockReset();
    mockInvoke.mockImplementation(async (channel: string, payload?: unknown) => {
      if (channel === IPCChannels.Email.ListWorkflows) return rows;
      if (channel === IPCChannels.Email.GetWorkflow) return rows.find((entry) => entry.id === payload) ?? row;
      if (channel === IPCChannels.Email.GetWorkflowAutomationSettings) {
        return { imapDeleteOptIn: false, httpAllowlist: '', autoReplyEnabled: false, scheduleTimezone: 'America/New_York' };
      }
      return [];
    });
  });

  test('shows cron and schedule account in server mode', async () => {
    mockTransportKind = 'http';
    await openAdvanced();
    expect(screen.getByText('Cron (Zeitplan)')).toBeInTheDocument();
    expect(screen.getByText('Geplantes Konto')).toBeInTheDocument();
    // Kein Zeitplan-Workflow: kein Hinweis auf die naechste Ausfuehrung.
    expect(screen.queryByTestId('workflow-schedule-hint')).not.toBeInTheDocument();
  });

  test('keeps cron and schedule account on the desktop', async () => {
    mockTransportKind = 'ipc';
    await openAdvanced();
    expect(screen.getByText('Cron (Zeitplan)')).toBeInTheDocument();
    expect(screen.getByText('Geplantes Konto')).toBeInTheDocument();
  });

  test('server mode shows the next run in the workspace time zone', async () => {
    mockTransportKind = 'http';
    await openAdvanced('Morgens abholen');
    const hint = await screen.findByTestId('workflow-schedule-hint');
    expect(hint).toHaveTextContent(/Nächste Ausführung: /);
    await screen.findByText(/Zeitzone America\/New_York/);
    expect(mockInvoke).toHaveBeenCalledWith(IPCChannels.Email.GetWorkflowAutomationSettings);
    // Ohne Zustandsangabe (aeltere Server-API) kein Hinweis auf „nicht scharf".
    expect(screen.queryByTestId('workflow-schedule-not-armed')).not.toBeInTheDocument();
  });

  test('server mode validates the expression like the server', async () => {
    mockTransportKind = 'http';
    await openAdvanced('Morgens abholen');
    const cron = screen.getByLabelText('Cron (Zeitplan)');
    fireEvent.change(cron, { target: { value: '0 0 6 * * *' } });
    expect(await screen.findByText(/Sekunden-Feld/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Speichern/ }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/Sekunden-Feld/)));
    expect(mockInvoke.mock.calls.some(([channel]) => channel === IPCChannels.Email.UpdateWorkflow)).toBe(false);

    fireEvent.change(cron, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: /Speichern/ }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/brauchen einen Cron-Ausdruck/)));
    expect(mockInvoke.mock.calls.some(([channel]) => channel === IPCChannels.Email.UpdateWorkflow)).toBe(false);

    fireEvent.change(cron, { target: { value: '30 7 * * *' } });
    fireEvent.click(screen.getByRole('button', { name: /Speichern/ }));
    await waitFor(() => expect(
      mockInvoke.mock.calls.some(([channel]) => channel === IPCChannels.Email.UpdateWorkflow),
    ).toBe(true));
    const update = mockInvoke.mock.calls.find(([channel]) => channel === IPCChannels.Email.UpdateWorkflow)!;
    expect(update[1]).toMatchObject({ trigger: 'schedule', cronExpr: '30 7 * * *' });
  });

  test('server mode warns about an active schedule that is not armed yet and saving arms it', async () => {
    mockTransportKind = 'http';
    rows = [row, { ...scheduleRow, schedule_last_slot_at: null } as typeof row];
    await openAdvanced('Morgens abholen');
    expect(screen.getByTestId('workflow-schedule-not-armed')).toHaveTextContent(
      'Zeitplan ist noch nicht scharf geschaltet – einmal speichern, um ihn zu aktivieren.',
    );
    expect(await screen.findByTestId('workflow-schedule-hint')).toHaveTextContent(/Noch nicht scharf/);

    fireEvent.click(screen.getByRole('button', { name: /Speichern/ }));
    await waitFor(() => expect(
      mockInvoke.mock.calls.some(([channel]) => channel === IPCChannels.Email.UpdateWorkflow),
    ).toBe(true));
    const update = mockInvoke.mock.calls.find(([channel]) => channel === IPCChannels.Email.UpdateWorkflow)!;
    // Die Ausfuehrungsfelder gehen mit — erst damit schaltet der Server scharf.
    expect(update[1]).toMatchObject({ trigger: 'schedule', enabled: true, cronExpr: '0 6 * * 1-5' });
  });

  test('no warning for an armed schedule', async () => {
    mockTransportKind = 'http';
    rows = [row, { ...scheduleRow, schedule_last_slot_at: '2026-09-28T04:00:00.000Z' } as typeof row];
    await openAdvanced('Morgens abholen');
    expect(screen.queryByTestId('workflow-schedule-not-armed')).not.toBeInTheDocument();
    expect(await screen.findByTestId('workflow-schedule-hint')).toHaveTextContent(/Nächste Ausführung/);
  });

  test('the desktop never shows the armed warning', async () => {
    mockTransportKind = 'ipc';
    rows = [row, { ...scheduleRow, schedule_last_slot_at: null } as typeof row];
    await openAdvanced('Morgens abholen');
    expect(screen.queryByTestId('workflow-schedule-not-armed')).not.toBeInTheDocument();
  });

  test('the desktop keeps its node-cron check (6 fields allowed)', async () => {
    mockTransportKind = 'ipc';
    // Desktop: Speichern ist Owner/Admin vorbehalten (G1).
    mockRole = 'admin';
    await openAdvanced('Morgens abholen');
    expect(screen.queryByTestId('workflow-schedule-hint')).not.toBeInTheDocument();
    const cron = screen.getByLabelText('Cron (Zeitplan)');
    fireEvent.change(cron, { target: { value: '0 0 6 * * *' } });
    fireEvent.click(screen.getByRole('button', { name: /Speichern/ }));
    await waitFor(() => expect(
      mockInvoke.mock.calls.some(([channel]) => channel === IPCChannels.Email.UpdateWorkflow),
    ).toBe(true));
    expect(toast.error).not.toHaveBeenCalled();
  });
});

