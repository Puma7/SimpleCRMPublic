import { OAuth2Client } from 'google-auth-library';
import { getEmailPassword, saveEmailPassword } from './email-keytar';

const GMAIL_IMAP_USER = 'https://mail.google.com/';

export type GoogleTokenBundle = {
  accessToken: string;
  refreshToken?: string;
  expiryDate?: number;
};

/**
 * Exchange authorization code (from OAuth redirect) for tokens; refresh token stored in Keytar when provided.
 */
export async function exchangeGoogleAuthCode(input: {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  code: string;
  keytarRefreshKey: string;
}): Promise<GoogleTokenBundle> {
  const client = new OAuth2Client(input.clientId, input.clientSecret, input.redirectUri);
  const { tokens } = await client.getToken(input.code);
  if (tokens.refresh_token) {
    await saveEmailPassword(input.keytarRefreshKey, tokens.refresh_token);
  }
  if (!tokens.access_token) {
    throw new Error('Google OAuth: kein Access-Token erhalten');
  }
  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? undefined,
    expiryDate: tokens.expiry_date ?? undefined,
  };
}

export async function getGoogleAccessTokenForImap(input: {
  clientId: string;
  clientSecret: string;
  refreshKeytarKey: string;
}): Promise<string> {
  const refresh = await getEmailPassword(input.refreshKeytarKey);
  if (!refresh) {
    throw new Error('Google OAuth: kein Refresh-Token im Schlüsselbund');
  }
  const client = new OAuth2Client(input.clientId, input.clientSecret);
  client.setCredentials({ refresh_token: refresh });
  const { token } = await client.getAccessToken();
  if (!token) {
    throw new Error('Google OAuth: Access-Token konnte nicht geholt werden');
  }
  return token;
}

export function buildGoogleOAuthAuthorizeUrl(input: {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}): string {
  const client = new OAuth2Client(input.clientId, input.clientSecret, input.redirectUri);
  return client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: [GMAIL_IMAP_USER, 'https://www.googleapis.com/auth/gmail.send'],
  });
}
