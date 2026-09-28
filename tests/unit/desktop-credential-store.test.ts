/**
 * @jest-environment node
 */
import {
  CREDENTIAL_WRITE_FAILED_MESSAGE,
  INSECURE_CREDENTIAL_STORE_MESSAGE,
  createCredentialStore,
  type CredentialCipher,
  type CredentialTable,
  type LegacyKeytar,
} from '../../electron/credentials/credential-store';

/**
 * Plan 044: Zugangsdaten-Speicher mit Umzug aus keytar. Kernregel: nie einen
 * Zugang verlieren – bei jedem Fehler bleibt es beim keytar-Wert, keytar wird
 * beim Umzug nie verändert, fremdes Chiffrat wird nie gelöscht.
 */
const SERVICE = 'SimpleCRMElectron-Email';

function memoryTable() {
  const rows = new Map<string, Buffer | null>();
  const key = (s: string, a: string) => `${s}|${a}`;
  const table: CredentialTable & { rows: Map<string, Buffer | null> } = {
    rows,
    get: (s, a) => (rows.has(key(s, a)) ? { ciphertext: rows.get(key(s, a)) ?? null } : undefined),
    put: (s, a, c) => {
      rows.set(key(s, a), c);
    },
    delete: (s, a) => {
      rows.delete(key(s, a));
    },
    clear: () => rows.clear(),
  };
  return table;
}

/** Reversibles Test-„Chiffrat“ mit Präfix wie Chromium (v11 = sicher, v10 = nur verschleiert). */
function fakeCipher(overrides: Partial<CredentialCipher> & { prefix?: string } = {}): CredentialCipher & { encrypt: jest.Mock; decrypt: jest.Mock } {
  const prefix = overrides.prefix ?? 'v11';
  return {
    isAvailable: overrides.isAvailable ?? (async () => true),
    encrypt: jest.fn(overrides.encrypt ?? (async (plain: string) => Buffer.from(`${prefix}${Buffer.from(plain, 'utf8').toString('base64')}`, 'latin1'))),
    decrypt: jest.fn(overrides.decrypt ?? (async (cipher: Buffer) => {
      const text = cipher.toString('latin1');
      if (!/^v1[01]/.test(text)) throw new Error('Decryption is not available');
      return { result: Buffer.from(text.slice(3).split(':')[0]!, 'base64').toString('utf8'), shouldReEncrypt: false };
    })),
    isSecureCiphertext: overrides.isSecureCiphertext ?? ((cipher: Buffer) => cipher.subarray(0, 3).toString('latin1') === 'v11'),
  };
}

function fakeKeytar(initial: Record<string, string> = {}): LegacyKeytar & { getPassword: jest.Mock; deletePassword: jest.Mock } {
  const values = new Map(Object.entries(initial));
  return {
    getPassword: jest.fn(async (s: string, a: string) => values.get(`${s}|${a}`) ?? null),
    deletePassword: jest.fn(async (s: string, a: string) => values.delete(`${s}|${a}`)),
  };
}

function setup(options: { cipher?: CredentialCipher; keytar?: Record<string, string>; table?: ReturnType<typeof memoryTable> } = {}) {
  const table = options.table ?? memoryTable();
  const cipher = (options.cipher ?? fakeCipher()) as ReturnType<typeof fakeCipher>;
  const legacy = fakeKeytar(options.keytar);
  const logger = { warn: jest.fn() };
  const store = createCredentialStore({ cipher, table, legacy, whenReady: async () => undefined, logger });
  return { store, table, cipher, legacy, logger };
}

