# Task 6 Review Fix Evidence

Date: 2026-07-19
Branch: codex/server-first-mail-acl

## Scenarios

- Real producer provenance RED/GREEN:
  `pnpm exec jest tests/unit/server-mail-job-event-acl.test.ts tests/unit/server-mail-job-provenance.test.ts --runInBand`
  - RED: missing trusted-service builder, forgeable `principal` accepted, system producers missing markers, continuations dropped actor, unknown runtime events passed, negative account-signature event IDs denied.
  - GREEN observable: focused provenance/event/inbound suite later passed 3 suites, 17/17 tests.

- Workflow/AI/Sync producers:
  `pnpm exec jest tests/unit/postgres-job-queue-worker.test.ts tests/unit/server-mail-job-event-acl.test.ts tests/unit/server-mail-job-provenance.test.ts tests/unit/mail-inbound-workflow-enqueue.test.ts tests/unit/workflow-execution-jsonb.test.ts tests/unit/email-workflow-graph-compile.test.ts tests/unit/workflow-ai-nodes.test.ts tests/integration/server-mail-job-event-acl.test.ts --runInBand`
  - Observable: PASS, 8 suites, 58/58 tests.

- Foundation/manifest/integration:
  `pnpm exec jest tests/unit/server-mail-policy-manifest.test.ts tests/unit/server-edition-foundation.test.ts tests/unit/postgres-job-queue-worker.test.ts tests/integration/server-edition-foundation.test.ts tests/integration/server-mail-job-event-acl.test.ts tests/integration/server-mail-access-routes.test.ts --runInBand`
  - Observable: PASS, 6 suites, 469/469 tests.

- Lint:
  `pnpm run lint`
  - Observable: PASS, exit 0.

- Server build:
  `pnpm --filter @simplecrm/server build`
  - Observable: PASS, exit 0.

- Root typecheck:
  `pnpm run typecheck`
  - Observable: PASS, exit 0.

- Diff check:
  `git diff --check`
  - Observable: PASS, exit 0.

## Artifacts

- Task report: `.superpowers/sdd/mailbox-acl-task-6-report.md`
- This evidence file: `.hermes/reports/task-6-review-fix-evidence.md`
