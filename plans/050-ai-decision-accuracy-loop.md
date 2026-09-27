# Plan 050: Measure how often KI-Entscheidungen are overruled and suggest a threshold

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. Phase 0 ends with a maintainer review gate (Step 1).
> When done, update this plan's row in `plans/README.md` (section "Runde 2")
> AND tick its checkbox in `plans/MASTERPLAN.md` — unless a reviewer dispatched
> you and told you they maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 9e0491e3..HEAD -- packages/core/src/workflow/ai-decide.ts packages/core/src/workflow/schema/ai.ts packages/core/src/workflow/templates-partial-automation.ts packages/server/src/workflow-ai-decide.ts packages/server/src/db/postgres-mail-read-ports.ts packages/server/src/mail-sent-provenance.ts packages/server/src/jobs/maintenance-handlers.ts packages/server/src/migrations/index.ts packages/server/src/db/schema.ts electron/workflow/nodes/ai-nodes.ts electron/email/email-store.ts electron/email/email-sent-provenance.ts electron/email/email-imap-services.ts electron/ipc/email.ts electron/database-schema.ts electron/sqlite-service.ts src/components/email/workflow/node-properties-panel.tsx src/components/email/workflow/workflow-shell.tsx`
> Plans 024 and 034 (same round) rewrite parts of the ai.decide path; re-read `workflow-ai-decide.ts` and `ai-nodes.ts` before Step 4.

## Status

- **Priority**: P3
- **Effort**: L
- **Risk**: LOW–MED (new table in both editions, hooks in spam-status and send paths)
- **Depends on**: `plans/046-*.md` (per-mail automation history in the reader) and `plans/049-automation-cockpit.md` — both must be **DONE**
- **Category**: direction — design/spike (Phase 0) + build (Phases 1–3)
- **Planned at**: commit `9e0491e3`, 2026-09-27

## Why this matters

The KI-Entscheidung (`ai.decide`) routes mail on a hand-set threshold (50–99 %, default 80). Nobody learns whether the model was right: when a human moves an AI-"Spam" mail back to the inbox, or answers a mail the AI said needs no human, that signal is dropped. The outcome lives only in a run step (whose details are cleared after 30 days) and in `ai_usage_events` (cost only). "Kalibrierung der Confidence" is still open (`docs/KI_SUPPORT_IMPLEMENTATION_PLAN.md:35`). After this plan each decision is stored as a small, text-free event; human overrides are linked to it; the node settings show agreement rate, a probability histogram and — with ≥ 30 labelled decisions — a suggested threshold. Nothing changes routing automatically.

## Audit check (verified at 9e0491e3)

All claims hold, with two refinements: (1) the answer itself is not lost after 30 days — `email_workflow_run_steps.port` keeps `ja|nein|unsicher|error` and `message` keeps the summary "Ja-Wahrscheinlichkeit NN %"; only `detail_json` is pruned (`packages/server/src/workflow-run-step-append.ts:78-116`). Parsing the German summary is not an acceptable data source, so a dedicated table is still right. (2) `ai.decide` does not itself change spam status — downstream nodes do (e.g. template `inbound-spam-decision`, `packages/core/src/workflow/templates-partial-automation.ts:96-133`). So "was this decision about spam?" cannot be inferred from the node; it needs an explicit per-node setting (see Phase 0, "Rückmeldung").

## Current state

- `packages/core/src/workflow/ai-decide.ts` — pure logic both editions share: `AiDecideAnswer = 'ja'|'nein'|'unsicher'|'error'` (line 10), `AI_DECIDE_MIN_THRESHOLD = 50`, `MAX = 99` (16-17), `AI_DECIDE_DRY_RUN_SUMMARY` (34), `AiDecideOutcome { answer, probability (0–100|null), confidence, reason, summary, model }` (38-49), `normalizeAiDecideThreshold` (51-57), `aiDecideAnswerForProbability`: `p ≥ t ⇒ ja`, `p ≤ 100−t ⇒ nein`, else `unsicher` (68-78).
- `packages/core/src/workflow/schema/ai.ts:445-575` — node schema for `ai.decide` (fields question, yesCriteria, noCriteria, contextMode, threshold at 490-500 "Mindest-Sicherheit in % (50–99)", profileId). Changing it updates `tests/unit/__snapshots__/workflow-node-catalog-sync.test.ts.snap`.
- Server: `packages/server/src/workflow-ai-decide.ts` — `runServerAiDecision` (210-278) returns the outcome and records usage via `recordDecisionUsage` → `recordAiUsageSafe` (149-177; no `runId` passed). `createPostgresAiDecidePort().decide` (412-557): second `withWorkspaceTransaction` (461-554) is where the answer becomes final (not aborted); it knows `input.runId`, `input.nodeId`, `input.messageId`, `input.direction`, `input.threshold`. `recordDecisionStep` (358-408) writes the run step. Preview decisions go through `executePreviewAiDecide` in `workflow-execution.ts:2098` (not recorded here).
- Desktop: `electron/workflow/nodes/ai-nodes.ts:529-590` — `register({ type: 'ai.decide', execute: async (ctx, config) => … finish(outcome) })`; the executor signature has a third `nodeId` parameter (`electron/workflow/types.ts:46-50`); `ctx.workflowId`, `ctx.runId`, `ctx.dryRun`, `ctx.previewOutbound`, `ctx.messageId`, `ctx.outbound?.messageId` exist (`types.ts:8-27`).
- Human spam overrides: server `setSpamStatus` (`packages/server/src/db/postgres-mail-read-ports.ts:2198-2270`) and `bulkSetSpamStatusRows` (`:2977-3040`) call `learningLabelForSpamStatusTransition` (`:4946-4953`: `spam` when → spam; `ham` when spam/review → clean) and insert `email_spam_learning_events` — no link to any decision. Only caller of `setSpamStatus`: `packages/server/src/api/mail-routes.ts:3181` (human, HTTP). Desktop `setMessageSpamStatus` (`electron/email/email-store.ts:1763-1823`) is called by humans from `electron/ipc/email.ts:2847` (`source: 'manual'`) and drag & drop (`email-store.ts:2088-2091`), but also by workflow nodes (`electron/workflow/nodes/email-nodes.ts:319`, `:352`, `source: 'workflow'`), the local HTTP API (`electron/services/email-api-service.ts:136-142`) and `mail-security-static.ts:30` — those must NOT count as overrides.
- Human replies: send provenance is decided in `recordSentProvenance` (desktop `electron/email/email-sent-provenance.ts:128-137`, server `packages/server/src/mail-sent-provenance.ts:68-…`); `sent_by_kind = 'human'` plus the draft's `reply_parent_message_id` identifies a human answer (same rule as learnings: `electron/email/email-ai-learnings.ts:197-240`). `sent_outbound_review_skipped` marks "Ohne Ausgangsprüfung senden".
- Learnings precedent: `packages/server/src/migrations/0057_ai_learnings.ts` — candidate kinds `CHECK (kind IN ('draft_edit','human_reply','note'))` (line 53), RLS pattern (75-86); desktop DDL in `electron/database-schema.ts:752-812` and creation in `electron/sqlite-service.ts:203-206` + `:1173-1175`. Retention hooks: server `packages/server/src/jobs/maintenance-handlers.ts:335-354` (audit.retention), desktop `electron/email/email-imap-services.ts:190-203` (`…IfDue`).
- GDPR: `docs/design/gdpr-erasure-spike.md:46-83` — erasure anonymizes message rows in place (ids stay); tables holding only ids and numbers are not in the PII surface.
- UI: node settings `src/components/email/workflow/node-properties-panel.tsx` (`NodePropertiesPanel`, registry fields at 206-214), mounted in `workflow-shell.tsx:1309-1316` next to `WorkflowRunHistory workflowId={selectedId}` (1319). The renderer workflow id is the source id; server routes use `/api/v1/workflows/by-source/:sourceId/…` (`src/services/transport/channel-http-registry.ts:3505-3510`).

## Commands you will need

Prefix every command with `export PATH=/opt/node24/bin:$PATH;`.

| Purpose | Command | Expected |
|---|---|---|
| Install | `pnpm install` | exit 0 |
| Build packages | `pnpm run build:packages` | exit 0 |
| Typecheck | `pnpm run typecheck` | exit 0 |
| Lint | `pnpm run lint` | exit 0, 0 warnings |
| Focused test | `pnpm exec jest <file>` | all pass |
| Unit / integration | `pnpm run test:unit` / `pnpm run test:integration` | all pass |
| Mail suite | `pnpm run test:mail` then `pnpm run test:mail:coverage` | pass, ratchet ok |
| Server coverage | `pnpm run test:server:coverage && node scripts/check-server-coverage-ratchet.mjs` | pass |
| UI coverage | `pnpm run test:ui:coverage:check` | pass |

Postgres tests refuse root: `chmod -R a+rwX .tmp-tests tests packages/core/dist packages/server/dist`, then `su tester -s /bin/bash -c "export PATH=/opt/node24/bin:\$PATH; cd /home/user/SimpleCRMPublic && node_modules/.bin/jest --cacheDirectory /tmp/jest-tester --forceExit <file>"`; keep `jest.mock('kysely', () => jest.requireActual('../../packages/server/node_modules/kysely'))` in new Postgres test files.

## Scope

**In scope**: `docs/design/ai-decision-accuracy.md` (create); `packages/core/src/workflow/ai-decision-accuracy.ts` (create) and its export in `packages/core/src/workflow/index.ts`; `packages/core/src/workflow/schema/ai.ts`; `packages/core/src/workflow/templates-partial-automation.ts`; `packages/server/src/migrations/00NN_ai_decision_events.ts` (create, next free number) + `index.ts`; `packages/server/src/db/schema.ts`; `packages/server/src/ai-decision-events.ts` (create); `workflow-ai-decide.ts`; `postgres-mail-read-ports.ts`; `mail-sent-provenance.ts`; `jobs/maintenance-handlers.ts`; one new read route in `packages/server/src/api/workflow-routes.ts` + its policy in `packages/server/src/mail-access/policy-manifest.ts` (or wherever `/api/v1/workflows/by-source/:sourceId/runs` is assigned) + `api/types.ts`; desktop `electron/database-schema.ts`, `electron/sqlite-service.ts`, `electron/workflow/ai-decision-events.ts` (create), `ai-nodes.ts`, `email-store.ts`, `email-sent-provenance.ts`, `email-imap-services.ts`, `electron/ipc/email.ts`, `electron/ipc/workflow.ts`; `shared/ipc/channels.ts` + schema file for the new channel; `channel-http-registry.ts`; `node-properties-panel.tsx`, `workflow-shell.tsx`, a new `src/components/email/workflow/ai-decide-accuracy.tsx`; `src/app/email/reporting/page.tsx` (one column); tests listed in "Test plan"; `tests/unit/server-edition-foundation.test.ts` (migration list); snapshot update; `docs/USER_GUIDE_WORKFLOWS.md`; `CHANGELOG.md`.

**Out of scope**: automatic threshold changes; Phase 4 (`decision_override` learning kind) — design text only; storing question, criteria, reason or any mail text in the new table; backfilling from old run steps; preview/compose-validation decisions (open question Q3).

## Git workflow

Branch `advisor/050-ai-decision-accuracy-loop`; commits in German with area prefix, e.g. `KI-Entscheidung: Entscheidungen als Ereignis speichern (beide Editionen)`, `KI-Entscheidung: Treffsicherheit und Schwellen-Vorschlag im Knoten`. Do NOT push or open a PR unless the operator says so.

## Steps

### Phase 0 — design

#### Step 1: Write `docs/design/ai-decision-accuracy.md` and stop for review

Structure like `docs/design/gdpr-erasure-spike.md` (problem, model, table, cross-edition plan, open questions, recommendation). It must fix these defaults (the maintainer may overrule them):

1. **Event** = one production ai.decide resolution with a run id and node id (not dry run, not preview). Fields: workspace, workflow source id (+ server workflow id), node id, run id, message id, direction, answer, probability, threshold, model, feedback signal, created_at; later override_kind, truth, override_at. **No text** (no question, criteria, reason, subject, addresses).
2. **Rückmeldung (feedback signal)** — new optional node field `feedbackSignal`: `none` (default) | `spam` (Ja = Spam) | `human_needed` (Ja = Mensch nötig) | `send_ok` (Ja = versandfähig). The three partial-automation templates set `spam`, `human_needed`, `send_ok`.
3. **Overrides → truth label** (only human entry points, only the newest open event for that message and signal, within 30 days of the decision):
   - `spam`: human sets clean after answer `ja` → `override_kind='spam_to_clean'`, `truth='nein'`; human sets spam after `nein` → `'clean_to_spam'`, `truth='ja'`; after `unsicher`: clean → `'review_to_clean'` `truth='nein'`, spam → `'review_to_spam'` `truth='ja'` (label without "override" in the agreement rate).
   - `human_needed`: human-sent reply to the message after answer `nein` ("Nein – kein Mensch nötig") → `'human_reply'`, `truth='ja'`.
   - `send_ok`: human sends the blocked draft with "Ohne Ausgangsprüfung senden" after `nein`/`unsicher` → `'sent_without_review'`, `truth='ja'`.
   - No override within 30 days ⇒ the event counts as *agreed* for `ja`/`nein` (implicit confirmation); `unsicher` without human resolution and `error` are excluded from accuracy.
4. **Metrics per node**: decisions, answer distribution, agreement rate = agreed / (agreed + overridden) over closed events, 10-bucket probability histogram, suggested threshold (Step 7 algorithm) shown only when ≥ 30 labelled events.
5. **Retention**: events 365 days, then deleted (server audit.retention job, desktop `…IfDue`); `message_id` is `ON DELETE SET NULL`; no PII ⇒ GDPR erasure needs no change (cite `gdpr-erasure-spike.md` "Table → action mapping").
6. **Phase 4 (not built)**: a `decision_override` learning candidate kind proposing revised yes/no criteria through the existing digest approval flow (`ai_learning_digests`).
7. **Open questions** section — copy Q1–Q7 from "Open questions for the maintainer" below.

**Verify**: `test -f docs/design/ai-decision-accuracy.md && grep -c "feedbackSignal" docs/design/ai-decision-accuracy.md` → ≥ 1. Commit, then **STOP and report** the open questions to the operator. Continue with Phase 1 only after the operator confirms or amends the defaults (record the answers in the doc).

### Phase 1 — record decisions

#### Step 2: Core helper and node field

Create `packages/core/src/workflow/ai-decision-accuracy.ts`: types `AiDecisionFeedbackSignal`, `AiDecisionOverrideKind`, `AI_DECISION_FEEDBACK_SIGNALS`, `normalizeAiDecisionFeedbackSignal(value): signal` (unknown → `'none'`), `AI_DECISION_EVENT_RETENTION_DAYS = 365`, `AI_DECISION_OVERRIDE_WINDOW_DAYS = 30`, `AI_DECISION_MIN_SAMPLES = 30`, and pure `overrideForSpamTransition({ answer, previous, next })`, `overrideForHumanReply({ answer })`, `overrideForReviewSkip({ answer })` returning `{ overrideKind, truth } | null` per the Phase 0 table. Add field `feedbackSignal` (type `select`, label "Rückmeldung für die Treffsicherheit", options per signal with German labels, default `none`) to `'ai.decide'` in `schema/ai.ts`; set it in the three `*_DECISION_CONFIG` objects of `templates-partial-automation.ts`. Update the catalog snapshot (`pnpm exec jest tests/unit/workflow-node-catalog-sync.test.ts -u`) and inspect the diff: only the new field.

**Verify**: `pnpm exec jest tests/unit/ai-decision-accuracy-core.test.ts tests/unit/workflow-node-catalog-sync.test.ts` → pass.

#### Step 3: Tables

Server migration `00NN_ai_decision_events` (pattern 0057): table `ai_decision_events (id bigserial PK, workspace_id uuid NOT NULL REFERENCES workspaces ON DELETE CASCADE, workflow_id bigint REFERENCES email_workflows(id) ON DELETE CASCADE, workflow_source_id bigint NOT NULL, node_id text NOT NULL CHECK (char_length(node_id) <= 200), run_id bigint, message_id bigint REFERENCES email_messages(id) ON DELETE SET NULL, direction text NOT NULL, answer text NOT NULL CHECK (answer IN ('ja','nein','unsicher','error')), probability smallint CHECK (probability IS NULL OR probability BETWEEN 0 AND 100), threshold smallint NOT NULL CHECK (threshold BETWEEN 50 AND 99), model text CHECK (model IS NULL OR char_length(model) <= 200), feedback_signal text NOT NULL DEFAULT 'none' CHECK (feedback_signal IN ('none','spam','human_needed','send_ok')), override_kind text CHECK (override_kind IS NULL OR override_kind IN ('spam_to_clean','clean_to_spam','review_to_clean','review_to_spam','human_reply','sent_without_review')), truth text CHECK (truth IS NULL OR truth IN ('ja','nein')), override_at timestamptz, created_at timestamptz NOT NULL DEFAULT now())`; indexes `(workspace_id, workflow_source_id, node_id, created_at DESC)` and `(workspace_id, message_id, created_at DESC) WHERE message_id IS NOT NULL AND override_at IS NULL`; ENABLE/FORCE RLS + `app.can_access_workspace(workspace_id)` policy; downSql. Register in `migrations/index.ts`, add Kysely table type in `db/schema.ts`, append the id to `tests/unit/server-edition-foundation.test.ts`. Desktop: same columns in SQLite syntax in `electron/database-schema.ts` (`AI_DECISION_EVENTS_TABLE`, `createAiDecisionEventsTable`, `AI_DECISION_EVENTS_INDEXES`), created in both places `sqlite-service.ts` creates the learnings tables (fresh DB ~line 203 and `ensureMigrationTable` ~line 1174).

**Verify**: `pnpm exec jest tests/unit/server-edition-foundation.test.ts` → pass; `pnpm run typecheck` → 0.

#### Step 4: Write events in both editions

Server `packages/server/src/ai-decision-events.ts`: `recordAiDecisionEvent(trx, { workspaceId, runId, nodeId, messageId, direction, outcome, threshold, feedbackSignal, now })` — looks up `email_workflow_runs` by `(workspace_id, id = runId)` for `workflow_id` and `coalesce(workflow_source_sqlite_id, workflow_id)`; returns silently if the run is missing. Call it inside the second transaction of `createPostgresAiDecidePort().decide` right after the aborted-check (only when not aborted, `input.runId !== undefined && input.nodeId`), with `normalizeAiDecideThreshold(input.threshold)`. `feedbackSignal` must travel in `AiDecideJobPlan` — add it where the job plan is built (`scheduleAiDecideJob` in `workflow-execution.ts`; if that function moved because of plan 034, STOP). Desktop `electron/workflow/ai-decision-events.ts` with the same function (sync, `getDb()`), called from `ai-nodes.ts` `finish` only when `!ctx.dryRun && !ctx.previewOutbound` (add the `nodeId` parameter to `execute`). Recording failures are caught and logged; they never change the node result.

**Verify**: new `tests/integration/postgres-ai-decision-events.test.ts` (pattern `tests/integration/postgres-workflow-ai-decide.test.ts`): a decided job writes one event with the right ids/answer/probability; aborted chain writes none; missing run writes none; RLS hides workspace B. New `tests/integration/sqlite-ai-decision-events.test.ts` (pattern `tests/integration/sqlite-outbound-ai-decide-e2e.test.ts`): live decision writes one event, dry run and preview write none.

### Phase 2 — link overrides

#### Step 5: Spam status, human reply, review skip

`linkAiDecisionOverride(trx|db, { workspaceId?, messageId, signal, resolve: (answer) => {overrideKind, truth} | null, now })` updates the newest event with `message_id = ? AND feedback_signal = ? AND override_at IS NULL AND created_at >= now − 30 days`. Hooks:
- Server `setSpamStatus` and `bulkSetSpamStatusRows`: after the status update, when a human actor is present (`input.actorUserId`), use `overrideForSpamTransition` with previous/next status.
- Desktop: add option `aiOverride?: boolean` to `setMessageSpamStatus`/`setMessageSpam`; pass `true` only from `electron/ipc/email.ts:2847` and the drag & drop cases in `moveMessageToMailView`. Never from workflow nodes, `email-api-service.ts` or `mail-security-static.ts`.
- Both `recordSentProvenance`: when the determined kind is `human` and the draft has `reply_parent_message_id`, link `human_needed` on the parent; when `outboundReviewSkipped` is true, link `send_ok` on the draft id. Wrap in try/catch (send already committed).

**Verify**: extend the two integration files: human spam→clean after `ja` sets `spam_to_clean`/`truth='nein'`; workflow-sourced status change (desktop `source: 'workflow'`) links nothing; second override does not overwrite the first; human reply after `nein` sets `human_reply`; events older than 30 days stay untouched. `pnpm run test:mail` → pass.

#### Step 6: Retention

`pruneAiDecisionEvents` (server, per workspace, batched like `pruneWorkflowRunStepDetails`) called in `maintenance-handlers.ts` after the step-detail prune with the same `.catch(console.warn)` shape; desktop `pruneAiDecisionEventsIfDue(logger)` in `email-imap-services.ts` next to `pruneWorkflowRunStepDetailsIfDue`.

**Verify**: prune tests in both integration files (366-day-old event removed, 364-day-old kept).

### Phase 3 — show it

#### Step 7: Stats and threshold suggestion

In the core helper add `summarizeAiDecisionEvents(events, now)` → `{ total, byAnswer, histogram: number[10], closed, agreed, overridden, agreementRate | null, labelled, suggestedThreshold | null }` and `suggestAiDecideThreshold(samples: {probability, truth}[], { maxWrongRate = 0.05 })`: for t = 50…99 count wrong automatic answers (`p ≥ t && truth='nein'` or `p ≤ 100−t && truth='ja'`) over automatic answers; return the smallest t whose wrong-rate ≤ `maxWrongRate` and that leaves at least one automatic answer; `null` when fewer than `AI_DECISION_MIN_SAMPLES` labelled samples. An event is *closed* when overridden or older than the 30-day window. Read path: server `GET /api/v1/workflows/by-source/:sourceId/ai-decisions?nodeId=…&days=90` (same policy as the `…/runs` route; returns only the summary, never rows), desktop IPC channel `workflow:ai-decision-stats` (register in `shared/ipc/channels.ts`, schema file, `electron/ipc/workflow.ts`), HTTP mapping in `channel-http-registry.ts` (plan 036's contract test, if merged, must stay green).

**Verify**: `pnpm exec jest tests/unit/ai-decision-accuracy-core.test.ts` covers: < 30 samples → null; perfectly separated samples → 50; noisy samples → higher t; histogram edges (0, 9, 10, 100).

#### Step 8: UI

`src/components/email/workflow/ai-decide-accuracy.tsx`: rendered by `RegistryFields` in `node-properties-panel.tsx` only for `ai.decide` and a saved workflow (pass `workflowId={selectedId}` from `workflow-shell.tsx`). Shows "Treffsicherheit (90 Tage)": decisions, Ja/Nein/Unsicher/KI-Fehler, "Übereinstimmung mit Menschen: NN %" or "noch zu wenig Rückmeldungen (n/30)", a 10-bar histogram (plain divs), and "Vorschlag Schwelle: NN %" with a button "Übernehmen" that only patches the node config (user still saves). Hint when `feedbackSignal` is `none`: "Rückmeldung wählen, damit Korrekturen gezählt werden." Add an "Übereinstimmung" column to the 049 "KI-Entscheidungen (30 Tage)" table only if 049 exposes per-workflow data; otherwise skip and note it. Test `tests/unit/ai-decide-accuracy-ui.test.tsx` (pattern `tests/unit/workflow-run-history-detail.test.tsx`).

**Verify**: `pnpm exec jest tests/unit/ai-decide-accuracy-ui.test.tsx` → pass; `pnpm run test:ui:coverage:check` → pass.

#### Step 9: Docs and changelog

`docs/USER_GUIDE_WORKFLOWS.md` (after the Lauf-Historie section ~line 424: "Treffsicherheit"), CHANGELOG `[Unreleased]` `### Added` `**Beide Editionen:**`.

