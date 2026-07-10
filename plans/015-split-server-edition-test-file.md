# Plan 015: Split the 37k-line server-edition test file into topical files

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in the `README.md` of the directory this plan lives in (`plans/README.md`),
> unless a reviewer dispatched you and told you they maintain the index.
>
> **Drift check (run first)**: `git diff --stat f24fb27..HEAD -- tests/unit/server-edition-foundation.test.ts 'tests/unit/server-edition-foundation-*.test.ts' tests/helpers/server-edition.ts package.json`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P3
- **Effort**: L
- **Risk**: LOW
- **Depends on**: plans/002-*.md
- **Category**: tests
- **Planned at**: commit `f24fb27`, 2026-07-10

## Why this matters

`tests/unit/server-edition-foundation.test.ts` is a single **37,674-line** file
holding **363 tests** under one `describe`, plus ~106 shared helper
declarations. Every run, `ts-jest` transpiles the whole file, and because the
suite is also invoked with `--runInBand` (`test:server-edition`), one worker
executes all 363 tests serially — the file is a wall-clock bottleneck and a
merge-conflict magnet, and it is effectively un-reviewable in a diff. This plan
is a **pure mechanical move**: extract the shared helpers into one importable
module, then partition the 363 tests into topical files that re-import those
helpers. No test body changes, no assertion changes. After it lands the tests
can be edited and (outside `--runInBand`) parallelised per file, and a single
topic is a readable file instead of a 37k-line scroll. Success is defined
narrowly: the **same 363 unit tests still pass**, the combined
`test:server-edition` count is unchanged, and no production code moves.

## Current state

Everything below is the live code at commit `f24fb27`. Confirm it matches
before proceeding (see Drift check).

- `tests/unit/server-edition-foundation.test.ts` — the monolith. Structure:
  - **Lines 1–309**: the import block. All imports are Node builtins
    (`fs`, `crypto`, `net`, `os`, `path`, `stream`), `type { Kysely }` from
    `kysely`, and named imports from `../../packages/{core,server,desktop}/src`
    (and their `cli/*` submodules). There is **no** `import … from 'electron'`
    here. First lines:
    ```ts
    // tests/unit/server-edition-foundation.test.ts:1
    import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
    import { createHash } from 'crypto';
    import net from 'net';
    import { tmpdir } from 'os';
    import { join, resolve } from 'path';
    import { PassThrough } from 'stream';

    import type { Kysely } from 'kysely';

    import {
      SERVER_EDITION_DEPLOY_MODES,
      SERVER_EDITION_TARGETS,
      createCoreRuntime,
      // …
    } from '../../packages/core/src';
    ```
    The last import ends at line 309: `} from '../../packages/server/src';`
  - **Lines 311–351**: four module-level shared constants + one shared type,
    used by both tests and helpers:
    ```ts
    // tests/unit/server-edition-foundation.test.ts:311
    const EXPECTED_SERVER_MIGRATION_IDS = [
      '0001_server_foundation',
      // … 25 ids total …
      '0025_email_message_thread_lookup',
    ];

    const WORKSPACE_A_ID = '11111111-1111-4111-8111-111111111111';
    const USER_A_ID = '22222222-2222-4222-8222-222222222222';
    const WORKSPACE_B_ID = '33333333-3333-4333-8333-333333333333';
    const USER_B_ID = '44444444-4444-4444-8444-444444444444';

    type CapturedAuditEvent = {
      workspaceId: string;
      actorUserId?: string | null;
      action: string;
      entityType?: string | null;
      entityId?: string | null;
      metadata?: Record<string, unknown>;
    };
    ```
  - **Line 353**: the single top-level `describe`, opening the test body:
    ```ts
    // tests/unit/server-edition-foundation.test.ts:353
    describe('server edition foundation', () => {
      test('pins the server-edition baseline to PostgreSQL 18 and Node 22', () => {
    ```
  - **Lines 354–33980**: exactly **363** tests, each written as
    `  test('…', …)` at two-space indent. There are **no** nested `describe`s,
    **no** `beforeAll/beforeEach/afterAll/afterEach`, **no** `it(`, and **no**
    `test.only/test.skip/test.each/test.todo`. Tests are **not** generated in a
    loop — every test is a literal `test(` call, so a static count is exact.
  - **Line 33981**: the `describe` closes: `});`
  - **Lines 33983–37674 (EOF)**: ~106 top-level declarations — the shared
    helpers. Because they are hoisted `function` declarations (and top-level
    `const`/`type`), the tests above can call them even though they are defined
    below. They fall into: ~90 factory/utility functions
    (`makeServerApiPorts`, `makeCustomerRecord`, `makeDealRecord`,
    `makeEmailMessageRecord`, `makeMigrationDatabase`, `makeAuditPortDb`,
    `withRuntimeLeaks`, `sha256Text`, `ilikeMatch`, …), plus a handful of
    helper `type`s (`PostgresEventFakeRow`, `FakePostgresJobQueueRow`,
    `MaintenanceDbCall`, `RlsFakeRow`, …) and one `const` (`JSONB_STRING_COLUMNS`).
    First helper:
    ```ts
    // tests/unit/server-edition-foundation.test.ts:33983
    function makeServerApiPorts(input: {
      activityLog?: ServerApiPorts['activityLog'];
      audit?: ServerApiPorts['audit'];
      auditEvents?: CapturedAuditEvent[];       // ← references the shared type above
      // …
    ```
    Note `makeAuditPortDb` is declared **twice** (an overload signature at
    ~line 35879 followed by the implementation at ~35884) — treat the
    signature + implementation as one unit and move both together.

