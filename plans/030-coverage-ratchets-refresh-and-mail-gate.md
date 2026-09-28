# Plan 030: Coverage ratchets track reality again and the mail ratchet runs in CI

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update this plan's row in
> `plans/README.md` (section "Runde 2") **and** tick its checkbox in
> `plans/MASTERPLAN.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 9e0491e3..HEAD -- scripts/check-server-coverage-ratchet.mjs scripts/check-ui-coverage-ratchet.mjs scripts/check-mail-coverage-ratchet.mjs server-coverage-baseline.json ui-coverage-baseline.json mail-coverage-baseline.json package.json .github/workflows/ci.yml jest.mail.config.cjs docs/MAIL_TESTING.md`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: tests
- **Planned at**: commit `9e0491e3`, 2026-09-27

Audit corrections (verified at `9e0491e3`): the mail baseline was last changed on
2026-06-09 (`3a51c48c`), not 2026-07-10; the server baseline last changed in
`30a9a731` and the UI baseline in `2544ad63` (both 2026-07-10). Everything else in
the finding holds.

## Why this matters

The three coverage ratchets only fail when coverage drops more than 1 point below
a committed baseline. Those baselines are 2.5 months old and far below today's
coverage (server lines 68.51 vs ~81, UI lines 12.26 vs ~56), so a PR could delete
whole test files and still pass — the ratchet has stopped ratcheting. The mail
ratchet script exists but CI never runs it. After this plan the baselines match
real measurements, CI fails when a baseline is stale by more than 2 points (so
people bump it when coverage rises), and the mail scope is gated like the others.

## Current state

Files:

- `scripts/check-server-coverage-ratchet.mjs` (70 lines), `scripts/check-ui-coverage-ratchet.mjs` (70 lines),
  `scripts/check-mail-coverage-ratchet.mjs` (57 lines) — three near-identical copies. Each reads
  `coverage/<scope>/coverage-summary.json`, takes **only `summary.total`**, and compares
  statements/branches/functions/lines to `<scope>-coverage-baseline.json`. `--update-baseline` overwrites the baseline.
- `server-coverage-baseline.json`, `ui-coverage-baseline.json`, `mail-coverage-baseline.json` — the floors.
- `package.json` scripts (lines 71–78):
  ```
  "test:mail": "jest --config=jest.mail.config.cjs --coverageThreshold={}",
  "test:mail:coverage": "jest --config jest.mail.config.cjs",
  "test:mail:coverage:update-baseline": "npm run test:mail:coverage && node scripts/check-mail-coverage-ratchet.mjs --update-baseline",
  "test:server:coverage": "jest --config jest.server.config.cjs",
  "test:server:coverage:update-baseline": "npm run test:server:coverage && node scripts/check-server-coverage-ratchet.mjs --update-baseline",
  "test:ui:coverage": "jest --config jest.ui.config.cjs",
  "test:ui:coverage:update-baseline": "npm run test:ui:coverage && node scripts/check-ui-coverage-ratchet.mjs --update-baseline",
  "test:ui:coverage:check": "npm run test:ui:coverage && node scripts/check-ui-coverage-ratchet.mjs",
  ```
- `jest.mail.config.cjs:83-101` — `collectCoverage: true`, `coverageReporters: ['text', 'lcov', 'json-summary']`,
  `coverageDirectory: coverage/mail`, plus a hard `coverageThreshold.global` of statements 90 / branches 80 /
  functions 93 / lines 90. Because `collectCoverage` is `true`, **`pnpm run test:mail` already writes
  `coverage/mail/coverage-summary.json`**; `--coverageThreshold={}` only disables the hard gate. Adding the
  ratchet check to CI therefore costs no extra test time.
- `.github/workflows/ci.yml:71-83` (job `build-and-test`):
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
- `docs/MAIL_TESTING.md:21` calls the mail ratchet "Optional".

Comparison logic today (`scripts/check-server-coverage-ratchet.mjs:52-68`; the UI script is identical, the
mail script uses `current + 0.05 < floor` and has no invalid-floor check):

