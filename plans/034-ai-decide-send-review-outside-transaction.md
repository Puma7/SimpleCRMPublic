# Plan 034: Call the AI model of the send preview with no database transaction open

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update this plan's row in
> `plans/README.md` (section "Runde 2") AND tick its checkbox in
> `plans/MASTERPLAN.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 9e0491e3..HEAD -- packages/server/src/mail-compose-send.ts packages/server/src/workflow-execution.ts tests/unit/server-edition-foundation.test.ts tests/integration/postgres-workflow-ai-decide.test.ts tests/integration/postgres-workflow-loop-guards.test.ts`
> Plan 024 does not touch these files; any diff here means drift. Compare the
> "Current state" excerpts against the live code; on a mismatch, STOP.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED (fail-closed send path)
- **Depends on**: plans/024-ai-decide-chat-parser-linear-and-fractions.md (same `ai.decide` path; land it first)
- **Category**: perf
- **Planned at**: commit `9e0491e3`, 2026-09-27

Audit claim verified by the planner (correct). Refinement: the connection pinning has
**two** layers — the review transaction in `mail-compose-send.ts` AND the dry-run's own
transaction in `workflow-execution.ts`. The validation port
(`createPostgresEmailOutboundValidationPort`, `mail-compose-send.ts:774-878`) has no outer
transaction but still suffers from the inner one. The fix must address both layers.

## Why this matters

Server edition only. When a user (or scheduled send) sends a draft and outbound workflows
exist, `review()` opens a transaction and, inside it, runs a dry-run of up to 50 outbound
workflows; each dry-run opens a second transaction and, for `ai.decide` / `ai.outbound_review`
/ `ai.review` nodes in the send preview, makes a real HTTP call to the AI provider (Decisions
API timeout 30 s, chat models up to 90 s via `OPENAI_CHAT_TIMEOUT_MS`). So every send holds **two pooled
Postgres connections idle-in-transaction for up to 30 s (chat: 90 s) per AI node**. The pool has 10
connections by default (`packages/server/src/db/postgres.ts:22`, `max: options.maxConnections ?? 10`);
a handful of concurrent sends starve the API and the job worker. After this plan, no
transaction is open while a model is called; results and fail-closed behaviour stay identical.

## Current state

Files:
- `packages/server/src/mail-compose-send.ts` (2 756 lines) — compose send; `createPostgresComposeOutboundReviewPort` at 880–1105, `evaluateComposeOutboundDryRun` at 2016–2090.
- `packages/server/src/workflow-execution.ts` (8 832 lines) — server workflow engine; `dryRun` at 1122–1182, runtime ports 398–407 and 487–511, `executePreviewAiDecide` 2098–2135, `executePreviewOutboundAiReview` 2137–2201, dispatch 2340–2364.
- `packages/server/src/workflow-ai-decide.ts` — `runServerAiDecision` (210–285): never throws; opens only short transactions of its own (profile lookup, usage) around the network call. Not modified.
- `packages/server/src/ai-classification.ts:595-660` — `createAiReviewPreviewRunner`: same pattern, never throws. Not modified.

Review today — ONE transaction around everything (`mail-compose-send.ts:887-889`, `:945-1012`, `:1095-1102`):
```ts
    async review(input) {
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          const now = options.now?.() ?? new Date();
          // Approval-Bypass … (lines 891-943: may return { allowed: true } or delete a stale marker)
          const workflows = await trx
            .selectFrom('email_workflows')
            .select(['id', 'source_sqlite_id', 'name', 'priority'])
            …
          if (workflows.length === 0) { …update outbound_hold=false…; return { allowed: true }; }
          const draft = await trx
            .selectFrom('email_messages')
            .select(['id', 'source_sqlite_id', 'body_text', 'body_html'])
            … .executeTakeFirst();
          if (!draft) return { allowed: false, error: 'Entwurf nicht gefunden' };

          if (options.workflowDryRun) {
            const dryRun = await evaluateComposeOutboundDryRun({ …, workflows });
            if (!dryRun.allowed) {
              const reason = await persistOutboundBlockOnDraft(trx, {
                workspaceId: input.workspaceId,
                messageId: input.draftMessageId,
                reason: dryRun.reason,
                now,
              });
              return { allowed: false, error: reason, held: true };
            }
          }
          // lines 1014-1094: banner into body, outbound_hold=true, insert one
          // email_workflow_runs row + one job_queue 'workflow.execute' per workflow
          return { allowed: false, error: OUTBOUND_REVIEW_REASON, workflowRunId: firstRunId };
        },
        { applySession: options.applyWorkspaceSession },
      );
```

