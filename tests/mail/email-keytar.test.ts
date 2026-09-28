jest.mock('keytar', () => ({
  setPassword: jest.fn().mockResolvedValue(undefined),
  getPassword: jest.fn().mockResolvedValue('secret'),
  deletePassword: jest.fn().mockResolvedValue(true),
}));

import keytar from 'keytar';
import {
  deleteEmailPassword,
  deletePgpPrivateKey,
  getEmailPassword,
  getPgpPrivateKey,
  saveEmailPassword,
  savePgpPrivateKey,
} from '../../electron/email/email-keytar';

/**
 * Plan 044: Mail- und PGP-Geheimnisse liegen im Zugangsdaten-Speicher
 * (safeStorage). keytar wird nur noch gelesen (Umzug) und beim ausdrücklichen
 * Löschen wie bisher mitgelöscht – nie beschrieben.
 */
describe('email-keytar', () => {
  beforeEach(() => jest.clearAllMocks());

  test('Speichern, Lesen und Löschen gehen über den Zugangsdaten-Speicher', async () => {
    await saveEmailPassword('acc-1', 'pw');
    expect(keytar.setPassword).not.toHaveBeenCalled();
    await expect(getEmailPassword('acc-1')).resolves.toBe('pw');
    expect(keytar.getPassword).not.toHaveBeenCalled();
    await expect(deleteEmailPassword('acc-1')).resolves.toBe(true);
    expect(keytar.deletePassword).toHaveBeenCalledWith('SimpleCRMElectron-Email', 'acc-1');
    // Gelöscht bleibt gelöscht, auch wenn keytar noch einen alten Wert hätte.
    await expect(getEmailPassword('acc-1')).resolves.toBeNull();
  });

  test('alter keytar-Wert wird beim ersten Lesen übernommen, keytar bleibt unverändert', async () => {
    await expect(getEmailPassword('acc-alt')).resolves.toBe('secret');
    expect(keytar.getPassword).toHaveBeenCalledWith('SimpleCRMElectron-Email', 'acc-alt');
    (keytar.getPassword as jest.Mock).mockClear();
    await expect(getEmailPassword('acc-alt')).resolves.toBe('secret');
    expect(keytar.getPassword).not.toHaveBeenCalled();
    expect(keytar.setPassword).not.toHaveBeenCalled();
    expect(keytar.deletePassword).not.toHaveBeenCalled();
  });

  test('PGP-Schlüssel eigener Dienst', async () => {
    await savePgpPrivateKey('pgp-1', '-----BEGIN PGP PRIVATE KEY BLOCK-----');
    await expect(getPgpPrivateKey('pgp-1')).resolves.toBe('-----BEGIN PGP PRIVATE KEY BLOCK-----');
    await expect(deletePgpPrivateKey('pgp-1')).resolves.toBe(true);
    expect(keytar.deletePassword).toHaveBeenCalledWith('SimpleCRMElectron-PGP', 'pgp-1');
  });
});