## Test plan

New: `tests/unit/ai-decision-accuracy-core.test.ts`, `tests/integration/postgres-ai-decision-events.test.ts`, `tests/integration/sqlite-ai-decision-events.test.ts`, `tests/unit/ai-decide-accuracy-ui.test.tsx`, route test next to the existing workflow runs route tests. Must cover: no text columns written; dry run/preview not recorded; only human entry points link overrides; 30-day window; retention; < 30 samples ⇒ no suggestion; RLS.

## Done criteria

- [ ] Design doc committed and the operator's answers recorded in it
- [ ] `pnpm run typecheck`, `pnpm run lint` exit 0
- [ ] `pnpm run test:unit`, `pnpm run test:mail`, `pnpm run test:mail:coverage`, `pnpm run test:ui:coverage:check` pass
- [ ] Both new integration files pass (Postgres one as non-root); server coverage ratchet passes
- [ ] `grep -nE "question|criteria|reason|subject" packages/server/src/migrations/00*_ai_decision_events.ts` → no column matches
- [ ] `git status` shows only in-scope files; README row + MASTERPLAN checkbox updated

## STOP conditions

- Plan 046 or 049 is not DONE.
- The operator has not answered the Phase 0 questions.
- After plans 024/034 the server decision no longer resolves in `createPostgresAiDecidePort().decide`, or the job plan is built somewhere other than `scheduleAiDecideJob` — report the new location instead of guessing.
- A human spam action cannot be told apart from a workflow one at the hook point.
- Any design choice would require storing mail text or reasons in `ai_decision_events`.

## Open questions for the maintainer

- **Q1** Is "no override within 30 days = agreed" acceptable, or should agreement count only explicit confirmations?
- **Q2** Is an explicit per-node `feedbackSignal` acceptable, or should the signal be inferred from downstream nodes (e.g. `email.mark_spam` on the Ja-branch)?
- **Q3** Should compose-preview decisions (`executePreviewAiDecide`, desktop `previewOutbound`) be recorded? They gate real sends.
- **Q4** Retention 365 days — or align with the 30-day run-detail retention (fewer samples)?
- **Q5** Default `maxWrongRate` 5 % for the suggestion — per workflow configurable?
- **Q6** Should `unsicher` resolved by a human feed the suggestion (as labelled samples) — proposed yes.
- **Q7** Phase 4: build the `decision_override` learning kind (new CHECK value in `ai_learning_candidates`, digest prompt change), or keep suggestions numeric only?

## Maintenance notes

- If the threshold semantics in `aiDecideAnswerForProbability` change, `suggestAiDecideThreshold` must change with it (same file family; test both).
- New spam-status entry points must decide explicitly whether they are human (pass `aiOverride`).
- Reviewer focus: no text in the table; override hooks never throw into the send/spam paths; RLS on the new table.
