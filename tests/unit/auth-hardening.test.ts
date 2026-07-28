import { createServerApi } from '../../packages/server/src/api/server-api';
import {
  ACCOUNT_WIDE_CAPTCHA_AFTER_FAILURES,
  ACCOUNT_WIDE_FAILURE_WINDOW_SECONDS,
  ACCOUNT_WIDE_THROTTLE_AFTER_FAILURES,
  accountWideLoginDefense,
} from '../../packages/server/src/auth/brute-force-policy';
import type { ServerApiPorts } from '../../packages/server/src/api/types';

const WORKSPACE = '11111111-1111-4111-8111-111111111111';

/**
 * Die gestaffelte Sperre zaehlt je (E-Mail, IP). Wer aus vielen Adressen kommt,
 * bekommt pro Adresse einen frischen Zaehler — die dauerhafte Sperre nach 50
 * Versuchen kann so nie greifen, und gegen ein einzelnes Konto blieb nur das
 * IP-Limit. Genau diese Luecke schliesst der kontoweite Zaehler.
 */
describe('kontoweite Brute-Force-Abwehr', () => {
  test('unterhalb der Schwelle bleibt der Login unveraendert', () => {
    expect(accountWideLoginDefense(0, true)).toBe('none');
    expect(accountWideLoginDefense(ACCOUNT_WIDE_CAPTCHA_AFTER_FAILURES - 1, true)).toBe('none');
  });

  test('mit Anbieter eskaliert sie zum CAPTCHA, nie zur Sperre', () => {
    expect(accountWideLoginDefense(ACCOUNT_WIDE_CAPTCHA_AFTER_FAILURES, true)).toBe('captcha');
    // Auch weit oberhalb bleibt es beim CAPTCHA: eine kontoweite Sperre koennte
    // jeder ausloesen, der die Adresse kennt.
    expect(accountWideLoginDefense(ACCOUNT_WIDE_THROTTLE_AFTER_FAILURES * 10, true)).toBe('captcha');
  });

  test('ohne Anbieter bremst sie erst spaet', () => {
    expect(accountWideLoginDefense(ACCOUNT_WIDE_CAPTCHA_AFTER_FAILURES, false)).toBe('none');
    expect(accountWideLoginDefense(ACCOUNT_WIDE_THROTTLE_AFTER_FAILURES - 1, false)).toBe('none');
    expect(accountWideLoginDefense(ACCOUNT_WIDE_THROTTLE_AFTER_FAILURES, false)).toBe('throttle');
  });

  test('unsinnige Zaehlerstaende werden nicht zur Abwehr', () => {
    expect(accountWideLoginDefense(-1, true)).toBe('none');
    expect(accountWideLoginDefense(Number.NaN, true)).toBe('none');
  });
});

type LoginPortOptions = {
  accountFailures: number;
  captchaProvider: 'turnstile' | null;
  workspaceCaptchaEnabled?: boolean;
  onCaptchaChallenge?: (challenge: string | undefined) => boolean;
};

function loginPorts(options: LoginPortOptions): {
  ports: ServerApiPorts;
  calls: { verifiedPassword: boolean; windowSeconds: number | null };
} {
  const calls = { verifiedPassword: false, windowSeconds: null as number | null };
  const ports = {
    auth: {
      async countRecentLoginFailuresForAccount(input: { windowSeconds: number }) {
        calls.windowSeconds = input.windowSeconds;
        return options.accountFailures;
      },
      async checkLoginLock() {
        return null;
      },
      async findUserByEmail() {
        return null;
      },
      async verifyPassword() {
        calls.verifiedPassword = true;
        return false;
      },
      async recordFailedLogin() {
        return 1;
      },
    },
    loginSecurity: {
      async getLoginConfig() {
        return {
          captcha: {
            enabled: options.workspaceCaptchaEnabled ?? false,
            provider: options.captchaProvider,
            siteKey: options.captchaProvider ? 'site-key' : null,
          },
          pinKeypad: { enabled: false },
          mfa: { enabled: false, methods: [] },
          user: null,
        };
      },
      async assertCaptchaChallenge(input: { challenge: string | undefined }) {
        return options.onCaptchaChallenge?.(input.challenge) ?? false;
      },
    },
  } as unknown as ServerApiPorts;
  return { ports, calls };
}

async function login(ports: ServerApiPorts, body: Record<string, unknown> = {}) {
  return createServerApi(ports).handle({
    method: 'POST',
    path: '/api/v1/auth/login',
    body: { email: 'ziel@example.com', password: 'irgendwas', ...body },
    headers: {},
    query: {},
    ip: '203.0.113.9',
  });
}

