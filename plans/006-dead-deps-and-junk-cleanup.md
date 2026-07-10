# Plan 006: Remove dead dependencies and committed junk; fix a phantom server dependency

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in the `README.md` of the directory this plan lives in (`plans/README.md`)
> — unless a reviewer dispatched you and told you they maintain the index.
>
> **Drift check (run first)**:
> ```
> git diff --stat f24fb27..HEAD -- package.json packages/server/package.json vite.config.ts electron/sqlite-service.ts .gitignore pnpm-lock.yaml package-lock.json src/utils/supabase/client.ts middleware.ts.bak tmp_perl_write.txt tmp_test_write.txt
> ```
> If any in-scope file changed since this plan was written (commit `f24fb27`),
> compare the "Current state" excerpts below against the live code before
> proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: tech-debt
- **Planned at**: commit `f24fb27`, 2026-07-10

## Why this matters

The repo ships two production dependencies (`@supabase/supabase-js`, `knex`)
that nothing live imports — one is reachable only from a stray `.bak` file, the
other only from commented-out code. Five build/test-only tools
(`@eslint/js`, `@testing-library/dom`, `autoprefixer`, `eslint`,
`typescript-eslint`) are declared under `dependencies` instead of
`devDependencies`, so they get pulled into production installs. Separately,
`packages/server/src/email-oauth.ts` imports `google-auth-library` without the
`@simplecrm/server` package declaring it — it only resolves today by accident
via the root workspace hoist, and will break the moment the server package is
built or consumed in isolation. Finally, three junk files
(`middleware.ts.bak`, `tmp_perl_write.txt`, `tmp_test_write.txt`) are committed
at the repo root. Cleaning all of this shrinks the install, makes the
dependency manifest honest, removes a latent server-build failure, and stops
scratch files from being tracked. No runtime behavior changes.

## Current state

All excerpts below are verbatim at commit `f24fb27`. File paths are
repo-relative to `/home/user/SimpleCRMPublic`.

### 1. Dead dep `@supabase/supabase-js`

- `package.json:98` (under `dependencies`):
  ```json
      "@supabase/supabase-js": "^2.107.0",
  ```
- Its only importer is `src/utils/supabase/client.ts` (the entire file):
  ```ts
  import { createClient as createSupabaseClient } from '@supabase/supabase-js'

  export const createClient = () => {
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL!
    const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY!

    return createSupabaseClient(supabaseUrl, supabaseAnonKey)
  }
  ```
  `src/utils/supabase/` contains **only** this one file — deleting it removes
  the directory too. **Verified**: nothing in `electron/ src/ packages/ shared/`
  imports `@/utils/supabase/client` or `@supabase/supabase-js` except this file.
- The only other reference is the stray file `middleware.ts.bak` at repo root,
  which imports a module (`@/utils/supabase/middleware`) that **does not exist**
  in the repo — the `.bak` is already broken and dead:
  ```ts
  import { type NextRequest } from 'next/server'
  import { updateSession } from '@/utils/supabase/middleware'
  ...
  ```
- **Wrinkle (must handle)**: `vite.config.ts:120-128` lists
  `@supabase/postgrest-js` (a transitive package of `@supabase/supabase-js`) in
  `optimizeDeps.include`. Nothing in source imports `postgrest-js`; once
  `@supabase/supabase-js` is removed, that package leaves the dependency tree
  and this include line becomes a dangling reference that makes `pnpm run dev`
  fail to pre-bundle (`vite build` ignores `optimizeDeps`, so the build/CI stays
  green, but `dev` would break). It must be removed together with the dep.
  ```ts
    optimizeDeps: {
      include: [
        '@supabase/postgrest-js',
        '@xyflow/react',
        '@xyflow/system',
        '@monaco-editor/react',
      ],
      exclude: ['electron'],
    },
  ```

### 2. Dead dep `knex`

- `package.json:123` (under `dependencies`):
  ```json
      "knex": "^3.2.10",
  ```
- No live call site. Every reference in `electron/ src/ packages/ shared/` is
  commented-out, all in `electron/sqlite-service.ts` at these locations:
  - `102`: `// Optional: import Knex from 'knex';`
  - `117`: `// Optional: let knex: Knex.Knex;`
  - `352-357`:
    ```ts
        // Optional Knex initialization
        // knex = Knex({
        //   client: 'better-sqlite3',
        //   connection: { filename: dbPath },
        //   useNullAsDefault: true
        // });
    ```
  - `3331-3335`:
    ```ts
        // Optional Knex cleanup
        // if (knex) {
        //   await knex.destroy();
        //   console.log('Knex connection destroyed.');
        // }
    ```

