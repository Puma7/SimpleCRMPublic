import type { Kysely, Selectable } from 'kysely';
import {
  AUTH_SECURITY_SYNC_KEYS,
  DEFAULT_AUTH_SECURITY_WORKSPACE_SETTINGS,
  parseAuthSecuritySyncValues,
  type AuthSecurityWorkspaceSettings,
} from '@simplecrm/core';

import type { SyncInfoApiPort, SyncInfoRecord } from '../api/types';
import type { ServerDatabase, SyncInfoTable } from './schema';
import {
  withWorkspaceTransaction,
  type WorkspaceSessionApplier,
} from './workspace-context';

export type PostgresSyncInfoPortOptions = Readonly<{
  db: Kysely<ServerDatabase>;
  now?: () => Date;
}>;

export type PostgresPublicAuthSecuritySettingsReaderOptions = Readonly<{
  db: Kysely<ServerDatabase>;
  applyWorkspaceSession?: WorkspaceSessionApplier;
}>;

type SyncInfoRow = Selectable<SyncInfoTable>;

const syncInfoSelectColumns = [
  'key',
  'value',
  'updated_at',
] as const;

const PUBLIC_AUTH_SETTINGS_CONTEXT_ID = '00000000-0000-4000-8000-000000000001';

export function createPostgresSyncInfoPort(options: PostgresSyncInfoPortOptions): SyncInfoApiPort {
  const now = options.now ?? (() => new Date());

  return {
    async getMany(input) {
      const keys = uniqueSyncInfoKeys(input.keys);
      if (keys.length === 0) return [];
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          const rows = await trx
            .selectFrom('sync_info')
            .select(syncInfoSelectColumns)
            .where('workspace_id', '=', input.workspaceId)
            .where('key', 'in', keys)
            .execute();
          return rows.map(mapSyncInfoRow);
        },
      );
    },
    async getByPrefix(input) {
      const prefix = normalizeSyncInfoKey(input.prefix);
      if (!prefix) return [];
      const limit = normalizePrefixLimit(input.limit);
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          const rows = await trx
            .selectFrom('sync_info')
            .select(syncInfoSelectColumns)
            .where('workspace_id', '=', input.workspaceId)
            .where('key', 'like', `${escapeLikePattern(prefix)}%`)
            .orderBy('key', 'asc')
            .limit(limit)
            .execute();
          return rows.map(mapSyncInfoRow);
        },
      );
    },
    async setMany(input) {
      const entries = Object.entries(input.values)
        .map(([key, value]) => ({ key: normalizeSyncInfoKey(key), value }))
        .filter((entry) => entry.key.length > 0);
      if (entries.length === 0) return [];

      const updatedAt = now();
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          await trx
            .insertInto('sync_info')
            .values(entries.map((entry) => ({
              workspace_id: input.workspaceId,
              key: entry.key,
              value: entry.value,
              last_updated: updatedAt,
              source_row: {},
              imported_in_run_id: null,
              updated_at: updatedAt,
            })))
            .onConflict((oc) => oc.columns(['workspace_id', 'key']).doUpdateSet({
              value: (eb) => eb.ref('excluded.value'),
              last_updated: updatedAt,
              updated_at: updatedAt,
            }))
            .execute();

          const keys = uniqueSyncInfoKeys(entries.map((entry) => entry.key));
          const rows = await trx
            .selectFrom('sync_info')
            .select(syncInfoSelectColumns)
            .where('workspace_id', '=', input.workspaceId)
            .where('key', 'in', keys)
            .execute();
          return rows.map(mapSyncInfoRow);
        },
      );
    },
    async deleteMany(input) {
      const keys = uniqueSyncInfoKeys(input.keys);
      if (keys.length === 0) return 0;
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          const result = await trx
            .deleteFrom('sync_info')
            .where('workspace_id', '=', input.workspaceId)
            .where('key', 'in', keys)
            .executeTakeFirst();
          return Number(result.numDeletedRows ?? 0);
        },
      );
    },
  };
}

export function createPostgresPublicAuthSecuritySettingsReader(
  options: PostgresPublicAuthSecuritySettingsReaderOptions,
): () => Promise<readonly AuthSecurityWorkspaceSettings[]> {
  return async () => withWorkspaceTransaction(
    options.db,
    {
      workspaceId: PUBLIC_AUTH_SETTINGS_CONTEXT_ID,
      role: 'system',
      crossWorkspaceAccess: true,
    },
    async (trx) => {
      const rows = await trx
        .selectFrom('sync_info')
        .select(['workspace_id', 'key', 'value'])
        .where('key', 'in', Object.values(AUTH_SECURITY_SYNC_KEYS))
        .execute();
      if (rows.length === 0) return [DEFAULT_AUTH_SECURITY_WORKSPACE_SETTINGS];

      const valuesByWorkspace = new Map<string, Record<string, string | null>>();
      for (const row of rows) {
        const values = valuesByWorkspace.get(row.workspace_id) ?? {};
        values[row.key] = row.value;
        valuesByWorkspace.set(row.workspace_id, values);
      }
      return [...valuesByWorkspace.values()].map(parseAuthSecuritySyncValues);
    },
    { applySession: options.applyWorkspaceSession },
  );
}

function uniqueSyncInfoKeys(keys: readonly string[]): string[] {
  const result: string[] = [];
  for (const key of keys) {
    const normalized = normalizeSyncInfoKey(key);
    if (normalized && !result.includes(normalized)) result.push(normalized);
  }
  return result;
}

function normalizeSyncInfoKey(value: string): string {
  const key = value.trim();
  if (key.length > 200) throw new Error('sync_info key must not exceed 200 characters');
  return key;
}

function normalizePrefixLimit(value: number | undefined): number {
  if (!Number.isSafeInteger(value) || value === undefined || value <= 0) return 500;
  return Math.min(value, 5000);
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

function mapSyncInfoRow(row: Pick<SyncInfoRow, typeof syncInfoSelectColumns[number]>): SyncInfoRecord {
  return {
    key: row.key,
    value: row.value,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
  };
}
