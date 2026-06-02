import keytar from 'keytar';

const SERVICE = 'SimpleCRMElectron-Email';
const PGP_SERVICE = 'SimpleCRMElectron-PGP';

export async function savePgpPrivateKey(keytarAccountKey: string, privateKeyArmored: string): Promise<void> {
  await keytar.setPassword(PGP_SERVICE, keytarAccountKey, privateKeyArmored);
}

export async function getPgpPrivateKey(keytarAccountKey: string): Promise<string | null> {
  return keytar.getPassword(PGP_SERVICE, keytarAccountKey);
}

export async function deletePgpPrivateKey(keytarAccountKey: string): Promise<boolean> {
  return keytar.deletePassword(PGP_SERVICE, keytarAccountKey);
}

export async function saveEmailPassword(keytarAccountKey: string, password: string): Promise<void> {
  await keytar.setPassword(SERVICE, keytarAccountKey, password);
}

export async function getEmailPassword(keytarAccountKey: string): Promise<string | null> {
  return keytar.getPassword(SERVICE, keytarAccountKey);
}

export async function deleteEmailPassword(keytarAccountKey: string): Promise<boolean> {
  return keytar.deletePassword(SERVICE, keytarAccountKey);
}
