# Plan 016: De-risk the better-sqlite3 GitHub pin and make its patch fail loudly

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in the `README.md` of the directory this plan lives in (`plans/README.md`)
> — unless a reviewer dispatched you and told you they maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat f24fb27..HEAD -- scripts/patch-better-sqlite3.js tests/integration/patch-better-sqlite3.test.ts package.json`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition. (`tests/integration/patch-better-sqlite3.test.ts`
> does not exist yet at `f24fb27`; you create it. `package.json` is listed
> because its `postinstall` chain and pin are quoted below — you should NOT
> need to edit it; see Scope.)

## Status

- **Priority**: P3
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: migration
- **Planned at**: commit `f24fb27`, 2026-07-10

## Why this matters

The app depends on SQLite for the entire desktop (Electron) edition — every
mail, auth, and CRM table lives in a `better-sqlite3` database. That dependency
is pinned to a **GitHub source tarball**, not a registry release:
`"better-sqlite3": "github:WiseLibs/better-sqlite3#v12.7.1"` (`package.json:106`).
A `postinstall` hook (`package.json:34`) then runs `scripts/patch-better-sqlite3.js`,
which rewrites the native C++ (`src/objects/database.cpp` and `statement.cpp`)
from V8's removed `info.Holder()` to `info.HolderV2()` so the module compiles
against Electron 41's V8.

The problem is the patch **fails silently**. If it cannot find the package
directory it prints a warning and `process.exit(0)`; if a target file is absent
it prints a warning and `continue`s; and it never checks that any replacement
was actually made. Any of these paths leaves the native source unpatched but
lets `postinstall` report success, so `electron-rebuild` then either fails
obscurely or — worse — ships a broken/mismatched native module that only
explodes at runtime when the app opens its database. Because the source is a
raw GitHub tarball with no registry integrity hash, an upstream layout change
(file renamed/moved) silently turns the patch into a no-op.

This plan makes the patch **fail loudly** — a missing package, a missing target
file, or a file that does not end up in the expected patched state now aborts
the install with a non-zero exit — and adds a regression test so the failure
modes stay covered. It also records a first-class investigation of the
**preferred** long-term fix (moving to a registry release that needs no patch)
so the maintainer can retire the patch when one exists. After this lands, a
broken native module fails at install time, visibly, instead of at runtime in a
user's hands.

## Current state

Files involved and their role:

- `scripts/patch-better-sqlite3.js` — the `postinstall` patch. Plain CommonJS
  (a `.js` file; **not** covered by `pnpm run lint`, which is `eslint . --ext ts,tsx`).
  Contains all three silent-failure paths. **This is the file you harden.**
- `package.json:34` — the `postinstall` chain that runs the patch.
- `package.json:106` — the GitHub pin.
- `package.json:195-202` — `pnpm.onlyBuiltDependencies` lists `better-sqlite3`,
  so its native build (the `postinstall`) is allowed to run under pnpm.
- `electron/sqlite-service.ts:1` — `import Database from 'better-sqlite3';` — the
  main runtime consumer; if the native module is broken, this is where the app
  dies.
- `tests/integration/` — the node-environment jest project (see jest config
  below). You add the new test here.

Real excerpts at `f24fb27`:

`package.json:34` (the `postinstall` chain — note the `&&`, so a non-zero exit
from the patch already aborts the whole chain and skips `electron-rebuild`;
that is exactly the behavior we want to trigger):
```json
    "postinstall": "node node_modules/electron/install.js && node scripts/patch-better-sqlite3.js && electron-rebuild",
```

`package.json:106` (the pin — a GitHub source ref, no registry integrity):
```json
    "better-sqlite3": "github:WiseLibs/better-sqlite3#v12.7.1",
```

`package.json:195-202` (why the native build runs under pnpm):
```json
    "onlyBuiltDependencies": [
      "electron",
      "better-sqlite3",
      "esbuild",
      "keytar",
      "mssql",
      "@parcel/watcher"
    ]
