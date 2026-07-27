import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';

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

/**
 * Wird workflows.view waehrend der Sitzung entzogen, reicht es nicht,
 * Navigation und Aktionen auszublenden — die bereits geladenen Zeilen und der
 * offene Graph muessen verschwinden.
 */
describe('workflow shell view gate', () => {
  beforeEach(() => {
    mockCanView = true;
    mockReady = true;
    mockInvoke.mockReset();
    mockInvoke.mockImplementation(async (channel: string) => {
      if (channel === IPCChannels.Email.ListWorkflows) {
        return [{
          id: 7,
          name: 'Geheimer Workflow',
          trigger: 'inbound',
          enabled: 1,
          priority: 100,
          definition_json: '{"version":1,"rules":[]}',
          graph_json: null,
          cron_expr: null,
          schedule_account_id: null,
          created_at: '',
          updated_at: '',
        }];
      }
      return [];
    });
  });

  test('shows workflows while the capability is held', async () => {
    render(<WorkflowShell />);
    expect(await screen.findByText('Geheimer Workflow')).toBeInTheDocument();
  });

  test('drops loaded rows and never loads again once the capability is gone', async () => {
    mockCanView = false;
    render(<WorkflowShell />);

    expect(await screen.findByText(/fehlt die Berechtigung/)).toBeInTheDocument();
    expect(screen.queryByText('Geheimer Workflow')).not.toBeInTheDocument();
    await waitFor(() => expect(mockInvoke).not.toHaveBeenCalledWith(
      IPCChannels.Email.ListWorkflows,
      expect.anything(),
    ));
  });

  test('renders normally while capabilities are still loading', async () => {
    mockCanView = false;
    mockReady = false;
    render(<WorkflowShell />);

    // Noch nicht entschieden: nicht vorschnell sperren.
    expect(await screen.findByText('Geheimer Workflow')).toBeInTheDocument();
  });
});
