import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AuthGate } from '@/components/auth/auth-gate';
import { AuthProvider, useAuth } from '@/components/auth/auth-context';
import {
  buildServerAuthSession,
  configureRendererTransport,
  createHttpRendererTransport,
  resetRendererTransportForTests,
  saveServerAuthSession,
} from '@/services/transport';
import { IPCChannels } from '../../shared/ipc/channels';

const mockNavigate = jest.fn();

jest.mock('@tanstack/react-router', () => ({
  useNavigate: () => mockNavigate,
  useRouterState: ({ select }: { select: (state: { location: { pathname: string } }) => string }) =>
    select({ location: { pathname: '/' } }),
}));

describe('AuthProvider server-client mode', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    mockNavigate.mockReset();
    window.localStorage.clear();
    window.sessionStorage.clear();
    delete (window as any).electronAPI;
    resetRendererTransportForTests();
    configureRendererTransport(createHttpRendererTransport({ baseUrl: 'https://crm.example.com' }));
  });

  afterEach(() => {
    jest.useRealTimers();
    global.fetch = originalFetch;
    resetRendererTransportForTests();
  });

  test('hydrates authenticated state from stored server session', async () => {
    saveServerAuthSession(buildServerAuthSession({
      user: serverUser({ displayName: 'Server Owner' }),
      tokens: {
        accessToken: 'access-stored',
        refreshToken: 'refresh-stored',
        expiresInSeconds: 900,
      },
    }));

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    expect(await screen.findByTestId('auth-status')).toHaveTextContent('authenticated');
    expect(screen.getByTestId('auth-user')).toHaveTextContent('Server Owner');
    expect(screen.getByTestId('auth-required')).toHaveTextContent('required');
  });

  test('logs in through server auth client when HTTP transport is active', async () => {
    const fetchImpl = jest.fn().mockResolvedValueOnce(jsonResponse({
      data: {
        user: serverUser({ email: 'owner@example.com', displayName: 'Owner HTTP' }),
        tokens: {
          accessToken: 'access-http',
          refreshToken: 'refresh-http',
          expiresInSeconds: 900,
        },
      },
    }));
    global.fetch = fetchImpl as typeof fetch;

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    await screen.findByTestId('auth-status');
    fireEvent.click(screen.getByRole('button', { name: 'login' }));

    await waitFor(() => expect(screen.getByTestId('auth-status')).toHaveTextContent('authenticated'));
    expect(screen.getByTestId('auth-user')).toHaveTextContent('Owner HTTP');
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://crm.example.com/api/v1/auth/login',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          email: 'owner@example.com',
          password: 'passphrase',
          device: 'simplecrm-renderer',
        }),
      }),
    );
    expect(window.sessionStorage.getItem('simplecrm.accessToken')).toBe('access-http');
  });

  test('refreshes server session automatically before access token expiry', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-06-03T10:00:00.000Z'));
    const fetchImpl = jest.fn().mockResolvedValueOnce(jsonResponse({
      data: {
        user: serverUser({ displayName: 'Owner Refreshed' }),
        tokens: {
          accessToken: 'access-refreshed',
          refreshToken: 'refresh-refreshed',
          expiresInSeconds: 900,
        },
      },
    }));
    global.fetch = fetchImpl as typeof fetch;
    saveServerAuthSession(buildServerAuthSession({
      user: serverUser({ displayName: 'Owner Stored' }),
      tokens: {
        accessToken: 'access-stored',
        refreshToken: 'refresh-stored',
        expiresInSeconds: 120,
      },
      now: new Date('2026-06-03T10:00:00.000Z'),
    }));

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    await act(async () => undefined);
    expect(screen.getByTestId('auth-status')).toHaveTextContent('authenticated');
    expect(screen.getByTestId('auth-user')).toHaveTextContent('Owner Stored');

    await act(async () => {
      jest.advanceTimersByTime(90_000);
      await Promise.resolve();
    });

    await waitFor(() => expect(screen.getByTestId('auth-user')).toHaveTextContent('Owner Refreshed'));
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://crm.example.com/api/v1/auth/refresh',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ refreshToken: 'refresh-stored' }),
      }),
    );
    expect(window.sessionStorage.getItem('simplecrm.accessToken')).toBe('access-refreshed');
  });

  test('auth gate reads server setup state instead of local Electron IPC in HTTP transport', async () => {
    const localInvoke = jest.fn();
    (window as any).electronAPI = { invoke: localInvoke };
    const fetchImpl = jest.fn().mockResolvedValueOnce(jsonResponse({
      data: { needsInitialSetup: true },
    }));
    global.fetch = fetchImpl as typeof fetch;

    render(
      <AuthProvider>
        <AuthGate>
          <div>Protected app</div>
        </AuthGate>
      </AuthProvider>,
    );

    await waitFor(() => expect(fetchImpl).toHaveBeenCalledWith(
      'https://crm.example.com/api/v1/auth/setup-state',
      expect.objectContaining({ method: 'GET' }),
    ));
    expect(localInvoke).not.toHaveBeenCalledWith(IPCChannels.Auth.GetSetupState, undefined);
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith({ to: '/login' }));
  });

  test('HTTP auth mode without server URL fails closed instead of using local IPC or public web fallback', async () => {
    const localInvoke = jest.fn();
    (window as any).electronAPI = { invoke: localInvoke };
    configureRendererTransport({
      kind: 'http',
      invoke: jest.fn(),
    } as any);

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('auth-status')).toHaveTextContent('anonymous'));
    expect(screen.getByTestId('auth-required')).toHaveTextContent('required');
    expect(screen.getByTestId('auth-user')).toHaveTextContent('none');
    expect(localInvoke).not.toHaveBeenCalled();
  });
});

function Probe() {
  const auth = useAuth();
  return (
    <div>
      <div data-testid="auth-status">
        {auth.loading ? 'loading' : auth.authenticated ? 'authenticated' : 'anonymous'}
      </div>
      <div data-testid="auth-required">{auth.authRequired ? 'required' : 'public'}</div>
      <div data-testid="auth-user">{auth.user?.displayName ?? 'none'}</div>
      <button type="button" onClick={() => void auth.login('owner@example.com', 'passphrase')}>
        login
      </button>
    </div>
  );
}

function serverUser(overrides: Partial<ReturnType<typeof baseServerUser>> = {}) {
  return {
    ...baseServerUser(),
    ...overrides,
  };
}

function baseServerUser() {
  return {
    id: 'user-1',
    workspaceId: 'workspace-1',
    email: 'owner@example.com',
    displayName: 'Owner',
    role: 'owner',
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  } as Response;
}
