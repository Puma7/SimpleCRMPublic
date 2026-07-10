# Plan 003: Add a ratcheted coverage floor for the server edition in CI

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in the `README.md` of the directory this plan lives in (`plans/README.md`),
> unless a reviewer dispatched you and told you they maintain the index.
>
> **Drift check (run first)**: `git diff --stat f24fb27..HEAD -- jest.server.config.cjs scripts/check-server-coverage-ratchet.mjs server-coverage-baseline.json package.json .github/workflows/ci.yml`
> (the three new files produce no output until an executor creates them — that is
> normal.) If any of these files changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition. **Expected, non-blocking exception**:
> this plan **depends on plan 002**, which also edits `package.json` (adds a
> `typecheck` script after the `lint` line) and `.github/workflows/ci.yml`
> (adds a `Typecheck` step between `Mail module tests` and `Build (renderer)`).
> Diffs limited to *those two additions* are expected — do not treat them as
> drift. Re-locate your insertion points by the textual anchors named in the
> Steps (not by absolute line numbers) whenever 002 has landed.
>
> Additionally, this plan's design depends on the **unedited** `jest.config.cjs`
> (which it extends but must not modify). Run
> `git diff --stat f24fb27..HEAD -- jest.config.cjs` too: if it changed and no
> longer combines a `projects` array with root-level coverage options (see the
> excerpt in "Current state"), treat that as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: plans/002-ci-test-gate-and-typecheck.md
- **Category**: tests
- **Planned at**: commit `f24fb27`, 2026-07-10

## Why this matters

The `packages/server/src/**` tree — the entire server edition, **185 `.ts`
files** (Fastify API routes, the Kysely/Postgres data layer, auth, jobs,
migrations, diagnostics) — has **no enforced coverage floor in CI**. Dozens of
server suites exist (`tests/unit/server-*.test.ts`, `tests/unit/returns-*.test.ts`,
`tests/integration/server-edition-foundation.test.ts`, etc.), but nothing stops
that coverage from silently eroding as the server grows. The one hand-maintained
coverage allowlist that *does* enforce 90% (`jest.config.cjs`'s
`collectCoverageFrom`, lines 8–50) lists individual electron/renderer files and
**excludes `packages/server/src/**` entirely**; and that 90% threshold only runs
under `test:coverage` (package.json), which **CI never invokes** (the CI job runs
lint → `pnpm test` → `pnpm run test:mail` → build). The only module with a real,
dedicated coverage gate today is `electron/email`, via the mail ratchet
(`jest.mail.config.cjs` + `scripts/check-mail-coverage-ratchet.mjs` +
`mail-coverage-baseline.json`).

This plan mirrors that mail-ratchet mechanism for the server edition: a dedicated
Jest coverage run scoped to `packages/server/src/**`, a **baseline JSON captured
from the current numbers**, a check script that fails only when coverage drops
below baseline, and a CI step that enforces it. It deliberately does **not** set a
hard 90% target (the server tree's current coverage is well below that, so a hard
gate would fail immediately). The floor only ratchets upward: once landed, server
coverage can never silently regress, and can be raised over time by regenerating
the baseline.

## Current state

Files this plan **creates** (none exist yet — verified: `ls jest.server.config.cjs
scripts/check-server-coverage-ratchet.mjs server-coverage-baseline.json` all report
"No such file or directory" at `f24fb27`):

- `jest.server.config.cjs` — new dedicated Jest config; server-edition coverage run.
- `scripts/check-server-coverage-ratchet.mjs` — new ratchet check script.
- `server-coverage-baseline.json` — new committed baseline (generated, not hand-written).

Files this plan **modifies**:

- `package.json` — add two `scripts` entries (`test:server:coverage`,
  `test:server:coverage:update-baseline`).
- `.github/workflows/ci.yml` — add one CI step that runs the coverage + ratchet check.

Files this plan **reads but does not modify** (the exemplars to mirror):
`jest.mail.config.cjs`, `scripts/check-mail-coverage-ratchet.mjs`,
`mail-coverage-baseline.json`, `jest.config.cjs`.

### The exemplar to mirror — the mail ratchet

`scripts/check-mail-coverage-ratchet.mjs` (reproduce this structure exactly,
swapping the two paths and the two hint messages):