Dry-run — second transaction around the whole graph walk (`workflow-execution.ts:1122-1126`, `:1163-1172`):
```ts
    async dryRun(input) {
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          const now = options.now?.() ?? new Date();
          const prepared = await prepareWorkflowRun(trx, input);
          …
          const result = await runServerWorkflowGraph(trx, { …, dryRun: true, ports: runtimePorts });
```
AI calls inside the walk (`workflow-execution.ts:2340-2345`, `:2161`):
```ts
  if (type === 'ai.decide') {
    if (dryRun && context.previewOutbound) {
      return await executePreviewAiDecide(ports, context, config);   // → runServerAiDecision(ports.aiDecide, {...}) at 2108
    }
  …
  const preview = await ports.aiReviewPreview({ … });                // in executePreviewOutboundAiReview
```
The graph walk (`runServerWorkflowGraph` 1618, `walkGraph` 1744, `executeServerNode`) contains **no try/catch**
(verified: every `catch` in the file is in small helpers — lines 466, 5582–5611, 5922, 7938, 8084, 8336–8426),
so an exception thrown from a node propagates out of the transaction callback, Kysely rolls back, and the error is rethrown.
The next node taken depends on the AI answer, so AI calls cannot simply be hoisted before the walk.

Fail-closed semantics to preserve: dry-run `success:false`, `blocked`, or `status:'error'` ⇒ `evaluateComposeOutboundDryRun`
returns `allowed:false` ⇒ `persistOutboundBlockOnDraft` holds the draft and `review` returns `{ allowed:false, error, held:true }`.
An AI timeout/network error becomes an `ai.decide` outcome `error` ⇒ block reason
`AI_DECIDE_OUTBOUND_ERROR_REASON` = „KI-Fehler bei der Versandentscheidung – bitte E-Mail prüfen.“ (packages/core/src/workflow/ai-decide.ts:32-33).

Existing tests covering this: `tests/unit/server-edition-foundation.test.ts` — review-port tests at ~14850 (approval bypass),
~14935 (stale marker), ~14990 (fingerprint mismatch), ~16007 (`holds the draft on a dry-run block without queuing async review`);
they use the fake `makeWorkflowExecutionDb` (defined ~46597; its `transaction()` at ~46741 just calls `operation(db)`).
`tests/integration/postgres-workflow-ai-decide.test.ts:515` (`Versandvorschau entscheidet synchron und echt…`, mocks `guardedAiPost`).
`tests/integration/postgres-workflow-loop-guards.test.ts:168-229` (`previewPort` counts `aiReviewPreview` calls; expects `≤ 250` and `toBe(1)`).

## Design (chosen: two layers, minimal)

1. **Review split** (`mail-compose-send.ts`): Tx A = approval bypass + load workflows + draft existence (unchanged logic);
   then the dry-run with **no** transaction open; then Tx B = hold/enqueue writes, re-reading the draft row.
2. **Dry-run replay** (`workflow-execution.ts`): the dry-run walk runs in a short transaction; the first time it reaches a
   preview AI call whose answer is not yet known, it records the request and aborts the pass (sentinel exception → rollback;
   the dry-run writes nothing). The AI call is then made with no transaction open, its result memoised by request, and the
   walk restarts in a fresh short transaction, replaying known answers. Passes = distinct AI requests + 1, capped at
   `MAX_PREVIEW_AI_CALLS_PER_DRY_RUN = 25` (exceeding ⇒ dry-run failure ⇒ mail held: fail-closed).
   Side effect (accepted, document it): identical AI requests inside one dry-run are asked once.

