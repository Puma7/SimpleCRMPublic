jest.mock('keytar', () => ({
  setPassword: jest.fn().mockResolvedValue(undefined),
  getPassword: jest.fn().mockResolvedValue('secret'),
  deletePassword: jest.fn().mockResolvedValue(true),
}));

import keytar from 'keytar';
import {
  deleteEmailPassword,
  getEmailPassword,
  saveEmailPassword,
} from '../../electron/email/email-keytar';

describe('email-keytar', () => {
  beforeEach(() => jest.clearAllMocks());

  test('save get delete password', async () => {
    await saveEmailPassword('acc-1', 'pw');
    expect(keytar.setPassword).toHaveBeenCalledWith('SimpleCRMElectron-Email', 'acc-1', 'pw');
    await expect(getEmailPassword('acc-1')).resolves.toBe('secret');
    await expect(deleteEmailPassword('acc-1')).resolves.toBe(true);
  });
});