```js
const TOLERANCE = 1;
let failed = false;
for (const m of metrics) {
  const current = snapshot[m];
  const floor = baseline[m];
  if (typeof floor !== 'number' || Number.isNaN(floor)) {
    console.error(`Baseline missing/invalid metric ${m}`);
    failed = true;
    continue;
  }
  if (current + TOLERANCE < floor) {
    console.error(`Coverage regressed for ${m}: ${current}% < baseline ${floor}%`);
    failed = true;
  }
}
```

Measured numbers (statements / branches / functions / lines):

| Scope | Committed baseline | Local, 2026-09-26/27 (`coverage/<scope>/coverage-summary.json`) | CI, run 36304745572 on `9e0491e3` |
|---|---|---|---|
| server | 68.51 / 67.92 / 51.11 / 68.51 | 81.04 / 74.13 / 80.85 / 81.04 | not extracted — read it (Step 4) |
| ui | 12.26 / 55.97 / 25.49 / 12.26 | 55.93 / 70.01 / 42.35 / 55.93 | 56.7 / 69.54 / 42.94 / 56.7 |
| mail | 90.8 / 81.52 / 94.03 / 90.8 | 93.69 / 83.69 / 95.54 / 93.69 | not extracted — read it (Step 4) |

Local vs CI differ by up to ~0.8 points (v8 differences); this is why TOLERANCE is 1.

Conventions: test files that exec repo scripts via `child_process` exist — pattern after
`tests/unit/server-backup-restore-scripts.test.ts` (uses `execFileSync`/`spawnSync`, `repoRoot = join(__dirname, '..', '..')`).
Tests that read `ci.yml` — pattern after `tests/integration/electron-e2e-ci.test.ts`
(`readFileSync(join(process.cwd(), '.github', 'workflows', 'ci.yml'), 'utf8')`). Pinned action for artifacts, already
used in `ci.yml:165`: `actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 # v4.6.2`.

## Commands you will need

Prefix every command with `export PATH=/opt/node24/bin:$PATH;` in this environment.

| Purpose | Command | Expected |
|---|---|---|
| Install | `pnpm install` | exit 0 |
| Build workspace packages | `pnpm run build:packages` | exit 0 |
| Typecheck | `pnpm run typecheck` | exit 0 |
| Lint | `pnpm run lint` | exit 0, 0 warnings |
| Focused test | `pnpm exec jest <test file path>` | all pass |
| Mail suite + ratchet | `pnpm run test:mail && node scripts/check-mail-coverage-ratchet.mjs` | pass |
| Server coverage + ratchet | `pnpm run test:server:coverage && node scripts/check-server-coverage-ratchet.mjs` | pass |
| UI coverage + ratchet | `pnpm run test:ui:coverage:check` | pass |

**Server coverage must run as a non-root user.** ~71 suites in `tests/integration/` start an embedded PostgreSQL
(`tests/integration/helpers/embedded-postgres.ts:26`: "Initdb refuses to run as root"). As root, those suites
fail and server coverage is measured several points too low. Check `id -u`; if it prints `0`:

```bash
chmod -R a+rwX .tmp-tests tests packages/core/dist packages/server/dist coverage 2>/dev/null
su tester -s /bin/bash -c "export PATH=/opt/node24/bin:\$PATH; cd /home/user/SimpleCRMPublic && node_modules/.bin/jest --config jest.server.config.cjs --cacheDirectory /tmp/jest-tester --forceExit"
```

## Scope

**In scope** (the only files you may modify/create):
- `scripts/lib/coverage-ratchet.mjs` (create)
- `scripts/check-server-coverage-ratchet.mjs`, `scripts/check-ui-coverage-ratchet.mjs`, `scripts/check-mail-coverage-ratchet.mjs`
- `server-coverage-baseline.json`, `ui-coverage-baseline.json`, `mail-coverage-baseline.json`
- `package.json` (scripts only: add `test:mail:coverage:check`)
- `.github/workflows/ci.yml` (job `build-and-test` only)
- `tests/unit/coverage-ratchet-scripts.test.ts` (create)
- `tests/integration/ci-coverage-gates.test.ts` (create)
- `docs/MAIL_TESTING.md`
- Optional Step 7 only: `scripts/check-new-file-coverage.mjs` (create)

