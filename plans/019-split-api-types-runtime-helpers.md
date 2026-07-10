# Plan 019: Separate runtime helpers from type declarations in api/types.ts

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in the `README.md` of the directory this plan lives in (`plans/README.md`)
> — unless a reviewer dispatched you and told you they maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat f24fb27..HEAD -- packages/server/src/api/`
> If any file under `packages/server/src/api/` changed since this plan was
> written, compare the "Current state" excerpts below against the live code
> before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P3
- **Effort**: L
- **Risk**: MED
- **Depends on**: none
- **Category**: tech-debt
- **Planned at**: commit `f24fb27`, 2026-07-10

## Why this matters

`packages/server/src/api/types.ts` is 4677 LOC. It is overwhelmingly a file of
API **type declarations**, but its tail (lines 4635–4677) defines seven
**runtime helper functions** — `json`, `data`, `error`, `requirePrincipal`,
`requireAdmin`, `positiveIntFromPath`, `getStringField`. Every route file in
`packages/server/src/api/` imports both the types and these helpers from the
same module. That couples type-only consumers to runtime code and makes the
single largest file in the package do two unrelated jobs, so a change to a
helper forces a re-read of a 4.6k-line type module and vice versa.

This plan performs a **mechanical extraction**: move the seven runtime helpers
verbatim into a new `packages/server/src/api/http.ts`, repoint the 22 route
files' value imports to it, and leave `types.ts` as pure type declarations. No
behavior changes, no type-declaration edits. When it lands, `types.ts` is
type-only and runtime helpers live in one small, obviously-runtime module.

## Current state

Relevant files (roles):

- `packages/server/src/api/types.ts` — 4677 LOC. Type declarations for the whole
  server API surface **plus** seven runtime helper functions at the very end of
  the file (the only runtime exports in it). Every other line is a `type`
  declaration; all top-of-file imports are `import type`.
- `packages/server/src/api/index.ts` — the api barrel. Re-exports every api
  module including `./types`. This is what makes the helpers visible via the
  package barrel `packages/server/src/index.ts`.
- 22 route/aggregator files under `packages/server/src/api/` that import at least
  one runtime helper as a **value** import from `'./types'` (enumerated in Scope).

The seven runtime helpers are the entire tail of `types.ts`. Verified excerpt,
`packages/server/src/api/types.ts:4635-4677` (this is the block to move, verbatim):

```ts
export function json<T>(status: number, body: T, headers?: Record<string, string>): ApiResponse<T> {
  return { status, body, headers };
}

export function data<T>(status: number, value: T): ApiResponse<ApiDataBody<T>> {
  return json(status, { data: value });
}

export function error(
  status: number,
  code: string,
  message: string,
  details?: unknown,
): ApiResponse<ApiErrorBody> {
  return json(status, {
    error: {
      code,
      message,
      ...(details === undefined ? {} : { details }),
    },
  });
}

export function requirePrincipal(req: ApiRequest): AuthenticatedPrincipal | ApiResponse<ApiErrorBody> {
  if (req.principal) return req.principal;
  return error(401, 'unauthorized', 'Authentifizierung erforderlich');
}

export function requireAdmin(principal: AuthenticatedPrincipal): boolean {
  return principal.role === 'owner' || principal.role === 'admin';
}

export function positiveIntFromPath(value: string | undefined): number | null {
  if (!value || !/^[1-9]\d*$/.test(value)) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) ? n : null;
}

