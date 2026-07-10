# Plan 018: Lazy-load the 6.6k-line HTTP route registry so desktop never bundles it

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in the `README.md` of the directory this plan lives in (`plans/README.md`)
> — unless a reviewer dispatched you and told you they maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat f24fb27..HEAD -- src/services/transport/renderer-transport.ts src/services/transport/index.ts tests/unit/renderer-transport.test.ts`
> If any of those files changed since this plan was written, compare the
> "Current state" excerpts below against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P3
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: perf
- **Planned at**: commit `f24fb27`, 2026-07-10

## Why this matters

`src/services/transport/renderer-transport.ts` statically imports
`buildHttpInvocation` from `channel-http-registry.ts` — a **6,662-line** module
that builds one eager `routeBuilders` Map at module load and drags in a long
list of `@shared/*` dependencies. That registry is only ever needed by the
**HTTP** transport (the server-client edition). The desktop/Electron edition
uses `createIpcRendererTransport` and never calls `buildHttpInvocation`, yet
because the import is static and the symbol is genuinely called, the whole
registry ships in the Electron renderer's entry bundle for every desktop user.

Converting the registry to a **dynamic `import()`** — loaded once, the first
time the HTTP transport actually invokes — moves those 6.6k lines into their
own async chunk that the desktop edition never fetches. The IPC path stays
completely free of it, the renderer's entry bundle shrinks, and the HTTP path
pays only a one-time module-load on its first request. (Tree-shaking behavior
here is bundler-dependent, so this plan makes the split **deterministic** by
also removing the registry from the transport barrel's static re-exports, and
**verifies** the outcome against a real build.)

## Current state

Files involved (each with its role):

- `src/services/transport/renderer-transport.ts` — the renderer transport
  factory. Exposes `createIpcRendererTransport` (desktop) and
  `createHttpRendererTransport` (server-client). The **only** call site of
  `buildHttpInvocation` lives inside the HTTP factory's `invoke` closure.
- `src/services/transport/channel-http-registry.ts` — the 6,662-line HTTP route
  registry (do **not** edit its logic; it stays exactly as-is and only becomes
  dynamically imported).
- `src/services/transport/index.ts` — the transport barrel; today it statically
  re-exports `buildHttpInvocation` / `hasHttpInvocation` from the registry,
  which is a second static edge into the registry.
- `tests/unit/renderer-transport.test.ts` — the transport unit suite (130
  tests). Imports `hasHttpInvocation` via the barrel and exercises the HTTP
  invoke path extensively.

Real excerpts as they exist at `f24fb27`:

`src/services/transport/renderer-transport.ts:3` (the static import to convert):

```ts
import { buildHttpInvocation, type HttpRequestSpec } from "./channel-http-registry"
```

`src/services/transport/renderer-transport.ts:259` and `:328-329` — the HTTP
factory's `invoke` is already `async`, and `buildHttpInvocation` is called once
per invocation inside it:

```ts
  const invoke = async (channel: InvokeChannel, ...args: any[]): Promise<any> => {
    // ... (fetchHttp / fetchJson defined above) ...
    const spec = buildHttpInvocation(channel, args)
    const { body, response } = await fetchHttp(spec)

    return spec.transform ? await spec.transform(body, { fetchJson, response }) : unwrapData(body)
  }
```

`HttpRequestSpec` is used **only as a type** in this file (parameter
annotations at `renderer-transport.ts:268` and `:324`), so it can move to a
type-only import.

`src/services/transport/channel-http-registry.ts` — the eager Map and the two
public functions (unchanged by this plan):

```ts
// line 861
const routeBuilders = new Map<InvokeChannel, RouteBuilder>([
  // ... ~3,300 lines of route builders ...
])   // line 4161

// line 4163
export function buildHttpInvocation(channel: InvokeChannel, args: unknown[]): HttpInvocationSpec {
  const builder = routeBuilders.get(channel)
  if (!builder) {
    throw new Error(`No HTTP transport mapping registered for IPC channel ${channel}`)
  }
  return builder(args)
}

// line 4171
export function hasHttpInvocation(channel: InvokeChannel): boolean {
  return routeBuilders.has(channel)
}
```

The string `No HTTP transport mapping registered for IPC channel` is unique to
this registry function — used later as a build-output marker.

`src/services/transport/index.ts:21-26` — the barrel's static value re-export of
the registry (the second static edge to remove):

```ts
export {
  buildHttpInvocation,
  hasHttpInvocation,
  type HttpInvocationSpec,
  type HttpMethod,
} from "./channel-http-registry"
```

`tests/unit/renderer-transport.test.ts` — imports `hasHttpInvocation` from the
barrel (inside the big `from '@/services/transport'` block, at line 8) and uses
it once, at line 8135:

```ts
    const missing = AllowedInvokeChannels
      .filter((channel) => !hasHttpInvocation(channel))
      .filter((channel) => !intentionallyUnsupported.has(channel));
```

### Facts established by recon (so you don't re-derive them)

- `buildHttpInvocation` and `hasHttpInvocation` are re-exported by the barrel
  but **no application (non-test) code imports either** — a repo-wide grep
  across `src/`, `tests/`, and `packages/` finds them only in
  `channel-http-registry.ts` (definitions), `index.ts` (re-exports),
  `renderer-transport.ts` (the one call), and `renderer-transport.test.ts`
  (`hasHttpInvocation` only). So dropping the two **value** re-exports from the
  barrel is safe; only the test import must be repointed.
- The barrel's `HttpInvocationSpec` / `HttpMethod` types have **no** consumers
  outside `index.ts`/`channel-http-registry.ts`, but keep re-exporting them (as
  types) to preserve the barrel's type surface. (The `HttpMethod`/
  `HttpInvocationSpec` grep hits in `packages/server` are unrelated local types
  named `WorkflowHttpMethod` / `WebhookHttpMethod`, not this barrel.)
- After the change, the **only** runtime edge into `channel-http-registry.ts`
  is the dynamic `import()` in `renderer-transport.ts`. Dynamic imports are
  Rollup split points, so the registry becomes its own async chunk. (There is
  no `sideEffects` field in `package.json`, so leaving a *static* re-export in
  the barrel could pin the registry into the entry chunk — this is why Step 2
  is required, not optional.)
- Conventions to match: this repo uses double-quoted, semicolon-free TS in
  `src/services/transport/*.ts` (see `renderer-transport.ts`) — match that
  style in the files you edit there. `tsconfig.json` sets `module: "esnext"`,
  `moduleResolution: "bundler"`, `isolatedModules: true` — dynamic `import()`
  and `import type` are fully supported, and type-only imports/exports **must**
  be marked (`import type` / `export type`) under `isolatedModules`.
- Under Jest, `ts-jest` transpiles the source to CommonJS and lowers
  `import("./channel-http-registry")` to a `require`-backed promise, so the
  awaited dynamic import resolves synchronously-enough for the existing
  HTTP-path tests — no Jest ESM config change is needed.

## Commands you will need

| Purpose   | Command                                              | Expected on success |
|-----------|------------------------------------------------------|---------------------|
| Install   | `pnpm install --frozen-lockfile`                     | exit 0              |
| Typecheck | `npx tsc -p tsconfig.json --noEmit`                  | exit 0, no errors   |
| Tests (targeted) | `pnpm test -- tests/unit/renderer-transport.test.ts` | all pass       |
| Tests (full) | `pnpm test`                                       | all pass            |
| Lint      | `pnpm run lint`                                      | exit 0 (eslint, `--max-warnings 0`) |
| Build (renderer, focused) | `npx vite build`                     | exit 0, writes `dist/` |
| Build (full gate) | `pnpm run build`                             | exit 0              |

Notes: there is **no** `typecheck` script yet, so use the raw `npx tsc`
command above. `pnpm run build` runs `build:packages && build:web (tsc && vite
build) && build:electron:main`; for iterating on the chunk-split check, the
faster `npx vite build` produces the same `dist/` renderer output.

## Scope

**In scope** (the only files you should modify):

- `src/services/transport/renderer-transport.ts`
- `src/services/transport/index.ts`
- `tests/unit/renderer-transport.test.ts`

**Out of scope** (do NOT touch, even though they look related):

- `src/services/transport/channel-http-registry.ts` — its logic and the
  `routeBuilders` Map stay exactly as-is; this plan only changes *how* it is
  imported, never *what* it contains. Do not split, reorder, or "optimize" it.
- `vite.config.ts` — no `manualChunks` config is needed; a dynamic import is
  already a natural split point. Adding chunk config is out of scope.
- Any other consumer of `@/services/transport` — the IPC path, event filters,
  auth client, etc. are untouched.

## Git workflow

- Branch: `advisor/018-lazy-load-http-registry` (create from `main` at
  `f24fb27`).
- Commit conventional messages (repo style — see `git log`, e.g. `fix(review):
  keep raw-headers / .eml export out of the mail read bucket`). Suggested:
  `perf(transport): lazy-load channel-http-registry off the desktop bundle`.
- Do **not** push or open a PR unless the operator explicitly instructed it.

## Steps

### Step 1: Convert the registry import in `renderer-transport.ts` to a lazy dynamic import

In `src/services/transport/renderer-transport.ts`:

1. Replace the static import at line 3

   ```ts
   import { buildHttpInvocation, type HttpRequestSpec } from "./channel-http-registry"
   ```

   with a **type-only** import (erased at compile time — no runtime edge):

   ```ts
   import type { HttpRequestSpec } from "./channel-http-registry"
   ```

2. Add a module-scope lazy loader (top level — e.g. immediately after the
   `delay` helper around line 27). The module-level promise cache guarantees
   the registry is imported at most once and reused on every later HTTP call:

   ```ts
   /**
    * The HTTP route registry (`channel-http-registry`, ~6.6k LOC) is only needed
    * by the HTTP transport. The desktop/Electron edition uses the IPC transport
    * and never touches it, so we load the registry lazily via dynamic import() —
    * this keeps it out of the renderer's entry bundle as its own async chunk,
    * fetched once on the first HTTP invocation. See plans/018.
    */
   type ChannelHttpRegistryModule = typeof import("./channel-http-registry")
   let channelHttpRegistryPromise: Promise<ChannelHttpRegistryModule> | null = null
   function loadChannelHttpRegistry(): Promise<ChannelHttpRegistryModule> {
     if (!channelHttpRegistryPromise) {
       channelHttpRegistryPromise = import("./channel-http-registry")
     }
     return channelHttpRegistryPromise
   }
   ```

3. At the call site inside the HTTP factory's `invoke` closure (lines 328-329),
   `await` the loader before building the spec. `invoke` is already `async`, so
   `await` is legal here:

   ```ts
       const { buildHttpInvocation } = await loadChannelHttpRegistry()
       const spec = buildHttpInvocation(channel, args)
       const { body, response } = await fetchHttp(spec)
   ```

Do not change anything else in this file (the `HttpRequestSpec` annotations at
`:268` and `:324` keep working via the type-only import).

**Verify**: `npx tsc -p tsconfig.json --noEmit` → exit 0, no errors. Then
`git grep -n "buildHttpInvocation" src/services/transport/renderer-transport.ts`
→ the only matches are inside `loadChannelHttpRegistry`'s destructure/comment
context and the call site; there is **no** top-level `import { buildHttpInvocation }`.

### Step 2: Remove the registry's static value re-exports from the barrel

In `src/services/transport/index.ts`, replace the re-export block at lines 21-26

```ts
export {
  buildHttpInvocation,
  hasHttpInvocation,
  type HttpInvocationSpec,
  type HttpMethod,
} from "./channel-http-registry"
```

with a **type-only** re-export (drops the two runtime value re-exports so the
barrel no longer creates a static edge into the registry; keeps the type
surface intact):

```ts
export type {
  HttpInvocationSpec,
  HttpMethod,
} from "./channel-http-registry"
```

**Verify**: `npx tsc -p tsconfig.json --noEmit` → exit 0. Then
`git grep -n "buildHttpInvocation\|hasHttpInvocation" src/services/transport/index.ts`
→ **no matches** (neither symbol is re-exported by the barrel anymore).

### Step 3: Repoint the one test that imported `hasHttpInvocation` from the barrel

`tests/unit/renderer-transport.test.ts` imports `hasHttpInvocation` from
`@/services/transport` (line 8, inside the block that ends `} from
'@/services/transport';`). Since Step 2 removed it from the barrel:

1. Delete the `  hasHttpInvocation,` line from the `from '@/services/transport'`
   import block.
2. Add a dedicated import from the registry module directly, e.g. right after
   that block:

   ```ts
   import { hasHttpInvocation } from '@/services/transport/channel-http-registry';
   ```

   (Match the test file's existing single-quote + semicolon style.)

Nothing else in the test changes; the usage at line 8135 stays as-is.

**Verify**: `pnpm test -- tests/unit/renderer-transport.test.ts` → all tests
pass (including the "every allowed channel has an HTTP mapping" test at ~line
8135 and every HTTP-invoke test, which now transparently `await` the dynamic
registry load).

### Step 4: Confirm the registry lands in its own chunk and is out of the entry bundle

Build the renderer and inspect the output. The registry code (identified by its
unique marker string) must live in exactly one chunk, and that chunk must not
be the entry bundle.

```bash
npx vite build   # or: pnpm run build   (writes dist/)

