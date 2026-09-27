# Plan 043: Split `workflow-execution.ts` node handlers into `workflow-nodes/<category>.ts` (pure move)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update this plan's row in
> `plans/README.md` (section "Runde 2") AND tick its checkbox (**043**) in
> `plans/MASTERPLAN.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 9e0491e3..HEAD -- packages/server/src/workflow-execution.ts packages/server/src/workflow-node-catalog.ts packages/server/src/index.ts`
> This file WILL have drifted: plans 024, 034 and 047 (and possibly others)
> change it before this plan runs. That drift is expected. Do NOT compare line
> numbers; instead re-run the enumeration in Step 0 and compare the *set of node
> types* with the table below. Only an unexplained difference is a STOP condition.

## Status

- **Priority**: P3
- **Effort**: L
- **Risk**: MED
- **Depends on**: plans/030 (coverage ratchets reset), and must run AFTER 024, 034, 040, 047 (all edit or sit next to this file; 040 itself does not edit it but touches the same schedule path)
- **Category**: tech-debt
- **Planned at**: commit `9e0491e3`, 2026-09-27

## Why this matters

`packages/server/src/workflow-execution.ts` is 8,832 lines — the largest and
most-churned server file (79 commits since June 2026). `executeServerNode`
(`:2203-2778`) is one ~575-line chain of ~57 `if (type === …)` branches, and the
file also holds spam, JTL/MSSQL, returns, CRM, categories, IMAP moves, and AI-job
scheduling. Every feature touches it, so merges conflict and reviews are slow.
The desktop already registers nodes per category (`electron/workflow/nodes/*-nodes.ts`).
This plan moves the node handlers verbatim into per-category modules behind a
`Record<nodeType, handler>` dispatch. **No behaviour change is allowed.**
Audit claims verified (8,832 lines; `executeServerNode` 2203–~2780; job port
`createPostgresWorkflowExecutionJobPort` 484–1189, ~700 lines).

## Current state

- `packages/server/src/workflow-execution.ts` — engine (job port 484–1189,
  `prepareWorkflowRun`, `runServerWorkflowGraph` 1618, `walkGraph` 1744) and all
  node handlers. Public exports used elsewhere: `createPostgresWorkflowExecutionJobPort`,
  `PostgresWorkflowExecutionJobPortOptions`, `decideWorkflowReturnOutcomePort`,
  `evaluateWorkflowReturn`, `applyWorkflowReturnOutcome`, `loadOutboundReplyParentBlock`,
  `WORKFLOW_SCHEDULE_RUN_KEY_PREFIX`. `packages/server/src/index.ts:46` does
  `export * from './workflow-execution'` — the export surface must stay identical.
- Already-split server helpers to imitate: `workflow-ai-draft-nodes.ts`,
  `workflow-forward-copy.ts`, `workflow-http-request.ts`, `workflow-imap-actions.ts`.
- Package is CommonJS (`packages/server/package.json` `"type": "commonjs"`,
  `module: Node16`) — **import cycles are forbidden** (see Step 1).
- Dispatch order in `executeServerNode` is load-bearing (`:2213-2778`):
  1. `node.type === 'trigger'` → ok; `node.type === 'condition'` → `matchCondition`.
  2. `type = nodeRuntimeType(node)`; `config = interpolateServerSchemaFields(type, nodeConfig(node), context)`.
  3. **Pre-guard branches** (run even in dry-run): `logic.stop`/`stop`,
     `logic.stop_after_spam`, `logic.merge`/`logic.loop`, `logic.set_variable`,
     `logic.delay` (own dry-run branch), `logic.threshold`, `logic.switch`,
     `ai.decide` (own preview/dry-run branches), then
     `if (dryRun && context.previewOutbound)` → `ai.outbound_review`, `ai.review`/`ai_review`
     (otherwise they fall through), then `ai.learnings_digest`.
  4. **Dry-run guard** (`:2376-2380`):
     ```ts
     if (dryRun) {
       const dryRunResult = dryRunMutatingNodeResult(type, config, node, log);
       if (dryRunResult) return dryRunResult;
       if (!DRY_RUN_LIVE_NODE_TYPES.has(type)) return dryRunFailClosedResult(type, log);
     }
     ```
  5. **Post-guard branches** (everything else, table below), then
     `return unsupportedWorkflowNodeResult(type, log);`.
