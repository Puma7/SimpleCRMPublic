import type { MailPermission } from '@simplecrm/core';
import { sql, type Kysely } from 'kysely';

import type { ServerDatabase } from '../db/schema';
import {
  withWorkspaceTransaction,
  type WorkspaceSessionApplier,
} from '../db/workspace-context';
import {
  comparableLegacyFlag,
  type MailAclRolloutDelta,
  type MailAclRolloutLegacyPort,
  type MailAclRolloutStatePort,
} from './rollout-service';
import type {
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
}>;

export function createPostgresMailAclRolloutStatePort(
  options: PostgresMailAclRolloutPortOptions,
): MailAclRolloutStatePort {
  const sessionOptions = { applySession: options.applyWorkspaceSession } as const;

  async function readRow(workspaceId: string): Promise<RolloutRow | undefined> {
    return withWorkspaceTransaction(
      options.db,
      { workspaceId, role: 'system' },
      async (trx) => {
        const result = await sql<RolloutRow>`
          SELECT
            workspace_id::text AS workspace_id,
            mode,
            evaluated,
            legacy_allow_new_deny,
            legacy_deny_new_allow,
            not_comparable,
            observation_started_at,
            observation_updated_at
          FROM mail_acl_rollout_state
          WHERE workspace_id = ${workspaceId}::uuid
        `.execute(trx);
        return result.rows[0];
      },
      sessionOptions,
    );
  }

  return {
    async getState(workspaceId): Promise<MailAclRolloutState> {
      const row = await readRow(workspaceId);
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
          && state.evaluated > 0n
          && state.legacyAllowNewDeny === 0n
          && state.legacyDenyNewAllow === 0n,
        enforced: state.mode === 'enforce',
      };
    },

    async increment(workspaceId, delta): Promise<void> {
      const evaluated = counterDelta(delta.evaluated);
      const legacyAllowNewDeny = counterDelta(delta.legacyAllowNewDeny);
      const legacyDenyNewAllow = counterDelta(delta.legacyDenyNewAllow);
      const notComparable = counterDelta(delta.notComparable);
      if (
        evaluated === 0n
        && legacyAllowNewDeny === 0n
        && legacyDenyNewAllow === 0n
        && notComparable === 0n
      ) return;

      await withWorkspaceTransaction(
        options.db,
        { workspaceId, role: 'system' },
        async (trx) => {
          await sql`
            UPDATE mail_acl_rollout_state
            SET
              evaluated = evaluated + ${evaluated.toString()}::bigint,
              legacy_allow_new_deny = legacy_allow_new_deny + ${legacyAllowNewDeny.toString()}::bigint,
              legacy_deny_new_allow = legacy_deny_new_allow + ${legacyDenyNewAllow.toString()}::bigint,
              not_comparable = not_comparable + ${notComparable.toString()}::bigint,
              observation_started_at = COALESCE(observation_started_at, now()),
              observation_updated_at = now(),
              updated_at = now()
            WHERE workspace_id = ${workspaceId}::uuid
              AND mode = 'shadow'
          `.execute(trx);
        },
        sessionOptions,
      );
    },

    async transitionToEnforce(input) {
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          const result = await sql<RolloutRow>`
            SELECT
              workspace_id::text AS workspace_id,
              mode,
              evaluated,
              legacy_allow_new_deny,
              legacy_deny_new_allow,
              not_comparable,
              observation_started_at,
              observation_updated_at
            FROM mail_acl_rollout_state
            WHERE workspace_id = ${input.workspaceId}::uuid
            FOR UPDATE
          `.execute(trx);
          const state = result.rows[0] ? mapState(result.rows[0]) : defaultEnforceState();
          if (state.mode !== 'shadow' || state.diagnostic) return { ok: false, code: 'not_shadow' } as const;
          if (state.evaluated === 0n) return { ok: false, code: 'no_observations' } as const;
          if (state.legacyAllowNewDeny !== 0n || state.legacyDenyNewAllow !== 0n) {
            return { ok: false, code: 'mismatches_present' } as const;
          }
          await sql`
            UPDATE mail_acl_rollout_state
            SET mode = 'enforce', updated_at = now()
            WHERE workspace_id = ${input.workspaceId}::uuid
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
          const result = await sql<{ mode: string }>`
            SELECT mode
            FROM mail_acl_rollout_state
            WHERE workspace_id = ${input.workspaceId}::uuid
            FOR UPDATE
          `.execute(trx);
          if (result.rows[0]?.mode !== 'shadow') return { ok: false, code: 'not_shadow' } as const;
          await sql`
            UPDATE mail_acl_rollout_state
            SET
              evaluated = 0,
              legacy_allow_new_deny = 0,
              legacy_deny_new_allow = 0,
              not_comparable = 0,
              observation_started_at = NULL,
              observation_updated_at = NULL,
              updated_at = now()
            WHERE workspace_id = ${input.workspaceId}::uuid
              AND mode = 'shadow'
          `.execute(trx);
          return { ok: true } as const;
        },
        sessionOptions,
      );
    },
  };
}

export function createPostgresMailAclRolloutLegacyPort(
  options: PostgresMailAclRolloutPortOptions,
): MailAclRolloutLegacyPort {
  const sessionOptions = { applySession: options.applyWorkspaceSession } as const;
  return {
    async canAccessAccount(input) {
      const flag = comparableLegacyFlag(input.permission);
      if (!flag) return false;
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, userId: input.userId, role: 'user' },
        async (trx) => {
          const result = await sql<{ allowed: boolean }>`
            SELECT COALESCE(bool_or(${sql.ref(flag)}), false) AS allowed
            FROM user_account_access
            WHERE workspace_id = ${input.workspaceId}::uuid
              AND user_id = ${input.userId}::uuid
              AND account_id = ${input.accountId}
          `.execute(trx);
          return result.rows[0]?.allowed === true;
        },
        sessionOptions,
      );
    },

    async resolveAccountScope(input) {
      const flag = comparableLegacyFlag(input.permission);
      if (!flag) return [];
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, userId: input.userId, role: 'user' },
        async (trx) => {
          const result = await sql<{ account_id: string | number | bigint }>`
            SELECT account_id
            FROM user_account_access
            WHERE workspace_id = ${input.workspaceId}::uuid
              AND user_id = ${input.userId}::uuid
              AND ${sql.ref(flag)} = true
            ORDER BY account_id
          `.execute(trx);
          return result.rows.map((row) => safeNumber(row.account_id, 'account_id'));
        },
        sessionOptions,
      );
    },
  };
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
  };
}

function mapState(row: RolloutRow): MailAclRolloutState {
  try {
    const base = {
      evaluated: safeBigInt(row.evaluated, 'evaluated'),
      legacyAllowNewDeny: safeBigInt(row.legacy_allow_new_deny, 'legacy_allow_new_deny'),
      legacyDenyNewAllow: safeBigInt(row.legacy_deny_new_allow, 'legacy_deny_new_allow'),
      notComparable: safeBigInt(row.not_comparable, 'not_comparable'),
      observationStartedAt: timestampOrNull(row.observation_started_at),
      observationUpdatedAt: timestampOrNull(row.observation_updated_at),
    };
    if (row.mode === 'shadow' || row.mode === 'enforce') {
      return { mode: row.mode, ...base };
    }
    return {
      mode: 'enforce',
      ...base,
      diagnostic: `invalid rollout mode: ${row.mode}`,
    };
  } catch (error) {
    return {
      ...defaultEnforceState(),
      diagnostic: error instanceof Error ? error.message : 'invalid rollout state',
    };
  }
}

function counterDelta(value: bigint | undefined): bigint {
  if (value === undefined) return 0n;
  if (value < 0n) throw new Error('mail ACL rollout counters cannot be decremented');
  return value;
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
