# Plan 040: Schedule tick enqueues first, then claims the slot (no lost scheduled run)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update this plan's row in
> `plans/README.md` (section "Runde 2") AND tick its checkbox (**040**) in
> `plans/MASTERPLAN.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 9e0491e3..HEAD -- packages/server/src/jobs/workflow-schedule-tick.ts packages/server/src/jobs/maintenance-handlers.ts tests/integration/postgres-workflow-schedule-tick.test.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `9e0491e3`, 2026-09-27

## Why this matters

The server-edition schedule tick (`runWorkflowScheduleTick`) first **commits**
the slot claim (`email_workflows.schedule_last_slot_at = slot`) in its own
transaction and only **afterwards** enqueues the `workflow.execute` job. The
claim is rolled back only when `enqueue` *throws*. If the process dies (OOM,
container restart, deploy) between the committed claim and the enqueue, the run
for that slot is silently lost: the next tick sees `slot <= schedule_last_slot_at`
and skips it, and nobody is told. Reversing the order (enqueue, then claim) turns
that failure into a harmless duplicate enqueue — which the system already
de-duplicates twice (Graphile job key per workflow+slot, and a run-side slot
claim inside the run transaction). Audit claim verified; nothing wrong in it.

## Current state

- `packages/server/src/jobs/workflow-schedule-tick.ts` (314 lines) — the tick.
  Doc comment lines 25–34 describe "genau einmal je Zeitpunkt"; the claim-then-
  enqueue block is lines 238–307:

```ts
// workflow-schedule-tick.ts:238-259
      // ERST beanspruchen, DANN einreihen. Das bedingte UPDATE ist der Anspruch;
      // enabled/trigger/cron stehen mit drin, damit ein zwischenzeitlich
      // deaktivierter oder umgestellter Workflow nicht noch mit dem alten Stand
      // ausloest.
      const claimed = await withWorkspaceTransaction(
        input.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => trx
          .updateTable('email_workflows')
          .set({ schedule_last_slot_at: slot })
          ...
          .where('schedule_last_slot_at', '<', slot)
          .returning(['id', 'schedule_account_id'])
          .executeTakeFirst(),
        session,
      );
      if (!claimed) continue;
```

```ts
// workflow-schedule-tick.ts:261-306 (abridged)
      try {
        await input.queue.enqueue({ workspaceId, type: 'workflow.execute',
          payload: buildTrustedServiceJobPayload({ ..., scheduleSlot: slot.toISOString(),
            context: buildScheduleWorkflowContext({ firedAt: now, slot,
              scheduleAccountId: claimed.schedule_account_id === null ? null : Number(claimed.schedule_account_id) }) }),
          maxAttempts: 3 });
      } catch (error) {
        // Anspruch zuruecknehmen ... (UPDATE ... SET schedule_last_slot_at = lastSlot
        //   WHERE schedule_last_slot_at = slot).catch(() => undefined)
        failed.push({ workflowId, error });
        continue;
      }
      enqueued += 1;
