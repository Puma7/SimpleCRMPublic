# Plan 002: Make the CI test gate fail on empty discovery and add a fast typecheck script

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in the `README.md` of the directory this plan lives in (`plans/README.md`),
> unless a reviewer dispatched you and told you they maintain the index.
>
> **Drift check (run first)**: `git diff --stat f24fb27..HEAD -- package.json .github/workflows/ci.yml`
> If either in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: dx
- **Planned at**: commit `f24fb27`, 2026-07-10

## Why this matters

The primary CI test gate is the root `test` script `jest --passWithNoTests`
(package.json:49), invoked by the workflow step "Run tests" (`pnpm test`,
.github/workflows/ci.yml:63-64). Because of `--passWithNoTests`, if jest's
discovery config ever breaks — a bad `testMatch`, wrong `roots`, a moved
`tests/` dir — jest runs **0** of the ~212 discovered test suites and still
**exits 0**, so CI goes green while nothing was actually tested. Removing that
flag turns a silent no-op into a hard failure.

Separately, there is **no `typecheck` script** (package.json:14-61); the only
place types get checked today is inside the multi-minute `build` (which also
runs vite and emits electron output). There is no fast, side-effect-free way
for CI or a developer to ask "does this tree type-check?" This plan adds one
`typecheck` script that reuses the existing tsconfig projects, and wires a
dedicated CI step so type errors fail fast and independently of the build.

## Current state

Relevant files (only these two are modified by this plan):

- `package.json` — root workspace manifest; holds the `scripts` block that CI
  drives. The test gate and (missing) typecheck live here.
- `.github/workflows/ci.yml` — the `build-and-test` job; the step sequence that
  runs on every push/PR to `main`.

Supporting config that this plan **reads but does not modify** (so you can trust
the commands below): `tsconfig.json`, `tsconfig.electron.json`,
`packages/{core,server,desktop}/tsconfig.json`, `jest.config.cjs`.

### The test gate (package.json)

```
49    "test": "jest --passWithNoTests",
50    "test:unit": "jest --selectProjects unit",
51    "test:integration": "jest --selectProjects integration",
...
60    "test:electron": "jest --testMatch='**/__tests__/electron/**/*.test.ts'",
61    "test:frontend": "jest --testMatch='**/__tests__/frontend/**/*.test.tsx'"
```

`--passWithNoTests` appears **exactly once** in the whole repo — on line 49
only (verified: `grep -c passWithNoTests package.json` → `1`). No other script
carries it.

### What jest discovers (jest.config.cjs)

The root `jest` run uses two projects; their discovery globs are:

```
73    projects: [
74      { displayName: 'unit', ...
87        testMatch: ['<rootDir>/tests/unit/**/*.test.(ts|tsx)'],
...
98      { displayName: 'integration', ...
110       testMatch: ['<rootDir>/tests/integration/**/*.test.ts'],
```

At `f24fb27` these match real files — `tests/unit/` has **191** `*.test.ts(x)`
files and `tests/integration/` has **21** `*.test.ts` files (verified with
`find`). So the gate legitimately runs ~212 suites today; removing
`--passWithNoTests` must NOT break that.

### The build scripts (package.json) — source of the typecheck command

```
16    "build:packages": "tsc -b packages/core packages/server packages/desktop",
17    "build:web": "tsc && vite build",
18    "build:electron:main": "tsc -p tsconfig.electron.json",
19    "build": "npm run build:packages && npm run build:web && npm run build:electron:main",
...
27    "lint": "eslint . --ext ts,tsx --max-warnings 0",
```

Notes that make the typecheck command correct:
- `build:web`'s bare `tsc` uses **`tsconfig.json`**, whose `compilerOptions`
  already set `"noEmit": true` (tsconfig.json:8) — that is the renderer/`src`
  type-check, proven to pass as part of `build`.
- `build:electron:main` uses **`tsconfig.electron.json`**, which has
  `"outDir": "./dist-electron"` and **no** `noEmit` (tsconfig.electron.json:6),
  so bare it *emits*. Adding `--noEmit` makes it type-check only.
- `build:packages` is exactly `tsc -b packages/core packages/server packages/desktop`.
  Each package tsconfig sets `"composite": true` + `"declaration": true` +
  `"outDir": "dist"` (e.g. packages/core/tsconfig.json), so `tsc -b` is the
  correct project-reference build/type-check for them.

So the three project paths in the target `typecheck` command are the same ones
the build already uses. `tsconfig.tsbuildinfo` and all `dist/` dirs are
`.gitignore`d (not tracked), so on a fresh CI checkout `tsc -b` does a full
(non-incremental) type-check.

### The CI step sequence (.github/workflows/ci.yml)

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

CI runs on `ubuntu-latest`, Node 24, pnpm 9, after
`pnpm install --frozen-lockfile`. Every command is invoked via **pnpm**.

## Commands you will need

