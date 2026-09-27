# Plan 045: Desktop schedule workflows run on the core cron engine; `node-cron` removed

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update this plan's row in
> `plans/README.md` (section "Runde 2") AND tick its checkbox (**045**) in
> `plans/MASTERPLAN.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 9e0491e3..HEAD -- electron/email/email-imap-services.ts electron/email/email-workflow-store.ts shared/cron-validate.ts shared/cron-minute-validate.ts packages/core/src/workflow/cron-schedule.ts src/components/email/workflow/workflow-shell.tsx src/components/email/workflow/workflow-schedule-hint.tsx tests/mail/email-imap-services.test.ts tests/unit/core-cron-node-cron-parity.test.ts tests/unit/workflow-shell-schedule-fields.test.tsx package.json vite.config.ts docs/USER_GUIDE_WORKFLOWS.md docs/WORKFLOW_PHASES.md`
> On any change, compare with "Current state"; a mismatch is a STOP condition
> (exception: plan 040 may have edited only comments in `packages/server/src/jobs/workflow-schedule-tick.ts`, which is not in scope here).

## Status

- **Priority**: P3
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: tech-debt
- **Planned at**: commit `9e0491e3`, 2026-09-27

## Why this matters

The two editions compute schedules with two different engines: the server uses
the pure core module `packages/core/src/workflow/cron-schedule.ts`, the desktop
uses `node-cron` 4.6.0 (`package.json:146`). The parity test that keeps them in
line (`tests/unit/core-cron-node-cron-parity.test.ts:42-51`) reaches into
node-cron's undocumented `createTask(...).timeMatcher.match` and must skip both
DST transition days because the engines disagree there. One engine means one
set of semantics (DST: skipped times fall out, doubled times count once), one
test suite, and one fewer dependency. Audit claims verified (lines 178 and
293–306 of `email-imap-services.ts`; parity test lines 42–51).

**Correction to the audit** — node-cron accepts more than core: 6 fields
(seconds), `?`, `L`, `W`, `#` (checked: `cron.validate` returns `true` for
`'0 0 6 * * *'`, `'0 6 L * *'`, `'0 6 * * 1#2'`, `'0 6 15W * *'`), and the desktop
editor only checks the minute field (`shared/cron-validate.ts:8-18`). Core
rejects all of these (`parseCronExpression('0 0 6 * * *')` → „Sekunden-Feld wird
nicht unterstützt …“). A plain swap would silently stop existing desktop
workflows. This plan therefore normalizes what can be mapped losslessly and
makes the rest visible (see Step 1).

## Current state

- `electron/email/email-imap-services.ts`:
  - `:1` `import cron, { type ScheduledTask } from 'node-cron';`
  - `:178-235` global tick `cron.schedule('*/2 * * * *', …, { timezone: Intl…timeZone || 'UTC' })`
    guarded by `globalCronTickInFlight`: delayed jobs, scheduled send, learnings
    prune, run-step prune, task/calendar scans, account sync.
  - `:290-310` `scheduleWorkflowCrons`: for each `listWorkflowsWithCron()` row,
    `if (!expr || !cron.validate(expr)) continue;` then `cron.schedule(expr, …)`
    calling `runScheduledWorkflowFire(wfId)` with a per-workflow in-flight guard
    (`workflowCronInFlight`) and the machine time zone.
  - `:312-319` `restartEmailWorkflowCrons` (called from `electron/ipc/workflow.ts:167,225,540`
    and `electron/ipc/email.ts:763,800,810` after saves).
  - `:132-144` `getEmailBackgroundSyncSnapshot().cronScheduled` (shown in
    `src/components/email/settings/diagnostics-panel.tsx:455` „Cron aktiv“) — keep the field.
  - `:251-256` `stopEmailBackgroundServices` stops all tasks.
- `electron/email/email-workflow-store.ts:119-127` `listWorkflowsWithCron()` —
  every enabled workflow with a non-empty `cron_expr`, **regardless of trigger**
  (keep that behaviour; out of scope).
