import {
  createSecretEnvelopeMetadata,
  MASTER_KEY_BYTES,
  SECRET_ENVELOPE_ALGORITHM,
  type MasterKeyMaterial,
} from './master-key';

export type EncryptedSecretEnvelope = Readonly<{
  algorithm: typeof SECRET_ENVELOPE_ALGORITHM;
  keyId: string;
  nonce: Buffer;
  ciphertext: Buffer;
}>;

export type SecretAssociatedData = Readonly<{
  workspaceId: string;
  kind: string;
  name: string;
}>;

export const PGP_PRIVATE_KEY_ENVELOPE_ALGORITHM = 'xchacha20poly1305+argon2id' as const;
export const PGP_PRIVATE_KEY_KDF = 'argon2id' as const;
export const PGP_PRIVATE_KEY_DEK_BYTES = 32;

export type PgpPrivateKeyAssociatedData = Readonly<{
  workspaceId: string;
  userId: string;
  identityId: string;
  fingerprint: string;
}>;

export type PgpPrivateKeyKdfOptions = Readonly<{
  opsLimit?: number;
  memLimit?: number;
  salt?: Buffer;
}>;

export type EncryptedPgpPrivateKeyEnvelope = Readonly<{
  algorithm: typeof PGP_PRIVATE_KEY_ENVELOPE_ALGORITHM;
  kdf: typeof PGP_PRIVATE_KEY_KDF;
  opsLimit: number;
  memLimit: number;
  salt: Buffer;
  nonce: Buffer;
  ciphertext: Buffer;
}>;

type Sodium = typeof import('libsodium-wrappers-sumo');

export async function encryptSecretValue(input: {
  key: MasterKeyMaterial;
  value: string | Buffer;
  associatedData: SecretAssociatedData;
}): Promise<EncryptedSecretEnvelope> {
  assertMasterKey(input.key);
  const sodium = await loadSodium();
  const metadata = createSecretEnvelopeMetadata(input.key);
  const plaintext = toUint8Array(Buffer.isBuffer(input.value)
    ? input.value
    : Buffer.from(input.value, 'utf8'));
  const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
    plaintext,
    toUint8Array(encodeAssociatedData(input.associatedData)),
    null,
    toUint8Array(metadata.nonce),
    toUint8Array(input.key.bytes),
  );

  return {
    algorithm: metadata.algorithm,
    keyId: metadata.keyId,
    nonce: Buffer.from(metadata.nonce),
    ciphertext: Buffer.from(ciphertext),
  };
}

export async function decryptSecretValue(input: {
  key: MasterKeyMaterial;
  envelope: EncryptedSecretEnvelope;
  associatedData: SecretAssociatedData;
}): Promise<Buffer> {
  assertMasterKey(input.key);
  if (input.envelope.algorithm !== SECRET_ENVELOPE_ALGORITHM) {
    throw new Error(`Unsupported secret envelope algorithm: ${input.envelope.algorithm}`);
  }
  if (input.envelope.keyId !== input.key.keyId) {
    throw new Error(`Secret envelope requires key ${input.envelope.keyId}`);
  }

  const sodium = await loadSodium();
  try {
    const plaintext = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
      null,
      toUint8Array(input.envelope.ciphertext),
      toUint8Array(encodeAssociatedData(input.associatedData)),
      toUint8Array(input.envelope.nonce),
      toUint8Array(input.key.bytes),
    );
    return Buffer.from(plaintext);
  } catch (error) {
    throw new Error(`Secret decryption failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function rotateSecretEnvelope(input: {
  currentKey: MasterKeyMaterial;
  nextKey: MasterKeyMaterial;
  envelope: EncryptedSecretEnvelope;
  associatedData: SecretAssociatedData;
}): Promise<EncryptedSecretEnvelope> {
  const plaintext = await decryptSecretValue({
    key: input.currentKey,
    envelope: input.envelope,
    associatedData: input.associatedData,
  });
  return encryptSecretValue({
    key: input.nextKey,
    value: plaintext,
    associatedData: input.associatedData,
  });
}

export async function encryptPgpPrivateKeyWithPassphrase(input: {
  privateKeyArmored: string | Buffer;
  passphrase: string;
  associatedData: PgpPrivateKeyAssociatedData;
  kdf?: PgpPrivateKeyKdfOptions;
}): Promise<EncryptedPgpPrivateKeyEnvelope> {
  assertPassphrase(input.passphrase);
  const sodium = await loadSodium();
  const kdf = normalizePgpKdfOptions(sodium, input.kdf);
  const nonce = Buffer.from(sodium.randombytes_buf(sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES));
  const dek = derivePgpPrivateKeyDek(sodium, input.passphrase, kdf);

  try {
    const plaintext = Buffer.isBuffer(input.privateKeyArmored)
      ? input.privateKeyArmored
      : Buffer.from(input.privateKeyArmored, 'utf8');
    const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
      toUint8Array(plaintext),
      toUint8Array(encodePgpPrivateKeyAssociatedData(input.associatedData)),
      null,
      toUint8Array(nonce),
      toUint8Array(dek),
    );

    return {
      algorithm: PGP_PRIVATE_KEY_ENVELOPE_ALGORITHM,
      kdf: PGP_PRIVATE_KEY_KDF,
      opsLimit: kdf.opsLimit,
      memLimit: kdf.memLimit,
      salt: Buffer.from(kdf.salt),
      nonce,
      ciphertext: Buffer.from(ciphertext),
    };
  } finally {
    dek.fill(0);
  }
}

export async function decryptPgpPrivateKeyWithPassphrase(input: {
  envelope: EncryptedPgpPrivateKeyEnvelope;
  passphrase: string;
  associatedData: PgpPrivateKeyAssociatedData;
}): Promise<Buffer> {
  assertPassphrase(input.passphrase);
  assertPgpPrivateKeyEnvelope(input.envelope);
  const sodium = await loadSodium();
  const dek = derivePgpPrivateKeyDek(sodium, input.passphrase, {
    opsLimit: input.envelope.opsLimit,
    memLimit: input.envelope.memLimit,
    salt: input.envelope.salt,
  });

  try {
    const plaintext = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
      null,
      toUint8Array(input.envelope.ciphertext),
      toUint8Array(encodePgpPrivateKeyAssociatedData(input.associatedData)),
      toUint8Array(input.envelope.nonce),
      toUint8Array(dek),
    );
    return Buffer.from(plaintext);
  } catch (error) {
    throw new Error(`PGP private key decryption failed: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    dek.fill(0);
  }
}

