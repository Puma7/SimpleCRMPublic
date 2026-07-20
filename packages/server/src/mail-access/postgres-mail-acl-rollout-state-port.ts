import type { MailPermission } from '@simplecrm/core';
import { sql, type Kysely } from 'kysely';

import type { ServerDatabase } from '../db/schema';
import {
  withWorkspaceTransaction,
  type WorkspaceSessionApplier,
  type WorkspaceTransaction,
} from '../db/workspace-context';
import {
  createPostgresMailAclRolloutEvaluationContext,
  requirePostgresMailAclRolloutTransaction,
} from './postgres-mail-acl-rollout-evaluation-context';
import {
  comparableLegacyFlag,
  type MailAclRolloutDelta,
  type MailAclRolloutLegacyPort,
  type MailAclRolloutStatePort,
  type MailAclRolloutTelemetryResult,
} from './rollout-service';
import type {
  MailAclRolloutEvaluationContext,
  MailAclRolloutPersistentDiagnosticCode,
  MailAclRolloutReadiness,
  MailAclRolloutState,
} from './types';

export type PostgresMailAclRolloutPortOptions = Readonly<{
  db: Kysely<ServerDatabase>;
  applyWorkspaceSession?: WorkspaceSessionApplier;
}>;

type RolloutRow = Readonly<{
  workspace_id: string;
  mode: string;
  evaluated: string | number | bigint;
  legacy_allow_new_deny: string | number | bigint;
  legacy_deny_new_allow: string | number | bigint;
  not_comparable: string | number | bigint;
  observation_started_at: Date | string | null;
  observation_updated_at: Date | string | null;
  telemetry_healthy: boolean;
  diagnostic_code: string | null;
  diagnostic_at: Date | string | null;
}>;

type CounterUpdateRow = Readonly<{
  telemetry_healthy: boolean;
  diagnostic_code: string | null;
}>;

const MAX_BIGINT = 9_223_372_036_854_775_807n;
const LOCK_KEY_PREFIX = 'simplecrm:mail-acl-rollout:';
const PERSISTENT_DIAGNOSTIC_CODES = new Set<MailAclRolloutPersistentDiagnosticCode>([
  'counter_update_failed',
  'counter_update_zero_rows',
  'counter_saturated',
]);

