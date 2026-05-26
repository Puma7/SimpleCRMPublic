const mockGetToken = jest.fn();
const mockGenerateAuthUrl = jest.fn();
const mockSetCredentials = jest.fn();
const mockGetAccessToken = jest.fn();
const mockSave = jest.fn();
const mockGetPassword = jest.fn();

jest.mock('google-auth-library', () => ({
  OAuth2Client: jest.fn().mockImplementation(() => ({
    getToken: mockGetToken,
    generateAuthUrl: mockGenerateAuthUrl,
    setCredentials: mockSetCredentials,
    getAccessToken: mockGetAccessToken,
  })),
}));
jest.mock('../../electron/email/email-keytar', () => ({
  getEmailPassword: (...a: unknown[]) => mockGetPassword(...a),
  saveEmailPassword: (...a: unknown[]) => mockSave(...a),
}));

import {
  buildGoogleOAuthAuthorizeUrl,
  exchangeGoogleAuthCode,
  getGoogleAccessTokenForImap,
} from '../../electron/email/email-oauth-google';

describe('email-oauth-google', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGenerateAuthUrl.mockReturnValue('https://accounts.google.com/o/oauth2');
    mockGetPassword.mockResolvedValue('refresh-xyz');
    mockGetAccessToken.mockResolvedValue({ token: 'access-1' });
  });

  test('exchangeGoogleAuthCode saves refresh and returns access', async () => {
    mockGetToken.mockResolvedValue({
      tokens: { access_token: 'a1', refresh_token: 'r1', expiry_date: 123 },
    });
    const bundle = await exchangeGoogleAuthCode({
      clientId: 'c',
      clientSecret: 's',
      redirectUri: 'http://localhost',
      code: 'code',
      keytarRefreshKey: 'key',
    });
    expect(bundle.accessToken).toBe('a1');
    expect(mockSave).toHaveBeenCalledWith('key', 'r1');
  });

  test('exchangeGoogleAuthCode throws without access token', async () => {
    mockGetToken.mockResolvedValue({ tokens: {} });
    await expect(
      exchangeGoogleAuthCode({
        clientId: 'c',
        clientSecret: 's',
        redirectUri: 'r',
        code: 'x',
        keytarRefreshKey: 'k',
      }),
    ).rejects.toThrow(/kein Access-Token/);
  });

  test('getGoogleAccessTokenForImap refreshes token', async () => {
    const t = await getGoogleAccessTokenForImap({
      clientId: 'c',
      clientSecret: 's',
      refreshKeytarKey: 'k',
    });
    expect(t).toBe('access-1');
    expect(mockSetCredentials).toHaveBeenCalledWith({ refresh_token: 'refresh-xyz' });
  });

  test('getGoogleAccessTokenForImap errors without refresh', async () => {
    mockGetPassword.mockResolvedValue(null);
    await expect(
      getGoogleAccessTokenForImap({ clientId: 'c', clientSecret: 's', refreshKeytarKey: 'k' }),
    ).rejects.toThrow(/Refresh-Token/);
  });

  test('getGoogleAccessTokenForImap errors when token empty', async () => {
    mockGetAccessToken.mockResolvedValue({ token: null });
    await expect(
      getGoogleAccessTokenForImap({ clientId: 'c', clientSecret: 's', refreshKeytarKey: 'k' }),
    ).rejects.toThrow(/konnte nicht/);
  });

  test('buildGoogleOAuthAuthorizeUrl', () => {
    expect(buildGoogleOAuthAuthorizeUrl({ clientId: 'c', clientSecret: 's', redirectUri: 'r' })).toContain(
      'google',
    );
  });
});
