/**
 * @jest-environment node
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const mockUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'simplecrm-credentials-'));
jest.mock('electron', () => ({
  app: { getPath: () => mockUserData, whenReady: async () => undefined },
  safeStorage: undefined,
}));

import {
  CREDENTIALS_DB_FILE,
  createSafeStorageCipher,
  createSqliteCredentialTable,
  credentialsDbPath,
  removeRuntimeCredentialFile,
} from '../../electron/credentials/credential-runtime';
import { createCredentialStore, INSECURE_CREDENTIAL_STORE_MESSAGE } from '../../electron/credentials/credential-store';
import { linuxPasswordStoreSwitch } from '../../electron/credentials/linux-password-store';

/**
 * Plan 044: Laufzeit-Anbindung – eigene Datei credentials.sqlite (Rechte 0600,
 * nicht im Mail-Backup), safeStorage mit v11-Regel unter Linux.
 */
function fakeSafeStorage(prefix: string) {
  return {
    isAsyncEncryptionAvailable: jest.fn(async () => true),
    encryptStringAsync: jest.fn(async (plain: string) => Buffer.from(`${prefix}${Buffer.from(plain).toString('base64')}`, 'latin1')),
    decryptStringAsync: jest.fn(async (buffer: Buffer) => ({
      result: Buffer.from(buffer.toString('latin1').slice(3), 'base64').toString('utf8'),
      shouldReEncrypt: false,
    })),
  };
}

afterAll(() => {
  fs.rmSync(mockUserData, { recursive: true, force: true });
});

