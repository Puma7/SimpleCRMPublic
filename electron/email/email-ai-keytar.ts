import { CREDENTIAL_SERVICES, deleteSecret, getSecret, setSecret } from '../credentials';

/** Alter einzelner KI-API-Key (vor den KI-Profilen); Zugangsdaten-Speicher seit Plan 044. */
const ACCOUNT = 'api-key';

export async function saveEmailAiApiKey(key: string): Promise<void> {
  await setSecret(CREDENTIAL_SERVICES.emailAi, ACCOUNT, key);
}

export async function getEmailAiApiKey(): Promise<string | null> {
  return getSecret(CREDENTIAL_SERVICES.emailAi, ACCOUNT);
}

export async function deleteEmailAiApiKey(): Promise<boolean> {
  return deleteSecret(CREDENTIAL_SERVICES.emailAi, ACCOUNT);
}