- Desktop `email_workflows` (`electron/database-schema.ts:686-705`) has no
  last-slot column. Decision: **no persistence** — in-memory last slot per
  workflow, armed at start/reload. Rationale: today's desktop has no catch-up
  across restarts (`docs/USER_GUIDE_WORKFLOWS.md:47`: „es gibt keine
  Nachholung“), so in-memory state reproduces it exactly; no schema change; no
  interaction with the server's desktop import (`packages/server/src/db/postgres-workflow-security-import.ts:189`
  forces `schedule_last_slot_at = NULL`).
- Core API (`packages/core/src/workflow/cron-schedule.ts`): `parseCronExpression`
  (`:93`), `validateWorkflowScheduleCron` (`:206`), `latestCronSlotAtOrBefore(spec, now, timeZone, lookbackMinutes)`
  (`:309`), `nextCronSlotAfter` (`:327`). Header comments (`:4`, `:14`, `:17`,
  `:237`, `:368`) mention node-cron.
- Editor: `src/components/email/workflow/workflow-shell.tsx:548-566` uses
  `validateWorkflowCronExpr` (desktop) / `validateServerWorkflowCronExpr` (server);
  `workflow-schedule-hint.tsx:10` comment. Test
  `tests/unit/workflow-shell-schedule-fields.test.tsx:201-214` saves `'0 0 6 * * *'` on desktop.
- Tests using node-cron: `tests/mail/email-imap-services.test.ts:6-17` (module
  mock, `cronTasks`), `:82`, `:96-126`, `:186-196`; the parity test file.
- `vite.config.ts:66` lists `'node-cron'` as external.

## Commands you will need

Prefix every command with `export PATH=/opt/node24/bin:$PATH;`.

| Purpose | Command | Expected |
|---|---|---|
| Install | `pnpm install` | exit 0 |
| Build workspace packages | `pnpm run build:packages` | exit 0 |
| Typecheck | `pnpm run typecheck` | exit 0 |
| Lint | `pnpm run lint` | exit 0, 0 warnings |
| Focused test | `pnpm exec jest tests/unit/desktop-workflow-schedule-tick.test.ts` | all pass |
| Unit | `pnpm run test:unit` | all pass |
| Mail suite | `pnpm run test:mail` then `pnpm run test:mail:coverage` | pass, ratchet ok |
| Build | `pnpm run build` | exit 0 |

## Scope

**In scope**: `electron/workflow/desktop-schedule-tick.ts` (create),
`electron/email/email-imap-services.ts`, `shared/cron-validate.ts`,
`tests/unit/desktop-workflow-schedule-tick.test.ts` (create),
`tests/mail/email-imap-services.test.ts`, `tests/unit/workflow-shell-schedule-fields.test.tsx`,
`tests/unit/core-cron-node-cron-parity.test.ts` (delete), comments in
`packages/core/src/workflow/cron-schedule.ts`, `src/components/email/workflow/workflow-shell.tsx`,
`workflow-schedule-hint.tsx`, `package.json` + `pnpm-lock.yaml` (remove `node-cron`),
`vite.config.ts`, `docs/USER_GUIDE_WORKFLOWS.md`, `docs/WORKFLOW_PHASES.md`, `CHANGELOG.md`.

**Out of scope**: any change to core parsing/matching logic; the server tick;
`listWorkflowsWithCron` selecting non-`schedule` triggers; persisting last slots;
rewriting stored `cron_expr` values in users' databases.

## Git workflow

- Branch `advisor/045-desktop-schedules-on-core-cron`.
- German commit messages, e.g. `Desktop-Zeitpläne: gemeinsame Cron-Logik statt node-cron`.
- Do NOT push or open a PR unless the operator says so.

## Steps

### Step 1: Desktop expression normalization (tests first)

