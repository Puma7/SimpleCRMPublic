# Workflow system — Learnings

Concrete lessons from building the graph runtime, spam pipeline, outbound gate, and modular refactor. Complements [WORKFLOW_PHASES.md](WORKFLOW_PHASES.md) and [AGENT_HANDOFF.md](AGENT_HANDOFF.md).

---

## Modular execution (graph-first)

1. **Two runtimes existed** — `execution_mode=graph` with empty `graph_json` silently used **compiled** rules (`email-workflow-engine` legacy). That felt like a “fixed program”, not user-built flows. **Fix:** `resolveWorkflowGraph()` in `workflow-graph-resolve.ts`; graph mode always uses interpreter when a document exists.
2. **`definition_json` ≠ full workflow** — Compiler (`email-workflow-graph-compile.ts`) only knows **trigger / condition / legacy action**. Registry nodes (`ai.spam_score`, `logic.switch`, …) exist **only** in `graph_json`. Saving still writes both; export rules may be `rules: []` for registry-only flows — **that is OK**.
3. **Defaults must include `graph_json`** — Seeding only `definition_json` taught the wrong mental model. Defaults now use `buildDefaultInboundGraph()` / `buildDefaultOutboundGraph()` in `graph-presets.ts`.
4. **New workflow = blank canvas** — Trigger-only graph, empty rules array. User adds nodes from palette (`node-palette.tsx` → `listWorkflowNodeCatalog()`).
5. **Plugins as first-class node types** — Each manifest handler registers as `plugin.<pluginId>.<handlerId>` (`plugin-node-registry.ts`). `plugin.custom` remains for ad-hoc config. Loading must **try/catch** when Electron `app` is missing (Jest).

---

## Outbound quality gate

1. **Check before SMTP** — `evaluateOutboundWorkflows()` in `email-compose-send.ts`; order: save draft → clear hold → workflows → send.
2. **Fail-closed** — Engine/parse errors set hold and block; do not send on partial failure ambiguity.
3. **Blocked UX** — `returnOutboundDraftToInbox()` prepends banner (`OUTBOUND_WARNING_MARKER`), sets `outbound_hold=1`, draft stays `folder_kind=draft`, listed in **inbox** via SQL OR clause for held drafts.
4. **Dry-run is separate** — `evaluateOutboundWorkflows(payload, { dryRun: true })` and IPC `validate-outbound` must **not** call `returnOutboundDraftToInbox` or `setOutboundHold`. KI nodes must respect `ctx.dryRun` (`ai.review`, `ai.outbound_review`).
5. **`ai.outbound_review`** — Expects `STATUS: OK` / `STATUS: BLOCK` + `REASON:`; parser in `email-outbound-review-parse.ts`. Optional reply-context for phishing-on-parent detection.
6. **Attachment count** — Passed on send payload as `attachmentCount`; exposed in context as `outbound.attachment_count`.

---

## Inbound spam / routing

1. **Metadata-only spam score** — `ai.spam_score` with `contextMode: metadata` avoids full body to OpenAI (DSGVO-friendly pattern).
2. **Sender filter ports** — `email.sender_filter` returns `whitelist` | `blacklist` | `default`; canvas needs **labeled edges** (`workflow-canvas.tsx` handles).
3. **Threshold ports** — `logic.threshold` → `yes` / `no`; global threshold via `useGlobalThreshold` + `getWorkflowSpamScoreThreshold()` — settings UI alone is useless without this flag on the node.
4. **Built-in trusted senders** — PayPal/Amazon etc. in `sender-filter.ts`; optional global lists from automation settings.

---

## Schedule & manual run

1. **Cron used to only log + sync** — `runScheduledWorkflowFire` now calls `executeWorkflowForTrigger` with `direction: schedule` and optional `schedule.sync_log` variable.
2. **Desktop manual run** — `workflow:execute-now` / `executeWorkflowNow()`; CRM triggers need `direction: crm_event` (`workflow-trigger-utils.ts`), not `manual`.
3. **Test workflow** — `testWorkflowOnMessage` delegates to `executeWorkflowNow`; message required for inbound/outbound/draft_created triggers.

---

## CRM / delay / graph walker

1. **`logic.loop` execute in node file is stub** — Real iteration in `runtime.ts` walker (ports `each` / `done`).
2. **`logic.merge`** — Passthrough only; no join semantics yet.
3. **`logic.delay`** — Persists job; resumes via `processDueDelayedJobs` + `runWorkflowGraphFromNode` with `startNodeId`.
4. **Subflow** — `workflow.subflow` calls another workflow by ID; no nested editor.

---

## UI / editor

1. **Registry node config** — Many nodes only have expert JSON in properties panel; spam/threshold/sender_filter have dedicated forms.
2. **Compile on save** — Still runs `CompileWorkflowGraph` for `definition_json` export; must not fail when `rules` empty but graph has registry nodes.
3. **Trigger kind** — Taken from trigger node `data.kind` on save, must match workflow row `trigger` column.

---

## Server workflow execution (PostgreSQL)

1. **Kein IMAP in DB-Transaktionen** — `email.mark_seen`, `email.move_imap`, `email.delete_server` und `mark_spam`+`moveImap` queuen IMAP-Aktionen in `deferredImapEffects` und führen sie nach `withWorkspaceTransaction` aus. Lokale DB-Updates für Move/Delete folgen erst nach erfolgreichem IMAP.
2. **Downstream-Variablen im selben Graph** — `imap.seen_synced`, `imap.source_folder` usw. stehen nachgelagerten Knoten im **selben** Lauf nicht mehr live zur Verfügung (Trade-off für kurze Transaktionen).
3. **Dry-run** bleibt unverändert — IMAP wird dort ohnehin nicht aufgerufen.

---

## Testing

1. **Do not import `workflow-graph-resolve` in unit tests without mocking sqlite** — import `graphHasRunnableNodes` from `graph-presets.ts` instead.
2. **`ensureBuiltinWorkflowNodes()` in tests** — triggers plugin load; plugin dir uses `app.getPath` — guarded by try/catch.
3. **Scheduled fire test** — mock `email-workflow-store`, `workflow-executor`, `sqlite-service`, `email-store`.

---

## Documentation hygiene

- Update **WORKFLOW_PHASES.md** for ist-stand, not only WORKFLOW_VISION.md.
- **AGENT_HANDOFF.md** should be updated when merging large PRs or changing execution model again.