describe('Login-Route unter verteiltem Raten', () => {
  test('fordert ein CAPTCHA, sobald das Konto verteilt beschossen wird', async () => {
    const { ports, calls } = loginPorts({
      accountFailures: ACCOUNT_WIDE_CAPTCHA_AFTER_FAILURES,
      captchaProvider: 'turnstile',
      // Der Workspace-Toggle ist AUS — die Eskalation braucht nur den Anbieter.
      workspaceCaptchaEnabled: false,
    });
    const res = await login(ports);
    expect(res.status).toBe(403);
    expect((res.body as { error: { code: string } }).error.code).toBe('captcha_required');
    // Und zwar bevor das Passwort geprueft wird — dahinter haette der Angreifer
    // seine Antwort bereits.
    expect(calls.verifiedPassword).toBe(false);
    expect(calls.windowSeconds).toBe(ACCOUNT_WIDE_FAILURE_WINDOW_SECONDS);
  });

  test('eine geloeste Challenge laesst den rechtmaessigen Nutzer durch', async () => {
    const { ports, calls } = loginPorts({
      accountFailures: ACCOUNT_WIDE_CAPTCHA_AFTER_FAILURES * 5,
      captchaProvider: 'turnstile',
      onCaptchaChallenge: (challenge) => challenge === 'gueltig',
    });
    const res = await login(ports, { captchaChallenge: 'gueltig' });
    // Kein 403: die Anmeldung laeuft normal weiter und scheitert hier nur am
    // Passwort. Genau das unterscheidet eine Huerde von einer Kontosperre.
    expect(res.status).toBe(401);
    expect(calls.verifiedPassword).toBe(true);
  });

  test('ohne CAPTCHA-Anbieter bremst sie erst bei der hohen Schwelle', async () => {
    const below = loginPorts({
      accountFailures: ACCOUNT_WIDE_THROTTLE_AFTER_FAILURES - 1,
      captchaProvider: null,
    });
    expect((await login(below.ports)).status).toBe(401);

    const above = loginPorts({
      accountFailures: ACCOUNT_WIDE_THROTTLE_AFTER_FAILURES,
      captchaProvider: null,
    });
    const res = await login(above.ports);
    expect(res.status).toBe(429);
    expect(above.calls.verifiedPassword).toBe(false);
  });

  test('ein Port ohne den Zaehler aendert nichts am Verhalten', async () => {
    const ports = {
      auth: {
        async checkLoginLock() { return null; },
        async findUserByEmail() { return null; },
        async verifyPassword() { return false; },
        async recordFailedLogin() { return 1; },
      },
    } as unknown as ServerApiPorts;
    expect((await login(ports)).status).toBe(401);
  });
});

/**
 * Die drei Lesezugriffe ergeben zusammen die Rechte-Landkarte des Workspace:
 * welche Gruppe welche Berechtigung haelt und wer darin sitzt. Sie standen
 * jedem angemeldeten Konto offen, obwohl saemtliche Schreibpfade Admin
 * verlangen.
 */
describe('Benutzergruppen sind keine oeffentliche Auskunft', () => {
  const groupPorts = {
    userGroups: {
      async list() { return [{ id: 1, name: 'Admins', memberCount: 2 }]; },
      async listMembers() { return [{ userId: 'u1', displayName: 'Chef' }]; },
      async listPermissions() { return ['settings.manage', 'crm.write']; },
    },
  } as unknown as ServerApiPorts;

  const readPaths = [
    '/api/v1/user-groups',
    '/api/v1/user-groups/1/members',
    '/api/v1/user-groups/1/permissions',
  ] as const;

  test('ein Nutzer ohne settings.view bekommt 403 statt der Landkarte', async () => {
    const api = createServerApi(groupPorts);
    for (const path of readPaths) {
      const res = await api.handle({
        method: 'GET',
        path,
        principal: { userId: 'u9', workspaceId: WORKSPACE, role: 'user' },
      });
      expect({ path, status: res.status }).toEqual({ path, status: 403 });
    }
  });

  test('mit settings.view bleibt der Einstellungsbereich benutzbar', async () => {
    const api = createServerApi(groupPorts);
    for (const path of readPaths) {
      const res = await api.handle({
        method: 'GET',
        path,
        principal: {
          userId: 'u9',
          workspaceId: WORKSPACE,
          role: 'user',
          capabilities: ['settings.view'],
        },
      });
      expect({ path, status: res.status }).toEqual({ path, status: 200 });
    }
  });

  test('Admins halten die Berechtigung implizit', async () => {
    const api = createServerApi(groupPorts);
    const res = await api.handle({
      method: 'GET',
      path: '/api/v1/user-groups/1/permissions',
      principal: { userId: 'u1', workspaceId: WORKSPACE, role: 'admin' },
    });
    expect(res.status).toBe(200);
  });

  test('ohne Anmeldung bleibt es bei 401', async () => {
    const res = await createServerApi(groupPorts).handle({
      method: 'GET',
      path: '/api/v1/user-groups',
    });
    expect(res.status).toBe(401);
  });
});