```
6   import fs from 'fs';
7   import path from 'path';
8   import { fileURLToPath } from 'url';
9
10  const __dirname = path.dirname(fileURLToPath(import.meta.url));
11  const root = path.join(__dirname, '..');
12  const summaryPath = path.join(root, 'coverage/mail/coverage-summary.json');
13  const baselinePath = path.join(root, 'mail-coverage-baseline.json');
14
15  const metrics = ['statements', 'branches', 'functions', 'lines'];
16  const update = process.argv.includes('--update-baseline');
...
51    if (current + 0.05 < floor) {          // equal or within 0.05 passes
52      console.error(`Coverage regressed for ${m}: ${current}% < baseline ${floor}%`);
```

`mail-coverage-baseline.json` (the shape your generated `server-coverage-baseline.json`
will have — four number keys):

```json
{
  "statements": 90.8,
  "branches": 81.52,
  "functions": 94.03,
  "lines": 90.8
}
```

`jest.mail.config.cjs` — how the mail coverage run is configured (note the
`json-summary` reporter, which is what writes `coverage-summary.json` that the
ratchet reads):

```
46    collectCoverage: true,
47    coverageProvider: 'v8',
48    coverageDirectory: path.join(__dirname, 'coverage/mail'),
49    coverageReporters: ['text', 'lcov', 'json-summary'],
50    collectCoverageFrom: ['electron/email/**/*.ts', '!electron/email/**/*.d.ts'],
```

The mail `package.json` scripts you are mirroring:

```
57    "test:mail:coverage": "jest --config jest.mail.config.cjs",
58    "test:mail:coverage:update-baseline": "npm run test:mail:coverage && node scripts/check-mail-coverage-ratchet.mjs --update-baseline",
```

### The base Jest config you will extend (`jest.config.cjs`)

The root Jest config already combines a `projects` array (two projects, `unit`
and `integration`) with **root-level** coverage options — this is the exact
pattern `jest.server.config.cjs` reuses. Relevant lines:

```
4   module.exports = {
5     collectCoverage: false,
6     coverageProvider: 'v8',
7     coverageDirectory: path.join(__dirname, 'coverage'),
8     collectCoverageFrom: [
9       // Existing covered files
10      'src/lib/contact-utils.ts',
...
57    coverageThreshold: {
58      global: { statements: 90, branches: 90, functions: 90, lines: 90 },
...
73    projects: [
74      { displayName: 'unit', ... testMatch: ['<rootDir>/tests/unit/**/*.test.(ts|tsx)'], ... },
98      { displayName: 'integration', ... testMatch: ['<rootDir>/tests/integration/**/*.test.ts'], ... },
117   ],
```

Key facts that make the design work:

- Root-level `collectCoverage` / `collectCoverageFrom` / `coverageDirectory` /
  `coverageThreshold` apply **globally across all projects** in a `projects`
  run. The repo's own `test:coverage` script
  (`jest --coverage --selectProjects unit integration`) relies on exactly this —
  it runs both projects and reports coverage per the root `collectCoverageFrom`.
  Your `jest.server.config.cjs` spreads the base config (keeping its two
  projects) and **overrides only the coverage options** to scope them to
  `packages/server/src/**`.
- The `collectCoverageFrom` glob makes Jest report **every** matching file,
  including files no test ever imports (they show as 0%). So all 185 server
  files are counted — the baseline reflects true whole-tree server coverage, not
  just the files that happen to be imported.
- Server tests import the source by **relative path**, e.g.
  `tests/unit/server-log-store.test.ts:5` → `} from '../../packages/server/src';`
  and `tests/unit/returns-routes.test.ts:1` →
  `from '../../packages/server/src/api/returns-routes'`. They run inside the
  existing `unit` and `integration` projects (they live under `tests/unit/` and
  `tests/integration/`), which is why reusing `base.projects` — rather than
  inventing a new project — captures them all without touching `roots` or
  `moduleNameMapper`.

### Why coverage is not enforced in CI today (`.github/workflows/ci.yml`)

```
60      - name: Lint
61        run: pnpm run lint
62
63      - name: Run tests
64        run: pnpm test
65
66      - name: Mail module tests
67        run: pnpm run test:mail
68
69      - name: Build (renderer)
70        run: pnpm run build
```