export function createPostgresMailAclRolloutStatePort(
  options: PostgresMailAclRolloutPortOptions,
): MailAclRolloutStatePort {
  const sessionOptions = { applySession: options.applyWorkspaceSession } as const;

  async function runInWorkspaceTransaction<T>(
    workspaceId: string,
    evaluationContext: MailAclRolloutEvaluationContext | undefined,
    operation: (trx: WorkspaceTransaction) => Promise<T>,
  ): Promise<T> {
    if (evaluationContext) {
      return operation(requirePostgresMailAclRolloutTransaction(evaluationContext, workspaceId));
    }
    return withWorkspaceTransaction(
      options.db,
      { workspaceId, role: 'system' },
      operation,
      sessionOptions,
    );
  }

  async function readRow(
    workspaceId: string,
    evaluationContext?: MailAclRolloutEvaluationContext,
  ): Promise<RolloutRow | undefined> {
    return runInWorkspaceTransaction(workspaceId, evaluationContext, async (trx) => {
      const result = await selectRolloutRow(trx, workspaceId);
      return result.rows[0];
    });
  }

  const port: MailAclRolloutStatePort = {
    async withSharedEvaluation(workspaceId, operation) {
      return withWorkspaceTransaction(
        options.db,
        { workspaceId, role: 'system' },
        async (trx) => {
          await acquireEvaluationLock(trx, workspaceId);
          return operation(createPostgresMailAclRolloutEvaluationContext(workspaceId, trx));
        },
        sessionOptions,
      );
    },

    async getState(workspaceId, evaluationContext): Promise<MailAclRolloutState> {
      const row = await readRow(workspaceId, evaluationContext);
      if (!row) return defaultEnforceState();
      return mapState(row);
    },

    async getReadiness(workspaceId): Promise<MailAclRolloutReadiness> {
      const row = await readRow(workspaceId);
      const state = row ? mapState(row) : defaultEnforceState();
      return {
        workspaceId,
        ...state,
        ready: state.mode === 'shadow'
          && state.telemetryHealthy
          && state.evaluated > 0n
          && state.legacyAllowNewDeny === 0n
          && state.legacyDenyNewAllow === 0n,
        enforced: state.mode === 'enforce',
      };
    },

    async increment(workspaceId, delta, evaluationContext): Promise<MailAclRolloutTelemetryResult> {
      if (!evaluationContext) {
        return port.withSharedEvaluation(
          workspaceId,
          (context) => port.increment(workspaceId, delta, context),
        );
      }
      return runInWorkspaceTransaction(
        workspaceId,
        evaluationContext,
        (trx) => incrementCounters(trx, workspaceId, delta),
      );
    },

    async markTelemetryUnhealthy(workspaceId, code, evaluationContext): Promise<void> {
      if (!evaluationContext) {
        await port.withSharedEvaluation(workspaceId, async (context) => {
          await port.markTelemetryUnhealthy(workspaceId, code, context);
        });
        return;
      }
      await runInWorkspaceTransaction(workspaceId, evaluationContext, async (trx) => {
        await markTelemetryUnhealthy(trx, workspaceId, code);
      });
    },

    async transitionToEnforce(input) {
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          await acquireAdministrativeLock(trx, input.workspaceId);
          const result = await selectRolloutRow(trx, input.workspaceId, true);
          const state = result.rows[0] ? mapState(result.rows[0]) : defaultEnforceState();
          if (state.mode !== 'shadow' || state.diagnostic) return { ok: false, code: 'not_shadow' } as const;
          if (!state.telemetryHealthy) return { ok: false, code: 'telemetry_unhealthy' } as const;
          if (state.evaluated === 0n) return { ok: false, code: 'no_observations' } as const;
          if (state.legacyAllowNewDeny !== 0n || state.legacyDenyNewAllow !== 0n) {
            return { ok: false, code: 'mismatches_present' } as const;
          }
          await sql`
            UPDATE mail_acl_rollout_state
            SET mode = 'enforce', updated_at = now()
            WHERE workspace_id = ${input.workspaceId}::uuid
              AND mode = 'shadow'
          `.execute(trx);
          return { ok: true } as const;
        },
        sessionOptions,
      );
    },

    async resetShadowCounters(input) {
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          await acquireAdministrativeLock(trx, input.workspaceId);
          const result = await sql<{ mode: string }>`
            SELECT mode
            FROM mail_acl_rollout_state
            WHERE workspace_id = ${input.workspaceId}::uuid
            FOR UPDATE
          `.execute(trx);
          if (result.rows[0]?.mode !== 'shadow') return { ok: false, code: 'not_shadow' } as const;
          const reset = await sql<{ workspace_id: string }>`
            UPDATE mail_acl_rollout_state
            SET
              evaluated = 0,
              legacy_allow_new_deny = 0,
              legacy_deny_new_allow = 0,
              not_comparable = 0,
              observation_started_at = NULL,
              observation_updated_at = NULL,
              telemetry_healthy = true,
              diagnostic_code = NULL,
              diagnostic_at = NULL,
              updated_at = now()
            WHERE workspace_id = ${input.workspaceId}::uuid
              AND mode = 'shadow'
            RETURNING workspace_id::text AS workspace_id
          `.execute(trx);
          return reset.rows.length === 1
            ? { ok: true } as const
            : { ok: false, code: 'not_shadow' } as const;
        },
        sessionOptions,
      );
    },
  };

  return port;
}

