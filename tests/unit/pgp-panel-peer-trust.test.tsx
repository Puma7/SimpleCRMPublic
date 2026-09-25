import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { IPCChannels } from '@shared/ipc/channels';

const mockInvokeRenderer = jest.fn();
let mockTransportKind: 'ipc' | 'http' = 'ipc';
jest.mock('@/services/transport', () => ({
  getRendererTransport: () => ({ kind: mockTransportKind }),
  invokeRenderer: (...args: unknown[]) => mockInvokeRenderer(...args),
  isMailPgpKeyRefreshEvent: () => false,
  subscribeServerEvents: jest.fn(() => ({ unsubscribe: jest.fn() })),
}));

import { PgpPanel } from '@/components/email/settings/pgp-panel';

const peers = [
  { id: 1, email: '[object Object]', fingerprint: 'aa', trust_level: 'imported', source: 'manual' },
  { id: 2, email: 'bob@example.com', fingerprint: 'b0b0b0b0c1c1c1c1', trust_level: 'imported', source: 'manual' },
  { id: 3, email: 'eve@example.com', fingerprint: 'e5e5e5e5', trust_level: 'verified', source: 'manual' },
];

describe('PgpPanel peer key trust (desktop)', () => {
  beforeEach(() => {
    mockTransportKind = 'ipc';
    mockInvokeRenderer.mockReset();
    mockInvokeRenderer.mockImplementation(async (channel: string, payload?: { trustLevel?: string }) => {
      if (channel === IPCChannels.Pgp.ListIdentities) return [];
      if (channel === IPCChannels.Pgp.ListPeerKeys) return peers;
      if (channel === IPCChannels.Pgp.SetPeerKeyTrust) return { success: true, trustLevel: payload?.trustLevel };
      throw new Error(`unexpected channel ${channel}`);
    });
  });

  // F-A7b-08: Es gab keine Aktion, einen Peer-Schluessel als verifiziert zu markieren; gueltige Signaturen wurden nie gruen.
  test('marks a key as verified after the fingerprint was confirmed', async () => {
    const confirm = jest.spyOn(window, 'confirm').mockReturnValue(true);
    render(<PgpPanel />);

    const buttons = await screen.findAllByRole('button', { name: 'Als verifiziert markieren' });
    // Der kaputt importierte Schluessel (ohne E-Mail) bekommt keinen Knopf.
    expect(buttons).toHaveLength(1);
    fireEvent.click(buttons[0]);

    await waitFor(() => expect(mockInvokeRenderer).toHaveBeenCalledWith(
      IPCChannels.Pgp.SetPeerKeyTrust,
      { id: 2, trustLevel: 'verified' },
    ));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('B0B0 B0B0 C1C1 C1C1'));
  });

  test('does nothing when the fingerprint check is cancelled', async () => {
    jest.spyOn(window, 'confirm').mockReturnValue(false);
    render(<PgpPanel />);

    fireEvent.click(await screen.findByRole('button', { name: 'Als verifiziert markieren' }));

    expect(mockInvokeRenderer).not.toHaveBeenCalledWith(IPCChannels.Pgp.SetPeerKeyTrust, expect.anything());
  });

  test('revokes the trust of a verified key', async () => {
    render(<PgpPanel />);

    fireEvent.click(await screen.findByRole('button', { name: 'Vertrauen entziehen' }));

    await waitFor(() => expect(mockInvokeRenderer).toHaveBeenCalledWith(
      IPCChannels.Pgp.SetPeerKeyTrust,
      { id: 3, trustLevel: 'imported' },
    ));
  });

  test('offers no trust action in server mode (no HTTP mapping)', async () => {
    mockTransportKind = 'http';
    render(<PgpPanel />);

    expect(await screen.findByText(/bob@example\.com/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Als verifiziert markieren' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Vertrauen entziehen' })).toBeNull();
  });
});