In `shared/cron-validate.ts` add
`normalizeDesktopWorkflowCronExpr(expr: string): { ok: true; expr: string } | { ok: false; error: string }`:
trim; 6 fields whose first (seconds) field is a single integer `0`–`59` → drop
it; a lone `?` in the day-of-month or weekday field → `*` (node-cron does exactly
this, `convertQuestionMarks`); then `parseCronExpression`; on failure return its
German error. Anything else with 6 fields → error
„Sekunden-Feld wird nur als feste Zahl unterstützt (z. B. 0 0 6 * * *)“.
Change `validateWorkflowCronExpr` (desktop editor) to: normalize, then
`validateWorkflowScheduleCron(normalized)`. Update its doc comment (no node-cron).

**Verify**: unit tests in `tests/unit/desktop-workflow-schedule-tick.test.ts`
(written now): `'0 0 6 * * *'`→`'0 6 * * *'`; `'0 6 ? * MON'`→`'0 6 * * MON'`;
`'*/10 0 6 * * *'`, `'0 6 L * *'`, `'0 6 * * 1#2'` → `ok: false`. All pass.

### Step 2: Scheduler module (tests first)

Create `electron/workflow/desktop-schedule-tick.ts`:

```ts
export const DESKTOP_SCHEDULE_LOOKBACK_MINUTES = 2; // Takt-Jitter, keine Nachholung
export function createDesktopScheduleTicker(deps: {
  listWorkflows: () => ReadonlyArray<{ id: number; cron_expr: string | null }>;
  fire: (workflowId: number) => Promise<void>;
  now?: () => Date;
  timeZone?: () => string; // default: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  log: Pick<typeof console, 'warn' | 'debug'>;
}): { reload(): void; tick(): void; stop(): void; start(): void };
```

- `reload()`: re-read workflows; for each id keep existing state if the
  normalized expression is unchanged, else arm it:
  `lastSlot = latestCronSlotAtOrBefore(cron, now, tz, 0)` (the current minute
  counts as done — like a freshly created node-cron task). Unparseable →
  skip, warn once per `id:expr` (German message incl. the error).
- `tick()`: per workflow, `slot = latestCronSlotAtOrBefore(cron, now, tz, LOOKBACK)`;
  fire when `slot > lastSlot`; set `lastSlot = slot` before firing; if the
  workflow is still in flight, skip (slot counts as done, as with node-cron).
- `start()`: `setTimeout` to the next full minute + 1 s, then every 60 s
  (re-align each time). `stop()` clears timers and state.

Tests (fake timers + injected clock and `timeZone: () => 'Europe/Berlin'`):
fires `0 6 * * *` once at 06:00 and not again at 06:01; not on start at 06:00:20;
reload keeps lastSlot of unchanged workflows (a save at 06:00:03 must not swallow
06:00) and re-arms changed ones; in-flight skip; a 30-min gap (sleep) does not
catch up; **DST**: `30 2 * * *` does not fire on 2028-03-26 and fires exactly
once on 2028-10-29; `0 6 * * *` fires once per day on 2028-03-25…27 and
2028-10-28…30; 6-field and `?` expressions fire at the normalized times.

**Verify**: focused test → all pass.

### Step 3: Wire it into `email-imap-services.ts`

Replace the node-cron import. Global tick: `setInterval(() => {...}, 120_000)`
with the unchanged body and in-flight guard (`globalCron` becomes
`globalTickInterval`; `cronScheduled` = interval set). Workflow schedules:
one module-level ticker from Step 2 with `listWorkflows: listWorkflowsWithCron`,
`fire: runScheduledWorkflowFire` (keep the `.catch` warn text `[email] workflow cron`).
`scheduleWorkflowCrons` → `ticker.reload()` + `ticker.start()`;
`restartEmailWorkflowCrons` → `ticker.reload()`; `stopEmailBackgroundServices` → `ticker.stop()`.