Rejected: a pre-pass that collects AI nodes before the walk (branching depends on answers and interpolated variables);
running the walk without a transaction (RLS session settings are transaction-local).

## Commands you will need

Prefix every command with `export PATH=/opt/node24/bin:$PATH;`.

| Purpose | Command | Expected |
|---|---|---|
| Install | `pnpm install` | exit 0 |
| Build packages (before Postgres tests) | `pnpm run build:packages` | exit 0 |
| Focused unit | `pnpm exec jest tests/unit/server-edition-foundation.test.ts -t "reviewOutbound"` | all pass |
| Postgres tests (not as root) | `chmod -R a+rwX .tmp-tests tests packages/core/dist packages/server/dist` then `su tester -s /bin/bash -c "export PATH=/opt/node24/bin:\$PATH; cd /home/user/SimpleCRMPublic && node_modules/.bin/jest --cacheDirectory /tmp/jest-tester --forceExit tests/integration/postgres-workflow-ai-decide.test.ts tests/integration/postgres-workflow-loop-guards.test.ts"` | all pass |
| Typecheck | `pnpm run typecheck` | exit 0 |
| Lint | `pnpm run lint` | exit 0, 0 warnings |
| Unit / integration | `pnpm run test:unit` / `pnpm run test:integration` | all pass |
| Server coverage ratchet | `pnpm run test:server:coverage && node scripts/check-server-coverage-ratchet.mjs` | pass |

(If you are not root, run the jest command directly. Postgres test files must keep their `jest.mock('kysely', …)` line.)

## Scope

**In scope**:
- `packages/server/src/mail-compose-send.ts` (only `createPostgresComposeOutboundReviewPort`)
- `packages/server/src/workflow-execution.ts` (only `dryRun`, `ServerWorkflowRuntimePorts`, `executePreviewAiDecide`, `executePreviewOutboundAiReview`, plus the new memo helpers)
- `tests/unit/server-edition-foundation.test.ts`, `tests/integration/postgres-workflow-ai-decide.test.ts`, `tests/integration/postgres-workflow-loop-guards.test.ts`
- `CHANGELOG.md`

**Out of scope**:
- `execute()` (the real, non-dry run) and `scheduleAiDecideJob` — async jobs already call the model outside the run transaction.
- `createPostgresEmailOutboundValidationPort` — no outer transaction; it benefits from layer 2 automatically. Do not restructure it.
- Desktop (`electron/**`) — SQLite, no connection pool; not affected.
- `MAX_OUTBOUND_WORKFLOWS_PER_SEND`, timeouts, the approval-marker/fingerprint logic.

## Git workflow

- Branch: `advisor/034-send-review-ai-outside-transaction`
- Commits in German, e.g. `Versandprüfung: KI-Aufrufe der Vorschau ohne offene Transaktion`.
- Do NOT push or open a PR unless the operator says so.

## Steps

### Step 1: Red test — outer layer (unit)

In `tests/unit/server-edition-foundation.test.ts`, after the test `reviewOutbound.review holds the draft on a dry-run block without queuing async review`,
add `test('reviewOutbound.review runs the workflow dry-run with no transaction open', …)`: build rows like that test (workflow 95, draft 85),
then wrap the fake db's `transaction` with a counter:
```ts
let openTransactions = 0;
const baseTransaction = (db as unknown as { transaction: () => { execute: <T>(op: (trx: unknown) => Promise<T>) => Promise<T> } }).transaction;
(db as unknown as { transaction: unknown }).transaction = () => ({
  execute: async <T>(op: (trx: unknown) => Promise<T>) => {
    openTransactions += 1;
    try { return await baseTransaction().execute(op); } finally { openTransactions -= 1; }
  },
});
const seen: number[] = [];
```
Pass `workflowDryRun: async () => { seen.push(openTransactions); return { success: true, dryRun: true as const, blocked: true, blockReason: 'KI blockiert', status: 'blocked' as const }; }`.
Assert `seen` equals `[0]`, result equals `{ allowed: false, error: 'KI blockiert', held: true }`, and the draft row has `outbound_hold: true`, `outbound_block_reason: 'KI blockiert'`.
Add a second variant where the dry-run allows (`blocked: false, status: 'ok'`): `seen` is `[0]`, `expect(result).toMatchObject({ allowed: false, workflowRunId: expect.any(Number) })`, `rows.runs` and `rows.jobs` have length 1.

