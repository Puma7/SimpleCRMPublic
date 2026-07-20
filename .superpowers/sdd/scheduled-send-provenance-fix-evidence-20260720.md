# Scheduled-send provenance fix evidence - 2026-07-20

## RED

Invocation:

`pnpm exec jest tests/unit/server-mail-job-event-acl.test.ts tests/unit/server-mail-job-provenance.test.ts tests/unit/server-edition-foundation.test.ts --runInBand`

Exit code: `1`

Binary observable:

- `tests/unit/server-edition-foundation.test.ts`: scheduled-send port still sent as `actorUserId: "system"` instead of `USER_A_ID`.
- `tests/unit/server-edition-foundation.test.ts`: missing-provenance scheduled-send port test resolved instead of throwing `scheduled_send_provenance_required`.
- `tests/unit/server-edition-foundation.test.ts`: route calls to `scheduleDraftSend` and `retryScheduledSendDraft` lacked `actorUserId`.
- `tests/unit/server-mail-job-provenance.test.ts`: `buildScheduledSendJobPlan` did not preserve `actorUserId` or trusted-service provenance.
- `tests/unit/server-mail-job-event-acl.test.ts`: queued scheduled-send reached the Graphile handler after actor degrant/disable.
- `tests/unit/server-mail-job-event-acl.test.ts`: formerly service-only mail jobs accepted unmarked payloads.
- `tests/unit/server-mail-job-event-acl.test.ts`: scheduled-send was absent from the user-or-service job policy inventory.

Captured artifact path:

`.superpowers/sdd/scheduled-send-provenance-fix-evidence-20260720.md`

## Full gate evidence

Scenario: lint.

Invocation:

`pnpm run lint`

Exit code: `0`

Binary observable:

- Command printed `eslint . --ext ts,tsx --max-warnings 0`.

Scenario: typecheck.

Invocation:

`pnpm run typecheck`

Exit code: `0`

Binary observable:

- Command printed `tsc -b packages/core packages/server packages/desktop && tsc -p tsconfig.json --noEmit && tsc -p tsconfig.electron.json --noEmit`.

Scenario: full unit project.

Invocation:

`pnpm run test:unit`

Exit code: `0`

Binary observable:

- `Test Suites: 265 passed, 265 total`.
- `Tests: 2414 passed, 2414 total`.
- `Snapshots: 1 passed, 1 total`.

Scenario: integration project.

Invocation:

`pnpm run test:integration`

Exit code: `1`

Binary observable:

- `Test Suites: 1 failed, 24 passed, 25 total`.
- `Tests: 1 failed, 351 passed, 352 total`.
- Failing test: `tests/integration/server-mail-access-routes.test.ts` / `server mailbox ACL migration > ignores hidden message cursors before normal, priority, and snoozed pagination`.
- Failure: `expect(snoozedPage.items.map((item) => item.id)).toEqual([MESSAGE_A])`; received `[]`, expected `[121]`.
- Clock observable recorded after failure: local `2026-07-20T14:13:17.8249431+02:00`, UTC `2026-07-20T12:13:17.8275588Z`; fixture snooze cutoff is `2026-07-20T12:00:00Z`, so the snoozed row is no longer active under `snoozed_until > now()`.
- `git diff -- tests/integration/server-mail-access-routes.test.ts` printed no diff; the integration test file was not modified.

Scenario: mail coverage ratchet.

Invocation:

`pnpm run test:mail:coverage`

Exit code: `0`

Binary observable:

- `Test Suites: 179 passed, 179 total`.
- `Tests: 1 skipped, 1166 passed, 1167 total`.
- Coverage summary: `All files` statements `91.91`, branches `80.08`, functions `93.66`, lines `91.91`.

Scenario: build.

Invocation:

`pnpm run build`

Exit code: `0`

Binary observable:

- `build:packages`, `build:web`, and `build:electron:main` completed.
- Vite emitted existing browser-externalization warnings for Node modules and a chunk-size warning; command still exited `0`.

Scenario: whitespace diff check.

Invocation:

`git diff --check`

Exit code: `0`

Binary observable:

- Command produced no output.

Captured artifact path:

`.superpowers/sdd/scheduled-send-provenance-fix-evidence-20260720.md`

## GREEN - focused suite after self-review corrections

Invocation:

`pnpm exec jest tests/unit/server-mail-job-event-acl.test.ts tests/unit/server-mail-job-provenance.test.ts tests/unit/server-edition-foundation.test.ts --runInBand`

Exit code: `0`

Binary observable:

- `3 passed, 3 total` test suites.
- `428 passed, 428 total` tests.
- `mail.vacation.auto_reply` and `workflow.dmarc_ingest` are inventoried as user-or-service policies; actorUserId payloads pass and recheck `mail.send` / `mail.attachment.read`.
- Absent and forged service payloads still reject for scheduled send, vacation auto-reply, DMARC ingest, and lock cleanup; canonical trusted-service marker still passes.
- Trusted workflow scheduled send is validated through the Graphile mail job policy path, then compose receives supported downstream actor `system` instead of the provenance marker.
- Scheduled-send provenance is durable for restart/direct discovery and fail-closed when absent.

Captured artifact path:

`.superpowers/sdd/scheduled-send-provenance-fix-evidence-20260720.md`

## GREEN - focused regression suite

Invocation:

`pnpm exec jest tests/unit/server-mail-job-event-acl.test.ts tests/unit/server-mail-job-provenance.test.ts tests/unit/server-edition-foundation.test.ts --runInBand`

Exit code: `0`

Binary observable:

- `3 passed, 3 total` test suites.
- `426 passed, 426 total` tests.
- Covered service boundary: absent/forged service payloads reject; canonical marker works; vacation/DMARC actorUserId payloads work and recheck grants.
- Covered route carry: schedule/retry passes actor to persistence and queue payload.
- Covered worker/ticker: scheduled-send is blocked before handler when actor is disabled/degranted; in-process ticker invokes central policy before claim/send.
- Covered persistence: claimed drafts loaded after restart carry persisted actor; missing provenance refuses send; source checks require durable actor/service columns and terminal clearing.

Captured artifact path:

`.superpowers/sdd/scheduled-send-provenance-fix-evidence-20260720.md`