`pnpm test` uses the base config with `collectCoverage: false` — no coverage is
even measured for server code. This plan adds a new step that measures **and**
gates it. (After plan 002 lands, a `Typecheck` step sits between
`Mail module tests` and `Build (renderer)`; insert your new step **immediately
after `Mail module tests`** regardless.)

### Repo conventions to honor

- `.gitignore` ignores `coverage/` (line 92), so the generated
  `coverage/server/` output is **not** committed — only the small root-level
  `server-coverage-baseline.json` is tracked (exactly like `mail-coverage-baseline.json`).
- Ratchet scripts are ESM `.mjs` in `scripts/` (see `check-mail-coverage-ratchet.mjs`).
- CI runs everything via **pnpm** (Node 24, pnpm 9). The ratchet scripts
  themselves call `node`/`npm` internally, matching the mail script — leave
  those `node`/`npm` invocations as-is (mirror the exemplar verbatim).

## Commands you will need

| Purpose   | Command                                             | Expected on success                 |
|-----------|-----------------------------------------------------|-------------------------------------|
| Install   | `pnpm install --frozen-lockfile`                    | exit 0                              |
| Server coverage run | `pnpm run test:server:coverage` (this plan adds it) | Jest passes; writes `coverage/server/coverage-summary.json` |
| Generate/refresh baseline | `pnpm run test:server:coverage:update-baseline` (this plan adds it) | writes `server-coverage-baseline.json`, exit 0 |
| Ratchet check | `node scripts/check-server-coverage-ratchet.mjs` (this plan adds it) | prints "Server coverage meets baseline", exit 0 |
| Tests     | `pnpm test` (targeted: `pnpm test -- <path>`)        | all suites pass                     |
| Lint      | `pnpm run lint`                                      | exit 0 (eslint, `--max-warnings 0`) |
| Build     | `pnpm run build`                                     | exit 0                              |

Package manager is **pnpm** at the top level (see ci.yml). Do not substitute
npm/yarn. Note the server coverage run executes the **full** `unit` +
`integration` Jest projects (same suites as `pnpm test`) with coverage scoped to
`packages/server/src` — it can take several minutes.

## Suggested executor toolkit

- No special skills required. This is config + a small Node script + a CI step.
- Before writing the ratchet script, open `scripts/check-mail-coverage-ratchet.mjs`
  and copy its structure line-for-line; only the two paths and two hint messages
  change.

## Scope

**In scope** (the only files you may create or modify):

- `jest.server.config.cjs` (create)
- `scripts/check-server-coverage-ratchet.mjs` (create)
- `server-coverage-baseline.json` (create — generated by the update-baseline command, then committed)
- `package.json` (add two `scripts` entries; touch no other line)
- `.github/workflows/ci.yml` (add one step)

**Out of scope** (do NOT touch, even though they look related):

- `jest.config.cjs` — the base config is read and *extended*, never edited. Do
  **not** add `packages/server/src` to its `collectCoverageFrom` allowlist and do
  **not** change its 90% `coverageThreshold`; that allowlist governs a different
  (electron/renderer) gate and adding server files there would break the existing
  90% gate under `test:coverage`.
- `jest.mail.config.cjs`, `scripts/check-mail-coverage-ratchet.mjs`,
  `mail-coverage-baseline.json` — the exemplars. Read them; do not modify them.
- `packages/server/src/**` and any `tests/**` file — do **not** write or edit
  server code or tests to inflate the baseline. The baseline is whatever the
  current suite produces. Raising coverage is deliberately a follow-up.
- The `server-compose-smoke` job in `ci.yml` — unrelated.
- The `test`, `test:coverage`, `test:mail*` scripts in `package.json` — leave
  them exactly as they are.

## Git workflow

- Branch: `advisor/003-server-edition-coverage-ratchet`
- Commit style: Conventional Commits (repo convention — e.g. from `git log`:
  `fix(review): keep raw-headers / .eml export out of the mail read bucket`).
  Suggested messages:
  - `test(server): add coverage config and ratchet script for packages/server/src`
  - `test(server): capture initial server coverage baseline`
  - `ci: gate server-edition coverage against the ratchet baseline`

  One commit per step or a single squashed commit is both fine, **except** the
  baseline JSON (Step 4) must be committed — it is a tracked deliverable.
- Do NOT push or open a PR unless the operator explicitly instructs it.