# (a) The registry marker appears in exactly ONE js chunk:
grep -rl "No HTTP transport mapping registered for IPC channel" dist/assets/*.js
#   → exactly one path, whose basename should look like
#     channel-http-registry-<hash>.js  (vite names async chunks after the module)

# (b) The entry bundle (the <script type=module src=...> in dist/index.html)
#     must NOT contain the registry:
ENTRY=$(grep -oE 'assets/[^"]+\.js' dist/index.html | head -1)
echo "entry chunk: $ENTRY"
grep -c "No HTTP transport mapping registered for IPC channel" "dist/$ENTRY"
#   → 0
```

**Verify**: check (a) prints exactly one file path (a dedicated async chunk),
and check (b) prints `0` (the registry is absent from the entry bundle). If
`grep -c` errors because the marker file *is* the entry, that is a failure —
the split did not happen; go to STOP conditions.

### Step 5: Full verification gate

Run the repo's full checks:

```bash
pnpm run lint            # → exit 0
pnpm test                # → all pass
npx tsc -p tsconfig.json --noEmit   # → exit 0
pnpm run build           # → exit 0 (full: packages + web + electron main)
```

**Verify**: all four commands exit 0 / all tests pass.

## Test plan

- **No new test file is required** — the existing `tests/unit/renderer-transport.test.ts`
  already exercises the HTTP invoke path end-to-end (mocked `fetchImpl`,
  `jsonResponse` helpers) and the channel-coverage check. After Step 1 every
  HTTP-invoke test implicitly asserts the awaited dynamic `import()` resolves
  and `buildHttpInvocation` still maps channels correctly; a green suite is the
  regression guard for the lazy-load.
- Structural pattern to follow if you *do* add a case: model any addition after
  the existing tests in `tests/unit/renderer-transport.test.ts` (e.g. "uses
  Electron IPC by default", "maps auth audit IPC calls to server HTTP routes").
- Optional (recommended) observability of the win: before editing, capture the
  baseline with `git stash && npx vite build` and note which chunk holds the
  marker (`grep -rl "No HTTP transport mapping registered for IPC channel"
  dist/assets/*.js`); it will be a large shared/entry chunk. Restore with `git
  stash pop`. After the change, Step 4 shows it in its own chunk. This is for
  your confidence only, not a required gate.
- Verification: `pnpm test -- tests/unit/renderer-transport.test.ts` → all pass
  (130 tests, no reduction), then `pnpm test` → all pass.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `npx tsc -p tsconfig.json --noEmit` exits 0.
- [ ] `pnpm run lint` exits 0.
- [ ] `pnpm test` exits 0; `tests/unit/renderer-transport.test.ts` passes with
      no reduction in test count.
- [ ] `pnpm run build` exits 0.
- [ ] `git grep -n "from \"./channel-http-registry\"" src/services/transport/renderer-transport.ts`
      shows only a **type-only** import (`import type { HttpRequestSpec }`); no
      static value import of `buildHttpInvocation` remains.
- [ ] `git grep -n "buildHttpInvocation\|hasHttpInvocation" src/services/transport/index.ts`
      returns no matches.
- [ ] After a build, `grep -rl "No HTTP transport mapping registered for IPC channel" dist/assets/*.js`
      returns exactly one chunk, and that string count in the entry chunk
      (`dist/index.html`'s module script) is `0`.
- [ ] No files outside the in-scope list are modified (`git status`).
- [ ] `plans/README.md` status row for plan 018 updated.

## STOP conditions

Stop and report back (do not improvise) if:

- The "Current state" excerpts don't match the live code — e.g. line 3 of
  `renderer-transport.ts` no longer imports `buildHttpInvocation`, the call
  site has moved out of an `async` function, or the `index.ts` re-export block
  differs (the codebase drifted since `f24fb27`).
- After Step 4, the registry marker is NOT in its own chunk — it appears in the
  entry bundle, or in more than one chunk, or Rollup warns that
  `channel-http-registry` is "dynamically imported ... but also statically
  imported." That means a static edge survived: re-check that Step 2 landed and
  that no other file statically imports the registry
  (`git grep -n "channel-http-registry" src`).
- A verification command fails twice after a reasonable fix attempt.
- Any fix appears to require editing `channel-http-registry.ts`,
  `vite.config.ts`, or any file outside the in-scope list.
- You discover a non-test consumer imports `buildHttpInvocation` or
  `hasHttpInvocation` from `@/services/transport` (contradicting the recon
  fact) — repointing it may be out of scope.

## Maintenance notes

For the human/agent who owns this after it lands:

- **What interacts with this**: any future *static* import of
  `channel-http-registry` (directly, or re-exported through
  `src/services/transport/index.ts`) will re-merge it into the entry bundle and
  silently undo this plan. If you must expose a registry symbol from the
  barrel, expose it as a `type` re-export only, or route the runtime access
  through the existing `loadChannelHttpRegistry()` dynamic loader.
- **First-invocation latency**: the HTTP transport now pays a one-time async
  module load on its first `invoke`. It is cached for the process lifetime via
  `channelHttpRegistryPromise`. If a future caller needs the registry ready
  before the first request (e.g. to pre-warm on server-client startup), call
  `loadChannelHttpRegistry()` (or the equivalent) during transport
  configuration rather than reverting to a static import.
- **What a reviewer should scrutinize**: (1) the call site is inside an `async`
  function and correctly `await`s the loader before `buildHttpInvocation`; (2)
  the build actually produces a separate `channel-http-registry-*.js` chunk
  absent from the entry bundle (Step 4); (3) no Rollup "dynamically imported ...
  but also statically imported" warning appears in the build log.
- **Deferred**: this plan does not add a `manualChunks` rule or attempt to split
  the registry's own `@shared/*` dependencies further — the single async chunk
  is the intended, minimal outcome. Any further code-splitting of the registry
  internals is a separate follow-up.
