import { sql as kyselySql, type Kysely, type RawBuilder, type Selectable, type Updateable } from 'kysely';

import type {
  PgpIdentityApiPort,
  PgpIdentityListResult,
  PgpIdentityMutationInput,
  PgpIdentityMutationPortResult,
  PgpIdentityRecord,
  PgpPeerKeyApiPort,
  PgpPeerKeyListResult,
  PgpPeerKeyMutationInput,
  PgpPeerKeyMutationPortResult,
  PgpPeerKeyRecord,
} from '../api/types';
import type {
  PgpIdentitiesTable,
  PgpPeerKeysTable,
  ServerDatabase,
} from './schema';
import {
  encryptPgpPrivateKeyWithPassphrase,
  rotatePgpPrivateKeyPassphrase,
} from '../security';
import {
  deserializePgpPrivateKeyEnvelope,
  pgpIdentityPrivateKeySecretIdentifier,
  serializePgpPrivateKeyEnvelope,
} from '../pgp/private-key-envelope';
import type { PostgresSecretPort } from './postgres-secret-port';
import {
  withWorkspaceTransaction,
  type WorkspaceSessionApplier,
  type WorkspaceTransaction,
} from './workspace-context';

export type PostgresPgpReadPortOptions = Readonly<{
  db: Kysely<ServerDatabase>;
  applyWorkspaceSession?: WorkspaceSessionApplier;
  secrets?: PostgresSecretPort;
}>;

type PgpIdentityRow = Selectable<PgpIdentitiesTable>;
type PgpPeerKeyRow = Selectable<PgpPeerKeysTable>;

const pgpIdentitySelectColumns = [
  'id',
  'source_sqlite_id',
  'user_id',
  'legacy_user_id',
  'email',
  'fingerprint',
  'public_key_armor',
  'has_private_key',
  'legacy_keytar_private_key_handle',
  'private_key_secret_id',
  'expires_at',
  'is_primary',
  'created_at',
  'updated_at',
] as const;

const pgpPeerKeySelectColumns = [
  'id',
  'source_sqlite_id',
  'email',
  'fingerprint',
  'public_key_armor',
  'source',
  'verified_at',
  'verified_by_user_id',
  'legacy_verified_by_user_id',
  'trust_level',
  'created_at',
  'updated_at',
] as const;