describe('Zugangsdaten-Speicher (safeStorage)', () => {
  test('Treffer im Speicher: keytar wird nicht gefragt', async () => {
    const { store, legacy } = setup();
    await store.setSecret(SERVICE, 'acc-1', 'pw-äö€');
    await expect(store.getSecret(SERVICE, 'acc-1')).resolves.toBe('pw-äö€');
    expect(legacy.getPassword).not.toHaveBeenCalled();
  });

  test('Fehlt im Speicher, liegt in keytar: Umzug mit Gegenprobe, keytar bleibt unverändert', async () => {
    const { store, table, legacy } = setup({ keytar: { [`${SERVICE}|acc-1`]: 'alt-pw' } });
    await expect(store.getSecret(SERVICE, 'acc-1')).resolves.toBe('alt-pw');
    expect(table.get(SERVICE, 'acc-1')?.ciphertext?.subarray(0, 3).toString('latin1')).toBe('v11');
    expect(legacy.deletePassword).not.toHaveBeenCalled();
    // Zweiter Zugriff kommt aus dem Speicher.
    legacy.getPassword.mockClear();
    await expect(store.getSecret(SERVICE, 'acc-1')).resolves.toBe('alt-pw');
    expect(legacy.getPassword).not.toHaveBeenCalled();
  });

  test('Gegenprobe scheitert: keytar-Wert zurück, Speicher unverändert', async () => {
    const cipher = fakeCipher({ decrypt: async () => ({ result: 'etwas anderes', shouldReEncrypt: false }) });
    const { store, table, legacy } = setup({ cipher, keytar: { [`${SERVICE}|acc-1`]: 'alt-pw' } });
    await expect(store.getSecret(SERVICE, 'acc-1')).resolves.toBe('alt-pw');
    expect(table.rows.size).toBe(0);
    expect(legacy.deletePassword).not.toHaveBeenCalled();
  });

  test('Zurücklesen liefert andere Bytes: Eintrag wird wieder entfernt, keytar-Wert zurück', async () => {
    const table = memoryTable();
    const brokenTable = { ...table, get: (s: string, a: string) => (table.get(s, a) ? { ciphertext: Buffer.from('v11kaputt') } : undefined) };
    const { store, legacy } = setup({ table: brokenTable as any, keytar: { [`${SERVICE}|acc-1`]: 'alt-pw' } });
    await expect(store.getSecret(SERVICE, 'acc-1')).resolves.toBe('alt-pw');
    expect(table.rows.size).toBe(0);
    expect(legacy.deletePassword).not.toHaveBeenCalled();
  });

  test('Schreiben wirft oder keine Verschlüsselung: keytar-Wert zurück, nichts gespeichert', async () => {
    const throwing = fakeCipher({ encrypt: async () => { throw new Error('boom geheim-pw'); } });
    const a = setup({ cipher: throwing, keytar: { [`${SERVICE}|acc-1`]: 'alt-pw' } });
    await expect(a.store.getSecret(SERVICE, 'acc-1')).resolves.toBe('alt-pw');
    expect(a.table.rows.size).toBe(0);
    // Keine Geheimnisse im Log, auch nicht aus Fehlermeldungen.
    expect(JSON.stringify(a.logger.warn.mock.calls)).not.toContain('geheim-pw');
    expect(JSON.stringify(a.logger.warn.mock.calls)).not.toContain('alt-pw');

    const unavailable = fakeCipher({ isAvailable: async () => false });
    const b = setup({ cipher: unavailable, keytar: { [`${SERVICE}|acc-1`]: 'alt-pw' } });
    await expect(b.store.getSecret(SERVICE, 'acc-1')).resolves.toBe('alt-pw');
    expect(b.table.rows.size).toBe(0);
    expect(b.legacy.deletePassword).not.toHaveBeenCalled();
  });

  test('fremdes Chiffrat: gilt als fehlend, keytar-Rückfall, Zeile bleibt unverändert', async () => {
    const table = memoryTable();
    const foreign = Buffer.from('xx-fremd', 'latin1');
    table.put(SERVICE, 'acc-1', foreign, '2026-09-28T00:00:00Z');
    const { store, legacy, logger } = setup({ table, keytar: { [`${SERVICE}|acc-1`]: 'alt-pw' } });
    await expect(store.getSecret(SERVICE, 'acc-1')).resolves.toBe('alt-pw');
    expect(table.get(SERVICE, 'acc-1')?.ciphertext).toEqual(foreign);
    expect(legacy.deletePassword).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();

    // Ohne keytar-Wert: einfach „fehlt“, kein Absturz.
    const other = setup({ table });
    await expect(other.store.getSecret(SERVICE, 'acc-1')).resolves.toBeNull();
    expect(table.get(SERVICE, 'acc-1')?.ciphertext).toEqual(foreign);
  });

  test('Linux ohne sicheren Speicher (v10): setSecret lehnt mit deutscher Meldung ab, nichts geschrieben', async () => {
    const insecure = fakeCipher({ prefix: 'v10' });
    const { store, table } = setup({ cipher: insecure });
    await expect(store.setSecret(SERVICE, 'acc-1', 'pw')).rejects.toThrow(INSECURE_CREDENTIAL_STORE_MESSAGE);
    expect(table.rows.size).toBe(0);

    const unavailable = setup({ cipher: fakeCipher({ isAvailable: async () => false }) });
    await expect(unavailable.store.setSecret(SERVICE, 'acc-1', 'pw')).rejects.toThrow(INSECURE_CREDENTIAL_STORE_MESSAGE);
    expect(unavailable.table.rows.size).toBe(0);
  });

  test('Linux ohne sicheren Speicher: Lesen aus keytar geht weiter, aber kein Umzug in v10', async () => {
    const insecure = fakeCipher({ prefix: 'v10' });
    const { store, table } = setup({ cipher: insecure, keytar: { [`${SERVICE}|acc-1`]: 'alt-pw' } });
    await expect(store.getSecret(SERVICE, 'acc-1')).resolves.toBe('alt-pw');
    expect(table.rows.size).toBe(0);
  });

  test('setSecret: Gegenprobe scheitert → Fehler, nichts geschrieben', async () => {
    const cipher = fakeCipher({ decrypt: async () => ({ result: 'anders', shouldReEncrypt: false }) });
    const { store, table } = setup({ cipher });
    await expect(store.setSecret(SERVICE, 'acc-1', 'pw')).rejects.toThrow(CREDENTIAL_WRITE_FAILED_MESSAGE);
    expect(table.rows.size).toBe(0);
  });

  test('Löschen: Grabstein verhindert Wiederauftauchen des keytar-Werts; keytar wird wie bisher gelöscht', async () => {
    const { store, legacy, table } = setup({ keytar: { [`${SERVICE}|acc-1`]: 'alt-pw' } });
    await expect(store.deleteSecret(SERVICE, 'acc-1')).resolves.toBe(true);
    expect(legacy.deletePassword).toHaveBeenCalledWith(SERVICE, 'acc-1');
    expect(table.get(SERVICE, 'acc-1')).toEqual({ ciphertext: null });
    await expect(store.getSecret(SERVICE, 'acc-1')).resolves.toBeNull();

    // Auch wenn keytar beim Löschen scheitert, bleibt der Wert weg.
    const failing = setup({ keytar: { [`${SERVICE}|acc-2`]: 'alt-pw' } });
    failing.legacy.deletePassword.mockRejectedValue(new Error('kein Secret-Service'));
    await expect(failing.store.deleteSecret(SERVICE, 'acc-2')).resolves.toBe(false);
    await expect(failing.store.getSecret(SERVICE, 'acc-2')).resolves.toBeNull();

    // Nach dem Löschen wieder setzen: neuer Wert gilt.
    await failing.store.setSecret(SERVICE, 'acc-2', 'neu');
    await expect(failing.store.getSecret(SERVICE, 'acc-2')).resolves.toBe('neu');
    await expect(setup().store.deleteSecret(SERVICE, 'nie-gesetzt')).resolves.toBe(false);
  });

  test('gleichzeitige Zugriffe auf denselben Eintrag ziehen nur einmal um', async () => {
    const { store, legacy, cipher } = setup({ keytar: { [`${SERVICE}|acc-1`]: 'alt-pw' } });
    const results = await Promise.all([
      store.getSecret(SERVICE, 'acc-1'),
      store.getSecret(SERVICE, 'acc-1'),
      store.getSecret(SERVICE, 'acc-1'),
    ]);
    expect(results).toEqual(['alt-pw', 'alt-pw', 'alt-pw']);
    expect(legacy.getPassword).toHaveBeenCalledTimes(1);
    expect(cipher.encrypt).toHaveBeenCalledTimes(1);
  });

  test('shouldReEncrypt: neu verschlüsselt und nach Gegenprobe ersetzt', async () => {
    const table = memoryTable();
    const base = fakeCipher();
    let first = true;
    const cipher = fakeCipher({
      decrypt: async (c: Buffer) => {
        const opened = await base.decrypt(c);
        const flag = first;
        first = false;
        return { ...opened, shouldReEncrypt: flag };
      },
      encrypt: async (plain: string) => Buffer.concat([await base.encrypt(plain), Buffer.from(':neu')]),
    });
    table.put(SERVICE, 'acc-1', await base.encrypt('pw'), 'x');
    const { store } = setup({ table, cipher });
    await expect(store.getSecret(SERVICE, 'acc-1')).resolves.toBe('pw');
    expect(table.get(SERVICE, 'acc-1')?.ciphertext?.toString('latin1').endsWith(':neu')).toBe(true);
  });

  test('purgeAllSecrets leert den Speicher', async () => {
    const { store, table } = setup();
    await store.setSecret(SERVICE, 'acc-1', 'pw');
    store.purgeAllSecrets();
    expect(table.rows.size).toBe(0);
  });
});
