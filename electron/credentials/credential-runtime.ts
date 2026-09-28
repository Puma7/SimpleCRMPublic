import fs from 'node:fs';
import path from 'node:path';

import Database from 'better-sqlite3';
import { app, safeStorage } from 'electron';

import type { CredentialCipher, CredentialStoreDeps, CredentialTable } from './credential-store';
import { legacyKeytar } from './legacy-keytar';

/**
 * Plan 044: Laufzeit-Anbindung des Zugangsdaten-Speichers an Electron
 * `safeStorage` und die eigene Datei `credentials.sqlite` in `userData`.
 * Backup, Wiederherstellung und Pre-Update-Backup fassen die Datei nicht an
 * (Entscheidung 1b); der Hard Reset löscht sie.
 */
export const CREDENTIALS_DB_FILE = 'credentials.sqlite';

export function credentialsDbPath(userDataPath: string = app.getPath('userData')): string {
  return path.join(userDataPath, CREDENTIALS_DB_FILE);
}

type SafeStorageLike = Pick<
  typeof safeStorage,
  'isAsyncEncryptionAvailable' | 'encryptStringAsync' | 'decryptStringAsync'
>;

/** Unter Linux gilt nur `v11` (Schlüssel aus libsecret/KWallet) als verschlüsselt; `v10` ist nur verschleiert. */
export function createSafeStorageCipher(
  storage: SafeStorageLike | undefined = safeStorage,
  platform: NodeJS.Platform = process.platform,
): CredentialCipher {
  return {
    async isAvailable() {
      if (!storage || typeof storage.isAsyncEncryptionAvailable !== 'function') return false;
      try {
        return await storage.isAsyncEncryptionAvailable();
      } catch {
        return false;
      }
    },
    encrypt: (plain) => storage!.encryptStringAsync(plain),
    async decrypt(ciphertext) {
      const opened = await storage!.decryptStringAsync(ciphertext);
      return { result: opened.result, shouldReEncrypt: opened.shouldReEncrypt === true };
    },
    isSecureCiphertext(ciphertext) {
      if (platform !== 'linux') return ciphertext.length > 0;
      return ciphertext.subarray(0, 3).toString('latin1') === 'v11';
    },
  };
}

export type SqliteCredentialTable = CredentialTable & { close(): void };

/** Tabelle `credential_store` in eigener Datei; wird beim ersten Zugriff geöffnet (Rechte 0600). */
export function createSqliteCredentialTable(filePath: string): SqliteCredentialTable {
  let db: Database.Database | null = null;
  const open = (): Database.Database => {
    if (db) return db;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const connection = new Database(filePath);
    try {
      fs.chmodSync(filePath, 0o600);
    } catch {
      // Windows kennt keine POSIX-Rechte; der Schutz liegt dort bei DPAPI.
    }
    connection.exec(`
      CREATE TABLE IF NOT EXISTS credential_store (
        service TEXT NOT NULL,
        account TEXT NOT NULL,
        ciphertext BLOB,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (service, account)
      );
    `);
    db = connection;
    return connection;
  };
  return {
    get(service, account) {
      const row = open()
        .prepare('SELECT ciphertext FROM credential_store WHERE service = ? AND account = ?')
        .get(service, account) as { ciphertext: Buffer | null } | undefined;
      return row ? { ciphertext: row.ciphertext ?? null } : undefined;
    },
    put(service, account, ciphertext, updatedAt) {
      open()
        .prepare(
          `INSERT INTO credential_store (service, account, ciphertext, updated_at) VALUES (?, ?, ?, ?)
           ON CONFLICT(service, account) DO UPDATE SET ciphertext = excluded.ciphertext, updated_at = excluded.updated_at`,
        )
        .run(service, account, ciphertext, updatedAt);
    },
    delete(service, account) {
      open().prepare('DELETE FROM credential_store WHERE service = ? AND account = ?').run(service, account);
    },
    clear() {
      open().prepare('DELETE FROM credential_store').run();
    },
    close() {
      db?.close();
      db = null;
    },
  };
}

let runtimeTable: SqliteCredentialTable | null = null;

export function createRuntimeCredentialDeps(): CredentialStoreDeps {
  runtimeTable ??= createSqliteCredentialTable(credentialsDbPath());
  return {
    cipher: createSafeStorageCipher(),
    table: runtimeTable,
    legacy: legacyKeytar,
    whenReady: async () => {
      await app.whenReady();
    },
  };
}

/** Hard Reset: Datei schließen und löschen. */
export function removeRuntimeCredentialFile(userDataPath?: string): void {
  runtimeTable?.close();
  runtimeTable = null;
  const filePath = credentialsDbPath(userDataPath);
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    fs.rmSync(`${filePath}${suffix}`, { force: true });
  }
}
