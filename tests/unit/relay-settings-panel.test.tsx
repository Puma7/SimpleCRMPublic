import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { IPCChannels } from '@shared/ipc/channels';

const mockInvoke = jest.fn();
let mockTransportKind: 'http' | 'ipc' = 'http';
let mockRole = 'admin';

jest.mock('@/services/transport', () => ({
  invokeRenderer: (...args: unknown[]) => mockInvoke(...args),
  getRendererTransport: () => ({
    kind: mockTransportKind,
    serverBaseUrl: 'https://crm.example.com',
  }),
}));

jest.mock('@/components/auth/auth-context', () => ({
  useAuth: () => ({
    loading: false,
    authenticated: true,
    authRequired: true,
    user: { id: 'u1', username: 'user@example.com', displayName: 'User', role: mockRole },
    login: jest.fn(),
    logout: jest.fn(),
    refresh: jest.fn(),
  }),
}));

jest.mock('sonner', () => ({
  toast: { error: jest.fn(), success: jest.fn() },
}));

import { RelaySettingsPanel } from '@/components/email/settings/relay-settings-panel';

function relayFixture() {
  return {
    id: '3f0e8a3e-1111-4222-8333-444455556666',
    label: 'JTL Mahnwesen',
    enabled: true,
    trackingMode: 'rule',
    trackingSubjectPatterns: 'Mahnung',
    allowHeaderOverride: true,
    maxRecipients: 25,
    maxMessageBytes: 26214400,
    rateLimitPerMin: 60,
    allowArbitraryRecipients: false,
    followupWorkflowId: null,
    createdAt: '2026-07-01T10:00:00.000Z',
    allowedAccounts: [
      {
        accountId: 7,
        fromAddress: null,
        emailAddress: 'buchhaltung@example.de',
        displayName: 'Buchhaltung',
      },
    ],
    credentials: [
      {
        id: 'a0000000-0000-4000-8000-000000000001',
        username: 'relay-jtl',
        lastUsedAt: null,
        revokedAt: null,
        createdAt: '2026-07-01T10:00:00.000Z',
      },
    ],
  };
}

describe('RelaySettingsPanel', () => {
  beforeEach(() => {
    mockTransportKind = 'http';
    mockRole = 'admin';
    mockInvoke.mockReset();
    mockInvoke.mockImplementation(async (channel: string) => {
      switch (channel) {
        case IPCChannels.Email.ListSmtpRelays:
          return [relayFixture()];
        case IPCChannels.Email.ListAccounts:
          return [
            { id: 7, display_name: 'Buchhaltung', email_address: 'buchhaltung@example.de' },
            { id: 9, display_name: 'Support', email_address: 'support@example.de' },
          ];
        case IPCChannels.Email.ListWorkflows:
          return [{ id: 3, name: 'Mahnung nachfassen', trigger: 'relay', enabled: 1, priority: 0 }];
        case IPCChannels.Email.ListSmtpRelaySubmissions:
          return [];
        case IPCChannels.Email.CreateSmtpRelayCredential:
          return { id: 'b0000000-0000-4000-8000-000000000002', username: 'relay-user-2', password: 'einmal-passwort-123' };
        default:
          return undefined;
      }
    });
  });

  test('renders the relay list from ListSmtpRelays', async () => {
    render(<RelaySettingsPanel />);

    expect(await screen.findByText('JTL Mahnwesen')).toBeInTheDocument();
    expect(mockInvoke).toHaveBeenCalledWith(IPCChannels.Email.ListSmtpRelays);
    // Admin sees the create control.
    expect(screen.getByRole('button', { name: /Relay anlegen/ })).toBeInTheDocument();
  });

  test('creating a credential reveals username and one-time password with warning', async () => {
    render(<RelaySettingsPanel />);
    await screen.findByText('JTL Mahnwesen');

    fireEvent.click(screen.getByRole('button', { name: /Details/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Zugangsdaten erzeugen/ }));

    expect(await screen.findByText('einmal-passwort-123')).toBeInTheDocument();
    expect(screen.getByText(/Passwort wird nur einmal angezeigt/)).toBeInTheDocument();
    // Username appears in the reveal dialog (and afterwards in the list).
    expect(screen.getAllByText('relay-user-2').length).toBeGreaterThanOrEqual(1);
    // Copy buttons for username + password.
    expect(screen.getAllByRole('button', { name: /Kopieren/ })).toHaveLength(2);
    expect(mockInvoke).toHaveBeenCalledWith(IPCChannels.Email.CreateSmtpRelayCredential, {
      relayId: '3f0e8a3e-1111-4222-8333-444455556666',
    });
  });

  test('non-admin users see no mutation controls', async () => {
    mockRole = 'member';
    render(<RelaySettingsPanel />);
    await screen.findByText('JTL Mahnwesen');

    expect(screen.getByText('Nur lesbar')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Relay anlegen/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Löschen/ })).not.toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /Relay JTL Mahnwesen aktiv/ })).toBeDisabled();

    // Expanded details expose no mutating buttons either.
    fireEvent.click(screen.getByRole('button', { name: /Details/ }));
    await screen.findByText('Konfiguration');
    expect(screen.queryByRole('button', { name: /Speichern/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Zugangsdaten erzeugen/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Konto hinzufügen/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Widerrufen/ })).not.toBeInTheDocument();
  });

  test('desktop (IPC) mode shows the server-only hint and loads nothing', async () => {
    mockTransportKind = 'ipc';
    render(<RelaySettingsPanel />);

    expect(await screen.findByText('Server-Funktion')).toBeInTheDocument();
    expect(screen.getByText(/läuft auf dem SimpleCRM-Server/)).toBeInTheDocument();
    await waitFor(() => {
      expect(mockInvoke).not.toHaveBeenCalledWith(IPCChannels.Email.ListSmtpRelays);
    });
  });
});