- Catalog: `packages/core/src/workflow/node-catalog.ts` (`runtime?: 'both'|'desktop'|'server'`, missing = both);
  `packages/server/src/workflow-node-catalog.ts` `listServerWorkflowNodeCatalog()`
  = entries with `runtime !== 'desktop'` minus `code.javascript`, `code.python`,
  `plugin.custom`. At planning time that is 56 types; every one has a branch.

### Category → node types (enumerated from the branches at `9e0491e3`)

| Module (`packages/server/src/workflow-nodes/`) | Node types (aliases in brackets) | Main functions to move with them |
|---|---|---|
| `logic.ts` | pre-guard: `logic.stop` [`stop`], `logic.stop_after_spam`, `logic.merge`, `logic.loop`, `logic.set_variable`, `logic.delay`, `logic.threshold`, `logic.switch`; post-guard: `workflow.subflow` | `scheduleWorkflowDelay`, `workflowDelayContext`, `boundedDelayMinutes`, `boundedDelayMs`, `enqueueWorkflowSubflow` |
| `ai.ts` | pre-guard: `ai.decide`, `ai.outbound_review`+`ai.review`+[`ai_review`] (preview branch only), `ai.learnings_digest`; post-guard: `ai.reply_suggestion`, `ai.outbound_review`, `ai.review` [`ai_review`], `ai.classify`, `ai.transform_text`, `ai.agent`, `ai.pick_canned`, `ai.agent_tool`, `ai.draft_reply`, `ai.review_draft` | `executePreviewAiDecide`, `executePreviewOutboundAiReview`, `schedule*Job` (AiReplySuggestion, AiClassification, AiReview, AiTransformText, AiAgent, AiDraftReply, AiReviewDraft, AiDecide, AiPickCanned), `executeWorkflowAgentTool`, `searchWorkflowKnowledgeChunks`, `workflowAi*` config helpers, `workflowOutboundReview*` |
| `spam.ts` | `ai.spam_score`, `email.set_spam_status`, `email.mark_spam` | `workflowAiSpamScoreResult` + its `loadWorkflowSpam*`/`selectWorkflowSpamListMatch` helpers, `setWorkflowSpamStatus`, `trainWorkflowSpamStatus`, `spamStatusConfig` |
| `outbound.ts` | `email.hold_outbound` [`hold_outbound`], `email.release_outbound`, `email.send_draft`, `email.create_draft`, `email.auto_reply` | `releaseWorkflowOutboundHold`, `sendWorkflowDraft`, `reserveServerAutoReplySlot`, `createWorkflowComposeDraft`, `evaluateWorkflowAutoReply`, `loadAutoReply*` |
| `message.ts` | `email.tag` [`tag`], `email.set_category` [`set_category`], `email.tag_attachment_meta` [`tag_attachment_meta`], `email.set_priority`, `email.auth_check`, `email.read_tracking_evidence`, `email.sender_filter`, `email.mark_seen` [`mark_seen`], `email.archive` [`archive`], `email.assign` | `addWorkflowMessageTag`, category helpers (`setWorkflowMessageCategory*`, `ensureWorkflowEmailCategory`, …), `readWorkflowTrackingEvidence`, `evaluateWorkflowSenderFilter`, `loadWorkflowSenderLists`, `markWorkflowMessageSeen` |
| `imap.ts` | `email.move_imap`, `email.delete_server` | `moveWorkflowMessageOnImap`, `deleteWorkflowMessageOnImap`, `runWorkflowImapMoveAction` (also used by `email.mark_spam`) |
| `crm.ts` | `crm.create_task`, `crm.log_activity`, `crm.update_deal`, `crm.link_customer` [`link_customer`] | `createWorkflowTask`, `createWorkflowActivityLog`, `updateWorkflowDeal` + deal/customer reference helpers, `linkWorkflowMessageCustomer` |
| `integration.ts` | `sync.run`, `email.forward_copy` [`forward_copy`], `email.ingest_dmarc_report`, `http.request` | `enqueueWorkflowSyncRun`, `scheduleWorkflowForwardCopyJob`, `scheduleWorkflowDmarcIngestJob`, `scheduleWorkflowHttpRequestJob`, `workflowHttp*`/`workflowForwardCopyRecipient` config helpers |
| `erp.ts` | `jtl.lookup`, `mssql.query`, `jtl.order_context`, `jtl.prepare_action`, `returns.evaluate`, `returns.offer_exchange`, `returns.offer_credit` | `executeWorkflowJtl*`, `executeWorkflowMssqlQuery`, JTL context helpers, `loadWorkflowReturn`, `decideWorkflowReturnOutcomePort`, `evaluateWorkflowReturn`, `applyWorkflowReturnOutcome` |

