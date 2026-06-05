import {
  PGP_PRIVATE_KEY_ENVELOPE_ALGORITHM,
  PGP_PRIVATE_KEY_KDF,
  type EncryptedPgpPrivateKeyEnvelope,
} from '../security';

export type PgpIdentityPrivateKeySecretIdentifier = Readonly<{
  workspaceId: string;
  kind: string;
  name: string;
}>;

export function pgpIdentityPrivateKeySecretIdentifier(
  workspaceId: string,
  id: number,
): PgpIdentityPrivateKeySecretIdentifier {
  return {
    workspaceId,
    kind: 'pgp.identity.private_key',
    name: `pgp_identity:${id}:private_key`,
  };
}

export function serializePgpPrivateKeyEnvelope(envelope: EncryptedPgpPrivateKeyEnvelope): string {
  return JSON.stringify({
    algorithm: envelope.algorithm,
    kdf: envelope.kdf,
    opsLimit: envelope.opsLimit,
    memLimit: envelope.memLimit,
    salt: envelope.salt.toString('base64'),
    nonce: envelope.nonce.toString('base64'),
    ciphertext: envelope.ciphertext.toString('base64'),
  });
}

export function deserializePgpPrivateKeyEnvelope(value: string | Buffer): EncryptedPgpPrivateKeyEnvelope {
  const parsed = parseEnvelopeJson(value);
  const algorithm = requiredString(parsed.algorithm, 'algorithm');
  const kdf = requiredString(parsed.kdf, 'kdf');
  if (algorithm !== PGP_PRIVATE_KEY_ENVELOPE_ALGORITHM) {
    throw new Error(`Unsupported PGP private key envelope algorithm: ${algorithm}`);
  }
  if (kdf !== PGP_PRIVATE_KEY_KDF) {
    throw new Error(`Unsupported PGP private key KDF: ${kdf}`);
  }

  return {
    algorithm,
    kdf,
    opsLimit: positiveInteger(parsed.opsLimit, 'opsLimit'),
    memLimit: positiveInteger(parsed.memLimit, 'memLimit'),
    salt: requiredBase64Buffer(parsed.salt, 'salt'),
    nonce: requiredBase64Buffer(parsed.nonce, 'nonce'),
    ciphertext: requiredBase64Buffer(parsed.ciphertext, 'ciphertext'),
  };
}

function parseEnvelopeJson(value: string | Buffer): Record<string, unknown> {
  try {
    const parsed = JSON.parse(Buffer.isBuffer(value) ? value.toString('utf8') : value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('not an object');
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw new Error('Invalid PGP private key envelope JSON');
  }
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`PGP private key envelope ${field} must be a non-empty string`);
  }
  return value;
}

function positiveInteger(value: unknown, field: string): number {
  if (!Number.isInteger(value) || Number(value) <= 0) {
    throw new Error(`PGP private key envelope ${field} must be a positive integer`);
  }
  return Number(value);
}

function requiredBase64Buffer(value: unknown, field: string): Buffer {
  const encoded = requiredString(value, field);
  if (encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    throw new Error(`PGP private key envelope ${field} must be base64`);
  }
  const decoded = Buffer.from(encoded, 'base64');
  if (decoded.length === 0) {
    throw new Error(`PGP private key envelope ${field} must not be empty`);
  }
  return decoded;
}
