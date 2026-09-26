/**
 * @jest-environment node
 */
import type { Kysely } from 'kysely';
import * as openpgp from 'openpgp';

import { MAX_INBOUND_RFC822_BYTES } from '../../packages/core/src/email/inbound-message-size';
import type { PostgresSecretPort } from '../../packages/server/src/db/postgres-secret-port';
import type { ServerDatabase } from '../../packages/server/src/db/schema';
import { createPostgresPgpMessageCryptoPort } from '../../packages/server/src/pgp/message-crypto-port';
import { serializePgpPrivateKeyEnvelope } from '../../packages/server/src/pgp/private-key-envelope';
import { encryptPgpPrivateKeyWithPassphrase } from '../../packages/server/src/security';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const PASSPHRASE = 'correct horse battery staple';
const IDENTITY = { id: 1, fingerprint: 'ABCDEF0123456789', private_key_secret_id: 'secret-1' };
const OVERSIZED_PLAINTEXT_BYTES = MAX_INBOUND_RFC822_BYTES + 1024 * 1024;

type KeyPair = { privateKey: string; publicKey: openpgp.PublicKey };

/** Kysely stand-in: every selectFrom(table) chain resolves to rows[table]. */
function fakeDb(rows: Record<string, unknown>): Kysely<ServerDatabase> {
  const selectFrom = (table: string) => {
    const chain = {
      select: () => chain,
      where: () => chain,
      orderBy: () => chain,
      executeTakeFirst: async () => rows[table],
    };
    return chain;
  };
  return {
    transaction: () => ({ execute: async (operation: (trx: unknown) => unknown) => operation({ selectFrom }) }),
  } as unknown as Kysely<ServerDatabase>;
}

async function createPort(keys: KeyPair, rows: Record<string, unknown>) {
  const envelope = await encryptPgpPrivateKeyWithPassphrase({
    privateKeyArmored: keys.privateKey,
    passphrase: PASSPHRASE,
    associatedData: {
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
      identityId: String(IDENTITY.id),
      fingerprint: IDENTITY.fingerprint,
    },
    kdf: { opsLimit: 1, memLimit: 8192, salt: Buffer.alloc(16, 4) },
  });
  const secrets = {
    readSecret: async () => Buffer.from(serializePgpPrivateKeyEnvelope(envelope), 'utf8'),
  } as unknown as PostgresSecretPort;
  return createPostgresPgpMessageCryptoPort({
    db: fakeDb({ pgp_identities: IDENTITY, ...rows }),
    secrets,
    applyWorkspaceSession: async () => undefined,
    importOpenPgp: async () => openpgp,
  });
}

async function encryptCompressed(
  keys: KeyPair,
  message: openpgp.Message<string | Uint8Array>,
  format: 'armored' | 'binary',
) {
  return openpgp.encrypt({
    message,
    encryptionKeys: keys.publicKey,
    format: format as 'armored',
    config: { preferredCompressionAlgorithm: openpgp.enums.compression.zlib },
  });
}

describe('server PGP decryption decompression limit', () => {
  let keys: KeyPair;

  beforeAll(async () => {
    const generated = await openpgp.generateKey({
      userIDs: [{ name: 'Test', email: 'test@example.com' }],
      passphrase: PASSPHRASE,
      format: 'armored',
    });
    keys = {
      privateKey: generated.privateKey,
      publicKey: await openpgp.readKey({ armoredKey: generated.publicKey }),
    };
  });

  test('decrypts an ordinary compressed message and attachment', async () => {
    const armored = await encryptCompressed(
      keys,
      await openpgp.createMessage({ text: 'Hallo verschluesselte Welt' }),
      'armored',
    );
    const port = await createPort(keys, {
      email_messages: { id: 7, body_text: `Vorspann\n${armored}`, body_html: null },
    });

    await expect(port.decryptMessage({
      workspaceId: WORKSPACE_ID,
      actorUserId: USER_ID,
      messageId: 7,
      passphrase: PASSPHRASE,
    })).resolves.toEqual({ ok: true, result: { text: 'Hallo verschluesselte Welt', status: 'decrypted' } });

    const binary = await encryptCompressed(
      keys,
      await openpgp.createMessage({ binary: new Uint8Array([1, 2, 3, 4]) }),
      'binary',
    );
    const attachment = await port.decryptAttachment!({
      workspaceId: WORKSPACE_ID,
      actorUserId: USER_ID,
      attachment: { id: 3, filename: 'daten.bin.gpg', bytes: binary as unknown as Uint8Array },
      passphrase: PASSPHRASE,
    });
    expect(attachment.ok).toBe(true);
    expect(attachment.ok && Array.from(attachment.result.content)).toEqual([1, 2, 3, 4]);
  });

  // F-A13A14-05: openpgp.decrypt lief ohne maxDecompressedMessageSize; ein kleines Chiffrat entpackte sich zu beliebig grossem Klartext im API-Prozess.
  test('rejects a compressed message that expands beyond the plaintext limit', async () => {
    const armored = await encryptCompressed(
      keys,
      await openpgp.createMessage({ text: 'a'.repeat(OVERSIZED_PLAINTEXT_BYTES) }),
      'armored',
    );
    expect(armored.length).toBeLessThan(1024 * 1024);
    const port = await createPort(keys, {
      email_messages: { id: 8, body_text: armored, body_html: null },
    });

    const result = await port.decryptMessage({
      workspaceId: WORKSPACE_ID,
      actorUserId: USER_ID,
      messageId: 8,
      passphrase: PASSPHRASE,
    });
    expect(result.ok ? `entschluesselt: ${result.result.text.length} Zeichen` : result.code)
      .toBe('decrypt_failed');
  }, 60_000);

  // F-A13A14-05: Gleiches fuer Anhaenge (format 'binary'), die danach zusaetzlich base64-kodiert ausgeliefert werden.
  test('rejects a compressed attachment that expands beyond the plaintext limit', async () => {
    const binary = await encryptCompressed(
      keys,
      await openpgp.createMessage({ binary: new Uint8Array(OVERSIZED_PLAINTEXT_BYTES) }),
      'binary',
    );
    const port = await createPort(keys, {});

    const result = await port.decryptAttachment!({
      workspaceId: WORKSPACE_ID,
      actorUserId: USER_ID,
      attachment: { id: 4, filename: 'bombe.bin.gpg', bytes: binary as unknown as Uint8Array },
      passphrase: PASSPHRASE,
    });
    expect(result.ok ? `entschluesselt: ${result.result.content.length} Bytes` : result.code)
      .toBe('decrypt_failed');
  }, 60_000);
});
