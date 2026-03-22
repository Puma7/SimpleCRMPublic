import { getSyncInfo, setSyncInfo } from '../sqlite-service';
import { getEmailPassword } from './email-keytar';
import type { EmailAccountRow } from './email-store';
import { getGoogleAccessTokenForImap, buildGoogleOAuthAuthorizeUrl as buildGoogleOAuthUrl } from './email-oauth-google';
import {
  buildMicrosoftOAuthAuthorizeUrl as buildMsOAuthUrl,
  getMicrosoftAccessTokenForImap,
} from './email-oauth-microsoft';

const KEY_GOOGLE_CLIENT_ID = 'email_google_oauth_client_id';
const KEY_GOOGLE_CLIENT_SECRET = 'email_google_oauth_client_secret';
const KEY_MS_CLIENT_ID = 'email_ms_oauth_client_id';
const KEY_MS_CLIENT_SECRET = 'email_ms_oauth_client_secret';

export type ImapAuthCredentials = { user: string; pass: string } | { user: string; accessToken: string };

export async function resolveImapAuth(account: EmailAccountRow): Promise<ImapAuthCredentials> {
  if (account.oauth_provider === 'microsoft' && account.oauth_refresh_keytar_key) {
    const clientId = getSyncInfo(KEY_MS_CLIENT_ID) || '';
    const clientSecret = getSyncInfo(KEY_MS_CLIENT_SECRET) || '';
    if (!clientId || !clientSecret) {
      throw new Error('Microsoft OAuth: Client-ID/Secret in E-Mail-Einstellungen hinterlegen');
    }
    const accessToken = await getMicrosoftAccessTokenForImap({
      clientId,
      clientSecret,
      refreshKeytarKey: account.oauth_refresh_keytar_key,
    });
    return { user: account.imap_username, accessToken };
  }
  if (account.oauth_provider === 'google' && account.oauth_refresh_keytar_key) {
    const clientId = getSyncInfo(KEY_GOOGLE_CLIENT_ID) || '';
    const clientSecret = getSyncInfo(KEY_GOOGLE_CLIENT_SECRET) || '';
    if (!clientId || !clientSecret) {
      throw new Error('Google OAuth: Client-ID/Secret in E-Mail-Einstellungen hinterlegen');
    }
    const accessToken = await getGoogleAccessTokenForImap({
      clientId,
      clientSecret,
      refreshKeytarKey: account.oauth_refresh_keytar_key,
    });
    return { user: account.imap_username, accessToken };
  }
  const pass = await getEmailPassword(account.keytar_account_key);
  if (!pass) throw new Error('Kein gespeichertes IMAP-Passwort für dieses Konto');
  return { user: account.imap_username, pass };
}

export function getGoogleOAuthAppSettings(): { clientId: string; clientSecret: string } {
  return {
    clientId: getSyncInfo(KEY_GOOGLE_CLIENT_ID) || '',
    clientSecret: getSyncInfo(KEY_GOOGLE_CLIENT_SECRET) || '',
  };
}

export function setGoogleOAuthAppSettings(input: { clientId?: string; clientSecret?: string }): void {
  if (input.clientId !== undefined) setSyncInfo(KEY_GOOGLE_CLIENT_ID, input.clientId);
  if (input.clientSecret !== undefined) setSyncInfo(KEY_GOOGLE_CLIENT_SECRET, input.clientSecret);
}

export function buildGoogleOAuthAuthorizeUrl(input: {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}): string {
  return buildGoogleOAuthUrl(input);
}

export function getMicrosoftOAuthAppSettings(): { clientId: string; clientSecret: string } {
  return {
    clientId: getSyncInfo(KEY_MS_CLIENT_ID) || '',
    clientSecret: getSyncInfo(KEY_MS_CLIENT_SECRET) || '',
  };
}

export function setMicrosoftOAuthAppSettings(input: { clientId?: string; clientSecret?: string }): void {
  if (input.clientId !== undefined) setSyncInfo(KEY_MS_CLIENT_ID, input.clientId);
  if (input.clientSecret !== undefined) setSyncInfo(KEY_MS_CLIENT_SECRET, input.clientSecret);
}

export function buildMicrosoftOAuthAuthorizeUrl(input: { clientId: string; redirectUri: string }): string {
  return buildMsOAuthUrl(input);
}
