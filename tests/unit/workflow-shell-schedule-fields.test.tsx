import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';

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
jest.mock('@/components/auth/auth-context', () => ({
  useAuth: () => ({
    user: { id: 'u1', role: 'user' },
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

async function openAdvanced(): Promise<void> {
  render(<WorkflowShell />);
  fireEvent.click(await screen.findByText('Eingang sortieren'));
  fireEvent.click(await screen.findByRole('button', { name: /Erweitert/ }));
  await screen.findByText('Test-Nachricht-ID');
}

// F-A9-01 (E30): Im Server-Modus war das Cron-Feld sichtbar, obwohl der Server
// keinen Zeitplan-Trigger ausloest; ein eingetragener Zeitplan lief nie.
describe('workflow shell schedule fields', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    mockInvoke.mockImplementation(async (channel: string) => {
      if (channel === IPCChannels.Email.ListWorkflows) return [row];
      if (channel === IPCChannels.Email.GetWorkflow) return row;
      return [];
    });
  });

  test('hides cron and schedule account in server mode', async () => {
    mockTransportKind = 'http';
    await openAdvanced();
    expect(screen.queryByText('Cron (Zeitplan)')).not.toBeInTheDocument();
    expect(screen.queryByText('Geplantes Konto')).not.toBeInTheDocument();
  });

  test('keeps cron and schedule account on the desktop', async () => {
    mockTransportKind = 'ipc';
    await openAdvanced();
    expect(screen.getByText('Cron (Zeitplan)')).toBeInTheDocument();
    expect(screen.getByText('Geplantes Konto')).toBeInTheDocument();
  });
});
