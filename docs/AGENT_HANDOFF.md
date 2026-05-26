# Agent handoff — SimpleCRM (E-Mail & Workflows)

**Last updated:** 2026-05-24 (session: workflow modularization + inbox/outbound + automation API)  
**Primary integration branch:** `cursor/email-workflow-spam-routing-d125`  
**Open PR:** [#19](https://github.com/Puma7/SimpleCRMPublic/pull/19) (targets `main`)  
**Related merged work:** PR #18 — external REST automation API (`cursor/external-automation-api-d125`)

---

## 1. Read this first

If you are a **new AI agent** continuing this work:

1. Read this file end-to-end.
2. Skim [`LEARNINGS.md`](LEARNINGS.md) (do not repeat documented mistakes).
3. For code changes: [`DEVELOPER_EMAIL.md`](DEVELOPER_EMAIL.md) + [`WORKFLOW_PHASES.md`](WORKFLOW_PHASES.md).
4. **Phase 3 Beta-Härtung (offen):** [`MAIL_BETA_PHASE3_PLAN.md`](MAIL_BETA_PHASE3_PLAN.md) — Backup-Restore-Wizard, Migration-Runner, Doku-Polish.
5. Run verification: `npm test`, `npm run build:electron:main`, `npx eslint . --ext ts,tsx --max-warnings 0`.

**Product language:** UI strings are **German** (Posteingang = inbox, Aufgaben = tasks).

---

## 2. What this project is

**SimpleCRM** — Electron + React + TypeScript desktop CRM. **No cloud backend** for CRM data; SQLite (`better-sqlite3`) in the Electron main process. E-mail is synced via IMAP/POP3, rendered via Vite on port 5173 in dev.

**Database (Linux):** `~/.config/simplecrm/database.sqlite`

---

## 3. Chronology of major work (this effort)

| Order | Topic | Branch / PR | Outcome |
|-------|--------|-------------|---------|
| 1 | External automation REST API (Phase A/B) | `cursor/external-automation-api-d125`, **#18** | `/api/v1`, Keytar API keys, scopes, services layer |
| 2 | PR #17 JSX fix in settings | cherry-picked into #18 | `settings-panels.tsx` closing tag |
| 3 | KI spam pipeline + routing nodes | **#19** | `ai.spam_score`, `email.sender_filter`, `logic.threshold`, templates |
| 4 | Inbox audit fixes | **#19** | RFC outbound threading, conversation list, draft edit, search by view |
| 5 | Outbound quality gate | **#19** | `ai.outbound_review`, return to inbox with banner, compose check |
| 6 | Workflow audit | **#19** | Schedule runs graph, global spam threshold, `execute-now` IPC |
| 7 | **Modular workflows** | **#19** commit `9094d84` | Graph-first runtime; defaults as graphs; legacy migration |

---

## 4. Architecture — workflows (current truth)

### 4.1 Modular model (since `9094d84`)

- **Source of truth for execution:** `email_workflows.graph_json` (React Flow document).
- **Runtime:** `electron/workflow/runtime.ts` → `executeNode()` → `getWorkflowNode(type).execute()`.
- **Registry:** `electron/workflow/registry.ts` — all builtins in `electron/workflow/nodes/*.ts`.
- **NOT a fixed program** unless `execution_mode = 'compiled'` (legacy).

```
User builds graph in UI
    → Save: graph_json + definition_json (export only for linear legacy actions)
    → Trigger fires (inbound / outbound / schedule / …)
    → workflow-executor.ts → resolveWorkflowGraph()
    → runWorkflowGraph()
    → per-node registry execute()
```

**Key files:**

| File | Role |
|------|------|
| `workflow-executor.ts` | Entry: `executeWorkflowForTrigger`, `executeWorkflowNow`, `testWorkflowOnMessage` |
| `workflow-graph-resolve.ts` | Load graph; migrate legacy `definition_json` once |
| `graph-presets.ts` | Default seed graphs + blank canvas |
| `definition-to-graph.ts` | Legacy rules → graph migration |
| `templates.ts` | 13 importable templates (not auto-enabled) |
| `plugin-node-registry.ts` | Dynamic `plugin.<id>.<handler>` nodes |

### 4.2 Triggers — where they fire

| Trigger | Fired from | Notes |
|---------|------------|-------|
| `inbound` | `email-imap-sync.ts`, `email-pop3-sync.ts`, backfill IPC | After new message stored |
| `outbound` | `email-compose-send.ts` before SMTP | **Fail-closed**; see outbound section |
| `draft_created` | `CreateComposeDraft` IPC only | Not on every draft update |
| `schedule` | Per-workflow cron in `email-imap-services.ts` | Sync optional account, then **graph run** |
| `manual` | IPC `workflow:execute-now`, HTTP API | Desktop button in workflow shell |
| `crm.deal_stage_changed` | `sqlite-service` deal stage update | `workflow-trigger-dispatch.ts` |
| `task.due` / `calendar.event_start` | 2‑min global cron scan | 60s dedup window |

Direction mapping: `electron/workflow/workflow-trigger-utils.ts` (`workflowDirectionForTrigger`).

### 4.3 Outbound send pipeline

1. User clicks **Senden** → `sendComposeDraft()`.
2. `clearOutboundHoldForResend()`.
3. `evaluateOutboundWorkflows(payload)` — all enabled `outbound` workflows.
4. If blocked: `returnOutboundDraftToInbox()` — banner in body, `outbound_hold=1`, shows in **inbox** list.
5. Else SMTP + optional IMAP append + `markDraftAsSent()`.

**Dry-run check (no DB mutation):** IPC `email:validate-outbound` with `{ dryRun: true }`; Compose button **Ausgang prüfen**.

**Files:** `email-outbound-review.ts`, `email-outbound-review-parse.ts`, `email-outbound-threading.ts`.

### 4.4 Inbound spam pipeline (template `inbound-spam-ai`)

Typical chain: `email.sender_filter` → (whitelist | blacklist | default) → `ai.spam_score` → `logic.threshold` → `email.mark_spam`.

**Global threshold:** Settings → Automatisierung → spam score; node config `useGlobalThreshold: true` reads `workflow_spam_score_threshold` from `sync_info` via `automation-settings.ts`.

### 4.5 Automation REST API (PR #18)

- Local HTTP server in main process; docs: `API_V1.md`, `SECURITY_AUTOMATION_API.md`.
- Code: `electron/automation/*`, `electron/services/*`, UI `automation-panel.tsx`.
- **Separate from** graph workflows but can call `WorkflowApiService.execute()`.

---

## 5. Architecture — E-mail UI

| Area | Path |
|------|------|
| Mail workspace | `src/components/email/*`, `workspace-context.tsx` |
| Workflow editor | `src/components/email/workflow/*` |
| Settings | `src/components/email/settings/*` |
| IPC | `shared/ipc/channels.ts`, handlers `electron/ipc/email.ts`, `electron/ipc/workflow.ts` |

**Security choices:** Message **viewer** = plain text only (no HTML). **Compose** = Quill + DOMPurify on send.

---

## 6. Default & seeded data

On **empty** `email_workflows` table, seeds:

- **Eingehend: Amazon & Newsletter** — graph in `buildDefaultInboundGraph()`, not only JSON rules.
- **Ausgehend: Sensible Inhalte** — graph in `buildDefaultOutboundGraph()`.

**New workflow** in UI: blank graph (trigger only), `definition_json = {"version":1,"rules":[]}`.

**Migration:** Existing rows without `graph_json` → `migrateLegacyWorkflowsWithoutGraph()` on list/load (via `definition-to-graph.ts`).

---

## 7. Workflow templates (import only)

IDs in `electron/workflow/templates.ts`:

`inbound-invoice`, `outbound-quality-check`, `outbound-sensitive`, `inbound-attachments`, `agent-retoure`, `inbound-spam-ai`, `inbound-invoice-forward`, `inbound-routing-ki`, `schedule-inbox-sync`, `manual-ping-log`, `crm-deal-won-task`, `inbound-newsletter-archive`, `crm-task-from-mail`.

Templates are **not** auto-installed except the two defaults above.

---

## 8. IPC channels added in this effort (workflow)

| Channel | Purpose |
|---------|---------|
| `workflow:execute-now` | Run workflow now (manual/schedule/CRM; optional messageId) |
| `workflow:test-on-message` | Dry-run with message |
| `workflow:get/set-automation-settings` | Spam threshold, sender lists, IMAP delete opt-in |
| `email:validate-outbound` | Dry-run outbound workflows |

Full list: `shared/ipc/channels.ts`.

---

## 9. Test & build baseline

```bash
npm install --legacy-peer-deps
npm test                    # ~543 tests, 59 suites
npm run build:electron:main
npx eslint . --ext ts,tsx --max-warnings 0
```

**New unit tests (workflow):**

- `tests/unit/workflow-modular-graph.test.ts`
- `tests/unit/workflow-trigger-utils.test.ts`
- `tests/unit/workflow-scheduled-fire.test.ts`
- `tests/unit/workflow-automation-settings.test.ts`
- `tests/unit/email-outbound-review.test.ts`
- `tests/unit/workflow-spam-nodes.test.ts`, `workflow-sender-filter.test.ts`, …

**Headless Electron:** `xvfb-run --auto-servernum npm run electron:dev`

---

## 10. Known gaps (do not assume done)

| Item | Status |
|------|--------|
| E-mail snooze | ❌ |
| Inbox sort by priority tag | ❌ (tags only) |
| `draft_created` on draft **update** | ❌ |
| `webhook.incoming` trigger | ❌ planned |
| `crm.customer_created` trigger | ❌ |
| Full E2E for workflow canvas | ❌ |
| Registry nodes in `definition_json` export | ❌ by design — graph only |
| `WORKFLOW_VISION.md` 🔲 table | Often stale; trust **WORKFLOW_PHASES.md** |

---

## 11. Safe change checklist

Before merging workflow/e-mail changes:

- [ ] Outbound still **fail-closed** on engine errors.
- [ ] POP3 uses **UIDL**, not session message numbers as keys.
- [ ] List queries use `(uid >= 0 OR pop3_uidl IS NOT NULL)` OR `outbound_hold` draft exception for inbox.
- [ ] `evaluateOutboundWorkflows(..., { dryRun: true })` does not call `returnOutboundDraftToInbox`.
- [ ] Graph mode does not silently fall back to compiled unless `execution_mode === 'compiled'`.
- [ ] Plugin registry does not crash tests without Electron `app` (try/catch in `registerPluginWorkflowNodes`).

---

## 12. Suggested next tasks (if user asks)

1. Seed optional “recommended” workflows (spam + outbound) on first run — **disabled** by default.
2. UI hint when graph has registry-only nodes (“rules export empty”).
3. `draft_created` on significant draft updates (debounced).
4. Inbox sort by `priority:*` tags.
5. Webhook trigger + `POST /hooks/incoming` (see `EXTERNAL_AUTOMATION_API_PLAN.md`).
6. Merge **#19** after review; keep #17 closed in favor of #18+#19.

---

## 13. Git commands (agent)

```bash
git fetch origin cursor/email-workflow-spam-routing-d125
git checkout cursor/email-workflow-spam-routing-d125
git pull origin cursor/email-workflow-spam-routing-d125
```

Commit docs on same branch; push; update PR #19 body if scope changes.
