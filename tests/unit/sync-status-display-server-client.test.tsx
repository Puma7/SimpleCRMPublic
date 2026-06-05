import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { SyncStatusDisplay } from '@/components/sync-status-display';
import {
  configureRendererTransport,
  createHttpRendererTransport,
  resetRendererTransportForTests,
} from '@/services/transport';

describe('SyncStatusDisplay server-client mode', () => {
  let fetchImpl: jest.Mock<Promise<Response>, [string, RequestInit | undefined]>;

  beforeEach(() => {
    resetRendererTransportForTests();
    fetchImpl = jest.fn(async (url: string) => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        data: url.endsWith('/api/v1/jtl/sync/run')
          ? { success: true, message: 'Sync completed' }
          : { status: 'Success', timestamp: '2026-06-05T10:00:00.000Z', message: 'Synced' },
      }),
    } as Response));
    configureRendererTransport(createHttpRendererTransport({
      baseUrl: 'https://crm.example.com',
      fetchImpl,
    }));
  });

  afterEach(() => {
    delete (window as any).electronAPI;
    resetRendererTransportForTests();
  });

  test('does not call local sync IPC when HTTP transport is active', async () => {
    const invoke = jest.fn();
    const receive = jest.fn();
    (window as any).electronAPI = { invoke, receive };

    render(<SyncStatusDisplay />);

    await waitFor(() => expect(fetchImpl).toHaveBeenCalledWith(
      'https://crm.example.com/api/v1/jtl/sync/status',
      expect.objectContaining({ method: 'GET' }),
    ));
    const syncButton = screen.getByRole('button', { name: /JTL Sync/i });
    expect(syncButton).toBeEnabled();
    expect(invoke).not.toHaveBeenCalled();
    expect(receive).not.toHaveBeenCalled();

    fireEvent.click(syncButton);
    await waitFor(() => expect(fetchImpl).toHaveBeenCalledWith(
      'https://crm.example.com/api/v1/jtl/sync/run',
      expect.objectContaining({ method: 'POST' }),
    ));
    expect(invoke).not.toHaveBeenCalled();
  });
});