**Out of scope**:
- `AGENTS.md`, `docs/AGENT_HANDOFF.md` — plan 042 documents the final CI state after plan 031.
- `jest.config.cjs`, `jest.server.config.cjs`, `jest.ui.config.cjs` — plan 031 restructures the Jest runs.
- `jest.mail.config.cjs` hard threshold — leave it; it stays below the new baseline and is harmless.
- Replacing `npm run` with `pnpm run` inside existing package.json scripts — separate cleanup.
- No CHANGELOG entry: nothing user-visible changes.

## Git workflow

- Branch: `advisor/030-coverage-ratchets-refresh`
- German, imperative commit messages with an area prefix, e.g.
  `Coverage: Ratchet-Skripte teilen eine Prüfung, veraltete Baseline schlägt fehl`,
  `Coverage: Baselines auf gemessene Werte anheben, Mail-Ratchet in CI`.
- Do NOT push or open a PR unless the operator says so.

## Steps

### Step 1: Write the failing script tests

Create `tests/unit/coverage-ratchet-scripts.test.ts`. Use `test.each(['server', 'ui', 'mail'])` over
`scripts/check-${scope}-coverage-ratchet.mjs`. Each case writes a temp summary
(`{ total: { statements: {pct}, branches: {pct}, functions: {pct}, lines: {pct} } }`) and a temp baseline into
`mkdtempSync(join(tmpdir(), 'ratchet-'))`, then runs
`spawnSync(process.execPath, [script, '--summary', summaryPath, '--baseline', baselinePath], { encoding: 'utf8' })`.
Cases (baseline 80 on all four metrics unless stated):

1. measured 80.5 everywhere → exit 0.
2. measured 79.2 (within tolerance 1) → exit 0 — this is new for `mail` (its tolerance was 0.05).
3. measured 78.5 lines → exit 1, stderr contains `regressed for lines`.
4. measured 82.5 lines → exit 1, stderr contains `stale` and the update command for that scope.
5. measured 81.9 lines → exit 0 (stale margin is "more than 2").
6. baseline missing `branches` → exit 1, stderr contains `missing/invalid`.
7. `--update-baseline` → exit 0 and the baseline file now equals the measured snapshot.
8. stdout always contains the measured snapshot (also on failure) so CI logs show the numbers.

**Verify**: `pnpm exec jest tests/unit/coverage-ratchet-scripts.test.ts` → fails (the scripts do not accept
`--summary`/`--baseline` and have no stale check yet).

### Step 2: Extract one shared ratchet implementation

Create `scripts/lib/coverage-ratchet.mjs` (plain ESM, no dependencies):

```js
export const METRICS = ['statements', 'branches', 'functions', 'lines'];
export const TOLERANCE = 1;      // v8-Abweichung zwischen Umgebungen (bis ~0,8 Punkte gemessen)
export const STALE_MARGIN = 2;   // mehr als 2 Punkte über der Baseline = Baseline veraltet

export function snapshotFromSummary(summary) { /* summary.total[m].pct ?? 0 for each metric; throw if no total */ }
export function evaluateRatchet(snapshot, baseline, { tolerance = TOLERANCE, staleMargin = STALE_MARGIN } = {}) {
  // returns { invalid: string[], regressions: string[], stale: string[] } (metric names)
}
export function runRatchetCli({ label, defaultSummaryPath, defaultBaselinePath, measureCommand, updateCommand, argv }) {
  // parses --update-baseline, --summary <p>, --baseline <p>; prints `${label} coverage measured:` + snapshot first;
  // on --update-baseline writes JSON.stringify(snapshot, null, 2) + '\n' and exits 0;
  // otherwise prints one line per problem and process.exit(1) if any, else `${label} coverage meets baseline:`.
}
```

Messages (keep them in English like today):
- regression: `Coverage regressed for ${m}: ${current}% < baseline ${floor}% (tolerance ${tolerance})`
- stale: `Coverage baseline is stale for ${m}: measured ${current}% > baseline ${floor}% + ${staleMargin}. Raise it: ${updateCommand}`
- invalid: `Baseline missing/invalid metric ${m}`

