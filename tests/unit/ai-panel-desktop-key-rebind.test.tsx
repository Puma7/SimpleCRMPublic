import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { toast } from 'sonner';

import { AiPanel } from '@/components/email/settings/ai-panel';
import {
  configureRendererTransport,
  createIpcRendererTransport,
  resetRendererTransportForTests,
} from '@/services/transport';
import { IPCChannels } from '@shared/ipc/channels';

jest.mock('sonner', () => ({
  toast: { error: jest.fn(), success: jest.fn() },
}));

jest.mock('@/components/auth/auth-context', () => ({
  useAuth: () => ({ user: { id: 'agent-1', role: 'agent' }, loading: false, hasCapability: () => false }),
}));

// Die beiden Unterabschnitte laden eigene Einstellungen; hier geht es nur um die Profile.
jest.mock('@/components/email/settings/reply-suggestion-settings-section', () => ({
  ReplySuggestionSettingsSection: () => null,
}));
jest.mock('@/components/email/settings/translation-settings-section', () => ({
  TranslationSettingsSection: () => null,
}));

/** Zeilen, wie sie email:list-ai-profiles auf dem Desktop liefert. */
function desktopProfileRow() {
  return {
    id: 21,
    label: 'Firmen-Key',
    provider: 'openai',
    base_url: 'https://api.openai.com/v1',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    embedding_model: null,
    embeddingModel: null,
    keytar_account: 'profile-21',
    is_default: 1,
    isDefault: true,
    sort_order: 0,
    sortOrder: 0,
    hasApiKey: true,
  };
}

describe('KI-Panel im Desktop-Modus', () => {
  let invoke: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    resetRendererTransportForTests();
    invoke = jest.fn(async (channel: string) => {
      if (channel === IPCChannels.Email.ListAiProfiles) return [desktopProfileRow()];
      if (channel === IPCChannels.Email.SaveAiProfile) return { success: true, id: 21 };
      return undefined;
    });
    configureRendererTransport(createIpcRendererTransport({ invoke } as any));
  });

  afterEach(() => {
    resetRendererTransportForTests();
  });

  // C-A16: Auf dem Desktop verlangte das Panel bei neuer Base-URL keinen neuen Key; der gespeicherte Key ging an den neuen Host.
  test('verlangt einen neuen API-Key, sobald sich der Origin der Base-URL aendert', async () => {
    const { container } = render(<AiPanel />);

    await screen.findByDisplayValue('Firmen-Key');
    const baseUrlInput = screen.getByDisplayValue('https://api.openai.com/v1');
    const keyInput = container.querySelector('input[type="password"]') as HTMLInputElement;
    expect(keyInput).not.toBeRequired();
    const profileForm = within(keyInput.closest('.grid') as HTMLElement);

    fireEvent.change(baseUrlInput, { target: { value: 'https://collector.example/v1' } });
    expect(keyInput).toBeRequired();
    expect(keyInput).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('API-Key (erforderlich, Base-URL oder Anbieter geändert)')).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(profileForm.getByRole('button', { name: 'Speichern' }));
    });
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('Zugangsdaten bei Serverwechsel neu eingeben'));
    expect(invoke).not.toHaveBeenCalledWith(IPCChannels.Email.SaveAiProfile, expect.anything());

    fireEvent.change(keyInput, { target: { value: 'sk-neu' } });
    await act(async () => {
      fireEvent.click(profileForm.getByRole('button', { name: 'Speichern' }));
    });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('KI-Profil gespeichert.'));
    expect(invoke).toHaveBeenCalledWith(IPCChannels.Email.SaveAiProfile, expect.objectContaining({
      id: 21,
      baseUrl: 'https://collector.example/v1',
      apiKey: 'sk-neu',
      isDefault: true,
    }));
  });

  test('gleicher Origin laesst den gespeicherten Key stehen', async () => {
    const { container } = render(<AiPanel />);

    await screen.findByDisplayValue('Firmen-Key');
    const baseUrlInput = screen.getByDisplayValue('https://api.openai.com/v1');
    const keyInput = container.querySelector('input[type="password"]') as HTMLInputElement;
    fireEvent.change(baseUrlInput, { target: { value: 'https://api.openai.com/v2' } });
    expect(keyInput).not.toBeRequired();

    await act(async () => {
      fireEvent.click(within(keyInput.closest('.grid') as HTMLElement).getByRole('button', { name: 'Speichern' }));
    });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('KI-Profil gespeichert.'));
    expect(invoke).toHaveBeenCalledWith(IPCChannels.Email.SaveAiProfile, expect.objectContaining({
      baseUrl: 'https://api.openai.com/v2',
      apiKey: undefined,
    }));
  });

  test('zeigt die Ablehnung des Hauptprozesses an', async () => {
    invoke.mockImplementation(async (channel: string) => {
      if (channel === IPCChannels.Email.ListAiProfiles) return [desktopProfileRow()];
      if (channel === IPCChannels.Email.SaveAiProfile) {
        return { success: false, error: 'Zugangsdaten bei Serverwechsel neu eingeben: API-Key erforderlich' };
      }
      return undefined;
    });
    const { container } = render(<AiPanel />);

    await screen.findByDisplayValue('Firmen-Key');
    const keyInput = container.querySelector('input[type="password"]') as HTMLInputElement;
    await act(async () => {
      fireEvent.click(within(keyInput.closest('.grid') as HTMLElement).getByRole('button', { name: 'Speichern' }));
    });

    expect(toast.error).toHaveBeenCalledWith('Zugangsdaten bei Serverwechsel neu eingeben: API-Key erforderlich');
    expect(toast.success).not.toHaveBeenCalled();
  });
});
