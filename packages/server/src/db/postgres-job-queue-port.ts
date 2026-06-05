import type { Kysely, RawBuilder } from 'kysely';

import {
  assertValidJobType,
  formatJobError,
  nextRunAfterForFailure,
  normalizeMaxAttempts,
  type EnqueueJobInput,
  type FailJobInput,
  type JobQueuePort,
  type QueuedJob,
} from '../jobs';
import type { JobQueueRow, ServerDatabase } from './schema';
import { withWorkspaceTransaction, type WorkspaceTransaction } from './workspace-context';

export type PostgresJobQueuePortOptions = Readonly<{
  db: Kysely<ServerDatabase>;
  now?: () => Date;
  claimRaceRetries?: number;
}>;

export function createPostgresJobQueuePort(options: PostgresJobQueuePortOptions): JobQueuePort {
  const now = options.now ?? (() => new Date());
  const claimRaceRetries = options.claimRaceRetries ?? 3;

  return {
    async enqueue(input) {
      return withWorkspaceTransaction(options.db, {
        workspaceId: input.workspaceId,
        role: 'system',
      }, (db) => enqueueJob(db, input, now()));
    },

    async claimNext(input) {
      const claimAt = input.now ?? now();
      for (let attempt = 0; attempt < claimRaceRetries; attempt += 1) {
        const candidate = await options.db
          .selectFrom('job_queue')
          .selectAll()
          .where('locked_at', 'is', null)
          .where('run_after', '<=', claimAt)
          .whereRef('attempts', '<', 'max_attempts')
          .orderBy('run_after', 'asc')
          .orderBy('id', 'asc')
          .executeTakeFirst();

        if (!candidate) return null;

        const claimed = await options.db
          .updateTable('job_queue')
          .set({
            locked_at: claimAt,
            locked_by: input.workerId,
            updated_at: claimAt,
          })
          .where('id', '=', candidate.id)
          .where('locked_at', 'is', null)
          .returningAll()
          .executeTakeFirst();

        if (claimed) return mapJob(claimed);
      }
      return null;
    },

    async complete(job) {
      const result = await withWorkspaceTransaction(options.db, {
        workspaceId: job.workspaceId,
        role: 'system',
      }, (db) => db
          .deleteFrom('job_queue')
          .where('id', '=', job.id)
          .where('locked_by', '=', job.lockedBy)
          .executeTakeFirst());

      return Number(result.numDeletedRows) > 0;
    },

    async fail(input) {
      return withWorkspaceTransaction(options.db, {
        workspaceId: input.job.workspaceId,
        role: 'system',
      }, (db) => failJob(db, input, input.now ?? now()));
    },

    async releaseStaleLocks(input) {
      const rows = await options.db
        .selectFrom('job_queue')
        .select(['id'])
        .where('locked_at', 'is not', null)
        .where('locked_at', '<', input.staleBefore)
        .orderBy('locked_at', 'asc')
        .limit(input.limit ?? 100)
        .execute();

      const ids = rows.map((row) => row.id);
      if (ids.length === 0) return [];

      const released = await options.db
        .updateTable('job_queue')
        .set({
          locked_at: null,
          locked_by: null,
          updated_at: now(),
        })
        .where('id', 'in', ids)
        .returningAll()
        .execute();

      return released.map(mapJob);
    },

    async releaseAccountSyncLocks(input) {
      return withWorkspaceTransaction(options.db, {
        workspaceId: input.workspaceId,
        role: 'system',
      }, async (db) => {
        const rows = await db
          .selectFrom('job_queue')
          .select(['id'])
          .where('workspace_id', '=', input.workspaceId)
          .where('locked_at', 'is not', null)
          .where('locked_at', '<', input.staleBefore)
          .where('type', 'in', ['mail.sync.imap', 'mail.sync.pop3'])
          .where(accountSyncJobPayloadPredicate(input.accountId))
          .orderBy('locked_at', 'asc')
          .limit(input.limit ?? 100)
          .execute();

        const ids = rows.map((row) => row.id);
        if (ids.length === 0) return [];

        const released = await db
          .updateTable('job_queue')
          .set({
            locked_at: null,
            locked_by: null,
            updated_at: now(),
          })
          .where('workspace_id', '=', input.workspaceId)
          .where('id', 'in', ids)
          .where('locked_at', 'is not', null)
          .where('locked_at', '<', input.staleBefore)
          .where('type', 'in', ['mail.sync.imap', 'mail.sync.pop3'])
          .where(accountSyncJobPayloadPredicate(input.accountId))
          .returningAll()
          .execute();

        return released.map(mapJob);
      });
    },
  };
}

async function enqueueJob(
  db: WorkspaceTransaction,
  input: EnqueueJobInput,
  now: Date,
): Promise<QueuedJob> {
  const type = assertValidJobType(input.type);
  const maxAttempts = normalizeMaxAttempts(input.maxAttempts);
  const row = await db
    .insertInto('job_queue')
    .values({
      type,
      payload: input.payload,
      run_after: input.runAfter ?? now,
      max_attempts: maxAttempts,
      workspace_id: input.workspaceId,
      updated_at: now,
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  return mapJob(row);
}

async function failJob(
  db: WorkspaceTransaction,
  input: FailJobInput,
  now: Date,
): Promise<QueuedJob | null> {
  const attempts = input.job.attempts + 1;
  const terminal = attempts >= input.job.maxAttempts;
  const row = await db
    .updateTable('job_queue')
    .set({
      attempts,
      locked_at: null,
      locked_by: null,
      last_error: formatJobError(input.error),
      run_after: terminal ? now : nextRunAfterForFailure({ attempts, now }),
      updated_at: now,
    })
    .where('id', '=', input.job.id)
    .where('locked_by', '=', input.job.lockedBy)
    .returningAll()
    .executeTakeFirst();

  return row ? mapJob(row) : null;
}

export function mapJob(row: JobQueueRow): QueuedJob {
  return {
    id: Number(row.id),
    type: row.type,
    payload: normalizePayload(row.payload),
    runAfter: toDate(row.run_after).toISOString(),
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    lockedAt: row.locked_at ? toDate(row.locked_at).toISOString() : null,
    lockedBy: row.locked_by,
    lastError: row.last_error,
    workspaceId: row.workspace_id,
    createdAt: toDate(row.created_at).toISOString(),
    updatedAt: toDate(row.updated_at).toISOString(),
  };
}

function normalizePayload(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function accountSyncJobPayloadPredicate(accountId: number): RawBuilder<boolean> {
  const { sql: kyselySql } = require('kysely') as typeof import('kysely');
  return kyselySql<boolean>`payload->>'accountId' = ${String(accountId)}`;
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}