- **Cross-references that force what moves together** (verified by grep):
  - Helpers reference the shared constants: `WORKSPACE_A_ID` / `USER_A_ID`
    appear inside helper bodies (e.g. lines 34232, 34602, 35367, 37457).
  - `makeServerApiPorts`'s parameter type references `CapturedAuditEvent`
    (line 33986).
  - Tests reference the shared symbols: `EXPECTED_SERVER_MIGRATION_IDS`
    (lines 1435, 1676, 1691, 12848, 12897…), `CapturedAuditEvent`
    (55 occurrences, e.g. `const auditEvents: CapturedAuditEvent[] = []`).
  - **Conclusion**: the 4 constants + `EXPECTED_SERVER_MIGRATION_IDS` +
    `CapturedAuditEvent` + all ~90 functions + helper types must all live in
    the new helpers module together; tests import them from there.

- **How the suite is discovered and run** (`jest.config.cjs`):
  - The `unit` project (jsdom, `preset: ts-jest`) uses
    `testMatch: ['<rootDir>/tests/unit/**/*.test.(ts|tsx)']`
    (`jest.config.cjs:87`). **Any** new `tests/unit/**/*.test.ts` file is
    auto-discovered — no config change needed to add topical files.
  - Its `roots` include `<rootDir>/tests` (`jest.config.cjs:78`), so a new
    `tests/helpers/` directory is on the module path. A `.ts` file **without**
    `.test.` in its name is **not** collected as a test (it won't fail with
    "no tests"), which is exactly what the helpers module needs.
  - `ts-jest` runs with `isolatedModules` set in `tsconfig.json`
    (`tsconfig.json:13`) — each file is transpiled independently and is **not**
    type-checked as a program. A missing/renamed import therefore surfaces as a
    runtime module-resolution error when the file loads (the suite fails
    loudly), not as a silent pass.
  - `package.json` script (`package.json:59`), the `--runInBand` entry the
    finding calls out:
    ```json
    "test:server-edition": "jest --runTestsByPath tests/unit/server-edition-foundation.test.ts tests/integration/server-edition-foundation.test.ts --runInBand",
    ```
    This lists the file by **exact path** via `--runTestsByPath`, so it must be
    updated when the file is split.

- **A guard test you must NOT break** (out of scope, but it asserts on the
  script you will edit): `tests/integration/server-edition-foundation.test.ts:351`
  ```ts
  expect(packageJson.scripts['test:server-edition']).toContain('server-edition-foundation.test.ts');
  ```
  The integration path `tests/integration/server-edition-foundation.test.ts`
  ends with the literal substring `server-edition-foundation.test.ts`, so as
  long as you keep that path in the script, this assertion still passes.

