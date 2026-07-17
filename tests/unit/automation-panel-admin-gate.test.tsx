import { render, screen, waitFor } from '@testing-library/react';

import { IPCChannels } from '@shared/ipc/channels';

const mockInvokeRenderer = jest.fn();
const mockSubscribeServerEvents = jest.fn(() => ({ unsubscribe: jest.fn() }));
jest.mock('@/services/transport', () => ({
  getRendererTransport: () => ({ kind: 'http', serverBaseUrl: 'https://crm.example.com' }),
  invokeRenderer: (...args: unknown[]) => mockInvokeRenderer(...args),
  isAutomationApiKeyRefreshEvent: () => false,
  subscribeServerEvents: (...args: unknown[]) => mockSubscribeServerEvents(...args),
}));

const mockUseAuth = jest.fn();
jest.mock('@/components/auth/auth-context', () => ({
  useAuth: () => mockUseAuth(),
}));

jest.mock('@/components/email/types', () => ({
  hasLocalIpc: () => false,
  invokeIpc: jest.fn(),
}));

import { AutomationPanel } from '@/components/email/settings/automation-panel';

describe('AutomationPanel admin gate', () => {
  beforeEach(() => {
    mockUseAuth.mockReturnValue({
      user: { id: 'user-1', role: 'user' },
      loading: false,
    });
    mockInvokeRenderer.mockReset();
    mockInvokeRenderer.mockImplementation(async (channel: string) => {
      if (channel === IPCChannels.Email.GetWorkflowAutomationSettings) {
        return {
          imapDeleteOptIn: false,
          httpAllowlist: '',
          autoReplyEnabled: false,
          autoReplyMaxPerSenderPerDay: 1,
        };
      }
      if (channel === IPCChannels.Email.GetEmailMiscSettings) {
        return { webhookSecret: '', maxAttachmentMb: '25' };
      }
      throw new Error(`unexpected channel ${channel}`);
    });
  });

  test('keeps user workflow settings available without listing API keys', async () => {
    render(<AutomationPanel />);

    expect(await screen.findByText('Adminrechte erforderlich')).toBeTruthy();
    await waitFor(() => expect(mockInvokeRenderer).toHaveBeenCalledWith(
      IPCChannels.Email.GetWorkflowAutomationSettings,
    ));
    expect(mockInvokeRenderer).not.toHaveBeenCalledWith(IPCChannels.Automation.GetSettings);
    expect(mockSubscribeServerEvents).not.toHaveBeenCalled();
    expect(screen.getByText('Workflow-Automatisierung (intern)')).toBeTruthy();
  });
});
