import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const mockInvoke = jest.fn();
jest.mock('@/services/transport', () => ({
  invokeRenderer: (...args: unknown[]) => mockInvoke(...args),
  getRendererTransport: () => ({ kind: 'http' }),
  isWorkflowListRefreshEvent: () => false,
  subscribeServerEvents: () => ({ unsubscribe: jest.fn() }),
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

// F-A9-13 (Server, E28): Der Browser-Import im Server-Modus legte den Workflow
// mit `enabled` aus der Datei an; eine fremde Vorlage lief sofort.
describe('workflow shell browser import', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    mockInvoke.mockImplementation(async (channel: string) => {
      if (channel === IPCChannels.Email.CreateWorkflow) return { success: true, id: -31 };
      if (channel === IPCChannels.Email.GetWorkflow) return null;
      return [];
    });
  });

  test('creates the imported workflow disabled', async () => {
    const { container } = render(<WorkflowShell />);
    await screen.findByRole('heading', { level: 1, name: 'Workflows' });
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const json = JSON.stringify({
      version: 1,
      exportedAt: '2026-09-25T10:00:00.000Z',
      workflow: {
        name: 'Fremde Vorlage',
        trigger: 'inbound',
        priority: 5,
        enabled: true,
        definition_json: '{"version":1,"rules":[]}',
        graph_json: null,
        cron_expr: null,
        schedule_account_id: null,
        execution_mode: 'graph',
        engine_version: 1,
      },
    });
    const file = new File([json], 'workflow.json', { type: 'application/json' });
    Object.defineProperty(file, 'text', { value: async () => json });

    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith(
      IPCChannels.Email.CreateWorkflow,
      expect.objectContaining({ name: 'Fremde Vorlage (Import)', enabled: false }),
    ));
  });
});
