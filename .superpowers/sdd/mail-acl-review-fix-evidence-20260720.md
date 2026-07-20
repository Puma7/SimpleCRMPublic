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

- Full `pnpm run test:integration` is not green because concurrent Task-8 rollout/audit edits in `tests/integration/server-mail-access-routes.test.ts` currently fail four assertions/unhandled connection paths. These files are outside this ACL assignment and were not corrected here.
- The shared worktree contains unrelated Task-8 changes. Stage/commit selection must remain partial and scoped to the ACL changes and evidence.
