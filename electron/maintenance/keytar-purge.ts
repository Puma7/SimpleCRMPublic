import keytar from 'keytar';

/** Keytar services used by SimpleCRM desktop — wiped on factory reset. */
export const DESKTOP_KEYTAR_SERVICES = [
  'SimpleCRMElectron-Email',
  'SimpleCRMElectron-PGP',
  'SimpleCRMElectron-EmailAI',
  'SimpleCRMElectron-AutomationAPI',
  'SimpleCRMElectron-MSSQL',
  'SimpleCRMElectron-StandalonePostgres',
] as const;

export async function purgeDesktopKeytarSecrets(): Promise<number> {
  let deleted = 0;
  for (const service of DESKTOP_KEYTAR_SERVICES) {
    const credentials = await keytar.findCredentials(service);
    for (const entry of credentials) {
      const removed = await keytar.deletePassword(service, entry.account);
      if (removed) deleted += 1;
    }
  }
  return deleted;
}
