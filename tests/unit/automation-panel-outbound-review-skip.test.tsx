/**
 * Einstellungen → Automatisierung (Teilautomatisierung P2): „Ausgangsprüfung
 * überspringen erlauben“ wird mit den Workflow-Optionen geladen und gespeichert.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { IPCChannels } from '@shared/ipc/channels';

const mockInvokeRenderer = jest.fn();
jest.mock('@/services/transport', () => ({
  getRendererTransport: () => ({ kind: 'http', serverBaseUrl: 'https://crm.example.com' }),
  invokeRenderer: (...args: unknown[]) => mockInvokeRenderer(...args),
  isAutomationApiKeyRefreshEvent: () => false,
  subscribeServerEvents: () => ({ unsubscribe: jest.fn() }),
}));

const mockUseAuth = jest.fn();
jest.mock('@/components/auth/auth-context', () => ({
  useAuth: () => mockUseAuth(),
}));

jest.mock('@/components/email/types', () => ({
  hasLocalIpc: () => false,
  invokeIpc: jest.fn(),
}));

jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

import { AutomationPanel } from '@/components/email/settings/automation-panel';

function mockChannels(stored: string | undefined) {
  mockInvokeRenderer.mockImplementation(async (channel: string) => {
    if (channel === IPCChannels.Email.GetWorkflowAutomationSettings) {
      return {
        imapDeleteOptIn: false,
        httpAllowlist: '',
        autoReplyEnabled: false,
        autoReplyMaxPerSenderPerDay: 1,
        outboundReviewSkipPolicy: stored,
      };
    }
    if (channel === IPCChannels.Email.GetEmailMiscSettings) return { webhookSecret: '', maxAttachmentMb: '25' };
    if (channel === IPCChannels.Automation.GetSettings) return { enabled: true, scopes: [], keys: [] };
    if (channel === IPCChannels.Email.SetWorkflowAutomationSettings) return { success: true };
    throw new Error(`unexpected channel ${channel}`);
  });
}

describe('AutomationPanel: Ausgangsprüfung überspringen erlauben', () => {
  beforeEach(() => {
    mockInvokeRenderer.mockReset();
  });

  test('Owner lädt die Richtlinie und speichert eine Änderung mit den Workflow-Optionen', async () => {
    mockUseAuth.mockReturnValue({ user: { id: 'owner-1', role: 'owner' }, loading: false, canManageSettings: true });
    mockChannels('admins');
    render(<AutomationPanel />);

    const select = await screen.findByLabelText('Ausgangsprüfung überspringen erlauben');
    await waitFor(() => expect(select).toHaveValue('admins'));
    expect(screen.getByRole('option', { name: 'Alle, die senden dürfen (Standard)' })).toBeInTheDocument();

    fireEvent.change(select, { target: { value: 'none' } });
    fireEvent.click(screen.getByRole('button', { name: 'Workflow-Optionen speichern' }));

    await waitFor(() => expect(mockInvokeRenderer).toHaveBeenCalledWith(
      IPCChannels.Email.SetWorkflowAutomationSettings,
      expect.objectContaining({ outboundReviewSkipPolicy: 'none' }),
    ));
  });

  test('ohne gespeicherten Wert gilt „alle“; Nutzer ohne Adminrolle sehen die Auswahl nur lesend', async () => {
    mockUseAuth.mockReturnValue({ user: { id: 'user-1', role: 'user' }, loading: false });
    mockChannels(undefined);
    render(<AutomationPanel />);

    const select = await screen.findByLabelText('Ausgangsprüfung überspringen erlauben');
    await waitFor(() => expect(select).toHaveValue('all'));
    expect(select).toBeDisabled();
  });
});
