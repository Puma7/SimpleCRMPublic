# Mailbox ACL Task 8 Evidence

Date: 2026-07-20
Branch: `codex/server-first-mail-acl`
Base: `e188c5e`

## Success Criteria Evidence

| Criterion | Scenario | Invocation | Binary observable | Artifact |
|---|---|---|---|---|
| RED tests before implementation | Rollout service/API/migration absent with new Task-8 tests | `pnpm exec jest --runTestsByPath tests/unit/server-mail-acl-rollout.test.ts tests/integration/server-mail-access-routes.test.ts --runInBand` | Initial run failed before implementation; no durable RED log retained | Terminal-observed only |
| Shadow vs enforce | Unit scenarios for legacy runtime in shadow and new ACL runtime in enforce | `pnpm exec jest --runTestsByPath tests/unit/server-mail-acl-rollout.test.ts tests/integration/server-mail-access-routes.test.ts --runInBand` | Exit `0`, `48 passed` | `.hermes/reports/task-8-focused-rollout-after-final-review.log` |
| Exact legacy mapping | Unit cases map read rights to `can_read` and send/draft rights to `can_send` | Same focused invocation | Exit `0`, mapping assertions passed | `.hermes/reports/task-8-focused-rollout-after-final-review.log` |
| Not comparable rights | Unit cases enforce new ACL and count only `notComparable` in shadow | Same focused invocation | Exit `0`, non-comparable assertions passed | `.hermes/reports/task-8-focused-rollout-after-final-review.log` |
| Owner/Admin semantics | Unit cases bypass owner/admin without counting or legacy calls | Same focused invocation | Exit `0`, bypass assertions passed | `.hermes/reports/task-8-focused-rollout-after-final-review.log` |
| Scope and single-resource decisions | Unit cases cover account resource decisions and both resolveScope mismatch directions | Same focused invocation | Exit `0`, scope assertions passed | `.hermes/reports/task-8-focused-rollout-after-final-review.log` |
| Workspace isolation | Unit cross-workspace deny and PostgreSQL RLS isolation test | Same focused invocation | Exit `0`, isolation assertions passed | `.hermes/reports/task-8-focused-rollout-after-final-review.log` |
| Atomic counters | PostgreSQL concurrent increment test | Same focused invocation | Exit `0`, final bigint sums matched all increments | `.hermes/reports/task-8-focused-rollout-after-final-review.log` |
| Corrupt/missing states | Unit diagnostic enforce fallback and PostgreSQL missing-row default enforce | Same focused invocation | Exit `0`, diagnostic/default assertions passed | `.hermes/reports/task-8-focused-rollout-after-final-review.log` |
| Existing vs new workspaces | Migration test applies `0039` and creates workspace after migration | Same focused invocation | Exit `0`, existing workspaces had shadow rows, new workspace had no row/default enforce | `.hermes/reports/task-8-focused-rollout-after-final-review.log` |
| Enforce skips legacy port | Unit case asserts no legacy calls in enforce | Same focused invocation | Exit `0`, legacy spy remained uncalled | `.hermes/reports/task-8-focused-rollout-after-final-review.log` |
| 0038 unchanged, 0039 registered | Migration source hash and ordering test | Same focused invocation | Exit `0`, 0038 hash `3048f74add211b1f36b49b54baaf84d5f3a1d66fc6561e5614766f76c87600cd`, 0039 follows 0038 | `.hermes/reports/task-8-focused-rollout-after-final-review.log` |
| Admin API and audit | Unit API cases for readiness, reset, enforce, rejection and audit entries | Same focused invocation | Exit `0`, admin assertions passed | `.hermes/reports/task-8-focused-rollout-after-final-review.log` |
| HTTP/jobs/events central use | Unit cases prove HTTP, user job and user event filtering use same decorator semantics; service job uncounted | Same focused invocation | Exit `0`, central-use assertions passed | `.hermes/reports/task-8-focused-rollout-after-final-review.log` |

## Required Gates

