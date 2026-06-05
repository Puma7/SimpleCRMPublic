import { render, screen, waitFor } from '@testing-library/react';

import LoginPage from '@/app/login/page';
import {
  configureRendererTransport,
  createHttpRendererTransport,
  resetRendererTransportForTests,
} from '@/services/transport';

const mockNavigate = jest.fn();
const mockLogin = jest.fn();
const mockRefresh = jest.fn();

jest.mock('@tanstack/react-router', () => ({
  useNavigate: () => mockNavigate,
}));

jest.mock('@/components/auth/auth-context', () => ({
  useAuth: () => ({
    login: mockLogin,
    refresh: mockRefresh,
  }),
}));

describe('LoginPage server-client mode', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    mockNavigate.mockReset();
    mockLogin.mockReset();
    mockRefresh.mockReset();
    resetRendererTransportForTests();
    delete (window as any).electronAPI;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    resetRendererTransportForTests();
    delete (window as any).electronAPI;
  });

  test('labels initial setup as server owner setup without local setup token', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce(jsonResponse({
      data: { needsInitialSetup: true },
    })) as typeof fetch;
    configureRendererTransport(createHttpRendererTransport({ baseUrl: 'https://crm.example.com' }));

    render(<LoginPage />);

    expect(await screen.findByText(/ersten Server-Owner/)).toBeInTheDocument();
    expect(screen.getByLabelText('E-Mail')).toBeInTheDocument();
    expect(screen.queryByLabelText('Setup-Token')).not.toBeInTheDocument();
    expect(screen.queryByText(/lokales Administratorkonto/)).not.toBeInTheDocument();
  });

  test('does not read local setup state when HTTP transport has no server URL', async () => {
    const localInvoke = jest.fn();
    (window as any).electronAPI = { invoke: localInvoke };
    configureRendererTransport({
      kind: 'http',
      invoke: jest.fn(),
    } as any);

    render(<LoginPage />);

    await waitFor(() => expect(screen.getByText(
      'Server-URL fehlt. Anmeldung wurde nicht gestartet.',
    )).toBeInTheDocument());
    expect(localInvoke).not.toHaveBeenCalled();
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  } as Response;
}
