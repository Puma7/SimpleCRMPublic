/**
 * Plan 044 (Desktop): ein Speicher für alle Geheimnisse, verschlüsselt mit
 * Electron `safeStorage`, statt `keytar`. Entscheidungen:
 * docs/design/desktop-credential-store.md (freigegeben 28.09.2026).
 *
 * - Chiffrat in eigener Datei `credentials.sqlite` (nie im Mail-Backup).
 * - Nur die asynchrone API; `shouldReEncrypt` wird nach Gegenprobe ersetzt.
 * - Ohne sicheren Speicher (Linux: Chiffrat ohne `v11`) werden neue Geheimnisse
 *   nicht gespeichert; Lesen aus keytar funktioniert weiter.
 * - Umzug je Eintrag beim ersten Lesen: verschlüsseln → entschlüsseln und
 *   vergleichen → schreiben → Bytes zurücklesen und vergleichen. Bei jedem
 *   Fehler bleibt es beim keytar-Wert; keytar wird dabei nie verändert
 *   (Löschen der alten Einträge erst eine Version später).
 * - Ein nicht entschlüsselbarer Eintrag (fremder Rechner) gilt als fehlend und
 *   wird nie gelöscht oder überschrieben.
 * - Löschen durch den Nutzer hinterlässt einen leeren Eintrag (Grabstein), damit
 *   der alte keytar-Wert nicht wieder auftaucht, und löscht wie bisher auch in
 *   keytar.
 * - Geheimnisse erscheinen nie in Logs oder Fehlermeldungen.
 */

export const INSECURE_CREDENTIAL_STORE_MESSAGE =
  'Kein sicherer Schlüsselspeicher gefunden – Zugangsdaten werden nicht gespeichert.';
export const CREDENTIAL_WRITE_FAILED_MESSAGE =
  'Zugangsdaten konnten nicht sicher gespeichert werden.';

export type CredentialCipher = Readonly<{
  /** `safeStorage.isAsyncEncryptionAvailable()`. */
  isAvailable(): Promise<boolean>;
  encrypt(plain: string): Promise<Buffer>;
  decrypt(ciphertext: Buffer): Promise<{ result: string; shouldReEncrypt: boolean }>;
  /** Linux: nur ein Chiffrat mit Präfix `v11` ist wirklich verschlüsselt. */
  isSecureCiphertext(ciphertext: Buffer): boolean;
  /** Kurzer Befund ohne Geheimnisse (Backend, Verfügbarkeit, Präfix) für Meldung und Log. */
  describe?(): Promise<string>;
}>;

export type CredentialRow = Readonly<{ ciphertext: Buffer | null }>;

export type CredentialTable = Readonly<{
  get(service: string, account: string): CredentialRow | undefined;
  /** ciphertext null = Grabstein (vom Nutzer gelöscht). */
  put(service: string, account: string, ciphertext: Buffer | null, updatedAt: string): void;
  delete(service: string, account: string): void;
  clear(): void;
}>;

export type LegacyKeytar = Readonly<{
  getPassword(service: string, account: string): Promise<string | null>;
  deletePassword(service: string, account: string): Promise<boolean>;
}>;

export type CredentialStoreDeps = Readonly<{
  cipher: CredentialCipher;
  table: CredentialTable;
  legacy: LegacyKeytar;
  /** Electron: `app.whenReady()` – safeStorage ist erst danach nutzbar. */
  whenReady(): Promise<void>;
  now?: () => Date;
  logger?: Pick<Console, 'warn'>;
}>;

export type CredentialStore = Readonly<{
  getSecret(service: string, account: string): Promise<string | null>;
  setSecret(service: string, account: string, value: string): Promise<void>;
  /** true, wenn es vorher einen Wert gab (Speicher oder keytar). */
  deleteSecret(service: string, account: string): Promise<boolean>;
  /** Hard Reset: leert den Speicher (keytar räumt keytar-purge.ts). */
  purgeAllSecrets(): void;
}>;

function errorText(error: unknown): string {
  return error instanceof Error ? error.name : 'Fehler';
}

