import { createCredentialStore, type CredentialStore } from './credential-store';
import { createRuntimeCredentialDeps, removeRuntimeCredentialFile } from './credential-runtime';

/**
 * Plan 044: gemeinsamer Zugangsdaten-Speicher der Desktop-Edition. Die
 * Dienstnamen bleiben die bisherigen keytar-Dienste, damit der Umzug je Eintrag
 * den alten Wert findet.
 */
export const CREDENTIAL_SERVICES = {
  email: 'SimpleCRMElectron-Email',
  pgp: 'SimpleCRMElectron-PGP',
  emailAi: 'SimpleCRMElectron-EmailAI',
  mssql: 'SimpleCRMElectron-MSSQL',
  automationApi: 'SimpleCRMElectron-AutomationAPI',
} as const;

let store: CredentialStore | null = null;

export function credentialStore(): CredentialStore {
  store ??= createCredentialStore(createRuntimeCredentialDeps());
  return store;
}

export function getSecret(service: string, account: string): Promise<string | null> {
  return credentialStore().getSecret(service, account);
}

export function setSecret(service: string, account: string, value: string): Promise<void> {
  return credentialStore().setSecret(service, account, value);
}

export function deleteSecret(service: string, account: string): Promise<boolean> {
  return credentialStore().deleteSecret(service, account);
}

/** Hard Reset: Datei `credentials.sqlite` löschen; der nächste Zugriff legt sie neu an. */
export function purgeCredentialStore(userDataPath?: string): void {
  removeRuntimeCredentialFile(userDataPath);
  store = null;
}