### 3. Build/test tooling wrongly in `dependencies`

In `package.json`, under `dependencies`, these five belong in
`devDependencies` (they run only at lint / build / test time — `eslint` +
`@eslint/js` + `typescript-eslint` power `pnpm run lint` via `eslint.config.mjs`;
`autoprefixer` runs in `postcss.config.mjs` at build time; `@testing-library/dom`
is a test-only peer of the already-dev `@testing-library/react`):

| Package | Current line | Version spec |
|---|---|---|
| `@eslint/js` | `package.json:67` | `^10.0.1` |
| `@testing-library/dom` | `package.json:101` | `^10.4.1` |
| `autoprefixer` | `package.json:105` | `^10.5.0` |
| `eslint` | `package.json:118` | `^10.4.1` |
| `typescript-eslint` | `package.json:146` | `^8.60.1` |

The existing `devDependencies` block runs `package.json:152-186` and is kept in
alphabetical order (exemplar convention — e.g. `@electron/rebuild`,
`@playwright/test`, `@tailwindcss/vite`, ...). Match that ordering when
inserting. Note: `@testing-library/jest-dom`, `@testing-library/react`,
`@testing-library/user-event` are **already** in `devDependencies` — leave them.

### 4. Phantom dep `google-auth-library` in the server package

- `packages/server/src/email-oauth.ts:1`:
  ```ts
  import { OAuth2Client } from 'google-auth-library';
  ```
- `packages/server/package.json` does **not** declare `google-auth-library` in
  its `dependencies` (current deps run lines 11-27: `@fastify/websocket`,
  `@simplecrm/core`, `archiver`, `fastify`, `graphile-worker`, `imapflow`,
  `kysely`, ...). It resolves today only via the root hoist.
- The root `package.json:119` declares `"google-auth-library": "^10.7.0"`. Use
  that exact spec (`^10.7.0`) for the server package. In alphabetical order it
  sorts **before** `graphile-worker` and after `fastify`.

### 5. Committed junk at repo root

All three are git-tracked (`git ls-files` confirms):
- `middleware.ts.bak` — broken Next.js middleware stub (see §1).
- `tmp_perl_write.txt` — 2-byte scratch file.
- `tmp_test_write.txt` — 5-byte scratch file.

`.gitignore` currently has **no** `*.bak` or `tmp_*` rule (verified). Its debug
section runs:
```
# debug
npm-debug.log*
yarn-debug.log*
yarn-error.log*
.pnpm-debug.log*

# env files
```

### Lockfiles — read before editing manifests

This repo tracks **two** lockfiles and both must stay in sync with `package.json`:
- `pnpm-lock.yaml` — CI enforces it: `.github/workflows/ci.yml` runs
  `pnpm install --frozen-lockfile`, which **fails** if the lockfile does not
  match the manifests.