**Verify**: `pnpm exec jest tests/unit/server-edition-foundation.test.ts -t "no transaction open"` → both FAIL with `seen` = `[1]`.

### Step 2: Red test — inner layer (Postgres)

In `tests/integration/postgres-workflow-ai-decide.test.ts` add a helper inside the `describe`:
```ts
async function openTransactionsNow(): Promise<number> {
  const r = await postgres.admin.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM pg_stat_activity
      WHERE pid <> pg_backend_pid() AND state LIKE 'idle in transaction%'`,
  );
  return r.rows[0]!.n;
}
```
(No `datname` filter: the embedded instance belongs to this test file alone, and the app may use another database than the admin client.)
Add, modelled on `Versandvorschau entscheidet synchron und echt…` (line 515, same `jsonb_set` profile setup, new draft ids 8205–8208):
1. `Versandvorschau: kein offene Transaktion während des Modellaufrufs` — `guardedMock.mockImplementation(async () => { seen.push(await openTransactionsNow()); return decisionsAnswer(0.3); })`; call `dryRun!` as in the existing test; assert `seen` = `[0]` and the same `blocked`/`blockReason` as the existing test.
2. `Senden: Prüfung hält bei „nein“ und bei KI-Fehler an, ohne offene Transaktion` — import `createPostgresComposeOutboundReviewPort` from `'../../packages/server/src/mail-compose-send'`; build `port = createPostgresComposeOutboundReviewPort({ db, workflowDryRun: createPostgresWorkflowExecutionJobPort({ db, secrets }).dryRun! })`; call `port.review({ workspaceId: WORKSPACE_ID, actorUserId: USER_ID, draftMessageId: 8206, subject: 'Ihr Angebot', bodyText: 'Anbei das Angebot.', bodyHtml: null, to: 'kunde@example.com', attachmentCount: 0 })`:
   - with `decisionsAnswer(0.3)` → `{ allowed: false, held: true }` and `error` contains `Ja-Wahrscheinlichkeit 30 %`;
   - with `guardedMock.mockImplementation(async () => { seen.push(await openTransactionsNow()); throw new Error('socket hang up'); })` (draft 8207) → `{ allowed: false, held: true }`, `error` contains `KI-Fehler`, and the draft row has `outbound_hold = true`;
   - with `decisionsAnswer(0.95)` (draft 8208) → `allowed: false`, numeric `workflowRunId`, one `workflow.execute` job (`takeJobs('workflow.execute')` length 1).
   In every case `seen` contains only `0`.

**Verify**: run the Postgres command from the table for `postgres-workflow-ai-decide.test.ts` → the new tests FAIL on `seen` (values 1 or 2); all old tests pass.

### Step 3: Split `review()` into two short transactions

Rewrite `createPostgresComposeOutboundReviewPort.review` (`mail-compose-send.ts:887-1103`):
- `const now = options.now?.() ?? new Date();` before any transaction.
- **Tx A** (`withWorkspaceTransaction`, same context/options): move lines 891–978 in unchanged, but make it return a union:
  `{ done: ComposeOutboundReviewResult } | { done: null; workflows: <selected rows> }`. The early returns become `{ done: { allowed: true } }` / `{ done: { allowed: false, error: 'Entwurf nicht gefunden' } }`. The draft query here may keep selecting the same columns.
- After Tx A: `if (a.done) return a.done;`
- Comment (German): `// Die Vorschau fragt ggf. ein KI-Modell (bis 90 s je Knoten): keine Transaktion offen halten.`
  `const dryRun = options.workflowDryRun ? await evaluateComposeOutboundDryRun({ …same arguments…, workflows: a.workflows }) : { allowed: true as const };`
