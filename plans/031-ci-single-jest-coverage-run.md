# Plan 031: CI runs the unit + integration Jest suites once, with coverage, instead of three times

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update this plan's row in
> `plans/README.md` (section "Runde 2") **and** tick its checkbox in
> `plans/MASTERPLAN.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 9e0491e3..HEAD -- .github/workflows/ci.yml package.json jest.config.cjs jest.server.config.cjs jest.ui.config.cjs jest.mail.config.cjs scripts/ tests/integration/ci-coverage-gates.test.ts docs/LEARNINGS.md`
> Plan 030 is expected to have changed `ci.yml`, `package.json`, `scripts/check-*-coverage-ratchet.mjs`,
> `scripts/lib/coverage-ratchet.mjs` and created `tests/integration/ci-coverage-gates.test.ts` — that drift is
> expected. Any other change to the in-scope files: compare against "Current state"; on a mismatch, STOP.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**: plans/030-coverage-ratchets-refresh-and-mail-gate.md (must be DONE)
- **Category**: dx
- **Planned at**: commit `9e0491e3`, 2026-09-27

Audit correction: the finding expected the job to drop to ~13–14 min. The three runs being merged take
2m53s + 11m30s + 6m18s = 20m41s; the merged run will take about as long as today's server-coverage run
(~11.5–12.5 min), so the job should drop from ~24m45s to **~15–17 min** (≈ 8–9 min saved).

## Why this matters

`build-and-test` executes the same Jest projects three times: `pnpm test` (unit + integration, no coverage),
`test:server:coverage` (unit + integration again, coverage on `packages/server/src`) and `test:ui:coverage`
(unit again, coverage on `src/components/email`). Timings from GitHub Actions run 36304745572 (`main`, `9e0491e3`):
Run tests 2m53s, Mail 1m43s, Server coverage 11m30s, Email UI coverage 6m18s, whole job 24m46s. One coverage run
with both scopes gives the same pass/fail signal and the same two ratchet numbers in roughly half the time.

## Current state

- `jest.config.cjs` — base config with two projects: `unit` (jsdom, `tests/unit/**/*.test.(ts|tsx)`) and
  `integration` (node, `tests/integration/**/*.test.ts`). `collectCoverage: false`; it also has a desktop-file
  `collectCoverageFrom` list and a hard `coverageThreshold.global` of 90 (lines 44–100) that only apply to
  `pnpm run test:coverage` — not used in CI, leave it alone.
- `jest.server.config.cjs` (24 lines) — `...base`, `collectCoverage: true`, `coverageProvider: 'v8'`,
  `coverageDirectory: coverage/server`, `coverageReporters: ['text-summary', 'json-summary']`,
  `collectCoverageFrom: ['packages/server/src/**/*.ts', '!packages/server/src/**/*.d.ts']`, `coverageThreshold: {}`.
  Runs **both** base projects.
- `jest.ui.config.cjs` (33 lines) — same shape, `coverageDirectory: coverage/ui`,
  `collectCoverageFrom: ['src/components/email/**/*.{ts,tsx}', '!src/components/email/**/*.d.ts']`,
  `projects: [unitProject]` (unit only).
- `jest.mail.config.cjs` — **must stay a separate run**: a single `node`-environment project with
  `setupFiles: ['<rootDir>/tests/setup/jest.mail.electron-mock.ts']`, its own `transformIgnorePatterns`
  (adds `archiver|is-stream|zip-stream|…`), its own `testMatch` list (`tests/mail/**` plus ~20
  `tests/unit/email*.test.ts`-style globs that also run under jsdom in the `unit` project) and coverage on
  `electron/email/**`. Merging it would change the environment its tests run in.
- `.github/workflows/ci.yml` job `build-and-test` at `9e0491e3` (lines 71–86; plan 030 renamed the mail step to
  `Mail module tests (coverage ratchet)` running `pnpm run test:mail:coverage:check` and added an
  "Upload coverage summaries" step):
  ```yaml
      - name: Run tests
        run: pnpm test
      - name: Mail module tests
        run: pnpm run test:mail
      - name: Server module coverage (ratchet)
        run: |
          pnpm run test:server:coverage
          node scripts/check-server-coverage-ratchet.mjs
      - name: Email UI coverage ratchet
        run: pnpm run test:ui:coverage:check
  ```
  `ci.yml:21-23` has a comment "Lint, the full Jest run and three coverage passes (mail, server, UI) now take about
  22 minutes; 35 leaves headroom" and `timeout-minutes: 35`.
