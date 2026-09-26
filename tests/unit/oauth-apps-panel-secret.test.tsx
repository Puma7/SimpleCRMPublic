import { render, screen, waitFor } from '@testing-library/react';

import { IPCChannels } from '@shared/ipc/channels';

const mockInvokeRenderer = jest.fn();
jest.mock('@/services/transport', () => ({
  invokeRenderer: (...args: unknown[]) => mockInvokeRenderer(...args),
}));

const mockUseAuth = jest.fn();
jest.mock('@/components/auth/auth-context', () => ({
  useAuth: () => mockUseAuth(),
}));

import { OAuthAppsPanel } from '@/components/email/settings/oauth-apps-panel';

describe('OAuthAppsPanel secrets', () => {
  beforeEach(() => {
    mockInvokeRenderer.mockReset();
  });

  // N-ds-02: Der Desktop liefert Nicht-Admins kein Client-Secret mehr, nur hasSecret; Speichern verlangt Owner/Admin.
  test('shows a stored secret only as placeholder and disables saving for non-admins', async () => {
    mockUseAuth.mockReturnValue({ user: { id: 'u', role: 'agent' } });
    mockInvokeRenderer.mockImplementation(async (channel: string) => {
      if (channel === IPCChannels.Email.GetGoogleOAuthApp) {
        return { success: true, clientId: 'google-client', hasSecret: true };
      }
      if (channel === IPCChannels.Email.GetMicrosoftOAuthApp) {
        return { success: true, clientId: 'ms-client', hasSecret: false };
      }
      throw new Error(`unexpected channel ${channel}`);
    });

    render(<OAuthAppsPanel />);

    expect(await screen.findByDisplayValue('google-client')).toBeDisabled();
    const placeholders = screen.getAllByPlaceholderText('Gesetzt (nur für Owner/Admin sichtbar)');
    expect(placeholders).toHaveLength(1);
    expect(placeholders[0]).toHaveValue('');
    for (const button of screen.getAllByRole('button', { name: 'App-Daten speichern' })) {
      expect(button).toBeDisabled();
    }
  });

  test('prefills the secret for admins, also when the server omits hasSecret', async () => {
    mockUseAuth.mockReturnValue({ user: { id: 'u', role: 'admin' } });
    mockInvokeRenderer.mockImplementation(async (channel: string) => {
      if (channel === IPCChannels.Email.GetGoogleOAuthApp) {
        return { success: true, clientId: 'google-client', clientSecret: 'google-geheim' };
      }
      if (channel === IPCChannels.Email.GetMicrosoftOAuthApp) {
        return { success: true, clientId: 'ms-client', clientSecret: 'ms-geheim', hasSecret: true };
      }
      throw new Error(`unexpected channel ${channel}`);
    });

    render(<OAuthAppsPanel />);

    await waitFor(() => expect(screen.getByDisplayValue('google-geheim')).toBeEnabled());
    expect(screen.getByDisplayValue('ms-geheim')).toBeEnabled();
    for (const button of screen.getAllByRole('button', { name: 'App-Daten speichern' })) {
      expect(button).toBeEnabled();
    }
  });
});
