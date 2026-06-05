import { createHash } from 'crypto';

import type { Kysely } from 'kysely';

import type { AuditApiPort } from '../api';
import type { ServerDatabase } from './schema';
import { withWorkspaceTransaction, type WorkspaceTransaction } from './workspace-context';

export type PostgresAuditPortOptions = Readonly<{
  db: Kysely<ServerDatabase>;
  now?: () => Date;
}>;

export type AuditHashChainRow = Readonly<{
  id: number;
  workspace_id: string;
  actor_user_id: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  metadata: unknown;
  previous_hash: string | null;
  event_hash: string;
  created_at: Date | string;
}>;

export type AuditHashChainVerification = Readonly<{
  ok: boolean;
  checkedRows: number;
  firstId?: number;
  lastId?: number;
  firstBrokenId?: number;
  error?: string;
}>;

export function createPostgresAuditPort(options: PostgresAuditPortOptions): AuditApiPort {
  const now = options.now ?? (() => new Date());

  return {
    async record(input) {
      const createdAt = now();
      await withWorkspaceTransaction(options.db, {
        workspaceId: input.workspaceId,
        role: 'system',
      }, async (db) => {
        await lockAuditHashChain(db, input.workspaceId);
        const previous = await db
          .selectFrom('audit_events')
          .select('event_hash')
          .where('workspace_id', '=', input.workspaceId)
          .orderBy('id', 'desc')
          .executeTakeFirst();
        const previousHash = previous?.event_hash ?? null;
        const metadata = input.metadata ?? {};
        const eventHash = hashAuditEvent({
          workspaceId: input.workspaceId,
          actorUserId: input.actorUserId ?? null,
          action: input.action,
          entityType: input.entityType ?? null,
          entityId: input.entityId ?? null,
          metadata,
          previousHash,
          createdAt,
        });

        await db
          .insertInto('audit_events')
          .values({
            workspace_id: input.workspaceId,
            actor_user_id: input.actorUserId ?? null,
            action: input.action,
            entity_type: input.entityType ?? null,
            entity_id: input.entityId ?? null,
            metadata,
            previous_hash: previousHash,
            event_hash: eventHash,
            created_at: createdAt,
          })
          .execute();
      });
    },
    async list(input) {
      const limit = Math.min(input.limit, 500);
      const offset = input.offset ?? 0;
      return withWorkspaceTransaction(options.db, {
        workspaceId: input.workspaceId,
        role: 'system',
      }, async (db) => {
        const rows = await db
          .selectFrom('audit_events')
          .select([
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
          ])
          .where('workspace_id', '=', input.workspaceId)
          .orderBy('id', 'desc')
          .limit(limit)
          .offset(offset)
          .execute();
        return rows.map(mapAuditEventRow);
      });
    },
    async verify(input) {
      return withWorkspaceTransaction(options.db, {
        workspaceId: input.workspaceId,
        role: 'system',
      }, async (db) => {
        const rows = await db
          .selectFrom('audit_events')
          .select([
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
          ])
          .where('workspace_id', '=', input.workspaceId)
          .orderBy('id', 'asc')
          .execute() as readonly AuditHashChainRow[];
        const verification = verifyAuditHashChain(rows);
        return {
          valid: verification.ok,
          checked: verification.checkedRows,
          ...(verification.firstBrokenId === undefined ? {} : { firstBrokenId: verification.firstBrokenId }),
          ...(verification.error === undefined ? {} : { error: verification.error }),
        };
      });
    },
  };
}

async function lockAuditHashChain(db: WorkspaceTransaction, workspaceId: string): Promise<void> {
  const { sql: kyselySql } = require('kysely') as typeof import('kysely');
  await kyselySql`SELECT pg_advisory_xact_lock(hashtext(${'audit:' + workspaceId}))`.execute(db);
}

export function hashAuditEvent(input: {
  workspaceId: string;
  actorUserId: string | null;
  action: string;
  entityType: string | null;
  entityId: string | null;
  metadata: Record<string, unknown>;
  previousHash: string | null;
  createdAt: Date;
}): string {
  return createHash('sha256')
    .update(stableJsonStringify({
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      metadata: input.metadata,
      previousHash: input.previousHash,
      createdAt: input.createdAt.toISOString(),
    }))
    .digest('hex');
}

export function verifyAuditHashChain(rows: readonly AuditHashChainRow[]): AuditHashChainVerification {
  let previous: AuditHashChainRow | null = null;

  for (const row of rows) {
    const metadata = metadataRecord(row.metadata);
    const expectedHash = hashAuditEvent({
      workspaceId: row.workspace_id,
      actorUserId: row.actor_user_id,
      action: row.action,
      entityType: row.entity_type,
      entityId: row.entity_id,
      metadata,
      previousHash: row.previous_hash,
      createdAt: toDate(row.created_at),
    });
    const legacyHash = legacyHashAuditEvent({
      workspaceId: row.workspace_id,
      actorUserId: row.actor_user_id,
      action: row.action,
      entityType: row.entity_type,
      entityId: row.entity_id,
      metadata,
      previousHash: row.previous_hash,
      createdAt: toDate(row.created_at),
    });

    if (row.event_hash !== expectedHash && row.event_hash !== legacyHash) {
      return {
        ok: false,
        checkedRows: rows.length,
        firstId: rows[0]?.id,
        lastId: rows[rows.length - 1]?.id,
        firstBrokenId: row.id,
        error: `audit event ${row.id} hash does not match stored fields`,
      };
    }
    if (previous && row.previous_hash !== previous.event_hash) {
      return {
        ok: false,
        checkedRows: rows.length,
        firstId: rows[0]?.id,
        lastId: rows[rows.length - 1]?.id,
        firstBrokenId: row.id,
        error: `audit event ${row.id} does not link to previous event ${previous.id}`,
      };
    }
    previous = row;
  }

  return {
    ok: true,
    checkedRows: rows.length,
    firstId: rows[0]?.id,
    lastId: rows[rows.length - 1]?.id,
  };
}

function mapAuditEventRow(row: AuditHashChainRow) {
  return {
    id: Number(row.id),
    workspaceId: row.workspace_id,
    actorUserId: row.actor_user_id,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    metadata: row.metadata,
    previousHash: row.previous_hash,
    eventHash: row.event_hash,
    createdAt: toDate(row.created_at).toISOString(),
  };
}

function legacyHashAuditEvent(input: {
  workspaceId: string;
  actorUserId: string | null;
  action: string;
  entityType: string | null;
  entityId: string | null;
  metadata: Record<string, unknown>;
  previousHash: string | null;
  createdAt: Date;
}): string {
  return createHash('sha256')
    .update(JSON.stringify({
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      metadata: input.metadata,
      previousHash: input.previousHash,
      createdAt: input.createdAt.toISOString(),
    }))
    .digest('hex');
}

function stableJsonStringify(value: unknown): string {
  return JSON.stringify(canonicalizeJson(value));
}

function canonicalizeJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalizeJson(item));
  }
  if (!value || typeof value !== 'object') {
    return value;
  }
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => [key, canonicalizeJson(item)]));
}

function metadataRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}
