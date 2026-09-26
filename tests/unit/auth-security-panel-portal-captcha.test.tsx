import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { AuthSecurityPanel } from '@/components/settings/auth-security-panel';

const mockGetSecuritySettings = jest.fn();
const mockPatchSecuritySettings = jest.fn();

jest.mock('@/components/auth/auth-context', () => ({
  useAuth: () => ({ user: { id: 'admin-1', role: 'owner' }, loading: false }),
}));

jest.mock('@/services/transport', () => ({
  getRendererTransport: () => ({ kind: 'http', serverBaseUrl: 'https://crm.example.com' }),
  createServerAuthClient: () => ({
    getSession: () => ({ tokens: { accessToken: 'access-token' } }),
    getSecuritySettings: (...args: unknown[]) => mockGetSecuritySettings(...args),
    patchSecuritySettings: (...args: unknown[]) => mockPatchSecuritySettings(...args),
  }),
}));

function settingsResponse(overrides: Record<string, unknown> = {}, captchaProviderConfigured = true) {
  return {
    settings: {
      captchaEnabled: false,
      pinKeypadEnabled: false,
      mfaEnabled: false,
      mfaTotpEnabled: true,
      mfaEmailEnabled: false,
      portalCaptchaEnabled: true,
      ...overrides,
    },
    captchaProviderConfigured,
    currentUser: { loginPinEnabled: false, mfaEnabled: false },
  };
}

// F-A3a-07 (E7): the portal CAPTCHA is on by default with Turnstile; the
// workspace switch lives next to the login CAPTCHA.
describe('AuthSecurityPanel portal CAPTCHA', () => {
  beforeEach(() => {
    mockGetSecuritySettings.mockReset();
    mockPatchSecuritySettings.mockReset();
  });

  test('shows the portal CAPTCHA switch and saves turning it off', async () => {
    mockGetSecuritySettings.mockResolvedValue(settingsResponse());
    mockPatchSecuritySettings.mockImplementation(async (_token: string, settings: Record<string, unknown>) => ({
      settings,
      currentUser: { loginPinEnabled: false, mfaEnabled: false },
    }));

    render(<AuthSecurityPanel />);

    const portalSwitch = await screen.findByRole('switch', { name: 'CAPTCHA im Retourenportal' });
    await waitFor(() => expect(portalSwitch).toBeChecked());
    expect(portalSwitch).toBeEnabled();

    fireEvent.click(portalSwitch);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    });

    expect(mockPatchSecuritySettings).toHaveBeenCalledWith(
      'access-token',
      expect.objectContaining({ portalCaptchaEnabled: false, captchaEnabled: false }),
    );
  });

  test('the switch is disabled until Turnstile is configured', async () => {
    mockGetSecuritySettings.mockResolvedValue(settingsResponse({}, false));

    render(<AuthSecurityPanel />);

    const portalSwitch = await screen.findByRole('switch', { name: 'CAPTCHA im Retourenportal' });
    await waitFor(() => expect(portalSwitch).toBeDisabled());
  });
});