| Gate | Invocation | Binary observable | Artifact |
|---|---|---|---|
| Lint | `pnpm run lint` | Exit `0` | `.hermes/reports/task-8-lint.log` |
| Unit | `pnpm run test:unit` | Exit `0` | `.hermes/reports/task-8-test-unit.log` |
| Integration | `pnpm run test:integration` | Exit `0` | `.hermes/reports/task-8-test-integration.log` |
| Mail coverage | `pnpm run test:mail:coverage` | Exit `0` | `.hermes/reports/task-8-test-mail-coverage.log` |
| Build | `pnpm run build` | Exit `0`; existing Vite warnings only | `.hermes/reports/task-8-build.log` |
| Root typecheck | `pnpm run typecheck` | Exit `0` | `.hermes/reports/task-8-root-typecheck.log` |
| Whitespace | `git diff --check` | Exit `0` | `.hermes/reports/task-8-git-diff-check.log` |

## Notes

- Existing independent build warnings: Vite externalization warnings for Node
  modules (`crypto`, `node:crypto`, `fs`, `path`, `node:fs`, `node:path`) and
  chunk-size warning.
- Initial RED symptoms were observed before implementation but not captured as a
  durable `.hermes/reports/` artifact.

## Review-Fix Evidence (Base `6e286e7`)

| Criterion | Scenario | Binary observable | Artifact |
|---|---|---|---|
| Durable RED | Focused unit + PostgreSQL suite before review-fix production changes | Exit `1`; `11 failed`, `46 passed` | `.hermes/reports/task-8-review-fix-red.log` |
| Focused GREEN | Same focused invocation after implementation | Exit `0`; `2` suites, `58` tests passed | `.hermes/reports/task-8-review-fix-focused-green.log` |
| Shared/exclusive ordering | Two paused shadow evaluations on one pool; enforce/reset from separate pools | Exclusive advisory waiter observed in `pg_locks`; enforce saw both mismatches; reset cleared only after evaluation commit | Focused GREEN log |
| No nested pool deadlock | Real State, Legacy and New-ACL ports on a pool with `maxConnections=1` | Comparable shadow evaluation completed and counted | Focused GREEN log |
| Post-enforce legacy exclusion | Successful exclusive transition followed by a new evaluation | Runtime allowed via new ACL; legacy call count remained `0` | Focused GREEN log |
| Unexpected counter failure | PostgreSQL trigger raises on counter changes | Savepoint recovered; Allow and Deny preserved; `counter_update_failed` persisted; transition returned `telemetry_unhealthy` | Focused GREEN log |
| RLS zero-row | Evaluation counter port intentionally receives another workspace's RLS session | Allow and Deny preserved; bounded `counter_update_zero_rows`; neither workspace counters changed | Focused GREEN log |
| Overflow saturation | Evaluated counter starts at bigint MAX-1 for Allow and Deny paths | Counter saturated at `9223372036854775807`, never wrapped; health false and `counter_saturated` persisted | Focused GREEN log |
| Healthy reset | Reset after saturation/diagnostic | Counters and observation cleared; `telemetryHealthy=true`; diagnostic code/time null | Focused GREEN log |
| API/readiness/audit | Readiness fields and unhealthy transition rejection | `telemetryHealthy`/`diagnosticCode` returned; unhealthy enforce mapped to 409; only successful enforce audited | Focused GREEN log |
| Migration/RLS | Fresh `0039` application and FORCE RLS | Existing rows default healthy; post-migration workspace still has no row/default enforce; 0038 source unchanged | Focused GREEN log |

### Review-Fix Required Gates

| Gate | Binary observable | Artifact |
|---|---|---|
| `pnpm run lint` | Exit `0` | `.hermes/reports/task-8-review-fix-lint.log` |
| `pnpm run test:unit` | `265` suites, `2398` tests passed, Exit `0` | `.hermes/reports/task-8-review-fix-test-unit.log` |
| `pnpm run test:integration` | `25` suites, `345` tests passed, Exit `0` | `.hermes/reports/task-8-review-fix-test-integration.log` |
| `pnpm run test:mail:coverage` | `179` suites; `1166` passed, `1` skipped; 91.91 % lines / 80.08 % branches; Exit `0` | `.hermes/reports/task-8-review-fix-test-mail-coverage.log` |
| `pnpm run build` | Exit `0`; existing Vite warnings only | `.hermes/reports/task-8-review-fix-build.log` |
| `pnpm run typecheck` | Exit `0` | `.hermes/reports/task-8-review-fix-root-typecheck.log` |
| `git diff --check` | Exit `0` | `.hermes/reports/task-8-review-fix-git-diff-check.log` |