export function getStringField(body: unknown, key: string): string | null {
  if (!body || typeof body !== 'object') return null;
  const value = (body as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : null;
}
```

These helpers reference five **types** that stay in `types.ts` and are defined
there:
- `packages/server/src/api/types.ts:34` — `export type ApiResponse<T = unknown> = {`
- `packages/server/src/api/types.ts:48` — `export type ApiDataBody<T> = {`
- `packages/server/src/api/types.ts:40` — `export type ApiErrorBody = {`
- `packages/server/src/api/types.ts:24` — `export type ApiRequest = {`
- `packages/server/src/api/types.ts:15` — `export type AuthenticatedPrincipal = {`

`grep -nE "^export (enum|class|const|let|var|default|\{)" packages/server/src/api/types.ts`
returns nothing, and `grep -nE "^export (const|function) " packages/server/src/api/types.ts`
returns only the seven functions above. So after removing them, `types.ts` has
zero runtime exports.

**Import convention in the route files.** Every route file already splits its
`type` imports from its value (helper) imports into two separate statements. The
value import from `'./types'` in each file lists **only** runtime helpers. This
is the load-bearing convention — the codemod relies on it. Exemplar,
`packages/server/src/api/auth-routes.ts:9-16`:

```ts
import type { ApiRequest, ApiResponse, ServerApiPorts } from './types';
import {
  data,
  error,
  getStringField,
  requireAdmin,
  requirePrincipal,
} from './types';
```

A second exemplar showing the two blocks are not adjacent,
`packages/server/src/api/settings-routes.ts:1-17` (line 1 opens
`import type {`, closes `} from './types';` at line 10; a separate value import
`import { data, error, requireAdmin, requirePrincipal } from './types';` spans
lines 12–17). The codemod must repoint **only** the value block, never the
`import type` block.

The api barrel, `packages/server/src/api/index.ts` (full file):

```ts
export * from './events';
export * from './fastify-adapter';
export * from './node-http-adapter';
export * from './openapi';
export * from './server-api';
export * from './types';
```

**Consumer surface (verified):** exactly 22 files, all under
`packages/server/src/api/`, import a runtime helper as a value from `'./types'`.
No file outside `packages/server/src/api/` imports these helpers by name (the
only hits elsewhere are in generated `packages/server/dist/**`, which is build
output and out of scope). Tests under `tests/unit/` reach these helpers only
transitively, by importing the package barrel `../../packages/server/src` and
exercising routes — none import the helper names directly.

## Commands you will need

CI uses **pnpm** (`.github/workflows/ci.yml`). There is **no** `typecheck`
script in this repo yet; type-check the server package by building it.

| Purpose            | Command                                                        | Expected on success |
|--------------------|----------------------------------------------------------------|---------------------|
| Install            | `pnpm install --frozen-lockfile`                               | exit 0              |
| Type-check + build | `pnpm run build`                                               | exit 0, no errors   |
| Type-check (server only, faster) | `npx tsc -b packages/server`                     | exit 0, no errors   |
| Tests              | `pnpm test` (targeted: `pnpm test -- <path>`)                  | all pass            |
| Lint               | `pnpm run lint`                                                | exit 0 (eslint, `--max-warnings 0`) |

Notes:
- `pnpm run build` runs `build:packages` (`tsc -b packages/core packages/server packages/desktop`) then the web and electron builds; it is the authoritative full type-check.
- `npx tsc -b packages/server` type-checks just this package and is fine for the per-step gate; run the full `pnpm run build` at the end.
- Do **not** substitute a different package manager. `npm`/`yarn` are not what CI uses.

## Scope

**In scope** — everything modified is under `packages/server/src/api/`:

- `packages/server/src/api/http.ts` — **create** (new home for the seven helpers).
- `packages/server/src/api/types.ts` — **edit**: delete the seven runtime functions (lines 4635–4677 to EOF), leaving it type-only. Do **not** touch any type declaration.
- `packages/server/src/api/index.ts` — **edit**: add `export * from './http';` so the barrel still exposes the helpers.
- The 22 value-import consumers — **edit**: repoint the runtime-helper value import from `'./types'` to `'./http'` (leave every `import type … from './types'` untouched):
  - `packages/server/src/api/auth-routes.ts`
  - `packages/server/src/api/auth-security-routes.ts`
  - `packages/server/src/api/automation-routes.ts`
  - `packages/server/src/api/core-crm-routes.ts`
  - `packages/server/src/api/customer-routes.ts`
  - `packages/server/src/api/dashboard-routes.ts`
  - `packages/server/src/api/diagnostics-routes.ts`
  - `packages/server/src/api/extended-crm-routes.ts`
  - `packages/server/src/api/follow-up-routes.ts`
  - `packages/server/src/api/lock-routes.ts`
  - `packages/server/src/api/mail-metadata-routes.ts`
  - `packages/server/src/api/mail-routes.ts`
  - `packages/server/src/api/maintenance-routes.ts`
  - `packages/server/src/api/notice-routes.ts`
  - `packages/server/src/api/pgp-routes.ts`
  - `packages/server/src/api/returns-routes.ts`
  - `packages/server/src/api/server-api.ts`
  - `packages/server/src/api/settings-routes.ts`
  - `packages/server/src/api/spam-routes.ts`
  - `packages/server/src/api/user-group-routes.ts`
  - `packages/server/src/api/workflow-routes.ts`
  - `packages/server/src/api/workflow-runtime-routes.ts`

**Out of scope** (do NOT touch, even though they look related):

- Any **type declaration** inside `types.ts` — this plan does not rename, move, or edit a single type. Only the seven runtime functions leave.
- `packages/server/dist/**` — generated build output; it regenerates on build.
- Any file outside `packages/server/src/api/` — no source outside this directory imports the helpers by name.
- Test files under `tests/` — they reach the helpers transitively via the barrel; no test import needs changing.
- The behavior/signature of any helper — this is a pure move. Do not "improve" a helper.

## Git workflow

- Branch: `advisor/019-split-api-types-runtime-helpers`
- Commit style: conventional commits (see `git log`, e.g. `fix(review): keep raw-headers / .eml export out of the mail read bucket`). Suggested messages:
  - `refactor(server): add api/http.ts with runtime helpers`
  - `refactor(server): repoint api route helper imports to api/http`
  - `refactor(server): make api/types.ts type-only`
- Commit per logical step (Steps 1–4 group naturally into the three commits above; Step 2 + Step 3 can be one commit since the codebase must not be broken between them).
- Do NOT push or open a PR.

## Steps

Order matters: create the new module first, repoint consumers, and only then
remove the old definitions — so the package compiles at every commit boundary.

### Step 1: Create `packages/server/src/api/http.ts`

Create the new file with the seven helpers moved **verbatim** from `types.ts`,
plus a type-only import for the five types they reference (which remain in
`types.ts`). Write exactly:

```ts
import type {
  ApiDataBody,
  ApiErrorBody,
  ApiRequest,
  ApiResponse,
  AuthenticatedPrincipal,
} from './types';

export function json<T>(status: number, body: T, headers?: Record<string, string>): ApiResponse<T> {
  return { status, body, headers };
}

export function data<T>(status: number, value: T): ApiResponse<ApiDataBody<T>> {
  return json(status, { data: value });
}

export function error(
  status: number,
  code: string,
  message: string,
  details?: unknown,
): ApiResponse<ApiErrorBody> {
  return json(status, {
    error: {
      code,
      message,
      ...(details === undefined ? {} : { details }),
    },
  });
}

export function requirePrincipal(req: ApiRequest): AuthenticatedPrincipal | ApiResponse<ApiErrorBody> {
  if (req.principal) return req.principal;
  return error(401, 'unauthorized', 'Authentifizierung erforderlich');
}

export function requireAdmin(principal: AuthenticatedPrincipal): boolean {
  return principal.role === 'owner' || principal.role === 'admin';
}

export function positiveIntFromPath(value: string | undefined): number | null {
  if (!value || !/^[1-9]\d*$/.test(value)) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) ? n : null;
}

export function getStringField(body: unknown, key: string): string | null {
  if (!body || typeof body !== 'object') return null;
  const value = (body as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : null;
}
```

At this point the helpers exist in **two** places (still in `types.ts`, now also
in `http.ts`). That is fine and intentional — `types.ts` is cleaned in Step 4.

**Verify**: `npx tsc -b packages/server` → exit 0, no errors. (There is no
duplicate-export conflict because the two modules are different files; nothing
imports `http.ts` yet.)

### Step 2: Re-export the helpers from the api barrel

Add `./http` to `packages/server/src/api/index.ts` so the package barrel keeps
exposing the helpers (belt-and-suspenders for any external consumer; the
in-repo tests rely on the barrel). Insert one line so the file reads:

```ts
export * from './events';
export * from './fastify-adapter';
export * from './http';
export * from './node-http-adapter';
export * from './openapi';
export * from './server-api';
export * from './types';
```

Note: after Step 4 removes the helpers from `types.ts`, there is no duplicate
export between `./http` and `./types`. If you build **before** Step 4, `tsc`
may report a duplicate re-export from the barrel (both `./http` and `./types`
export `data`, etc.). That is expected in the intermediate state — it resolves
in Step 4. If you want a clean build between commits, do Steps 2–4 as one unit
before running the full build gate.

**Verify** (structural, not a build): `grep -n "export \* from './http';" packages/server/src/api/index.ts` → one match.

### Step 3: Repoint the 22 value imports from `'./types'` to `'./http'`

In each of the 22 files listed in Scope, change **only** the value import block
(the `import { … } from './types';` that lists runtime helpers) so its source is
`'./http'`. Leave every `import type { … } from './types';` exactly as-is.

Preferred: run this codemod from the repo root. It rewrites only value imports
(the regex `import\s+\{ … \}` does not match `import type {`), and `[^}]*`
cannot cross into another import, so the `import type` blocks are never touched:

```bash
python3 - <<'PY'
import re, glob
changed = 0
for f in glob.glob('packages/server/src/api/*.ts'):
    src = open(f).read()
    new, n = re.subn(r"(import\s+\{[^}]*\})\s*from\s*'\./types'", r"\1 from './http'", src)
    if n:
        open(f, 'w').write(new)
        changed += n
        print(f"{f}: rewrote {n} value import(s)")
print(f"TOTAL value imports rewritten: {changed}")
PY
```

Expected console output: `TOTAL value imports rewritten: 22` (one per file, 22
files). If the count is not exactly 22, STOP — the codebase drifted from the
convention this plan assumes.

Manual fallback (if you cannot run Python): open each of the 22 files, find the
value import `import { …helpers… } from './types';`, and change its trailing
`from './types';` to `from './http';`. Do not merge it with the `import type`
block; keep the two statements separate (matches the `auth-routes.ts` exemplar).

**Verify**:
- `git grep -n "} from './http'" packages/server/src/api/` → 22 matching value-import lines.
- `git grep -c "from './types'" packages/server/src/api/ | wc -l` should still show many files (the `import type … from './types'` lines remain).
- Confirm no `import type` line was rerouted: `git grep -n "import type {" packages/server/src/api/ | grep "from './http'"` → **no output**.

### Step 4: Delete the seven runtime functions from `types.ts`

Remove lines 4635–4677 (the seven `export function` definitions, i.e. the entire
tail shown in "Current state") from `packages/server/src/api/types.ts`. The
function block is the last content in the file; after deletion the file ends at
the `};` that closes the `ServerApiPorts` type (currently line 4633). Leave a
single trailing newline. Do not delete or alter the `import type` lines at the
top of the file — the remaining type declarations still need them.

After this, `types.ts` has zero runtime exports and the helpers exist only in
`http.ts`.

**Verify**:
- `grep -nE "^export (const|function) " packages/server/src/api/types.ts` → **no output** (types.ts is type-only).
- `npx tsc -b packages/server` → exit 0, no errors.

### Step 5: Full verification

Run the full gates.

**Verify**:
- `pnpm run lint` → exit 0.
- `npx tsc -b packages/server` → exit 0.
- `pnpm run build` → exit 0.
- `pnpm test` → all pass.

## Test plan

This is a pure, mechanical move with no behavior change, so **no new tests are
required** — the existing suite is the safety net. It exercises the helpers
transitively: `tests/unit/` files import the package barrel
`../../packages/server/src` (which re-exports `./api` → `./http` and `./types`)
and drive routes that call `data`/`error`/`requirePrincipal`/
`positiveIntFromPath`/etc. Representative existing tests that will exercise the
moved helpers: `tests/unit/server-health-readiness.test.ts`,
`tests/unit/server-diagnostics-api.test.ts`, `tests/unit/server-user-groups-api.test.ts`.

- Verification: `pnpm test` → all pass (same count as before this change; no
  test file is added or modified).
- If you want a fast targeted signal before the full run, use
  `pnpm test -- tests/unit/server-health-readiness.test.ts` → pass.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `packages/server/src/api/http.ts` exists and exports exactly the seven helpers (`json`, `data`, `error`, `requirePrincipal`, `requireAdmin`, `positiveIntFromPath`, `getStringField`).
- [ ] `grep -nE "^export (const|function) " packages/server/src/api/types.ts` returns no matches (types.ts is type-only).
- [ ] `git grep -n "} from './http'" packages/server/src/api/` shows 22 value-import lines; every one of the 22 files listed in Scope is present.
- [ ] `packages/server/src/api/index.ts` contains `export * from './http';`.
- [ ] `npx tsc -b packages/server` exits 0.
- [ ] `pnpm run build` exits 0.
- [ ] `pnpm test` exits 0 (same set of tests passes as before; none added/removed).
- [ ] `pnpm run lint` exits 0.
- [ ] `git status` shows only files under `packages/server/src/api/` modified (plus `plans/README.md` for the status row) — nothing outside the in-scope list.
- [ ] `plans/README.md` status row for plan 019 updated.

## STOP conditions

Stop and report back (do not improvise) if:

- The drift check shows files under `packages/server/src/api/` changed since `f24fb27` and the "Current state" excerpts (the 4635–4677 helper block, the `auth-routes.ts:9-16` import pattern, or the `index.ts` contents) no longer match the live code.
- The codemod in Step 3 rewrites a count **other than 22**, or any file's value import from `'./types'` turns out to contain a non-helper symbol (a type mixed into the value block). That would mean the "separate type/value import" convention no longer holds and a blind reroute would break the type import.
- Any verification command fails twice after a reasonable fix attempt.
- You find a source file **outside** `packages/server/src/api/` that imports one of the seven helpers by name from `'./types'` (recon found none; if one appears, the scope is wrong).
- Removing the functions from `types.ts` in Step 4 surfaces a runtime export you did not expect (i.e. `grep` finds an `export const`/`export function` you were not told about).

## Maintenance notes

For the owner of this code after the change lands:

- New route files should import runtime helpers from `./http` and types from
  `./types`. `http.ts` is now the canonical home for HTTP response/guard
  helpers; add future ones (e.g. a new `requireScope`) there, not to `types.ts`.
- `types.ts` is now type-only by construction. If you ever need to add a runtime
  value to the api layer, put it in `http.ts` (or a new sibling module), keeping
  `types.ts` free of runtime code so type-only consumers stay decoupled.
- The barrel `api/index.ts` re-exports both `./http` and `./types`, so external
  consumers importing helpers from `@simplecrm/server` are unaffected. If you
  ever want to force call sites onto `./http` directly, that is a separate,
  larger follow-up (not done here) — it would touch the barrel export surface.
- Reviewer focus for the PR: confirm the diff is a pure move — the seven helper
  bodies are byte-identical to their previous definitions, no type declaration
  in `types.ts` was edited, and no `import type … from './types'` line was
  rerouted to `./http`.
- Deferred out of scope: this plan does not split the type declarations
  themselves (still 4.6k LOC of types in `types.ts`). Breaking that file into
  domain-scoped type modules is a separate, larger effort.
