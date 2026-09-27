# Plan 046: Show every automation run of a mail in its Details panel ("Was ist mit dieser Mail passiert?")

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update this plan's row in
> `plans/README.md` (section "Runde 2") AND tick its checkbox in
> `plans/MASTERPLAN.md`.
>
> **Drift check (run first)**:
> `git diff --stat 9e0491e3..HEAD -- shared/ipc/channels.ts shared/ipc/email-schemas.ts electron/ipc/email.ts electron/workflow/run-steps.ts src/services/transport/channel-http-registry.ts src/components/email/message-metadata-panel.tsx src/components/email/message-viewer.tsx src/components/email/mail-shell.tsx src/components/email/workflow/workflow-run-detail-dialog.tsx packages/core/src/workflow/run-step-detail.ts tests/integration/ipc-email-account-scope-inventory.test.ts tests/integration/sqlite-workflow-run-step-detail.test.ts tests/unit/renderer-transport.test.ts docs/USER_GUIDE_WORKFLOWS.md`
> On any change, compare the "Current state" excerpts with HEAD; mismatch → STOP.

## Status

- **Priority**: P2
- **Effort**: S–M
- **Risk**: LOW
- **Depends on**: none (plan 047 later adds a `dry_run` flag to runs; see Maintenance notes)
- **Category**: direction (feature)
- **Planned at**: commit `9e0491e3`, 2026-09-27

**Corrections to the audit brief**: the server route is *registered* in
`packages/server/src/api/workflow-routes.ts:89` but *handled* in
`packages/server/src/api/workflow-runtime-routes.ts:139-140`
(`handleMessageScopedRuns`, :299-307). The existing `WorkflowRunDetailDialog` is
already mounted in `message-viewer.tsx:1932-1936` (used by the outbound-hold
banner), not only in `apply-workflow-menu.tsx`. Continuations exist **only on the
server**; the desktop never records `continuedFrom`. **No server code change is
needed.**

## Why this matters

Today a user who wonders why a mail was tagged, moved, held or not answered must
open Workflows → pick the right workflow → scan its run history. The reader only
reaches the *latest* run, and only from the "Versand blockiert" banner. A
collapsible "Automatik" section in the mail's Details panel listing every run
(workflow, status, chosen exit, KI-Entscheidung summary/probability, grouped with
its "Fortsetzung") answers "Was ist mit dieser Mail passiert?" in one click.

## Current state

- Server: `GET /api/v1/email/messages/:messageId/workflow-runs` →
  `handleWorkflowRunList(req, ports, { messageId })`
  (`workflow-runtime-routes.ts:649-670`). GET requires `workflows.view`
  (`:112-117`, `rejectUnlessWorkflowView`) and the mail policy requires
  `mail.content.read` on the message (`packages/server/src/mail-access/policy-manifest.ts:452`).
  Items are `WorkflowRunRecord` (`packages/server/src/api/types.ts:4338-4351`:
  `id, sourceSqliteId, workflowSourceSqliteId, messageSourceSqliteId, workflowId,
  messageId, direction, status, log?, startedAt, finishedAt, updatedAt`), paged by
  `cursor`, ordered `id asc`. Worker-created runs store `source_sqlite_id = -id`
  (`packages/server/src/workflow-execution.ts:1575-1583`).
- Steps: `GET /api/v1/workflow-runs/by-source/:id/steps?includeDetail=true`, used
  by the renderer channel `ListWorkflowRunSteps`
  (`src/services/transport/channel-http-registry.ts:3571-3584`), redacted per
  viewer; `output.result` keeps `answer, probability, confidence, summary, reason`
  (`packages/core/src/workflow/run-step-detail.ts:492-498`).
- Renderer latest-run channel (`channel-http-registry.ts:3538-3549`):
  ```ts
  [IPCChannels.Email.GetLatestWorkflowRunForMessage, ([payload]) => { …
      path: `/api/v1/email/messages/${messageId}/workflow-runs`,
      query: { limit: DEFAULT_LIST_LIMIT },
      transform: async (body, context) => { const latest = await collectLatestWorkflowRunFromFirstPage(body, context, messageId)
        return latest ? mapWorkflowRunRecord(latest) : null } } }],
  ```
  `mapWorkflowRunRecord` (:6500-6515) maps `id: sourceSqliteId ?? id`,
  `workflow_id: workflowSourceSqliteId ?? workflowId`. `collectPagedListItems`
  (:4843) pages any list; `context.fetchJson(spec)` issues extra GETs.