```

`scripts/patch-better-sqlite3.js:23-27` (silent path #1 — package dir not found,
exits **0**):
```js
const pkgDir = findPackageDir();
if (!pkgDir) {
  console.warn('patch-better-sqlite3: package directory not found, skipping.');
  process.exit(0);
}
```

`scripts/patch-better-sqlite3.js:40-56` (the patch loop — silent path #2 at
lines 42-45 `continue`s on a missing file; there is **no** check that
`patched > 0`, and the final `console.log` always lets the process exit 0):
```js
let patched = 0;
for (const { file, replacements } of files) {
  if (!fs.existsSync(file)) {
    console.warn(`patch-better-sqlite3: skipping (not found): ${file}`);
    continue;
  }
  let content = fs.readFileSync(file, 'utf8');
  for (const [from, to] of replacements) {
    const count = (content.match(new RegExp(from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
    if (count > 0) {
      content = content.replaceAll(from, to);
      patched += count;
    }
  }
  fs.writeFileSync(file, content);
}
console.log(`patch-better-sqlite3: applied ${patched} replacement(s) in ${pkgDir}`);
```

`scripts/patch-better-sqlite3.js:29-38` (the target file list and the one
replacement — reuse these values unchanged):
```js
const files = [
  {
    file: path.join(pkgDir, 'src/objects/database.cpp'),
    replacements: [['info.Holder()', 'info.HolderV2()']],
  },
  {
    file: path.join(pkgDir, 'src/objects/statement.cpp'),
    replacements: [['info.Holder()', 'info.HolderV2()']],
  },
];
```

`scripts/patch-better-sqlite3.js:8-21` (`findPackageDir()` — resolves the
package under both npm and pnpm layouts; **keep this function as-is**):
```js
function findPackageDir() {
  const candidates = [
    path.join(__dirname, '../node_modules/better-sqlite3'),
  ];
  // Also check pnpm content-addressable store if it exists
  const pnpmDir = path.join(__dirname, '../node_modules/.pnpm');
  if (fs.existsSync(pnpmDir)) {
    const pnpmCandidates = fs.readdirSync(pnpmDir, { withFileTypes: true })
      .filter(e => e.isDirectory() && e.name.startsWith('better-sqlite3@'))
      .map(e => path.join(pnpmDir, e.name, 'node_modules/better-sqlite3'));
    candidates.push(...pnpmCandidates);
  }
  return candidates.find(p => fs.existsSync(path.join(p, 'src')));
}
```

Repo conventions this plan must honor:

- **The idempotency trap (read this before writing any code).** The replacement
  is `info.Holder()` → `info.HolderV2()`. On a *fresh* extract the source
  contains `info.Holder()`; after patching it contains `info.HolderV2()`. But
  `postinstall` can run **again** against already-patched files (pnpm caches the
  built package; a repeated `pnpm install` may re-run the hook). On that second
  run there are **zero** `info.Holder()` left, so a naive "fail if 0
  replacements were made" would spuriously break a perfectly good install. The
  correct fail-loud criterion is **end-state**, not replacement count: after
  processing, each target file must contain the desired token `info.HolderV2()`
  and must **not** contain the bare `info.Holder()`. That succeeds whether the
  file was just patched or was already patched, and fails only when the source
  is genuinely unpatched or its API has changed. (Note `info.Holder()` is *not*
  a substring of `info.HolderV2()` — after `Holder` comes `V`, not `(` — so the
  absence check is safe.)
- **Test project layout** (from `jest.config.cjs`): two projects. `unit`
  (`testEnvironment: 'jsdom'`, `testMatch: tests/unit/**/*.test.(ts|tsx)`) and
  `integration` (`testEnvironment: 'node'`, `testMatch: tests/integration/**/*.test.ts`,
  transformed with `tsconfig.electron.json`). The new test does real filesystem
  I/O against a temp dir, so it belongs in **`tests/integration/`** (node env).
- **Requiring a JS module from a TS test is an established pattern here** — e.g.
  `tests/unit/automation-api.test.ts:166` does
  `const settings = require('../../electron/automation/settings');`. Mirror it:
  `const { patchBetterSqlite3 } = require('../../scripts/patch-better-sqlite3');`
  (the repo's ESLint config does not forbid `require` in tests).

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `pnpm install --frozen-lockfile` | exit 0 (runs the hardened `postinstall`; on a good install the patch prints its "verified" line and exits 0) |
| Rebuild sqlite for Node ABI | `npm rebuild better-sqlite3` | exit 0 (postinstall builds it for Electron; rebuild it for the current Node so the smoke one-liner and jest can `require` it — this is exactly what CI does, see `.github/workflows/ci.yml:57-58`) |
| SQLite smoke (real query) | `node -e "const D=require('better-sqlite3'); const db=new D(':memory:'); db.exec('create table t(x)'); db.prepare('insert into t values (?)').run(42); console.log(db.prepare('select x from t').get());"` | prints `{ x: 42 }` |
| Targeted test | `npx jest --selectProjects integration tests/integration/patch-better-sqlite3.test.ts` | all pass |
| Full tests | `pnpm test` | all pass |
| Lint | `pnpm run lint` | exit 0 (eslint, `--max-warnings 0`; note: does NOT lint the `.js` script) |
| Build | `pnpm run build` | exit 0 |

There is no `typecheck` script in this repo yet (plan 002 adds one). The `.js`
script is not type-checked; the new `.ts` test is compiled by ts-jest when
`pnpm test` runs. No standalone `tsc` step is needed for this plan.

## Suggested executor toolkit

- Use the `verify` skill (if available) after Step 3 to drive the real install +
  SQLite smoke end-to-end, rather than relying on the unit test alone.

## Scope

**In scope** (the only files you should modify):
- `scripts/patch-better-sqlite3.js` (harden — Step 2)
- `tests/integration/patch-better-sqlite3.test.ts` (create — Step 3)

**Out of scope** (do NOT touch, even though they look related):
- `package.json` — **do not change the pin or the `postinstall` chain.** The
  `&&` in `postinstall` already propagates the patch's non-zero exit and aborts
  the install; the fail-loud behavior comes entirely from the script exiting
  non-zero. Swapping the GitHub pin for a registry release is the *preferred*
  long-term fix but is a larger, cross-platform-native migration that must be
  operator-approved — Step 1 investigates it and **reports**, it does not swap.
- `electron/sqlite-service.ts` and any other `better-sqlite3` consumer — runtime
  usage is unaffected; you are only changing how the patch reports failure.
- `.github/workflows/ci.yml` — CI already `npm rebuild better-sqlite3`s; no change.
- Upstream `node_modules/**/better-sqlite3/src/*.cpp` — those are the files the
  patch edits at install time; never hand-edit or commit them.

## Git workflow

- Branch: `advisor/016-better-sqlite3-pin-hardening`
- Commit per logical unit; conventional-commit style (example from `git log`:
  `fix(review): keep raw-headers / .eml export out of the mail read bucket`).
  Suggested commits:
  - `fix(build): fail loudly when the better-sqlite3 patch cannot apply`
  - `test(build): cover patch-better-sqlite3 failure and idempotency paths`
- Do NOT push or open a PR.

## Steps

### Step 1: Investigate the preferred fix (registry release) — report, don't swap

The preferred long-term fix is to depend on a **registry** `better-sqlite3`
release that builds against Electron 41's V8 without any C++ patch, then retire
this script. Determine whether one exists yet:

```bash
npm view better-sqlite3 dist-tags
npm view better-sqlite3 versions --json | tail -30
```

The current pin is a GitHub build of `v12.7.1` chosen specifically because
registry releases up to that point still used the removed `info.Holder()` API.
Look for a **published registry version newer than 12.7.1** whose release notes
state it no longer uses `Holder()` / moved to `HolderV2()` or N-API (i.e. builds
clean on Electron 41). Read the changelog for the candidate at
`https://github.com/WiseLibs/better-sqlite3/releases`.

- **If a clear candidate registry release exists**: this is a better fix than
  hardening the patch, but it is a native-dependency migration that must be
  re-verified with `electron-builder` on every packaged platform (macOS
  arm64 + Windows nsis per `package.json` `build`). That is beyond this plan's
  automatic scope. **STOP and report** the version and evidence to the operator,
  recommending: pin `"better-sqlite3": "^<version>"`, delete
  `scripts/patch-better-sqlite3.js`, and drop the `node scripts/patch-better-sqlite3.js &&`
  segment from `package.json:34`. Do **not** perform that swap yourself.
- **If no such registry release exists** (the expected case as of 2026-07):
  proceed to Step 2 — the patch must stay, so make it fail loudly.

**Verify**: You have either (a) a written recommendation with a concrete version
number handed to the operator (then STOP), or (b) a one-line note "no
patch-free registry release available; hardening the patch" recorded, and you
continue.

### Step 2: Make the patch fail loudly (end-state assertion, idempotent)

Rewrite `scripts/patch-better-sqlite3.js` so it (a) exposes a testable
`patchBetterSqlite3(pkgDir)` function that **throws** on every failure mode, and
(b) keeps the same `postinstall` behavior but exits non-zero on any throw.
Preserve `findPackageDir()` and the file/replacement list from "Current state"
unchanged. Replace the fail-silent tail (lines 23-56 in the excerpts) with the
target shape below.

Target shape (the load-bearing logic — match it; keep the file's header comment
and `findPackageDir`):

```js
#!/usr/bin/env node
// Patches better-sqlite3 for Electron 41+ compatibility.
// v12.7.1 upstream used Holder() but Electron 41's V8 only exposes HolderV2().
const fs = require('fs');
const path = require('path');

// ... keep findPackageDir() exactly as-is ...

const TARGET_FILES = ['src/objects/database.cpp', 'src/objects/statement.cpp'];
const FROM = 'info.Holder()';
const TO = 'info.HolderV2()';

function patchBetterSqlite3(pkgDir) {
  if (!pkgDir) {
    throw new Error(
      'patch-better-sqlite3: better-sqlite3 package directory not found. ' +
      'The dependency must be installed with its src/ before this patch runs; ' +
      'refusing to continue with a possibly broken native module.'
    );
  }
  let applied = 0;
  for (const rel of TARGET_FILES) {
    const file = path.join(pkgDir, rel);
    if (!fs.existsSync(file)) {
      throw new Error(
        `patch-better-sqlite3: target file missing: ${file}. ` +
        'The better-sqlite3 source layout changed; the patch can no longer be ' +
        'applied. Update this script for the new upstream layout.'
      );
    }
    const before = fs.readFileSync(file, 'utf8');
    const after = before.split(FROM).join(TO); // replaceAll of a literal
    // Informational count only (TO is longer than FROM by 2 chars per hit):
    applied += (after.length - before.length) / (TO.length - FROM.length) || 0;
    fs.writeFileSync(file, after);

    // End-state assertion (idempotent): the file must end patched, whether we
    // just changed it or it was already patched on a re-run. FROM is not a
    // substring of TO, so this cannot be fooled by an already-patched file.
    const result = fs.readFileSync(file, 'utf8');
    if (result.includes(FROM) || !result.includes(TO)) {
      throw new Error(
        `patch-better-sqlite3: ${file} is not in the expected patched state ` +
        `after processing (want '${TO}', still found unpatched '${FROM}', or ` +
        `'${TO}' absent). Refusing to ship a broken native module.`
      );
    }
  }
  console.log(
    `patch-better-sqlite3: verified ${TARGET_FILES.length} file(s) patched ` +
    `(${applied} replacement(s) applied this run) in ${pkgDir}`
  );
  return applied;
}

if (require.main === module) {
  try {
    patchBetterSqlite3(findPackageDir());
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

module.exports = { patchBetterSqlite3, findPackageDir, TARGET_FILES };
```

Notes:
- The `applied` count is informational only — **do not** gate success on it (see
  the idempotency trap in "Current state"). Success is gated on the end-state
  assertion. (If you prefer, count matches with the existing regex from the old
  code instead of the length arithmetic — either is fine; the count is not used
  for control flow.)
- Keep `console.log` on success so a good install still prints a confirming
  line; send all errors to `console.error` before `process.exit(1)`.
- Do not change the `postinstall` line in `package.json` — the `&&` already
  aborts the chain when this script exits non-zero.

**Verify**:
- `node -e "const m=require('./scripts/patch-better-sqlite3.js'); if(typeof m.patchBetterSqlite3!=='function') process.exit(1)"` → exit 0 (module exports the function without running the patch, because of the `require.main === module` guard).
- `node -e "try{require('./scripts/patch-better-sqlite3.js').patchBetterSqlite3(undefined);process.exit(1)}catch(e){console.log('threw ok');process.exit(0)}"` → prints `threw ok`, exit 0.

### Step 3: Add the regression test

Create `tests/integration/patch-better-sqlite3.test.ts` covering every failure
and the idempotent-success path. Use real temp directories (node env). Model the
`require`-a-JS-module pattern on `tests/unit/automation-api.test.ts:166`.

Structure to produce:

```ts
import fs from 'fs';
import os from 'os';
import path from 'path';

const { patchBetterSqlite3 } = require('../../scripts/patch-better-sqlite3') as {
  patchBetterSqlite3: (pkgDir?: string) => number;
};

const FROM = 'info.Holder()';
const TO = 'info.HolderV2()';

function makePkg(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bsq3-patch-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return dir;
}

const bothUnpatched = {
  'src/objects/database.cpp': `foo(${FROM});`,
  'src/objects/statement.cpp': `bar(${FROM});`,
};

describe('patchBetterSqlite3', () => {
  it('patches both target files and reports replacements', () => {
    const dir = makePkg(bothUnpatched);
    const applied = patchBetterSqlite3(dir);
    expect(applied).toBeGreaterThan(0);
    for (const rel of Object.keys(bothUnpatched)) {
      const out = fs.readFileSync(path.join(dir, rel), 'utf8');
      expect(out).toContain(TO);
      expect(out).not.toContain(FROM);
    }
  });

  it('is idempotent: a second run on already-patched files does not throw', () => {
    const dir = makePkg(bothUnpatched);
    patchBetterSqlite3(dir);
    expect(() => patchBetterSqlite3(dir)).not.toThrow(); // 0 replacements, still OK
  });

  it('throws when the package directory is missing (undefined)', () => {
    expect(() => patchBetterSqlite3(undefined)).toThrow(/package directory not found/i);
  });

  it('throws when a target file is missing', () => {
    const dir = makePkg({ 'src/objects/database.cpp': `foo(${FROM});` }); // no statement.cpp
    expect(() => patchBetterSqlite3(dir)).toThrow(/target file missing/i);
  });

  it('throws when a target file has neither token (silent no-op guard)', () => {
    const dir = makePkg({
      'src/objects/database.cpp': 'no tokens here;',
      'src/objects/statement.cpp': `bar(${FROM});`,
    });
    expect(() => patchBetterSqlite3(dir)).toThrow(/not in the expected patched state/i);
  });
});
```

Make sure the assertion `toThrow` messages match the error strings you wrote in
Step 2 (adjust the regexes if you worded the messages differently).

**Verify**: `npx jest --selectProjects integration tests/integration/patch-better-sqlite3.test.ts`
→ all 5 tests pass.

### Step 4: Verify a real install still succeeds and SQLite works

Confirm the hardened patch does **not** break a genuine install (where the
source files are present and get patched) and that the resulting module runs a
real query.

1. `pnpm install --frozen-lockfile` → exit 0. In the output you should see the
   patch's success line (`patch-better-sqlite3: verified 2 file(s) patched …`),
   and `electron-rebuild` should run after it.
2. `npm rebuild better-sqlite3` → exit 0 (rebuilds for the current Node ABI, as
   CI does at `.github/workflows/ci.yml:57-58`, so plain Node can load it).
3. SQLite smoke:
   ```bash
   node -e "const D=require('better-sqlite3'); const db=new D(':memory:'); db.exec('create table t(x)'); db.prepare('insert into t values (?)').run(42); console.log(db.prepare('select x from t').get());"
   ```
   → prints `{ x: 42 }`.

**Verify**: all three commands succeed as described (install exit 0 with the
patch success line; smoke prints `{ x: 42 }`).

### Step 5: Full repo gates

Run the standard gates and confirm only the two in-scope files changed.

**Verify**:
- `pnpm run lint` → exit 0.
- `pnpm test` → all pass (includes the new integration test).
- `pnpm run build` → exit 0.
- `git status --porcelain` → shows only `scripts/patch-better-sqlite3.js` (M)
  and `tests/integration/patch-better-sqlite3.test.ts` (A).

## Test plan

- **New test**: `tests/integration/patch-better-sqlite3.test.ts` (create),
  structured after the `require`-a-JS-module pattern in
  `tests/unit/automation-api.test.ts:166`. Cases:
  1. Happy path — both `database.cpp` and `statement.cpp` get `info.Holder()` →
     `info.HolderV2()`, function returns a positive count.
  2. Idempotency — a second run on already-patched files (0 replacements) does
     **not** throw. This is the regression guard for the idempotency trap.
  3. Missing package dir (`undefined`) → throws.
  4. Missing target file → throws (this is silent-failure path #2 from the
     finding, now loud).
  5. Unpatchable content (neither token present) → throws (the "silent no-op
     yields a broken native module" case the finding calls out).
- **Real-install guard**: Step 4 (`pnpm install --frozen-lockfile` + rebuild +
  SQLite smoke) proves the hardened patch still succeeds on a genuine install
  and produces a working native module. The end-to-end CI guard is unchanged —
  `.github/workflows/ci.yml` installs, `npm rebuild better-sqlite3`, and runs the
  mail suites that open a real SQLite DB.
- Verification: `npx jest --selectProjects integration tests/integration/patch-better-sqlite3.test.ts`
  → 5 pass; `pnpm test` → all pass.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `scripts/patch-better-sqlite3.js` exports `patchBetterSqlite3` and throws
      on: missing pkgDir, missing target file, and a file not in the patched
      end-state (verify by the Step 2 `node -e` checks — both pass).
- [ ] `grep -n "process.exit(0)" scripts/patch-better-sqlite3.js` returns nothing
      (the silent success exit is gone).
- [ ] `tests/integration/patch-better-sqlite3.test.ts` exists with 5 passing tests.
- [ ] `npx jest --selectProjects integration tests/integration/patch-better-sqlite3.test.ts` → all pass.
- [ ] `pnpm install --frozen-lockfile` exits 0 and its output contains
      `patch-better-sqlite3: verified`.
- [ ] SQLite smoke (Step 4.3) prints `{ x: 42 }`.
- [ ] `pnpm run lint` exits 0.
- [ ] `pnpm test` exits 0.
- [ ] `pnpm run build` exits 0.
- [ ] `git status --porcelain` shows only the two in-scope files.
- [ ] `plans/README.md` status row updated.

## STOP conditions

Stop and report back (do not improvise) if:

- The code at the locations in "Current state" doesn't match the excerpts (the
  script or `package.json` drifted since this plan was written — e.g. the patch
  already fails loudly, or the pin is already a registry release).
- Step 1 finds a published registry `better-sqlite3` release that clearly builds
  on Electron 41 without a patch — report it with the version + changelog
  evidence and recommend the pin-swap/patch-retire migration; do **not** perform
  the swap yourself (it needs cross-platform native re-verification).
- `pnpm install --frozen-lockfile` fails at the patch step on a **fresh** install
  (i.e. the target files are present but the assertion still throws). That means
  the upstream layout or API changed — capture the exact error and report;
  do not hollow out the assertion to force the install through.
- The SQLite smoke (Step 4.3) errors with a `NODE_MODULE_VERSION` /
  ABI-mismatch message even after `npm rebuild better-sqlite3` — report it; this
  indicates a rebuild/toolchain problem, not a patch-logic problem.
- Any step's verification fails twice after a reasonable fix attempt.
- The fix appears to require touching an out-of-scope file (especially
  `package.json` — the fail-loud behavior must come from the script's non-zero
  exit, not from editing the `postinstall` chain).

## Maintenance notes

For the human/agent who owns this after the change lands:

- **The patch is now a hard install gate.** Any future bump of the
  `better-sqlite3` pin (`package.json:106`) must be paired with a check that the
  target C++ files still contain `info.Holder()` in a form this script rewrites.
  If upstream changes the API (no `Holder()`/`HolderV2()`), the end-state
  assertion will fail the install by design — that is the signal to update or
  retire the script, not to weaken the assertion.
- **Retiring the patch (the preferred end state):** when a registry release that
  needs no patch exists (Step 1), the migration is: pin `"better-sqlite3": "^<v>"`,
  delete `scripts/patch-better-sqlite3.js`, and remove the
  `node scripts/patch-better-sqlite3.js &&` segment from `package.json:34`. Then
  re-run a full `electron-builder` packaging on macOS arm64 and Windows nsis
  (per the `build` block in `package.json`) to confirm the native module still
  loads in a packaged app — the CI `build-and-test` job alone does not cover the
  packaged binaries.
- **Reviewer focus for this PR:** (1) success is gated on the end-state
  assertion, not on a replacement count (the idempotency trap); (2)
  `require.main === module` guards the auto-run so the test can import the
  function without side effects; (3) `git status` shows only the two in-scope
  files — `package.json` and the upstream `.cpp` sources are untouched.
- **Deferred:** wiring the SQLite smoke (Step 4.3) into CI as an explicit step is
  out of scope here; CI already exercises the real native module via the mail
  suites after `npm rebuild better-sqlite3`.