- **Lint is a no-op ruleset**: `eslint.config.mjs` is a minimal stub that
  registers the `@typescript-eslint` plugin but **enables no rules**
  (`eslint.config.mjs:3-8`). And `tsconfig.json` sets **neither**
  `noUnusedLocals` **nor** `verbatimModuleSyntax`. Consequence: importing more
  symbols than a given file uses is harmless — no lint warning, no type error,
  no runtime effect. This is what makes the mechanical recipe below safe.

- **Path-depth is identical everywhere** (this is the key simplifier):
  `tests/unit/` and `tests/helpers/` are both exactly two levels under the repo
  root, so `'../../packages/…'` resolves the same from all three of the old
  file, the new helpers module, and the new flat topical files in
  `tests/unit/`. **No import path needs to be re-computed** except the one new
  `'../helpers/server-edition'` import.

- **Convention to match**: sibling unit tests live flat in `tests/unit/` (e.g.
  `tests/unit/email-compose-send.test.ts`, `tests/unit/auth-password-hash.test.ts`).
  Keep the split files flat and same-depth (see Scope) — do **not** introduce a
  subdirectory, so the `'../../packages/…'` paths stay valid unchanged.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Install | `pnpm install --frozen-lockfile` | exit 0 |
| Baseline / count unit tests (old file) | `grep -cE '^  test\(' tests/unit/server-edition-foundation.test.ts` | prints `363` |
| Count unit tests across split files | `grep -rhE '^[[:space:]]*test\(' tests/unit/server-edition-foundation-*.test.ts \| wc -l` | prints `363` |
| Run only the split unit files (fast, jsdom only) | `npx jest --selectProjects unit --runInBand tests/unit/server-edition-foundation` | all pass, `Tests: 363 passed` |
| Run the full server-edition suite (unit + integration) | `pnpm run test:server-edition` | all pass, `Tests: 378 passed` |
| Lint | `pnpm run lint` | exit 0 |
| Build | `pnpm run build` | exit 0 |

Notes:
- There is **no `typecheck` script yet at `f24fb27`** (plan 002 adds one). Even
  after plan 002, `pnpm run typecheck` compiles `tsconfig.json` /
  `tsconfig.electron.json` / the `packages` project, and **none of those
  `include` the `tests/` tree** (`tsconfig.json:22` include list is
  `src/**`, `shared/**`, `vite.config.ts`, `tailwind.config.ts`). So typecheck
  does **not** cover the files you touch here — the **jest run is the
  authoritative gate**. Do not add a typecheck step for these files.
- `378 = 363` (unit) `+ 15` (the unchanged
  `tests/integration/server-edition-foundation.test.ts`, which has 15 tests).
- `pnpm run test:server-edition` runs the `integration` project too (node env).
  If it fails with `Electron failed to install correctly` (the integration
  suite does `import … from 'electron'`), reproduce CI's shim once, then re-run:
  ```bash
  node node_modules/electron/install.js || true
  [ -s node_modules/electron/path.txt ] || printf 'electron' > node_modules/electron/path.txt
  ```
  (Verbatim from `.github/workflows/ci.yml:52-55`.) The `unit`-only command
  above never needs this — the unit file has no `electron` import.

## Scope

**In scope** (the only files you may create, modify, or delete):
- `tests/unit/server-edition-foundation.test.ts` — delete at the end, once
  emptied.
- `tests/unit/server-edition-foundation-*.test.ts` — **create** (the topical
  split files, e.g. `-migrations.test.ts`, `-auth.test.ts`, …).
- `tests/helpers/server-edition.ts` — **create** (the extracted helpers +
  shared constants + shared types).
- `package.json` — update **only** the `test:server-edition` script value.

**Out of scope** (do NOT touch):
- Any file under `packages/`, `src/`, `shared/`, `electron/` — this is a
  test-only move; production code must not change.
- `tests/integration/server-edition-foundation.test.ts` — a separate suite.
  Do not edit it, but keep its assertion at line 351 green (see Step 6).
- `jest.config.cjs` — no change needed; `testMatch` already globs
  `tests/unit/**/*.test.ts`.
