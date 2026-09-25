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

let mockRole = 'agent';
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
import { AutomationPanel } from '@/components/email/settings/automation-panel';
import { IPCChannels } from '@shared/ipc/channels';

const row = {
  id: 7,
  name: 'Eingang sortieren',
  trigger: 'schedule',
  enabled: 1,
  priority: 100,
  definition_json: '{"version":1,"rules":[]}',
  graph_json: null,
  cron_expr: '*/15 * * * *',
  schedule_account_id: null,
  created_at: '',
  updated_at: '',
};

async function openWorkflow(): Promise<void> {
  render(<WorkflowShell />);
  fireEvent.click(await screen.findByText('Eingang sortieren'));
  fireEvent.click(await screen.findByRole('button', { name: /Erweitert/ }));
  await screen.findByText('Test-Nachricht-ID');
  fireEvent.change(screen.getByPlaceholderText('aus Details-Panel'), { target: { value: '12' } });
}

beforeEach(() => {
  for (const key of Object.keys(mockChildProps)) delete mockChildProps[key];
  mockInvoke.mockReset();
  mockInvoke.mockImplementation(async (channel: string) => {
    if (channel === IPCChannels.Email.ListWorkflows) return [row];
    if (channel === IPCChannels.Email.GetWorkflow) return row;
    if (channel === IPCChannels.Email.GetWorkflowAutomationSettings) {
      return { imapDeleteOptIn: false, httpAllowlist: '', autoReplyEnabled: false, autoReplyMaxPerSenderPerDay: 1 };
    }
    if (channel === IPCChannels.Email.GetEmailMiscSettings) return { maxAttachmentMb: '25', hasSecret: false };
    return [];
  });
});

// C-A1/C-A37 (G1): Der Desktop-Editor war fuer jede Rolle freigeschaltet
// (canEdit/canManage = !serverClientMode); Agent/Viewer konnten Code- und
// Weiterleitungs-Workflows anlegen. Jetzt bestimmt die Rolle Owner/Admin.
describe('Desktop-Workflow-Editor nach Rolle (G1)', () => {
  test.each(['agent', 'viewer'])('%s sieht den Editor schreibgeschuetzt', async (role) => {
    mockRole = role;
    await openWorkflow();

    expect(screen.queryByRole('button', { name: /^Neu$/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Speichern' })).toBeDisabled();
    for (const button of screen.getAllByRole('button', { name: 'Workflow löschen' })) {
      expect(button).toBeDisabled();
    }
    expect(screen.getByRole('button', { name: 'Import' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Vorlagen' })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Anordnen/ })).toBeDisabled();
    expect(screen.getByRole('switch')).toBeDisabled();
    expect(screen.getByDisplayValue('Eingang sortieren')).toBeDisabled();
    expect(screen.getByDisplayValue('*/15 * * * *')).toBeDisabled();
    expect(screen.getByRole('button', { name: /Inbound-Backfill/ })).toBeDisabled();
    // Echter Lauf verlangt per IPC Owner/Admin — kein Knopf, der sicher scheitert.
    expect(screen.getByRole('button', { name: 'Jetzt ausführen' })).toBeDisabled();
    expect(screen.getByText(/Nur Ansicht — Bearbeitung erfordert die Rolle Owner oder Admin/)).toBeInTheDocument();

    // Ansehen bleibt offen: Dry-Run, Export, Versionsliste.
    expect(screen.getByRole('button', { name: 'Dry-Run testen' })).not.toBeDisabled();
    expect(screen.getByRole('button', { name: 'Export' })).not.toBeDisabled();
    expect(screen.getByRole('button', { name: 'Versionen' })).not.toBeDisabled();

    expect(mockChildProps.canvas).toMatchObject({ readOnly: true });
    expect(mockChildProps.json).toMatchObject({ readOnly: true });
    expect(mockChildProps.versions).toMatchObject({ canEdit: false });
    expect(mockChildProps.palette).toBeUndefined();
  });

  test.each(['owner', 'admin'])('%s darf bearbeiten', async (role) => {
    mockRole = role;
    await openWorkflow();

    expect(screen.getByRole('button', { name: /^Neu$/ })).not.toBeDisabled();
    expect(screen.getByRole('button', { name: 'Speichern' })).not.toBeDisabled();
    for (const button of screen.getAllByRole('button', { name: 'Workflow löschen' })) {
      expect(button).not.toBeDisabled();
    }
    expect(screen.getByRole('button', { name: 'Import' })).not.toBeDisabled();
    expect(screen.getByRole('switch')).not.toBeDisabled();
    expect(screen.getByRole('button', { name: /Inbound-Backfill/ })).not.toBeDisabled();
    expect(screen.getByRole('button', { name: 'Jetzt ausführen' })).not.toBeDisabled();
    expect(mockChildProps.canvas).toMatchObject({ readOnly: false });
    expect(mockChildProps.versions).toMatchObject({ canEdit: true });
    expect(mockChildProps.palette).toBeDefined();
  });
});

// C-A47 (G1): workflow:set-automation-settings (IMAP-Loesch-Opt-in,
// HTTP-Allowlist) war auf dem Desktop fuer jede Rolle bedienbar.
describe('Desktop-Workflow-Automation-Einstellungen nach Rolle (G1)', () => {
  test('agent sieht die Workflow-Optionen nur lesend', async () => {
    mockRole = 'agent';
    render(<AutomationPanel />);

    expect(await screen.findByText(/Nur lesbar: Workflow-Optionen/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Workflow-Optionen speichern' })).toBeDisabled());
    expect(screen.getByLabelText('HTTP-Allowlist (Hosts)')).toBeDisabled();
    expect(screen.getByLabelText('IMAP-Löschung (globaler Fallback)')).toBeDisabled();
  });

  test('admin darf die Workflow-Optionen speichern', async () => {
    mockRole = 'admin';
    render(<AutomationPanel />);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Workflow-Optionen speichern' })).not.toBeDisabled());
    expect(screen.queryByText(/Nur lesbar: Workflow-Optionen/)).not.toBeInTheDocument();
    expect(screen.getByLabelText('HTTP-Allowlist (Hosts)')).not.toBeDisabled();
  });
});
