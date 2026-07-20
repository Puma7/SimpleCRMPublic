# Mail ACL Review Fix Evidence - 2026-07-20

## Scope

Validated and fixed the reviewed server-side mailbox ACL bypass paths:

- Workflow execute and dry-run message content access.
- Workflow runtime read/list surfaces and delayed-job events.
- Reply-draft source message content access.
- Review-note correction: optional HTTP `messageId` only falls back to non-mail when the field is genuinely absent; malformed/null/empty present values fail closed.

## End-to-End Findings

- Workflow execute/dry-run bypass was real: message-bearing execute routes were registered under non-mail workflow routes and only checked message existence before dry-run/enqueue.
- Workflow runtime read/event bypass was real: runtime rows and delayed-job events could expose mail-linked IDs, logs, context, destinations, and pagination/counts without mail SQL scope.
- Reply-draft bypass was real: the base draft-create permission did not also require source message content-read before AI generation.
- No additional live workflow-node authorization widening was required for this fix. The validated read bypass is closed at route/job/resource boundaries; existing node/action authorization behavior was not broadened.

## Evidence Matrix

| Scenario | Invocation | Binary observable | Artifact |
|---|---|---|---|
| RED reproduction: workflow execute, runtime reads/events, reply-draft tests fail before fixes | `pnpm exec jest --runTestsByPath tests/unit/server-mail-policy-manifest.test.ts tests/unit/server-mail-job-event-acl.test.ts tests/integration/server-mail-access-routes.test.ts --runInBand -t "server mail policy manifest|server mail job and event ACL|workflow execute routes|reply draft generation|workflow runtime rows"` | Jest failed; ACL regressions red plus unrelated Task-8 integration noise | `.superpowers/sdd/mail-acl-red-20260720.log` |
| Focused RED reproduction with narrower ACL selectors | `pnpm exec jest --runTestsByPath tests/unit/server-mail-policy-manifest.test.ts tests/unit/server-mail-job-event-acl.test.ts tests/integration/server-mail-access-routes.test.ts --runInBand -t "server mail policy manifest|server mail job and event ACL|workflow execute routes|reply draft generation|workflow runtime rows"` | Jest failed; PostgreSQL runtime test needed migration/backfill setup when run alone | `.superpowers/sdd/mail-acl-red-focused-20260720.log` |
| Workflow execute/dry-run requires content read on present valid `messageId`; ID/by-source dry-run and enqueue deny metadata-only users; no-message execution still works | `pnpm exec jest --runTestsByPath tests/integration/server-mail-access-routes.test.ts --runInBand -t "workflow execute routes"` as part of focused suite | Passed; denied cases returned `404 mail_resource_not_found`, no-message dry-run `200`, no-message enqueue `202`, handlers called only for no-message cases | `.superpowers/sdd/mail-acl-focused-green-after-review-20260720.log` |
| Review-note negative: malformed present optional `messageId` does not fall through to non-mail | Same focused suite | Passed; `null`, empty string, `0`, and non-number present `messageId` returned `404 mail_resource_not_found`; dry-run/enqueue mocks remained uncalled | `.superpowers/sdd/mail-acl-focused-green-after-review-20260720.log` |
| Reply-draft requires both target draft-create and source content-read | Same focused suite | Passed; draft-only and content-only principals returned `404`; both grants returned `200`; generator called once | `.superpowers/sdd/mail-acl-focused-green-after-review-20260720.log` |
| Workflow runtime PostgreSQL SQL-scope filtering before counts/pages/results | Same focused suite | Passed; restricted users only saw authorized mail-linked rows plus non-mail rows; hidden run/step/applied/forward/delayed records returned null/absent | `.superpowers/sdd/mail-acl-focused-green-after-review-20260720.log` |
| Delayed-job event live/replay parity and sanitization | Same focused suite | Passed; accessible message event delivered sanitized payload, hidden message event returned null, non-mail event delivered sanitized payload | `.superpowers/sdd/mail-acl-focused-green-after-review-20260720.log` |
| Manifest completeness and independent workflow mail-route contract | Same focused suite | Passed; workflow mail-route inventory is registered independently of `non_mail` workflow routes and every inventory route has the expected policy | `.superpowers/sdd/mail-acl-focused-green-after-review-20260720.log` |
| Typecheck | `pnpm run typecheck` | Passed | `.superpowers/sdd/mail-acl-typecheck-20260720.log` |
| Lint | `pnpm run lint` | Passed | `.superpowers/sdd/mail-acl-lint-20260720.log` |
| Unit suite | `pnpm run test:unit` | Passed: 265 suites, 2401 tests | `.superpowers/sdd/mail-acl-test-unit-20260720.log` |
| Integration suite | `pnpm run test:integration` | Failed only in concurrent Task-8 rollout/audit tests in `tests/integration/server-mail-access-routes.test.ts`; ACL focused tests passed separately | `.superpowers/sdd/mail-acl-test-integration-20260720.log` |
| Mail coverage | `pnpm run test:mail:coverage` | Passed: 179 suites, 1166 passed, 1 skipped; coverage ratchet satisfied | `.superpowers/sdd/mail-acl-test-mail-coverage-20260720.log` |
| Build | `pnpm run build` | Passed with existing Vite browser-compatibility/chunk warnings | `.superpowers/sdd/mail-acl-build-20260720.log` |
| Whitespace diff check | `git diff --check` with explicit success marker | Passed: `git diff --check: clean` | `.superpowers/sdd/mail-acl-git-diff-check-20260720.log` |