- Any test **body**, assertion, or the semantic content of a helper. This is a
  cut-and-paste move; do not "improve", rename, dedupe, or re-order code while
  moving it.

## Git workflow

- Branch: `advisor/015-split-server-edition-test-file`
- Commit per logical unit; conventional-commit style (example from `git log`:
  `fix(review): keep raw-headers / .eml export out of the mail read bucket`).
  Suggested messages:
  - `test(server-edition): extract shared helpers to tests/helpers/server-edition.ts`
  - `test(server-edition): partition foundation suite into topical files`
  - `chore(scripts): point test:server-edition at the split files`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

Work in two phases: **(A)** extract the helpers while leaving the original file
runnable, so the codebase is never broken; **(B)** partition the tests, moving
one topical chunk at a time and re-checking the count.

### Step 1: Install and capture the baseline

```bash
pnpm install --frozen-lockfile
grep -cE '^  test\(' tests/unit/server-edition-foundation.test.ts   # must print 363
npx jest --selectProjects unit --runInBand tests/unit/server-edition-foundation
```

Record the final summary line of the jest run (expected `Tests: 363 passed`).
That number is the invariant every later step must preserve.

**Verify**: the grep prints `363` and jest reports `Tests: 363 passed`.

> If jest errors with `Preset ts-jest not found`, `pnpm install` did not
> complete — re-run Step 1's install.

### Step 2: Create the helpers module (extract, then re-point the original file)

Create `tests/helpers/server-edition.ts` as a self-contained module:

1. Copy **lines 1–309** (the entire import block) of
   `tests/unit/server-edition-foundation.test.ts` **verbatim** to the top of
   the new file. Paths are unchanged — `tests/helpers/` is the same depth as
   `tests/unit/`, so `'../../packages/…'` still resolves.
2. Copy **lines 311–351** (the 5 shared constants/`EXPECTED_SERVER_MIGRATION_IDS`
   + the `CapturedAuditEvent` type) into the module, and add `export` in front
   of each declaration:
   `export const EXPECTED_SERVER_MIGRATION_IDS = …`,
   `export const WORKSPACE_A_ID = …` (and `USER_A_ID`, `WORKSPACE_B_ID`,
   `USER_B_ID`), `export type CapturedAuditEvent = { … }`.
3. Copy **lines 33983–37674** (everything after the `describe` — all ~106
   helper declarations) into the module, and add `export` in front of each
   **top-level** declaration (`export function make…`, `export const
   JSONB_STRING_COLUMNS = …`, `export type PostgresEventFakeRow = …`, etc.).
   For `makeAuditPortDb`, prefix **both** the overload signature and the
   implementation with `export`.

Then edit `tests/unit/server-edition-foundation.test.ts` so it consumes the
module instead of declaring the helpers locally:
- **Delete** its lines 311–351 (the moved constants/type) and its lines
  33983–37674 (the moved helpers). Keep lines 1–309 (imports) and the
  `describe(…)` block (353–33981) exactly as-is.
- Immediately after the import block (after old line 309), insert one import
  that pulls every moved symbol back in. Derive the exact list from the new
  module so you can't miss one:
  ```bash
  grep -oE '^export (async function|function|const) [A-Za-z0-9_]+' tests/helpers/server-edition.ts \
    | awk '{print $NF}' | sort -u          # value exports (functions + consts)
  grep -oE '^export (type|interface) [A-Za-z0-9_]+' tests/helpers/server-edition.ts \
    | awk '{print $NF}' | sort -u          # type exports
  ```
  Build a single import statement: value names plain, type names with an inline
  `type` modifier (the file already uses this style, e.g.
  `type EmbeddedPostgresEngineInput` at old line 48). isolatedModules requires
  type-only names to carry the `type` keyword:
  ```ts
  import {
    makeServerApiPorts, makeCustomerRecord, /* …all value exports… */
    EXPECTED_SERVER_MIGRATION_IDS, WORKSPACE_A_ID, USER_A_ID, WORKSPACE_B_ID, USER_B_ID,
    type CapturedAuditEvent, type PostgresEventFakeRow, /* …all type exports… */
  } from '../helpers/server-edition';
  ```