| Purpose   | Command                                   | Expected on success            |
|-----------|-------------------------------------------|--------------------------------|
| Install   | `pnpm install --frozen-lockfile`          | exit 0                         |
| Typecheck | `pnpm run typecheck` (this plan adds it)  | exit 0, no type errors         |
| Tests     | `pnpm test` (targeted: `pnpm test -- <path>`) | all suites pass, >0 tests run |
| Lint      | `pnpm run lint`                           | exit 0 (eslint, --max-warnings 0) |
| Build     | `pnpm run build`                          | exit 0                         |

Package manager is **pnpm** (see ci.yml). Do not substitute npm/yarn at the
top level. (Some scripts call `npm run …` internally — leave those as-is.)

## Scope

**In scope** (the only files you may modify):
- `package.json` — remove `--passWithNoTests` from the root `test` script; add a
  new `typecheck` script. Touch **no other script line**.
- `.github/workflows/ci.yml` — add one `Typecheck` step before the build step.

**Out of scope** (do NOT touch, even though they look related):
- `jest.config.cjs` — the discovery config is exactly what we're protecting;
  changing it defeats the purpose and risks dropping suites.
- `tsconfig.json`, `tsconfig.electron.json`, `packages/*/tsconfig.json` — the
  `typecheck` script reuses them unchanged. Do not edit them.
- `test:electron` / `test:frontend` (package.json:60-61) and any other `test:*`
  script — do NOT add `--passWithNoTests` to them and do NOT run them here.
  They currently match no files and are not part of the CI gate; that is a
  separate concern noted under Maintenance.
- The `server-compose-smoke` job in ci.yml — unrelated.

## Git workflow

- Branch: `advisor/002-ci-test-gate-and-typecheck`
- Commit style: Conventional Commits (repo convention — e.g. from `git log`:
  `fix(review): keep raw-headers / .eml export out of the mail read bucket`).
  Suggested messages:
  - `ci: fail the test gate on empty jest discovery (drop --passWithNoTests)`
  - `chore: add typecheck script and CI typecheck step`

  One commit per step or a single squashed commit is both fine.
- Do NOT push or open a PR unless the operator explicitly instructs it.

## Steps

### Step 1: Remove `--passWithNoTests` from the root `test` script

In `package.json`, change line 49 from:

```
    "test": "jest --passWithNoTests",
```

to:

```
    "test": "jest",
```

Change **only** this one line. Do not touch `test:unit`, `test:integration`,
`test:electron`, `test:frontend`, or any other script.

**Verify**:
- `grep -c passWithNoTests package.json` → `0`
- `pnpm test` → exit 0, and the jest summary reports **Tests: … passed** with a
  non-zero total (i.e. the ~212 suites ran, not "0 total"). If the summary says
  `0 total` or the command exits non-zero, STOP (see STOP conditions).
- Prove the gate now fails on empty discovery:
  `pnpm test -- --testPathPatterns zzz_nonexistent_pattern` → exits **non-zero**
  with jest reporting no tests found. (Before this change it would have exited
  0.) This is a throwaway check; it modifies nothing.

### Step 2: Add the `typecheck` script

In `package.json`, add a new script line immediately after the `lint` line
(line 27), so the scripts block reads:

```
    "lint": "eslint . --ext ts,tsx --max-warnings 0",
    "typecheck": "tsc -p tsconfig.json --noEmit && tsc -p tsconfig.electron.json --noEmit && tsc -b packages/core packages/server packages/desktop",
```

Keep valid JSON: the `lint` line already ends with a comma, and your new
`typecheck` line must also end with a comma (the line after it is another
script).

Rationale for each segment (do not deviate):
- `tsc -p tsconfig.json --noEmit` — type-checks `src/**` + `shared/**` (renderer);
  `tsconfig.json` already sets `noEmit`, `--noEmit` is explicit/harmless.
- `tsc -p tsconfig.electron.json --noEmit` — type-checks the Electron main
  process; `--noEmit` prevents writing to `dist-electron/`.
- `tsc -b packages/core packages/server packages/desktop` — project-reference
  build/type-check of the three workspace packages (same as `build:packages`).

**Verify**:
- `pnpm run typecheck` → **exit 0**, no type errors printed.
- Incremental caveat (local trees only): `tsc -b` is incremental. If a prior
  build left `packages/*/dist` and `*.tsbuildinfo` in your working tree, the
  packages segment may print "up to date" and skip. To force a real re-check
  locally, run:
  `rm -f tsconfig.tsbuildinfo packages/core/tsconfig.tsbuildinfo packages/server/tsconfig.tsbuildinfo packages/desktop/tsconfig.tsbuildinfo && pnpm run typecheck`
  → still exit 0. (CI's fresh checkout has none of these, so CI always does a
  full check.) These files are `.gitignore`d — deleting them changes no tracked
  file.

### Step 3: Add a `Typecheck` step to CI before the build

In `.github/workflows/ci.yml`, insert a new step between the existing
`Mail module tests` step and the `Build (renderer)` step, so lines 66-70
become:

```
      - name: Mail module tests
        run: pnpm run test:mail

      - name: Typecheck
        run: pnpm run typecheck

      - name: Build (renderer)
        run: pnpm run build
```

Match the existing 6-space indentation for `- name:` and 8-space for `run:`.
Do not reorder or edit any other step. Do not touch the `server-compose-smoke`
job.

