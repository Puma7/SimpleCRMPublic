import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { TrackingSettingsPanel } from '@/components/email/settings/tracking-settings-panel';
import { invokeRenderer } from '@/services/transport';
import { IPCChannels } from '@shared/ipc/channels';

let mockUser: { id: string; role: string } | null = { id: 'admin-1', role: 'admin' };

jest.mock('@/components/auth/auth-context', () => ({
  useAuth: () => ({ user: mockUser, loading: false }),
}));
jest.mock('@/services/transport', () => ({ invokeRenderer: jest.fn() }));
jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn() } }));

const policy = {
  enabled: false, trackOpens: false, trackLinks: false,
  collectDerivedMetadata: true, collectRawMetadata: true, ipInsightsEnabled: false,
  rawMetadataRetentionDays: 7, eventRetentionDays: 365, tokenTtlDays: 730,
  legalBasis: null, privacyNoticeUrl: null, complianceAcknowledgedAt: null,
  publicBaseUrl: 'https://crm.example', updatedAt: null,
};

describe('tracking settings panel', () => {
  beforeEach(() => {
    mockUser = { id: 'admin-1', role: 'admin' };
    jest.mocked(invokeRenderer).mockReset();
  });

  test('saves the explicit IP insight opt-in without enabling its dependencies silently', async () => {
    const invoke = jest.mocked(invokeRenderer);
    invoke.mockResolvedValueOnce(policy).mockResolvedValueOnce({ ...policy, ipInsightsEnabled: true });
    render(<TrackingSettingsPanel />);

    const toggle = await screen.findByRole('switch', { name: 'IP-Insights aus lokalen Datenbanken' });
    expect(toggle).toBeEnabled();
    fireEvent.click(toggle);
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));

    await waitFor(() => expect(invoke).toHaveBeenCalledWith(IPCChannels.Email.SetEmailTrackingSettings,
      expect.objectContaining({ ipInsightsEnabled: true, collectDerivedMetadata: true, collectRawMetadata: true })));
  });

  test('shows the IP insight setting read-only for non-admin users', async () => {
    mockUser = { id: 'user-1', role: 'user' };
    jest.mocked(invokeRenderer).mockResolvedValueOnce(policy);
    render(<TrackingSettingsPanel />);

    expect(await screen.findByRole('switch', { name: 'IP-Insights aus lokalen Datenbanken' })).toBeDisabled();
  });

  test('turning raw metadata off also saves IP insights as disabled', async () => {
    const enabledPolicy = { ...policy, ipInsightsEnabled: true };
    const invoke = jest.mocked(invokeRenderer);
    invoke.mockResolvedValueOnce(enabledPolicy).mockResolvedValueOnce({ ...enabledPolicy, collectRawMetadata: false, ipInsightsEnabled: false });
    render(<TrackingSettingsPanel />);

    fireEvent.click(await screen.findByRole('switch', { name: 'IP-Adresse und User-Agent verschlüsselt speichern' }));
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));

    await waitFor(() => expect(invoke).toHaveBeenCalledWith(IPCChannels.Email.SetEmailTrackingSettings,
      expect.objectContaining({ collectRawMetadata: false, ipInsightsEnabled: false })));
  });

  test('turning derived metadata off also saves IP insights as disabled', async () => {
    const enabledPolicy = { ...policy, collectRawMetadata: false, ipInsightsEnabled: true };
    const invoke = jest.mocked(invokeRenderer);
    invoke.mockResolvedValueOnce(enabledPolicy).mockResolvedValueOnce({ ...enabledPolicy, collectDerivedMetadata: false, ipInsightsEnabled: false });
    render(<TrackingSettingsPanel />);

    fireEvent.click(await screen.findByRole('switch', { name: 'Abgeleitete Geräte- und Clientdaten speichern' }));
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));

    await waitFor(() => expect(invoke).toHaveBeenCalledWith(IPCChannels.Email.SetEmailTrackingSettings,
      expect.objectContaining({ collectDerivedMetadata: false, ipInsightsEnabled: false })));
  });

  test('ignores settings loaded for a previous authenticated principal', async () => {
    const first = deferred<typeof policy>();
    const second = deferred<typeof policy>();
    const invoke = jest.mocked(invokeRenderer);
    invoke.mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise);

    const view = render(<TrackingSettingsPanel />);
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));

    mockUser = { id: 'admin-2', role: 'admin' };
    view.rerender(<TrackingSettingsPanel />);
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));

    await act(async () => {
      first.resolve({ ...policy, publicBaseUrl: 'https://admin-a.example' });
      await first.promise;
    });
    expect(screen.queryByText('https://admin-a.example')).not.toBeInTheDocument();

    await act(async () => {
      second.resolve({ ...policy, publicBaseUrl: 'https://admin-b.example' });
      await second.promise;
    });
    expect(await screen.findByText('https://admin-b.example')).toBeInTheDocument();
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}
