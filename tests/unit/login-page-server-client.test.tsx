import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

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

const defaultLoginConfig = {
  captcha: { enabled: false, provider: null, siteKey: null },
  pinKeypad: { enabled: false },
  mfa: { enabled: false, methods: [] },
  user: null,
};

describe('LoginPage server-client mode', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    mockNavigate.mockReset();
    mockLogin.mockReset();
    mockRefresh.mockReset();
    resetRendererTransportForTests();
    delete (window as any).electronAPI;
    window.localStorage.clear();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    resetRendererTransportForTests();
    delete (window as any).electronAPI;
    window.localStorage.clear();
  });

  test('shows loading state until setup-state is resolved', async () => {
    let resolveFetch: (value: Response) => void = () => {};
    global.fetch = jest.fn().mockImplementation((url: string) => {
      if (String(url).includes('/auth/setup-state')) {
        return new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        });
      }
      if (String(url).includes('/auth/login-config')) {
        return Promise.resolve(jsonResponse({ data: defaultLoginConfig }));
      }
      return Promise.reject(new Error(`unexpected fetch ${url}`));
    }) as typeof fetch;
    configureRendererTransport(createHttpRendererTransport({ baseUrl: 'https://crm.example.com' }));

    render(<LoginPage />);

    expect(screen.getByText(/Setup-Status wird geladen/)).toBeInTheDocument();

    await act(async () => {
      resolveFetch(jsonResponse({ data: { needsInitialSetup: false } }));
    });
    expect(await screen.findByLabelText('E-Mail')).toBeInTheDocument();
    expect(screen.queryByText(/Setup-Status wird geladen/)).not.toBeInTheDocument();
  });

  test('labels initial setup as server owner setup without local setup token', async () => {
    global.fetch = jest.fn().mockImplementation((url: string) => {
      if (String(url).includes('/auth/setup-state')) {
        return Promise.resolve(jsonResponse({ data: { needsInitialSetup: true } }));
      }
      return Promise.reject(new Error(`unexpected fetch ${url}`));
    }) as typeof fetch;
    configureRendererTransport(createHttpRendererTransport({ baseUrl: 'https://crm.example.com' }));

    render(<LoginPage />);

    expect(await screen.findByText(/ersten Server-Owner/)).toBeInTheDocument();
    expect(screen.getByLabelText('E-Mail')).toHaveAttribute('type', 'email');
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

  test('validates email before server initial setup submit', async () => {
    global.fetch = jest.fn().mockImplementation((url: string) => {
      if (String(url).includes('/auth/setup-state')) {
        return Promise.resolve(jsonResponse({ data: { needsInitialSetup: true } }));
      }
      return Promise.reject(new Error(`unexpected fetch ${url}`));
    }) as typeof fetch;
    configureRendererTransport(createHttpRendererTransport({ baseUrl: 'https://crm.example.com' }));

    render(<LoginPage />);
    await screen.findByText(/ersten Server-Owner/);

    fireEvent.change(screen.getByLabelText('E-Mail'), { target: { value: 'not-an-email' } });
    fireEvent.change(screen.getByLabelText('Neues Passwort'), { target: { value: 'secure-pass-1' } });
    fireEvent.change(screen.getByLabelText('Passwort wiederholen'), { target: { value: 'secure-pass-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Owner-Konto anlegen' }));

    expect(await screen.findByText(/gueltige E-Mail-Adresse/)).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalledWith(
      expect.stringContaining('/auth/initial-setup'),
      expect.anything(),
    );
  });

  test('keeps initial setup submit disabled until password policy and confirmation match', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce(jsonResponse({
      data: { needsInitialSetup: true },
    })) as typeof fetch;
    configureRendererTransport(createHttpRendererTransport({ baseUrl: 'https://crm.example.com' }));

    render(<LoginPage />);
    await screen.findByText(/ersten Server-Owner/);

    const submit = screen.getByRole('button', { name: 'Owner-Konto anlegen' });
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByLabelText('E-Mail'), { target: { value: 'owner@example.com' } });
    fireEvent.change(screen.getByLabelText('Neues Passwort'), { target: { value: 'short-pass' } });
    fireEvent.change(screen.getByLabelText('Passwort wiederholen'), { target: { value: 'short-pass' } });
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Neues Passwort'), { target: { value: 'secure-pass-1' } });
    fireEvent.change(screen.getByLabelText('Passwort wiederholen'), { target: { value: 'secure-pass-2' } });
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Passwort wiederholen'), { target: { value: 'secure-pass-1' } });
    expect(submit).toBeEnabled();
  });

  test('rejects too-short password on initial setup submit', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce(jsonResponse({
      data: { needsInitialSetup: true },
    })) as typeof fetch;
    configureRendererTransport(createHttpRendererTransport({ baseUrl: 'https://crm.example.com' }));

    render(<LoginPage />);
    await screen.findByText(/ersten Server-Owner/);

    fireEvent.change(screen.getByLabelText('E-Mail'), { target: { value: 'owner@example.com' } });
    fireEvent.change(screen.getByLabelText('Neues Passwort'), { target: { value: 'short-pass' } });
    fireEvent.change(screen.getByLabelText('Passwort wiederholen'), { target: { value: 'short-pass' } });
    fireEvent.submit(screen.getByRole('button', { name: 'Owner-Konto anlegen' }).closest('form')!);

    expect(await screen.findByText(/mindestens 12 Zeichen/)).toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test('logs in after successful server initial setup and remembers email', async () => {
    global.fetch = jest.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (String(url).includes('/auth/setup-state')) {
        return Promise.resolve(jsonResponse({ data: { needsInitialSetup: true } }));
      }
      if (String(url).includes('/auth/initial-setup') && init?.method === 'POST') {
        return Promise.resolve(jsonResponse({
          data: {
            user: {
              id: 'user-1',
              workspaceId: 'ws-1',
              email: 'owner@example.com',
              displayName: 'owner@example.com',
              role: 'owner',
            },
            tokens: {
              accessToken: 'access',
              refreshToken: 'refresh',
              expiresInSeconds: 3600,
            },
          },
        }, 201));
      }
      return Promise.reject(new Error(`unexpected fetch ${url}`));
    }) as typeof fetch;
    mockLogin.mockResolvedValue({ ok: true });
    configureRendererTransport(createHttpRendererTransport({ baseUrl: 'https://crm.example.com' }));

    render(<LoginPage />);
    await screen.findByText(/ersten Server-Owner/);

    fireEvent.change(screen.getByLabelText('E-Mail'), { target: { value: 'Owner@Example.com' } });
    fireEvent.change(screen.getByLabelText('Neues Passwort'), { target: { value: 'secure-pass-1' } });
    fireEvent.change(screen.getByLabelText('Passwort wiederholen'), { target: { value: 'secure-pass-1' } });
    fireEvent.change(screen.getByLabelText('Initial-Setup-Token'), { target: { value: 'setup-token-secret' } });
    fireEvent.click(screen.getByRole('button', { name: 'Owner-Konto anlegen' }));

    await waitFor(() => expect(mockLogin).toHaveBeenCalledWith('owner@example.com', 'secure-pass-1'));
    expect(window.localStorage.getItem('simplecrm:last-login-email')).toBe('owner@example.com');
    expect(mockNavigate).toHaveBeenCalledWith({ to: '/' });
  });

  test('shows login button when pin keypad is enabled but account has no pin', async () => {
    global.fetch = jest.fn().mockImplementation((url: string) => {
      if (String(url).includes('/auth/setup-state')) {
        return Promise.resolve(jsonResponse({ data: { needsInitialSetup: false } }));
      }
      if (String(url).includes('/auth/login-config')) {
        return Promise.resolve(jsonResponse({
          data: {
            captcha: { enabled: false, provider: null, siteKey: null },
            pinKeypad: { enabled: true },
            mfa: { enabled: false, methods: [] },
            user: {
              pinRequired: false,
              mfaRequired: false,
              mfaMethod: null,
            },
          },
        }));
      }
      return Promise.reject(new Error(`unexpected fetch ${url}`));
    }) as typeof fetch;
    configureRendererTransport(createHttpRendererTransport({ baseUrl: 'https://crm.example.com' }));

    render(<LoginPage />);

    expect(await screen.findByRole('button', { name: 'Anmelden' })).toBeInTheDocument();
    expect(screen.getByText(/kein Login-PIN hinterlegt/)).toBeInTheDocument();
    expect(screen.queryByText(/Geben Sie Ihren 6-stelligen Login-PIN ein/)).not.toBeInTheDocument();
  });

  test('shows pin keypad when account requires a login pin', async () => {
    global.fetch = jest.fn().mockImplementation((url: string) => {
      if (String(url).includes('/auth/setup-state')) {
        return Promise.resolve(jsonResponse({ data: { needsInitialSetup: false } }));
      }
      if (String(url).includes('/auth/login-config')) {
        return Promise.resolve(jsonResponse({
          data: {
            captcha: { enabled: false, provider: null, siteKey: null },
            pinKeypad: { enabled: true },
            mfa: { enabled: false, methods: [] },
            user: {
              pinRequired: true,
              mfaRequired: false,
              mfaMethod: null,
            },
          },
        }));
      }
      return Promise.reject(new Error(`unexpected fetch ${url}`));
    }) as typeof fetch;
    configureRendererTransport(createHttpRendererTransport({ baseUrl: 'https://crm.example.com' }));

    render(<LoginPage />);

    expect(await screen.findByText(/Geben Sie Ihren 6-stelligen Login-PIN ein/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Anmelden' })).not.toBeInTheDocument();
  });

  test('prefills remembered email on login form', async () => {
    window.localStorage.setItem('simplecrm:last-login-email', 'owner@example.com');
    global.fetch = jest.fn().mockImplementation((url: string) => {
      if (String(url).includes('/auth/setup-state')) {
        return Promise.resolve(jsonResponse({ data: { needsInitialSetup: false } }));
      }
      if (String(url).includes('/auth/login-config')) {
        return Promise.resolve(jsonResponse({ data: defaultLoginConfig }));
      }
      return Promise.reject(new Error(`unexpected fetch ${url}`));
    }) as typeof fetch;
    configureRendererTransport(createHttpRendererTransport({ baseUrl: 'https://crm.example.com' }));

    render(<LoginPage />);

    expect(await screen.findByLabelText('E-Mail')).toHaveValue('owner@example.com');
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  } as Response;
}
