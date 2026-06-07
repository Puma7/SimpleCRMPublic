import { createHash, randomBytes, randomUUID } from 'node:crypto';

import type { Kysely, Selectable } from 'kysely';

import type {
  AuthenticatedPrincipal,
  AutomationApiKeyApiPort,
  AutomationApiKeyCreateResult,
  AutomationApiKeyListResult,
  AutomationApiKeyMutationInput,
  AutomationApiKeyRecord,
  AutomationApiKeyRevokeResult,
} from '../api/types';
import type {
  AutomationApiKeysTable,
  ServerDatabase,
} from './schema';
import type { PostgresSecretPort } from './postgres-secret-port';
import {
  withWorkspaceTransaction,
  type WorkspaceSessionApplier,
} from './workspace-context';

export type PostgresAutomationReadPortOptions = Readonly<{
  db: Kysely<ServerDatabase>;
  applyWorkspaceSession?: WorkspaceSessionApplier;
  secrets?: PostgresSecretPort;
  generateId?: () => string;
  generateKey?: () => string;
  now?: () => Date;
}>;

type AutomationApiKeyRow = Selectable<AutomationApiKeysTable>;

const automationApiKeySelectColumns = [
  'id',
  'label',
  'secret_id',
  'scopes',
  'last_used_at',
  'revoked_at',
  'created_by_user_id',
  'created_at',
  'updated_at',
] as const;

const automationApiKeyVerifySelectColumns = [
  'id',
  'workspace_id',
  'scopes',
  'revoked_at',
  'created_by_user_id',
] as const;

export function createPostgresAutomationApiKeyReadPort(
  options: PostgresAutomationReadPortOptions,
): AutomationApiKeyApiPort {
  const generateId = options.generateId ?? randomUUID;
  const generateKey = options.generateKey ?? generateAutomationApiKey;
  const now = options.now ?? (() => new Date());

  return {
    async list(input): Promise<AutomationApiKeyListResult> {
      const limit = normalizeLimit(input.limit);
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          let query = trx
            .selectFrom('automation_api_keys')
            .select(automationApiKeySelectColumns)
            .where('workspace_id', '=', input.workspaceId)
            .orderBy('id', 'asc')
            .limit(limit + 1);

          if (input.cursor !== undefined) query = query.where('id', '>', input.cursor);
          if (input.revoked === true) query = query.where('revoked_at', 'is not', null);
          if (input.revoked === false) query = query.where('revoked_at', 'is', null);
          const search = input.search?.trim();
          if (search) query = query.where('label', 'ilike', `%${search}%`);

          const rows = await query.execute();
          const pageRows = rows.slice(0, limit);
          return {
            items: pageRows.map(mapAutomationApiKeyRow),
            nextCursor: rows.length > limit ? pageRows[pageRows.length - 1]?.id ?? null : null,
          };
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async get(input): Promise<AutomationApiKeyRecord | null> {
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          const row = await trx
            .selectFrom('automation_api_keys')
            .select(automationApiKeySelectColumns)
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.id)
            .executeTakeFirst();
          return row ? mapAutomationApiKeyRow(row) : null;
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async create(input): Promise<AutomationApiKeyCreateResult> {
      const secrets = options.secrets;
      if (!secrets) return { ok: false, code: 'secret_port_unavailable' };
      const values = normalizeAutomationApiKeyMutation(input.values);
      const id = generateId();
      const key = generateKey();
      const secretIdentifier = automationApiKeySecretIdentifier(input.workspaceId, id);
      const secret = await secrets.writeSecret({
        ...secretIdentifier,
        value: key,
      });

      try {
        const apiKey = await withWorkspaceTransaction(
          options.db,
          {
            workspaceId: input.workspaceId,
            userId: input.actorUserId,
            role: 'user',
          },
          async (trx) => {
            const timestamp = now();
            const row = await trx
              .insertInto('automation_api_keys')
              .values({
                id,
                workspace_id: input.workspaceId,
                label: values.label,
                key_hash: hashAutomationApiKey(key),
                secret_id: secret.id,
                // jsonb column: stringify the array so node-postgres sends valid
                // JSON instead of a Postgres array literal ({...}) -> 22P02.
                scopes: JSON.stringify(values.scopes),
                last_used_at: null,
                revoked_at: null,
                created_by_user_id: input.actorUserId,
                created_at: timestamp,
                updated_at: timestamp,
              })
              .returning(automationApiKeySelectColumns)
              .executeTakeFirstOrThrow();
            return mapAutomationApiKeyRow(row);
          },
          { applySession: options.applyWorkspaceSession },
        );

        return { ok: true, apiKey, key };
      } catch (error) {
        await secrets.deleteSecret(secretIdentifier).catch(() => false);
        throw error;
      }
    },
    async revoke(input): Promise<AutomationApiKeyRevokeResult | null> {
      const current = await withWorkspaceTransaction(
        options.db,
        {
          workspaceId: input.workspaceId,
          userId: input.actorUserId,
          role: 'user',
        },
        async (trx) => trx
            .selectFrom('automation_api_keys')
            .select(automationApiKeySelectColumns)
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.id)
            .executeTakeFirst(),
        { applySession: options.applyWorkspaceSession },
      );
      if (!current) return null;
      if (current.secret_id !== null && !options.secrets) {
        return { ok: false, code: 'secret_port_unavailable' };
      }

      const apiKey = await withWorkspaceTransaction(
        options.db,
        {
          workspaceId: input.workspaceId,
          userId: input.actorUserId,
          role: 'user',
        },
        async (trx) => {
          const timestamp = now();
          const row = await trx
            .updateTable('automation_api_keys')
            .set({
              secret_id: null,
              revoked_at: current.revoked_at ?? timestamp,
              updated_at: timestamp,
            })
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.id)
            .returning(automationApiKeySelectColumns)
            .executeTakeFirstOrThrow();
          return mapAutomationApiKeyRow(row);
        },
        { applySession: options.applyWorkspaceSession },
      );

      if (current.secret_id !== null) {
        await options.secrets?.deleteSecret(automationApiKeySecretIdentifier(input.workspaceId, input.id));
      }

      return { ok: true, apiKey };
    },
    async verify(input): Promise<AuthenticatedPrincipal | null> {
      const key = input.key.trim();
      if (!key) return null;
      const row = await withWorkspaceTransaction(
        options.db,
        { workspaceId: randomUUID(), role: 'system', crossWorkspaceAccess: true },
        async (trx) => trx
          .selectFrom('automation_api_keys')
          .select(automationApiKeyVerifySelectColumns)
          .where('key_hash', '=', hashAutomationApiKey(key))
          .where('revoked_at', 'is', null)
          .executeTakeFirst(),
        { applySession: options.applyWorkspaceSession },
      );
      if (!row) return null;

      const scopes = normalizeStoredScopes(row.scopes);
      if (input.requiredScope && !automationScopesAllow(scopes, input.requiredScope)) return null;

      const timestamp = now();
      await withWorkspaceTransaction(
        options.db,
        {
          workspaceId: row.workspace_id,
          userId: row.created_by_user_id ?? row.id,
          role: 'system',
        },
        async (trx) => {
          await trx
            .updateTable('automation_api_keys')
            .set({
              last_used_at: timestamp,
              updated_at: timestamp,
            })
            .where('workspace_id', '=', row.workspace_id)
            .where('id', '=', row.id)
            .where('revoked_at', 'is', null)
            .execute();
        },
        { applySession: options.applyWorkspaceSession },
      );

      return {
        userId: row.created_by_user_id ?? row.id,
        workspaceId: row.workspace_id,
        role: 'user',
        automationApiKeyId: row.id,
        automationScopes: scopes,
      };
    },
  };
}