export function createPostgresMailAclRolloutLegacyPort(
  options: PostgresMailAclRolloutPortOptions,
): MailAclRolloutLegacyPort {
  const sessionOptions = { applySession: options.applyWorkspaceSession } as const;
  return {
    async canAccessAccount(input, evaluationContext) {
      if (evaluationContext) {
        return canAccessAccount(
          requirePostgresMailAclRolloutTransaction(evaluationContext, input.workspaceId),
          input,
        );
      }
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, userId: input.userId, role: 'user' },
        (trx) => canAccessAccount(trx, input),
        sessionOptions,
      );
    },

    async resolveAccountScope(input, evaluationContext) {
      if (evaluationContext) {
        return resolveAccountScope(
          requirePostgresMailAclRolloutTransaction(evaluationContext, input.workspaceId),
          input,
        );
      }
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, userId: input.userId, role: 'user' },
        (trx) => resolveAccountScope(trx, input),
        sessionOptions,
      );
    },
  };
}

async function acquireEvaluationLock(trx: WorkspaceTransaction, workspaceId: string): Promise<void> {
  // A namespaced UUID is hashed to PostgreSQL's signed 64-bit advisory key.
  // Distinct workspaces only serialize on a conservative 64-bit hash collision.
  await sql`
    SELECT pg_advisory_xact_lock_shared(
      hashtextextended(${`${LOCK_KEY_PREFIX}${workspaceId}`}, 0)
    )
  `.execute(trx);
}

async function acquireAdministrativeLock(trx: WorkspaceTransaction, workspaceId: string): Promise<void> {
  await sql`
    SELECT pg_advisory_xact_lock(
      hashtextextended(${`${LOCK_KEY_PREFIX}${workspaceId}`}, 0)
    )
  `.execute(trx);
}

function selectRolloutRow(
  trx: WorkspaceTransaction,
  workspaceId: string,
  forUpdate = false,
) {
  return sql<RolloutRow>`
    SELECT
      workspace_id::text AS workspace_id,
      mode,
      evaluated,
      legacy_allow_new_deny,
      legacy_deny_new_allow,
      not_comparable,
      observation_started_at,
      observation_updated_at,
      telemetry_healthy,
      diagnostic_code,
      diagnostic_at
    FROM mail_acl_rollout_state
    WHERE workspace_id = ${workspaceId}::uuid
    ${forUpdate ? sql`FOR UPDATE` : sql``}
  `.execute(trx);
}

