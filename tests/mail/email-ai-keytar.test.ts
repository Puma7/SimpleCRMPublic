jest.mock('keytar', () => ({
  setPassword: jest.fn().mockResolvedValue(undefined),
  getPassword: jest.fn().mockResolvedValue('sk-test'),
  deletePassword: jest.fn().mockResolvedValue(true),
}));

import keytar from 'keytar';
import {
  deleteEmailAiApiKey,
  getEmailAiApiKey,
  saveEmailAiApiKey,
} from '../../electron/email/email-ai-keytar';

/** Plan 044: alter KI-API-Key im Zugangsdaten-Speicher, keytar nur Rückfall. */
describe('email-ai-keytar', () => {
  beforeEach(() => jest.clearAllMocks());

  test('alter Wert aus keytar, danach gespeicherter Wert, Löschen', async () => {
    await expect(getEmailAiApiKey()).resolves.toBe('sk-test');
    await saveEmailAiApiKey('sk-abc');
    expect(keytar.setPassword).not.toHaveBeenCalled();
    await expect(getEmailAiApiKey()).resolves.toBe('sk-abc');
    await expect(deleteEmailAiApiKey()).resolves.toBe(true);
    expect(keytar.deletePassword).toHaveBeenCalledWith('SimpleCRMElectron-EmailAI', 'api-key');
    await expect(getEmailAiApiKey()).resolves.toBeNull();
  });
});