export function createPostgresPgpIdentityReadPort(options: PostgresPgpReadPortOptions): PgpIdentityApiPort {
  return {
    async list(input): Promise<PgpIdentityListResult> {
      const limit = normalizeLimit(input.limit, 'PGP identity');
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          let query = trx
            .selectFrom('pgp_identities')
            .select(pgpIdentitySelectColumns)
            .where('workspace_id', '=', input.workspaceId)
            .orderBy('id', 'asc')
            .limit(limit + 1);

          if (input.cursor !== undefined) query = query.where('id', '>', input.cursor);
          if (input.email !== undefined) query = query.where('email', '=', input.email);
          const search = input.search?.trim();
          if (search) {
            const pattern = `%${search}%`;
            query = query.where((eb) => eb.or([
              eb('email', 'ilike', pattern),
              eb('fingerprint', 'ilike', pattern),
            ]));
          }

          const rows = await query.execute();
          const pageRows = rows.slice(0, limit);
          return {
            items: pageRows.map(mapPgpIdentityRow),
            nextCursor: rows.length > limit ? pageRows[pageRows.length - 1]?.id ?? null : null,
          };
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async get(input): Promise<PgpIdentityRecord | null> {
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          const row = await trx
            .selectFrom('pgp_identities')
            .select(pgpIdentitySelectColumns)
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.id)
            .executeTakeFirst();
          return row ? mapPgpIdentityRow(row) : null;
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async create(input): Promise<PgpIdentityMutationPortResult> {
      const values = normalizePgpIdentityMutation(input.values, {
        requireAtLeastOneField: true,
        requireEmail: true,
        requireFingerprint: true,
        requirePublicKeyArmor: true,
      });
      if (typeof values.privateKeyArmored === 'string' && !options.secrets) {
        return { ok: false, code: 'private_key_secret_unavailable' };
      }

      let identity = await withWorkspaceTransaction(
        options.db,
        {
          workspaceId: input.workspaceId,
          userId: input.actorUserId,
          role: 'user',
        },
        async (trx) => {
          const conflict = await resolvePgpIdentityFingerprintConflict(
            trx,
            input.workspaceId,
            values.fingerprint as string,
          );
          if (conflict) return { ok: false, code: 'fingerprint_conflict' } as const;

          const now = new Date();
          const row = await trx
            .insertInto('pgp_identities')
            .values({
              workspace_id: input.workspaceId,
              source_sqlite_id: serverCreatedPgpIdentitySourceSqliteId(),
              user_id: input.actorUserId,
              legacy_user_id: null,
              email: values.email as string,
              fingerprint: values.fingerprint as string,
              public_key_armor: values.publicKeyArmor as string,
              has_private_key: false,
              legacy_keytar_private_key_handle: null,
              private_key_secret_id: null,
              expires_at: values.expiresAt ?? null,
              is_primary: values.isPrimary ?? false,
              source_row: serverApiSourceRow(),
              created_at: now,
              updated_at: now,
            })
            .returning(pgpIdentitySelectColumns)
            .executeTakeFirstOrThrow();

          if (values.isPrimary === true) {
            await clearOtherPrimaryPgpIdentities(trx, input.workspaceId, input.actorUserId, Number(row.id), now);
          }

          return { ok: true, identity: mapPgpIdentityRow(row) } as const;
        },
        { applySession: options.applyWorkspaceSession },
      );
      if (!identity.ok) return identity;

      if (typeof values.privateKeyArmored === 'string') {
        try {
          identity = {
            ok: true,
            identity: await writePgpIdentityPrivateKey(
              options,
              input.workspaceId,
              input.actorUserId,
              identity.identity,
              values.privateKeyArmored,
              values.privateKeyPassphrase as string,
            ),
          };
        } catch (error) {
          await deletePgpIdentityRow(options, input.workspaceId, input.actorUserId, identity.identity.id).catch(() => null);
          throw error;
        }
      }

      return identity;
    },
    async update(input): Promise<PgpIdentityMutationPortResult | null> {
      const values = normalizePgpIdentityMutation(input.values, {
        requireAtLeastOneField: true,
        requireEmail: false,
        requireFingerprint: false,
        requirePublicKeyArmor: false,
      });

      const result = await withWorkspaceTransaction(
        options.db,
        {
          workspaceId: input.workspaceId,
          userId: input.actorUserId,
          role: 'user',
        },
        async (trx) => {
          const current = await trx
            .selectFrom('pgp_identities')
            .select(pgpIdentitySelectColumns)
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.id)
            .executeTakeFirst();
          if (!current) return null;

          if (values.fingerprint !== undefined && values.fingerprint !== current.fingerprint) {
            const conflict = await resolvePgpIdentityFingerprintConflict(
              trx,
              input.workspaceId,
              values.fingerprint,
              input.id,
            );
            if (conflict) return { ok: false, code: 'fingerprint_conflict' } as const;
            const hasPrivateKey = current.has_private_key
              || current.private_key_secret_id !== null
              || current.legacy_keytar_private_key_handle !== null;
            if (hasPrivateKey && values.privateKeyArmored === undefined) {
              return { ok: false, code: 'private_key_rewrite_required' } as const;
            }
          }

          if (typeof values.privateKeyArmored === 'string' && !options.secrets) {
            return { ok: false, code: 'private_key_secret_unavailable' } as const;
          }
          if (values.privateKeyArmored === null && current.private_key_secret_id !== null && !options.secrets) {
            return { ok: false, code: 'private_key_secret_unavailable' } as const;
          }

          const now = new Date();
          const row = await trx
            .updateTable('pgp_identities')
            .set({
              ...mutationToPgpIdentityPatch(values),
              updated_at: now,
            })
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.id)
            .returning(pgpIdentitySelectColumns)
            .executeTakeFirstOrThrow();

          if (values.isPrimary === true) {
            await clearOtherPrimaryPgpIdentities(trx, input.workspaceId, input.actorUserId, input.id, now);
          }

          return {
            ok: true,
            identity: mapPgpIdentityRow(row),
            previousSecretId: current.private_key_secret_id,
          } as const;
        },
        { applySession: options.applyWorkspaceSession },
      );
      if (!result || !result.ok) return result;

      let identity = result.identity;
      if (typeof values.privateKeyArmored === 'string') {
        identity = await writePgpIdentityPrivateKey(
          options,
          input.workspaceId,
          input.actorUserId,
          identity,
          values.privateKeyArmored,
          values.privateKeyPassphrase as string,
        );
      } else if (values.privateKeyArmored === null && result.previousSecretId !== null) {
        await options.secrets?.deleteSecret(pgpIdentityPrivateKeySecretIdentifier(input.workspaceId, input.id));
      }

      return { ok: true, identity };
    },
    async delete(input): Promise<PgpIdentityMutationPortResult | null> {
      const current = await withWorkspaceTransaction(
        options.db,
        {
          workspaceId: input.workspaceId,
          userId: input.actorUserId,
          role: 'user',
        },
        async (trx) => trx
            .selectFrom('pgp_identities')
            .select(pgpIdentitySelectColumns)
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.id)
            .executeTakeFirst(),
        { applySession: options.applyWorkspaceSession },
      );
      if (!current) return null;
      if (current.private_key_secret_id !== null && !options.secrets) {
        return { ok: false, code: 'private_key_secret_unavailable' };
      }

      const identity = await deletePgpIdentityRow(options, input.workspaceId, input.actorUserId, input.id);
      if (!identity) return null;
      if (current.private_key_secret_id !== null) {
        await options.secrets?.deleteSecret(pgpIdentityPrivateKeySecretIdentifier(input.workspaceId, input.id));
      }
      return { ok: true, identity };
    },
    async rotatePrivateKeyPassphrase(input) {
      if (!options.secrets) return { ok: false, code: 'private_key_secret_unavailable' };

      const current = await withWorkspaceTransaction(
        options.db,
        {
          workspaceId: input.workspaceId,
          userId: input.actorUserId,
          role: 'user',
        },
        async (trx) => trx
          .selectFrom('pgp_identities')
          .select(pgpIdentitySelectColumns)
          .where('workspace_id', '=', input.workspaceId)
          .where('id', '=', input.id)
          .where('user_id', '=', input.actorUserId)
          .executeTakeFirst(),
        { applySession: options.applyWorkspaceSession },
      );
      if (!current) return null;
      if (!current.has_private_key || !current.private_key_secret_id) {
        return { ok: false, code: 'private_key_unavailable' };
      }

      const secretIdentifier = pgpIdentityPrivateKeySecretIdentifier(input.workspaceId, input.id);
      let serializedEnvelope: Buffer | null;
      try {
        serializedEnvelope = await options.secrets.readSecret(secretIdentifier);
      } catch {
        return { ok: false, code: 'private_key_secret_unavailable' };
      }
      if (!serializedEnvelope) return { ok: false, code: 'private_key_secret_unavailable' };

      let rotatedEnvelope: string;
      try {
        rotatedEnvelope = serializePgpPrivateKeyEnvelope(await rotatePgpPrivateKeyPassphrase({
          envelope: deserializePgpPrivateKeyEnvelope(serializedEnvelope),
          currentPassphrase: input.currentPassphrase,
          nextPassphrase: input.nextPassphrase,
          associatedData: {
            workspaceId: input.workspaceId,
            userId: input.actorUserId,
            identityId: String(input.id),
            fingerprint: current.fingerprint,
          },
        }));
      } catch {
        return { ok: false, code: 'decrypt_failed' };
      } finally {
        serializedEnvelope.fill(0);
      }

      let secretId: string;
      try {
        const secret = await options.secrets.writeSecret({
          ...secretIdentifier,
          value: rotatedEnvelope,
        });
        secretId = secret.id;
      } catch {
        return { ok: false, code: 'private_key_secret_unavailable' };
      }

      const identity = await withWorkspaceTransaction(
        options.db,
        {
          workspaceId: input.workspaceId,
          userId: input.actorUserId,
          role: 'user',
        },
        async (trx) => {
          const row = await trx
            .updateTable('pgp_identities')
            .set({
              private_key_secret_id: secretId,
              updated_at: new Date(),
            })
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.id)
            .where('user_id', '=', input.actorUserId)
            .returning(pgpIdentitySelectColumns)
            .executeTakeFirst();
          return row ? mapPgpIdentityRow(row) : null;
        },
        { applySession: options.applyWorkspaceSession },
      );
      return identity ? { ok: true, identity } : null;
    },
  };
}

