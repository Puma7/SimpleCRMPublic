# Plan 021: SPIKE — budget gates on the existing AI usage tracking + desktop parity

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in the `README.md` of the directory this plan lives in (`plans/README.md`) —
> unless a reviewer dispatched you and told you they maintain the index.
>
> **This is a DIRECTION SPIKE, not a build-everything plan.** Your deliverable
> is (a) a written design/recommendation document, (b) a small, guarded,
> reversible prototype of the budget-gate check wired to ONE AI node, and
> (c) a corrected roadmap entry. Do NOT build the full budget feature (no UI,
> no per-user/per-account limit config surface, no desktop tracking
> implementation). Prefer a smaller, cleaner prototype over a fuller one.
>
> **Drift check (run first)**:
> `git diff --stat f24fb27..HEAD -- docs/AI_BUDGET_GATES_SPIKE.md docs/FEATURE_REQUESTS_JTL_KI_SUPPORT.md packages/server/src/ai-budget.ts packages/server/src/index.ts packages/server/src/ai-classification.ts packages/server/src/ai-reply-suggestion.ts tests/unit/ai-budget.test.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: direction
- **Planned at**: commit `f24fb27`, 2026-07-10

## Why this matters

The server edition already records per-call AI token/cost/latency into an
`ai_usage_events` table and surfaces it in the diagnostics panel. What is
missing is the next step its own code comments call out: **budget LIMITS/gates**
(soft/hard, daily/account) that stop or warn before an AI call runs, and
**desktop-edition parity** (the Electron/SQLite edition makes AI calls but
records nothing). Separately, the roadmap doc
`docs/FEATURE_REQUESTS_JTL_KI_SUPPORT.md` has **drifted**: it lists token/cost
tracking as missing (❌, P0), but tracking exists. This spike de-risks the
budget-gate work by nailing down the exact insertion point, prototyping the
gate against one AI node behind a default-off flag, writing a recommendation
for the full design (including the fail-open vs fail-closed decision and the
desktop story), and correcting the roadmap so nobody rebuilds tracking that
already exists.

## Current state

### Tracking already exists (server edition)

- `packages/server/src/ai-usage.ts` — records one `ai_usage_events` row per LLM
  call; estimates cost. Its own header and pricing comment say budgets are a
  *later* step. Excerpt (`ai-usage.ts:1-5`, `38-39`):

  ```ts
  /**
   * AI token/cost/latency tracking. Every LLM call records one `ai_usage_events`
   * row so operators see what the KI support is costing (per day/model/node type).
   * Recording is best-effort and must never break the AI flow.
   */
  ```
  ```ts
  /** Approximate prices in USD per 1,000,000 tokens. Estimates only (configurable
   *  budgets/prices are a later step); unknown/local models record tokens but no cost. */
  ```

  Public helpers you will reuse (`ai-usage.ts:69-79`, exported via the barrel):
  ```ts
  /** Estimated cost in micro-USD (USD * 1e6), or null when model/tokens are unknown. */
  export function estimateAiCostMicroUsd(model: string | null, usage: AiTokenUsage | null): number | null {
  ```

- `packages/server/src/migrations/0017_ai_usage_events.ts` — the table. Relevant
  columns (`0017_ai_usage_events.ts:7-22`): `workspace_id uuid`, `node_type text`,
  `prompt_tokens integer`, `completion_tokens integer`, `total_tokens integer`,
  `est_cost_micro_usd bigint`, `latency_ms integer`, `created_at timestamptz`.
  RLS is enabled + forced with an `app.can_access_workspace(workspace_id)` policy.
  Indexed on `(workspace_id, created_at DESC)`.

### The single choke point where a gate belongs (server edition)

- `packages/server/src/ai-classification.ts` — MOST server AI calls funnel through
  `runTrackedChatCompletion`, which records usage *after* the call. This is the
  primary place a *pre-call* budget check belongs. (It is not the ONLY chat entry
  point — `ai-reply-suggestion.ts` has its own; Step 4 gates that too.) Excerpt
  (`ai-classification.ts:1365-1383`):

  ```ts
  /**
   * Runs a chat completion and records token/cost/latency into `ai_usage_events`
   * (best-effort). All AI call sites go through this so usage tracking is uniform.
   */
  async function runTrackedChatCompletion(
    options: PostgresAiClassificationPortOptions,
    attribution: AiUsageAttribution,
    input: ChatCompletionInput,
  ): Promise<string> {
    const chat = options.chatCompletion ?? defaultChatCompletion(options);
    const started = Date.now();
    let usage: AiTokenUsage | null = null;
    const output = await chat({ ...input, captureUsage: (value) => { usage = value; } });
    await recordAiUsageSafe(
      { db: options.db, applyWorkspaceSession: options.applyWorkspaceSession, now: options.now },
      { ...attribution, usage, latencyMs: Date.now() - started },
    );
    return output;
  }
  ```

  The `attribution` shape (`ai-classification.ts:38-45`) gives you `workspaceId`
  and `nodeType`:
  ```ts
  type AiUsageAttribution = {
    workspaceId: string;
    aiProfileId: number | null;
    model: string | null;
    nodeType: string;
    messageId?: number | null;
    actorUserId?: string | null;
  };
  ```

  Every node type routes through it — e.g. `nodeType: 'ai.classify'`
  (`ai-classification.ts:253`), `'ai.agent'` (`:735`), `'ai.review'` (`:651`).
  **Prototype the gate against `ai.classify`** — it is the first/simplest caller.

### How spend is aggregated today (reuse this query shape)

- `packages/server/src/db/postgres-mail-diagnostics-port.ts` sums cost over a
  rolling window for the diagnostics panel. Excerpt (`postgres-mail-diagnostics-port.ts:286-294`):
  ```ts
  return trx
    .selectFrom('ai_usage_events')
    .select([
      kyselySql<CountValue>`count(*)`.as('events'),
      kyselySql<CountValue>`coalesce(sum(total_tokens), 0)`.as('tokens'),
      kyselySql<CountValue>`coalesce(sum(est_cost_micro_usd), 0)`.as('cost'),
      kyselySql<CountValue>`coalesce(round(avg(latency_ms)), 0)`.as('avg_latency'),
    ])
  ```
  The 24h window boundary is computed as
  `new Date(now.getTime() - 24 * 60 * 60 * 1000)` (`:105`). Your budget loader
  should reuse this same `sum(est_cost_micro_usd)` + rolling-window shape.

### Cost is already surfaced (server edition)

- `src/components/email/settings/diagnostics-panel.tsx` renders the aggregates,
  including a `formatUsd(microUsd)` helper (`diagnostics-panel.tsx:73-78`) and a
  "KI-Nutzung & Kosten" section (`:383-412`). A future budget UI extends this
  section — but that is OUT OF SCOPE for this spike (design only).

### Desktop edition records NOTHING (the parity gap)

- The Electron edition is a separate SQLite-backed implementation under
  `electron/`. Its AI workflow nodes call `runChatCompletion` from
  `electron/email/email-openai.ts`, which **discards** the provider `usage`
  object and never writes an `ai_usage_events` equivalent. Excerpt
  (`email-openai.ts:57-62`):
  ```ts
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const text = data.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error('Leere KI-Antwort');
    return text;
  ```
  The desktop AI nodes (`electron/workflow/nodes/ai-nodes.ts`) call
  `runChatCompletion(system, user, profileId)` — note there is **no usage
  capture and no recorder** anywhere in that file (grep for `usage`/`recordAiUsage`
  returns nothing). The diagnostics panel even hints at this at runtime
  (`diagnostics-panel.tsx:385-389`): *"Desktop: KI-Nutzungsstatistik kann fehlen,
  wenn kein Usage-Collector aktiv ist."* **Deciding whether/how to bring tracking
  (and gates) to desktop is a core question this spike must answer in writing —
  do NOT implement desktop tracking here.**

### The gate pattern the codebase already uses (numeric threshold)

- There is a precedent for numeric gating on a workflow variable:
  `logic.threshold` compares a variable to a limit and routes yes/no. Server
  catalog is in `packages/server/src/workflow-execution.ts`; the desktop
  registration is `electron/workflow/nodes/logic-nodes.ts:89-118`:
  ```ts
  register({
    type: 'logic.threshold',
    label: 'Schwellwert',
    ...
    execute: async (ctx, config) => {
      ...
      const match = op === 'gte' ? num >= thresh : num <= thresh;
      return { status: 'ok', port: match ? 'yes' : 'no', variables: { 'threshold.matched': match } };
    },
  });
  ```
  Your recommendation should note whether a budget gate should be a *workflow
  node* (like `logic.threshold`, author-placed) or an *always-on pre-call guard*
  inside `runTrackedChatCompletion` (the prototype does the latter).

### The roadmap doc that has DRIFTED

- `docs/FEATURE_REQUESTS_JTL_KI_SUPPORT.md` marks token/cost tracking as missing
  and P0, which is now false. The two lines to correct:
  - Row #7 (`:23`):
    ```
    | 7 | Kostenkontrolle pro Antwort/Nutzer/Monat | ❌ | — (kein Token-/Kosten-Tracking gefunden) | Token-/Kosten-Erfassung, Budget- & Limit-Regeln |
    ```
  - P0 bullet (`:38`):
    ```
    - [ ] **Token-/Kosten-Tracking (#7).** Pro KI-Aufruf prompt/completion-Tokens + geschätzte Kosten je Modell erfassen; Aggregation pro Tag/Nutzer/Tickettyp; Budget- und Limit-Regeln (weich/hart). Anzeige in Diagnose.
    ```

### Conventions to match

- **Barrel exports**: `packages/server/src/index.ts` re-exports each module,
  e.g. `export * from './ai-usage';` (`index.ts:4`). Unit tests import from the
  barrel: `tests/unit/ai-usage.test.ts:1-5` does
  `import { estimateAiCostMicroUsd, ... } from '../../packages/server/src';`.
- **Best-effort / never break the AI flow**: `recordAiUsageSafe`
  (`ai-usage.ts:107-138`) swallows all errors. Follow the same defensive style
  for any DB read your prototype adds.
- **Test style**: Jest with `describe`/`test`/`expect`; pure functions tested
  directly, DB tested with a hand-rolled fake. See `tests/unit/ai-usage.test.ts`
  as the exemplar — model your new test file on it structurally.

## Commands you will need

| Purpose   | Command                                   | Expected on success |
|-----------|-------------------------------------------|---------------------|
| Install   | `pnpm install --frozen-lockfile`          | exit 0              |
| Typecheck | `npx tsc -p tsconfig.json --noEmit`       | exit 0, no errors   |
| Tests     | `pnpm test -- tests/unit/ai-budget.test.ts` | all pass          |
| Full tests| `pnpm test`                               | all pass            |
| Lint      | `pnpm run lint`                           | exit 0 (eslint, `--max-warnings 0`) |
| Build     | `pnpm run build`                          | exit 0              |

Notes: the repo has **no** `typecheck` script yet (a separate plan, 002, adds
it) — use `npx tsc -p tsconfig.json --noEmit` and/or `pnpm run build`. The test
runner is Jest; `pnpm test` maps to `jest --passWithNoTests`. Do not switch
package managers; CI uses pnpm.

## Scope

**In scope** (the only files you should modify or create):
- `docs/AI_BUDGET_GATES_SPIKE.md` (create) — the design/recommendation deliverable
- `docs/FEATURE_REQUESTS_JTL_KI_SUPPORT.md` (edit) — correct the two drifted lines
- `packages/server/src/ai-budget.ts` (create) — prototype gate module
- `tests/unit/ai-budget.test.ts` (create) — prototype unit test
- `packages/server/src/ai-classification.ts` (edit) — one guarded, default-off gate call in `runTrackedChatCompletion`
- `packages/server/src/ai-reply-suggestion.ts` (edit) — the same guarded, default-off gate before its own `chatCompletion` call (second AI entry point)
- `packages/server/src/index.ts` (edit) — add `export * from './ai-budget';`

**Out of scope** (do NOT touch, even though they look related):
- Any UI file, incl. `src/components/email/settings/diagnostics-panel.tsx` — the
  budget UI is a design deliverable in this spike, not code.
- The desktop edition (`electron/**`) — deciding the desktop story is a *written*
  question here; implementing desktop tracking/gates is a follow-up plan.
- New migrations / schema changes — the prototype reads existing columns; where
  configurable limits should be *stored* is an open question, not a build item.
- The pricing table in `ai-usage.ts` and the recorder `recordAiUsageSafe` — do
  not change how tracking works.
- Adding a new workflow node type or catalog entry — the prototype is a pre-call
  guard, not a node; a node is one of the design options to write up.

## Git workflow

- Branch: `advisor/021-spike-ai-budget-gates`
- Commit per logical unit; conventional-commit style (matches repo `git log`,
  e.g. `fix(review): keep raw-headers / .eml export out of the mail read bucket`).
  Suggested commits: `feat(ai): prototype default-off AI budget gate`,
  `docs(ai): budget-gate spike design + correct KI roadmap drift`.
- Do NOT push or open a PR.

## Steps

### Step 1: Add the prototype budget module `packages/server/src/ai-budget.ts`

Create the file with (a) a **pure** decision function and (b) a defensive DB
loader that reuses the existing aggregation shape. Keep it small; the target
shape:

```ts
import type { Kysely } from 'kysely';

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

/** Rolling-window (default 24h) spend for a workspace, in micro-USD. */
export async function loadWorkspaceSpendMicroUsd(
  deps: AiBudgetLoaderDeps,
  workspaceId: string,
  windowMs = 24 * 60 * 60 * 1000,
): Promise<number> {
  const now = deps.now?.() ?? new Date();
  const since = new Date(now.getTime() - windowMs);
  const { sql: kyselySql } = require('kysely') as typeof import('kysely');
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
    return { decision: 'allow', spentMicroUsd: 0, softLimitMicroUsd: limits.softLimitMicroUsd, hardLimitMicroUsd: limits.hardLimitMicroUsd };
  }
}
```

Match the existing `require('kysely')` pattern used in
`postgres-mail-diagnostics-port.ts` and the `withWorkspaceTransaction`
usage in `ai-usage.ts:107-134`. If `withWorkspaceTransaction`'s signature does
not match the excerpt above (check `ai-usage.ts` imports and call site), adapt
to the real signature — this is a STOP-worthy mismatch only if the helper no
longer exists.

**Verify**: `npx tsc -p tsconfig.json --noEmit` → exit 0, no errors.

### Step 2: Export the module from the barrel

In `packages/server/src/index.ts`, add next to the other AI exports
(`export * from './ai-usage';` is at `index.ts:4`):

```ts
export * from './ai-budget';
```

**Verify**: `npx tsc -p tsconfig.json --noEmit` → exit 0.

### Step 3: Add the prototype unit test `tests/unit/ai-budget.test.ts`

Model it on `tests/unit/ai-usage.test.ts`. Import from the barrel. Cover the
pure decision function exhaustively (this is the load-bearing logic):

- spend below both limits → `allow`
- spend at/above soft, below hard → `warn`
- spend at/above hard → `block`
- both limits `null` → `allow`
- `readAiBudgetLimitsFromEnv` with env unset → `{ soft: null, hard: null }`;
  with `AI_DAILY_HARD_LIMIT_MICRO_USD` set → parsed number
- `evaluateAiBudgetSafe` short-circuits to `allow` when both limits are null
  (no DB call). You may assert this by passing a `db` that throws if touched.

Target shape:

```ts
import {
  decideAiBudget,
  readAiBudgetLimitsFromEnv,
  evaluateAiBudgetSafe,
} from '../../packages/server/src';

describe('decideAiBudget', () => {
  const limits = { softLimitMicroUsd: 5_000_000, hardLimitMicroUsd: 10_000_000 };
  test('allows below soft', () => {
    expect(decideAiBudget(1_000_000, limits).decision).toBe('allow');
  });
  test('warns at/above soft, below hard', () => {
    expect(decideAiBudget(5_000_000, limits).decision).toBe('warn');
    expect(decideAiBudget(9_999_999, limits).decision).toBe('warn');
  });
  test('blocks at/above hard', () => {
    expect(decideAiBudget(10_000_000, limits).decision).toBe('block');
  });
  test('null limits always allow', () => {
    expect(decideAiBudget(999_999_999, { softLimitMicroUsd: null, hardLimitMicroUsd: null }).decision).toBe('allow');
  });
});

describe('readAiBudgetLimitsFromEnv', () => {
  test('unset env yields no limits', () => {
    expect(readAiBudgetLimitsFromEnv({} as NodeJS.ProcessEnv)).toEqual({
      softLimitMicroUsd: null,
      hardLimitMicroUsd: null,
    });
  });
  test('parses a hard limit', () => {
    expect(readAiBudgetLimitsFromEnv({ AI_DAILY_HARD_LIMIT_MICRO_USD: '2000000' } as NodeJS.ProcessEnv).hardLimitMicroUsd).toBe(2_000_000);
  });
});

describe('evaluateAiBudgetSafe', () => {
  test('short-circuits to allow with no limits and never touches the db', async () => {
    const db = new Proxy({}, { get() { throw new Error('db should not be touched'); } }) as never;
    const r = await evaluateAiBudgetSafe({ db }, '11111111-1111-4111-8111-111111111111', {
      softLimitMicroUsd: null,
      hardLimitMicroUsd: null,
    });
    expect(r.decision).toBe('allow');
  });
});
```

**Verify**: `pnpm test -- tests/unit/ai-budget.test.ts` → all pass (all tests
green).

### Step 4: Wire a default-off gate into `runTrackedChatCompletion` (one node)

In `packages/server/src/ai-classification.ts`, inside `runTrackedChatCompletion`
(`:1369-1383`), add a **guarded, default-off** pre-call check. It must be a
complete no-op when no env limit is configured (production behavior unchanged).
Insert immediately before `const output = await chat(...)`:

```ts
  // PROTOTYPE budget gate (default-off). No env limits configured => no-op.
  const budgetLimits = readAiBudgetLimitsFromEnv();
  if (budgetLimits.hardLimitMicroUsd != null || budgetLimits.softLimitMicroUsd != null) {
    const budget = await evaluateAiBudgetSafe(
      { db: options.db, applyWorkspaceSession: options.applyWorkspaceSession, now: options.now },
      attribution.workspaceId,
      budgetLimits,
    );
    if (budget.decision === 'block') {
      throw new Error(
        `AI budget exceeded for workspace ${attribution.workspaceId} ` +
        `(node ${attribution.nodeType}): spent ${budget.spentMicroUsd} µ$ ` +
        `>= hard limit ${budget.hardLimitMicroUsd} µ$`,
      );
    }
  }
```

Add the import at the top of the file (next to
`import { recordAiUsageSafe, type AiTokenUsage } from './ai-usage';` at
`ai-classification.ts:14`):

```ts
import { evaluateAiBudgetSafe, readAiBudgetLimitsFromEnv } from './ai-budget';
```

This covers `ai.classify` and every node that routes through
`ai-classification.ts`. But it is **not** the only chat entry point:
`packages/server/src/ai-reply-suggestion.ts` has its own `chatCompletion` call
(it records `nodeType: 'ai.reply_suggestion'` via `recordAiUsageSafe` around
`:519-526`), so a budget-exhausted account could still spend there. Add the same
guard immediately before that second `chatCompletion` call (same
`evaluateAiBudgetSafe(...)` → skip-and-record-blocked pattern). In the design
doc, record the productionization recommendation: factor a shared
`trackedChatCompletion(input)` helper that does the budget check + the usage
record in one place, and route BOTH paths through it so a future third AI call
site can't silently bypass the budget.

**Verify**:
- `npx tsc -p tsconfig.json --noEmit` → exit 0.
- `git grep -n "evaluateAiBudgetSafe" packages/server/src` → returns matches in
  BOTH `ai-classification.ts` and `ai-reply-suggestion.ts`.
- `pnpm test -- tests/unit/ai-usage.test.ts` → still all pass (existing AI-flow
  tests unaffected because the gate is default-off).

### Step 5: Correct the roadmap drift in `docs/FEATURE_REQUESTS_JTL_KI_SUPPORT.md`

Two edits only — do not restructure the doc:

1. Row #7 (`:23`): change the status from `❌` to `🟡`, and rewrite the
   "Beleg im Code" + "Restliche Lücke" cells so they state tracking EXISTS and
   only limits/gates + desktop parity remain. Suggested replacement:
   ```
   | 7 | Kostenkontrolle pro Antwort/Nutzer/Monat | 🟡 | Token-/Kosten-/Latenz-Tracking vorhanden: `ai-usage.ts` schreibt `ai_usage_events`, in Diagnose sichtbar (`diagnostics-panel.tsx`) | **Budget-/Limit-Regeln (weich/hart)** + Gate vor KI-Aufruf; **Desktop-Parität** des Trackings |
   ```
2. P0 bullet (`:38`): rewrite so it no longer says tracking is missing.
   Suggested replacement:
   ```
   - [ ] **AI-Budget-Gates + Desktop-Parität (#7).** Token-/Kosten-Tracking existiert bereits (`ai_usage_events`, Diagnose). Offen: konfigurierbare Budget-/Limit-Regeln (weich/hart, Tag/Konto), Schwellwert-Gate vor dem KI-Aufruf, und das Tracking in die Desktop-Edition bringen. Siehe Spike `docs/AI_BUDGET_GATES_SPIKE.md` / Plan `plans/021-spike-ai-budget-gates.md`.
   ```

**Verify**: `pnpm run lint` → exit 0 (Markdown is not linted by eslint, but this
confirms nothing else broke). Manually confirm the two lines now read as above:
`git diff docs/FEATURE_REQUESTS_JTL_KI_SUPPORT.md` shows exactly two changed
lines, both about #7.

### Step 6: Write the design/recommendation `docs/AI_BUDGET_GATES_SPIKE.md`

This is the primary deliverable. Write a concise design doc (roughly 1–2 pages)
covering, at minimum, these sections:

1. **What already exists** (cite the files/lines from "Current state": recorder,
   table, aggregation, diagnostics surfacing) so no one rebuilds it.
2. **Proposed budget model** — soft vs hard, daily vs account/workspace scope.
   Recommend concrete rule shapes (e.g. hard daily workspace limit in micro-USD;
   optional soft warn threshold). Note that `est_cost_micro_usd` is null for
   local/unknown models (`ai-usage.ts:69-79`) — decide how those count toward a
   budget (tokens-only fallback vs ignored).
3. **Gate placement** — the prototype's `runTrackedChatCompletion` pre-call
   guard vs an author-placed workflow node (like `logic.threshold`). Give a
   recommendation and why.
4. **Fail-open vs fail-closed** — the prototype fails OPEN (a DB read error
   allows the call, matching the "tracking must never break the AI flow"
   principle). State whether the *hard* limit should instead fail CLOSED, and
   the operator risk of each.
5. **Where limits are stored** — env var (prototype) vs a settings table/row
   vs per-workspace config. Recommend, and note any migration implied (do not
   write it here).
6. **Cost surfacing** — how the diagnostics "KI-Nutzung & Kosten" section
   (`diagnostics-panel.tsx:383-412`) should show budget status (spent vs limit,
   warn/block state). Design only.
7. **Desktop parity** — the concrete gap (`email-openai.ts:57-62` discards
   `usage`; no recorder in `electron/`). Recommend one of: (a) capture `usage`
   in `runChatCompletion` and write a SQLite `ai_usage_events` mirror, (b) share
   logic via `packages/*`, or (c) defer. State effort/risk of each.
8. **Open questions** — an explicit bulleted list of everything undecided
   (at least: per-user vs per-workspace scope; timezone/day boundary for
   "daily"; retroactive vs pre-call enforcement; how streaming responses report
   usage; whether blocked attempts should be recorded as events).
9. **Recommended next plans** — the follow-up build plans this spike unlocks.

Reference the prototype (`packages/server/src/ai-budget.ts`) and its test as
proof the gate logic works.

**Verify**: file exists and is non-trivial:
`test -s docs/AI_BUDGET_GATES_SPIKE.md && wc -l docs/AI_BUDGET_GATES_SPIKE.md`
→ exit 0, and a line count comfortably above ~40 (i.e. it actually contains the
sections above, not a stub).

### Step 7: Full verification

Run the full gates to confirm nothing regressed.

**Verify**:
- `pnpm run lint` → exit 0
- `pnpm test` → all pass (including the new `ai-budget.test.ts`)
- `pnpm run build` → exit 0
- `git status` → only the six in-scope files are modified/created.

## Test plan

- New file `tests/unit/ai-budget.test.ts`, modeled on `tests/unit/ai-usage.test.ts`.
  Cases (all listed in Step 3): `decideAiBudget` allow/warn/block boundaries and
  null-limit passthrough; `readAiBudgetLimitsFromEnv` unset and parsed;
  `evaluateAiBudgetSafe` no-limits short-circuit that never touches the DB.
- No new tests for the `runTrackedChatCompletion` wiring are required for the
  spike (it is default-off); the existing `tests/unit/ai-usage.test.ts` must
  keep passing, proving the AI flow is unchanged.
- Verification: `pnpm test -- tests/unit/ai-budget.test.ts` → all pass; then
  `pnpm test` → all pass.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `npx tsc -p tsconfig.json --noEmit` exits 0
- [ ] `pnpm test` exits 0; `tests/unit/ai-budget.test.ts` exists and its tests pass
- [ ] `pnpm run lint` exits 0
- [ ] `pnpm run build` exits 0
- [ ] `docs/AI_BUDGET_GATES_SPIKE.md` exists and contains sections 1–9 from Step 6
      (`test -s docs/AI_BUDGET_GATES_SPIKE.md` exit 0)
- [ ] `git diff docs/FEATURE_REQUESTS_JTL_KI_SUPPORT.md` shows the two #7 lines
      corrected (no longer marked ❌ / "kein Token-/Kosten-Tracking gefunden")
- [ ] `packages/server/src/index.ts` contains `export * from './ai-budget';`
- [ ] The gate in `runTrackedChatCompletion` is default-off: with no
      `AI_DAILY_*_LIMIT_MICRO_USD` env set, no budget code path runs
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The code at the locations in "Current state" doesn't match the excerpts —
  especially if `runTrackedChatCompletion` (`ai-classification.ts:1369`) is no
  longer the single choke point, or `ai_usage_events` columns
  (`est_cost_micro_usd`, `created_at`, `workspace_id`) have changed. The
  codebase has drifted since this plan was written.
- `withWorkspaceTransaction` no longer exists or its signature differs enough
  that the Step 1 loader cannot be written to match `ai-usage.ts:107-134`.
- Wiring the gate (Step 4) requires changing behavior when no env limit is set
  (it must be a strict no-op by default) — if you cannot keep it default-off,
  stop.
- A verification command fails twice after a reasonable fix attempt.
- The spike appears to require touching an out-of-scope file (a migration, the
  diagnostics UI, or anything under `electron/`) to make the prototype work.
  Those are follow-up work; capture them as open questions in the design doc
  instead.
- You find the assumption "all server AI calls funnel through
  `runTrackedChatCompletion`" is false (e.g. a node calls `callAiChat` directly).

## Maintenance notes

For the human/agent who owns this after the spike lands:

- This is a **prototype**, not a shipped feature. `packages/server/src/ai-budget.ts`
  is intentionally thin (env-var config, fail-open, workspace-scoped 24h window).
  The follow-up build plan should replace env config with a persisted, per-scope
  limit source and resolve the fail-open-vs-closed question the design doc raises.
- The gate lives at the single server choke point (`runTrackedChatCompletion`).
  If a new AI call site is added that bypasses it, the gate won't cover it —
  keep that invariant. The desktop edition is NOT covered at all (that is the
  parity gap this spike documents).
- A reviewer should scrutinize: (1) the gate is genuinely default-off (grep the
  diff for `AI_DAILY_` and confirm the guard); (2) `evaluateAiBudgetSafe` cannot
  throw into the AI flow; (3) the two roadmap-doc lines are corrected, not just
  appended to.
- Deferred out of this plan (by design): configurable limit storage + migration,
  budget UI in the diagnostics panel, recording of blocked attempts, per-user
  scoping, and any desktop-edition tracking/gate implementation — all captured
  as open questions in `docs/AI_BUDGET_GATES_SPIKE.md`.
