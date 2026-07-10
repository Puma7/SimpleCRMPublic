# Plan 007: Replace 87 inline `require('kysely')` calls with a single static import per file

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in the `README.md` of the directory this plan lives in (`plans/README.md`) —
> unless a reviewer dispatched you and told you they maintain the index.
>
> **Drift check (run first)**:
> ```
> git diff --stat f24fb27..HEAD -- \
>   packages/server/src/db/postgres-mail-read-ports.ts \
>   packages/server/src/db/postgres-mail-metadata-read-ports.ts \
>   packages/server/src/db/postgres-mail-diagnostics-port.ts \
>   packages/server/src/db/postgres-extended-crm-read-ports.ts \
>   packages/server/src/db/postgres-core-crm-read-ports.ts \
>   packages/server/src/db/postgres-workflow-runtime-read-ports.ts \
>   packages/server/src/db/postgres-workflow-read-ports.ts \
>   packages/server/src/db/postgres-spam-read-ports.ts \
>   packages/server/src/db/postgres-email-reporting-port.ts \
>   packages/server/src/db/postgres-auth-port.ts \
>   packages/server/src/db/postgres-pgp-read-ports.ts \
>   packages/server/src/db/postgres-customer-port.ts \
>   packages/server/src/db/postgres-job-queue-port.ts \
>   packages/server/src/db/postgres-audit-port.ts \
>   packages/server/src/db/workspace-context.ts \
>   packages/server/src/pgp/message-crypto-port.ts \
>   packages/server/src/mail-read-receipt-responder.ts \
>   packages/server/src/mail-compose-send.ts \
>   packages/server/src/mail-scheduled-send.ts
> ```
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts and the per-file require counts against the live
> code before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: tech-debt
- **Planned at**: commit `f24fb27`, 2026-07-10

## Why this matters

Across 19 server files, 87 functions each re-declare the Kysely `sql` tag with
an inline `const { sql: kyselySql } = require('kysely') as typeof import('kysely');`
statement inside the function body — several of them in files that **already**
statically import `sql` at module scope. Node caches the `kysely` module, so
every one of these requires resolves to the same object: the calls are
behavior-identical noise. They inflate the files, obscure the module's real
dependencies (kysely is imported as a value but you can only tell by reading
every function), and mix CommonJS `require` into otherwise ESM-style files. This
plan replaces them with one top-level `import` per file, deleting all 87 inline
requires. After it lands, `grep -rn "require('kysely')" packages/server/src`
returns nothing, the dependency is declared once per file, and there is no
runtime behavior change (the server compiles with `module: CommonJS`, so the
static import emits the same cached `require("kysely")` under the hood).

## Current state

**Every one of the 87 inline requires is the exact same statement** (only the
leading indentation varies):

```
const { sql: kyselySql } = require('kysely') as typeof import('kysely');
```

The 19 in-scope files fall into two groups.

### Group A — 17 files that import kysely as **types only** today (72 requires)

These files have an `import type { ... } from 'kysely'` line and no value
binding for `sql`; each inline require introduces the local `kyselySql` value.
The fix is to widen that existing import to also pull in the `sql` value,
aliased to `kyselySql`, then delete the requires. The function bodies already
reference `kyselySql`, so **no body edits are needed** in this group.

