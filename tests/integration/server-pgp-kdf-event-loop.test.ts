import {
  decryptPgpPrivateKeyWithPassphrase,
  encodePgpPrivateKeyAssociatedData,
  encryptPgpPrivateKeyWithPassphrase,
  type EncryptedPgpPrivateKeyEnvelope,
} from '../../packages/server/src/security/secret-envelope';

type Sodium = typeof import('libsodium-wrappers-sumo');

const PRIVATE_KEY = '-----BEGIN PGP PRIVATE KEY-----\nsecret\n-----END PGP PRIVATE KEY-----';
const ASSOCIATED_DATA = {
  workspaceId: '10000000-0000-4000-8000-0000000000e5',
  userId: '20000000-0000-4000-8000-0000000000e5',
  identityId: 'pgp-identity-1',
  fingerprint: 'ABCDEF123456',
};

async function loadSodium(): Promise<Sodium> {
  const sodium = jest.requireActual('../../packages/server/node_modules/libsodium-wrappers-sumo') as Sodium;
  await sodium.ready;
  return sodium;
}

/** Ein Umschlag, wie ihn die bisherige libsodium-Ableitung geschrieben hat. */
async function legacyEnvelope(passphrase: string, opsLimit: number, memLimit: number): Promise<EncryptedPgpPrivateKeyEnvelope> {
  const sodium = await loadSodium();
  const salt = Buffer.alloc(sodium.crypto_pwhash_SALTBYTES, 9);
  const nonce = Buffer.alloc(sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES, 3);
  const dek = sodium.crypto_pwhash(32, passphrase, salt, opsLimit, memLimit, sodium.crypto_pwhash_ALG_ARGON2ID13);
  const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
    Buffer.from(PRIVATE_KEY, 'utf8'),
    encodePgpPrivateKeyAssociatedData(ASSOCIATED_DATA),
    null,
    nonce,
    dek,
  );
  return {
    algorithm: 'xchacha20poly1305+argon2id',
    kdf: 'argon2id',
    opsLimit,
    memLimit,
    salt,
    nonce,
    ciphertext: Buffer.from(ciphertext),
  };
}

// F-A13A14-08: Die Argon2id-Ableitung (64 MiB) lief in libsodiums WASM synchron und hielt bei jedem PGP-Signieren/-Entschluesseln den Event-Loop ~200 ms fest.
describe('Argon2id fuer PGP-Passphrasen', () => {
  test('die Ableitung mit den Standardparametern laesst den Event-Loop weiterlaufen', async () => {
    const envelope = await encryptPgpPrivateKeyWithPassphrase({
      privateKeyArmored: PRIVATE_KEY,
      passphrase: 'correct horse battery staple',
      associatedData: ASSOCIATED_DATA,
    });
    expect(envelope.memLimit).toBe(64 * 1024 * 1024);

    let ticks = 0;
    const timer = setInterval(() => { ticks += 1; }, 1);
    let ticksWhenSettled = -1;
    try {
      await decryptPgpPrivateKeyWithPassphrase({
        envelope,
        passphrase: 'falsche Passphrase',
        associatedData: ASSOCIATED_DATA,
      }).then(
        () => { throw new Error('falsche Passphrase wurde akzeptiert'); },
        (error: Error) => {
          ticksWhenSettled = ticks;
          expect(error.message).toContain('PGP private key decryption failed');
        },
      );
    } finally {
      clearInterval(timer);
    }
    // Synchron blockiert laeuft waehrend der ganzen Ableitung kein einziger Timer.
    expect(ticksWhenSettled).toBeGreaterThanOrEqual(10);
  });

  test('bestehende Umschlaege aus der libsodium-Ableitung bleiben lesbar, neue ebenso fuer libsodium', async () => {
    for (const [opsLimit, memLimit] of [[1, 8192], [2, 64 * 1024 * 1024], [3, 1_000_000]] as const) {
      const legacy = await legacyEnvelope('pässwort ✓', opsLimit, memLimit);
      await expect(decryptPgpPrivateKeyWithPassphrase({
        envelope: legacy,
        passphrase: 'pässwort ✓',
        associatedData: ASSOCIATED_DATA,
      })).resolves.toEqual(Buffer.from(PRIVATE_KEY, 'utf8'));
    }

    const sodium = await loadSodium();
    const fresh = await encryptPgpPrivateKeyWithPassphrase({
      privateKeyArmored: PRIVATE_KEY,
      passphrase: 'pässwort ✓',
      associatedData: ASSOCIATED_DATA,
      kdf: { opsLimit: 2, memLimit: 1024 * 1024 },
    });
    const dek = sodium.crypto_pwhash(32, 'pässwort ✓', fresh.salt, fresh.opsLimit, fresh.memLimit, sodium.crypto_pwhash_ALG_ARGON2ID13);
    const plaintext = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
      null,
      fresh.ciphertext,
      encodePgpPrivateKeyAssociatedData(ASSOCIATED_DATA),
      fresh.nonce,
      dek,
    );
    expect(Buffer.from(plaintext).toString('utf8')).toBe(PRIVATE_KEY);
  });

  test('ohne crypto.argon2 (Node 24 vor 24.7) bleibt die libsodium-Ableitung', async () => {
    const legacy = await legacyEnvelope('correct horse battery staple', 1, 8192);
    await jest.isolateModulesAsync(async () => {
      jest.doMock('node:crypto', () => ({ ...jest.requireActual('node:crypto'), argon2: undefined }));
      const sodium = (await import('../../packages/server/node_modules/libsodium-wrappers-sumo')).default as Sodium;
      await sodium.ready;
      const pwhash = jest.spyOn(sodium, 'crypto_pwhash');
      const isolated = await import('../../packages/server/src/security/secret-envelope');
      await expect(isolated.decryptPgpPrivateKeyWithPassphrase({
        envelope: legacy,
        passphrase: 'correct horse battery staple',
        associatedData: ASSOCIATED_DATA,
      })).resolves.toEqual(Buffer.from(PRIVATE_KEY, 'utf8'));
      expect(pwhash).toHaveBeenCalledTimes(1);
    });
  });
});
