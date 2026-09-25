import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AuthGate } from '@/components/auth/auth-gate';
import { AuthProvider, useAuth } from '@/components/auth/auth-context';
import { UserSwitcher } from '@/components/auth/user-switcher';
import {
  buildServerAuthSession,
  clearServerAuthSession,
  configureRendererTransport,
  createHttpRendererTransport,
  resetRendererTransportForTests,
  saveServerAuthSession,
} from '@/services/transport';
import { IPCChannels } from '../../shared/ipc/channels';

const mockNavigate = jest.fn();
const mockToastError = jest.fn();

jest.mock('sonner', () => ({
  toast: {
    error: (...args: unknown[]) => mockToastError(...args),
    success: jest.fn(),
    info: jest.fn(),
    warning: jest.fn(),
  },
}));

jest.mock('@tanstack/react-router', () => ({
  useNavigate: () => mockNavigate,
  useRouterState: ({ select }: { select: (state: { location: { pathname: string } }) => string }) =>
    select({ location: { pathname: '/' } }),
}));

describe('AuthProvider server-client mode', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    mockNavigate.mockReset();
    mockToastError.mockReset();
    window.localStorage.clear();
    window.sessionStorage.clear();
    clearServerAuthSession();
    delete (window as any).electronAPI;
    resetRendererTransportForTests();
    clearServerAuthSession();
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
        expiresInSeconds: 900,
      },
    }), 'csrf-stored', undefined, undefined, 'https://crm.example.com');

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
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(jsonResponse({
        error: { code: 'refresh_cookie_required', message: 'Keine aktive Browser-Sitzung' },
      }, 401))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          user: serverUser({ email: 'owner@example.com', displayName: 'Owner HTTP' }),
          tokens: {
            accessToken: 'access-http',
            expiresInSeconds: 900,
          },
          csrfToken: 'csrf-http',
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
    expect(fetchImpl).toHaveBeenLastCalledWith(
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
    expect(window.sessionStorage.getItem('simplecrm.accessToken')).toBeNull();
  });

  test('refreshes server session automatically before access token expiry', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-06-03T10:00:00.000Z'));
    const fetchImpl = jest.fn().mockResolvedValueOnce(jsonResponse({
      data: {
        user: serverUser({ displayName: 'Owner Refreshed' }),
        tokens: {
          accessToken: 'access-refreshed',
          expiresInSeconds: 900,
        },
        csrfToken: 'csrf-refreshed',
      },
    }));
    global.fetch = fetchImpl as typeof fetch;
    saveServerAuthSession(buildServerAuthSession({
      user: serverUser({ displayName: 'Owner Stored' }),
      tokens: {
        accessToken: 'access-stored',
        expiresInSeconds: 120,
      },
      now: new Date('2026-06-03T10:00:00.000Z'),
    }), 'csrf-stored', undefined, undefined, 'https://crm.example.com');

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
        credentials: 'include',
        headers: expect.objectContaining({
          'X-CSRF-Token': 'csrf-stored',
        }),
      }),
    );
    expect((fetchImpl.mock.calls[0]?.[1] as RequestInit)).not.toHaveProperty('body');
    expect(window.sessionStorage.getItem('simplecrm.accessToken')).toBeNull();
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
  function renderSignedInWithLogoutResponse(logoutResponse: () => Response) {
    saveServerAuthSession(buildServerAuthSession({
      user: serverUser({ displayName: 'Server Owner' }),
      tokens: { accessToken: 'access-stored', expiresInSeconds: 900 },
    }), 'csrf-stored', undefined, undefined, 'https://crm.example.com');
    const fetchImpl = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/v1/auth/logout')) return logoutResponse();
      if (url.includes('/api/v1/auth/capabilities')) {
        return jsonResponse({ data: { role: 'owner', capabilities: [] } });
      }
      return jsonResponse({ data: null }, 404);
    });
    global.fetch = fetchImpl as unknown as typeof fetch;
    configureRendererTransport(createHttpRendererTransport({
      baseUrl: 'https://crm.example.com',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    }));
    render(
      <AuthProvider>
        <Probe />
        <UserSwitcher />
      </AuthProvider>,
    );
    return fetchImpl;
  }

  // F-A11b-07: Scheiterte das Abmelden am Server, blieb die Oberflaeche ohne Hinweis haengen;
  // die Rejection blieb unbehandelt und der naechste Klick verwarf nur die lokale Sitzung.
  test('failed server logout keeps the user signed in and shows an error toast', async () => {
    const fetchImpl = renderSignedInWithLogoutResponse(() => jsonResponse({
      error: { code: 'internal_error', message: 'kaputt' },
    }, 500));
    expect(await screen.findByTestId('auth-status')).toHaveTextContent('authenticated');

    fireEvent.click(screen.getByTitle('Abmelden'));

    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith(
      'Abmelden fehlgeschlagen – Sie sind weiterhin angemeldet. Bitte erneut versuchen.',
    ));
    expect(screen.getByTestId('auth-status')).toHaveTextContent('authenticated');
    expect(mockNavigate).not.toHaveBeenCalledWith({ to: '/login' });

    // The stored session survived, so a second click really revokes it again.
    fireEvent.click(screen.getByTitle('Abmelden'));
    await waitFor(() => expect(mockToastError).toHaveBeenCalledTimes(2));
    const logoutCalls = fetchImpl.mock.calls.filter(([url]) => String(url).endsWith('/api/v1/auth/logout'));
    expect(logoutCalls).toHaveLength(2);
    expect(logoutCalls[1]?.[1]).toEqual(expect.objectContaining({
      headers: expect.objectContaining({ 'X-CSRF-Token': 'csrf-stored' }),
    }));
  });

  test('successful server logout signs out and navigates to the login page', async () => {
    renderSignedInWithLogoutResponse(() => jsonResponse({ data: { revoked: true } }));
    expect(await screen.findByTestId('auth-status')).toHaveTextContent('authenticated');

    fireEvent.click(screen.getByTitle('Abmelden'));

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith({ to: '/login' }));
    expect(screen.getByTestId('auth-status')).toHaveTextContent('anonymous');
    expect(mockToastError).not.toHaveBeenCalled();
  });

  test('capabilities are never reported ready with an empty list for a fresh user session', async () => {
    // Sonst sieht ein Gate im ersten Render "fertig geladen, keine Rechte" und
    // leitet um, bevor die Liste ueberhaupt angefragt wurde.
    let resolveCapabilities: ((value: unknown) => void) | null = null;
    const capabilitiesPromise = new Promise((resolve) => {
      resolveCapabilities = resolve;
    });
    saveServerAuthSession(buildServerAuthSession({
      user: serverUser({ role: 'user', displayName: 'Delegierter' }),
      tokens: { accessToken: 'access-stored', expiresInSeconds: 900 },
    }), 'csrf-stored', undefined, undefined, 'https://crm.example.com');
    const fetchImpl = jest.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/api/v1/auth/capabilities')) {
        await capabilitiesPromise;
        return jsonResponse({ data: { role: 'user', capabilities: ['settings.view'] } });
      }
      return jsonResponse({ data: null }, 404);
    });
    configureRendererTransport(createHttpRendererTransport({
      baseUrl: 'https://crm.example.com',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    }));

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    expect(await screen.findByTestId('auth-status')).toHaveTextContent('authenticated');
    // Solange die Liste laeuft: NICHT ready — und damit kein falsches "kein Recht".
    expect(screen.getByTestId('caps-ready')).toHaveTextContent('pending');

    await act(async () => {
      resolveCapabilities?.(null);
      await Promise.resolve();
    });

    await waitFor(() => expect(screen.getByTestId('caps-ready')).toHaveTextContent('ready'));
    expect(screen.getByTestId('caps-settings')).toHaveTextContent('yes');
  });
});

function Probe() {
  const auth = useAuth();
  return (
    <div>
      <div data-testid="auth-status">
        {auth.loading ? 'loading' : auth.authenticated ? 'authenticated' : 'anonymous'}
      </div>
      <div data-testid="caps-ready">{auth.capabilitiesReady ? 'ready' : 'pending'}</div>
      <div data-testid="caps-settings">{auth.canViewSettings ? 'yes' : 'no'}</div>
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