At this point the original file still has all 363 tests but now imports its
helpers. Nothing else changed.

**Verify**:
```bash
grep -cE '^  test\(' tests/unit/server-edition-foundation.test.ts        # still 363
npx jest --selectProjects unit --runInBand tests/unit/server-edition-foundation
```
Expected: `363`, and `Tests: 363 passed`. If a test fails with
`ReferenceError: <name> is not defined`, that symbol was not exported/imported —
fix the export or the import list and re-run. **Commit** when green.

### Step 3: Decide the topical partition (contiguous ranges only)

You will cut the 363 tests, **in file order**, into topical files. Cut only on
`test(` boundaries and never split a single `test(` block. Because the partition
is contiguous and non-overlapping, every test lands in exactly one file — that
is what guarantees the count is preserved.

The tests already appear grouped by topic in file order. Use these **real
anchors** (sampled `line: 'title'` at `f24fb27`) to choose ~10–14 topic files;
you MAY adjust the exact boundaries to the nearest natural `test(` break:

| ~Line | Sample test title | Suggested file |
|-------|-------------------|----------------|
| 354   | `pins the server-edition baseline to PostgreSQL 18 and Node 22` | `…-foundation-and-boundaries.test.ts` |
| 1317  | `workspace session command validates UUID context for RLS transactions` | `…-rls-and-sessions.test.ts` |
| 1778  | `postgres job queue uses cross-workspace RLS context …` | `…-job-queue.test.ts` |
| 3778  | `postgres AI agent port uses knowledge context and resumes workflows` | `…-ai-and-workflow-ports.test.ts` |
| 6119  | `postgres workflow execution job port assigns email category paths` | `…-ai-and-workflow-ports.test.ts` |
| 8102  | `MSSQL workflow query validation only accepts bounded read-only statements` | `…-mssql.test.ts` |
| 11302 | `maintenance job plans validate workspace payloads …` | `…-maintenance.test.ts` |
| 12188 | `sqlite database source reads counts …` | `…-sqlite-import.test.ts` |
| 12991 | `doctor CLI exits non-zero when a health check fails` | `…-doctor-and-rls-check.test.ts` |
| 13927 | `postgres auth port serializes live invitation creation …` | `…-auth.test.ts` |
| 15265 | `server core CRM read routes pass validated product …` | `…-core-crm-routes.test.ts` |
| 17988 | `server mail read routes expose secret-safe accounts …` | `…-mail-routes.test.ts` |
| 20983 | `server compose sender uses outbox claim …` | `…-compose-send.test.ts` |
| 23142 | `server mail spam-decision route rejects unsafe payloads …` | `…-mail-spam.test.ts` |
| 26338 | `server email internal note mutation routes write audit records …` | `…-mail-mutation-routes.test.ts` |
| 28820 | `server workflow execute routes enqueue workspace-scoped …` | `…-workflow-routes.test.ts` |
| 31286 | `server PGP identity mutation routes reject unsafe payloads …` | `…-pgp.test.ts` |
| 33854 | `postgres event notification channel listens …` | `…-events-notifications.test.ts` |

The exact number of files and the exact boundaries are a judgment call and do
**not** affect correctness — the count check in Step 5 is the gate. Prefer 10–14
files of a few thousand lines each. All files use the prefix
`tests/unit/server-edition-foundation-` so one path pattern matches them all.

No verification for this planning-only step.

### Step 4: Emit the topical files

For **each** topical file `tests/unit/server-edition-foundation-<topic>.test.ts`:

1. Copy **lines 1–309** (the import block) of the original file **verbatim** as
   the file header. (Same depth → paths unchanged. Yes, this duplicates imports
   across files; that is intentional and safe — see "Lint is a no-op" and "no
   `noUnusedLocals`" in Current state. Do not hand-trim imports; it adds risk
   for no functional gain.)
2. Add the **same** helper import line you built in Step 2:
   `import { … } from '../helpers/server-edition';`
