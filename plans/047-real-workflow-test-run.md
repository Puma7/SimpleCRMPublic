# Plan 047: Real workflow test run — pick a mail, test disabled workflows, keep the test run, optionally ask the AI

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update this plan's row in
> `plans/README.md` (section "Runde 2") AND tick its checkbox in
> `plans/MASTERPLAN.md`. Do **Phase A** completely (Steps 1–7) before Phase B
> (Steps 8–9); Phase A alone is a valid stopping point.
>
> **Drift check (run first)**:
> `git diff --stat 9e0491e3..HEAD -- packages/server/src/workflow-execution.ts packages/server/src/api/workflow-routes.ts packages/server/src/api/workflow-runtime-routes.ts packages/server/src/api/types.ts packages/server/src/jobs/production-handlers.ts packages/server/src/db/schema.ts packages/server/src/db/postgres-workflow-runtime-read-ports.ts packages/server/src/db/postgres-email-reporting-port.ts packages/server/src/db/postgres-mail-diagnostics-port.ts packages/server/src/mail-read-receipt-responder.ts packages/server/src/workflow-run-step-append.ts packages/server/src/migrations electron/workflow electron/ipc/workflow.ts electron/database-schema.ts electron/mail-roadmap-migrations.ts electron/email/email-reported-stats.ts electron/email/email-diagnostics.ts src/components/email/workflow/workflow-shell.tsx src/components/email/apply-workflow-menu.tsx src/services/transport/channel-http-registry.ts shared/ipc/email-schemas.ts tests/integration/ipc-contracts.test.ts tests/unit/server-edition-foundation.test.ts`
> On any change, compare the excerpts below with HEAD; mismatch → STOP.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: none. Plan 043 (split `workflow-execution.ts`) must run after this one.
- **Category**: direction (feature)
- **Planned at**: commit `9e0491e3`, 2026-09-27

All audit claims were confirmed at HEAD. Precision: the desktop *already* stores
test runs with steps (as ordinary runs, no flag); only the server discards them.

## Why this matters

