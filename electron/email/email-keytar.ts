import keytar from 'keytar';

const SERVICE = 'SimpleCRMElectron-Email';

export async function saveEmailPassword(keytarAccountKey: string, password: string): Promise<void> {
  await keytar.setPassword(SERVICE, keytarAccountKey, password);
}

export async function getEmailPassword(keytarAccountKey: string): Promise<string | null> {
  return keytar.getPassword(SERVICE, keytarAccountKey);
}

export async function deleteEmailPassword(keytarAccountKey: string): Promise<boolean> {
  return keytar.deletePassword(SERVICE, keytarAccountKey);
}
