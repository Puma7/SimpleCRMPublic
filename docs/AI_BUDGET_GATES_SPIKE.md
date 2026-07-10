# SPIKE: AI budget gates on the existing usage tracking + desktop parity

**Plan:** `plans/021-spike-ai-budget-gates.md` · **Status:** direction spike (prototype + design)
**Prototype code:** `packages/server/src/ai-budget.ts` (+ test `tests/unit/ai-budget.test.ts`)
**Scope:** de-risk the budget-gate work; recommend the full design. This is **not** the shipped
feature — no UI, no persisted per-scope limit config, no desktop tracking implementation.

---

## DOC-DRIFT finding (recorded)

The roadmap doc `docs/FEATURE_REQUESTS_JTL_KI_SUPPORT.md` claimed AI **token/cost tracking was
missing** (row #7 marked `❌`, "kein Token-/Kosten-Tracking gefunden", listed P0). **That is false.**
Per-call token/cost/latency tracking already exists in the server edition:
`packages/server/src/ai-usage.ts` writes one `ai_usage_events` row per LLM call and the diagnostics
panel surfaces it. **Only the budget GATES (soft/hard limits enforced before a call) and
desktop-edition parity are actually missing.** This spike corrected the two drifted lines in that doc
(row #7 → `🟡`; the P0 bullet → "AI-Budget-Gates + Desktop-Parität") so nobody rebuilds tracking that
already ships.

---

## 1. What already exists (do NOT rebuild)

| Concern | Where | Notes |
|---|---|---|
| Per-call recorder | `packages/server/src/ai-usage.ts` (`recordAiUsageSafe`, `:107-138`) | Writes one `ai_usage_events` row per LLM call; best-effort, swallows all errors, must never break the AI flow. |
| Cost estimate | `ai-usage.ts` `estimateAiCostMicroUsd` (`:69-79`) | USD·1e6 (micro-USD); `null` for unknown/local models. |
| Table + RLS | `packages/server/src/migrations/0017_ai_usage_events.ts` | Cols incl. `workspace_id uuid`, `est_cost_micro_usd bigint`, `total_tokens integer`, `created_at timestamptz`. RLS enabled+forced (`app.can_access_workspace`). Indexed `(workspace_id, created_at DESC)`. |
| Rolling-window aggregate | `packages/server/src/db/postgres-mail-diagnostics-port.ts` (`:283-293`) | `coalesce(sum(est_cost_micro_usd),0)` where `created_at >= since`; 24h boundary `now - 24h`. |
| Cost surfacing | `src/components/email/settings/diagnostics-panel.tsx` (`formatUsd` `:73`, "KI-Nutzung & Kosten" `:384-397`) | Shows 24h/30d cost + avg latency. |
| Single server choke point | `ai-classification.ts` `runTrackedChatCompletion` (`:1369-1383`) | Almost all server AI calls funnel through it; it records usage *after* the call. |
| Second server entry point | `ai-reply-suggestion.ts` (`:519-537`) | Has its own `chatCompletion` + `recordAiUsageSafe`; `nodeType: 'ai.reply_suggestion'`. |

The prototype **reuses** the aggregate shape (row 4 above) and the `withWorkspaceTransaction` helper
(the same one `recordAiUsageSafe` uses) — it adds no new table, no new column, no new query pattern.

## 2. Proposed budget model

- **Unit:** micro-USD (matches `est_cost_micro_usd`), summed over a **rolling window** (prototype: 24h).
- **Two thresholds per scope:** a **soft** limit (`warn`, still allow) and a **hard** limit (`block`).
  Both optional/nullable = "no limit".
- **Scope (recommended):** **per-workspace** first (matches RLS + the existing aggregate). Per-user /
  per-account is a later refinement (open question §8).
- **Local/unknown models:** `est_cost_micro_usd` is `null` for models not in the pricing table
  (`ai-usage.ts:69-79`), so they contribute **0** to a cost budget. Recommendation: for a v1 cost
  budget, **ignore** null-cost calls (they cannot exceed a USD budget), and add a **separate
  tokens-only** ceiling later for shops running local KI (where cost is 0 but tokens/latency are real).
  Document this so operators of local models understand a cost gate won't fire for them.

## 3. Gate placement — pre-call guard vs. workflow node

Two options:
1. **Always-on pre-call guard** inside `runTrackedChatCompletion` (what the prototype does). Covers
   every node routed through it uniformly; author cannot forget to add it; cannot be bypassed by
   workflow authors.
2. **Author-placed workflow node** (like `logic.threshold`, server catalog in
   `workflow-execution.ts`, desktop reg `electron/workflow/nodes/logic-nodes.ts:89-118`). Flexible per
   flow, but opt-in — an author who omits it spends freely; it also can't protect the non-workflow
   `ai.reply_suggestion` path.

**Recommendation: the always-on pre-call guard** for the hard cost ceiling (an operator/account
protection is not something a workflow author should be able to skip). A `logic.threshold`-style node
remains useful for *author-level* routing ("don't call the expensive model if this-month spend > X")
but is a **complement**, not the enforcement point. **Productionization note:** today the guard is
duplicated at two call sites (`runTrackedChatCompletion` and `ai-reply-suggestion.ts`). A third AI
call site would silently bypass it. The follow-up should factor a single shared
`trackedChatCompletion(input)` helper that does **budget-check + usage-record in one place**, and route
BOTH paths through it, so the "all AI calls go through one gate" invariant is enforced by structure.

## 4. Fail-open vs. fail-closed

The prototype **fails OPEN**: if the spend read throws (DB down, etc.), `evaluateAiBudgetSafe` returns
`allow`. This matches the codebase principle that *tracking must never break the AI flow*
(`ai-usage.ts:3-4`, `recordAiUsageSafe` swallows errors).

- **Fail-open risk:** during a DB outage the hard cap is not enforced → possible cost overrun exactly
  when you can't observe it.
- **Fail-closed alternative (hard limit only):** treat a read error as `block`. Safer for cost, but a
  transient DB blip halts all AI support — a worse operator experience for a *support* product.

**Recommendation:** keep **soft = fail-open** always; make the **hard limit's failure mode
configurable** (default fail-open to preserve current behavior, opt-in fail-closed for cost-sensitive
operators). **Do not hard-code fail-closed in the prototype** — it's a policy decision, surfaced here.

## 5. Where limits are stored

- **Prototype:** env vars `AI_DAILY_SOFT_LIMIT_MICRO_USD` / `AI_DAILY_HARD_LIMIT_MICRO_USD`
  (`readAiBudgetLimitsFromEnv`). Global, unset ⇒ no limits ⇒ complete no-op. Fine for a spike / a
  single-tenant operator, but not per-workspace-configurable.
- **Options for production:** (a) a `workspace_settings`/config row per workspace; (b) a dedicated
  `ai_budget_limits` table (workspace_id, scope, window, soft/hard, fail-mode); (c) reuse an existing
  settings surface. **Recommendation: a dedicated `ai_budget_limits` table** keyed by
  `(workspace_id, scope)` — it maps cleanly to RLS and to future per-user/per-account scoping.
  **Migration implied** (new table, RLS enabled+forced like `0017`) — **NOT written in this spike**
  (out of scope; captured as follow-up).

## 6. Cost surfacing (design only)

Extend the diagnostics "KI-Nutzung & Kosten" section (`diagnostics-panel.tsx:383-412`, `formatUsd`):
- Show **spent vs. limit** for the active window (e.g. `4.20 $ / 10.00 $ (24h)`), with a bar.
- Show **state**: green (allow) / amber (warn, ≥ soft) / red (block, ≥ hard), reusing the same
  soft/hard thresholds so the panel and the gate never disagree.
- Optionally list recent **blocked attempts** (depends on §8's "record blocked attempts" decision).
- **Out of scope here** — no UI code was written; this is the design for the follow-up UI plan.

## 7. Desktop parity (the gap)

The Electron/SQLite edition (`electron/**`) makes AI calls but **records nothing**:
`electron/email/email-openai.ts` (`runChatCompletion`, `:57-62`) **discards** the provider `usage`
object; `electron/workflow/nodes/ai-nodes.ts` calls `runChatCompletion(system, user, profileId)` with
**no usage capture and no recorder** anywhere (grep for `usage`/`recordAiUsage` in that file returns
nothing — only `runChatCompletion` matches). The diagnostics panel even admits it at runtime:
*"Desktop: KI-Nutzungsstatistik kann fehlen, wenn kein Usage-Collector aktiv ist."*
(`diagnostics-panel.tsx:387`). Without tracking, a desktop budget gate has nothing to read.

Three ways to close it:
- **(a) Local mirror** — capture `usage` in `runChatCompletion` and write a SQLite `ai_usage_events`
  equivalent + a SQLite spend loader. *Effort: M. Risk: low (isolated to `electron/`, no server
  change).* Most direct; some duplicated logic.
- **(b) Share via `packages/*`** — extract the pure pieces (`decideAiBudget`, cost estimate, usage
  extraction) into a shared package both editions import; each keeps its own storage adapter.
  *Effort: M–L. Risk: medium (touches build/module boundaries).* Best long-term, avoids drift.
- **(c) Defer** — document the gap; server edition ships gates first. *Effort: 0. Risk: desktop users
  get no cost protection.*

**Recommendation:** **(c) defer for this spike**, then **(b)** for the real build (extract the pure
decision + cost logic to a shared package, adapters per edition). Implementing desktop tracking is a
**follow-up plan**, deliberately NOT done here (it would require touching `electron/**`, out of scope).

## 8. Open questions (undecided)

- **Scope granularity:** per-workspace (prototype) vs. per-user vs. per-account/per-model. Start
  per-workspace; is per-user needed for the "Kostenkontrolle pro **Nutzer**/Monat" request (#7)?
- **Window / day boundary:** rolling 24h (prototype) vs. calendar "daily". If calendar, **whose
  timezone** defines midnight (workspace setting? UTC)?
- **Enforcement timing:** pre-call estimate uses *past* spend only — the in-flight call's cost isn't
  known until after it runs, so a single call can overshoot the hard cap. Acceptable, or reserve an
  estimate up front?
- **Streaming usage:** streamed responses may report `usage` only at the end (or not at all). How does
  a pre-call gate + post-call record behave for streaming call sites?
- **Record blocked attempts?** Should a blocked call write an `ai_usage_events` row (0 cost,
  `node_type` + a "blocked" marker) for auditability, or stay invisible? Affects §6 UI and schema.
- **Fail-closed opt-in** for the hard limit (see §4) — default and per-operator override.
- **Local/unknown-model budgets** (see §2) — cost budget ignores them; do we add a tokens-only cap?
- **Multi-tenant env config:** env-var limits are global; production needs per-workspace storage (§5).

## 9. Recommended next plans

1. **Persisted limits + migration** — `ai_budget_limits` table (RLS), replace env config, resolve the
   fail-open-vs-closed default (§4/§5).
2. **Single shared `trackedChatCompletion` helper** — collapse the two duplicated guards into one
   choke point so no future AI call site can bypass the budget (§3).
3. **Budget UI in diagnostics** — spent-vs-limit + warn/block state in the "KI-Nutzung & Kosten"
   section (§6).
4. **Desktop parity** — SQLite usage mirror + gate, ideally via a shared `packages/*` decision module
   (§7 option b).
5. **(optional) per-user/per-account scoping + tokens-only cap for local models** (§2/§8).

---

## Prototype proof

`packages/server/src/ai-budget.ts` implements the pure decision (`decideAiBudget`), the reused
rolling-window spend loader (`loadWorkspaceSpendMicroUsd`, same `sum(est_cost_micro_usd)` +
`created_at >= since` shape as diagnostics), env-config (`readAiBudgetLimitsFromEnv`), and the
fail-open orchestrator (`evaluateAiBudgetSafe`, short-circuits to `allow` with no DB read when no
limits are set). `tests/unit/ai-budget.test.ts` exercises the allow/warn/block boundaries, null-limit
passthrough, env parsing, the no-limit short-circuit (db that throws if touched), the fail-open path,
and a block on loaded spend. The gate is wired **default-off** at both server AI entry points
(`runTrackedChatCompletion` in `ai-classification.ts`; the `chatCompletion` call in
`ai-reply-suggestion.ts`): with no `AI_DAILY_*_LIMIT_MICRO_USD` env set, `readAiBudgetLimitsFromEnv`
returns `{ null, null }` and the guard is skipped entirely — production behavior is unchanged.