### Shared pieces that must leave `workflow-execution.ts` (used by engine AND handlers)

- `workflow-nodes/types.ts`: `ServerWorkflowContext`, `NodeResult`, `ServerWorkflowRuntimePorts`,
  `WorkflowVariableContext`, `WorkflowStringContext`, `WorkflowMessagePatch`, `MessageRow`,
  `DeferredWorkflowImapEffect`, `WorkflowVisibilityInvalidation`, `WorkflowStepStatus`,
  plus new `ServerNodeHandlerArgs` / `ServerNodeHandler` (Step 1).
- `workflow-nodes/shared.ts`: `serverWorkerSourceRow`, `serverCreatedSourceSqliteId` and all
  `serverCreatedWorkflow*SourceSqliteId`, `workflowSideEffectExecutionIdentity`,
  `workflowSourceSqliteId`, `workflowJobProvenance`, `inboundFanOutRunId`,
  `inboundChainFieldsFromContext`, `stampBranchKey`, `terminalNodeExecutionId`,
  `terminalChainStamp`, `unwiredPortChainPayload`, `boundedContinuationStrings`,
  `workflowContinuationContextError`, `resolveResumeNodeAfter*`, `updateWorkflowMessage`,
  `softDeleteWorkflowMessage`, `applyWorkflowImapMoveLocalState`, `workflowSpamStatusPatch`,
  `messageIsSpamOrReview`, `objectRecord`, `parseJson`, `firstWorkflowRecipientAddress`,
  `extractWorkflowEmailAddress`, `booleanConfig`, `optionalPositiveIntegerConfig`,
  `optionalSafeIntegerConfig`, `positiveIntegerVariable`, `aiDecideNodeResult`,
  `loadWorkflow`, `normalizeWorkflowTrigger`, `resolveMessageSourceSqliteId`, and the constants they read.
- `workflow-nodes/dry-run.ts`: `DRY_RUN_LIVE_NODE_TYPES`, `dryRunMutatingNodeResult`,
  `dryRunAsyncContinuationResult`, `dryRunSideEffectResult`, `dryRunFailClosedResult`,
  `unsupportedWorkflowNodeResult`.
- Rule of thumb: a helper used only by one category moves into that category file;
  used by ≥2 categories or by the engine → `shared.ts`. Let `tsc` tell you what is missing.

## Commands you will need

Prefix every command with `export PATH=/opt/node24/bin:$PATH;`.

| Purpose | Command | Expected |
|---|---|---|
| Install | `pnpm install` | exit 0 |
| Build workspace packages | `pnpm run build:packages` | exit 0 |
| Typecheck | `pnpm run typecheck` | exit 0 |
| Lint | `pnpm run lint` | exit 0, 0 warnings |
| Focused test | `pnpm exec jest tests/unit/server-workflow-node-handlers.test.ts` | all pass |
| Unit / integration | `pnpm run test:unit` / `pnpm run test:integration` | all pass |
| Server coverage ratchet | `pnpm run test:server:coverage && node scripts/check-server-coverage-ratchet.mjs` | pass |