3. Wrap this file's contiguous slice of `test(` blocks in one `describe`:
   ```ts
   describe('server edition foundation — <topic>', () => {
     // …the moved test( blocks, verbatim, at two-space indent…
   });
   ```
   Move the `test(` blocks by **cut** (remove them from the original file as you
   place them), so no test is ever duplicated. Keep each `test(` body byte-for-
   byte identical — only the enclosing `describe` label differs from the
   original, which is cosmetic.

Do them **one topical file at a time**, and after each extraction run the fast
unit command to confirm the still-shrinking original file + the growing set of
new files together still total 363 and stay green:

```bash
npx jest --selectProjects unit --runInBand tests/unit/server-edition-foundation
```

Expected after every chunk: `Tests: 363 passed` (the pattern
`tests/unit/server-edition-foundation` matches the original file **and** all
new topical files while the split is in progress).

**Verify** (per chunk): `Tests: 363 passed`, no failures.

### Step 5: Remove the emptied original file and confirm the count

When the last chunk has been moved, the original
`tests/unit/server-edition-foundation.test.ts` no longer contains any `test(`
blocks. **Delete the whole file** (`git rm tests/unit/server-edition-foundation.test.ts`)
— do not leave an empty `describe` behind.

**Verify**:
```bash
test ! -e tests/unit/server-edition-foundation.test.ts && echo "old file gone"
grep -rhE '^[[:space:]]*test\(' tests/unit/server-edition-foundation-*.test.ts | wc -l   # must print 363
npx jest --selectProjects unit --runInBand tests/unit/server-edition-foundation
```
Expected: `old file gone`, `363`, and `Tests: 363 passed`. **Commit.**

### Step 6: Update the `test:server-edition` script

The script (`package.json:59`) still names the deleted file by exact path via
`--runTestsByPath`. Replace it so it runs all split unit files **and** the
unchanged integration file, in-band, using jest's positional path patterns
(drop `--runTestsByPath`, which requires literal paths):

```json
"test:server-edition": "jest --runInBand tests/unit/server-edition-foundation tests/integration/server-edition-foundation.test.ts",
```

Why this exact form:
- `tests/unit/server-edition-foundation` is a path pattern that matches every
  `tests/unit/server-edition-foundation-<topic>.test.ts` file (run in the
  `unit` project).
- `tests/integration/server-edition-foundation.test.ts` keeps the integration
  suite (run in the `integration` project) — and its literal presence keeps the
  guard assertion at
  `tests/integration/server-edition-foundation.test.ts:351`
  (`…toContain('server-edition-foundation.test.ts')`) green.
- `--runInBand` is preserved.

**Verify**:
```bash
pnpm run test:server-edition
```
Expected: all pass, `Tests: 378 passed` (`363` unit + `15` integration). If it
fails with `Electron failed to install correctly`, apply the electron shim from
"Commands you will need" and re-run.

### Step 7: Full gate

```bash
pnpm run lint            # exit 0
pnpm run build           # exit 0
git status --porcelain   # only in-scope paths changed
```

**Verify**: lint exit 0, build exit 0, and `git status` shows only: the deleted
`tests/unit/server-edition-foundation.test.ts`, the new
`tests/unit/server-edition-foundation-*.test.ts` files, the new
`tests/helpers/server-edition.ts`, and `package.json`.

## Test plan

- **No new test cases** are written — this plan moves existing tests only. The
  "tests" being verified are the 363 relocated ones plus the 15 unchanged
  integration ones.
- **Structural pattern to match** for a topical file: an existing flat unit
  test such as `tests/unit/email-compose-send.test.ts` — top-of-file imports,
  then a single top-level `describe`, then `test(` blocks. Your topical files
  follow the same shape, additionally importing from
  `../helpers/server-edition`.
- **Invariant checks** (the real gate):
  - `grep -rhE '^[[:space:]]*test\(' tests/unit/server-edition-foundation-*.test.ts | wc -l` → `363`.
  - `npx jest --selectProjects unit --runInBand tests/unit/server-edition-foundation` → `Tests: 363 passed`.
  - `pnpm run test:server-edition` → `Tests: 378 passed`.
