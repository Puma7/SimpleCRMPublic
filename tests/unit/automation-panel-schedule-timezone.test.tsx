import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { IPCChannels } from '@shared/ipc/channels';

const mockInvokeRenderer = jest.fn();
let mockTransportKind: 'http' | 'ipc' = 'http';
jest.mock('@/services/transport', () => ({
  getRendererTransport: () => ({ kind: mockTransportKind, serverBaseUrl: 'https://crm.example.com' }),
  invokeRenderer: (...args: unknown[]) => mockInvokeRenderer(...args),
  isAutomationApiKeyRefreshEvent: () => false,
  subscribeServerEvents: () => ({ unsubscribe: jest.fn() }),
}));

const mockUseAuth = jest.fn();
jest.mock('@/components/auth/auth-context', () => ({
  useAuth: () => mockUseAuth(),
}));

jest.mock('@/components/email/types', () => ({
  hasLocalIpc: () => mockTransportKind === 'ipc',
  invokeIpc: jest.fn(async () => ({ enabled: false, port: 3847, bindLan: false, scopes: [], hasApiKey: false })),
}));

jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn(), warning: jest.fn() } }));

import { toast } from 'sonner';
import { AutomationPanel } from '@/components/email/settings/automation-panel';

function workflowSettings(extra: Record<string, unknown> = {}) {
  return {
    imapDeleteOptIn: false,
    httpAllowlist: '',
    autoReplyEnabled: false,
    autoReplyMaxPerSenderPerDay: 1,
    ...extra,
  };
}

// TA-P4: Zeitplan-Workflows laufen auf dem Server in der Workspace-Zeitzone.
describe('AutomationPanel schedule time zone', () => {
  let settings: Record<string, unknown>;

  beforeEach(() => {
    mockTransportKind = 'http';
    settings = workflowSettings({ scheduleTimezone: 'Europe/Berlin' });
    (toast.error as jest.Mock).mockReset();
    mockUseAuth.mockReturnValue({ user: { id: 'owner-1', role: 'owner' }, loading: false, canManageSettings: true });
    mockInvokeRenderer.mockReset();
    mockInvokeRenderer.mockImplementation(async (channel: string) => {
      if (channel === IPCChannels.Email.GetWorkflowAutomationSettings) return settings;
      if (channel === IPCChannels.Email.SetWorkflowAutomationSettings) return { success: true };
      if (channel === IPCChannels.Email.GetEmailMiscSettings) return { webhookSecret: '', maxAttachmentMb: '25' };
      if (channel === IPCChannels.Automation.GetSettings) {
        return { enabled: true, port: 0, bindLan: false, scopes: [], hasApiKey: false, keys: [] };
      }
      throw new Error(`unexpected channel ${channel}`);
    });
  });

  function setCalls() {
    return mockInvokeRenderer.mock.calls.filter(([channel]) => channel === IPCChannels.Email.SetWorkflowAutomationSettings);
  }

  test('an admin edits the zone and it is saved in canonical form', async () => {
    render(<AutomationPanel />);
    const field = await screen.findByLabelText('Zeitzone für Zeitplan-Workflows');
    await waitFor(() => expect(field).toHaveValue('Europe/Berlin'));
    fireEvent.change(field, { target: { value: ' europe/vienna ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Workflow-Optionen speichern' }));
    await waitFor(() => expect(setCalls()).toHaveLength(1));
    expect(setCalls()[0]![1]).toMatchObject({ scheduleTimezone: 'Europe/Vienna' });
    expect(field).toHaveValue('Europe/Vienna');
  });

  test('an unknown zone is rejected before saving', async () => {
    render(<AutomationPanel />);
    const field = await screen.findByLabelText('Zeitzone für Zeitplan-Workflows');
    fireEvent.change(field, { target: { value: 'Mars/Olympus' } });
    fireEvent.click(screen.getByRole('button', { name: 'Workflow-Optionen speichern' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/Unbekannte Zeitzone/)));
    expect(setCalls()).toHaveLength(0);
  });

  test('read-only without admin rights, like the other workflow options', async () => {
    mockUseAuth.mockReturnValue({ user: { id: 'user-1', role: 'user' }, loading: false });
    render(<AutomationPanel />);
    expect(await screen.findByLabelText('Zeitzone für Zeitplan-Workflows')).toBeDisabled();
  });

  test('hidden when the backend has no workspace zone (desktop)', async () => {
    mockTransportKind = 'ipc';
    settings = workflowSettings();
    render(<AutomationPanel />);
    await screen.findByText('Workflow-Automatisierung (intern)');
    await waitFor(() => expect(mockInvokeRenderer).toHaveBeenCalledWith(IPCChannels.Email.GetWorkflowAutomationSettings));
    expect(screen.queryByLabelText('Zeitzone für Zeitplan-Workflows')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Workflow-Optionen speichern' }));
    await waitFor(() => expect(setCalls()).toHaveLength(1));
    expect(setCalls()[0]![1]).not.toHaveProperty('scheduleTimezone');
  });
});
