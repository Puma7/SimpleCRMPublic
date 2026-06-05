import { render, screen, waitFor } from '@testing-library/react';

import SettingsPage from '@/app/settings/page';
import {
  configureRendererTransport,
  createHttpRendererTransport,
  resetRendererTransportForTests,
} from '@/services/transport';

describe('SettingsPage server-client sync controls', () => {
  beforeEach(() => {
    resetRendererTransportForTests();
    (globalThis as any).ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  });

  afterEach(() => {
    delete (window as any).electronAPI;
    delete (globalThis as any).ResizeObserver;
    resetRendererTransportForTests();
  });

  test('uses server JTL sync status without local IPC when HTTP transport is active', async () => {
    const localInvoke = jest.fn();
    const fetchImpl = jest.fn((url: string) => {
      if (url.endsWith('/api/v1/jtl/sync/status')) {
        return Promise.resolve(jsonResponse({
          data: {
            status: 'Success',
            message: 'Server sync ok',
            timestamp: '2026-06-05T10:00:00.000Z',
          },
        }));
      }
      return Promise.resolve(jsonResponse({ data: null }));
    });
    (window as any).electronAPI = { invoke: localInvoke };
    configureRendererTransport(createHttpRendererTransport({
      baseUrl: 'https://crm.example.com',
      fetchImpl: fetchImpl as typeof fetch,
    }));

    render(<SettingsPage />);

    await waitFor(() => expect(fetchImpl).toHaveBeenCalledWith(
      'https://crm.example.com/api/v1/mssql/settings',
      expect.objectContaining({ method: 'GET' }),
    ));
    await waitFor(() => expect(fetchImpl).toHaveBeenCalledWith(
      'https://crm.example.com/api/v1/jtl/sync/status',
      expect.objectContaining({ method: 'GET' }),
    ));
    expect(screen.getByRole('button', { name: 'Synchronisation starten' })).toBeEnabled();
    expect(localInvoke).not.toHaveBeenCalledWith('sync:get-status');
    expect(localInvoke).not.toHaveBeenCalledWith('sync:run');
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  } as Response;
}