export function createCredentialStore(deps: CredentialStoreDeps): CredentialStore {
  const now = () => (deps.now?.() ?? new Date()).toISOString();
  const logger = deps.logger ?? console;
  const inflight = new Map<string, Promise<string | null>>();
  const keyOf = (service: string, account: string) => `${service}\u0000${account}`;

  /** Verschlüsseln und vor dem Schreiben entschlüsseln und vergleichen; null = nicht sicher möglich. */
  async function sealVerified(value: string): Promise<Buffer | null> {
    if (!(await deps.cipher.isAvailable())) return null;
    const sealed = await deps.cipher.encrypt(value);
    if (!deps.cipher.isSecureCiphertext(sealed)) return null;
    const check = await deps.cipher.decrypt(sealed);
    return check.result === value ? sealed : null;
  }

  function readBackEquals(service: string, account: string, sealed: Buffer): boolean {
    const row = deps.table.get(service, account);
    return Boolean(row?.ciphertext && Buffer.compare(row.ciphertext, sealed) === 0);
  }

  /** Umzug aus keytar; bei jedem Fehler bleibt der Speicher wie vorher. */
  async function migrate(service: string, account: string, value: string): Promise<void> {
    try {
      const sealed = await sealVerified(value);
      if (!sealed) return;
      // Zwischenzeitlich gesetzt oder gelöscht (setSecret/deleteSecret): nichts überschreiben.
      if (deps.table.get(service, account) !== undefined) return;
      deps.table.put(service, account, sealed, now());
      if (!readBackEquals(service, account, sealed)) {
        deps.table.delete(service, account);
      }
    } catch (error) {
      logger.warn(`[credentials] Umzug aus dem Schlüsselbund fehlgeschlagen (${service}): ${errorText(error)}`);
    }
  }

  async function reEncrypt(service: string, account: string, value: string, previous: Buffer): Promise<void> {
    try {
      const sealed = await sealVerified(value);
      if (!sealed) return;
      const current = deps.table.get(service, account);
      if (!current?.ciphertext || Buffer.compare(current.ciphertext, previous) !== 0) return;
      deps.table.put(service, account, sealed, now());
      if (!readBackEquals(service, account, sealed)) deps.table.put(service, account, previous, now());
    } catch (error) {
      logger.warn(`[credentials] Neu verschlüsseln fehlgeschlagen (${service}): ${errorText(error)}`);
    }
  }

  async function readSecret(service: string, account: string): Promise<string | null> {
    await deps.whenReady();
    const row = deps.table.get(service, account);
    if (row && row.ciphertext === null) return null;
    let undecryptable = false;
    if (row?.ciphertext) {
      try {
        const opened = await deps.cipher.decrypt(row.ciphertext);
        if (opened.shouldReEncrypt) await reEncrypt(service, account, opened.result, row.ciphertext);
        return opened.result;
      } catch (error) {
        // Fremdes oder beschädigtes Chiffrat: gilt als fehlend, bleibt aber liegen.
        undecryptable = true;
        logger.warn(`[credentials] Eintrag nicht entschlüsselbar (${service}), nutze den Schlüsselbund: ${errorText(error)}`);
      }
    }
    const legacy = await deps.legacy.getPassword(service, account);
    if (legacy === null || legacy === undefined) return null;
    if (!undecryptable) await migrate(service, account, legacy);
    return legacy;
  }

  return {
    async getSecret(service, account) {
      const key = keyOf(service, account);
      const running = inflight.get(key);
      if (running) return running;
      const promise = readSecret(service, account).finally(() => inflight.delete(key));
      inflight.set(key, promise);
      return promise;
    },

    async setSecret(service, account, value) {
      await deps.whenReady();
      const insecure = async (): Promise<Error> => {
        let detail = '';
        try {
          detail = (await deps.cipher.describe?.()) ?? '';
        } catch {
          detail = '';
        }
        logger.warn(`[credentials] ${INSECURE_CREDENTIAL_STORE_MESSAGE}${detail ? ` (${detail})` : ''}`);
        return new Error(detail ? `${INSECURE_CREDENTIAL_STORE_MESSAGE} (${detail})` : INSECURE_CREDENTIAL_STORE_MESSAGE);
      };
      if (!(await deps.cipher.isAvailable())) throw await insecure();
      const sealed = await deps.cipher.encrypt(value);
      if (!deps.cipher.isSecureCiphertext(sealed)) throw await insecure();
      const check = await deps.cipher.decrypt(sealed);
      if (check.result !== value) throw new Error(CREDENTIAL_WRITE_FAILED_MESSAGE);
      deps.table.put(service, account, sealed, now());
      if (!readBackEquals(service, account, sealed)) throw new Error(CREDENTIAL_WRITE_FAILED_MESSAGE);
    },

    async deleteSecret(service, account) {
      await deps.whenReady();
      const row = deps.table.get(service, account);
      const hadStoreValue = Boolean(row?.ciphertext);
      deps.table.put(service, account, null, now());
      let hadLegacyValue = false;
      try {
        hadLegacyValue = await deps.legacy.deletePassword(service, account);
      } catch (error) {
        logger.warn(`[credentials] Löschen im Schlüsselbund fehlgeschlagen (${service}): ${errorText(error)}`);
      }
      return hadStoreValue || hadLegacyValue;
    },

    purgeAllSecrets() {
      deps.table.clear();
    },
  };
}
