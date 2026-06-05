import type { Kysely } from 'kysely';

import { CONVERSATION_LOCK_TIMEOUT_SECONDS } from '../locks';
import {
  verifyAuditHashChain,
  withWorkspaceTransaction,
  type AuditHashChainRow,
  type ServerDatabase,
  type WorkspaceSessionApplier,
} from '../db';
import type { JobPayload } from './types';
import type { JobHandlerRegistry } from './worker';

export const DEFAULT_LOCK_CLEANUP_LIMIT = 500;
export const MAX_LOCK_CLEANUP_LIMIT = 5000;
export const DEFAULT_AUDIT_RETENTION_DAYS = 365;
export const DEFAULT_AUDIT_RETENTION_LIMIT = 1000;
export const MAX_AUDIT_RETENTION_LIMIT = 10000;

export type MaintenanceJobHandlersOptions = Readonly<{
  db: Kysely<ServerDatabase>;
  now?: () => Date;
  auditArchive?: AuditRetentionArchivePort;
  applyWorkspaceSession?: WorkspaceSessionApplier;
}>;

export type MaintenanceCleanupPlan = Readonly<{
  workspaceId: string;
  staleBefore: Date;
  limit: number;
}>;

export type AuditRetentionPlan = Readonly<{
  workspaceId: string;
  olderThan: Date;
  limit: number;
}>;

export type AuditRetentionArchivePort = Readonly<{
  archive(input: {
    workspaceId: string;
    olderThan: Date;
    rows: readonly AuditHashChainRow[];
  }): Promise<void>;
}>;

const AUDIT_RETENTION_SELECT_COLUMNS = [
  'id',
  'workspace_id',
  'actor_user_id',
  'action',
  'entity_type',
  'entity_id',
  'metadata',
  'previous_hash',
  'event_hash',
  'created_at',
] as const;

export function createMaintenanceJobHandlers(options: MaintenanceJobHandlersOptions): JobHandlerRegistry {
  const now = options.now ?? (() => new Date());

  return {
    'lock.cleanup': async (job) => {
      const plan = buildLockCleanupPlan(job.payload, now());
      await withWorkspaceTransaction(options.db, {
        workspaceId: plan.workspaceId,
        role: 'system',
      }, async (db) => {
        const rows = await db
          .selectFrom('conversation_locks')
          .select('message_id')
          .where('workspace_id', '=', plan.workspaceId)
          .where('last_heartbeat_at', '<', plan.staleBefore)
          .orderBy('last_heartbeat_at', 'asc')
          .limit(plan.limit)
          .execute();
        const messageIds = rows.map((row) => row.message_id);
        if (messageIds.length === 0) return;

        await db
          .deleteFrom('conversation_locks')
          .where('workspace_id', '=', plan.workspaceId)
          .where('message_id', 'in', messageIds)
          .executeTakeFirst();
      }, { applySession: options.applyWorkspaceSession });
    },
    'audit.retention': async (job) => {
      const plan = buildAuditRetentionPlan(job.payload, now());
      await withWorkspaceTransaction(options.db, {
        workspaceId: plan.workspaceId,
        role: 'system',
      }, async (db) => {
        const rows = await db
          .selectFrom('audit_events')
          .select(AUDIT_RETENTION_SELECT_COLUMNS)
          .where('workspace_id', '=', plan.workspaceId)
          .orderBy('id', 'asc')
          .limit(plan.limit + 1)
          .execute() as readonly AuditHashChainRow[];
        const verification = verifyAuditHashChain(rows);
        if (!verification.ok) {
          throw new Error(`Audit retention refused to delete unverifiable hash chain: ${verification.error}`);
        }

        const ids = auditRetentionDeletionIds(rows, plan.olderThan);
        if (ids.length === 0) return;

        await options.auditArchive?.archive({
          workspaceId: plan.workspaceId,
          olderThan: plan.olderThan,
          rows: auditRetentionRowsByIds(rows, ids),
        });

        await db
          .deleteFrom('audit_events')
          .where('workspace_id', '=', plan.workspaceId)
          .where('id', 'in', ids)
          .executeTakeFirst();
      }, { applySession: options.applyWorkspaceSession });
    },
  };
}

export function auditRetentionRowsByIds(
  rows: readonly AuditHashChainRow[],
  ids: readonly number[],
): readonly AuditHashChainRow[] {
  const selected = new Set(ids);
  return rows.filter((row) => selected.has(row.id));
}

export function auditRetentionDeletionIds(
  rows: readonly Pick<AuditHashChainRow, 'id' | 'created_at'>[],
  olderThan: Date,
): number[] {
  const expiredPrefix: Array<Pick<AuditHashChainRow, 'id' | 'created_at'>> = [];
  for (const row of rows) {
    if (toDate(row.created_at).getTime() >= olderThan.getTime()) break;
    expiredPrefix.push(row);
  }

  if (expiredPrefix.length <= 1) return [];
  return expiredPrefix.slice(0, -1).map((row) => row.id);
}

export function buildLockCleanupPlan(payload: JobPayload, now: Date): MaintenanceCleanupPlan {
  const workspaceId = requiredString(payload, 'workspaceId');
  const staleSeconds = optionalInteger(
    payload,
    'staleSeconds',
    CONVERSATION_LOCK_TIMEOUT_SECONDS,
    1,
    24 * 60 * 60,
  );
  return {
    workspaceId,
    staleBefore: new Date(now.getTime() - staleSeconds * 1000),
    limit: optionalInteger(payload, 'limit', DEFAULT_LOCK_CLEANUP_LIMIT, 1, MAX_LOCK_CLEANUP_LIMIT),
  };
}

export function buildAuditRetentionPlan(payload: JobPayload, now: Date): AuditRetentionPlan {
  const workspaceId = requiredString(payload, 'workspaceId');
  const retentionDays = optionalInteger(payload, 'retentionDays', DEFAULT_AUDIT_RETENTION_DAYS, 1, 3650);
  return {
    workspaceId,
    olderThan: new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000),
    limit: optionalInteger(payload, 'limit', DEFAULT_AUDIT_RETENTION_LIMIT, 1, MAX_AUDIT_RETENTION_LIMIT),
  };
}

export function mergeJobHandlerRegistries(
  fallback: JobHandlerRegistry,
  overrides: JobHandlerRegistry,
): JobHandlerRegistry {
  return {
    ...fallback,
    ...overrides,
  };
}

function requiredString(payload: JobPayload, key: string): string {
  const value = payload[key];
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${key} is required`);
  }
  return value.trim();
}

function optionalInteger(
  payload: JobPayload,
  key: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const value = payload[key];
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${key} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}
