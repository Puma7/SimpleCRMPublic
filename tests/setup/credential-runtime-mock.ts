import keytar from 'keytar';

import type { CredentialStoreDeps } from '../../electron/credentials/credential-store';

/**
 * Plan 044: Ersatz für electron/credentials/credential-runtime.ts in Jest
 * (moduleNameMapper). Ein reversibles Test-„Chiffrat“ mit Präfix v11 im
 * Arbeitsspeicher; Rückfall liest den keytar-Mock des Tests. jest.setup.ts leert
 * den Speicher vor jedem Test.
 */
type CredentialGlobal = typeof globalThis & { __simplecrmCredentialRows?: Map<string, Buffer | null> };

export function credentialTestRows(): Map<string, Buffer | null> {
  const g = globalThis as CredentialGlobal;
  g.__simplecrmCredentialRows ??= new Map();
  return g.__simplecrmCredentialRows;
}

const key = (service: string, account: string) => `${service}\u0000${account}`;

export const CREDENTIALS_DB_FILE = 'credentials.sqlite';

export function createRuntimeCredentialDeps(): CredentialStoreDeps {
  const rows = credentialTestRows();
  return {
    cipher: {
      isAvailable: async () => true,
      encrypt: async (plain) => Buffer.from(`v11${Buffer.from(plain, 'utf8').toString('base64')}`, 'latin1'),
      decrypt: async (ciphertext) => {
        const text = ciphertext.toString('latin1');
        if (!text.startsWith('v11')) throw new Error('Decryption is not available');
        return { result: Buffer.from(text.slice(3), 'base64').toString('utf8'), shouldReEncrypt: false };
      },
      isSecureCiphertext: (ciphertext) => ciphertext.subarray(0, 3).toString('latin1') === 'v11',
    },
    table: {
      get: (service, account) => (rows.has(key(service, account)) ? { ciphertext: rows.get(key(service, account)) ?? null } : undefined),
      put: (service, account, ciphertext) => {
        rows.set(key(service, account), ciphertext);
      },
      delete: (service, account) => {
        rows.delete(key(service, account));
      },
      clear: () => rows.clear(),
    },
    legacy: {
      getPassword: (service, account) => keytar.getPassword(service, account),
      deletePassword: (service, account) => keytar.deletePassword(service, account),
    },
    whenReady: async () => undefined,
  };
}

export function removeRuntimeCredentialFile(): void {
  credentialTestRows().clear();
}