## Steps

### Step 1: Create the dedicated server coverage Jest config

Create `jest.server.config.cjs` at the repo root with exactly this content:

```js
/**
 * Standalone Jest config: server-edition coverage over packages/server/src.
 * Baseline + ratchet only (no hard threshold) — the floor is enforced by
 * scripts/check-server-coverage-ratchet.mjs against server-coverage-baseline.json.
 * Reuses the base config's `unit` + `integration` projects and only overrides
 * the coverage options to scope them to packages/server/src.
 */
const path = require('path');
const base = require('./jest.config.cjs');

/** @type {import('jest').Config} */
module.exports = {
  ...base,
  collectCoverage: true,
  coverageProvider: 'v8',
  coverageDirectory: path.join(__dirname, 'coverage/server'),
  coverageReporters: ['text-summary', 'json-summary'],
  collectCoverageFrom: [
    'packages/server/src/**/*.ts',
    '!packages/server/src/**/*.d.ts',
  ],
  // Intentionally empty: no hard global gate. The ratchet script is the floor.
  coverageThreshold: {},
};
```

Why each override:
- `collectCoverage: true` — the base has it `false`; turn it on for this run.
- `coverageDirectory: .../coverage/server` — isolates output from `coverage/`
  (base) and `coverage/mail`; this is where `coverage-summary.json` lands.
- `coverageReporters: [..., 'json-summary']` — `json-summary` is what writes the
  `coverage-summary.json` the ratchet reads (same as mail config line 49).
- `collectCoverageFrom: ['packages/server/src/**/*.ts', '!...d.ts']` — scopes the
  report to the server tree only, mirroring mail's `electron/email/**` scope.
- `coverageThreshold: {}` — overrides the base's global 90% object so this run
  never hard-fails on coverage; the ratchet enforces the floor instead.

Spreading `...base` deliberately keeps `base.projects` (the `unit` +
`integration` suites), `moduleNameMapper`, and `coveragePathIgnorePatterns` — do
not re-declare them.

**Verify**:
- `node -e "const c=require('./jest.server.config.cjs'); console.log(c.collectCoverage, Array.isArray(c.projects), c.projects.length, JSON.stringify(c.collectCoverageFrom), JSON.stringify(c.coverageThreshold))"`
  → prints `true true 2 ["packages/server/src/**/*.ts","!packages/server/src/**/*.d.ts"] {}`
  (confirms the config loads, still has the 2 base projects, is scoped to server,
  and has no hard threshold).

### Step 2: Create the ratchet check script

Create `scripts/check-server-coverage-ratchet.mjs` by copying
`scripts/check-mail-coverage-ratchet.mjs` **verbatim** and changing only the two
path constants and the two hint messages. Full content:

```js
#!/usr/bin/env node
/**
 * Fail if server-edition coverage regresses below the committed baseline.
 * Run after: npm run test:server:coverage
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const summaryPath = path.join(root, 'coverage/server/coverage-summary.json');
const baselinePath = path.join(root, 'server-coverage-baseline.json');

const metrics = ['statements', 'branches', 'functions', 'lines'];
const update = process.argv.includes('--update-baseline');

if (!fs.existsSync(summaryPath)) {
  console.error(`Missing ${summaryPath}. Run: npm run test:server:coverage`);
  process.exit(1);
}

const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
const total = summary.total;
if (!total) {
  console.error('coverage-summary.json has no total');
  process.exit(1);
}

const snapshot = {};
for (const m of metrics) {
  snapshot[m] = total[m]?.pct ?? 0;
}

if (update) {
  fs.writeFileSync(baselinePath, `${JSON.stringify(snapshot, null, 2)}\n`);
  console.log(`Updated ${baselinePath}:`, snapshot);
  process.exit(0);
}

if (!fs.existsSync(baselinePath)) {
  console.error(`Missing ${baselinePath}. Run: npm run test:server:coverage:update-baseline`);
  process.exit(1);
}

const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
let failed = false;
for (const m of metrics) {
  const current = snapshot[m];
  const floor = baseline[m];
  if (current + 0.05 < floor) {
    console.error(`Coverage regressed for ${m}: ${current}% < baseline ${floor}%`);
    failed = true;
  }
}
if (failed) process.exit(1);
console.log('Server coverage meets baseline:', snapshot);
```

