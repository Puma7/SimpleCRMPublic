import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { toast } from 'sonner';

const mockUseAuth = jest.fn();
jest.mock('@/components/auth/auth-context', () => ({
  useAuth: () => mockUseAuth(),
}));
jest.mock('sonner', () => ({
  toast: { error: jest.fn(), success: jest.fn() },
}));

import SettingsPage from '@/app/settings/page';
import {
  configureRendererTransport,
  createHttpRendererTransport,
  resetRendererTransportForTests,
} from '@/services/transport';

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  } as Response;
}

const STORED = {
  server: 'sql.legit.example',
  database: 'eazybusiness',
  user: 'crm',
  port: 1433,
  encrypt: true,
  trustServerCertificate: false,
  forcePort: false,
  hasPassword: true,
};

// F-A13A14-11 (E11): the server now refuses a new MSSQL server, port or
// instance without the password; the settings page asks for it up front.
describe('SettingsPage MSSQL server change', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseAuth.mockReturnValue({
      user: { id: 'owner-1', role: 'owner' },
      loading: false,
      canWriteCrm: true,
      hasCapability: () => true,
    });
    resetRendererTransportForTests();
    (globalThis as any).ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  });

  afterEach(() => {
    delete (globalThis as any).ResizeObserver;
    resetRendererTransportForTests();
  });

  test('requires the password before testing or saving a changed server', async () => {
    const fetchImpl = jest.fn(async (url: string, _init?: RequestInit) => {
      if (url.endsWith('/api/v1/mssql/settings')) return jsonResponse({ data: STORED });
      if (url.endsWith('/api/v1/mssql/test-connection')) return jsonResponse({ data: { success: true } });
      return jsonResponse({ data: null });
    });
    configureRendererTransport(createHttpRendererTransport({
      baseUrl: 'https://crm.example.com',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    }));
    const mutations = () => fetchImpl.mock.calls.filter(([url, init]) => (
      String(url).endsWith('/api/v1/mssql/test-connection') && (init as RequestInit | undefined)?.body !== undefined
        && JSON.parse(String((init as RequestInit).body)).server !== STORED.server
    ) || (init as RequestInit | undefined)?.method === 'PATCH');

    render(<SettingsPage />);
    const serverInput = await screen.findByDisplayValue('sql.legit.example');
    await waitFor(() => expect(fetchImpl.mock.calls.some(([url]) => String(url).endsWith('/test-connection'))).toBe(true));

    fireEvent.change(serverInput, { target: { value: 'sql.attacker.example' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Einstellungen speichern' }));
    });

    expect(toast.error).toHaveBeenCalledWith(
      'Zugangsdaten bei Serverwechsel neu eingeben',
      expect.objectContaining({ description: expect.stringContaining('Passwort') }),
    );
    expect(mutations()).toHaveLength(0);

    fireEvent.change(screen.getByPlaceholderText(/leer lassen/i), { target: { value: 'neues-passwort' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Einstellungen speichern' }));
    });

    await waitFor(() => expect(fetchImpl.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === 'PATCH')).toBe(true));
    const patch = fetchImpl.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === 'PATCH');
    expect(JSON.parse(String((patch?.[1] as RequestInit).body))).toMatchObject({
      server: 'sql.attacker.example',
      password: 'neues-passwort',
    });
  });
});
