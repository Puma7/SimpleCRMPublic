/**
 * Einstellungen → Automatisierung (Gatekeeper #5): „Workflow-Optionen
 * speichern“ meldet Fehler statt Erfolg, sperrt den Knopf während des
 * Speicherns und lässt keine unbehandelte Promise-Ablehnung zurück — für die
 * Server-Edition (HTTP-Fehler als Ausnahme) wie für den Desktop
 * (`{ success: false, error }`).
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

jest.mock('@/components/auth/auth-context', () => ({
  useAuth: () => ({ user: { id: 'owner-1', role: 'owner' }, loading: false, canManageSettings: true }),
}));

jest.mock('@/components/email/types', () => ({
  hasLocalIpc: () => false,
  invokeIpc: jest.fn(),
}));

const mockToastSuccess = jest.fn();
const mockToastError = jest.fn();
jest.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => mockToastSuccess(...args),
    error: (...args: unknown[]) => mockToastError(...args),
  },
}));

import { AutomationPanel } from '@/components/email/settings/automation-panel';

function mockChannels(save: () => Promise<unknown>) {
  mockInvokeRenderer.mockImplementation(async (channel: string) => {
    if (channel === IPCChannels.Email.GetWorkflowAutomationSettings) {
      return {
        imapDeleteOptIn: false,
        httpAllowlist: '',
        autoReplyEnabled: false,
        autoReplyMaxPerSenderPerDay: 1,
        outboundReviewSkipPolicy: 'all',
      };
    }
    if (channel === IPCChannels.Email.GetEmailMiscSettings) return { webhookSecret: '', maxAttachmentMb: '25' };
    if (channel === IPCChannels.Automation.GetSettings) return { enabled: true, scopes: [], keys: [] };
    if (channel === IPCChannels.Email.SetWorkflowAutomationSettings) return save();
    throw new Error(`unexpected channel ${channel}`);
  });
}

async function renderPanel() {
  render(<AutomationPanel />);
  const button = await screen.findByRole('button', { name: 'Workflow-Optionen speichern' });
  await waitFor(() => expect(button).toBeEnabled());
  return button;
}

describe('AutomationPanel: Fehler beim Speichern der Workflow-Optionen', () => {
  beforeEach(() => {
    mockInvokeRenderer.mockReset();
    mockToastSuccess.mockReset();
    mockToastError.mockReset();
  });

  test('Server lehnt ab (Ausnahme) ⇒ Fehlermeldung, keine Erfolgsmeldung, Knopf wieder frei', async () => {
    mockChannels(async () => { throw new Error('Ungültige Zeitzone'); });
    const button = await renderPanel();

    fireEvent.click(button);

    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith(
      expect.stringContaining('Ungültige Zeitzone'),
    ));
    expect(mockToastSuccess).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Workflow-Optionen speichern' })).toBeEnabled());
  });

  test('Desktop meldet { success: false } ⇒ Fehlermeldung statt „gespeichert“', async () => {
    mockChannels(async () => ({ success: false, error: 'Ungültige Einstellung für „Ausgangsprüfung überspringen“' }));
    const button = await renderPanel();

    fireEvent.click(button);

    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith(
      expect.stringContaining('Ungültige Einstellung'),
    ));
    expect(mockToastSuccess).not.toHaveBeenCalled();
  });

  test('während des Speicherns ist der Knopf gesperrt (kein Doppelklick-Speichern)', async () => {
    let finish: (value: unknown) => void = () => undefined;
    mockChannels(() => new Promise((resolve) => { finish = resolve; }));
    const button = await renderPanel();

    fireEvent.click(button);
    await waitFor(() => expect(screen.getByRole('button', { name: /Speichern…|Workflow-Optionen speichern/ })).toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: /Speichern…|Workflow-Optionen speichern/ }));
    expect(mockInvokeRenderer.mock.calls.filter(([channel]) => channel === IPCChannels.Email.SetWorkflowAutomationSettings))
      .toHaveLength(1);

    finish({ success: true });
    await waitFor(() => expect(mockToastSuccess).toHaveBeenCalledWith('Workflow-Optionen gespeichert.'));
    expect(screen.getByRole('button', { name: 'Workflow-Optionen speichern' })).toBeEnabled();
  });
});