- **Golden comparison** (optional but recommended): before Step 2, save the
  sorted list of full test names; after Step 6, regenerate and diff — they must
  be identical except for the `describe` prefix. Capture names with:
  `npx jest --selectProjects unit --runInBand tests/unit/server-edition-foundation --listTests`
  lists files, not names; for names, run with `--verbose` and extract the
  `✓`/`✗` lines, or simply rely on the count invariants above (sufficient given
  the contiguous-cut method guarantees no add/drop/dup).

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `tests/unit/server-edition-foundation.test.ts` no longer exists
      (`test ! -e tests/unit/server-edition-foundation.test.ts`).
- [ ] `tests/helpers/server-edition.ts` exists and every moved helper/constant/
      type is `export`ed.
- [ ] `grep -rhE '^[[:space:]]*test\(' tests/unit/server-edition-foundation-*.test.ts | wc -l` prints `363`.
- [ ] `npx jest --selectProjects unit --runInBand tests/unit/server-edition-foundation` → `Tests: 363 passed`, 0 failed.
- [ ] `pnpm run test:server-edition` → `Tests: 378 passed`, 0 failed (integration
      guard at `tests/integration/server-edition-foundation.test.ts:351` passes).
- [ ] `pnpm run lint` exits 0.
- [ ] `pnpm run build` exits 0.
- [ ] `git status` shows changes only in the in-scope paths (no file under
      `packages/`, `src/`, `shared/`, `electron/`, and not `jest.config.cjs`).
- [ ] `plans/README.md` status row for plan 015 updated.

## STOP conditions

Stop and report back (do not improvise) if:

- The Drift check shows `tests/unit/server-edition-foundation.test.ts`,
  `package.json`, or the integration file changed since `f24fb27`, and the
  "Current state" excerpts (line 353 `describe`, line 33981 `});`, the import
  block ending at 309, the `package.json:59` script, the integration
  assertion at line 351) no longer match — the file has drifted.
- The baseline count in Step 1 is **not** 363, or the baseline run does not
  report `Tests: 363 passed` — the invariant this plan preserves is already
  different from what the plan assumes.
- After a topical extraction, the count is not 363 or a test fails with
  something other than a `ReferenceError`/module-resolution error you can fix by
  correcting an export or import (e.g. a real assertion failure appears) — a
  pure move must not change any assertion outcome.
- Making a test pass appears to require editing a file under `packages/`,
  `src/`, `shared/`, or `electron/`, or editing a `test(` body / helper body —
  a pure move should never need this.
- You discover a test is generated dynamically (a `test(` inside a loop /
  `forEach` / `test.each`) after all, so the static `^  test\(` count is not the
  true test count — re-plan the partition.

## Maintenance notes

For the human/agent who owns this area after the change:

- **What a reviewer should scrutinize**: (1) the count invariant — 363 unit +
  15 integration = 378; (2) that no `packages/`/`src/`/`shared/`/`electron/`
  file appears in the diff; (3) that `test(` bodies are byte-identical to
  `f24fb27` (only the enclosing `describe` label changed); (4) that
  `package.json`'s `test:server-edition` still contains the literal
  `server-edition-foundation.test.ts` (keeps the integration guard green).
- **Duplicated import headers are deliberate.** Each topical file copies the
  full import block; unused imports are inert because eslint enables no rules
  and `tsconfig` sets no `noUnusedLocals`. If a future change turns on
  `noUnusedLocals` or a real eslint ruleset (e.g. via plan 002's follow-ups),
  the topical files will report unused-import errors and their headers should be
  trimmed to what each file actually uses at that time — a separate, safe pass.
- **Adding new server-edition tests going forward**: put them in the matching
  topical file (or add a new `server-edition-foundation-<topic>.test.ts`), and
  add shared helpers to `tests/helpers/server-edition.ts` with `export`. The
  `test:server-edition` pattern `tests/unit/server-edition-foundation`
  auto-includes any new topical file.
- **Deferred out of this plan (intentionally)**: parallelising the suite by
  removing `--runInBand`; deduping the copied import headers; and applying the
  same split to the separate 3,014-line
  `tests/integration/server-edition-foundation.test.ts`. Each is a follow-up
  and should not be bundled here.