## Concerns

- The integration and shared-worktree concerns above applied to the first review-fix wave. The delayed-job follow-up below started from clean HEAD `28a04f7c5940a8e9803d52230d934b3acc496387`; all repository-wide gates are green.

## Delayed-Job Follow-Up Wave

### Validated Findings

- Delayed-job POST/PATCH/DELETE were accepted by the workflow handler but absent from the canonical mail inventory. This was real.
- Delayed-job mutation ports selected and mutated rows without `MailSqlScope`. An ordinary user could mutate hidden mail-linked jobs or relink an accessible/non-mail job to hidden mail. This was real.
- `workflow.execute` treated an omitted direct `messageId` as non-mail even when `delayedJobId` resolved to a mail-linked row. Missing rows and direct/delayed mismatches were not represented as distinct typed classifications. This was real.
- Delayed-job events treated missing/malformed message IDs like non-mail. This was real for live and replay filtering.
- The initial worker classifier fix had a TOCTOU gap because classification and execution used separate transactions while PATCH could change `message_id`. This was real.
- `runId` alone does not cause workflow execution to load message content. No run lookup was added.

### Implemented Contract

- Canonical workflow mail routes now include delayed-job POST/PATCH/DELETE, with an independent accepted method/path matrix test against the handler.
- POST authorizes a present source message with `mail.content.read`; genuine absence and parser-supported `null` create a non-mail job. Other present malformed values fail closed.
- PATCH/DELETE authorize the current row through SQL scope before locking/mutating. PATCH separately authorizes and SQL-scopes a replacement message. `null` detach remains supported and mutation failure is atomic.
- The PostgreSQL worker lookup classifies delayed jobs as `missing`, `invalid`, `non_mail`, or `message`; it never uses a sentinel resource and never conflates a missing row with non-mail.
- Worker authorization produces a typed, transient `MailJobAuthorization` outside the payload. Both legacy and Graphile workers pass it to the workflow handler only after actor/service provenance and mailbox permission checks.
- Workflow execution compares the authorized delayed-job ID/message linkage with the delayed row selected `FOR UPDATE` inside its execution transaction before loading message content or running nodes. The row lock is held through workflow actions and the final delayed-job update, so a concurrent relink cannot commit across the authorized execution.
- Direct and delayed message IDs must agree, including null/non-null mismatches. Missing/malformed delayed IDs fail closed; an explicit delayed row with `message_id IS NULL` remains a genuine non-mail execution.
- Delayed-job events accept only a positive integer message ID or explicit `null`; missing, empty, zero, object, and malformed values are filtered from both live and replay streams.

### Follow-Up Evidence Matrix

| Scenario | Invocation | Binary observable | Artifact |
|---|---|---|---|
| RED: delayed mutation inventory, SQL scope, worker lookup, strict events | `pnpm exec jest --runTestsByPath tests/unit/server-mail-policy-manifest.test.ts tests/unit/server-mail-job-event-acl.test.ts tests/unit/postgres-job-queue-worker.test.ts tests/integration/server-mail-access-routes.test.ts --runInBand -t "runs the backfill|independently inventories every delayed-job method|classifies message workflow execution jobs|classifies delayed-job events|workflow execution resolves delayed-job mail|delayed-job events require|delayed-job live and replay|legacy worker resolves a delayed workflow|authorizes delayed-job HTTP mutations"` | Failed with the expected missing route/policy/classifier/filter protections | `.superpowers/sdd/mail-acl-delayed-job-followup-red-20260720.log` |
| RED: deterministic relink between authorization and execution | `pnpm exec jest --runTestsByPath tests/unit/postgres-job-queue-worker.test.ts tests/unit/server-edition-foundation.test.ts --runInBand -t "carries the authorized delayed message linkage|production job handlers validate payloads|schedules and resumes delay nodes"` | Three failures: worker did not carry authorization, builder discarded it, execution ran the relinked row and marked it done | `.superpowers/sdd/mail-acl-delayed-job-toctou-red-20260720.log` |
| Focused policy/worker/event/handler/execution suites | `pnpm exec jest --runTestsByPath tests/unit/server-mail-policy-manifest.test.ts tests/unit/server-mail-job-event-acl.test.ts tests/unit/postgres-job-queue-worker.test.ts tests/unit/server-edition-foundation.test.ts --runInBand` | Passed: 4 suites, 439 tests | `.superpowers/sdd/mail-acl-delayed-job-followup-focused-unit-green-20260720.log` |
| Real PostgreSQL ACL mutations and classifier | `pnpm exec jest --runTestsByPath tests/integration/server-mail-access-routes.test.ts --runInBand` | Passed: 1 suite, 44 tests; includes denied/allowed, existence hiding, current+replacement authorization, null detach, cross-workspace and atomic no-change assertions | `.superpowers/sdd/mail-acl-delayed-job-followup-postgres-green-20260720.log` |
| Lint | `pnpm run lint` | Passed | `.superpowers/sdd/mail-acl-delayed-job-followup-lint-20260720.log` |
| Typecheck | `pnpm run typecheck` | Passed | `.superpowers/sdd/mail-acl-delayed-job-followup-typecheck-20260720.log` |
| Unit suite | `pnpm run test:unit` | Passed: 265 suites, 2407 tests, 1 snapshot | `.superpowers/sdd/mail-acl-delayed-job-followup-test-unit-20260720.log` |
| Integration suite | `pnpm run test:integration` | Passed: 25 suites, 351 tests | `.superpowers/sdd/mail-acl-delayed-job-followup-test-integration-20260720.log` |
| Mail coverage | `pnpm run test:mail:coverage` | Passed: 179 suites, 1166 passed, 1 skipped; 91.91% statements/lines and 80.08% branches | `.superpowers/sdd/mail-acl-delayed-job-followup-test-mail-coverage-20260720.log` |
| Build | `pnpm run build` | Passed with existing Vite externalization and chunk-size warnings | `.superpowers/sdd/mail-acl-delayed-job-followup-build-20260720.log` |
| Whitespace diff check | `git diff --check` | Passed: clean | `.superpowers/sdd/mail-acl-delayed-job-followup-git-diff-check-20260720.log` |

