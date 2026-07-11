/**
 * PROTOTYPE (default-off) AI budget gate. Reuses the existing usage tracking
 * (`ai-usage.ts` writes `ai_usage_events`; this module reads the same rows back)
 * to decide whether an AI call is within a rolling-window spend budget before it
 * runs. Kept intentionally thin: env-var limits, workspace-scoped 24h window,
 * fail-OPEN. The full design (persisted limits, fail-open-vs-closed, desktop
 * parity, UI) is written up in `docs/AI_BUDGET_GATES_SPIKE.md` — do not grow
 * this file into the shipped feature without following that doc.
 */
import { sql as kyselySql, type Kysely } from 'kysely';

import type { ServerDatabase } from './db';
import {
  withWorkspaceTransaction,
  type WorkspaceSessionApplier,
} from './db/workspace-context';

export type AiBudgetLimits = {
  /** Soft limit in micro-USD (USD * 1e6): warn but allow. null = no soft limit. */
  softLimitMicroUsd: number | null;
  /** Hard limit in micro-USD: block the call. null = no hard limit. */
  hardLimitMicroUsd: number | null;
};

export type AiBudgetDecision = 'allow' | 'warn' | 'block';

export type AiBudgetResult = {
  decision: AiBudgetDecision;
  spentMicroUsd: number;
  softLimitMicroUsd: number | null;
  hardLimitMicroUsd: number | null;
};

/**
 * Pure budget decision. `block` when spend has reached the hard limit,
 * `warn` when it has reached the soft limit, else `allow`. Null limits are
 * treated as "no limit". Kept pure so it is trivially unit-testable.
 */
export function decideAiBudget(spentMicroUsd: number, limits: AiBudgetLimits): AiBudgetResult {
  const spent = Number.isFinite(spentMicroUsd) ? Math.max(0, spentMicroUsd) : 0;
  const hard = limits.hardLimitMicroUsd;
  const soft = limits.softLimitMicroUsd;
  let decision: AiBudgetDecision = 'allow';
  if (soft != null && spent >= soft) decision = 'warn';
  if (hard != null && spent >= hard) decision = 'block';
  return { decision, spentMicroUsd: spent, softLimitMicroUsd: soft, hardLimitMicroUsd: hard };
}

export type AiBudgetLoaderDeps = {
  db: Kysely<ServerDatabase>;
  applyWorkspaceSession?: WorkspaceSessionApplier;
  now?: () => Date;
};

/**
 * Rolling-window (default 24h) spend for a workspace, in micro-USD. Reuses the
 * exact `sum(est_cost_micro_usd)` + `created_at >= since` shape the diagnostics
 * panel already runs (`postgres-mail-diagnostics-port.ts:283-293`), opened
 * through the same workspace-scoped transaction helper `recordAiUsageSafe` uses.
 */
export async function loadWorkspaceSpendMicroUsd(
  deps: AiBudgetLoaderDeps,
  workspaceId: string,
  windowMs = 24 * 60 * 60 * 1000,
): Promise<number> {
  const now = deps.now?.() ?? new Date();
  const since = new Date(now.getTime() - windowMs);
  const row = await withWorkspaceTransaction(
    deps.db,
    { workspaceId, role: 'system' },
    async (trx) =>
      trx
        .selectFrom('ai_usage_events')
        .select([kyselySql<number>`coalesce(sum(est_cost_micro_usd), 0)`.as('cost')])
        .where('workspace_id', '=', workspaceId)
        .where('created_at', '>=', since)
        .executeTakeFirst(),
    { applySession: deps.applyWorkspaceSession },
  );
  const cost = Number(row?.cost ?? 0);
  return Number.isFinite(cost) ? cost : 0;
}

/**
 * PROTOTYPE, default-off. Reads limits from env; unset env => no limits => allow.
 * Fail-OPEN: any error loading spend returns `allow` (tracking must never break
 * the AI flow). Whether the *hard* gate should instead fail CLOSED is an open
 * question for the design doc — do not decide it in code here.
 */
export function readAiBudgetLimitsFromEnv(env: NodeJS.ProcessEnv = process.env): AiBudgetLimits {
  const parse = (v: string | undefined): number | null => {
    if (!v) return null;
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
  };
  return {
    softLimitMicroUsd: parse(env.AI_DAILY_SOFT_LIMIT_MICRO_USD),
    hardLimitMicroUsd: parse(env.AI_DAILY_HARD_LIMIT_MICRO_USD),
  };
}

/**
 * Loads spend and applies the pure decision. Short-circuits to `allow` (no DB
 * read) when no limits are configured, and fails OPEN on any read error.
 *
 * NOTE: best-effort / not concurrency-safe — this reads spend then decides, so
 * concurrent calls can both pass a hard limit (a reservation/lock model is a
 * separate design decision, tracked in the spike doc; not implemented here).
 */
export async function evaluateAiBudgetSafe(
  deps: AiBudgetLoaderDeps,
  workspaceId: string,
  limits: AiBudgetLimits,
): Promise<AiBudgetResult> {
  if (limits.softLimitMicroUsd == null && limits.hardLimitMicroUsd == null) {
    return { decision: 'allow', spentMicroUsd: 0, softLimitMicroUsd: null, hardLimitMicroUsd: null };
  }
  try {
    const spent = await loadWorkspaceSpendMicroUsd(deps, workspaceId);
    return decideAiBudget(spent, limits);
  } catch {
    return {
      decision: 'allow',
      spentMicroUsd: 0,
      softLimitMicroUsd: limits.softLimitMicroUsd,
      hardLimitMicroUsd: limits.hardLimitMicroUsd,
    };
  }
}
