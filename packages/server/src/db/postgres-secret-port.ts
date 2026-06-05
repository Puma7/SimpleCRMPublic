import type { Kysely } from 'kysely';

import {
  decryptSecretValue,
  encryptSecretValue,
  rotateSecretEnvelope,
  SECRET_ENVELOPE_ALGORITHM,
  type EncryptedSecretEnvelope,
  type MasterKeyMaterial,
  type SecretAssociatedData,
} from '../security';
import type { SecretRow, ServerDatabase } from './schema';
import { withWorkspaceTransaction, type WorkspaceTransaction } from './workspace-context';

export type SecretIdentifier = SecretAssociatedData;

export type SecretRecord = Readonly<SecretIdentifier & {
  id: string;
  keyId: string;
  algorithm: string;
  updatedAt: string;
}>;

export type PostgresSecretPort = Readonly<{
  writeSecret(input: SecretIdentifier & { value: string | Buffer }): Promise<SecretRecord>;
  readSecret(input: SecretIdentifier): Promise<Buffer | null>;
  deleteSecret(input: SecretIdentifier): Promise<boolean>;
  rotateSecret(input: SecretIdentifier & { nextKey: MasterKeyMaterial }): Promise<SecretRecord | null>;
}>;

export type PostgresSecretPortOptions = Readonly<{
  db: Kysely<ServerDatabase>;
  key: MasterKeyMaterial;
  now?: () => Date;
}>;

export function createPostgresSecretPort(options: PostgresSecretPortOptions): PostgresSecretPort {
  const now = options.now ?? (() => new Date());

  return {
    async writeSecret(input) {
      const envelope = await encryptSecretValue({
        key: options.key,
        value: input.value,
        associatedData: input,
      });

      const row = await withWorkspaceTransaction(options.db, {
        workspaceId: input.workspaceId,
        role: 'system',
      }, (db) => db
          .insertInto('secrets')
          .values({
            workspace_id: input.workspaceId,
            kind: input.kind,
            name: input.name,
            ciphertext: envelope.ciphertext,
            nonce: envelope.nonce,
            key_id: envelope.keyId,
            algorithm: envelope.algorithm,
            updated_at: now(),
          })
          .onConflict((oc) => oc.columns(['workspace_id', 'kind', 'name']).doUpdateSet({
            ciphertext: envelope.ciphertext,
            nonce: envelope.nonce,
            key_id: envelope.keyId,
            algorithm: envelope.algorithm,
            updated_at: now(),
          }))
          .returning(['id', 'workspace_id', 'kind', 'name', 'key_id', 'algorithm', 'updated_at'])
          .executeTakeFirstOrThrow());

      return mapSecretRecord(row);
    },

    async readSecret(input) {
      const row = await withWorkspaceTransaction(options.db, {
        workspaceId: input.workspaceId,
        role: 'system',
      }, (db) => selectSecret(db, input));
      if (!row) return null;
      const plaintext = await decryptSecretValue({
        key: options.key,
        envelope: rowToEnvelope(row),
        associatedData: input,
      });
      return plaintext;
    },

    async deleteSecret(input) {
      const result = await withWorkspaceTransaction(options.db, {
        workspaceId: input.workspaceId,
        role: 'system',
      }, (db) => db
          .deleteFrom('secrets')
          .where('workspace_id', '=', input.workspaceId)
          .where('kind', '=', input.kind)
          .where('name', '=', input.name)
          .executeTakeFirst());

      return Number(result.numDeletedRows) > 0;
    },

    async rotateSecret(input) {
      return withWorkspaceTransaction(options.db, {
        workspaceId: input.workspaceId,
        role: 'system',
      }, async (db) => {
        const row = await selectSecret(db, input);
        if (!row) return null;
        const rotated = await rotateSecretEnvelope({
          currentKey: options.key,
          nextKey: input.nextKey,
          envelope: rowToEnvelope(row),
          associatedData: input,
        });

        const updated = await db
          .updateTable('secrets')
          .set({
            ciphertext: rotated.ciphertext,
            nonce: rotated.nonce,
            key_id: rotated.keyId,
            algorithm: rotated.algorithm,
            updated_at: now(),
          })
          .where('workspace_id', '=', input.workspaceId)
          .where('kind', '=', input.kind)
          .where('name', '=', input.name)
          .returning(['id', 'workspace_id', 'kind', 'name', 'key_id', 'algorithm', 'updated_at'])
          .executeTakeFirstOrThrow();

        return mapSecretRecord(updated);
      });
    },
  };
}

async function selectSecret(
  db: WorkspaceTransaction,
  input: SecretIdentifier,
): Promise<SecretRow | undefined> {
  return db
    .selectFrom('secrets')
    .selectAll()
    .where('workspace_id', '=', input.workspaceId)
    .where('kind', '=', input.kind)
    .where('name', '=', input.name)
    .executeTakeFirst();
}

function rowToEnvelope(row: SecretRow): EncryptedSecretEnvelope {
  return {
    algorithm: row.algorithm as typeof SECRET_ENVELOPE_ALGORITHM,
    keyId: row.key_id,
    nonce: Buffer.from(row.nonce),
    ciphertext: Buffer.from(row.ciphertext),
  };
}

function mapSecretRecord(row: {
  id: string;
  workspace_id: string;
  kind: string;
  name: string;
  key_id: string;
  algorithm: string;
  updated_at: Date | string;
}): SecretRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    kind: row.kind,
    name: row.name,
    keyId: row.key_id,
    algorithm: row.algorithm,
    updatedAt: toDate(row.updated_at).toISOString(),
  };
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}