- **Tx B**: if `!dryRun.allowed` → `persistOutboundBlockOnDraft(trx, …)` and return `{ allowed: false, error: reason, held: true }` exactly as today. Otherwise re-select the draft (same query as today: `id, source_sqlite_id, body_text, body_html`, `uid < 0`, `folder_kind = 'draft'`); if missing return `{ allowed: false, error: 'Entwurf nicht gefunden' }`; then lines 1014–1099 unchanged (banner, update, runs, jobs over `a.workflows`).
Do not catch errors from the dry-run: a throwing dry-run must still reject `review()` (fail-closed, as today).

**Verify**: `pnpm exec jest tests/unit/server-edition-foundation.test.ts -t "reviewOutbound"` → all pass, including Step 1.

### Step 4: Replay memo for preview AI calls in `dryRun`

In `workflow-execution.ts`:
- Add near `ServerWorkflowRuntimePorts`:
```ts
/** Höchstzahl verschiedener KI-Aufrufe je Versandvorschau (danach fail-closed). */
const MAX_PREVIEW_AI_CALLS_PER_DRY_RUN = 25;

/** KI-Antworten der Versandvorschau: Aufrufe laufen zwischen kurzen Transaktionen. */
type PreviewAiMemo = {
  results: Map<string, unknown>;
  pending: { key: string; run: () => Promise<unknown> } | null;
};

class PreviewAiPendingSignal extends Error {}

async function callPreviewAi<T>(
  ports: ServerWorkflowRuntimePorts, kind: string, request: unknown, run: () => Promise<T>,
): Promise<T> {
  const memo = ports.previewAiMemo;
  if (!memo) return run();
  const key = `${kind}\u0000${JSON.stringify(request)}`;
  if (memo.results.has(key)) return structuredClone(memo.results.get(key)) as T;
  memo.pending = { key, run };
  throw new PreviewAiPendingSignal('preview_ai_pending');
}
```
  and add `previewAiMemo?: PreviewAiMemo;` to `ServerWorkflowRuntimePorts`.
- `executePreviewAiDecide`: build the argument object of `runServerAiDecision` into `const request = { … }` (unchanged fields), then
  `const outcome = await callPreviewAi(ports, 'ai.decide', request, () => runServerAiDecision(deps, request));` where `deps` is `ports.aiDecide` after the existing null check.
- `executePreviewOutboundAiReview`: build the `ports.aiReviewPreview` argument into `const request = { … }` (unchanged, including the awaited `buildOutboundReviewUserTemplate`), then
  `const preview = await callPreviewAi(ports, 'ai.review.preview', request, () => runner(request));` with `runner = ports.aiReviewPreview` after its null check.
- `dryRun`: move `const now = options.now?.() ?? new Date();` before the loop, create `const memo: PreviewAiMemo = { results: new Map(), pending: null };`, and loop:
```ts
for (;;) {
  try {
    return await withWorkspaceTransaction(options.db, { workspaceId: input.workspaceId, role: 'system' },
      async (trx) => { /* existing body, using `now` and ports: { ...runtimePorts, previewAiMemo: memo } */ },
      { applySession: options.applyWorkspaceSession });
  } catch (error) {
    if (!(error instanceof PreviewAiPendingSignal) || !memo.pending) throw error;
  }
  const pending = memo.pending;
  memo.pending = null;
  if (memo.results.size >= MAX_PREVIEW_AI_CALLS_PER_DRY_RUN) {
    return dryRunFailure('Versandvorschau: zu viele KI-Aufrufe in einem Workflow', ['error:preview_ai_call_limit']);
  }
  // Keine Transaktion offen: der Modellaufruf darf dauern.
  memo.results.set(pending.key, await pending.run());
}
```
The `execute()` path never sets `previewAiMemo`, so `callPreviewAi` just runs the call there.

**Verify**: Postgres command for `postgres-workflow-ai-decide.test.ts` → all pass, including Step 2; `pnpm run typecheck` → exit 0.

### Step 5: Replay tests (loop guards)