`tests/integration/postgres-workflow-*.test.ts` (16 files) exercise the handlers.
They refuse to run as root: `chmod -R a+rwX .tmp-tests tests packages/core/dist packages/server/dist`,
then `su tester -s /bin/bash -c "export PATH=/opt/node24/bin:\$PATH; cd /home/user/SimpleCRMPublic && node_modules/.bin/jest --cacheDirectory /tmp/jest-tester --forceExit tests/integration/postgres-"`.

## Scope

**In scope**: `packages/server/src/workflow-execution.ts`, new
`packages/server/src/workflow-nodes/*.ts`, new
`tests/unit/server-workflow-node-handlers.test.ts`.

**Out of scope**: any logic change, renaming of log strings/messages/ports,
`createPostgresWorkflowExecutionJobPort` and `walkGraph` internals (engine stays
in `workflow-execution.ts`; splitting the job port is a follow-up), desktop
`electron/workflow/**`, `packages/core/**`, tests other than the new one (existing
tests must pass unchanged — if a test imports a moved symbol from
`workflow-execution`, re-export it instead of editing the test). No CHANGELOG entry (no user-visible change).

## Git workflow

- Branch `advisor/043-split-server-workflow-execution`; one commit per step/category.
- German messages, e.g. `Server-Workflow: Logik-Knoten nach workflow-nodes/logic.ts verschieben (reine Verschiebung)`.
- Do NOT push or open a PR unless the operator says so. If the operator wants PRs, one PR per category.

## Steps

### Step 0: Re-enumerate and baseline

Run `awk '/^async function executeServerNode/,/^}/' packages/server/src/workflow-execution.ts | grep -o "type === '[^']*'" | sort -u`
and compare with the table. At `9e0491e3` it prints 68 strings = 56 catalog
types + 10 legacy aliases + `trigger` + `condition`; `grep -c "if (type === '" packages/server/src/workflow-execution.ts`
prints 57, all inside `executeServerNode`. Plans 024/034/047 may add node types
(e.g. a new AI node); add any new type to the fitting category. Run the full unit + integration
suites and the server coverage ratchet; save the coverage totals (`coverage/server/coverage-summary.json` → `total`).

**Verify**: all suites green before any edit. If not → STOP.

### Step 1: Introduce the dispatch table inside the file (no moves yet)

Add types `ServerNodeHandlerArgs = { trx, doc, context, node, config, type, log, now, ports, dryRun }`
and `ServerNodeHandler = (args) => Promise<NodeResult | null>`. Convert each
branch body **verbatim** into a handler (only `return` statements and variable
names from `args` change). Two maps:
`PRE_DRY_RUN_GUARD_HANDLERS` (step 3 list; the preview handlers for
`ai.outbound_review`/`ai.review`/`ai_review` return `null` unless
`dryRun && context.previewOutbound`, which means "fall through") and
`SERVER_NODE_HANDLERS` (post-guard; aliases map to the same function).
`executeServerNode` becomes: trigger/condition → compute `type`/`config` →
pre-guard handler (return if non-null) → the unchanged dry-run guard →
post-guard handler → `unsupportedWorkflowNodeResult`. Keep every comment with its code.

Add `tests/unit/server-workflow-node-handlers.test.ts` (see Test plan) — export
the two maps from `workflow-execution.ts` for now.

**Verify**: typecheck, unit, all `postgres-workflow-*` and `postgres-outbound-*` integration tests → pass.

### Step 2: Extract types, shared helpers, dry-run helpers

Create `workflow-nodes/types.ts`, `shared.ts`, `dry-run.ts` (lists above) by
cut-and-paste; add `export` keywords; import them back into `workflow-execution.ts`.
These modules must NOT import `../workflow-execution`.

**Verify**: typecheck → exit 0; `grep -rn "workflow-execution'" packages/server/src/workflow-nodes` → no output.

### Step 3..11: One category per commit

