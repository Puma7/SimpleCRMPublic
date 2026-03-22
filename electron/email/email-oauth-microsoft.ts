import { getEmailPassword, saveEmailPassword } from './email-keytar';

const TOKEN_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';

export type MicrosoftTokenBundle = {
  accessToken: string;
  refreshToken?: string;
};

export function buildMicrosoftOAuthAuthorizeUrl(input: {
  clientId: string;
  redirectUri: string;
}): string {
  const params = new URLSearchParams({
    client_id: input.clientId,
    response_type: 'code',
    redirect_uri: input.redirectUri,
    response_mode: 'query',
    scope: [
      'offline_access',
      'https://outlook.office.com/IMAP.AccessAsUser.All',
      'https://outlook.office.com/SMTP.Send',
    ].join(' '),
  });
  return `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params.toString()}`;
}

export async function exchangeMicrosoftAuthCode(input: {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  code: string;
  keytarRefreshKey: string;
}): Promise<MicrosoftTokenBundle> {
  const body = new URLSearchParams({
    client_id: input.clientId,
    client_secret: input.clientSecret,
    code: input.code,
    redirect_uri: input.redirectUri,
    grant_type: 'authorization_code',
    scope: [
      'offline_access',
      'https://outlook.office.com/IMAP.AccessAsUser.All',
      'https://outlook.office.com/SMTP.Send',
    ].join(' '),
  });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const data = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    error?: string;
    error_description?: string;
  };
  if (!res.ok || !data.access_token) {
    throw new Error(data.error_description || data.error || 'Microsoft OAuth: Token-Austausch fehlgeschlagen');
  }
  if (data.refresh_token) {
    await saveEmailPassword(input.keytarRefreshKey, data.refresh_token);
  }
  return { accessToken: data.access_token, refreshToken: data.refresh_token };
}

export async function getMicrosoftAccessTokenForImap(input: {
  clientId: string;
  clientSecret: string;
  refreshKeytarKey: string;
}): Promise<string> {
  const refresh = await getEmailPassword(input.refreshKeytarKey);
  if (!refresh) throw new Error('Microsoft OAuth: kein Refresh-Token im Schlüsselbund');
  const body = new URLSearchParams({
    client_id: input.clientId,
    client_secret: input.clientSecret,
    refresh_token: refresh,
    grant_type: 'refresh_token',
  });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const data = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    error?: string;
    error_description?: string;
  };
  if (!res.ok || !data.access_token) {
    throw new Error(data.error_description || data.error || 'Microsoft OAuth: Access-Token fehlgeschlagen');
  }
  if (data.refresh_token) {
    await saveEmailPassword(input.refreshKeytarKey, data.refresh_token);
  }
  return data.access_token;
}