This is a byte-for-byte mirror of the mail script except: `coverage/server/…`
instead of `coverage/mail/…`; `server-coverage-baseline.json` instead of
`mail-coverage-baseline.json`; the two hint messages reference
`test:server:coverage[:update-baseline]`; and the final success line says
"Server coverage meets baseline". The `current + 0.05 < floor` tolerance and the
four-metric loop are unchanged.

**Verify**:
- `node --check scripts/check-server-coverage-ratchet.mjs` → exit 0 (syntax OK).
- `node scripts/check-server-coverage-ratchet.mjs` (before any coverage run) →
  exits **1** and prints `Missing …/coverage/server/coverage-summary.json. Run: npm run test:server:coverage`
  (confirms the missing-summary guard fires; this is expected pre-Step-4).

### Step 3: Add the two package.json scripts

In `package.json`, in the `scripts` block, add these two lines **immediately
after** the existing `test:mail:coverage:update-baseline` line (locate it by
searching for the text `test:mail:coverage:update-baseline`, not by line number —
plan 002 may have shifted line numbers):

```
    "test:server:coverage": "jest --config jest.server.config.cjs",
    "test:server:coverage:update-baseline": "npm run test:server:coverage && node scripts/check-server-coverage-ratchet.mjs --update-baseline",
```

This mirrors the mail pair (`test:mail:coverage` / `test:mail:coverage:update-baseline`).
Keep valid JSON: the line you insert after already ends with a comma, and your
first new line must end with a comma too; the second new line must also end with
a comma if a script line follows it (it will — `test:server-edition`). Change no
other script.

**Verify**:
- `node -e "const s=require('./package.json').scripts; console.log(s['test:server:coverage']); console.log(s['test:server:coverage:update-baseline'])"`
  → prints
  `jest --config jest.server.config.cjs`
  and
  `npm run test:server:coverage && node scripts/check-server-coverage-ratchet.mjs --update-baseline`
- `pnpm run lint` → exit 0 (confirms `package.json` is still valid; a JSON error
  would break tooling).

### Step 4: Generate and commit the initial baseline

Run the update-baseline command. It runs the full server coverage run, then
writes `server-coverage-baseline.json` from the **current** numbers:

```
pnpm run test:server:coverage:update-baseline
```

Expected: Jest runs the `unit` + `integration` suites (all pass — these are the
same suites `pnpm test` runs green in CI), prints a coverage summary, then the
script prints `Updated …/server-coverage-baseline.json: { statements: …,
branches: …, functions: …, lines: … }` and exits 0.

Then confirm the baseline is a well-formed 4-metric object and commit it (it is a
tracked deliverable; `coverage/server/` is `.gitignore`d and must NOT be committed):

- `cat server-coverage-baseline.json` → a JSON object with numeric `statements`,
  `branches`, `functions`, `lines` (the numbers will be **low** — the server tree
  has many untested files — that is expected and correct; the floor only ratchets
  up from here).
- `git add server-coverage-baseline.json`

Do **not** hand-edit the numbers. If the summary's `total` is missing or the
numbers look like `0`/`null` for every metric, STOP (see STOP conditions) — that
indicates the coverage run didn't instrument the server files, not that coverage
is genuinely zero.

**Verify**:
- `node scripts/check-server-coverage-ratchet.mjs` → exit 0, prints
  `Server coverage meets baseline: { … }` (the just-generated baseline equals the
  current snapshot, so the ratchet passes).
- `git status --porcelain server-coverage-baseline.json` → shows it staged (`A`);
  `git status --porcelain coverage/` → shows **nothing** (coverage output is ignored).

### Step 5: Wire the CI step

In `.github/workflows/ci.yml`, insert a new step **immediately after** the
`Mail module tests` step (locate it by the text `name: Mail module tests`). If
plan 002 has landed, a `Typecheck` step now sits between `Mail module tests` and
`Build (renderer)`; still insert your new step directly after `Mail module tests`
(i.e. before `Typecheck`). The `build-and-test` job region becomes:

```
      - name: Mail module tests
        run: pnpm run test:mail

      - name: Server module coverage (ratchet)
        run: |
          pnpm run test:server:coverage
          node scripts/check-server-coverage-ratchet.mjs

      - name: Build (renderer)
        run: pnpm run build
```