export function createPostgresPgpPeerKeyReadPort(options: PostgresPgpReadPortOptions): PgpPeerKeyApiPort {
  return {
    async list(input): Promise<PgpPeerKeyListResult> {
      const limit = normalizeLimit(input.limit, 'PGP peer key');
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          let query = trx
            .selectFrom('pgp_peer_keys')
            .select(pgpPeerKeySelectColumns)
            .where('workspace_id', '=', input.workspaceId)
            .orderBy('id', 'asc')
            .limit(limit + 1);

          if (input.cursor !== undefined) query = query.where('id', '>', input.cursor);
          if (input.email !== undefined) query = query.where('email', '=', input.email);
          if (input.trustLevel !== undefined) query = query.where('trust_level', '=', input.trustLevel);
          const search = input.search?.trim();
          if (search) {
            const pattern = `%${search}%`;
            query = query.where((eb) => eb.or([
              eb('email', 'ilike', pattern),
              eb('fingerprint', 'ilike', pattern),
            ]));
          }

          const rows = await query.execute();
          const pageRows = rows.slice(0, limit);
          return {
            items: pageRows.map(mapPgpPeerKeyRow),
            nextCursor: rows.length > limit ? pageRows[pageRows.length - 1]?.id ?? null : null,
          };
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async get(input): Promise<PgpPeerKeyRecord | null> {
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          const row = await trx
            .selectFrom('pgp_peer_keys')
            .select(pgpPeerKeySelectColumns)
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.id)
            .executeTakeFirst();
          return row ? mapPgpPeerKeyRow(row) : null;
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async create(input): Promise<PgpPeerKeyMutationPortResult> {
      const values = normalizePgpPeerKeyMutation(input.values, {
        requireAtLeastOneField: true,
        requireEmail: true,
        requireFingerprint: true,
        requirePublicKeyArmor: true,
      });
      return withWorkspaceTransaction(
        options.db,
        {
          workspaceId: input.workspaceId,
          userId: input.actorUserId,
          role: 'user',
        },
        async (trx) => {
          const conflict = await resolvePgpPeerKeyFingerprintConflict(
            trx,
            input.workspaceId,
            values.fingerprint as string,
          );
          if (conflict) return { ok: false, code: 'fingerprint_conflict' };

          const now = new Date();
          const row = await trx
            .insertInto('pgp_peer_keys')
            .values({
              workspace_id: input.workspaceId,
              source_sqlite_id: serverCreatedPgpPeerKeySourceSqliteId(),
              email: values.email as string,
              fingerprint: values.fingerprint as string,
              public_key_armor: values.publicKeyArmor as string,
              source: values.source ?? 'server_api',
              verified_at: values.verifiedAt ?? null,
              verified_by_user_id: values.verifiedAt ? input.actorUserId : null,
              legacy_verified_by_user_id: null,
              trust_level: values.trustLevel ?? 'unknown',
              source_row: serverApiSourceRow(),
              created_at: now,
              updated_at: now,
            })
            .returning(pgpPeerKeySelectColumns)
            .executeTakeFirstOrThrow();
          return { ok: true, peerKey: mapPgpPeerKeyRow(row) };
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async update(input): Promise<PgpPeerKeyMutationPortResult | null> {
      const values = normalizePgpPeerKeyMutation(input.values, {
        requireAtLeastOneField: true,
        requireEmail: false,
        requireFingerprint: false,
        requirePublicKeyArmor: false,
      });
      return withWorkspaceTransaction(
        options.db,
        {
          workspaceId: input.workspaceId,
          userId: input.actorUserId,
          role: 'user',
        },
        async (trx) => {
          const current = await trx
            .selectFrom('pgp_peer_keys')
            .select(['id', 'fingerprint'])
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.id)
            .executeTakeFirst();
          if (!current) return null;
          if (values.fingerprint !== undefined && values.fingerprint !== current.fingerprint) {
            const conflict = await resolvePgpPeerKeyFingerprintConflict(
              trx,
              input.workspaceId,
              values.fingerprint,
              input.id,
            );
            if (conflict) return { ok: false, code: 'fingerprint_conflict' };
          }

          const row = await trx
            .updateTable('pgp_peer_keys')
            .set({
              ...mutationToPgpPeerKeyPatch(values, input.actorUserId),
              updated_at: new Date(),
            })
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.id)
            .returning(pgpPeerKeySelectColumns)
            .executeTakeFirstOrThrow();
          return { ok: true, peerKey: mapPgpPeerKeyRow(row) };
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async delete(input): Promise<PgpPeerKeyRecord | null> {
      return withWorkspaceTransaction(
        options.db,
        {
          workspaceId: input.workspaceId,
          userId: input.actorUserId,
          role: 'user',
        },
        async (trx) => {
          const row = await trx
            .deleteFrom('pgp_peer_keys')
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.id)
            .returning(pgpPeerKeySelectColumns)
            .executeTakeFirst();
          return row ? mapPgpPeerKeyRow(row) : null;
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
  };
}

function normalizeLimit(limit: number, label: string): number {
  if (!Number.isInteger(limit) || limit <= 0 || limit > 100) {
    throw new Error(`${label} list limit must be between 1 and 100`);
  }
  return limit;
}

function normalizePgpIdentityMutation(
  values: PgpIdentityMutationInput,
  options: {
    requireAtLeastOneField: boolean;
    requireEmail: boolean;
    requireFingerprint: boolean;
    requirePublicKeyArmor: boolean;
  },
): PgpIdentityMutationInput {
  const normalized = { ...values };
  if (options.requireAtLeastOneField && Object.keys(normalized).length === 0) {
    throw new Error('PGP identity mutation must include at least one field');
  }
  if (options.requireEmail && normalized.email === undefined) throw new Error('PGP identity email is required');
  if (options.requireFingerprint && normalized.fingerprint === undefined) throw new Error('PGP identity fingerprint is required');
  if (options.requirePublicKeyArmor && normalized.publicKeyArmor === undefined) {
    throw new Error('PGP identity publicKeyArmor is required');
  }
  for (const key of ['email', 'fingerprint', 'publicKeyArmor', 'privateKeyArmored'] as const) {
    if (typeof normalized[key] === 'string') {
      const value = normalized[key].trim();
      if (!value) throw new Error(`PGP identity ${key} must not be empty`);
      normalized[key] = value;
    }
  }
  if (typeof normalized.privateKeyPassphrase === 'string' && !normalized.privateKeyPassphrase.trim()) {
    throw new Error('PGP identity privateKeyPassphrase must not be empty');
  }
  if (typeof normalized.privateKeyArmored === 'string' && normalized.privateKeyPassphrase === undefined) {
    throw new Error('PGP identity privateKeyPassphrase is required for privateKeyArmored');
  }
  if (normalized.privateKeyArmored !== undefined && typeof normalized.privateKeyArmored !== 'string' && normalized.privateKeyPassphrase !== undefined) {
    throw new Error('PGP identity privateKeyPassphrase is only allowed with privateKeyArmored');
  }
  if (normalized.privateKeyArmored === undefined && normalized.privateKeyPassphrase !== undefined) {
    throw new Error('PGP identity privateKeyPassphrase is only allowed with privateKeyArmored');
  }
  if (normalized.expiresAt !== undefined && normalized.expiresAt !== null) {
    const date = new Date(normalized.expiresAt);
    if (Number.isNaN(date.getTime())) throw new Error('PGP identity expiresAt must be a valid date');
    normalized.expiresAt = date.toISOString();
  }
  if (normalized.isPrimary !== undefined && typeof normalized.isPrimary !== 'boolean') {
    throw new Error('PGP identity isPrimary must be a boolean');
  }
  return normalized;
}

function normalizePgpPeerKeyMutation(
  values: PgpPeerKeyMutationInput,
  options: {
    requireAtLeastOneField: boolean;
    requireEmail: boolean;
    requireFingerprint: boolean;
    requirePublicKeyArmor: boolean;
  },
): PgpPeerKeyMutationInput {
  const normalized = { ...values };
  if (options.requireAtLeastOneField && Object.keys(normalized).length === 0) {
    throw new Error('PGP peer key mutation must include at least one field');
  }
  if (options.requireEmail && normalized.email === undefined) throw new Error('PGP peer key email is required');
  if (options.requireFingerprint && normalized.fingerprint === undefined) throw new Error('PGP peer key fingerprint is required');
  if (options.requirePublicKeyArmor && normalized.publicKeyArmor === undefined) {
    throw new Error('PGP peer key publicKeyArmor is required');
  }
  for (const key of ['email', 'fingerprint', 'publicKeyArmor', 'source', 'trustLevel'] as const) {
    if (normalized[key] !== undefined) {
      const value = normalized[key]?.trim();
      if (!value) throw new Error(`PGP peer key ${key} must not be empty`);
      normalized[key] = value;
    }
  }
  if (normalized.verifiedAt !== undefined && normalized.verifiedAt !== null) {
    const date = new Date(normalized.verifiedAt);
    if (Number.isNaN(date.getTime())) throw new Error('PGP peer key verifiedAt must be a valid date');
    normalized.verifiedAt = date.toISOString();
  }
  return normalized;
}

function mutationToPgpPeerKeyPatch(
  values: PgpPeerKeyMutationInput,
  actorUserId: string,
): Partial<Updateable<PgpPeerKeysTable>> {
  return {
    ...(values.email === undefined ? {} : { email: values.email }),
    ...(values.fingerprint === undefined ? {} : { fingerprint: values.fingerprint }),
    ...(values.publicKeyArmor === undefined ? {} : { public_key_armor: values.publicKeyArmor }),
    ...(values.source === undefined ? {} : { source: values.source }),
    ...(values.trustLevel === undefined ? {} : { trust_level: values.trustLevel }),
    ...(values.verifiedAt === undefined ? {} : {
      verified_at: values.verifiedAt,
      verified_by_user_id: values.verifiedAt === null ? null : actorUserId,
    }),
  };
}

function mutationToPgpIdentityPatch(
  values: PgpIdentityMutationInput,
): Partial<Updateable<PgpIdentitiesTable>> {
  return {
    ...(values.email === undefined ? {} : { email: values.email }),
    ...(values.fingerprint === undefined ? {} : { fingerprint: values.fingerprint }),
    ...(values.publicKeyArmor === undefined ? {} : { public_key_armor: values.publicKeyArmor }),
    ...(values.expiresAt === undefined ? {} : { expires_at: values.expiresAt }),
    ...(values.isPrimary === undefined ? {} : { is_primary: values.isPrimary }),
    ...(values.privateKeyArmored === undefined ? {} : {
      has_private_key: false,
      legacy_keytar_private_key_handle: null,
      private_key_secret_id: null,
    }),
  };
}

async function resolvePgpIdentityFingerprintConflict(
  trx: WorkspaceTransaction,
  workspaceId: string,
  fingerprint: string,
  excludingId?: number,
): Promise<boolean> {
  let query = trx
    .selectFrom('pgp_identities')
    .select('id')
    .where('workspace_id', '=', workspaceId)
    .where('fingerprint', '=', fingerprint);
  if (excludingId !== undefined) query = query.where('id', '<>', excludingId);
  return (await query.executeTakeFirst()) !== undefined;
}

async function resolvePgpPeerKeyFingerprintConflict(
  trx: WorkspaceTransaction,
  workspaceId: string,
  fingerprint: string,
  excludingId?: number,
): Promise<boolean> {
  let query = trx
    .selectFrom('pgp_peer_keys')
    .select('id')
    .where('workspace_id', '=', workspaceId)
    .where('fingerprint', '=', fingerprint);
  if (excludingId !== undefined) query = query.where('id', '<>', excludingId);
  return (await query.executeTakeFirst()) !== undefined;
}

async function clearOtherPrimaryPgpIdentities(
  trx: WorkspaceTransaction,
  workspaceId: string,
  actorUserId: string,
  identityId: number,
  now: Date,
): Promise<void> {
  await trx
    .updateTable('pgp_identities')
    .set({
      is_primary: false,
      updated_at: now,
    })
    .where('workspace_id', '=', workspaceId)
    .where('user_id', '=', actorUserId)
    .where('id', '<>', identityId)
    .execute();
}

async function writePgpIdentityPrivateKey(
  options: PostgresPgpReadPortOptions,
  workspaceId: string,
  actorUserId: string,
  identity: PgpIdentityRecord,
  privateKeyArmored: string,
  privateKeyPassphrase: string,
): Promise<PgpIdentityRecord> {
  const secrets = options.secrets;
  if (!secrets) throw new Error('PGP private key secret storage is not configured');
  const secretIdentifier = pgpIdentityPrivateKeySecretIdentifier(workspaceId, identity.id);
  const envelope = await encryptPgpPrivateKeyWithPassphrase({
    privateKeyArmored,
    passphrase: privateKeyPassphrase,
    associatedData: {
      workspaceId,
      userId: actorUserId,
      identityId: String(identity.id),
      fingerprint: identity.fingerprint,
    },
  });
  const secret = await secrets.writeSecret({
    ...secretIdentifier,
    value: serializePgpPrivateKeyEnvelope(envelope),
  });

  try {
    return await withWorkspaceTransaction(
      options.db,
      {
        workspaceId,
        userId: actorUserId,
        role: 'user',
      },
      async (trx) => {
        const row = await trx
          .updateTable('pgp_identities')
          .set({
            has_private_key: true,
            legacy_keytar_private_key_handle: null,
            private_key_secret_id: secret.id,
            updated_at: new Date(),
          })
          .where('workspace_id', '=', workspaceId)
          .where('id', '=', identity.id)
          .returning(pgpIdentitySelectColumns)
          .executeTakeFirstOrThrow();
        return mapPgpIdentityRow(row);
      },
      { applySession: options.applyWorkspaceSession },
    );
  } catch (error) {
    await secrets.deleteSecret(secretIdentifier).catch(() => false);
    throw error;
  }
}

async function deletePgpIdentityRow(
  options: PostgresPgpReadPortOptions,
  workspaceId: string,
  actorUserId: string,
  id: number,
): Promise<PgpIdentityRecord | null> {
  return withWorkspaceTransaction(
    options.db,
    {
      workspaceId,
      userId: actorUserId,
      role: 'user',
    },
    async (trx) => {
      const row = await trx
        .deleteFrom('pgp_identities')
        .where('workspace_id', '=', workspaceId)
        .where('id', '=', id)
        .returning(pgpIdentitySelectColumns)
        .executeTakeFirst();
      return row ? mapPgpIdentityRow(row) : null;
    },
    { applySession: options.applyWorkspaceSession },
  );
}

function serverCreatedPgpIdentitySourceSqliteId(): RawBuilder<number> {
  return kyselySql<number>`-nextval(pg_get_serial_sequence('pgp_identities', 'id'))`;
}

function serverCreatedPgpPeerKeySourceSqliteId(): RawBuilder<number> {
  return kyselySql<number>`-nextval(pg_get_serial_sequence('pgp_peer_keys', 'id'))`;
}

function serverApiSourceRow(): RawBuilder<unknown> {
  return kyselySql`jsonb_build_object('origin', 'server_api')`;
}

function mapPgpIdentityRow(
  row: Pick<PgpIdentityRow, typeof pgpIdentitySelectColumns[number]>,
): PgpIdentityRecord {
  return {
    id: Number(row.id),
    sourceSqliteId: row.source_sqlite_id === null ? null : Number(row.source_sqlite_id),
    userId: row.user_id,
    legacyUserId: row.legacy_user_id,
    email: row.email,
    fingerprint: row.fingerprint,
    publicKeyArmor: row.public_key_armor,
    hasPrivateKey: row.has_private_key,
    privateKeyConfigured: Boolean(row.private_key_secret_id ?? row.legacy_keytar_private_key_handle),
    expiresAt: timestampToIsoOrNull(row.expires_at),
    isPrimary: row.is_primary,
    createdAt: timestampToIsoOrNull(row.created_at),
    updatedAt: timestampToIso(row.updated_at),
  };
}

function mapPgpPeerKeyRow(row: Pick<PgpPeerKeyRow, typeof pgpPeerKeySelectColumns[number]>): PgpPeerKeyRecord {
  return {
    id: Number(row.id),
    sourceSqliteId: row.source_sqlite_id === null ? null : Number(row.source_sqlite_id),
    email: row.email,
    fingerprint: row.fingerprint,
    publicKeyArmor: row.public_key_armor,
    source: row.source,
    verifiedAt: timestampToIsoOrNull(row.verified_at),
    verifiedByUserId: row.verified_by_user_id,
    legacyVerifiedByUserId: row.legacy_verified_by_user_id,
    trustLevel: row.trust_level,
    createdAt: timestampToIsoOrNull(row.created_at),
    updatedAt: timestampToIso(row.updated_at),
  };
}

function timestampToIsoOrNull(value: Date | string | null): string | null {
  return value === null ? null : timestampToIso(value);
}

function timestampToIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}
