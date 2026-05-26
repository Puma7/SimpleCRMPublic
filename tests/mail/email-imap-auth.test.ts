import { createSqliteMock } from './helpers/sqlite-mock';

const { stmt } = createSqliteMock();
const syncInfo: Record<string, string> = {};
jest.mock('../../electron/sqlite-service', () => ({
  getSyncInfo: (k: string) => syncInfo[k] ?? '',
  setSyncInfo: (k: string, v: string) => {
    syncInfo[k] = v;
  },
}));

const mockGoogleToken = jest.fn();
const mockMsToken = jest.fn();
const mockPassword = jest.fn();

jest.mock('../../electron/email/email-oauth-google', () => ({
  getGoogleAccessTokenForImap: (...a: unknown[]) => mockGoogleToken(...a),
  buildGoogleOAuthAuthorizeUrl: () => 'https://google.example/auth',
}));
jest.mock('../../electron/email/email-oauth-microsoft', () => ({
  getMicrosoftAccessTokenForImap: (...a: unknown[]) => mockMsToken(...a),
  buildMicrosoftOAuthAuthorizeUrl: () => 'https://ms.example/auth',
}));
jest.mock('../../electron/email/email-keytar', () => ({
  getEmailPassword: (...a: unknown[]) => mockPassword(...a),
}));

import {
  buildGoogleOAuthAuthorizeUrl,
  buildMicrosoftOAuthAuthorizeUrl,
  getGoogleOAuthAppSettings,
  getMicrosoftOAuthAppSettings,
  resolveImapAuth,
  setGoogleOAuthAppSettings,
  setMicrosoftOAuthAppSettings,
} from '../../electron/email/email-imap-auth';

const baseAccount = {
  imap_username: 'user@x.de',
  keytar_account_key: 'k1',
  oauth_provider: null as string | null,
  oauth_refresh_keytar_key: null as string | null,
};

describe('email-imap-auth', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Object.keys(syncInfo).forEach((k) => delete syncInfo[k]);
    mockPassword.mockResolvedValue('secret');
    mockGoogleToken.mockResolvedValue('g-token');
    mockMsToken.mockResolvedValue('m-token');
  });

  test('password auth when no oauth', async () => {
    const cred = await resolveImapAuth(baseAccount as never);
    expect(cred).toEqual({ user: 'user@x.de', pass: 'secret' });
  });

  test('google oauth requires client settings', async () => {
    await expect(
      resolveImapAuth({
        ...baseAccount,
        oauth_provider: 'google',
        oauth_refresh_keytar_key: 'rk',
      } as never),
    ).rejects.toThrow(/Google OAuth/);
    syncInfo.email_google_oauth_client_id = 'id';
    syncInfo.email_google_oauth_client_secret = 'sec';
    const cred = await resolveImapAuth({
      ...baseAccount,
      oauth_provider: 'google',
      oauth_refresh_keytar_key: 'rk',
    } as never);
    expect(cred).toEqual({ user: 'user@x.de', accessToken: 'g-token' });
  });

  test('microsoft oauth', async () => {
    syncInfo.email_ms_oauth_client_id = 'id';
    syncInfo.email_ms_oauth_client_secret = 'sec';
    const cred = await resolveImapAuth({
      ...baseAccount,
      oauth_provider: 'microsoft',
      oauth_refresh_keytar_key: 'rk',
    } as never);
    expect(cred).toEqual({ user: 'user@x.de', accessToken: 'm-token' });
  });

  test('throws when password missing', async () => {
    mockPassword.mockResolvedValue(null);
    await expect(resolveImapAuth(baseAccount as never)).rejects.toThrow(/Passwort/);
  });

  test('oauth app settings getters/setters and authorize urls', () => {
    setGoogleOAuthAppSettings({ clientId: 'g1', clientSecret: 'g2' });
    expect(getGoogleOAuthAppSettings()).toEqual({ clientId: 'g1', clientSecret: 'g2' });
    expect(buildGoogleOAuthAuthorizeUrl({ clientId: 'g1', clientSecret: 'g2', redirectUri: 'r' })).toContain(
      'google',
    );
    setMicrosoftOAuthAppSettings({ clientId: 'm1' });
    expect(getMicrosoftOAuthAppSettings().clientId).toBe('m1');
    expect(buildMicrosoftOAuthAuthorizeUrl({ clientId: 'm1', redirectUri: 'r' })).toContain('ms');
    expect(stmt).toBeDefined();
  });
});
