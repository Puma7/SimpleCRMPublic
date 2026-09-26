/**
 * @jest-environment node
 *
 * Server-PGP mit echtem openpgp: Import eines Empfaengerschluessels ueber
 * POST /api/v1/pgp/peer-keys/import (Vorbild Desktop: tests/mail/pgp-service-openpgp.test.ts).
 */
import * as openpgp from 'openpgp';

import {
  createServerApi,
  type AuthApiPort,
  type PgpPeerKeyApiPort,
  type PgpPeerKeyRecord,
  type ServerApiPorts,
} from '../../packages/server/src';
import { createOpenPgpKeyMaterialPort } from '../../packages/server/src/pgp/openpgp-key-material-port';

const principal = { userId: 'user-1', workspaceId: 'workspace-1', role: 'owner' as const };
const keyMaterial = createOpenPgpKeyMaterialPort({ importOpenPgp: async () => openpgp as any });

let bobPublicKey = '';
let bobFingerprint = '';
let nameOnlyPublicKey = '';

beforeAll(async () => {
  const bob = await openpgp.generateKey({
    type: 'ecc',
    userIDs: [{ name: 'Bob', email: 'Bob@Example.com' }],
    format: 'armored',
  });
  bobPublicKey = bob.publicKey;
  bobFingerprint = (await openpgp.readKey({ armoredKey: bob.publicKey })).getFingerprint().toLowerCase();
  const nameOnly = await openpgp.generateKey({ type: 'ecc', userIDs: [{ name: 'Nur Name' }], format: 'armored' });
  nameOnlyPublicKey = nameOnly.publicKey;
});

describe('server PGP peer key import with real openpgp', () => {
  // F-N-pgp-01: Der Import speicherte String(userID) = '[object Object]' als E-Mail, Verschluesseln/Pruefen fand den Schluessel nie.
  test('reads the e-mail address from the primary user id', async () => {
    await expect(keyMaterial.readPublicKey({ armored: bobPublicKey })).resolves.toEqual({
      email: 'bob@example.com',
      fingerprint: bobFingerprint,
    });
  });

  test('stores the imported peer key under the e-mail address of its user id', async () => {
    const pgpPeerKeys = peerKeyPort();
    const api = createServerApi(ports({ pgpPeerKeys }));

    const response = await api.handle({
      method: 'POST',
      path: '/api/v1/pgp/peer-keys/import',
      body: { armored: bobPublicKey },
      principal,
    });

    expect(response.status).toBe(201);
    expect(pgpPeerKeys.create).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      actorUserId: 'user-1',
      values: {
        email: 'bob@example.com',
        fingerprint: bobFingerprint,
        publicKeyArmor: bobPublicKey.trim(),
        source: 'manual',
        trustLevel: 'imported',
      },
    });
  });

  test('rejects a key whose user ids carry no e-mail address', async () => {
    await expect(keyMaterial.readPublicKey({ armored: nameOnlyPublicKey })).rejects.toThrow(/E-Mail/);

    const pgpPeerKeys = peerKeyPort();
    const api = createServerApi(ports({ pgpPeerKeys }));
    const response = await api.handle({
      method: 'POST',
      path: '/api/v1/pgp/peer-keys/import',
      body: { armored: nameOnlyPublicKey },
      principal,
    });

    expect(response.status).toBe(400);
    expect((response.body as any).error.code).toBe('pgp_peer_key_import_failed');
    expect((response.body as any).error.message).toMatch(/E-Mail/);
    expect(pgpPeerKeys.create).not.toHaveBeenCalled();
  });
});

function peerKeyRecord(values: Record<string, unknown> = {}): PgpPeerKeyRecord {
  return {
    id: 7,
    sourceSqliteId: null,
    email: String(values.email ?? ''),
    fingerprint: String(values.fingerprint ?? ''),
    publicKeyArmor: String(values.publicKeyArmor ?? ''),
    source: 'manual',
    verifiedAt: null,
    verifiedByUserId: null,
    legacyVerifiedByUserId: null,
    trustLevel: 'imported',
    createdAt: '2026-09-25T08:00:00.000Z',
    updatedAt: '2026-09-25T08:00:00.000Z',
  };
}

function peerKeyPort(): jest.Mocked<Pick<PgpPeerKeyApiPort, 'list' | 'get' | 'create'>> {
  return {
    list: jest.fn(async () => ({ items: [], nextCursor: null })),
    get: jest.fn(async () => null),
    create: jest.fn(async (input) => ({ ok: true as const, peerKey: peerKeyRecord(input.values) })),
  };
}

function ports(overrides: Partial<ServerApiPorts>): ServerApiPorts {
  return {
    auth: authPort(),
    locks: {} as ServerApiPorts['locks'],
    mailAccess: {
      async assertPermission() {
        return undefined;
      },
      async resolveScope() {
        return { kind: 'all' };
      },
    },
    mailResourceLookup: {
      async resolve() {
        return [];
      },
    },
    pgpKeyMaterial: keyMaterial,
    ...overrides,
  };
}

function authPort(): AuthApiPort {
  return {
    findUserByEmail: async () => null,
    verifyPassword: async () => false,
    recordFailedLogin: async () => 1,
    recordSuccessfulLogin: async () => undefined,
    issueTokenPair: async () => ({
      accessToken: 'access',
      refreshToken: 'refresh',
      expiresInSeconds: 900,
    }),
    rotateRefreshToken: async () => null,
    revokeRefreshToken: async () => false,
  };
}
