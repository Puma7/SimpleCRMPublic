# Task 6 Final Important Producer Inventory Evidence

Date: 2026-07-19
Branch: codex/server-first-mail-acl

## Scenario

Fix only the final Important finding from Task 6: the source inventory test must
scan all `packages/server/src/**/*.ts` job producers and validate every concrete
enqueue/insert occurrence for initiating-policy mail job types.

## RED

- Invocation: `pnpm exec jest tests/unit/server-mail-job-provenance.test.ts --runInBand`
- Binary observable: FAIL, 1 failed test, 5 passed tests.
- Expected failure: repo-wide scan discovered an omitted real producer block and
  the old block-only provenance regex failed on
  `packages/server/src/mail-compose-send.ts:workflow.execute`.
- Captured artifact: `.hermes/reports/task-6-final-important-red.log`

## GREEN

- Focused invocation: `pnpm exec jest tests/unit/server-mail-job-provenance.test.ts --runInBand`
- Binary observable: PASS, 1 suite, 6/6 tests.
- Captured artifact: `.hermes/reports/task-6-final-important-green-provenance-final.log`

- Provenance regression invocation: `pnpm exec jest tests/unit/server-mail-job-event-acl.test.ts tests/unit/server-mail-job-provenance.test.ts tests/unit/mail-inbound-workflow-enqueue.test.ts --runInBand`
- Binary observable: PASS, 3 suites, 17/17 tests.
- Captured artifact: `.hermes/reports/task-6-final-important-green-provenance-regressions-final.log`

- Policy regression invocation: `pnpm exec jest tests/unit/postgres-job-queue-worker.test.ts tests/unit/server-mail-policy-manifest.test.ts tests/integration/server-mail-job-event-acl.test.ts --runInBand`
- Binary observable: PASS, 3 suites, 20/20 tests across unit/integration projects.
- Captured artifact: `.hermes/reports/task-6-final-important-green-policy-regressions-final.log`

- Diff check invocation: `git diff --check`
- Binary observable: PASS, exit 0.
- Captured artifact: `.hermes/reports/task-6-final-important-diff-check.log`

## Changed Files

- `tests/unit/server-mail-job-provenance.test.ts`
- `.superpowers/sdd/mailbox-acl-task-6-report.md`
- `.hermes/reports/task-6-final-important-*.log`
- `.hermes/reports/task-6-final-important-producer-inventory-evidence.md`

## Detection Rationale

- The inventory walks `packages/server/src` recursively and only inspects `.ts`
  source files, so tests, type declarations outside server source, and unrelated
  Task 7/8 files are not part of the scan.
- Concrete producer occurrences are limited to actual queue write call sites:
  `insertInto('job_queue')` and `jobQueue.enqueue({`.
- The generic PostgreSQL queue port is ignored naturally because it has no
  concrete literal or recognized concrete `jobType` producer in the enqueue
  block.
- The assertion checks both missing initiating policy job types and every
  discovered producer occurrence. A repeated `workflow.execute` producer can no
  longer be hidden by another file with the same job type.
- Provenance evidence is accepted only when the block or its payload/helper
  function body contains `actorUserId`, `buildTrustedServiceJobPayload`, or the
  central trusted-service marker field. Helper names such as
  `workflowJobProvenance` and `with...Provenance` are followed to their function
  bodies instead of being accepted as bare strings.

## Self-Review

- Runtime production logic was not changed.
- No Task 7/8 files were touched.
- The repo-wide scan verified the previously omitted producers in
  `mail-compose-send.ts`, `mail-read-receipt-responder.ts`, and `dmarc-ingest.ts`.
- No unprovenanced real producer was found, so no BLOCKED escalation was needed.
- Commit message used: `test(server): cover all mail job producers`.