Rewrite each of the three `check-*-coverage-ratchet.mjs` into a ~15-line wrapper calling `runRatchetCli` with its
scope's defaults (`coverage/<scope>/coverage-summary.json`, `<scope>-coverage-baseline.json`, measure command
`pnpm run test:<scope>:coverage` — for mail `pnpm run test:mail` — and update command
`pnpm run test:<scope>:coverage:update-baseline`). Resolve default paths relative to the repo root exactly as the
scripts do today (`path.join(__dirname, '..')` via `fileURLToPath(import.meta.url)`). Keep the success line prefix
`Server coverage meets baseline:` / `Email UI coverage meets baseline:` / `Mail coverage meets baseline:` unchanged —
people search CI logs for them.

**Verify**: `pnpm exec jest tests/unit/coverage-ratchet-scripts.test.ts` → all pass (8 cases × 3 scopes).

### Step 3: Measure all three scopes locally

Run, in this order, and keep the output:

```bash
pnpm run test:mail                          # writes coverage/mail/coverage-summary.json
pnpm run test:ui:coverage                   # writes coverage/ui/coverage-summary.json
# server: as non-root, see "Commands you will need"
```

Then print the four metrics per scope:
`node -e 'for (const s of ["server","ui","mail"]) { const t=require("./coverage/"+s+"/coverage-summary.json").total; console.log(s, ["statements","branches","functions","lines"].map(m=>t[m].pct).join(" / ")) }'`

**Verify**: server lines ≥ 78 (otherwise the Postgres suites did not run — STOP), UI lines ≥ 50, mail lines ≥ 92.

### Step 4: Read CI's own numbers for the same commit

Open the latest green CI run on `main` in the GitHub web UI (Actions → CI → newest run on `main` → job
`build-and-test`), or with `gh run view <run-id> --log --job <job-id>` where `gh` is available. Read:
- step "Server module coverage (ratchet)": last line `Server coverage meets baseline: { statements: …, branches: …, functions: …, lines: … }`
- step "Email UI coverage ratchet": last line `Email UI coverage meets baseline: {…}` (for `9e0491e3`: 56.7 / 69.54 / 42.94 / 56.7)
- step "Mail module tests": the `All files` row of the text coverage table (`% Stmts | % Branch | % Funcs | % Lines`).

If you cannot reach GitHub from your environment, use the local numbers alone and say so in your report.

**Verify**: you have a CI or explicitly "unavailable" value for each scope × metric.

### Step 5: Write the new baselines

For each scope and metric set `baseline = min(local, CI)` (or `local` when CI is unavailable), two decimals, and
write the three JSON files in the existing format (`{ "statements": …, "branches": …, "functions": …, "lines": … }`).
Taking the minimum keeps both environments green: the lower one sits exactly on the floor, the higher one sits
< 1 point above it, well under the stale margin of 2.

**Verify**: `node scripts/check-server-coverage-ratchet.mjs && node scripts/check-ui-coverage-ratchet.mjs && node scripts/check-mail-coverage-ratchet.mjs`
→ all three print `… meets baseline` and exit 0.

### Step 6: Gate the mail ratchet in CI and keep the numbers as an artifact

In `package.json` add `"test:mail:coverage:check": "pnpm run test:mail && node scripts/check-mail-coverage-ratchet.mjs"`.

In `.github/workflows/ci.yml`, replace the "Mail module tests" step with:

```yaml
      - name: Mail module tests (coverage ratchet)
        run: pnpm run test:mail:coverage:check
```

and add directly after the "Email UI coverage ratchet" step:

```yaml
      - name: Upload coverage summaries
        if: ${{ always() }}
        uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 # v4.6.2
        with:
          name: coverage-summaries-${{ github.run_id }}-${{ github.run_attempt }}
          path: |
            coverage/mail/coverage-summary.json
            coverage/server/coverage-summary.json
            coverage/ui/coverage-summary.json
          if-no-files-found: warn
          retention-days: 14
```