(If 002's `Typecheck` step is present, it stays between the new step and
`Build (renderer)` — do not remove or reorder it.) Match the existing 6-space
indentation for `- name:` and 8-space for `run:`. Do not touch any other step and
do not touch the `server-compose-smoke` job.

The step first runs the coverage (writing `coverage/server/coverage-summary.json`)
then runs the ratchet check, which fails the job (exit 1) if any metric dropped
more than 0.05 below the committed baseline.

**Verify**:
- `grep -n "name: Server module coverage (ratchet)\|check-server-coverage-ratchet.mjs\|name: Build (renderer)" .github/workflows/ci.yml`
  → prints the new step name, the ratchet invocation, and the build step, with the
  new step's line number **less than** the `Build (renderer)` line number.
- YAML still parses:
  `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml')); print('yaml ok')"`
  → prints `yaml ok`, exit 0. (If `python3`/`pyyaml` is unavailable, skip this
  sub-check; the grep plus a visual indentation read suffices.)

### Step 6: Full local dry-run of the new gate

Simulate what CI will do, in order, and confirm each is green on the current tree:

```
pnpm run lint
pnpm run test:server:coverage
node scripts/check-server-coverage-ratchet.mjs
```

Each exits 0; the last prints `Server coverage meets baseline: { … }`. Optionally
also run the rest of the CI sequence (`pnpm test`, `pnpm run test:mail`,
`pnpm run build`, and — if 002 landed — `pnpm run typecheck`) to confirm nothing
regressed.

**Verify** (regression probe, throwaway — reverts itself): temporarily raise one
baseline number above the real coverage and confirm the ratchet fails, proving the
gate actually bites:
- `node -e "const f='server-coverage-baseline.json';const b=require('./'+f);b.lines=100;require('fs').writeFileSync(f, JSON.stringify(b,null,2)+'\n')"`
- `node scripts/check-server-coverage-ratchet.mjs` → exits **1**, prints
  `Coverage regressed for lines: …% < baseline 100%`.
- Restore the real baseline: `pnpm run test:server:coverage:update-baseline`
  (or `git checkout server-coverage-baseline.json` if already committed) →
  then `node scripts/check-server-coverage-ratchet.mjs` → exit 0 again.
- `git status --porcelain server-coverage-baseline.json` → the restored file
  matches the committed baseline (no unintended change left behind).

## Test plan

This plan adds test **infrastructure** (a coverage gate), not application logic,
so no new Jest suites are written. Verification is behavioral, on the new
plumbing:

- **Config loads and is correctly scoped** (Step 1): the `node -e` probe confirms
  2 projects + server-only `collectCoverageFrom` + empty threshold.
- **Ratchet script guards correctly** (Steps 2, 6): fails on missing summary,
  fails when a metric is below baseline, passes when the snapshot meets baseline.
- **Baseline is generated, not authored** (Step 4): produced by
  `test:server:coverage:update-baseline` from the real suite, committed.
- **Coverage run is green** (Steps 4, 6): the `unit` + `integration` suites pass
  under `jest.server.config.cjs` — they are the same suites `pnpm test` runs green
  in CI, now with coverage scoped to `packages/server/src`.
- Structural pattern to follow: the mail ratchet
  (`scripts/check-mail-coverage-ratchet.mjs`, `jest.mail.config.cjs`,
  `mail-coverage-baseline.json`). This plan reproduces it for the server edition.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `jest.server.config.cjs` exists; `node -e "const c=require('./jest.server.config.cjs'); process.exit(c.collectCoverage===true && c.projects.length===2 && c.collectCoverageFrom[0]==='packages/server/src/**/*.ts' && JSON.stringify(c.coverageThreshold)==='{}' ? 0 : 1)"` exits 0