- Desktop query `electron/workflow/run-steps.ts:108-129`
  (`getLatestWorkflowRunForMessage`: `… WHERE message_id = ? ORDER BY id DESC LIMIT 1`);
  `listWorkflowRunSteps(runId)` (:79-89) returns parsed `detail`. Desktop IPC
  registration `electron/ipc/email.ts:1336-1345`:
  ```ts
  registerIpcHandler(IPCChannels.Email.GetLatestWorkflowRunForMessage,
    async (_event, payload: { messageId: number }) => {
      const { getLatestWorkflowRunForMessage } = await import('../workflow/run-steps.js');
      return getLatestWorkflowRunForMessage(payload.messageId);
    }, { logger, accountAccess: 'ro' })
  ```
  A `{ messageId }` payload is account-scoped automatically
  (`electron/ipc/ipc-account-scope.ts:152-156, 333-334`). The preload allowlist is
  built from all `IPCChannels.Email` values, so a new channel there is allowed
  automatically. Every Email channel needs payload+result schemas
  (`tests/integration/ipc-contracts.test.ts:412-418`); every `'ro'` channel must be
  listed in `READ_ONLY_CHANNELS` of
  `tests/integration/ipc-email-account-scope-inventory.test.ts:186-240`.
- Channel constants: `shared/ipc/channels.ts:274`
  (`GetLatestWorkflowRunForMessage: 'email:get-latest-workflow-run-for-message'`);
  schema `shared/ipc/email-schemas.ts:450-461`.
- Continuations (server only): `packages/server/src/workflow-ai-decide.ts:503-548`
  enqueues the follow-up run with variable `__continued_from = "<runId>|<nodeId>|<port>"`
  where `runId` is the **raw Postgres id** (positive). The first step of that run
  carries `detail.continuedFrom = { runId, nodeId?, port? }`
  (`workflow-execution.ts:7749-7767`). The deferred ai.decide result is appended
  to the *original* run as an `ai.decide` step with `port = answer` and
  `detail.output.result = { answer, probability, confidence, reason?, summary }`
  (`workflow-ai-decide.ts:371-420`). Desktop ai.decide steps carry
  `message = summary` and `detail.output.variables['ai.decide.answer'|'ai.decide.probability'|'ai.decide.summary']`
  (`packages/core/src/workflow/ai-decide.ts:163-172`). Queued placeholders are
  recognisable via `isDeferredWorkflowStepMessage` (`shared/workflow-run-humanize.ts:126`).
- UI: `MessageMetadataPanel` (`src/components/email/message-metadata-panel.tsx`,
  rendered by `message-viewer.tsx:1820-1830` inline and `mail-shell.tsx:424-434`
  as a column) has `<Accordion type="multiple">` with items `security`, `tags`,
  `tech` (:686-918). It does **not** call `useAuth` (and its test
  `tests/unit/message-metadata-panel-security-stale.test.tsx` does not mock auth —
  `useAuth` throws outside a provider, `src/components/auth/auth-context.tsx:529-533`).
  `useAuth().canViewWorkflows` is true on desktop and requires `workflows.view` on
  the server (`auth-context.tsx:385-388`). `message-viewer.tsx:260` already has it;
  `mail-shell.tsx:58` destructures only `hasMailPermissionForAccount`.
- `WorkflowRunDetailDialog({ runId, open, onOpenChange, title? })`
  (`src/components/email/workflow/workflow-run-detail-dialog.tsx:48-53`) loads
  steps + log by the mapped run id.
