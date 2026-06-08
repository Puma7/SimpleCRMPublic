import { MAINTENANCE_HARD_RESET_PHRASE } from '@simplecrm/core';

import {
  DESKTOP_KEYTAR_SERVICES,
  purgeDesktopKeytarSecrets,
} from '../../electron/maintenance/keytar-purge';
import {
  validateDesktopHardResetInput,
  runDesktopRepair,
} from '../../electron/maintenance/reset-service';

jest.mock('keytar', () => ({
  findCredentials: jest.fn(async (service: string) => (
    service === 'SimpleCRMElectron-Email'
      ? [{ account: 'email-1', password: 'secret' }]
      : []
  )),
  deletePassword: jest.fn(async () => true),
}));

jest.mock('../../electron/email/email-imap-services', () => ({
  stopEmailBackgroundServices: jest.fn(),
  startEmailBackgroundServices: jest.fn(async () => undefined),
}));

const keytar = jest.requireMock('keytar') as {
  findCredentials: jest.Mock;
  deletePassword: jest.Mock;
};

const emailBackground = jest.requireMock('../../electron/email/email-imap-services') as {
  stopEmailBackgroundServices: jest.Mock;
  startEmailBackgroundServices: jest.Mock;
};

describe('desktop maintenance hard reset', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('validateDesktopHardResetInput requires acknowledgement and exact phrase', () => {
    expect(validateDesktopHardResetInput({
      acknowledgeDataLoss: false,
      confirmPhrase: MAINTENANCE_HARD_RESET_PHRASE,
    })).toMatch(/Datenverlust/);

    expect(validateDesktopHardResetInput({
      acknowledgeDataLoss: true,
      confirmPhrase: 'wrong',
    })).toMatch(/SYSTEM LÖSCHEN/);

    expect(validateDesktopHardResetInput({
      acknowledgeDataLoss: true,
      confirmPhrase: MAINTENANCE_HARD_RESET_PHRASE,
    })).toBeNull();
  });

  test('purgeDesktopKeytarSecrets clears all configured services', async () => {
    const deleted = await purgeDesktopKeytarSecrets();
    expect(deleted).toBe(1);
    expect(keytar.findCredentials).toHaveBeenCalledTimes(DESKTOP_KEYTAR_SERVICES.length);
    expect(keytar.deletePassword).toHaveBeenCalledWith('SimpleCRMElectron-Email', 'email-1');
  });

  test('runDesktopRepair restarts email background services', async () => {
    const logger = { warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    const result = await runDesktopRepair(logger);
    expect(result.ok).toBe(true);
    expect(emailBackground.stopEmailBackgroundServices).toHaveBeenCalledTimes(1);
    expect(emailBackground.startEmailBackgroundServices).toHaveBeenCalledWith(logger);
  });
});
