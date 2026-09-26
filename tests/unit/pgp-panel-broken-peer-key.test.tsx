import { render, screen } from '@testing-library/react';

import { IPCChannels } from '@shared/ipc/channels';

const mockInvokeRenderer = jest.fn();
jest.mock('@/services/transport', () => ({
  getRendererTransport: () => ({ kind: 'ipc' }),
  invokeRenderer: (...args: unknown[]) => mockInvokeRenderer(...args),
  isMailPgpKeyRefreshEvent: () => false,
  subscribeServerEvents: jest.fn(() => ({ unsubscribe: jest.fn() })),
}));

import { PgpPanel } from '@/components/email/settings/pgp-panel';

describe('PgpPanel peer keys', () => {
  beforeEach(() => {
    mockInvokeRenderer.mockReset();
    mockInvokeRenderer.mockImplementation(async (channel: string) => {
      if (channel === IPCChannels.Pgp.ListIdentities) return [];
      if (channel === IPCChannels.Pgp.ListPeerKeys) {
        return [
          { id: 1, email: '[object Object]', fingerprint: 'aa', trust_level: 'imported', source: 'manual' },
          { id: 2, email: 'bob@example.com', fingerprint: 'bb', trust_level: 'imported', source: 'manual' },
        ];
      }
      throw new Error(`unexpected channel ${channel}`);
    });
  });

  // F-A7b-08: Frueher falsch importierte Schluessel (E-Mail '[object Object]') muessen als "neu importieren" erkennbar sein.
  test('flags keys stored without an e-mail address for re-import and keeps them listed', async () => {
    render(<PgpPanel />);

    expect(await screen.findByText(/bitte neu importieren/i)).toBeTruthy();
    expect(screen.getAllByText(/bitte neu importieren/i)).toHaveLength(1);
    expect(screen.getByText(/bob@example\.com/)).toBeTruthy();
    expect(screen.queryByText(/\[object Object\]/)).toBeNull();
    expect(mockInvokeRenderer).not.toHaveBeenCalledWith(IPCChannels.Pgp.DeletePeerKey, expect.anything());
  });
});