In `tests/integration/postgres-workflow-loop-guards.test.ts` add:
1. `two preview reviews in sequence are each asked once` — graph `trigger → review → review2` (`review2` = copy of `review` with id `review2`, edge `review→review2` label `ok`), `previewPort(0)` (always ok): `result.blocked` false and `preview.calls` = 2.
2. `too many distinct preview AI calls fail closed` — graph `trigger → loopNode('l1', <30 comma-separated items>, 'l1_items') → review` (edge label `each`), `previewPort(0)`: `result.success` false, `result.error` = `'Versandvorschau: zu viele KI-Aufrufe in einem Workflow'`, `preview.calls` = 25. (Each item differs in `loop.item`, which is part of `eventVariables`.)
Existing tests at 168–229 must stay green unchanged.

**Verify**: Postgres command for `postgres-workflow-loop-guards.test.ts` → all pass.

### Step 6: CHANGELOG and full checks

`## [Unreleased]` → `### Fixed`: `- **Server:** Senden mit Ausgangs-Workflows: KI-Entscheidung und KI-Prüfung der Versandvorschau fragen das Modell jetzt ohne offene Datenbank-Transaktion. Vorher hielt jeder Versand dabei bis zu 30 s (Chat-Modelle 90 s) je KI-Knoten zwei Datenbankverbindungen fest; mehrere gleichzeitige Sendungen konnten Server und Hintergrund-Jobs ausbremsen. Gleiche KI-Fragen innerhalb einer Vorschau werden nur einmal gestellt; mehr als 25 verschiedene halten die Mail an.`

**Verify**: `pnpm run typecheck`, `pnpm run lint`, `pnpm run test:unit`, `pnpm run test:integration` (Postgres parts as non-root), server coverage ratchet → all pass.

## Test plan

- Unit (`server-edition-foundation.test.ts`): dry-run sees 0 open transactions; blocked ⇒ held; allowed ⇒ run + job queued.
- Postgres (`postgres-workflow-ai-decide.test.ts`): `pg_stat_activity` shows no `idle in transaction` session during the model call, for `dryRun` directly and through `review()`; „nein“, network error (KI-Fehler) and „ja“ outcomes unchanged.
- Postgres (`postgres-workflow-loop-guards.test.ts`): sequential AI nodes, call cap, existing call-count expectations.

## Done criteria

- [ ] All new tests exist and pass; every pre-existing test in the three files passes unchanged
- [ ] `grep -n "PreviewAiPendingSignal" packages/server/src/workflow-execution.ts` shows the class, the throw, and the catch
- [ ] `pnpm run typecheck`, `pnpm run lint`, `pnpm run test:unit`, `pnpm run test:integration`, server coverage ratchet exit 0
- [ ] `git status` shows only in-scope files modified
- [ ] Row 034 in `plans/README.md` updated and box ticked in `plans/MASTERPLAN.md`

## STOP conditions

- Any path where an AI failure/timeout would now let the mail through (e.g. a test shows `allowed: true` or `held` missing after a thrown/timeout AI call) — this is a fail-closed send path; stop, do not ship.
- A `catch` is found (or added by another plan) between `runServerWorkflowGraph` and the preview AI calls that would swallow `PreviewAiPendingSignal`; re-run `grep -n "catch" packages/server/src/workflow-execution.ts` and compare with the list in "Current state".
- The dry-run turns out to write to the database (any `insertInto`/`updateTable`/`deleteFrom` reached with `dryRun === true`) — then aborting a pass by rollback is no longer side-effect free.
- An existing test asserts a different number of AI calls than the memo produces (other than the documented dedup) or expects the stale approval marker deletion to roll back on a dry-run error.
- `pg_stat_activity` still shows `idle in transaction` during the model call after Step 4 — find the remaining transaction; do not relax the assertion.

## Maintenance notes

- Any new synchronous preview AI node must go through `callPreviewAi`, otherwise it pins a connection again.
- Between Tx A and Tx B the draft is re-read; the decision is made on the send `input` (as before). The approval marker is not re-checked in Tx B — same read-committed race window as before, now slightly longer; the fingerprint check on the next review still catches edits.
- Passes are O(distinct AI calls) full graph walks (each short); the cap keeps this bounded. Plan 043 (split of `workflow-execution.ts`) must move `callPreviewAi`/`PreviewAiMemo` together with the preview AI nodes.
- Reviewers: check that `dryRun` still returns exactly the same result objects as before for workflows without AI nodes (single pass) and that `execute()` is untouched.
