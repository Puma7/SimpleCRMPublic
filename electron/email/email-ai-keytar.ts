import keytar from 'keytar';

const SERVICE = 'SimpleCRMElectron-EmailAI';

export async function saveEmailAiApiKey(key: string): Promise<void> {
  await keytar.setPassword(SERVICE, 'api-key', key);
}

export async function getEmailAiApiKey(): Promise<string | null> {
  return keytar.getPassword(SERVICE, 'api-key');
}

export async function deleteEmailAiApiKey(): Promise<boolean> {
  return keytar.deletePassword(SERVICE, 'api-key');
}