### Remaining Concerns

- Delayed-job message linkage remains intentionally mutable through the authorized PATCH API. Correctness therefore depends on all production workflow execution entering through a policy-enforcing worker, which now supplies the non-payload authorization result; the execution port also fails closed for an existing delayed row when that result is absent.
- Build output retains the pre-existing Vite browser externalization and large-chunk warnings; neither is introduced by this server-only ACL change.

## Delayed-Job Row-Lock Follow-Up

### Validated Finding

- The earlier in-transaction message comparison did not lock `workflow_delayed_jobs`. A PATCH could commit after comparison but before execution acquired a row lock through its later `status = 'running'` update. The execution would then run actions against the old message snapshot and overwrite final state on the newly linked row. This was real.

### Fix And Concurrency Contract

- `loadDelayedJob(...)` now terminates its existing PostgreSQL SELECT with `FOR UPDATE`.
- Execute and dry-run share this loader. The surrounding workspace transaction holds the row lock until each operation completes; normal execution therefore retains it through authorization comparison, message load, workflow actions, and final delayed-job status update.
- The PostgreSQL regression opens the exact pre-action race window without timing sleeps: a trigger blocks the workflow-run INSERT on an advisory lock after delayed-row comparison but before the old `status = 'running'` update. A second connection starts the real delayed-job mutation port, and `pg_blocking_pids` proves that PATCH waits on the execution transaction.
- After releasing the barrier, completion order is deterministically `execution`, then `patch`. The action is stored only for the authorized message, and the later PATCH's `relinked` state remains final instead of being overwritten by the old execution.

### Row-Lock Evidence Matrix

| Scenario | Invocation | Binary observable | Artifact |
|---|---|---|---|
| RED: query contract and real concurrent relink | `pnpm exec jest --runTestsByPath tests/unit/server-edition-foundation.test.ts tests/integration/server-mail-access-routes.test.ts --runInBand -t "schedules and resumes delay nodes|holds the delayed-job row lock"` | Failed: unit fake recorded no delayed-row lock; real PATCH committed instead of becoming a PostgreSQL lock waiter | `.superpowers/sdd/mail-acl-delayed-job-lock-red-20260720.log` |
| Focused GREEN race proof | Same targeted command after adding `FOR UPDATE` | Passed: 2 suites, 2 tests | `.superpowers/sdd/mail-acl-delayed-job-lock-focused-green-20260720.log` |
| Full affected workflow execution unit files | `pnpm exec jest --runTestsByPath tests/unit/server-edition-foundation.test.ts tests/unit/workflow-execution-jsonb.test.ts --runInBand` | Passed: 2 suites, 404 tests; explicit query contract records `workflow_delayed_jobs` as `FOR UPDATE` | `.superpowers/sdd/mail-acl-delayed-job-lock-workflow-unit-green-20260720.log` |
| Full real PostgreSQL ACL route file | `pnpm exec jest --runTestsByPath tests/integration/server-mail-access-routes.test.ts --runInBand` | Passed: 1 suite, 45 tests | `.superpowers/sdd/mail-acl-delayed-job-lock-postgres-green-20260720.log` |
| Typecheck | `pnpm run typecheck` | Passed | `.superpowers/sdd/mail-acl-delayed-job-lock-typecheck-20260720.log` |
| Lint | `pnpm run lint` | Passed | `.superpowers/sdd/mail-acl-delayed-job-lock-lint-20260720.log` |