async function incrementCounters(
  trx: WorkspaceTransaction,
  workspaceId: string,
  delta: MailAclRolloutDelta,
): Promise<MailAclRolloutTelemetryResult> {
  const evaluated = counterDelta(delta.evaluated);
  const legacyAllowNewDeny = counterDelta(delta.legacyAllowNewDeny);
  const legacyDenyNewAllow = counterDelta(delta.legacyDenyNewAllow);
  const notComparable = counterDelta(delta.notComparable);
  if (
    evaluated === 0n
    && legacyAllowNewDeny === 0n
    && legacyDenyNewAllow === 0n
    && notComparable === 0n
  ) return { healthy: true };

  await sql`SAVEPOINT mail_acl_rollout_counter_increment`.execute(trx);
  try {
    const maxBigint = MAX_BIGINT.toString();
    const result = await sql<CounterUpdateRow>`
      WITH locked AS (
        SELECT
          workspace_id,
          evaluated,
          legacy_allow_new_deny,
          legacy_deny_new_allow,
          not_comparable,
          (
            evaluated::numeric + ${evaluated.toString()}::numeric > ${maxBigint}::numeric
            OR legacy_allow_new_deny::numeric + ${legacyAllowNewDeny.toString()}::numeric > ${maxBigint}::numeric
            OR legacy_deny_new_allow::numeric + ${legacyDenyNewAllow.toString()}::numeric > ${maxBigint}::numeric
            OR not_comparable::numeric + ${notComparable.toString()}::numeric > ${maxBigint}::numeric
          ) AS saturated
        FROM mail_acl_rollout_state
        WHERE workspace_id = ${workspaceId}::uuid
          AND mode = 'shadow'
        FOR UPDATE
      )
      UPDATE mail_acl_rollout_state AS rollout
      SET
        evaluated = LEAST(
          locked.evaluated::numeric + ${evaluated.toString()}::numeric,
          ${maxBigint}::numeric
        )::bigint,
        legacy_allow_new_deny = LEAST(
          locked.legacy_allow_new_deny::numeric + ${legacyAllowNewDeny.toString()}::numeric,
          ${maxBigint}::numeric
        )::bigint,
        legacy_deny_new_allow = LEAST(
          locked.legacy_deny_new_allow::numeric + ${legacyDenyNewAllow.toString()}::numeric,
          ${maxBigint}::numeric
        )::bigint,
        not_comparable = LEAST(
          locked.not_comparable::numeric + ${notComparable.toString()}::numeric,
          ${maxBigint}::numeric
        )::bigint,
        observation_started_at = COALESCE(rollout.observation_started_at, now()),
        observation_updated_at = now(),
        telemetry_healthy = CASE WHEN locked.saturated THEN false ELSE rollout.telemetry_healthy END,
        diagnostic_code = CASE WHEN locked.saturated THEN 'counter_saturated' ELSE rollout.diagnostic_code END,
        diagnostic_at = CASE WHEN locked.saturated THEN now() ELSE rollout.diagnostic_at END,
        updated_at = now()
      FROM locked
      WHERE rollout.workspace_id = locked.workspace_id
      RETURNING rollout.telemetry_healthy, rollout.diagnostic_code
    `.execute(trx);
    const updated = result.rows[0];
    if (!updated) {
      await markTelemetryUnhealthy(trx, workspaceId, 'counter_update_zero_rows');
      await sql`RELEASE SAVEPOINT mail_acl_rollout_counter_increment`.execute(trx);
      return { healthy: false, code: 'counter_update_zero_rows' };
    }
    const telemetryResult: MailAclRolloutTelemetryResult = updated.telemetry_healthy
      ? { healthy: true }
      : {
        healthy: false,
        code: parsePersistentDiagnosticCode(updated.diagnostic_code),
      };
    await sql`RELEASE SAVEPOINT mail_acl_rollout_counter_increment`.execute(trx);
    return telemetryResult;
  } catch (error) {
    try {
      await sql`ROLLBACK TO SAVEPOINT mail_acl_rollout_counter_increment`.execute(trx);
      await sql`RELEASE SAVEPOINT mail_acl_rollout_counter_increment`.execute(trx);
    } catch {
      throw error;
    }
    try {
      await markTelemetryUnhealthy(trx, workspaceId, 'counter_update_failed');
    } catch {
      // The caller still receives a bounded unhealthy result when persistence fails.
    }
    return { healthy: false, code: 'counter_update_failed' };
  }
}

async function markTelemetryUnhealthy(
  trx: WorkspaceTransaction,
  workspaceId: string,
  code: MailAclRolloutPersistentDiagnosticCode,
): Promise<boolean> {
  const result = await sql<{ workspace_id: string }>`
    UPDATE mail_acl_rollout_state
    SET
      telemetry_healthy = false,
      diagnostic_code = CASE WHEN telemetry_healthy THEN ${code} ELSE diagnostic_code END,
      diagnostic_at = CASE WHEN telemetry_healthy THEN now() ELSE diagnostic_at END,
      updated_at = now()
    WHERE workspace_id = ${workspaceId}::uuid
    RETURNING workspace_id::text AS workspace_id
  `.execute(trx);
  return result.rows.length === 1;
}

async function canAccessAccount(
  trx: WorkspaceTransaction,
  input: Readonly<{
    workspaceId: string;
    userId: string;
    permission: MailPermission;
    accountId: number;
  }>,
): Promise<boolean> {
  const flag = comparableLegacyFlag(input.permission);
  if (!flag) return false;
  const result = await sql<{ allowed: boolean }>`
    SELECT COALESCE(bool_or(${sql.ref(flag)}), false) AS allowed
    FROM user_account_access
    WHERE workspace_id = ${input.workspaceId}::uuid
      AND user_id = ${input.userId}::uuid
      AND account_id = ${input.accountId}
  `.execute(trx);
  return result.rows[0]?.allowed === true;
}