describe('Zugangsdaten-Speicher: Laufzeit', () => {
  test('Datei im userData-Ordner mit Rechten 0600; Grabstein, Löschen, Leeren', () => {
    const filePath = credentialsDbPath();
    expect(filePath).toBe(path.join(mockUserData, CREDENTIALS_DB_FILE));
    const table = createSqliteCredentialTable(filePath);
    expect(table.get('svc', 'a')).toBeUndefined();
    table.put('svc', 'a', Buffer.from('v11abc', 'latin1'), '2026-09-28T00:00:00Z');
    expect(table.get('svc', 'a')?.ciphertext?.toString('latin1')).toBe('v11abc');
    if (process.platform !== 'win32') {
      expect(fs.statSync(filePath).mode & 0o777).toBe(0o600);
    }
    table.put('svc', 'a', null, '2026-09-28T00:00:01Z');
    expect(table.get('svc', 'a')).toEqual({ ciphertext: null });
    table.put('svc', 'b', Buffer.from('v11x'), 'x');
    table.delete('svc', 'b');
    expect(table.get('svc', 'b')).toBeUndefined();
    table.put('svc', 'c', Buffer.from('v11y'), 'x');
    table.clear();
    expect(table.get('svc', 'c')).toBeUndefined();
    table.close();
    // Neu geöffnet: Inhalt bleibt (hier leer nach clear), Datei existiert.
    expect(fs.existsSync(filePath)).toBe(true);
    removeRuntimeCredentialFile(mockUserData);
    expect(fs.existsSync(filePath)).toBe(false);
  });

  test('Linux: nur v11 gilt als sicher; ohne safeStorage keine Verschlüsselung', async () => {
    const secure = createSafeStorageCipher(fakeSafeStorage('v11'), 'linux');
    const obfuscated = createSafeStorageCipher(fakeSafeStorage('v10'), 'linux');
    expect(secure.isSecureCiphertext(await secure.encrypt('x'))).toBe(true);
    expect(obfuscated.isSecureCiphertext(await obfuscated.encrypt('x'))).toBe(false);
    // Windows/macOS: das Betriebssystem verschlüsselt (DPAPI/Schlüsselbund), kein Präfix-Test.
    expect(createSafeStorageCipher(fakeSafeStorage('abc'), 'win32').isSecureCiphertext(Buffer.from('abc'))).toBe(true);
    await expect(createSafeStorageCipher(undefined, 'linux').isAvailable()).resolves.toBe(false);
    const throwing = { ...fakeSafeStorage('v11'), isAsyncEncryptionAvailable: jest.fn(async () => { throw new Error('kein Keyring'); }) };
    await expect(createSafeStorageCipher(throwing, 'linux').isAvailable()).resolves.toBe(false);
  });

  test('Befund für Meldung und Log: Speicher, Verfügbarkeit, Präfix – nie der Klartext', async () => {
    const storage = {
      ...fakeSafeStorage('v10'),
      getSelectedStorageBackend: () => 'basic_text' as const,
      isEncryptionAvailable: () => false,
    };
    const text = await createSafeStorageCipher(storage, 'linux').describe!();
    expect(text).toBe('Speicher basic_text, asynchron verfügbar, synchron nicht verfügbar, Chiffrat v10');
    expect(await createSafeStorageCipher(undefined, 'linux').describe!())
      .toBe('Speicher unbekannt, asynchron nicht verfügbar, synchron nicht verfügbar');
    expect(await createSafeStorageCipher({ ...fakeSafeStorage('v11'), isEncryptionAvailable: () => true }, 'win32').describe!())
      .toBe('asynchron verfügbar, synchron verfügbar, Chiffrat v11');
  });

  test('Ende zu Ende mit Datei: Umzug aus keytar, v10 verweigert das Speichern', async () => {
    const table = createSqliteCredentialTable(path.join(mockUserData, 'e2e.sqlite'));
    const legacy = {
      getPassword: jest.fn(async () => 'alt-pw'),
      deletePassword: jest.fn(async () => true),
    };
    const store = createCredentialStore({
      cipher: createSafeStorageCipher(fakeSafeStorage('v11'), 'linux'),
      table,
      legacy,
      whenReady: async () => undefined,
    });
    await expect(store.getSecret('SimpleCRMElectron-Email', 'acc-1')).resolves.toBe('alt-pw');
    expect(table.get('SimpleCRMElectron-Email', 'acc-1')?.ciphertext?.subarray(0, 3).toString('latin1')).toBe('v11');
    expect(legacy.deletePassword).not.toHaveBeenCalled();

    const insecure = createCredentialStore({
      cipher: createSafeStorageCipher(fakeSafeStorage('v10'), 'linux'),
      table,
      legacy,
      whenReady: async () => undefined,
    });
    await expect(insecure.setSecret('SimpleCRMElectron-Email', 'acc-2', 'pw')).rejects.toThrow(INSECURE_CREDENTIAL_STORE_MESSAGE);
    expect(table.get('SimpleCRMElectron-Email', 'acc-2')).toBeUndefined();
    table.close();
  });

  test('Linux ohne erkannte Desktop-Umgebung fordert libsecret an (wie keytar), KDE und explizite Wahl bleiben', () => {
    const argv = ['/opt/SimpleCRM/simplecrm'];
    const base = { platform: 'linux' as const, argv };
    expect(linuxPasswordStoreSwitch({ ...base, env: {} })).toBe('gnome-libsecret');
    expect(linuxPasswordStoreSwitch({ ...base, env: { XDG_CURRENT_DESKTOP: 'sway' } })).toBe('gnome-libsecret');
    expect(linuxPasswordStoreSwitch({ ...base, env: { XDG_CURRENT_DESKTOP: 'ubuntu:GNOME' } })).toBe('gnome-libsecret');
    expect(linuxPasswordStoreSwitch({ ...base, env: { XDG_CURRENT_DESKTOP: 'KDE' } })).toBeNull();
    expect(linuxPasswordStoreSwitch({ ...base, env: { DESKTOP_SESSION: 'plasma', KDE_FULL_SESSION: 'true' } })).toBeNull();
    expect(linuxPasswordStoreSwitch({ platform: 'win32', argv, env: {} })).toBeNull();
    expect(linuxPasswordStoreSwitch({ platform: 'darwin', argv, env: {} })).toBeNull();
  });

  test('ausdrückliche Wahl kommt aus den Startargumenten und wird erneut gesetzt', () => {
    const run = (...args: string[]) => linuxPasswordStoreSwitch({ platform: 'linux', env: {}, argv: ['simplecrm', ...args] });
    expect(run('--password-store=basic')).toBe('basic');
    expect(run('-password-store=kwallet6', '--disable-gpu')).toBe('kwallet6');
    expect(run('--password-store=basic', '--password-store=gnome-libsecret')).toBe('gnome-libsecret');
    expect(linuxPasswordStoreSwitch({ platform: 'linux', env: { XDG_CURRENT_DESKTOP: 'KDE' }, argv: ['simplecrm', '--password-store=basic'] })).toBe('basic');
    // Leerer Wert: Chromium wählt selbst, nichts überschreiben.
    expect(run('--password-store')).toBeNull();
    expect(run('--password-store=')).toBeNull();
    // Nach `--` und ähnlich benannte Schalter zählen nicht.
    expect(run('--', '--password-store=basic')).toBe('gnome-libsecret');
    expect(run('--password-store-x=basic', 'password-store=basic')).toBe('gnome-libsecret');
  });

  test('Mail-Backup und Wiederherstellung kennen nur database.sqlite und Anhänge', () => {
    const exportSource = fs.readFileSync(path.join(__dirname, '../../electron/email/email-local-backup-export.ts'), 'utf8');
    const restoreSource = fs.readFileSync(path.join(__dirname, '../../electron/email/email-local-restore.ts'), 'utf8');
    expect(exportSource).not.toContain('credentials');
    expect(restoreSource).not.toContain('credentials');
  });
});
