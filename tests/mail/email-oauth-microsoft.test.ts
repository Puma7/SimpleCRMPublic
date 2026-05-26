const mockSave = jest.fn();
const mockGetPassword = jest.fn();

jest.mock('../../electron/email/email-keytar', () => ({
  getEmailPassword: (...a: unknown[]) => mockGetPassword(...a),
  saveEmailPassword: (...a: unknown[]) => mockSave(...a),
}));

import {
  buildMicrosoftOAuthAuthorizeUrl,
  exchangeMicrosoftAuthCode,
  getMicrosoftAccessTokenForImap,
} from '../../electron/email/email-oauth-microsoft';

describe('email-oauth-microsoft', () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetPassword.mockResolvedValue('refresh-ms');
    global.fetch = fetchMock as typeof fetch;
  });

  test('buildMicrosoftOAuthAuthorizeUrl', () => {
    const url = buildMicrosoftOAuthAuthorizeUrl({ clientId: 'cid', redirectUri: 'http://localhost/cb' });
    expect(url).toContain('login.microsoftonline.com');
    expect(url).toContain('client_id=cid');
  });

  test('exchangeMicrosoftAuthCode saves refresh token', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: 'a', refresh_token: 'r' }),
    });
    const bundle = await exchangeMicrosoftAuthCode({
      clientId: 'c',
      clientSecret: 's',
      redirectUri: 'r',
      code: 'code',
      keytarRefreshKey: 'k',
    });
    expect(bundle.accessToken).toBe('a');
    expect(mockSave).toHaveBeenCalledWith('k', 'r');
  });

  test('exchangeMicrosoftAuthCode throws on error response', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'invalid_grant', error_description: 'bad' }),
    });
    await expect(
      exchangeMicrosoftAuthCode({
        clientId: 'c',
        clientSecret: 's',
        redirectUri: 'r',
        code: 'x',
        keytarRefreshKey: 'k',
      }),
    ).rejects.toThrow('bad');
  });

  test('getMicrosoftAccessTokenForImap refreshes', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: 'new-access' }),
    });
    const t = await getMicrosoftAccessTokenForImap({
      clientId: 'c',
      clientSecret: 's',
      refreshKeytarKey: 'k',
    });
    expect(t).toBe('new-access');
  });

  test('getMicrosoftAccessTokenForImap without refresh in keytar', async () => {
    mockGetPassword.mockResolvedValue(null);
    await expect(
      getMicrosoftAccessTokenForImap({ clientId: 'c', clientSecret: 's', refreshKeytarKey: 'k' }),
    ).rejects.toThrow(/Refresh-Token/);
  });

  test('getMicrosoftAccessTokenForImap updates refresh when returned', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: 'a2', refresh_token: 'r2' }),
    });
    await getMicrosoftAccessTokenForImap({ clientId: 'c', clientSecret: 's', refreshKeytarKey: 'k' });
    expect(mockSave).toHaveBeenCalledWith('k', 'r2');
  });
});