Rewrite `tests/mail/email-imap-services.test.ts`: drop the `node-cron` mock;
use `jest.useFakeTimers()` + `advanceTimersByTimeAsync(120_000)` for the global
tick test; replace the "skips invalid workflow cron expressions" test with one
asserting an invalid expression is not fired and warned once.

**Verify**: `grep -rn "node-cron" electron src shared tests` → only comments you
will fix in Step 4 (none in code); `pnpm run test:mail` and `pnpm run test:mail:coverage` pass.

### Step 4: Remove node-cron and stale references

Delete `tests/unit/core-cron-node-cron-parity.test.ts`; remove `"node-cron"`
from `package.json` and run `pnpm install` (lockfile updates); remove
`'node-cron'` from `vite.config.ts:66`. Rewrite comments at
`cron-schedule.ts:4,14,17,237,368`, `workflow-shell.tsx:551`,
`workflow-schedule-hint.tsx:10` (desktop now uses the same engine in the
machine time zone). Keep the `workflow-shell-schedule-fields` test that saves
`'0 0 6 * * *'` (still accepted via normalization) but rename it to
`'the desktop accepts a fixed seconds field (normalized to 5 fields)'`, and add a
case: `'0 6 L * *'` shows `toast.error`.
Docs: `USER_GUIDE_WORKFLOWS.md:47` add that DST rules are the same as the
server and which desktop-only syntax is no longer supported;
`WORKFLOW_PHASES.md:45` drop „Paritätstest gegen node-cron“.

**Verify**: `grep -rn "node-cron" --include=*.ts --include=*.tsx --include=*.json --include=*.md electron src shared packages/core/src tests docs package.json vite.config.ts` → no output (CHANGELOG history may mention it); `pnpm run build` exit 0.

### Step 5: Changelog + full checks

`CHANGELOG.md` `[Unreleased]` → `### Changed`:
`- **Desktop:** Zeitplan-Workflows nutzen dieselbe Zeitplan-Logik wie der Server (Sommer-/Winterzeit identisch). Ein festes Sekundenfeld und „?“ werden weiter akzeptiert; Ausdrücke mit „L“, „W“, „#“ oder variablem Sekundenfeld laufen nicht mehr und werden im Editor als Fehler angezeigt.`

**Verify**: typecheck, lint (0 warnings), `test:unit`, mail suite + coverage ratchet pass.

## Test plan

New `tests/unit/desktop-workflow-schedule-tick.test.ts` (Steps 1–2 cases,
including the DST cases above); rewritten `tests/mail/email-imap-services.test.ts`;
extended `tests/unit/workflow-shell-schedule-fields.test.tsx`. Existing
`tests/unit/core-cron-schedule.test.ts` stays the source of truth for the engine.

## Done criteria

- [ ] typecheck exit 0; lint 0 warnings; `test:unit`, `test:mail`, `test:mail:coverage` pass
- [ ] `grep -n "node-cron" package.json vite.config.ts` → no output; `pnpm-lock.yaml` has no `node-cron` entry
- [ ] `test -f tests/unit/core-cron-node-cron-parity.test.ts` → false
- [ ] New scheduler tests incl. both DST days pass
- [ ] CHANGELOG entry present; README row updated; **045** ticked in MASTERPLAN

## STOP conditions

- Core `latestCronSlotAtOrBefore`/`parseCronExpression` would need a logic change to pass a test.
- Another runtime import of `node-cron` appears outside `email-imap-services.ts`.
- The maintainer objects to dropping `L`/`W`/`#`/variable-seconds support (then keep node-cron only as a fallback for those expressions and report).
- The mail coverage ratchet fails and cannot be restored by tests for the new code.

## Maintenance notes

- Desktop scheduling state is in memory; a restart never catches up (documented).
  If catch-up is ever wanted, add a persisted last slot like the server's `schedule_last_slot_at`.
- Desktop fires any enabled workflow with a cron expression, not only
  `trigger = 'schedule'` (unchanged here; worth a separate look).
- Reviewers: check the reload path (unchanged workflows must keep their last slot).