```

- Note: `schedule_account_id` currently comes from the claim's `RETURNING`. The
  page query (lines 175–192) selects only `['id', 'cron_expr', 'schedule_last_slot_at']`.
- Duplicate protection that makes "enqueue first" safe (read, do not change):
  - `packages/server/src/jobs/graphile-worker.ts:512-521` — `graphileSpecFromJob`
    sets `jobKey: graphileJobKeyForJob(...)`, `jobKeyMode: 'replace'`;
    `graphile-worker.ts:855-858` keys a schedule run as
    `workflow.execute:<ws>:<workflowId>:schedule:<scheduleSlot>`. The production
    queue is Graphile (`server.ts:356-361`, `createGraphileQueuePort`).
  - `packages/server/src/workflow-execution.ts:762-781` — the run calls
    `claimScheduleSlotRun` (`:8635-8660`, sync_info key
    `workflow_schedule_run:<id>`, monotonic `value < slot`) in the run
    transaction; a second job for the same slot finishes with log
    `skip:schedule_slot_already_ran`. It also skips a workflow no longer on the
    `schedule` trigger (`:746-757`) and a disabled workflow.
- Caller: `packages/server/src/jobs/maintenance-handlers.ts:187-208` — logs
  `result.failed`; comment lines 197–199 say "der Anspruch ist zurueckgenommen".
- Tests: `tests/integration/postgres-workflow-schedule-tick.test.ts` (533 lines,
  embedded Postgres). Relevant: `'two concurrent ticks enqueue a slot only once'`
  (`:211-220`, asserts the collecting queue received exactly one job),
  `'a failed enqueue releases the claim so the next tick retries'` (`:240-260`),
  `'Gatekeeper #4 ...'` (`:262-325`, pattern for executing enqueued jobs via
  `createPostgresWorkflowExecutionJobPort` + `buildWorkflowExecutionJobPlan`).
  Helpers: `collectingQueue(delayMs)`, `lastSlot(id)`, constants `NOW`, `SLOT`, `ARMED`.
- Why not "claim + enqueue in one transaction": the tick receives an abstract
  `queue.enqueue` port backed by Graphile's own pool (`utils.addJob`); inserting
  into the legacy `job_queue` table in the claim transaction (the
  `mail-compose-send.ts:1082-1092` pattern) would route the run through the
  legacy poller, losing the per-workspace serial queue and the job key. Out of scope.

## Commands you will need

Prefix every command with `export PATH=/opt/node24/bin:$PATH;`.

| Purpose | Command | Expected |
|---|---|---|
| Install | `pnpm install` | exit 0 |
| Build workspace packages | `pnpm run build:packages` | exit 0 |
| Typecheck | `pnpm run typecheck` | exit 0 |
| Lint | `pnpm run lint` | exit 0, 0 warnings |
| Focused test | `pnpm exec jest tests/integration/postgres-workflow-schedule-tick.test.ts` | all pass |
| Schedule unit tests | `pnpm exec jest tests/unit/server-workflow-schedule.test.ts` | all pass |
| Server coverage ratchet | `pnpm run test:server:coverage && node scripts/check-server-coverage-ratchet.mjs` | pass |

Embedded-Postgres tests refuse to run as root. If `id -u` prints `0`, run:
`chmod -R a+rwX .tmp-tests tests packages/core/dist packages/server/dist` and then
`su tester -s /bin/bash -c "export PATH=/opt/node24/bin:\$PATH; cd /home/user/SimpleCRMPublic && node_modules/.bin/jest --cacheDirectory /tmp/jest-tester --forceExit tests/integration/postgres-workflow-schedule-tick.test.ts"`.
Keep the file's `jest.mock('kysely', () => jest.requireActual('../../packages/server/node_modules/kysely'))`.

## Scope

**In scope**:
- `packages/server/src/jobs/workflow-schedule-tick.ts`
- `packages/server/src/jobs/maintenance-handlers.ts` (comment lines 197–199 only)
- `tests/integration/postgres-workflow-schedule-tick.test.ts`
- `CHANGELOG.md` (`[Unreleased]` entry)

**Out of scope**:
- `packages/server/src/workflow-execution.ts` — the run-side claim is correct; do not touch (plan 043 moves this file later).
- `packages/server/src/jobs/graphile-worker.ts` — job key logic stays.
- `packages/server/src/jobs/mail-sync-scheduler.ts` — same claim-first pattern, but a lost claim there only delays the next sync by one interval (self-healing); not this plan.
- Desktop scheduling (`electron/email/email-imap-services.ts`) — plan 045.

## Git workflow

- Branch `advisor/040-schedule-tick-enqueue-before-claim`.
- German commit messages, e.g. `Zeitplan-Takt: erst einreihen, dann Zeitpunkt beanspruchen`.
- Do NOT push or open a PR unless the operator says so.

## Steps

### Step 1: Regression test first (must fail on current code)

In `tests/integration/postgres-workflow-schedule-tick.test.ts`, after the test
`'a failed enqueue releases the claim so the next tick retries'`, add:

1. `'the slot is not claimed before the run is enqueued (process death between the two loses nothing)'`:
   a queue whose `enqueue` reads `await lastSlot(9101)` into an array and then
   pushes the job. Run one tick at `NOW`. Expect the recorded value to be
   `ARMED` (not `SLOT`), `result.enqueued === 1`, and `await lastSlot(9101) === SLOT`
   afterwards. On current code the recorded value is `SLOT` → test fails.
2. `'a tick that died after enqueueing re-enqueues the same slot and it still runs once'`:
   simulate the crash by a queue that pushes the job and then throws
   `new Error('process died after enqueue')` on the first call only. First tick:
   `failed` = `[9101]`, `lastSlot(9101) === ARMED`. Second tick at `NOW + 60 s`:
   `enqueued === 1`, `lastSlot(9101) === SLOT`, both jobs carry `scheduleSlot === SLOT`
   and the same `graphileJobKeyForJob('workflow.execute', job.payload, WORKSPACE_A)`
   (import from `../../packages/server/src/jobs/graphile-worker`). Execute both
   jobs as in the Gatekeeper #4 test and assert exactly one run without
   `skip:schedule_slot_already_ran` and one with it.

**Verify**: focused test command → test 1 FAILS (value `SLOT`), test 2 passes or
fails; all pre-existing tests pass. Record the failure output.

### Step 2: Reorder the tick — enqueue, then claim

In `runWorkflowScheduleTick`:

1. Add `'schedule_account_id'` to the page select (line ~180) and to
   `ScheduleWorkflowRow` (`schedule_account_id: number | string | null`).
2. Replace lines 238–307 with: build the payload from the page row
   (`workflow.schedule_account_id`), `await input.queue.enqueue(...)` in a
   `try`; on throw push to `failed` and `continue` (no claim, nothing to roll back
   — delete the rollback UPDATE). After a successful enqueue run the **same**
   conditional claim UPDATE as today (all `where` clauses unchanged, drop
   `.returning` columns you no longer need but keep `returning(['id'])` to know
   whether it matched). If the claim UPDATE throws, push to `failed` and
   `continue` (the job exists; the next tick re-enqueues the same key and the run
   claim de-duplicates). Count `enqueued += 1` only when the claim matched
   (keeps the "one tick owns the slot" meaning of the counter).
3. Rewrite the header comment bullets (lines 25–34) and the step comment in
   German: *erst einreihen, dann beanspruchen*; a crash between the two leads to a
   second enqueue of the same slot, caught by the job key while the job waits and
   by `workflow_schedule_run:<id>` in the run otherwise. Update the
   `WorkflowScheduleTickResult.failed` doc comment (no claim is taken back any more).
4. `maintenance-handlers.ts:197-199`: change the comment to say the slot stays
   unclaimed and the next tick retries.

**Verify**: `pnpm run typecheck` → exit 0; focused test → both new tests pass.

### Step 3: Adapt the concurrency test to the new guarantee

`'two concurrent ticks enqueue a slot only once'` (`:211-220`) now sees up to
three enqueue calls for 9101 (all three ticks enqueue before any claims). Change
it to assert the real guarantee: the sum of `result.enqueued` is `1`; every
enqueued job is for 9101 with `scheduleSlot === SLOT` and one identical
`graphileJobKeyForJob` key; executing all enqueued jobs yields exactly one run
without `skip:schedule_slot_already_ran`. Rename it to
`'concurrent ticks: one claim, one job key, one real run'`. Do not weaken any
other test.

**Verify**: focused test → all pass; `pnpm exec jest tests/unit/server-workflow-schedule.test.ts` → all pass.

### Step 4: Changelog + full checks

Add under `[Unreleased]` → `### Fixed`:
`- **Server:** Zeitplan-Workflows: Stürzt der Server zwischen Einreihen und Vormerken eines Zeitpunkts ab, geht der Lauf nicht mehr verloren — der Zeitpunkt wird erst nach dem Einreihen als erledigt markiert.`