async function resolveAccountScope(
  trx: WorkspaceTransaction,
  input: Readonly<{
    workspaceId: string;
    userId: string;
    permission: MailPermission;
  }>,
): Promise<readonly number[]> {
  const flag = comparableLegacyFlag(input.permission);
  if (!flag) return [];
  const result = await sql<{ account_id: string | number | bigint }>`
    SELECT account_id
    FROM user_account_access
    WHERE workspace_id = ${input.workspaceId}::uuid
      AND user_id = ${input.userId}::uuid
      AND ${sql.ref(flag)} = true
    ORDER BY account_id
  `.execute(trx);
  return result.rows.map((row) => safeNumber(row.account_id, 'account_id'));
}

function defaultEnforceState(): MailAclRolloutState {
  return {
    mode: 'enforce',
    evaluated: 0n,
    legacyAllowNewDeny: 0n,
    legacyDenyNewAllow: 0n,
    notComparable: 0n,
    observationStartedAt: null,
    observationUpdatedAt: null,
    telemetryHealthy: true,
    diagnosticCode: null,
    diagnosticAt: null,
  };
}

function mapState(row: RolloutRow): MailAclRolloutState {
  try {
    const telemetryHealthy = row.telemetry_healthy;
    if (typeof telemetryHealthy !== 'boolean') throw new Error('mail ACL rollout telemetry health is invalid');
    const diagnosticCode = row.diagnostic_code === null
      ? null
      : parsePersistentDiagnosticCode(row.diagnostic_code);
    const diagnosticAt = timestampOrNull(row.diagnostic_at);
    if (telemetryHealthy !== (diagnosticCode === null && diagnosticAt === null)) {
      throw new Error('mail ACL rollout telemetry diagnostic state is inconsistent');
    }
    const base = {
      evaluated: safeBigInt(row.evaluated, 'evaluated'),
      legacyAllowNewDeny: safeBigInt(row.legacy_allow_new_deny, 'legacy_allow_new_deny'),
      legacyDenyNewAllow: safeBigInt(row.legacy_deny_new_allow, 'legacy_deny_new_allow'),
      notComparable: safeBigInt(row.not_comparable, 'not_comparable'),
      observationStartedAt: timestampOrNull(row.observation_started_at),
      observationUpdatedAt: timestampOrNull(row.observation_updated_at),
      telemetryHealthy,
      diagnosticCode,
      diagnosticAt,
    };
    if (row.mode === 'shadow' || row.mode === 'enforce') {
      return { mode: row.mode, ...base };
    }
    return invalidState(`invalid rollout mode: ${row.mode}`);
  } catch (error) {
    return invalidState(error instanceof Error ? error.message : 'invalid rollout state');
  }
}

function invalidState(diagnostic: string): MailAclRolloutState {
  return {
    ...defaultEnforceState(),
    telemetryHealthy: false,
    diagnosticCode: 'rollout_state_invalid',
    diagnostic,
  };
}

function counterDelta(value: bigint | undefined): bigint {
  if (value === undefined) return 0n;
  if (value < 0n) throw new Error('mail ACL rollout counters cannot be decremented');
  return value;
}

function parsePersistentDiagnosticCode(value: string | null): MailAclRolloutPersistentDiagnosticCode {
  if (value !== null && PERSISTENT_DIAGNOSTIC_CODES.has(value as MailAclRolloutPersistentDiagnosticCode)) {
    return value as MailAclRolloutPersistentDiagnosticCode;
  }
  throw new Error('mail ACL rollout diagnostic code is invalid');
}

function safeBigInt(value: string | number | bigint, field: string): bigint {
  const parsed = typeof value === 'bigint' ? value : BigInt(value);
  if (parsed < 0n) throw new Error(`mail ACL rollout ${field} is negative`);
  return parsed;
}

function safeNumber(value: string | number | bigint, field: string): number {
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric) || numeric <= 0) {
    throw new Error(`mail ACL rollout legacy query returned invalid ${field}`);
  }
  return numeric;
}

function timestampOrNull(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export type { MailPermission };
