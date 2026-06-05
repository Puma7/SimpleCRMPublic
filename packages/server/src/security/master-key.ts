import { randomBytes, timingSafeEqual } from 'node:crypto';

export const MASTER_KEY_BYTES = 32;
export const SECRET_ENVELOPE_ALGORITHM = 'xchacha20poly1305';

export type MasterKeyMaterial = {
  bytes: Buffer;
  keyId: string;
};

export type SecretEnvelopeMetadata = {
  algorithm: typeof SECRET_ENVELOPE_ALGORITHM;
  keyId: string;
  nonce: Buffer;
};

export function parseBase64MasterKey(input: string, keyId = 'default'): MasterKeyMaterial {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error('SIMPLECRM_MASTER_KEY is required');
  }
  const bytes = Buffer.from(trimmed, 'base64');
  if (bytes.length !== MASTER_KEY_BYTES) {
    throw new Error(`SIMPLECRM_MASTER_KEY must decode to ${MASTER_KEY_BYTES} bytes`);
  }
  if (!keyId.trim()) {
    throw new Error('keyId is required');
  }
  return { bytes, keyId: keyId.trim() };
}

export function createSecretEnvelopeMetadata(key: MasterKeyMaterial): SecretEnvelopeMetadata {
  return {
    algorithm: SECRET_ENVELOPE_ALGORITHM,
    keyId: key.keyId,
    nonce: randomBytes(24),
  };
}

export function equalSecretBytes(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