Create `tests/integration/ci-coverage-gates.test.ts` (pattern: `tests/integration/electron-e2e-ci.test.ts`)
asserting that `ci.yml` contains `check-mail-coverage-ratchet.mjs` **or** `test:mail:coverage:check`,
contains `check-server-coverage-ratchet.mjs`, contains `check-ui-coverage-ratchet.mjs` **or**
`test:ui:coverage:check`, and that `package.json` `test:mail:coverage:check` ends with
`node scripts/check-mail-coverage-ratchet.mjs`. (Plan 031 will adapt this test.)

Update `docs/MAIL_TESTING.md`: in the command table add `pnpm run test:mail:coverage:check` (Gate: "Ratchet gegen
`mail-coverage-baseline.json`, wie in CI"); in "## CI" say CI runs `pnpm run test:mail:coverage:check`; replace the
"Optional:" sentence with: CI bricht ab, wenn die Coverage mehr als 1 Punkt unter die Baseline fällt oder mehr als
2 Punkte darüber liegt (dann Baseline mit `pnpm run test:mail:coverage:update-baseline` anheben).

**Verify**: `pnpm exec jest tests/integration/ci-coverage-gates.test.ts` → pass;
`pnpm run test:mail:coverage:check` → exit 0.

### Step 7 (OPTIONAL — only if the operator asked for it; otherwise list it as follow-up in your report)

Warn-only per-file floor for files added in the PR: `scripts/check-new-file-coverage.mjs` reads
`git diff --name-only --diff-filter=A origin/main...HEAD`, looks each added `packages/server/src/**/*.ts`,
`src/components/email/**`, `electron/email/**` file up in the per-file entries of the three
`coverage-summary.json` files (keys are absolute paths; `summary[absPath].lines.pct`), and prints
`::warning file=<path>::Neue Datei mit <pct>% Zeilenabdeckung (Ziel 60 %)` for each below 60. Exit 0 always.
CI needs `fetch-depth: 0` on the checkout step and runs it with `if: github.event_name == 'pull_request'`.

**Verify**: `node scripts/check-new-file-coverage.mjs` → exit 0.

## Test plan

- `tests/unit/coverage-ratchet-scripts.test.ts` (new): 8 cases × 3 scopes as listed in Step 1.
- `tests/integration/ci-coverage-gates.test.ts` (new): CI still runs all three ratchets.
- Full: `pnpm run lint`, `pnpm run typecheck`, `pnpm test`, then the three ratchet commands from the table.

## Done criteria

- [ ] `pnpm exec jest tests/unit/coverage-ratchet-scripts.test.ts tests/integration/ci-coverage-gates.test.ts` passes
- [ ] `pnpm run lint` exit 0; `pnpm run typecheck` exit 0; `pnpm test` all pass
- [ ] `node scripts/check-{server,ui,mail}-coverage-ratchet.mjs` each exit 0 against fresh local coverage
- [ ] Baseline lines: server ≥ 78, UI ≥ 50, mail ≥ 92 (`cat *-coverage-baseline.json`)
- [ ] `grep -n "check-mail-coverage-ratchet\|test:mail:coverage:check" .github/workflows/ci.yml` finds the mail gate
- [ ] `git status` shows only in-scope files changed
- [ ] Row 030 updated in `plans/README.md` (Runde 2) and box ticked in `plans/MASTERPLAN.md`

## STOP conditions

- Server lines measure below 78 locally → the embedded-Postgres suites probably did not run (root, missing
  binaries); do not write that baseline.
- Local and CI numbers for any metric differ by more than 1.5 points → the stale margin (2) would be too tight; report
  the numbers instead of raising the margin.
- A ratchet script is referenced by some other file than the ones listed here (`grep -rn "coverage-ratchet" --exclude-dir=node_modules --exclude-dir=coverage .`).
- `pnpm run test:mail` no longer writes `coverage/mail/coverage-summary.json` (config drifted).

## Maintenance notes

- Raising coverage by more than 2 points now fails CI until the baseline is bumped with the scope's
  `…:update-baseline` script — that is the point. If CI and local drift further apart, prefer the CI value
  (it gates merges) and read it from the new `coverage-summaries-*` artifact.
- Plan 031 merges the server and UI Jest runs; it must keep the three baseline files and the
  `runRatchetCli` interface unchanged.
- Plan 042 updates `AGENTS.md` (its line 51 still describes the mail threshold as the ratchet).
