import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { toast } from 'sonner';

import { MailSecurityPanel } from '@/components/email/settings/mail-security-panel';
import {
  configureRendererTransport,
  createIpcRendererTransport,
  resetRendererTransportForTests,
} from '@/services/transport';
import { IPCChannels } from '@shared/ipc/channels';

jest.mock('sonner', () => ({
  toast: { error: jest.fn(), success: jest.fn() },
}));

// Desktop-Form von useAuth: canManageSettings ist dort fuer jede Rolle true,
// die Rolle kommt aus der lokalen Session.
const mockUseAuth = jest.fn();
jest.mock('@/components/auth/auth-context', () => ({
  useAuth: () => mockUseAuth(),
}));

const settings = {
  mailauthEnabled: true,
  rspamdEnabled: false,
  rspamdUrl: 'http://127.0.0.1:11333',
  rspamdTimeoutMs: 8000,
  rspamdSpamScore: 15,
  autoSpamDmarcFail: false,
  autoSpamSpfFail: false,
  autoSpamRspamd: false,
  senderWhitelist: '',
  senderBlacklist: '',
  spamScoreThreshold: 70,
  spamEngineEnabled: true,
  spamReviewThreshold: 45,
  spamSpamThreshold: 75,
  localLearningEnabled: true,
  rspamdContributionEnabled: false,
  rspamdLearningEnabled: false,
  aiSpamWorkflowEnabled: false,
};

describe('Mail-Sicherheit im Desktop-Modus', () => {
  let invoke: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    resetRendererTransportForTests();
    invoke = jest.fn(async (channel: string) => {
      if (channel === IPCChannels.Email.GetMailSecuritySettings) return settings;
      if (channel === IPCChannels.Email.ListSpamListEntries) return [];
      if (channel === IPCChannels.Email.SetMailSecuritySettings) return { success: true };
      if (channel === IPCChannels.Email.TestRspamdConnection) return { success: true, message: 'Rspamd erreichbar' };
      return undefined;
    });
    configureRendererTransport(createIpcRendererTransport({ invoke } as any));
  });

  afterEach(() => {
    resetRendererTransportForTests();
  });

  // C-A51: Die Rspamd-URL und der Verbindungstest sind wie im Server-Client Owner/Admin vorbehalten; Agent und Viewer speichern nur die uebrigen Felder.
  test.each(['agent', 'viewer'])('%s: URL schreibgeschuetzt, kein Verbindungstest, uebrige Felder speicherbar', async (role) => {
    mockUseAuth.mockReturnValue({ user: { id: `${role}-1`, role }, canManageSettings: true });

    render(<MailSecurityPanel />);

    const urlInput = await screen.findByDisplayValue('http://127.0.0.1:11333');
    expect(urlInput).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Rspamd-Verbindung testen' })).not.toBeInTheDocument();

    fireEvent.change(screen.getByDisplayValue('45'), { target: { value: '30' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Mail-Sicherheit gespeichert.'));
    expect(invoke).toHaveBeenCalledWith(IPCChannels.Email.SetMailSecuritySettings, expect.objectContaining({
      rspamdUrl: 'http://127.0.0.1:11333',
      spamReviewThreshold: 30,
    }));
  });

  test.each(['owner', 'admin'])('%s: URL bearbeitbar und Verbindungstest verfuegbar', async (role) => {
    mockUseAuth.mockReturnValue({ user: { id: `${role}-1`, role }, canManageSettings: true });

    render(<MailSecurityPanel />);

    const urlInput = await screen.findByDisplayValue('http://127.0.0.1:11333');
    expect(urlInput).not.toBeDisabled();
    fireEvent.change(urlInput, { target: { value: 'http://rspamd.intern:11333' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Rspamd-Verbindung testen' }));
    });

    expect(invoke).toHaveBeenCalledWith(IPCChannels.Email.TestRspamdConnection, {
      rspamdUrl: 'http://rspamd.intern:11333',
      rspamdTimeoutMs: 8000,
    });
    expect(toast.success).toHaveBeenCalledWith('Rspamd erreichbar');
  });
});
