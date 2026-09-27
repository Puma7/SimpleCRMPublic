# Plan 049: Automation cockpit: human vs. AI share, approval queues, ai.decide answers, AI cost

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update this plan's row in
> `plans/README.md` (section "Runde 2") AND tick its checkbox in
> `plans/MASTERPLAN.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 9e0491e3..HEAD -- src/app/email/reporting/page.tsx src/components/email/mail-sidebar.tsx src/components/email/types.ts src/components/email/workspace-context.tsx src/components/email/hooks/use-email-messages.ts src/services/transport/channel-http-registry.ts shared/ipc/email-schemas.ts shared/email-done-filter.ts electron/email/email-reported-stats.ts electron/email/email-store.ts electron/email/email-crm-store.ts electron/services/email-api-service.ts electron/ipc/email.ts electron/sqlite-service.ts packages/server/src/db/postgres-email-reporting-port.ts packages/server/src/db/postgres-mail-read-ports.ts packages/server/src/db/postgres-mail-metadata-read-ports.ts packages/server/src/api/types.ts packages/server/src/api/mail-routes.ts packages/server/src/api/mail-metadata-routes.ts packages/server/src/migrations/index.ts packages/core/src/email/index.ts`
> On any change, compare the "Current state" excerpts with the live code; a mismatch is a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: direction (feature)
- **Planned at**: commit `9e0491e3`, 2026-09-27

## Why this matters

Partial automation (AI replies, AI decisions, outbound review) is live in both editions, but nobody can see *how much* it does. The "Auswertung" page shows mailbox totals and workflow runs per raw numeric id; the "sent by" provenance (`sent_by_kind`) is recorded on every sent mail but never aggregated; drafts waiting for approval or blocked by the outbound check can only be found by scanning the inbox for a row badge; AI cost is buried in Settings → Diagnose. The open "Automatisierungsquote" item (`docs/KI_SUPPORT_IMPLEMENTATION_PLAN.md:130`, `docs/FEATURE_REQUESTS_JTL_KI_SUPPORT.md:51`) is exactly this. After this plan an operator sees, per week, which share of sent mail was human / AI / automation, how often each workflow's KI-Entscheidung answered Ja/Nein/Unsicher/Fehler, how many drafts wait, and (server) 30-day AI cost — and can open the two queues from the sidebar.

## Audit corrections (verified at 9e0491e3)

- The ai.decide answer is **queryable without JSON**: `email_workflow_run_steps.port` holds `ja|nein|unsicher|error` and is **not** pruned — only `detail_json` is cleared after 30 days (server `packages/server/src/workflow-run-step-append.ts:78-116`, desktop `electron/workflow/run-steps.ts:91-105`). No new counters needed.
- **AI cost exists only on the server** (`ai_usage_events`, migration `0017`). The desktop has no usage table; the desktop card shows "nur Server-Edition".
- `sent_by_kind` values are `human | ai_auto | ai_approved | workflow | relay` (`packages/core/src/email/sent-provenance.ts:14-23`), NULL = legacy/unknown.

## Current state