**Verify**:
- The step exists and is ordered before build:
  `grep -n "name: Typecheck\|name: Build (renderer)" .github/workflows/ci.yml`
  → prints two lines, and the `Typecheck` line number is **less than** the
  `Build (renderer)` line number.
- YAML still parses:
  `python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/ci.yml')); print('yaml ok')"`
  → prints `yaml ok`, exit 0. (If `python3`/`pyyaml` is unavailable, skip this
  sub-check; the grep + a visual read of the indentation is sufficient.)

## Test plan

This plan changes build/CI plumbing, not application code, so no new jest
suites are added. Verification is behavioral, on the scripts themselves:

- **Discovery still works**: `pnpm test` runs the ~212 unit+integration suites
  and exits 0 (Step 1). This guards against the removal accidentally coinciding
  with a broken config.
- **Empty-discovery now fails**: `pnpm test -- --testPathPatterns zzz_nonexistent_pattern`
  exits non-zero (Step 1) — the regression this plan exists to prevent.
- **Typecheck is green on the current tree**: `pnpm run typecheck` exits 0
  (Step 2), including after clearing `*.tsbuildinfo`.
- **Full gate dry-run** (recommended before finishing): run the CI command
  sequence locally in order — `pnpm run lint`, `pnpm test`, `pnpm run test:mail`,
  `pnpm run typecheck`, `pnpm run build` — each exits 0.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `grep -c passWithNoTests package.json` → `0`
- [ ] `pnpm test` exits 0 and its summary shows a non-zero test total (suites ran)
- [ ] `pnpm test -- --testPathPatterns zzz_nonexistent_pattern` exits non-zero
- [ ] `package.json` contains a `"typecheck"` script equal to
      `tsc -p tsconfig.json --noEmit && tsc -p tsconfig.electron.json --noEmit && tsc -b packages/core packages/server packages/desktop`
- [ ] `pnpm run typecheck` exits 0
- [ ] `.github/workflows/ci.yml` has a `Typecheck` step running `pnpm run typecheck`,
      positioned before the `Build (renderer)` step
- [ ] `pnpm run lint` still exits 0 (package.json edits are valid JSON / no eslint impact)
- [ ] Only `package.json` and `.github/workflows/ci.yml` are modified (`git status`
      shows no other changed tracked files; deleted `*.tsbuildinfo` are ignored)
- [ ] `plans/README.md` status row for plan 002 updated (unless a reviewer owns the index)

## STOP conditions

Stop and report back (do not improvise) if:

- The drift check shows `package.json` or `.github/workflows/ci.yml` changed
  since `f24fb27` and the "Current state" excerpts no longer match the live
  code (e.g. the root `test` script no longer reads `jest --passWithNoTests`, or
  a `typecheck` script already exists).
- After removing `--passWithNoTests`, `pnpm test` reports `0 total` tests or
  fails — that means jest discovery is *already* broken on this tree; the fix
  would correctly turn it red, but you must report the underlying discovery
  breakage rather than re-adding the flag to mask it.
- `pnpm run typecheck` reports type errors on the unmodified tree. Do not fix
  application types here (out of scope) — report the errors and stop; they are
  a pre-existing condition this plan surfaces, to be handled separately.
- Making either change appears to require editing an out-of-scope file
  (`jest.config.cjs`, any `tsconfig*.json`, other `test:*` scripts).
- Any verification command fails twice after a reasonable fix attempt.

## Maintenance notes

For the human/agent who owns this after it lands:

- **Reviewer focus**: confirm `package.json` is still valid JSON (the new
  `typecheck` line's trailing comma), and that `--passWithNoTests` was removed
  from the root `test` script *only* — not added or removed elsewhere. Confirm
  the CI `Typecheck` step sits before `Build (renderer)`.
- **Deferred, intentionally out of scope**: `test:electron` (package.json:60)
  and `test:frontend` (package.json:61) use `--testMatch='**/__tests__/…'`
  globs that match **no files** at `f24fb27` (there is no `__tests__/electron`
  or `__tests__/frontend` directory). They lack `--passWithNoTests`, so they
  already fail if invoked, but they are not part of the CI gate and are not run
  anywhere. If they are ever wired into CI, decide deliberately whether they
  should legitimately be allowed to match nothing (add `--passWithNoTests` only
  then) or be pointed at real paths.
- **`tsc -b` is incremental**: the packages segment of `typecheck` short-circuits
  when `packages/*/tsconfig.tsbuildinfo` is fresh. CI is always a clean checkout
  so it re-checks fully; local runs may need the `rm -f …tsbuildinfo` shown in
  Step 2 to force a real check.
- **If package structure changes** (a package is added/removed/renamed under
  `packages/`), update both `build:packages` and the `typecheck` script's
  `tsc -b …` list so they stay in sync — they intentionally reference the same
  project paths.
- **Speeding up CI later**: the `Typecheck` step re-checks types that the
  subsequent `Build (renderer)` step also checks. That redundancy is deliberate
  (fail fast, independent signal). If build time becomes a concern, that overlap
  is the first thing to revisit.