function generateAutomationApiKey(): string {
  return `scrm_${randomBytes(32).toString('base64url')}`;
}

function hashAutomationApiKey(key: string): string {
  return `sha256:${createHash('sha256').update(key, 'utf8').digest('hex')}`;
}

function automationApiKeySecretIdentifier(workspaceId: string, id: string): {
  workspaceId: string;
  kind: string;
  name: string;
} {
  return {
    workspaceId,
    kind: 'automation.api_key',
    name: `automation_api_key:${id}:key`,
  };
}

function normalizeAutomationApiKeyMutation(input: AutomationApiKeyMutationInput): Required<AutomationApiKeyMutationInput> {
  const label = normalizeLabel(input.label);
  const scopes = normalizeScopes(input.scopes);
  return { label, scopes };
}

function normalizeLabel(value: string | undefined): string {
  const normalized = value?.trim();
  if (!normalized || normalized.length > 200) {
    throw new Error('Automation API key label must be a non-empty string with at most 200 characters');
  }
  return normalized;
}

function normalizeScopes(value: readonly string[] | undefined): readonly string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new Error('Automation API key scopes must be an array');
  }
  const scopes = value.map((scope) => {
    if (typeof scope !== 'string') {
      throw new Error('Automation API key scopes must be strings');
    }
    return scope.trim();
  });
  if (scopes.some((scope) => !scope)) {
    throw new Error('Automation API key scopes must be non-empty strings');
  }
  return scopes;
}

function normalizeStoredScopes(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((scope): scope is string => typeof scope === 'string' && scope.trim() !== '')
    .map((scope) => scope.trim());
}

function automationScopesAllow(scopes: readonly string[], requiredScope: string): boolean {
  return scopes.includes(requiredScope) || scopes.includes('write') || scopes.includes('*');
}

function normalizeLimit(limit: number): number {
  if (!Number.isInteger(limit) || limit <= 0 || limit > 100) {
    throw new Error('Automation API key list limit must be between 1 and 100');
  }
  return limit;
}

function mapAutomationApiKeyRow(
  row: Pick<AutomationApiKeyRow, typeof automationApiKeySelectColumns[number]>,
): AutomationApiKeyRecord {
  return {
    id: row.id,
    label: row.label,
    scopes: row.scopes,
    lastUsedAt: timestampToIsoOrNull(row.last_used_at),
    revokedAt: timestampToIsoOrNull(row.revoked_at),
    createdByUserId: row.created_by_user_id,
    secretConfigured: row.secret_id !== null,
    createdAt: timestampToIso(row.created_at),
    updatedAt: timestampToIso(row.updated_at),
  };
}

function timestampToIsoOrNull(value: Date | string | null): string | null {
  return value === null ? null : timestampToIso(value);
}

function timestampToIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}