export async function rotatePgpPrivateKeyPassphrase(input: {
  envelope: EncryptedPgpPrivateKeyEnvelope;
  currentPassphrase: string;
  nextPassphrase: string;
  associatedData: PgpPrivateKeyAssociatedData;
  kdf?: PgpPrivateKeyKdfOptions;
}): Promise<EncryptedPgpPrivateKeyEnvelope> {
  const plaintext = await decryptPgpPrivateKeyWithPassphrase({
    envelope: input.envelope,
    passphrase: input.currentPassphrase,
    associatedData: input.associatedData,
  });
  try {
    return await encryptPgpPrivateKeyWithPassphrase({
      privateKeyArmored: plaintext,
      passphrase: input.nextPassphrase,
      associatedData: input.associatedData,
      kdf: input.kdf,
    });
  } finally {
    plaintext.fill(0);
  }
}

export function encodeAssociatedData(input: SecretAssociatedData): Buffer {
  for (const [key, value] of Object.entries(input)) {
    if (!value.trim()) {
      throw new Error(`Secret associated data ${key} is required`);
    }
  }
  return Buffer.from(JSON.stringify({
    workspaceId: input.workspaceId,
    kind: input.kind,
    name: input.name,
  }), 'utf8');
}

export function encodePgpPrivateKeyAssociatedData(input: PgpPrivateKeyAssociatedData): Buffer {
  for (const [key, value] of Object.entries(input)) {
    if (!value.trim()) {
      throw new Error(`PGP private key associated data ${key} is required`);
    }
  }
  return Buffer.from(JSON.stringify({
    purpose: 'pgp_private_key',
    workspaceId: input.workspaceId,
    userId: input.userId,
    identityId: input.identityId,
    fingerprint: input.fingerprint,
  }), 'utf8');
}

async function loadSodium(): Promise<Sodium> {
  const sodium = require('libsodium-wrappers-sumo') as Sodium;
  await sodium.ready;
  return sodium;
}

function assertMasterKey(key: MasterKeyMaterial): void {
  if (key.bytes.length !== MASTER_KEY_BYTES) {
    throw new Error(`master key must be ${MASTER_KEY_BYTES} bytes`);
  }
}

function assertPassphrase(passphrase: string): void {
  if (!passphrase.trim()) {
    throw new Error('PGP private key passphrase is required');
  }
}

function normalizePgpKdfOptions(
  sodium: Sodium,
  input: PgpPrivateKeyKdfOptions | undefined,
): Required<PgpPrivateKeyKdfOptions> {
  const opsLimit = input?.opsLimit ?? sodium.crypto_pwhash_OPSLIMIT_INTERACTIVE;
  const memLimit = input?.memLimit ?? sodium.crypto_pwhash_MEMLIMIT_INTERACTIVE;
  const salt = input?.salt ?? Buffer.from(sodium.randombytes_buf(sodium.crypto_pwhash_SALTBYTES));

  if (!Number.isInteger(opsLimit) || opsLimit <= 0) {
    throw new Error('PGP private key opsLimit must be a positive integer');
  }
  if (!Number.isInteger(memLimit) || memLimit <= 0) {
    throw new Error('PGP private key memLimit must be a positive integer');
  }
  if (salt.length !== sodium.crypto_pwhash_SALTBYTES) {
    throw new Error(`PGP private key salt must be ${sodium.crypto_pwhash_SALTBYTES} bytes`);
  }

  return {
    opsLimit,
    memLimit,
    salt: Buffer.from(salt),
  };
}

function assertPgpPrivateKeyEnvelope(envelope: EncryptedPgpPrivateKeyEnvelope): void {
  if (envelope.algorithm !== PGP_PRIVATE_KEY_ENVELOPE_ALGORITHM) {
    throw new Error(`Unsupported PGP private key envelope algorithm: ${envelope.algorithm}`);
  }
  if (envelope.kdf !== PGP_PRIVATE_KEY_KDF) {
    throw new Error(`Unsupported PGP private key KDF: ${envelope.kdf}`);
  }
}

function derivePgpPrivateKeyDek(
  sodium: Sodium,
  passphrase: string,
  kdf: Required<PgpPrivateKeyKdfOptions>,
): Buffer {
  return Buffer.from(sodium.crypto_pwhash(
    PGP_PRIVATE_KEY_DEK_BYTES,
    passphrase,
    toUint8Array(kdf.salt),
    kdf.opsLimit,
    kdf.memLimit,
    sodium.crypto_pwhash_ALG_ARGON2ID13,
  ));
}

function toUint8Array(value: Buffer): Uint8Array {
  return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
}