**Verify**: `pnpm run lint` → 0 warnings; server coverage ratchet → pass.

## Test plan

- New: the two tests from Step 1 (ordering invariant; crash after enqueue → re-enqueue, one real run).
- Changed: concurrency test (Step 3).
- Unchanged and must pass: failed-enqueue retry, Gatekeeper #4, catch-up window,
  workspace isolation, armed/not-armed tests.

## Done criteria

- [ ] `pnpm run typecheck` exit 0; `pnpm run lint` exit 0, 0 warnings
- [ ] `tests/integration/postgres-workflow-schedule-tick.test.ts` all pass incl. 2 new tests
- [ ] `grep -n "ERST beanspruchen" packages/server/src/jobs/workflow-schedule-tick.ts` → no match
- [ ] `grep -n "schedule_last_slot_at: lastSlot" packages/server/src/jobs/workflow-schedule-tick.ts` → no match (rollback removed)
- [ ] Server coverage ratchet passes
- [ ] `git status` shows only in-scope files; CHANGELOG entry present
- [ ] Row in `plans/README.md` (Runde 2) updated and **040** ticked in `plans/MASTERPLAN.md`

## STOP conditions

- The run-side claim (`claimScheduleSlotRun` / `skip:schedule_slot_already_ran`)
  is missing or no longer inside the run transaction in `workflow-execution.ts` —
  enqueue-first would then double-run slots.
- `graphileJobKeyForJob` no longer produces a key containing `scheduleSlot` for
  `triggerName: 'schedule'`.
- The production queue passed to the tick is no longer Graphile (check
  `server.ts` near `createGraphileQueuePort`).
- Any existing test other than the concurrency test needs a changed assertion.
- The fix appears to require editing `workflow-execution.ts` or `graphile-worker.ts`.

## Maintenance notes

- Invariant after this plan: *a slot is only marked done after a job for it
  exists*. Duplicate jobs are expected and harmless; a reviewer should check that
  no code path claims before enqueueing.
- A workflow disabled or switched away from `schedule` between page load and
  enqueue can now get a job; the run's own checks skip it. Same window existed before.
- `mail-sync-scheduler.ts` uses the same claim-first pattern; consider the same
  reorder there if a lost sync interval ever matters.
