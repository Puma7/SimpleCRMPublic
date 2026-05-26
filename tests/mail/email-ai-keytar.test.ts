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

describe('email-ai-keytar', () => {
  beforeEach(() => jest.clearAllMocks());

  test('save get delete api key', async () => {
    await saveEmailAiApiKey('sk-abc');
    expect(keytar.setPassword).toHaveBeenCalledWith('SimpleCRMElectron-EmailAI', 'api-key', 'sk-abc');
    await expect(getEmailAiApiKey()).resolves.toBe('sk-test');
    await expect(deleteEmailAiApiKey()).resolves.toBe(true);
  });
});