- `package-lock.json` — kept for an npm/Docker `npm ci` path (see the comment in
  `pnpm-workspace.yaml`: "npm's Docker `npm ci` ... resolves them as local
  workspace links"). `npm ci` also fails if `package-lock.json` is out of sync.

Any change to `package.json` or `packages/server/package.json` therefore
requires regenerating **both** lockfiles. (The `packages/server` importer is
already present in `pnpm-lock.yaml` at line ~388; `google-auth-library@10.7.0`
already appears in the lockfile from the root dep, so adding it to the server
package is a minimal lockfile delta.)

## Commands you will need

CI uses pnpm (`.github/workflows/ci.yml`), Node 24.

| Purpose | Command | Expected on success |
|---|---|---|
| Regenerate pnpm lockfile | `pnpm install --lockfile-only` | exit 0; updates `pnpm-lock.yaml` only, no scripts |
| Regenerate npm lockfile | `npm install --package-lock-only --ignore-scripts` | exit 0; updates `package-lock.json` only |
| Verify pnpm lock in sync (CI gate) | `pnpm install --frozen-lockfile --ignore-scripts` | exit 0 (no "lockfile ... not up to date" error) |
| Lint | `pnpm run lint` | exit 0 (eslint, `--max-warnings 0`) |
| Tests | `pnpm test` | all pass |
| Build | `pnpm run build` | exit 0 |

There is no `typecheck` script in this repo; `pnpm run build` (which runs `tsc`)
is the type-check gate. Do not invent one.

## Scope

**In scope** (the only files you may modify or delete):
- `package.json` — remove 2 dead deps, move 5 tooling deps to `devDependencies`
- `packages/server/package.json` — add `google-auth-library`
- `vite.config.ts` — remove the orphaned `@supabase/postgrest-js` include line
- `electron/sqlite-service.ts` — remove 4 commented knex blocks
- `.gitignore` — add `*.bak` and `tmp_*`
- `pnpm-lock.yaml` — regenerated (do not hand-edit)
- `package-lock.json` — regenerated (do not hand-edit)
- `src/utils/supabase/client.ts` — **delete** (removes the now-empty `src/utils/supabase/` dir)
- `middleware.ts.bak` — **delete**
- `tmp_perl_write.txt` — **delete**
- `tmp_test_write.txt` — **delete**

**Out of scope** (do NOT touch):
- Any other entry in `package.json` `dependencies`/`devDependencies` — only the
  named packages move or leave.
- `electron/email/email-oauth-google.ts` — it also imports `google-auth-library`
  but is covered by the root `package.json` dep; leave it.
- Any actual code logic in `electron/sqlite-service.ts` — only the commented
  knex lines are removed; do not touch `initializeDatabase`, `runMigrations`, or
  the db-close logic.
- The other `optimizeDeps.include` entries in `vite.config.ts`
  (`@xyflow/react`, `@xyflow/system`, `@monaco-editor/react`) — keep them.
- `packages/svelte-lab/` and its lockfile — unrelated.

## Git workflow

- Branch: `advisor/006-dead-deps-and-junk-cleanup` (create from `main`).
- Commit per logical unit; conventional-commit style (repo convention — e.g.
  git log shows `fix(review): keep raw-headers / .eml export out of the mail
  read bucket`). Suggested commits:
  - `chore(deps): drop dead @supabase/supabase-js and knex dependencies`
  - `chore(deps): move build/test tooling to devDependencies`
  - `fix(server): declare google-auth-library dependency`
  - `chore(repo): remove committed scratch files; ignore *.bak and tmp_*`
  - `chore(deps): regenerate lockfiles`
  (Grouping is flexible; keep the lockfile regen as its own or the final commit.)
- Do NOT push or open a PR.

## Steps

### Step 1: Create the branch

```
git checkout main
git checkout -b advisor/006-dead-deps-and-junk-cleanup
```

**Verify**: `git branch --show-current` → `advisor/006-dead-deps-and-junk-cleanup`

### Step 2: Remove the `@supabase/supabase-js` dependency and its dead code

1. Delete the source file and the stray `.bak` (use `git rm` so they are staged
   as deletions):
   ```
   git rm src/utils/supabase/client.ts middleware.ts.bak
   ```
2. In `package.json`, delete the line (`package.json:98`):
   ```json
       "@supabase/supabase-js": "^2.107.0",
   ```
3. In `vite.config.ts`, remove the orphaned transitive include. Change:
   ```ts
      include: [
        '@supabase/postgrest-js',
        '@xyflow/react',
   ```
   to:
   ```ts
      include: [
        '@xyflow/react',
   ```

**Verify**:
```
ls src/utils/supabase 2>&1        # → "No such file or directory"
grep -rn "supabase" electron src packages shared vite.config.ts   # → no matches
```

### Step 3: Remove the `knex` dependency and its commented code

1. In `package.json`, delete the line (`package.json:123`):
   ```json
       "knex": "^3.2.10",
   ```
2. In `electron/sqlite-service.ts`, remove all four commented knex blocks.
   Apply these exact edits (match whitespace precisely):

   **Edit A** — delete the import comment. Replace:
   ```ts
   import { Product, DealProduct } from './types';
   // Optional: import Knex from 'knex';

   function getDatabasePath(): string {
   ```
   with:
   ```ts
   import { Product, DealProduct } from './types';

   function getDatabasePath(): string {
   ```

   **Edit B** — delete the variable comment. Replace:
   ```ts
   let db: Database.Database | undefined;
   // Optional: let knex: Knex.Knex;
   const isDevelopment = process.env.NODE_ENV === 'development';
   ```
   with:
   ```ts
   let db: Database.Database | undefined;
   const isDevelopment = process.env.NODE_ENV === 'development';
   ```

   **Edit C** — delete the init block. Replace:
   ```ts
           // Run migrations for schema updates
           runMigrations();
       }

       // Optional Knex initialization
       // knex = Knex({
       //   client: 'better-sqlite3',
       //   connection: { filename: dbPath },
       //   useNullAsDefault: true
       // });

       console.log(`Database connection established: ${dbPath}`);
   ```
   with:
   ```ts
           // Run migrations for schema updates
           runMigrations();
       }

       console.log(`Database connection established: ${dbPath}`);
   ```

   **Edit D** — delete the cleanup block. Replace:
   ```ts
               db = undefined;
           }
       }
       initializeDatabase();
       // Optional Knex cleanup
       // if (knex) {
       //   await knex.destroy();
       //   console.log('Knex connection destroyed.');
       // }
   }
   ```
   with:
   ```ts
               db = undefined;
           }
       }
       initializeDatabase();
   }
   ```

**Verify**:
```
grep -rin "knex" electron src packages shared package.json   # → no matches
```

### Step 4: Move the five build/test tools to `devDependencies`

In `package.json`, delete each of these five lines from the `dependencies`
block:
```json
    "@eslint/js": "^10.0.1",
    "@testing-library/dom": "^10.4.1",
    "autoprefixer": "^10.5.0",
    "eslint": "^10.4.1",
    "typescript-eslint": "^8.60.1",
```
and insert them into the `devDependencies` block in alphabetical position:
- `"@eslint/js": "^10.0.1",` — after `"@electron/rebuild": "^4.0.4",`
- `"@testing-library/dom": "^10.4.1",` — before `"@testing-library/jest-dom": "^6.9.1",`
- `"autoprefixer": "^10.5.0",` — before `"concurrently": "^10.0.3",`
- `"eslint": "^10.4.1",` — after `"electron-builder": "^26.15.0",` (before `"jest": "^30.3.0",`)
- `"typescript-eslint": "^8.60.1",` — after `"ts-node": "^10.9.2",` (before `"typescript": "^5.9.3",`)

Keep each `dependencies` and `devDependencies` list valid JSON (no trailing
comma on the last entry, comma-separated otherwise).

**Verify**:
```
node -e "const p=require('./package.json'); const dev=['@eslint/js','@testing-library/dom','autoprefixer','eslint','typescript-eslint']; const badProd=dev.filter(d=>p.dependencies[d]); const missDev=dev.filter(d=>!p.devDependencies[d]); if(badProd.length||missDev.length){console.error('FAIL',{badProd,missDev});process.exit(1)} console.log('OK')"
```
→ prints `OK` (each of the five is in `devDependencies` and none in `dependencies`).

### Step 5: Declare `google-auth-library` in the server package

In `packages/server/package.json`, add to `dependencies` (alphabetical — after
`"fastify": "^5.8.5",`, before `"graphile-worker": "^0.16.6",`):
```json
    "google-auth-library": "^10.7.0",
```

**Verify**:
```
node -e "console.log(require('./packages/server/package.json').dependencies['google-auth-library'])"
```
→ prints `^10.7.0`

### Step 6: Remove tmp junk and ignore future scratch files

1. Remove the two tmp files:
   ```
   git rm tmp_perl_write.txt tmp_test_write.txt
   ```
   (`middleware.ts.bak` was already removed in Step 2.)
2. In `.gitignore`, add a scratch-junk block. Replace:
   ```
   .pnpm-debug.log*

   # env files
   ```
   with:
   ```
   .pnpm-debug.log*

   # scratch / backup junk (never commit)
   *.bak
   tmp_*

   # env files
   ```

**Verify**:
```
ls middleware.ts.bak tmp_perl_write.txt tmp_test_write.txt 2>&1   # → all "No such file or directory"
grep -n "^\*.bak$" .gitignore && grep -n "^tmp_\*$" .gitignore    # → both match
```

### Step 7: Regenerate both lockfiles

```
pnpm install --lockfile-only
npm install --package-lock-only --ignore-scripts
```

**Verify**:
```
pnpm install --frozen-lockfile --ignore-scripts   # → exit 0, no "lockfile is not up to date" error
grep -c "supabase\|\"knex@" pnpm-lock.yaml || true   # informational: supabase/knex entries should be gone
```
If `pnpm install --frozen-lockfile --ignore-scripts` errors that the lockfile is
out of date, re-run `pnpm install --lockfile-only` and retry once. If it still
fails, STOP (see STOP conditions).

### Step 8: Full verification

Run the repo's CI-equivalent gates:
```
pnpm run lint
pnpm test
pnpm run build
```
All three must exit 0.

**Verify**: each command exits 0. If `pnpm test` reports pre-existing unrelated
failures, confirm they also fail on `main` (a change this plan makes cannot
affect test behavior — it only removes dead deps/comments/junk); if a failure is
plausibly caused by this change, STOP.

## Test plan

No new tests — this plan removes dead code and corrects manifests; there is no
new runtime behavior to cover. Regression protection is the existing suite plus
the lockfile-sync gate:

- `pnpm run lint` → exit 0 (proves `eslint`/`typescript-eslint` still resolve
  after moving to `devDependencies`).
- `pnpm test` → all pass, unchanged from `main`.
- `pnpm run build` → exit 0 (proves `tsc` + `vite build` still work without the
  removed deps and without the `@supabase/postgrest-js` include; also compiles
  `packages/server` with the newly declared `google-auth-library`).
- `pnpm install --frozen-lockfile --ignore-scripts` → exit 0 (proves the pnpm
  lockfile matches the edited manifests — the exact check CI runs).

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `pnpm run lint` exits 0
- [ ] `pnpm test` exits 0 (no new failures vs `main`)
- [ ] `pnpm run build` exits 0
- [ ] `pnpm install --frozen-lockfile --ignore-scripts` exits 0
- [ ] `grep -rin "supabase\|knex" electron src packages shared vite.config.ts` returns no matches
- [ ] `@supabase/supabase-js` and `knex` are absent from `package.json` (`node -e "const p=require('./package.json');process.exit(p.dependencies['@supabase/supabase-js']||p.dependencies['knex']?1:0)"` exits 0)
- [ ] `@eslint/js`, `@testing-library/dom`, `autoprefixer`, `eslint`, `typescript-eslint` are each in `package.json` `devDependencies` and none in `dependencies` (Step 4 verify prints `OK`)
- [ ] `packages/server/package.json` `dependencies` includes `"google-auth-library": "^10.7.0"`
- [ ] `middleware.ts.bak`, `tmp_perl_write.txt`, `tmp_test_write.txt`, and `src/utils/supabase/client.ts` no longer exist
- [ ] `.gitignore` contains `*.bak` and `tmp_*`
- [ ] Only in-scope files are modified/deleted (`git status` shows nothing outside the Scope list)
- [ ] `plans/README.md` status row for plan 006 updated

## STOP conditions

Stop and report back (do not improvise) if:

- The code at any location in "Current state" does not match the excerpts (the
  codebase drifted since `f24fb27` — the drift-check diff is non-empty for a
  file whose excerpt you can no longer find).
- A grep intended to find "no live references" of `supabase`/`knex` returns a
  **live** (non-commented, non-lockfile) reference in `electron/ src/ packages/
  shared/` — that means the dep is not actually dead; do not remove it.
- `pnpm install --frozen-lockfile --ignore-scripts` still fails after one
  re-regeneration, or `npm install --package-lock-only` cannot resolve
  `google-auth-library@^10.7.0` (network/registry issue).
- `pnpm run build`, `pnpm run lint`, or `pnpm test` fails in a way plausibly
  caused by this change (e.g. an unresolved-module error naming one of the
  moved/removed packages), and the same command passes on `main`.
- Removing a step would require editing a file outside the Scope list.

## Maintenance notes

For the human/agent who owns this after the change lands:

- **Reviewer focus**: confirm `git status` touches only the in-scope files;
  confirm both lockfiles (`pnpm-lock.yaml` and `package-lock.json`) are
  regenerated, not hand-edited, and that CI's `pnpm install --frozen-lockfile`
  passes. Sanity-check that no production code path imported `@supabase/*` or
  `knex` (the removal rests on that being true at `f24fb27`).
- **Latent design note**: if Supabase or Knex are re-introduced later, add them
  back as real deps with real call sites — do not resurrect
  `src/utils/supabase/client.ts` or the commented knex blocks; they were
  scaffolding that never shipped.
- **Deferred, intentionally out of scope**: this plan does not attempt to
  reconcile the dual-lockfile setup (both `pnpm-lock.yaml` and
  `package-lock.json` are tracked). That is a pre-existing repo decision (npm
  `npm ci` Docker path per `pnpm-workspace.yaml`); collapsing to a single
  package manager is a separate, larger change.
- **Follow-on**: `google-auth-library` is now declared in two places (root
  `package.json` for the Electron app, `packages/server/package.json` for the
  server). Keep the version specs aligned when bumping.
