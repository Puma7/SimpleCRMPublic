import { CREDENTIAL_SERVICES, deleteSecret, getSecret, setSecret } from '../credentials';

/**
 * Mail- und PGP-Geheimnisse. Seit Plan 044 im Zugangsdaten-Speicher
 * (Electron safeStorage); alte keytar-Einträge werden beim ersten Lesen übernommen.
 * Die Kontospalte heißt weiter `keytar_account_key` (nur noch eine Kennung).
 */
export async function savePgpPrivateKey(keytarAccountKey: string, privateKeyArmored: string): Promise<void> {
  await setSecret(CREDENTIAL_SERVICES.pgp, keytarAccountKey, privateKeyArmored);
}

export async function getPgpPrivateKey(keytarAccountKey: string): Promise<string | null> {
  return getSecret(CREDENTIAL_SERVICES.pgp, keytarAccountKey);
}

export async function deletePgpPrivateKey(keytarAccountKey: string): Promise<boolean> {
  return deleteSecret(CREDENTIAL_SERVICES.pgp, keytarAccountKey);
}

export async function saveEmailPassword(keytarAccountKey: string, password: string): Promise<void> {
  await setSecret(CREDENTIAL_SERVICES.email, keytarAccountKey, password);
}

export async function getEmailPassword(keytarAccountKey: string): Promise<string | null> {
  return getSecret(CREDENTIAL_SERVICES.email, keytarAccountKey);
}

export async function deleteEmailPassword(keytarAccountKey: string): Promise<boolean> {
  return deleteSecret(CREDENTIAL_SERVICES.email, keytarAccountKey);
}