- Ratchet scripts (after plan 030): `scripts/check-{server,ui,mail}-coverage-ratchet.mjs` read
  `coverage/<scope>/coverage-summary.json` → `summary.total` and accept `--summary <path>`.
- `coverage-summary.json` per-file keys are **absolute paths**, e.g.
  `/home/user/SimpleCRMPublic/packages/server/src/ai-budget.ts` →
  `{"lines":{"total":48,"covered":48,"skipped":0,"pct":100},"functions":{…},"statements":{…},"branches":{…}}`.
  Verified on the local summaries: summing `covered`/`total` over all per-file entries and applying istanbul's
  percent function reproduces `total.*.pct` exactly for all three scopes. The function
  (`node_modules/.pnpm/istanbul-lib-coverage@3.2.2/node_modules/istanbul-lib-coverage/lib/percent.js`):
  ```js
  function percent(covered, total) {
    if (total > 0) return Math.floor((1000 * 100 * covered) / total / 10) / 100;
    return 100.0;
  }
  ```
- No integration test, `electron/`, `shared/` or `packages/server/src` file imports `src/components/email`
  (`grep -rln "components/email" electron shared packages/server/src tests/integration` → nothing), so adding the
  integration project to the UI scope's run does not change which code executes UI files.
- `docs/LEARNINGS.md:42` (item 21) says "CI runs the unit tests again under the server and UI coverage configs".

## Commands you will need

Prefix every command with `export PATH=/opt/node24/bin:$PATH;` in this environment.

| Purpose | Command | Expected |
|---|---|---|
| Install | `pnpm install` | exit 0 |
| Build workspace packages | `pnpm run build:packages` | exit 0 |
| Typecheck | `pnpm run typecheck` | exit 0 |
| Lint | `pnpm run lint` | exit 0, 0 warnings |
| Focused test | `pnpm exec jest <test file path>` | all pass |
| Old server coverage | `pnpm run test:server:coverage && node scripts/check-server-coverage-ratchet.mjs` | pass |
| Old UI coverage | `pnpm run test:ui:coverage:check` | pass |
| New combined run | `pnpm run test:ci:coverage` (created in Step 3) | pass |

Any run that includes the `integration` project must run as a **non-root** user (embedded PostgreSQL; initdb
refuses root, `tests/integration/helpers/embedded-postgres.ts:26`). If `id -u` prints `0`:

```bash
chmod -R a+rwX .tmp-tests tests packages/core/dist packages/server/dist coverage 2>/dev/null
su tester -s /bin/bash -c "export PATH=/opt/node24/bin:\$PATH; cd /home/user/SimpleCRMPublic && node_modules/.bin/jest --config <config> --cacheDirectory /tmp/jest-tester --forceExit"
```

## Scope

**In scope**:
- `jest.ci.config.cjs` (create)
- `scripts/split-coverage-summary.mjs` (create)
- `package.json` (scripts only: add `test:ci:coverage`)
- `.github/workflows/ci.yml` (job `build-and-test` only)
- `tests/integration/ci-coverage-gates.test.ts` (extend; created by plan 030)
- `tests/unit/split-coverage-summary.test.ts` (create)
- `jest.server.config.cjs`, `jest.ui.config.cjs` (header comment only)
- `docs/LEARNINGS.md` (item 21 wording only)

**Out of scope**:
- `jest.mail.config.cjs` and the mail CI step — different environment, stays separate.
- `scripts/check-*-coverage-ratchet.mjs`, `scripts/lib/coverage-ratchet.mjs`, the three baseline JSON files —
  the split script feeds them unchanged inputs; ratchet semantics must not change.
- Deleting `test:server:coverage` / `test:ui:coverage*` / `…:update-baseline` scripts — still used locally.
- Sharding across runners (`jest --shard`) and merging coverage — possible follow-up, not here.
- `AGENTS.md` / `docs/AGENT_HANDOFF.md` — plan 042.

## Git workflow

- Branch: `advisor/031-ci-single-jest-coverage-run`
- German commit messages with area prefix, e.g. `CI: Jest einmal mit Coverage statt dreimal`.
- Do NOT push or open a PR unless the operator says so.

## Steps

### Step 1: Record the reference numbers from the old runs

Run the old server run (non-root) and the old UI run, then copy their summaries aside:

```bash
mkdir -p /tmp/cov-old
# server (non-root, config jest.server.config.cjs) ... then:
cp coverage/server/coverage-summary.json /tmp/cov-old/server.json
pnpm run test:ui:coverage && cp coverage/ui/coverage-summary.json /tmp/cov-old/ui.json
```

Time both runs (`time …`) and note the wall-clock durations.