"Dry-Run testen" (`workflow-shell.tsx`) needs a hand-typed numeric
"Test-Nachricht-ID", refuses disabled workflows (so you cannot safely try a new
workflow before switching it on), shows only a toast with the last 3 log lines,
and on the server keeps nothing to inspect. `ai.decide` always answers
"unsicher" in a test, so the most important branch cannot be tested. The vision
(`docs/WORKFLOW_VISION.md:323` „Test mit Beispiel-Mail“ / Dry-Run ohne
Seiteneffekte, :357 „Test-Button ‚Workflow mit Nachricht #123‘“) and the guide
(`docs/USER_GUIDE_WORKFLOWS.md:430`: „… Sie sehen das Ergebnis Schritt für
Schritt“) promise more. The invariant that must never break: **a test run has no
side effects** (no mail sent/moved/tagged/marked, no CRM write, no job/continuation).

## Current state

**UI**
- `src/components/email/workflow/workflow-shell.tsx:204` `const [testMessageId, setTestMessageId] = useState("")`;
  :1066-1076 the "Test-Nachricht-ID" `<Input placeholder="aus Details-Panel">`;
  :1077-1114 "Dry-Run testen" calls `IPCChannels.Email.TestWorkflowOnMessage`
  with `{ workflowId: selectedId, messageId: parsedId, dryRun: true }` and toasts
  `Dry-Run OK: ${log.slice(-3)}`. Gates: `canRunWorkflows` (:172),
  `workflowDryRunAvailable` (:176). "Jetzt ausführen" (:1116-1178) reuses the same id field.
- `src/components/email/apply-workflow-menu.tsx:129-139` same dry-run + toast;
  it already owns a `WorkflowRunDetailDialog` (:260-264) for live blocked runs.
- `WorkflowRunDetailDialog({ runId, open, onOpenChange, title? })`
  (`src/components/email/workflow/workflow-run-detail-dialog.tsx:48-53`) loads
  `ListWorkflowRunSteps` + `GetWorkflowRunLog` by the (mapped) run id.

**Desktop**
- IPC `electron/ipc/workflow.ts:58-67`: `TestWorkflowOnMessage` →
  `testWorkflowOnMessage(payload.workflowId, payload.messageId, true)` (dry-run forced;
  guarded by `tests/integration/ipc-contracts.test.ts:305-311` regex
  `/testWorkflowOnMessage\(payload\.workflowId,\s*payload\.messageId,\s*true\)/`).
- `electron/workflow/workflow-executor.ts:120-163` `executeWorkflowNow`:
  `if (wf.enabled !== 1) return { success: false, error: 'Workflow ist deaktiviert' }` (:126),
  then `executeWorkflowForTrigger` which always calls `startWorkflowRun` (:43-47)
  and records steps (runtime `insertWorkflowRunStep`, `electron/workflow/runtime.ts:303, 413`,
  not dry-run-guarded). `testWorkflowOnMessage` (:165-173) returns `{ success, runId, log }`.
- `electron/workflow/run-steps.ts:9-22` `startWorkflowRun({ workflowId, messageId, direction })`
  inserts `(workflow_id, message_id, direction, status, log_json, started_at, finished_at)`.
  Table DDL `electron/database-schema.ts:924-936` (`createEmailWorkflowRunsTable`).
  Column migrations use `addCol(conn, TABLE, 'col', 'ALTER TABLE … ADD COLUMN …')`
  in `electron/mail-roadmap-migrations.ts:46-56, 149+` (`runMailRoadmapMigrations`).
- Desktop outbound preview also runs dry (`electron/email/email-workflow-engine.ts:540`,
  `previewOutbound: dryRun`) and therefore also stores runs today.
- Metrics reading runs: `electron/email/email-reported-stats.ts:93-104`
  (`workflowRuns24h`), `electron/email/email-diagnostics.ts:118-131`
  (24h counts), `run-steps.ts:108-129` (`getLatestWorkflowRunForMessage`, used by
  the outbound-hold banner). Detail retention: `pruneWorkflowRunStepDetails`
  (`run-steps.ts:95-105`, 30 days, `WORKFLOW_STEP_DETAIL_RETENTION_DAYS`).
- `ai.decide` desktop: `electron/workflow/nodes/ai-nodes.ts:562`
  `if (ctx.dryRun && !ctx.previewOutbound) return finish(aiDecideDryRunOutcome());`
  — `finish` never sets the hold when `ctx.dryRun` (:551-557). Context flags:
  `electron/workflow/context.ts:89,143`, `electron/workflow/types.ts:18`.

**Server**
- Route `packages/server/src/api/workflow-routes.ts:542-605` `handleWorkflowExecute`:
  body fields only `messageId`, `dryRun` (`parseWorkflowExecuteBody` :2154-2191,
  unknown fields → 400); `dryRun` defaults to **true**; requires `workflows.run`
  and mail read for `messageId`; dry-run calls
  `ports.workflowExecution.dryRun({ workspaceId, workflowId, messageId?, triggerName, actorUserId, context })`.
  The compose outbound validation also calls `dryRun` with `context.previewOutbound: true`
  (`packages/server/src/mail-compose-send.ts:2037-2060`) — that path must NOT store runs.
- `packages/server/src/workflow-execution.ts:1122-1186` `dryRun(input)`: one
  `withWorkspaceTransaction` (system role); disabled →
  `{ success: true, dryRun: true, …, status: 'ok', log: ['skip:workflow_disabled'] }` (:1136-1147);
  context built with `runId: 0, runSourceSqliteId: 0` (:1152-1153); returns no `runId`.
  Result type `packages/server/src/jobs/production-handlers.ts:114-124`.
- Step recording is skipped in dry-run by guards at :1681 (`input.dryRun !== true`),
  :1796, :1822, :1912 (`!input.dryRun`) around `insertRunStep` (:7707-7740,
  writes `run_id: context.runId`, `run_source_sqlite_id: context.runSourceSqliteId`).
  :1974 persists an outbound block only when `!input.dryRun` — keep that.
- Run rows: `startOrReuseRun` (:1507-1585) inserts and sets `source_sqlite_id = -id`;
  `finishExistingRun` (:1587-1610). Schema type `packages/server/src/db/schema.ts:1285-1296`.
- `ai.decide` (:2340-2351):
  ```ts
  if (dryRun && context.previewOutbound) return await executePreviewAiDecide(ports, context, config);
  if (dryRun) { log.push('dry_run:ai.decide'); return aiDecideNodeResult(context, aiDecideDryRunOutcome()); }
  return await scheduleAiDecideJob(trx, doc, context, node, config, now);
  ```
  `executePreviewAiDecide` (:2098-2133) calls the model synchronously; no job, no
  continuation, no DB write except AI usage accounting. Loop guard
  `previewRunsReviewSynchronously` (:1889-1891). Core dry outcome:
  `packages/core/src/workflow/ai-decide.ts:151-160` (`answer: 'unsicher'`).
- Side-effect suppression in dry-run (server): `dryRunMutatingNodeResult`
  (:2903-3036) simulates `ai.reply_suggestion, ai.outbound_review, ai.review, ai.classify,
  ai.transform_text, ai.agent, ai.pick_canned, email.tag, email.set_category,
  email.tag_attachment_meta, email.create_draft, email.set_priority, email.mark_seen,
  email.archive, email.set_spam_status, email.mark_spam, email.move_imap,
  email.delete_server, email.assign, crm.create_task, crm.log_activity,
  crm.update_deal, crm.link_customer, sync.run, email.forward_copy,
  email.ingest_dmarc_report, http.request, workflow.subflow, returns.offer_*`;
  own branches for `logic.delay` (:2283), `email.release_outbound` (:2494),
  `email.send_draft` (:2519), `ai.learnings_digest` (pre-check only). Anything
  else not in `DRY_RUN_LIVE_NODE_TYPES` (:2870-2893) fails closed
  (`dryRunFailClosedResult`). Live even in dry-run (read-only by design):
  read-only/logic types, `mssql.query`, `jtl.order_context`, `ai.spam_score`,
  `ai.agent_tool`, `email.auto_reply`, `email.hold_outbound`. Desktop suppresses
  with `if (ctx.dryRun)` in `electron/workflow/nodes/{email,crm,integration,code,workflow,learnings}-nodes.ts`.
- Queries that must ignore test runs: `packages/server/src/db/postgres-email-reporting-port.ts:227-260`
  (`workflowRuns24h`), `packages/server/src/db/postgres-mail-diagnostics-port.ts:267-285`,
  `workflow-execution.ts:6221-6228` (other open outbound runs),
  `packages/server/src/mail-read-receipt-responder.ts:521-530, 659-667`
  (review rounds). The run list API (`postgres-workflow-runtime-read-ports.ts`,
  `sanitizeWorkflowRun` in `workflow-runtime-routes.ts:1865-1880`) keeps them but
  must expose the flag. GDPR export keeps them.
- Retention: `pruneWorkflowRunStepDetails` (`packages/server/src/workflow-run-step-append.ts:83-117`),
  called daily in `packages/server/src/jobs/maintenance-handlers.ts:346-354`.
  `email_workflow_run_steps.run_id … REFERENCES email_workflow_runs(id) ON DELETE CASCADE`
  (`packages/server/src/migrations/0008_workflow_security_schema.ts:137`).
- Latest migration: `0060_workflow_run_step_detail_retention_index` (pattern file
  `packages/server/src/migrations/0060_…ts`, registered at the end of
  `serverMigrations` in `migrations/index.ts`, asserted in
  `tests/unit/server-edition-foundation.test.ts:399`).
- Pickable mails: `IPCChannels.Email.ListMessagesByView` with
  `{ accountId: 'all' | id, view: 'inbox' | 'drafts' | 'sent' | …, limit }`
  (`shared/ipc/email-schemas.ts:529-541`).

## Commands you will need

Prefix every command with `export PATH=/opt/node24/bin:$PATH;`.

| Purpose | Command | Expected |
|---|---|---|
| Install | `pnpm install` | exit 0 |
| Build packages | `pnpm run build:packages` | exit 0 |
| Typecheck (all) | `pnpm run typecheck` | exit 0 |
| Lint | `pnpm run lint` | exit 0, 0 warnings |
| Focused test | `pnpm exec jest <file>` | all pass |
| Unit / integration | `pnpm run test:unit` / `pnpm run test:integration` | all pass |
| Mail suite | `pnpm run test:mail` | all pass |
| Server coverage | `pnpm run test:server:coverage && node scripts/check-server-coverage-ratchet.mjs` | pass |
| UI coverage | `pnpm run test:ui:coverage:check` | pass |

Postgres tests (`tests/integration/postgres-*.test.ts`) refuse to run as root:
`chmod -R a+rwX .tmp-tests tests packages/core/dist packages/server/dist` then
`su tester -s /bin/bash -c "export PATH=/opt/node24/bin:\$PATH; cd /home/user/SimpleCRMPublic && node_modules/.bin/jest --cacheDirectory /tmp/jest-tester --forceExit <file>"`.
Keep `jest.mock('kysely', () => jest.requireActual('../../packages/server/node_modules/kysely'))`.

## Scope

**In scope**: every file in the drift-check list, plus new
`packages/server/src/migrations/0061_workflow_run_dry_run_flag.ts`,
`src/components/email/workflow/workflow-test-message-picker.tsx`,
`tests/integration/postgres-workflow-test-run.test.ts`,
`tests/integration/sqlite-workflow-test-run.test.ts`,
`tests/unit/workflow-test-message-picker.test.tsx`, `CHANGELOG.md`,
`docs/USER_GUIDE_WORKFLOWS.md`.

**Out of scope**: changing which nodes run live in dry-run
(`DRY_RUN_LIVE_NODE_TYPES`, `dryRunMutatingNodeResult`, desktop `if (ctx.dryRun)`
guards); "Jetzt ausführen" semantics; `ai.outbound_review`/`ai.review` real-AI
testing; the compose outbound preview.

## Git workflow

Branch `advisor/047-real-workflow-test-run`. German commits per phase, e.g.
`Workflow-Test: Mail auswählen, deaktivierte Workflows testen, Testlauf speichern`
and `Workflow-Test: KI-Entscheidung auf Wunsch echt fragen`. Do not push.

## Steps — Phase A

### Step 1: Regression tests first (fail today)

- `tests/integration/sqlite-workflow-test-run.test.ts` (pattern
  `tests/integration/sqlite-workflow-run-step-detail.test.ts`): a **disabled**
  workflow with an `email.tag` node behind a condition; `testWorkflowOnMessage(id, msg, true)`
  → expect `success: true`, a `runId`, the run row has `dry_run = 1`, steps exist,
  **no row** in `email_message_tags` for the message, and
  `getLatestWorkflowRunForMessage(msg)` → `null`.
- `tests/integration/postgres-workflow-test-run.test.ts` (pattern
  `postgres-workflow-ai-decide.test.ts:515-545`, incl. `takeJobs`): a disabled
  inbound workflow with `ai.decide` → `email.tag`/`email.archive`; call
  `dryRun!({ …, testRun: true })` → `runId` returned (negative source id),
  `email_workflow_runs.dry_run = true`, steps stored, message tags/archive
  unchanged, `takeJobs('ai.decide')` and `takeJobs('workflow.execute')` empty;
  a second call with `context.previewOutbound: true` and no `testRun` stores **no** run.

**Verify**: both files fail (missing column / `runId` undefined / disabled).

### Step 2: Schema — `dry_run` flag on both editions

- Server migration `0061_workflow_run_dry_run_flag`:
  `ALTER TABLE email_workflow_runs ADD COLUMN IF NOT EXISTS dry_run boolean NOT NULL DEFAULT false;`
  plus a partial index `ON email_workflow_runs (workspace_id, started_at) WHERE dry_run`;
  down drops both. Register in `migrations/index.ts`; append the id to the list in
  `tests/unit/server-edition-foundation.test.ts:399`; add `dry_run: Generated<boolean>`
  to `EmailWorkflowRunsTable`.
- Desktop: add `dry_run INTEGER NOT NULL DEFAULT 0` to `createEmailWorkflowRunsTable`
  and `addCol(conn, EMAIL_WORKFLOW_RUNS_TABLE, 'dry_run', …)` in `runMailRoadmapMigrations`.

**Verify**: `pnpm run build:packages` → exit 0;
`pnpm exec jest tests/unit/server-edition-foundation.test.ts -t migration` → pass.

### Step 3: Desktop — store flagged test runs, allow disabled workflows

- `startWorkflowRun` gets `dryRun?: boolean` → writes `dry_run`.
  `executeWorkflowForTrigger` passes `dryRun: input.dryRun === true`.
- `executeWorkflowNow`: keep the disabled refusal for live runs only:
  `if (wf.enabled !== 1 && !dryRun) return { success: false, error: 'Workflow ist deaktiviert' }`.
- Exclude `dry_run = 1` in `getLatestWorkflowRunForMessage`, `email-reported-stats.ts`
  (`workflowRuns24h`) and `email-diagnostics.ts` counts; `listRecentWorkflowRuns`
  returns `dry_run`.
- Retention: in `pruneWorkflowRunStepDetails` also
  `DELETE FROM email_workflow_runs WHERE dry_run = 1 AND started_at < cutoff`
  (steps cascade — verify the FK in `createEmailWorkflowRunStepsTable`).

**Verify**: `pnpm exec jest tests/integration/sqlite-workflow-test-run.test.ts` → pass; `pnpm run test:mail` → pass.

### Step 4: Server — stored test run in `dryRun`

- `WorkflowExecutionJobPlan` gets `testRun?: boolean`; `WorkflowExecutionDryRunResult` gets `runId?: number`.
- In `dryRun(input)`: if `input.testRun === true` (and never when
  `jobContext.previewOutbound`), skip the disabled early return, create the run via
  `startOrReuseRun` extended with `dryRun: true` (writes `dry_run: true`), build the
  context with the real `runId`/`runSourceSqliteId`, pass a new
  `recordSteps: true` to `runServerWorkflowGraph`/`walkGraph`, finish the run with
  the result status in the same transaction, return `runId: sourceSqliteId`.
  Without `testRun` behavior is byte-identical (disabled early return stays — the
  source guard `tests/unit/workflow-codex-review-regressions.test.ts:99-100` must pass).
- Replace the four step guards (:1681, :1796, :1822, :1912) with
  `if (!input.dryRun || input.recordSteps)`; do **not** touch :1974 or any other
  `dryRun` check.
- Filter `dry_run = false` in the reporting, diagnostics, peer-run (:6221) and
  read-receipt queries listed above. Add `dryRun: boolean` to `WorkflowRunRecord`,
  the runtime read port mapping and `sanitizeWorkflowRun`.
- Retention: in `pruneWorkflowRunStepDetails` delete `dry_run` runs older than
  the cutoff in the same batched style (steps cascade).

**Verify**: build packages; Postgres test from Step 1 → pass; server coverage ratchet → pass.

### Step 5: Route + transport

- `parseWorkflowExecuteBody`: allow `testRun` (boolean); `handleWorkflowExecute`
  passes `testRun: true` to `dryRun` only when `dryRun && testRun`. Add a unit test
  in `server-edition-foundation.test.ts` next to the existing execute tests
  (search `workflow_dry_run_unavailable`): `testRun` is forwarded; `testRun`
  with `dryRun:false` is ignored.
- `channel-http-registry.ts:3462-3473` (`TestWorkflowOnMessage`): send
  `testRun: true`. Map `dry_run` in `mapWorkflowRunRecord`.
- Desktop IPC keeps forcing dry-run; schema `TestWorkflowOnMessage` result gains `runId`.

**Verify**: `pnpm exec jest tests/unit/server-edition-foundation.test.ts tests/unit/renderer-transport.test.ts tests/integration/ipc-contracts.test.ts` → pass.

### Step 6: UI — mail picker, result dialog

- New `workflow-test-message-picker.tsx`: `Select`/list of the 20 newest mails via
  `ListMessagesByView` (`accountId`: the workflow's account or `'all'`; `view`:
  `inbox` for inbound/relay, `drafts` for outbound/draft_created), label
  `Betreff · Absender · Datum`, plus a fallback "Nachrichten-ID" input. Emits `messageId`.
- `workflow-shell.tsx`: replace the ID input (:1066-1076) with the picker (both
  buttons use its value). "Testlauf" button (rename from "Dry-Run testen", title:
  „Simuliert den Workflow mit dieser Mail – nichts wird gesendet, getaggt oder verschoben“)
  stays enabled for disabled workflows; on success open `WorkflowRunDetailDialog`
  with `r.runId` and title `Testlauf – <Workflow-Name>`; toast only on error.
- `apply-workflow-menu.tsx:129-139`: open the existing dialog with `r.runId`
  instead of the toast when present.
- Label `dry_run` runs „Test“ in `workflow-run-history.tsx`.
- `tests/unit/workflow-test-message-picker.test.tsx` (pattern `tests/unit/outbound-hold-banner.test.tsx`).

**Verify**: typecheck, lint, UI coverage ratchet → pass.

### Step 7: Docs, CHANGELOG, full gates (end of Phase A)

Update `docs/USER_GUIDE_WORKFLOWS.md:430` ("Gefahrlos testen") and CHANGELOG
`### Added` (`**Beide Editionen:**` Testlauf mit Mail-Auswahl, auch für
deaktivierte Workflows, Ergebnis Schritt für Schritt; Testläufe zählen nicht in
Statistiken und werden nach 30 Tagen gelöscht). Run all gates in the table.

## Steps — Phase B (real AI, opt-in)

### Step 8: `realAi` through both runtimes

- Server: `testRealAi` in the dry-run context (from a new body/plan field
  `realAi`, honored only together with `testRun`); in `ai.decide` use
  `if (dryRun && (context.previewOutbound || context.testRealAi)) return await executePreviewAiDecide(…)`;
  extend `previewRunsReviewSynchronously` for `ai.decide` only. Postgres test: with
  `realAi` the mocked `guardedAiPost` is called once, the chosen port follows the
  answer, still no jobs/tags; without it, `dry_run:ai.decide` as today.
- Desktop: `testRealAi` on context (`context.ts`, `types.ts`, runtime input,
  `executeWorkflowNow`, `testWorkflowOnMessage(workflowId, messageId, true, { realAi })`);
  `ai-nodes.ts:562` → `if (ctx.dryRun && !ctx.previewOutbound && !ctx.testRealAi)`.
  Update the regex in `ipc-contracts.test.ts:310` to also accept a trailing
  options argument (`true(?:,\s*\{[^}]*\})?\)`), keeping the other two assertions.
- Transport + IPC schema: pass `realAi`.

### Step 9: Toggle

Checkbox „KI wirklich fragen“ next to the Testlauf button, default off, with the
note „Kostet KI-Tokens; es wird trotzdem nichts gesendet oder verändert.“ Only
shown when the graph contains an `ai.decide` node. CHANGELOG line; guide sentence.

## Test plan

New: `sqlite-workflow-test-run.test.ts`, `postgres-workflow-test-run.test.ts`
(both incl. "no side effects" assertions), `workflow-test-message-picker.test.tsx`,
route unit test; extended transport and contract tests. Phase B adds the real-AI
cases.

## Done criteria

- [ ] All gates in the Commands table pass (Postgres tests as non-root)
- [ ] `grep -n "0061_workflow_run_dry_run_flag" packages/server/src/migrations/index.ts tests/unit/server-edition-foundation.test.ts` → both match
- [ ] `grep -n "Test-Nachricht-ID" src/components/email/workflow/workflow-shell.tsx` → nothing
- [ ] Test runs absent from `workflowRuns24h` (asserted in the new tests)
- [ ] Row in `plans/README.md` (Runde 2) updated, checkbox in `plans/MASTERPLAN.md` ticked

## STOP conditions

- Any test run changes mail/CRM state, queues a job (`ai.*`, `workflow.execute`,
  delays, continuations), sends or holds a draft — even in a corner case. Never
  "fix" by allow-listing; report.
- Recording steps requires changing a `dryRun` check other than the four step
  guards (e.g. :1974 outbound block, node simulations).
- The compose outbound preview (`mail-compose-send.ts`) starts storing runs.
- `startOrReuseRun`'s reuse path (`requestedRunId`) would be hit by a test run.
- The codex source guards (`workflow-codex-review-regressions.test.ts:99-100`)
  or the contract regex can only pass by weakening what they protect.
- Phase B: `executePreviewAiDecide` turns out to write anything besides AI usage.

## Maintenance notes

- New side-effect nodes must keep going through `dryRunMutatingNodeResult`
  (server) / `if (ctx.dryRun)` (desktop); test runs rely on that.
- Plan 046 should label `dry_run` runs „Test“; plan 043 moves this code later.
- Open product question (not changed here): `mssql.query`/`jtl.order_context`
  read the live ERP in tests (documented in the guide).