For each row of the table, in this order — `erp`, `crm`, `integration`, `imap`,
`message`, `spam`, `outbound`, `logic`, `ai` — move its handlers and exclusive
helpers into `workflow-nodes/<module>.ts`, exporting a
`Record<string, ServerNodeHandler>` (`LOGIC_PRE_GUARD_HANDLERS`/`LOGIC_NODE_HANDLERS`,
`AI_PRE_GUARD_HANDLERS`/`AI_NODE_HANDLERS`, `ERP_NODE_HANDLERS`, …). Create
`workflow-nodes/index.ts` that spreads them into `PRE_DRY_RUN_GUARD_HANDLERS` and
`SERVER_NODE_HANDLERS` (throw at module load if a key appears twice in the
post-guard map). Re-export `decideWorkflowReturnOutcomePort`, `evaluateWorkflowReturn`,
`applyWorkflowReturnOutcome`, `loadOutboundReplyParentBlock` from `workflow-execution.ts`
(`export { … } from './workflow-nodes/erp'` etc.).

**Verify after each category**: typecheck; focused handler test; the integration
tests touching that category (e.g. `postgres-workflow-ai-decide`, `returns-workflow-nodes`
for erp); no import of `../workflow-execution` inside `workflow-nodes/`;
move check (below) prints only wrapper lines.

Move check (scratch script, do not commit): compare the multiset of trimmed,
non-empty, non-`import`/`export {`/`}` lines of `git show HEAD~1:packages/server/src/workflow-execution.ts`
against the concatenation of the new `workflow-execution.ts` + `workflow-nodes/*.ts`;
lines present only in the new version must be dispatch/wrapper/`export` lines (≤ 40 per category).
`git diff HEAD~1 --stat` must show roughly equal deletions/insertions.

### Step 12: Final checks

`wc -l packages/server/src/workflow-execution.ts` should be below ~4,500.

**Verify**: full unit + integration suites; server coverage ratchet passes and the
totals differ from Step 0 by ≤ 0.5 points; lint 0 warnings.

## Test plan

New `tests/unit/server-workflow-node-handlers.test.ts` (pattern: `tests/unit/workflow-desktop-parity.test.ts` imports server src directly):
- every `listServerWorkflowNodeCatalog()` type has a key in `SERVER_NODE_HANDLERS` or `PRE_DRY_RUN_GUARD_HANDLERS`;
- every handler key is either a catalog type or one of the legacy aliases
  `stop, ai_review, hold_outbound, tag, set_category, tag_attachment_meta, mark_seen, archive, link_customer, forward_copy`;
- no handler for `code.javascript`, `code.python`, `plugin.custom` or any `runtime: 'desktop'` type;
- the only keys in both maps are `ai.outbound_review`, `ai.review`, `ai_review`;
- aliases resolve to the same function as their canonical type.
Behaviour is covered by the existing integration suites, which must pass unchanged.

## Done criteria

- [ ] `pnpm run typecheck` exit 0; `pnpm run lint` exit 0, 0 warnings
- [ ] `pnpm run test:unit` and `pnpm run test:integration` pass (no existing test edited)
- [ ] New handler-coverage test passes
- [ ] Server coverage ratchet passes
- [ ] `grep -c "if (type === '" packages/server/src/workflow-execution.ts` → `0`
- [ ] `grep -rn "workflow-execution'" packages/server/src/workflow-nodes` → no output
- [ ] Row in `plans/README.md` (Runde 2) updated and **043** ticked in `plans/MASTERPLAN.md`

## STOP conditions

- Any integration test fails after a move and the cause is not a missing import/export.
- A handler cannot be moved without changing a statement other than parameter access/`return`.
- A new node type from 024/034/047 needs logic you would have to change to fit.
- A circular import is required, or `export * from './workflow-execution'` would lose a symbol.
- Coverage totals drop by more than 0.5 points versus Step 0.
- Plans 024, 034 or 047 are not DONE yet (check `plans/README.md`).

## Maintenance notes

- New server node types: add a handler to the category module; the handler test
  fails until the catalog and handler map agree.
- Review with `git diff --color-moved=zebra`; anything not shown as moved needs scrutiny.
- Follow-up (not here): split `createPostgresWorkflowExecutionJobPort` (~700 lines) and `walkGraph`.