- FAQ to update: `docs/USER_GUIDE_WORKFLOWS.md:434-445` ("Warum wurde auf eine
  Mail nicht automatisch geantwortet?").

## Commands you will need

Prefix every command with `export PATH=/opt/node24/bin:$PATH;`.

| Purpose | Command | Expected |
|---|---|---|
| Install | `pnpm install` | exit 0 |
| Typecheck (all) | `pnpm run typecheck` | exit 0 |
| Lint | `pnpm run lint` | exit 0, 0 warnings |
| Focused test | `pnpm exec jest tests/unit/workflow-run-message-history.test.ts tests/unit/message-automation-history.test.tsx tests/unit/message-metadata-panel-security-stale.test.tsx tests/integration/sqlite-workflow-run-step-detail.test.ts tests/integration/ipc-email-account-scope-inventory.test.ts tests/integration/ipc-contracts.test.ts` | all pass |
| Transport test | `pnpm exec jest tests/unit/renderer-transport.test.ts -t "workflow runs for message"` | pass |
| Unit / integration | `pnpm run test:unit` / `pnpm run test:integration` | all pass |
| UI coverage ratchet | `pnpm run test:ui:coverage:check` | pass |

## Scope

**In scope**: `shared/workflow-run-message-history.ts` (create),
`shared/ipc/channels.ts`, `shared/ipc/email-schemas.ts`, `electron/workflow/run-steps.ts`,
`electron/ipc/email.ts`, `src/services/transport/channel-http-registry.ts`,
`src/components/email/message-automation-history.tsx` (create),
`src/components/email/message-metadata-panel.tsx`, `src/components/email/message-viewer.tsx`,
`src/components/email/mail-shell.tsx`, the tests named in the Test plan,
`docs/USER_GUIDE_WORKFLOWS.md`, `CHANGELOG.md`.

**Out of scope**: any file under `packages/server/` (route, permissions and
redaction already correct); `workflow-run-detail-dialog.tsx` (reuse as is);
`GetLatestWorkflowRunForMessage` (keep; the outbound banner uses it); desktop
continuation support.

## Git workflow

Branch `advisor/046-mail-automation-history-in-reader`. German commits, e.g.
`Lesefenster: Automatik-Läufe einer Mail im Details-Panel`. Do not push.

## Steps

### Step 1: Pure summarizer in `shared/workflow-run-message-history.ts` (test first)

Create `tests/unit/workflow-run-message-history.test.ts` first, then the module:

```ts
export type MessageWorkflowRunSummary = {
  id: number                 // id the UI passes to ListWorkflowRunSteps / the dialog
  server_id: number          // raw server id (desktop: = id); continuations point at it
  workflow_id: number | null
  workflow_name: string
  direction: string
  status: string
  started_at: string | null
  finished_at: string | null
  last_step: { node_type: string; status: string; port: string | null } | null
  decision: { answer: string | null; probability: number | null; summary: string | null } | null
  continued_from_run_id: number | null   // server_id of the parent run
}
export function summarizeRunSteps(steps: ReadonlyArray<{ node_type: string; status: string; port: string | null; message: string | null; detail?: unknown }>): Pick<MessageWorkflowRunSummary, 'last_step' | 'decision' | 'continued_from_run_id'>
export function groupRunsWithContinuations(runs: readonly MessageWorkflowRunSummary[]): Array<{ run: MessageWorkflowRunSummary; continuations: MessageWorkflowRunSummary[] }>
```

Rules: parse `detail` with `parseWorkflowStepDetail` (import from
`../packages/core/src/workflow/run-step-detail`, like `electron/workflow/run-steps.ts:3-7`).
`last_step` = last step whose `message` is not a deferred placeholder
(`isDeferredWorkflowStepMessage`), else `null`. `decision` = last `ai.decide` step
that is not deferred: `answer = result.answer ?? variables['ai.decide.answer'] ?? port`,
`probability`/`summary` likewise (fallback `summary = message`); `null` if none.
`continued_from_run_id` = first step's `detail.continuedFrom?.runId ?? null`.
Grouping: a run whose `continued_from_run_id` equals another listed run's
`server_id` is nested under it (recursively flattened, oldest first); groups are
ordered newest parent first; an orphan continuation (parent not listed) is its own
group.

Cases: desktop ai.decide via variables; server deferred result via
`output.result`; queued placeholder skipped; continuation nested; orphan kept;
no steps → nulls.

**Verify**: `pnpm exec jest tests/unit/workflow-run-message-history.test.ts` → pass.

### Step 2: Channel + schema

- `shared/ipc/channels.ts` (Email group, next to line 274):
  `ListWorkflowRunsForMessage: 'email:list-workflow-runs-for-message',`
- `shared/ipc/email-schemas.ts` next to :450: payload
  `z.object({ messageId: positiveInt })`, result `z.array(z.object({…}))` matching
  `MessageWorkflowRunSummary` (`z.number().int()` for ids — server ids of mapped
  runs can be negative; `.nullable()` where nullable).
- Add the channel to `READ_ONLY_CHANNELS` in
  `tests/integration/ipc-email-account-scope-inventory.test.ts`.

### Step 3: Desktop query + IPC

In `electron/workflow/run-steps.ts` add
`listWorkflowRunsForMessage(messageId: number, limit = 20): MessageWorkflowRunSummary[]`:
one query `SELECT r.id, r.workflow_id, w.name AS workflow_name, r.direction, r.status, r.started_at, r.finished_at FROM ${EMAIL_WORKFLOW_RUNS_TABLE} r LEFT JOIN ${EMAIL_WORKFLOWS_TABLE} w ON w.id = r.workflow_id WHERE r.message_id = ? ORDER BY r.id DESC LIMIT ?`,
one query for their steps `WHERE run_id IN (…) ORDER BY id ASC` (no N+1), then
`summarizeRunSteps` per run; `server_id = id`; fallback name `Workflow #<id>`.
Register in `electron/ipc/email.ts` right after the
`GetLatestWorkflowRunForMessage` block, same shape (lazy import,
`{ logger, accountAccess: 'ro' }`).

Extend `tests/integration/sqlite-workflow-run-step-detail.test.ts`: after the
existing workflow run on message 501, `listWorkflowRunsForMessage(501)` returns
one run with `workflow_name: 'Spamfilter'` and a `decision` whose `answer` equals
the mocked outcome.

**Verify**: focused test command → pass (contracts + inventory included).

### Step 4: HTTP transport

In `channel-http-registry.ts` add `[IPCChannels.Email.ListWorkflowRunsForMessage, …]`
next to :3538: GET `/api/v1/email/messages/${positiveId(...)}/workflow-runs` with
`query: { limit: DEFAULT_LIST_LIMIT }`; transform: `collectPagedListItems<WorkflowRunRecord>(body, context, request, 500)`,
sort by `id` desc, take 20; for each, fetch steps exactly like
`ListWorkflowRunSteps` (by-source path with `nonZeroPathId(sourceSqliteId ?? id)`,
`includeDetail: true`, all pages) and `summarizeRunSteps(steps.map(mapWorkflowRunStepRecord))`;
fetch each distinct workflow once via `GET /api/v1/workflows/by-source/${workflowSourceSqliteId ?? workflowId}`
(null/error → `Workflow #<id>`); `server_id = record.id`; other fields from
`mapWorkflowRunRecord`. Run the per-run requests with `Promise.all`.

Add a test in `tests/unit/renderer-transport.test.ts` modelled on the
`GetLatestWorkflowRunForMessage` test (~:7040-7105), named
`maps workflow runs for message …`: two runs (parent id 401/source -91,
continuation id 402/source -92 whose first step detail has
`continuedFrom: { runId: 401 }`), assert URLs called and the mapped
`server_id`, `continued_from_run_id: 401`, `decision.probability`.

**Verify**: transport test command → pass.

### Step 5: UI component + panel wiring

Create `src/components/email/message-automation-history.tsx`:
`export function MessageAutomationHistory({ messageId }: { messageId: number })` —
loads `ListWorkflowRunsForMessage` on mount/when `messageId` changes (ignore
late responses for an old id, like `securityMessageIdRef` in the panel),
spinner while loading, `Noch keine Automatik-Läufe für diese Mail.` when empty,
`Automatik-Läufe konnten nicht geladen werden.` on error (no toast). Each group
renders a button: workflow name, status (tone via `stepTone` + `TONE_TEXT` from
`./workflow/run-tone-styles`), `Ausgang: <workflowStepPortLabel(last_step.port, last_step.node_type)>`,
and for a decision `KI: <answer> · <probability %> — <summary>` (truncate). Continuations
render indented as `Fortsetzung von Lauf #<parent id>`. Click → own
`WorkflowRunDetailDialog` with that run's `id`. A small `Aktualisieren` button
reloads (server ai.decide results arrive seconds later).

`message-metadata-panel.tsx`: add prop `canViewAutomation?: boolean` (default
`false`); when true and `selectedMessage` exists, add
`<AccordionItem value="automation">` with trigger `Automatik` before `tech`,
content `<MessageAutomationHistory messageId={selectedMessage.id} />` (Radix
mounts content only when open → no request until expanded).
Pass `canViewAutomation={canViewWorkflows}` from `message-viewer.tsx:1821` and from
`mail-shell.tsx:424` (add `canViewWorkflows` to the `useAuth()` destructure at :58).

Tests: `tests/unit/message-automation-history.test.tsx` (pattern
`tests/unit/outbound-hold-banner.test.tsx`; mock the dialog like
`message-viewer-trash-errors.test.tsx:42-44`): renders name/status/decision,
nests a continuation, click opens the dialog with the run id, error text on
rejection. Add one case to `message-metadata-panel-security-stale.test.tsx`: no
`Automatik` trigger without `canViewAutomation`.

**Verify**: focused tests, `pnpm run typecheck`, `pnpm run lint` → pass.

### Step 6: Docs + CHANGELOG + gates

`docs/USER_GUIDE_WORKFLOWS.md`: in "Die Lauf-Historie lesen" add a bullet
"**Im Lesefenster:** Details → **Automatik** zeigt alle Läufe dieser Mail …"; add
FAQ **„Was ist mit dieser Mail passiert?“** and start the auto-reply FAQ answer
with "Öffnen Sie die Mail → Details → Automatik …". CHANGELOG `### Added`:
`- **Beide Editionen:** „Automatik“ im Details-Bereich einer Mail: alle
Workflow-Läufe dieser Mail mit Ergebnis, KI-Entscheidung und Fortsetzung; ein
Klick öffnet die Schritte.`

**Verify**: `pnpm run test:unit`, `pnpm run test:integration`,
`pnpm run test:ui:coverage:check` → pass.

## Test plan

New: `tests/unit/workflow-run-message-history.test.ts` (6 cases),
`tests/unit/message-automation-history.test.tsx` (4 cases), one transport test,
one SQLite test, one panel case; updated inventory list. Patterns named per step.

## Done criteria

- [ ] `pnpm run typecheck`, `pnpm run lint` exit 0
- [ ] Focused, transport, `test:unit`, `test:integration`, `test:ui:coverage:check` pass
- [ ] `git diff --stat 9e0491e3..HEAD -- packages/server` is empty
- [ ] `grep -n "ListWorkflowRunsForMessage" shared/ipc/channels.ts shared/ipc/email-schemas.ts electron/ipc/email.ts src/services/transport/channel-http-registry.ts` → 4 files
- [ ] Row in `plans/README.md` (Runde 2) updated, checkbox in `plans/MASTERPLAN.md` ticked

## STOP conditions

- The server route rejects a user who can read the mail and has `workflows.view`
  (403 in the transport test or manual check) — permissions differ from above.
- Grouping would need a server change (e.g. `continuedFrom` missing from redacted
  step details) — report instead of editing `packages/server`.
- The HTTP transform would issue more than ~25 requests for one mail — report
  and propose a server-side summary endpoint instead of widening the fan-out.
- `MessageMetadataPanel` tests break because a hook needs a provider — do not add
  `useAuth` inside the panel; keep the prop.

## Maintenance notes

- Plan 047 adds `dry_run` to runs; once it lands, label such runs "Test" here and
  keep them out of `GetLatestWorkflowRunForMessage`.
- Plan 050 (AI accuracy loop) builds on `decision` from this summarizer.
- If mails accumulate many runs, replace the fan-out with a server endpoint that
  returns the summary in one query.