- `src/app/email/reporting/page.tsx` — page "Auswertung". `Snapshot` type at lines 14-26; the workflow table (lines 176-207) prints `w.workflow_id` in a `font-mono` cell (line 198), no name.
- `electron/email/email-reported-stats.ts` — desktop `getEmailReportingSnapshot(accountIdFilter, access?)` (lines 28-119). Scope: `accountIdsForMailScopeAll(db, access)` → `null` (all) or allowed ids (lines 45-56). `workflowRuns24h` query (lines 93-104) ignores scope and account filter.
- `packages/server/src/db/postgres-email-reporting-port.ts` — server port; runs in `withWorkspaceTransaction(db, { workspaceId, role: 'system' }, …)` (lines 58-63); every query applies `mailScopePredicate(mailScope, {...columns})` (e.g. lines 165-172); workflow runs are scoped through `exists (select 1 from email_messages report_message … )` (lines 246-260) and grouped by `coalesce(workflow_source_sqlite_id, workflow_id, 0)` (line 234 — the id the renderer uses everywhere).
- `packages/server/src/api/types.ts:2384-2419` — `EmailReportingSnapshot` / `EmailReportingApiPort`; `packages/server/src/api/mail-routes.ts:2050-2064` handler, `:3660-3690` `sanitizeEmailReportingSnapshot`; the mail-scope is injected by `packages/server/src/mail-access/http-policy-enforcer.ts:650-652` (`scopedInput`), policy `mail.metadata.read` (`policy-manifest.ts:348-357`).
- `src/services/transport/channel-http-registry.ts:518-544` (`EmailReportingRecord`), `:2046-2059` (route), `:5995-6031` (`mapEmailReportingSnapshot`, camelCase → the page's snake_case for accounts/workflow rows).
- `packages/server/src/db/postgres-mail-diagnostics-port.ts:344-360` — `selectAiUsageTotals` (count, `sum(total_tokens)`, `sum(est_cost_micro_usd)`); reuse its SQL shape.
- Sidebar: `src/components/email/mail-sidebar.tsx:38-57` `FOLDERS`; the virtual view `sent_ai` ("Gesendet (KI)") is `{ id: "sent_ai", label: "Gesendet (KI)", icon: Bot, nested: true }` (line 50), no counter, not in `DROPPABLE_FOLDER_VIEWS` (line 36).
- How `sent_ai` works end to end (commits `5cdd0be1`, `e0da4abe`) — every file below lists the view id; the two new views must be added to **each**:
  - Renderer: `src/components/email/types.ts:5-16` (`MailView`), `workspace-context.tsx:209-220` (`VALID_MAIL_VIEWS`, localStorage restore), `hooks/use-email-messages.ts:555-566` and `:659-670` (label maps typed `Record<MailView,string>`), `mail-sidebar.tsx:50`, `src/services/transport/channel-http-registry.ts:6981-7002` (`messageViewValue` / `optionalMessageViewValue`).
  - Shared IPC: `shared/ipc/email-schemas.ts:36-48` (`accountMailViewSchema`), `shared/email-done-filter.ts:10-21` (type only). `MoveMessageToView` (`email-schemas.ts:599-605`) must NOT accept the new ids.
  - Desktop: `electron/email/email-store.ts:645-661` (`AccountMailView`, `SENT_AI_VIEW_SQL`), `:764-765` and `:852-853` (list branches), `:2094-2097` (move → throws "Dieser Ordner unterstützt kein Verschieben per Drag & Drop"); `electron/email/email-crm-store.ts:1284-1285` (search `viewFilterClause`); `electron/services/email-api-service.ts:18-30` (`ALLOWED_VIEWS`); `electron/ipc/email.ts:1012` and `:1040` (payload types).
  - Server: `packages/server/src/db/postgres-mail-read-ports.ts:3645-3706` (`applyMessageViewFilter`, `sent_ai` at 3673-3679), `packages/server/src/db/postgres-mail-metadata-read-ports.ts:930-975` (`threadMessageViewPredicate`, `sent_ai` at 948-951), `packages/server/src/api/mail-routes.ts:5638-5643`, `packages/server/src/api/mail-metadata-routes.ts:4122-4140` and the `view?:` unions in `mail-metadata-routes.ts:2799`, `api/types.ts:2799` and `:3284`.
- Existing semantics to mirror (desktop `email-store.ts:733-737`, server `postgres-mail-read-ports.ts:3663-3667`): a draft waiting for approval is `uid < 0 AND folder_kind = 'draft' AND approval_state = 'pending' AND <not scheduled>`; a blocked draft is `uid < 0 AND folder_kind = 'draft' AND outbound_hold = 1/true`. The row badge "Freigabe" is `src/components/email/message-list.tsx:965-972`; "Entwurf — Ausgang blockiert" is line 959-962.
- ai.decide answers: ports `ja|nein|unsicher|error` (`packages/core/src/workflow/ai-decide.ts:10-14`); dry runs write `message = AI_DECIDE_DRY_RUN_SUMMARY` = `'Testlauf: keine KI-Anfrage'` (line 34) with port `unsicher` — exclude them. On the server the async job writes the result step with `status` `ok|error|skipped` and `port` (`workflow-ai-decide.ts:366-380`); the enqueue step has no answer port.
- Conventions: German UI strings and comments; tests for desktop SQL use a real in-memory DB (`tests/mail/email-sent-ai-view.test.ts:1-60`); Postgres integration tests use `startMigratedEmbeddedPostgres` (`tests/integration/postgres-sent-provenance.test.ts:1-40`).

## Commands you will need

Prefix every command with `export PATH=/opt/node24/bin:$PATH;`.

| Purpose | Command | Expected |
|---|---|---|
| Install | `pnpm install` | exit 0 |
| Build packages (before server/Postgres tests) | `pnpm run build:packages` | exit 0 |
| Typecheck | `pnpm run typecheck` | exit 0 |
| Lint | `pnpm run lint` | exit 0, 0 warnings |
| Focused test | `pnpm exec jest <file>` | all pass |
| Unit / integration | `pnpm run test:unit` / `pnpm run test:integration` | all pass |
| Mail suite | `pnpm run test:mail` then `pnpm run test:mail:coverage` | pass, ratchet ok |
| Server coverage | `pnpm run test:server:coverage && node scripts/check-server-coverage-ratchet.mjs` | pass |
| UI coverage | `pnpm run test:ui:coverage:check` | pass |

Postgres tests refuse to run as root: `chmod -R a+rwX .tmp-tests tests packages/core/dist packages/server/dist` then `su tester -s /bin/bash -c "export PATH=/opt/node24/bin:\$PATH; cd /home/user/SimpleCRMPublic && node_modules/.bin/jest --cacheDirectory /tmp/jest-tester --forceExit <file>"`. New Postgres test files must contain `jest.mock('kysely', () => jest.requireActual('../../packages/server/node_modules/kysely'))`.

## Scope

**In scope**: all files listed under "Current state", plus (create) `packages/core/src/email/automation-cockpit.ts`, `electron/email/email-automation-cockpit.ts`, `packages/server/src/migrations/00NN_workflow_run_step_ai_decide_index.ts` (NN = next free number, `0061` if unused), `tests/unit/automation-cockpit-core.test.ts`, `tests/mail/email-automation-cockpit.test.ts`, `tests/mail/email-approval-views.test.ts`, `tests/integration/postgres-automation-cockpit.test.ts`, `tests/unit/approval-views-ui.test.tsx`; edits to `tests/mail/email-reported-stats.test.ts`, `tests/unit/server-email-reporting-api.test.ts`, `tests/unit/renderer-transport.test.ts`, `tests/unit/server-edition-foundation.test.ts` (migration list), `docs/USER_GUIDE_EMAIL.md`, `docs/WORKFLOW_PHASES.md`, `CHANGELOG.md`.

**Out of scope**: counters for the new sidebar views (like `sent_ai`, they have none — see Maintenance); a new API route or IPC channel (the cockpit rides on the existing `EmailReporting` channel / `GET /api/v1/email/reporting`); probability histograms and accuracy (plan 050); desktop AI usage tracking; changing `workflowRuns24h` scoping semantics beyond adding the name; budget limits display (`ai-budget.ts`).

## Git workflow

- Branch `advisor/049-automation-cockpit`. Commits in German, imperative, area prefix, e.g. `Postfach: Ansichten „Wartet auf Freigabe“ und „Versand blockiert“`, `Auswertung: Anteil Mensch/KI, KI-Entscheidungen und KI-Kosten`.
- Do NOT push or open a PR unless the operator says so.

## Steps

### Phase A — two sidebar views (both editions)

#### Step 1: Desktop view ids `approval_pending` and `outbound_blocked`

In `electron/email/email-store.ts` next to `SENT_AI_VIEW_SQL` add and export:

```ts
/** „Wartet auf Freigabe“: KI-Entwürfe mit neutralem Freigabe-Zustand (wie im Posteingang). */
export const APPROVAL_PENDING_VIEW_SQL = `m.uid < 0 AND m.folder_kind = 'draft' AND m.approval_state = 'pending' AND (m.scheduled_send_at IS NULL OR m.scheduled_send_at = '')`;
/** „Versand blockiert“: vom Ausgang angehaltene Entwürfe. */
export const OUTBOUND_BLOCKED_VIEW_SQL = `m.uid < 0 AND m.folder_kind = 'draft' AND m.outbound_hold = 1`;
```

Add both ids to `AccountMailView`, add `else if` branches in `listMessagesForAccountView` and `listMessagesForAllAccountsView` (same place as `sent_ai`), add both to the throwing case list in `moveMessageToMailView`, to `viewFilterClause` in `email-crm-store.ts` (prefix `m.soft_deleted = 0 AND `), to `ALLOWED_VIEWS` in `email-api-service.ts`, to the payload unions in `electron/ipc/email.ts`, to `accountMailViewSchema` in `shared/ipc/email-schemas.ts` and to `MailViewForDone` in `shared/email-done-filter.ts`. Do not touch `MoveMessageToView`'s enum.

Write `tests/mail/email-approval-views.test.ts` modelled on `tests/mail/email-sent-ai-view.test.ts` (real `:memory:` DB, same `ALTER TABLE` preamble plus `outbound_hold` is already in `createEmailMessagesTable`). Seed: a pending draft, a scheduled pending draft (excluded), a held draft, a held + pending draft (in both), a sent mail, a soft-deleted held draft (excluded). Assert list per account, all-accounts list, view-bound search (`searchMessagesForAccountWithMeta(1, '<term>', { view: 'approval_pending' })`), `moveMessageToMailView(1, 'outbound_blocked')` throws, and `accountMailViewSchema` accepts the ids via the ListMessagesByView schema while `MoveMessageToView` rejects them (pattern: `tests/unit/sent-ai-view-ipc-schema.test.ts`).

**Verify**: `pnpm exec jest tests/mail/email-approval-views.test.ts` → all pass; `pnpm run typecheck` → exit 0.

#### Step 2: Server view ids

In `applyMessageViewFilter` (`postgres-mail-read-ports.ts`) add:

```ts
if (view === 'approval_pending') {
  return query.where(kyselySql<boolean>`(uid < 0 AND folder_kind = 'draft' AND approval_state = 'pending' AND scheduled_send_at IS NULL)`);
}
if (view === 'outbound_blocked') {
  return query.where(kyselySql<boolean>`(uid < 0 AND folder_kind = 'draft' AND outbound_hold = true)`);
}
```

Mirror in `threadMessageViewPredicate` (alias `m.`, with `m.soft_deleted = false AND ${inactiveSnooze} AND …`). Extend `parseOptionalMessageView` (`mail-routes.ts`), `parseOptionalThreadView` (`mail-metadata-routes.ts`, both the return-type union and the `isOneOf` list) and the `view?:` unions in `api/types.ts` and `mail-metadata-routes.ts`. Add route tests next to the `sent_ai` one in `tests/unit/server-mail-outbound-hold-routes.test.ts:121-150` (view reaches the port; unknown view → 400).

**Verify**: `pnpm exec jest tests/unit/server-mail-outbound-hold-routes.test.ts` → pass; `pnpm run typecheck` → exit 0.

#### Step 3: Renderer

`types.ts` `MailView` + both label maps in `use-email-messages.ts` (`approval_pending: "Wartet auf Freigabe"`, `outbound_blocked: "Versand blockiert"`), `VALID_MAIL_VIEWS`, `messageViewValue`/`optionalMessageViewValue`. In `mail-sidebar.tsx` import `Hourglass` and `Ban` from `lucide-react` and insert directly after `drafts`:

```ts
// Warteschlangen der Teilautomatisierung (Entwürfe; kein Zähler, kein Ablageziel).
{ id: "approval_pending", label: "Wartet auf Freigabe", icon: Hourglass, nested: true },
{ id: "outbound_blocked", label: "Versand blockiert", icon: Ban, nested: true },
```

Create `tests/unit/approval-views-ui.test.tsx` modelled on `tests/unit/sent-provenance-ui.test.tsx:100-175`: both entries follow "Entwürfe", click calls `setMailView('approval_pending'|'outbound_blocked')`, they are not drop targets, localStorage restores them. Add a transport test (pattern `tests/unit/renderer-transport-outbound-provenance.test.ts:86-110`) that `view=approval_pending` reaches the URL.

**Verify**: `pnpm exec jest tests/unit/approval-views-ui.test.tsx tests/unit/renderer-transport-outbound-provenance.test.ts` → pass; `pnpm run test:ui:coverage:check` → pass; touchpoint check `grep -rln "sent_ai" shared electron packages/server/src src | xargs grep -L "approval_pending"` → **no output** (every file that knows `sent_ai` now also knows the new ids; any listed file is a missed touchpoint).

### Phase B — cockpit data and card

#### Step 4: Core helper

Create `packages/core/src/email/automation-cockpit.ts` (export it from `packages/core/src/email/index.ts`), pure, no I/O:

```ts
export const AUTOMATION_COCKPIT_WEEKS = 8;
export const AUTOMATION_COCKPIT_DECIDE_DAYS = 30;
export type SentKindDayRow = { day: string; kind: string | null; count: number }; // day = YYYY-MM-DD (UTC)
export type SentKindWeek = { weekStart: string; human: number; aiAuto: number; aiApproved: number; workflow: number; relay: number; unknown: number };
export type AiDecideAnswerRow = { workflowId: number; workflowName: string | null; port: string; count: number };
export type AiDecideWorkflowSummary = { workflowId: number; workflowName: string | null; ja: number; nein: number; unsicher: number; error: number; total: number };
export type AutomationCockpitSnapshot = {
  sentByKindWeekly: SentKindWeek[];
  pendingApproval: number;
  outboundBlocked: number;
  aiDecideByWorkflow30d: AiDecideWorkflowSummary[];
  /** null: Desktop (keine Nutzungsdaten) oder eingeschränkte Mail-Sicht. */
  aiCost30d: { costMicroUsd: number; events: number } | null;
};
export function automationWindowStart(now: Date, weeks?: number): Date; // Montag 00:00 UTC der ältesten Woche
export function bucketSentByKindWeekly(rows: readonly SentKindDayRow[], now: Date, weeks?: number): SentKindWeek[]; // genau `weeks` Einträge, alt→neu, mit Nullen
export function automatedShare(week: SentKindWeek): number | null; // (aiAuto+aiApproved+workflow)/(human+aiAuto+aiApproved+workflow), relay/unknown zählen nicht; null bei 0
export function summarizeAiDecideAnswers(rows: readonly AiDecideAnswerRow[], limit?: number): AiDecideWorkflowSummary[]; // unbekannte Ports ignorieren, nach total absteigend, max 30
```

Unknown `kind` values (not in `SENT_BY_KINDS`) count as `unknown`. Test `tests/unit/automation-cockpit-core.test.ts`: week boundaries (Sunday 23:59 UTC vs Monday 00:00), zero-filled weeks, rows outside the window ignored, share null on empty week, relay excluded from share, unknown port ignored, sort + limit.

**Verify**: `pnpm exec jest tests/unit/automation-cockpit-core.test.ts` → pass; `pnpm run build:packages` → exit 0.

#### Step 5: Desktop data

Create `electron/email/email-automation-cockpit.ts` exporting `getAutomationCockpitSnapshot(db, scope: { accountIds: readonly number[] | null }, now = new Date()): AutomationCockpitSnapshot`. `accountIds === null` → no filter; `[]` → all zero. Queries (table constants from `../database-schema`):

1. `SELECT date(COALESCE(m.date_received, m.created_at)) AS day, m.sent_by_kind AS kind, COUNT(*) AS count FROM email_messages m WHERE m.folder_kind = 'sent' AND m.is_spam = 0 AND datetime(COALESCE(m.date_received, m.created_at)) >= datetime(?) [AND m.account_id IN (…)] GROUP BY day, kind` (soft-deleted sent mail still counts — it was sent).
2. `SELECT SUM(CASE WHEN ${APPROVAL_PENDING_VIEW_SQL} THEN 1 ELSE 0 END) …, SUM(CASE WHEN ${OUTBOUND_BLOCKED_VIEW_SQL} THEN 1 ELSE 0 END) … FROM email_messages m WHERE m.soft_deleted = 0 [scope]` — reuse the Step 1 constants so counts equal the views.
3. `SELECT r.workflow_id AS workflowId, w.name AS workflowName, s.port AS port, COUNT(*) AS count FROM email_workflow_run_steps s JOIN email_workflow_runs r ON r.id = s.run_id LEFT JOIN email_workflows w ON w.id = r.workflow_id WHERE s.node_type = 'ai.decide' AND s.status IN ('ok','error') AND s.port IN ('ja','nein','unsicher','error') AND COALESCE(s.message, '') <> ? AND datetime(s.created_at) >= datetime(?) [AND r.message_id IN (SELECT id FROM email_messages WHERE account_id IN (…))] GROUP BY r.workflow_id, w.name, s.port` with `AI_DECIDE_DRY_RUN_SUMMARY`.
4. `aiCost30d: null`.

In `getEmailReportingSnapshot` build the scope (`accountIdFilter != null ? [accountIdFilter] : allowed`), add `automation: getAutomationCockpitSnapshot(db, scope)` to the result type and return value, and add `workflow_name` to `workflowRuns24h` via `LEFT JOIN email_workflows w ON w.id = r.workflow_id` (alias the runs table `r`). In `electron/sqlite-service.ts`, right after the `ensureMigrationTable(EMAIL_WORKFLOW_RUN_STEPS_TABLE, …)` call (line ~1149-1151), add an **unconditional** `conn.exec(\`CREATE INDEX IF NOT EXISTS idx_wf_run_steps_type_created ON ${EMAIL_WORKFLOW_RUN_STEPS_TABLE}(node_type, created_at);\`)` — `ensureMigrationTable` only creates indexes for new tables.

Tests: `tests/mail/email-automation-cockpit.test.ts` (real in-memory DB with `createEmailMessagesTable`, `createEmailWorkflowsTable`, `createEmailWorkflowRunsTable`, `createEmailWorkflowRunStepsTable` + the `ALTER TABLE` preamble and `ensureSentProvenanceColumns`): kinds per week, scope filter, dry-run step excluded, `skipped` step excluded, step older than 30 days excluded, name join, pending/blocked counts equal the view list lengths from Step 1. In `tests/mail/email-reported-stats.test.ts` add `jest.mock('../../electron/email/email-automation-cockpit', () => ({ getAutomationCockpitSnapshot: jest.fn(() => ({ …empty… })) }))` so the existing mocked-statement sequence stays valid, and assert `automation` is present.

**Verify**: `pnpm exec jest tests/mail/email-automation-cockpit.test.ts tests/mail/email-reported-stats.test.ts` → pass; `pnpm run test:mail:coverage` → ratchet ok.

#### Step 6: Server data

- `api/types.ts`: add `automation: AutomationCockpitSnapshot` (import the type from `@simplecrm/core`) and `workflowName: string | null` to `workflowRuns24h` rows.
- `postgres-email-reporting-port.ts`: add `selectAutomationCockpit(trx, workspaceId, accountId, now, mailScope)` to the `Promise.all` in `collectReporting`. Same three queries as Step 5 in Kysely/`kyselySql`, each with `where('workspace_id', '=', workspaceId)`, the account filter and `mailScopePredicate(...)` exactly as `selectReportingTotals` does (for run steps: the `exists (select 1 from email_messages report_message …)` form of `selectReportingWorkflowRuns24h`, plus `s.workspace_id = r.workspace_id`). Day bucket: `to_char((coalesce(date_received, created_at) at time zone 'UTC')::date, 'YYYY-MM-DD')`. Workflow id: `coalesce(r.workflow_source_sqlite_id, r.workflow_id, 0)`, name: `left join email_workflows w on w.workspace_id = r.workspace_id and w.id = r.workflow_id`. AI cost: only when `mailScopePredicate(mailScope, …)` returns `undefined` (full access): `select count(*), coalesce(sum(est_cost_micro_usd),0) from ai_usage_events where workspace_id = … and created_at >= now-30d` (shape of `selectAiUsageTotals`); otherwise `null`. Also add `w.name` to `selectReportingWorkflowRuns24h` (group by id and name).
- Migration `packages/server/src/migrations/00NN_workflow_run_step_ai_decide_index.ts` (pattern: `0060_workflow_run_step_detail_retention_index.ts`): `CREATE INDEX IF NOT EXISTS email_workflow_run_steps_ai_decide_idx ON email_workflow_run_steps (workspace_id, created_at) WHERE node_type = 'ai.decide';` / down `DROP INDEX IF EXISTS …`. Register in `migrations/index.ts` and append the id to the list in `tests/unit/server-edition-foundation.test.ts` (after `'0060_workflow_run_step_detail_retention_index'`, or after the last id present).
- `mail-routes.ts` `sanitizeEmailReportingSnapshot`: pass `automation` through with `safeCount` on every number, names sliced to 200 chars, weeks limited to 12, workflows to 30, `aiCost30d` null-preserving.
- Tests: extend `tests/unit/server-email-reporting-api.test.ts` (sanitizer keeps/clamps automation). Create `tests/integration/postgres-automation-cockpit.test.ts` (pattern `postgres-sent-provenance.test.ts`): two workspaces; RLS — workspace B's rows never counted; restricted `mailScope` (`{ kind: 'restricted', accountIds: [A1], folderIds: [], messageIds: [] }`) hides account A2 and yields `aiCost30d === null`; `kind: 'all'` returns cost; `approval_pending`/`outbound_blocked` list via `createPostgresEmailMessageReadPort(...).list({ view })` equals the counts.

**Verify**: `pnpm run build:packages` → 0; `pnpm exec jest tests/unit/server-email-reporting-api.test.ts tests/unit/server-edition-foundation.test.ts` → pass; the integration file via the `su tester` command → pass.

#### Step 7: Transport and card

- `channel-http-registry.ts`: extend `EmailReportingRecord` and `mapEmailReportingSnapshot` (`automation` with `countValue`, missing → empty snapshot; `workflow_name` on workflow rows). Extend the test at `tests/unit/renderer-transport.test.ts:3937-3990`.
- `page.tsx`: extend `Snapshot`; workflow table shows `w.workflow_name ?? \`Workflow #${w.workflow_id}\``. Add a Card "Automatisierung" above "Workflow-Läufe (24h)": a table of the 8 weeks (columns "Woche ab", "Mensch", "KI automatisch", "KI freigegeben", "Automatik", "Relay", "Anteil automatisch" as `xx %` or "–"); two figures "Wartet auf Freigabe" and "Versand blockiert"; a table "KI-Entscheidungen (30 Tage)" per workflow (Ja / Nein / Unsicher / KI-Fehler / Summe); "KI-Kosten (30 Tage)" formatted like `formatUsd` in `diagnostics-panel.tsx:96-101`, or the hint "Nur in der Server-Edition bzw. mit Vollzugriff verfügbar." when `aiCost30d` is null. Plain tables, no chart library.

**Verify**: `pnpm exec jest tests/unit/renderer-transport.test.ts` → pass; `pnpm run typecheck && pnpm run lint` → exit 0.

#### Step 8: Docs and changelog

`docs/USER_GUIDE_EMAIL.md` (line 30 view list + a short paragraph after the "Gesendet (KI)" section at line 66; a paragraph on "Auswertung → Automatisierung"), `docs/WORKFLOW_PHASES.md` (next to the `sent_ai` line 100). CHANGELOG `[Unreleased]` → `### Added`: `**Beide Editionen:**` entry in the tone of the existing ones.

**Verify**: `git diff --stat` lists only in-scope files.

## Test plan

New: `tests/unit/automation-cockpit-core.test.ts`, `tests/mail/email-approval-views.test.ts`, `tests/mail/email-automation-cockpit.test.ts`, `tests/unit/approval-views-ui.test.tsx`, `tests/integration/postgres-automation-cockpit.test.ts`. Extended: `email-reported-stats.test.ts`, `server-email-reporting-api.test.ts`, `server-mail-outbound-hold-routes.test.ts`, `renderer-transport.test.ts`, `renderer-transport-outbound-provenance.test.ts`, `server-edition-foundation.test.ts`. Cases that must exist: dry-run ai.decide excluded; restricted scope hides other accounts and AI cost; RLS isolation; counts equal view lists; week bucketing edges.

## Done criteria

- [ ] `pnpm run typecheck` and `pnpm run lint` exit 0
- [ ] `pnpm run test:unit`, `pnpm run test:mail`, `pnpm run test:mail:coverage`, `pnpm run test:ui:coverage:check` pass
- [ ] `tests/integration/postgres-automation-cockpit.test.ts` passes (as non-root)
- [ ] `pnpm run test:server:coverage && node scripts/check-server-coverage-ratchet.mjs` passes
- [ ] `grep -rn "approval_pending" shared/ipc/email-schemas.ts electron/email/email-store.ts packages/server/src/db/postgres-mail-read-ports.ts packages/server/src/db/postgres-mail-metadata-read-ports.ts src/components/email/mail-sidebar.tsx` → a match in every file
- [ ] `git status` shows only in-scope files; README row + MASTERPLAN checkbox updated

## STOP conditions

- The run-step `port` column is no longer written for ai.decide results (plans 024/034 may touch that path) — the aggregate would silently read zero.
- Adding the views requires a Postgres migration other than the index (e.g. a missing `approval_state` column on some deployment).
- The server reporting handler no longer receives `mailScope` through the policy enforcer, or `mailScopePredicate` semantics changed.
- `tests/mail/email-reported-stats.test.ts` cannot be kept green without rewriting it — report instead of rewriting.
- The next free migration number is claimed by an unmerged plan branch you know of — coordinate instead of guessing.

## Maintenance notes

- Counters for the two views need `MailFolderCounts` changes in both editions and the transport (`use-mail-folder-counts.ts`); deliberately deferred to keep parity with `sent_ai`.
- Plan 050 adds probabilities/accuracy per decision node and may show them in this card; keep `AutomationCockpitSnapshot` additive.
- Workflow names are now visible to anyone with `mail.metadata.read` on the report; if that is unwanted, gate `workflowName` behind the workflow read permission.
- Desktop `workflowRuns24h` still ignores mail scope and account filter (pre-existing); the new queries honour both.
- Reviewer focus: every new server query has `workspace_id = …` AND the scope predicate; the counts use the exact view predicates.