- [ ] `scripts/check-server-coverage-ratchet.mjs` exists and `node --check scripts/check-server-coverage-ratchet.mjs` exits 0
- [ ] `server-coverage-baseline.json` exists, is tracked (`git ls-files --error-unmatch server-coverage-baseline.json` exits 0), and has numeric `statements`/`branches`/`functions`/`lines`
- [ ] `package.json` has `test:server:coverage` = `jest --config jest.server.config.cjs` and `test:server:coverage:update-baseline` = `npm run test:server:coverage && node scripts/check-server-coverage-ratchet.mjs --update-baseline`
- [ ] `pnpm run test:server:coverage` exits 0 and writes `coverage/server/coverage-summary.json`
- [ ] `node scripts/check-server-coverage-ratchet.mjs` exits 0 and prints `Server coverage meets baseline`
- [ ] `.github/workflows/ci.yml` has a `Server module coverage (ratchet)` step that runs `pnpm run test:server:coverage` then `node scripts/check-server-coverage-ratchet.mjs`, positioned after `Mail module tests` and before `Build (renderer)`
- [ ] `pnpm run lint` exits 0 (package.json edits are valid JSON)
- [ ] `git status` shows **no** modified files outside the five in-scope paths, and `coverage/` is not staged
- [ ] `plans/README.md` status row for plan 003 updated (unless a reviewer owns the index)

## STOP conditions

Stop and report back (do not improvise) if:

- The drift check shows `jest.config.cjs`, `package.json`, or `ci.yml` changed
  since `f24fb27` in ways **beyond** plan 002's additions (a `typecheck` script;
  a `Typecheck` CI step), and the "Current state" excerpts no longer match — e.g.
  `jest.config.cjs` no longer combines a `projects` array with root-level coverage
  options, or the mail ratchet exemplar files no longer exist.
- `pnpm run test:server:coverage` **fails a test** (not a coverage issue — an
  actual suite failure). That means the `unit`/`integration` suites are red on
  this tree; report the failing suite rather than working around it (do not edit
  tests or server code to make it pass — out of scope).
- The generated `server-coverage-baseline.json` has every metric `0` or `null`,
  or `coverage-summary.json` has no `total`. That signals the server files were
  not instrumented (e.g. `collectCoverageFrom` glob didn't match, or the config
  didn't load the base projects) — a broken baseline, not genuine zero coverage.
  Do not commit it; report the mis-instrumentation.
- Making the change appears to require editing an out-of-scope file — especially
  `jest.config.cjs` (do NOT add `packages/server/src` to its allowlist),
  `packages/server/src/**`, or any `tests/**` file.
- Any verification command fails twice after a reasonable fix attempt.

## Maintenance notes

For the human/agent who owns this after it lands:

- **Raising the floor**: to ratchet coverage up after adding server tests, run
  `pnpm run test:server:coverage:update-baseline` and commit the updated
  `server-coverage-baseline.json`. The baseline should only ever move **up**; a
  PR that lowers it should be scrutinized (it means coverage regressed and the
  author chose to re-baseline rather than fix it).
- **Reviewer focus**: confirm `jest.config.cjs`'s existing `collectCoverageFrom`
  allowlist and 90% `coverageThreshold` were **not** touched (this plan must not
  weaken the electron/renderer gate); confirm `package.json` is valid JSON; and
  confirm `coverage/server/` was not accidentally committed (only the baseline
  JSON is tracked).
- **CI cost**: the `Server module coverage (ratchet)` step re-runs the full
  `unit` + `integration` Jest suites (the same ones the `Run tests` step runs),
  now with coverage. That roughly doubles the Jest time in the job. It was chosen
  over a hand-enumerated list of server test files because a full run yields the
  true, defensible whole-tree floor and can't silently miss a suite. The
  `build-and-test` job has `timeout-minutes: 20`; if the added step (plus plan
  002's typecheck) pushes CI near that limit, either raise the timeout or, as a
  future optimization, scope the coverage run to a focused `testMatch` of
  `tests/**/server-*.test.ts` + the other server-importing suites — accepting that
  a focused list must be kept in sync as server tests are added.
- **Follow-up deferred (intentional)**: this plan sets a low, honest baseline —
  it does **not** raise server coverage. Writing tests to lift the server tree
  toward the 90% the rest of the repo targets is separate work, unblocked by this
  gate (which now prevents backsliding while that work happens).
- **Note on the mail exemplar**: the mail ratchet script exists but the CI
  `Mail module tests` step runs `test:mail` (`--coverageThreshold={}`) and does
  **not** invoke `check-mail-coverage-ratchet.mjs`, so mail's ratchet is not
  currently CI-enforced. This plan deliberately goes one step further for the
  server edition by invoking the ratchet check directly in the CI step, so the
  server floor is genuinely enforced. If mail is later wired the same way, this
  server step is the pattern to copy.
