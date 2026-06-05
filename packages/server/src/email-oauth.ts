import { OAuth2Client } from 'google-auth-library';

import type {
  EmailOAuthApiPort,
  EmailOAuthProvider,
  EmailOAuthTokenExchangeResult,
} from './api/types';

const GOOGLE_SCOPES = [
  'https://mail.google.com/',
  'https://www.googleapis.com/auth/gmail.send',
] as const;

const MICROSOFT_AUTHORIZE_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize';
const MICROSOFT_TOKEN_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
const MICROSOFT_SCOPES = [
  'offline_access',
  'https://outlook.office.com/IMAP.AccessAsUser.All',
  'https://outlook.office.com/SMTP.Send',
] as const;

export type ServerEmailOAuthPortOptions = Readonly<{
  fetchImpl?: typeof fetch;
}>;

export type ServerEmailOAuthRefreshInput = Readonly<{
  provider: EmailOAuthProvider;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  fetchImpl?: typeof fetch;
}>;

export type ServerEmailOAuthRefreshResult = Readonly<{
  accessToken: string;
  refreshToken: string | null;
  expiresAt: string | null;
}>;

export function createServerEmailOAuthPort(options: ServerEmailOAuthPortOptions = {}): EmailOAuthApiPort {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  return {
    buildAuthorizeUrl(input) {
      if (input.provider === 'google') {
        const client = new OAuth2Client(input.clientId, input.clientSecret, input.redirectUri);
        return client.generateAuthUrl({
          access_type: 'offline',
          prompt: 'consent',
          scope: [...GOOGLE_SCOPES],
        });
      }

      const params = new URLSearchParams({
        client_id: input.clientId,
        response_type: 'code',
        redirect_uri: input.redirectUri,
        response_mode: 'query',
        scope: MICROSOFT_SCOPES.join(' '),
      });
      return `${MICROSOFT_AUTHORIZE_URL}?${params.toString()}`;
    },

    async exchangeAuthCode(input): Promise<EmailOAuthTokenExchangeResult> {
      if (input.provider === 'google') {
        const client = new OAuth2Client(input.clientId, input.clientSecret, input.redirectUri);
        const { tokens } = await client.getToken(input.code);
        if (!tokens.access_token) {
          throw new Error('Google OAuth: kein Access-Token erhalten');
        }
        return {
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token ?? null,
          expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
        };
      }

      const response = await fetchImpl(MICROSOFT_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: input.clientId,
          client_secret: input.clientSecret,
          code: input.code,
          redirect_uri: input.redirectUri,
          grant_type: 'authorization_code',
          scope: MICROSOFT_SCOPES.join(' '),
        }).toString(),
      });
      const body = await response.json() as {
        access_token?: string;
        refresh_token?: string;
        error?: string;
        error_description?: string;
      };
      if (!response.ok || !body.access_token) {
        throw new Error(body.error_description || body.error || 'Microsoft OAuth: Token-Austausch fehlgeschlagen');
      }
      return {
        accessToken: body.access_token,
        refreshToken: body.refresh_token ?? null,
      };
    },
  };
}

export async function refreshServerEmailOAuthAccessToken(
  input: ServerEmailOAuthRefreshInput,
): Promise<ServerEmailOAuthRefreshResult> {
  if (input.provider === 'google') {
    const client = new OAuth2Client(input.clientId, input.clientSecret);
    client.setCredentials({ refresh_token: input.refreshToken });
    const accessToken = await client.getAccessToken();
    const token = typeof accessToken === 'string' ? accessToken : accessToken.token;
    if (!token) throw new Error('Google OAuth: kein Access-Token erhalten');
    return {
      accessToken: token,
      refreshToken: null,
      expiresAt: client.credentials.expiry_date ? new Date(client.credentials.expiry_date).toISOString() : null,
    };
  }

  const fetchImpl = input.fetchImpl ?? globalThis.fetch;
  const response = await fetchImpl(MICROSOFT_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: input.clientId,
      client_secret: input.clientSecret,
      refresh_token: input.refreshToken,
      grant_type: 'refresh_token',
      scope: MICROSOFT_SCOPES.join(' '),
    }).toString(),
  });
  const body = await response.json() as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };
  if (!response.ok || !body.access_token) {
    throw new Error(body.error_description || body.error || 'Microsoft OAuth: Token-Refresh fehlgeschlagen');
  }
  const expiresAt = typeof body.expires_in === 'number'
    ? new Date(Date.now() + body.expires_in * 1000).toISOString()
    : null;
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token ?? null,
    expiresAt,
  };
}