| File | requires | current kysely import line (exact) |
|------|---------:|------------------------------------|
| `packages/server/src/db/postgres-mail-metadata-read-ports.ts` | 15 | L9: `import type { Kysely, RawBuilder, Selectable, Updateable } from 'kysely';` |
| `packages/server/src/db/postgres-mail-diagnostics-port.ts` | 7 | L5: `import type { Kysely } from 'kysely';` |
| `packages/server/src/db/postgres-extended-crm-read-ports.ts` | 7 | L1: `import type { Kysely, RawBuilder, Selectable, Updateable } from 'kysely';` |
| `packages/server/src/db/postgres-core-crm-read-ports.ts` | 7 | L1: `import type { Expression, ExpressionBuilder, Kysely, RawBuilder, Selectable, SqlBool, Updateable } from 'kysely';` |
| `packages/server/src/db/postgres-workflow-runtime-read-ports.ts` | 5 | L1: `import type { Kysely, RawBuilder, Selectable, Updateable } from 'kysely';` |
| `packages/server/src/db/postgres-workflow-read-ports.ts` | 4 | L1: `import type { Kysely, RawBuilder, Selectable, Updateable } from 'kysely';` |
| `packages/server/src/db/postgres-spam-read-ports.ts` | 4 | L1: `import type { Kysely, RawBuilder, Selectable, Updateable } from 'kysely';` |
| `packages/server/src/db/postgres-email-reporting-port.ts` | 4 | L1: `import type { Kysely } from 'kysely';` |
| `packages/server/src/db/postgres-auth-port.ts` | 4 | L4: `import type { Kysely, Transaction } from 'kysely';` |
| `packages/server/src/db/postgres-pgp-read-ports.ts` | 3 | L1: `import type { Kysely, RawBuilder, Selectable, Updateable } from 'kysely';` |
| `packages/server/src/db/postgres-customer-port.ts` | 3 | L1: `import type { Kysely, RawBuilder, Selectable, Updateable } from 'kysely';` |
| `packages/server/src/pgp/message-crypto-port.ts` | 2 | L1: `import type { Kysely } from 'kysely';` |
| `packages/server/src/mail-read-receipt-responder.ts` | 2 | L1: `import type { Kysely, RawBuilder } from 'kysely';` |
| `packages/server/src/db/postgres-job-queue-port.ts` | 2 | L2: `import type { Kysely, RawBuilder } from 'kysely';` |
| `packages/server/src/db/workspace-context.ts` | 1 | L1: `import type { Kysely, Transaction } from 'kysely';` |
| `packages/server/src/db/postgres-audit-port.ts` | 1 | L3: `import type { Kysely } from 'kysely';` |
| `packages/server/src/mail-compose-send.ts` | 1 | L5: `import type { Kysely, RawBuilder } from 'kysely';` |

Representative body (from `postgres-mail-metadata-read-ports.ts:610-616`) —
note the body uses `kyselySql`, which the new import will provide:

```ts
): RawBuilder<boolean> {
  const { sql: kyselySql } = require('kysely') as typeof import('kysely');   // ← delete this line
  const accountPredicate = accountId === undefined
    ? kyselySql<boolean>`true`
    : kyselySql<boolean>`m.account_id = ${accountId}`;
  return kyselySql<boolean>`exists (
```

### Group B — 2 files handled individually (15 requires)

- **`packages/server/src/db/postgres-mail-read-ports.ts`** — 14 requires.
  This file **already** has the correct top-level value import at **L29**:
  ```ts
  import { sql as kyselySql, type Kysely, type Selectable, type Updateable } from 'kysely';
  ```
  So the import is done; the 14 inline requires (at lines 1106, 1935, 2017,
  2211, 2399, 2451, 2484, 2561, 2667, 2729, 2744, 2907, 3511, 4017) are pure
  duplicates. **Delete them; no import change.**

- **`packages/server/src/mail-scheduled-send.ts`** — 1 require. This file
  already imports the `sql` value (not aliased) at **L9**:
  ```ts
  import { sql, type Kysely, type RawBuilder } from 'kysely';
  ```
  and uses the bare `sql` tag throughout (e.g. L428-434). The single inline
  require is the only place it uses the `kyselySql` alias:
  ```ts
  function serverApiSourceRow(): RawBuilder<unknown> {
    const { sql: kyselySql } = require('kysely') as typeof import('kysely');   // L579 ← delete
    return kyselySql`'{"origin":"server_api"}'::jsonb`;                        // L580 ← kyselySql → sql
  }
  ```
  **Delete L579 and change `kyselySql` → `sql` on L580.** Do not add a new
  import (the file already imports `sql`).

### Conventions to match

- **Exemplar import shape**: `packages/server/src/db/postgres-mail-read-ports.ts:29`
  — `import { sql as kyselySql, type Kysely, type Selectable, type Updateable } from 'kysely';`.
  Value binding first, then each type name carries an inline `type` modifier on
  the same import (this repo compiles with `isolatedModules`, so type-only names
  must keep the `type` keyword). Reproduce this shape when widening Group A imports.
- **The `kysely` value tag is aliased to `kyselySql`** everywhere it is used in
  Group A bodies. Do not rename body usages in Group A — only add the import.

### Why this is safe

- Server code compiles with `module: "CommonJS"` (`packages/server/tsconfig.json`),
  so `import { sql as kyselySql } from 'kysely'` emits `require("kysely")` and a
  `.sql` reference — the same cached module the inline requires resolve to.
- The Jest unit/integration suites map `kysely` to a mock
  (`tests/setup/kysely-mock.ts`, wired via `moduleNameMapper: { '^kysely$': ... }`
  in `jest.config.cjs`). That mock exports a named `sql`
  (`export const sql = Object.assign(...)`), so a static `import { sql }` /
  `import { sql as kyselySql }` resolves to the same object the inline
  `require('kysely')` returned. No test behavior changes.
- ESLint currently enables **no rules** (`eslint.config.mjs` is a stub), so
  neither the inline requires nor the new imports trip a lint rule; lint stays
  green either way. The real gates are the build (tsc) and the test suites.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Install | `pnpm install --frozen-lockfile` | exit 0 |
| Typecheck / build | `pnpm run build` | exit 0 (compiles core + server + desktop + web + electron main) |
| Typecheck (faster, server only) | `npx tsc -b packages/core packages/server` | exit 0, no errors |
| Tests (full) | `pnpm test` | all pass |
| Tests (mail suite — these files are mail/db related) | `pnpm run test:mail` | all pass |
| Lint | `pnpm run lint` | exit 0 (eslint `--max-warnings 0`) |
| Confirm zero requires remain | `grep -rn "require('kysely')" packages/server/src` | no output (exit 1) |

Note: there is **no** `typecheck` npm script yet (a separate plan 002 adds one).
Until then, type-check via `pnpm run build` (authoritative) or the faster
`npx tsc -b packages/core packages/server`.

## Scope

**In scope** (the only files you may modify — all 19):

- `packages/server/src/db/postgres-mail-read-ports.ts`
- `packages/server/src/db/postgres-mail-metadata-read-ports.ts`
- `packages/server/src/db/postgres-mail-diagnostics-port.ts`
- `packages/server/src/db/postgres-extended-crm-read-ports.ts`
- `packages/server/src/db/postgres-core-crm-read-ports.ts`
- `packages/server/src/db/postgres-workflow-runtime-read-ports.ts`
- `packages/server/src/db/postgres-workflow-read-ports.ts`
- `packages/server/src/db/postgres-spam-read-ports.ts`
- `packages/server/src/db/postgres-email-reporting-port.ts`
- `packages/server/src/db/postgres-auth-port.ts`
- `packages/server/src/db/postgres-pgp-read-ports.ts`
- `packages/server/src/db/postgres-customer-port.ts`
- `packages/server/src/db/postgres-job-queue-port.ts`
- `packages/server/src/db/postgres-audit-port.ts`
- `packages/server/src/db/workspace-context.ts`
- `packages/server/src/pgp/message-crypto-port.ts`
- `packages/server/src/mail-read-receipt-responder.ts`
- `packages/server/src/mail-compose-send.ts`
- `packages/server/src/mail-scheduled-send.ts`

Plus, at the very end, the plan index row: `plans/README.md`.

**Out of scope** (do NOT touch, even though they look related):

- Any `require('kysely')` outside `packages/server/src` — there are none at
  `f24fb27` (verified: the 87 hits are all under `packages/server/src`). Do not
  go looking for more elsewhere.
- The Kysely `type` imports (`Kysely`, `RawBuilder`, `Selectable`, `Updateable`,
  `Transaction`, `Expression`, `ExpressionBuilder`, `SqlBool`) — keep them; only
  ADD the `sql` value binding. Do not reorder or drop existing type names.
- Renaming `kyselySql` → `sql` across Group A bodies — do NOT. Only Group B's
  `mail-scheduled-send.ts` gets a single `kyselySql`→`sql` rename on L580.
- The test mock `tests/setup/kysely-mock.ts` and any test files — no changes
  needed; leave them alone.
- ESLint config, tsconfig, or package scripts — unrelated to this change.

## Git workflow

- Branch: `advisor/007-remove-redundant-kysely-requires`
- Commit style: conventional commits, as in this repo's history (e.g.
  `fix(review): keep raw-headers / .eml export out of the mail read bucket`).
  A single commit is fine given the mechanical nature, e.g.:
  `refactor(server): drop 87 inline require('kysely') for one static import per file`
- Do NOT push or open a PR unless the operator instructs it.

## Steps

Do imports first (Steps 2–3), then delete the requires (Step 4). Between those
steps the files still compile: an inline `const { sql: kyselySql } = require(...)`
inside a function legally shadows the module-level `kyselySql` binding, so the
tree is never broken mid-edit.

### Step 1: Create the branch

```
git checkout -b advisor/007-remove-redundant-kysely-requires
```

**Verify**: `git branch --show-current` → `advisor/007-remove-redundant-kysely-requires`

### Step 2: Widen the kysely import in the 17 Group A files

For each Group A file in the "Current state" table, edit the single existing
kysely import line to add the `sql` value binding aliased to `kyselySql`, giving
each existing type name an inline `type` modifier. Do not change anything else
on the line. Examples of the exact transform:

- `postgres-mail-metadata-read-ports.ts:9`
  - from: `import type { Kysely, RawBuilder, Selectable, Updateable } from 'kysely';`
  - to:   `import { sql as kyselySql, type Kysely, type RawBuilder, type Selectable, type Updateable } from 'kysely';`
- `postgres-mail-diagnostics-port.ts:5`
  - from: `import type { Kysely } from 'kysely';`
  - to:   `import { sql as kyselySql, type Kysely } from 'kysely';`
- `postgres-core-crm-read-ports.ts:1`
  - from: `import type { Expression, ExpressionBuilder, Kysely, RawBuilder, Selectable, SqlBool, Updateable } from 'kysely';`
  - to:   `import { sql as kyselySql, type Expression, type ExpressionBuilder, type Kysely, type RawBuilder, type Selectable, type SqlBool, type Updateable } from 'kysely';`
- `postgres-auth-port.ts:4` and `workspace-context.ts:1`
  - from: `import type { Kysely, Transaction } from 'kysely';`
  - to:   `import { sql as kyselySql, type Kysely, type Transaction } from 'kysely';`

Apply the same pattern to the remaining Group A files (`extended-crm`,
`workflow-runtime`, `workflow-read`, `spam-read`, `email-reporting`, `pgp-read`,
`customer-port`, `job-queue-port`, `audit-port`, `pgp/message-crypto-port`,
`mail-read-receipt-responder`, `mail-compose-send`), each converting
`import type { … }` → `import { sql as kyselySql, type … }`.

Do **nothing** to the two Group B files in this step.

**Verify**: every Group A file now has exactly one value-import of `sql`:
```
grep -rc "import { sql as kyselySql" packages/server/src
```
→ every Group A file above prints `1`; `postgres-mail-read-ports.ts` also
prints `1` (pre-existing); `mail-scheduled-send.ts` prints `0`.

### Step 3: Fix the single body reference in `mail-scheduled-send.ts` (Group B)

In `packages/server/src/mail-scheduled-send.ts`, change the tag used inside
`serverApiSourceRow()` from the aliased `kyselySql` to the already-imported
bare `sql`, on the line that currently reads (L580):

```ts
  return kyselySql`'{"origin":"server_api"}'::jsonb`;
```

to:

```ts
  return sql`'{"origin":"server_api"}'::jsonb`;
```

Do not touch this file's L9 import (it already imports `sql`).
`postgres-mail-read-ports.ts` needs no import change either (L29 is already correct).

**Verify**:
```
grep -n "kyselySql" packages/server/src/mail-scheduled-send.ts
```
→ only the line still containing the inline require (L579) should match; the
`return` line must now read `sql` (that require line is deleted in Step 4).

### Step 4: Delete all 87 inline requires

Delete every line whose content (ignoring indentation) is exactly:

```
const { sql: kyselySql } = require('kysely') as typeof import('kysely');
```

The substring is identical in all 87 sites, so a single mechanical pass per file
is safe. From the repo root:

```
grep -rl "require('kysely')" packages/server/src \
  | xargs sed -i "\|const { sql: kyselySql } = require('kysely') as typeof import('kysely');|d"
```

(The `\|…|` form lets `sed` use `|` as the delimiter so the `/` inside the line
doesn't need escaping.)

**Verify**:
```
grep -rn "require('kysely')" packages/server/src ; echo "exit=$?"
```
→ no matching lines, `exit=1`.

### Step 5: Typecheck, lint, and test

Run, in order:

```
pnpm install --frozen-lockfile
pnpm run build
pnpm run lint
pnpm test
pnpm run test:mail
```

**Verify**: each command exits 0 / reports all tests passing. If `pnpm run build`
is too slow to iterate on, use `npx tsc -b packages/core packages/server` for a
faster server-only typecheck while fixing, then run the full `pnpm run build`
once before committing.

### Step 6: Commit

```
git add -A
git commit -m "refactor(server): drop 87 inline require('kysely') for one static import per file"
```

**Verify**: `git status` shows a clean tree and `git show --stat HEAD` lists only
the 19 in-scope files.

## Test plan

No new tests — this is a behavior-preserving refactor and existing suites already
exercise the changed files. Rely on the existing coverage:

- `pnpm test` — full Jest run (unit + integration). The `kysely` mock
  (`tests/setup/kysely-mock.ts`) is exercised through these files; a broken
  import binding would fail here.
- `pnpm run test:mail` — the mail suite; several in-scope files are mail/db code
  (`mail-scheduled-send.ts`, `mail-compose-send.ts`, `postgres-mail-*`,
  `mail-read-receipt-responder.ts`). Test files that import them include
  `tests/mail/email-scheduled-send.test.ts`,
  `tests/mail/email-compose-send.expanded.test.ts`,
  `tests/unit/email-scheduled-send.test.ts`,
  `tests/unit/email-compose-send.test.ts`.
- Verification: `pnpm test` and `pnpm run test:mail` → all pass, same count as at
  `f24fb27` (no tests added or removed).

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `grep -rn "require('kysely')" packages/server/src` returns no matches (exit 1)
- [ ] `pnpm run build` exits 0
- [ ] `pnpm run lint` exits 0
- [ ] `pnpm test` exits 0 (all pass)
- [ ] `pnpm run test:mail` exits 0 (all pass)
- [ ] Each Group A file has exactly one `import { sql as kyselySql, type … } from 'kysely'` line; `postgres-mail-read-ports.ts` keeps its pre-existing one; `mail-scheduled-send.ts` still imports bare `sql` and no longer references `kyselySql`
- [ ] `git status` shows only the 19 in-scope files changed (plus `plans/README.md`)
- [ ] `plans/README.md` status row for plan 007 updated

## STOP conditions

Stop and report back (do not improvise) if:

- The drift check shows any in-scope file changed since `f24fb27` and its live
  code no longer matches the "Current state" excerpts or the per-file require
  counts (total should be 87; the requires must all be the identical statement).
- A file in Group A turns out to already use a **bare** `sql` value (not
  `kyselySql`) somewhere, or uses some *other* kysely value export in a body —
  i.e. the simple `sql as kyselySql` widening would collide or leave a symbol
  unbound. (At `f24fb27` only `mail-scheduled-send.ts` uses bare `sql`, and it is
  handled explicitly in Step 3; anything else is unexpected.)
- After Step 4, `grep -rn "require('kysely')" packages/server/src` still finds a
  require you cannot delete because it is not the exact expected statement.
- `pnpm run build` reports a TypeScript error naming `sql`, `kyselySql`, or one
  of the kysely `type` imports after your edits, and it is not fixed by a single
  obvious correction (e.g. a mistyped alias).
- Any verification command fails twice after a reasonable fix attempt.

## Maintenance notes

For whoever owns this code next:

- The `sql` tag is now declared once at the top of each file. New functions
  needing raw SQL should use the module-level `kyselySql` (Group A / mail-read)
  or `sql` (`mail-scheduled-send.ts`) binding — **do not** reintroduce inline
  `require('kysely')`.
- If a future plan turns on ESLint rules, consider adding
  `@typescript-eslint/no-require-imports` (or a `no-restricted-syntax` ban on
  `require('kysely')`) so this pattern cannot silently return. That rule is out
  of scope here because the current `eslint.config.mjs` is a no-rule stub.
- The refactor depends on the server compiling as CommonJS
  (`packages/server/tsconfig.json` → `module: "CommonJS"`), which makes the
  static import and the old cached `require` byte-for-byte equivalent at runtime.
  If the server ever moves to native ESM, re-verify nothing relied on the
  lazy/deferred timing of the inline requires (nothing does today — kysely is a
  pure value module with no side effects on import).
- A reviewer should scrutinize: (1) that each widened import keeps ALL its
  original `type` names with `type` modifiers intact, and (2) that
  `mail-scheduled-send.ts` L580 was switched to bare `sql` (not left as
  `kyselySql`, which would be unbound after the require deletion).