**Verify**: both files exist; `node -e 'console.log(require("/tmp/cov-old/server.json").total.lines.pct, require("/tmp/cov-old/ui.json").total.lines.pct)'` prints two numbers.

### Step 2: Write the split-script test first

Create `tests/unit/split-coverage-summary.test.ts`. It writes a small synthetic combined summary to a temp dir
(two files under `<root>/packages/server/src/`, two under `<root>/src/components/email/`, where `<root>` is the
value passed via `--root`), runs
`spawnSync(process.execPath, ['scripts/split-coverage-summary.mjs', '--input', p, '--out-dir', d, '--root', r])`
and asserts:
1. `d/server/coverage-summary.json` and `d/ui/coverage-summary.json` contain exactly their scope's per-file entries.
2. Each `total.<metric>` has `total`/`covered`/`skipped` sums and `pct` computed with the istanbul function above
   (include a case with `total: 0` → `pct: 100`, and a case where the floor matters, e.g. 2/3 → 66.66).
3. An entry outside both scopes → exit 1 with `unexpected file`.
4. A scope with zero entries → exit 1 with `no files`.

**Verify**: `pnpm exec jest tests/unit/split-coverage-summary.test.ts` → fails (script missing).

### Step 3: Combined config, split script, package script

Create `jest.ci.config.cjs`:

```js
/**
 * CI: unit + integration EINMAL mit Coverage. Deckt die Scopes von jest.server.config.cjs
 * (packages/server/src) und jest.ui.config.cjs (src/components/email) gleichzeitig ab;
 * scripts/split-coverage-summary.mjs teilt das Ergebnis danach in coverage/server und
 * coverage/ui auf, sodass die Ratchet-Skripte unverändert bleiben.
 */
const path = require('path');
const base = require('./jest.config.cjs');

/** @type {import('jest').Config} */
module.exports = {
  ...base,
  collectCoverage: true,
  coverageProvider: 'v8',
  coverageDirectory: path.join(__dirname, 'coverage/ci'),
  coverageReporters: ['text-summary', 'json-summary'],
  collectCoverageFrom: [
    'packages/server/src/**/*.ts',
    '!packages/server/src/**/*.d.ts',
    'src/components/email/**/*.{ts,tsx}',
    '!src/components/email/**/*.d.ts',
  ],
  coverageThreshold: {},
};
```

Create `scripts/split-coverage-summary.mjs` (ESM, no dependencies). Arguments with defaults:
`--input coverage/ci/coverage-summary.json`, `--out-dir coverage`, `--root <repo root>`. Scopes:
`server` = keys starting with `${root}/packages/server/src/`, `ui` = keys starting with
`${root}/src/components/email/`. Normalise keys with `path.resolve` before comparing. For each scope write
`<out-dir>/<scope>/coverage-summary.json` = `{ total, ...perFileEntries }`, where `total[m] = { total, covered,
skipped, pct: percent(covered, total) }` for `lines`, `statements`, `functions`, `branches`. Exit 1 on an
unexpected key or an empty scope. Print one line per scope: `<scope>: <n> files, lines <pct>%`.

In `package.json` add:
`"test:ci:coverage": "jest --config jest.ci.config.cjs && node scripts/split-coverage-summary.mjs"`.

**Verify**: `pnpm exec jest tests/unit/split-coverage-summary.test.ts` → all pass.

### Step 4: Prove equivalence locally

Run the combined config (non-root), then the split script, then compare to Step 1:

```bash
# non-root: node_modules/.bin/jest --config jest.ci.config.cjs --cacheDirectory /tmp/jest-tester --forceExit
node scripts/split-coverage-summary.mjs
node -e '
const M=["statements","branches","functions","lines"];
for (const s of ["server","ui"]) {
  const o=require("/tmp/cov-old/"+s+".json"), n=require("./coverage/"+s+"/coverage-summary.json");
  const ok=Object.keys(o).filter(k=>k!=="total").sort().join()===Object.keys(n).filter(k=>k!=="total").sort().join();
  console.log(s,"same files:",ok, M.map(m=>m+" "+o.total[m].pct+" -> "+n.total[m].pct).join(" | "));
}'
node scripts/check-server-coverage-ratchet.mjs && node scripts/check-ui-coverage-ratchet.mjs
```

**Verify**: `same files: true` for both scopes; every metric differs by ≤ 0.5 points; both ratchets exit 0;
the combined Jest run reports the same `Test Suites: … passed` count as `pnpm test` (all passed, none failed).
Note the combined run's wall-clock time.

### Step 5: Switch CI to the single run

In `.github/workflows/ci.yml` (job `build-and-test`), replace the three steps "Run tests",
"Server module coverage (ratchet)" and "Email UI coverage ratchet" with:

```yaml
      - name: Run tests (unit + integration, once, with coverage)
        run: pnpm run test:ci:coverage

      - name: Server coverage ratchet
        run: node scripts/check-server-coverage-ratchet.mjs

      - name: Email UI coverage ratchet
        run: node scripts/check-ui-coverage-ratchet.mjs
```

Keep the mail step from plan 030 between "Run tests" and the two ratchet steps, and keep the
"Upload coverage summaries" step after them (add `coverage/ci/coverage-summary.json` to its `path`).
Update the comment above `timeout-minutes` to: one Jest run with coverage, the mail run and lint/build take
about 16 minutes. Keep `timeout-minutes: 35`.

Extend `tests/integration/ci-coverage-gates.test.ts`: `ci.yml` contains `pnpm run test:ci:coverage`,
contains `node scripts/check-server-coverage-ratchet.mjs` and `node scripts/check-ui-coverage-ratchet.mjs`,
and does **not** contain `pnpm run test:server:coverage`, `test:ui:coverage` or a bare `run: pnpm test`
(guards against the duplicate runs coming back).

**Verify**: `pnpm exec jest tests/integration/ci-coverage-gates.test.ts` → pass; the YAML parses:
`python3 -c 'import yaml; yaml.safe_load(open(".github/workflows/ci.yml"))'` → exit 0 (if python3 or PyYAML is
missing, say so in the report instead).

### Step 6: Comments and learnings

- `jest.server.config.cjs` and `jest.ui.config.cjs`: add one header line
  `CI nutzt jest.ci.config.cjs (ein Lauf für beide Scopes); diese Config bleibt für lokale Einzelmessungen und …:update-baseline.`
- `docs/LEARNINGS.md` item 21: replace "CI runs the unit tests again under the server and UI coverage configs"
  with "CI runs the unit and integration tests under coverage (`jest.ci.config.cjs`)"; keep the rest of the item.

**Verify**: `pnpm run lint` → exit 0.

## Test plan

- `tests/unit/split-coverage-summary.test.ts` (new): scope split, totals/pct maths incl. `total: 0` and floor,
  unexpected key, empty scope.
- `tests/integration/ci-coverage-gates.test.ts` (extended): single run present, duplicate runs absent.
- Equivalence check in Step 4 (same file sets, ≤ 0.5 points per metric).
- Full: `pnpm run lint`, `pnpm run typecheck`, `pnpm run test:ci:coverage` (non-root), `pnpm run test:mail:coverage:check`.

## Done criteria

- [ ] `pnpm exec jest tests/unit/split-coverage-summary.test.ts tests/integration/ci-coverage-gates.test.ts` passes
- [ ] Step 4 output: `same files: true` for server and ui; all metric deltas ≤ 0.5
- [ ] `node scripts/check-server-coverage-ratchet.mjs` and `node scripts/check-ui-coverage-ratchet.mjs` exit 0 after `pnpm run test:ci:coverage`
- [ ] `grep -c "test:server:coverage\|test:ui:coverage" .github/workflows/ci.yml` → `0`
- [ ] `pnpm run lint` and `pnpm run typecheck` exit 0
- [ ] `git status` shows only in-scope files changed
- [ ] Report the local wall-clock times: old server + old UI + `pnpm test` vs the combined run
- [ ] Row 031 updated in `plans/README.md` (Runde 2) and box ticked in `plans/MASTERPLAN.md`

## STOP conditions

- Plan 030 is not DONE (no `scripts/lib/coverage-ratchet.mjs` or no `tests/integration/ci-coverage-gates.test.ts`).
- Step 4 shows different file sets for a scope, or any metric delta > 0.5 — the semantics changed; report both summaries.
- The combined run fails a test that passes under `pnpm test` twice in a row (a test that depends on running
  without instrumentation — report it, do not add retries or skip it).
- The combined run is more than 3 minutes slower locally than the old server-coverage run alone.

## Maintenance notes

- A new coverage scope now means: add its globs to `jest.ci.config.cjs`, a prefix to
  `scripts/split-coverage-summary.mjs`, a baseline + ratchet script, and a CI step.
- The per-scope configs (`jest.server.config.cjs`, `jest.ui.config.cjs`) and their `…:update-baseline` scripts
  stay for local use; if they drift from `jest.ci.config.cjs`, local baselines stop matching CI.
- Follow-up (not in this plan): shard the combined run across two runners with `jest --shard` and merge the
  `coverage-final.json` files before splitting, if the job is still too slow.
- Plan 042 documents the resulting CI gates in `AGENTS.md`.
