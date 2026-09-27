# Plan 036: A contract test proves every renderer HTTP mapping hits a real server route

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update this plan's row in
> `plans/README.md` (section "Runde 2") **and** tick its checkbox in
> `plans/MASTERPLAN.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 9e0491e3..HEAD -- src/services/transport/channel-http-registry.ts shared/ipc/channels.ts packages/server/src/api/server-api.ts packages/server/src/api/fastify-adapter.ts tests/unit/api-auth-surface.test.ts tests/unit/renderer-transport.test.ts`
> Changes to the registry or the route modules are normal (new channels/routes) — only the excerpts quoted
> below must still match. On a mismatch in a quoted excerpt, STOP.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW (test-only; no production code changes)
- **Depends on**: none
- **Category**: tests
- **Planned at**: commit `9e0491e3`, 2026-09-27

Audit check: the finding holds. Clarifications: `server-api.ts:53` is the `nonMailRoutes(...)` helper (the
registration list has 16 non-mail and 11 mail entries); the registry maps 346 channels and 27 more are
intentionally unmapped (373 in `AllowedInvokeChannels`). `.hermes/reports/api-route-inventory.json` is a stale
static extraction from 2026-09-25 with broken patterns (e.g. `/api/v1/:resource/([/]+)`) — do not use it.

## Why this matters

In the server edition every renderer `invoke(channel, …)` becomes an HTTP call built by hand in
`src/services/transport/channel-http-registry.ts` (7,518 lines, one builder per channel). Nothing checks that
the `{method, path}` a builder produces is a route the server actually serves: the existing tests only assert
that each channel *has* a mapping and compare URLs against a mocked `fetch`. A typo in a path, a wrong HTTP
method or a route renamed on the server compiles, passes CI and fails only for a user (as a 404/405). This plan
adds one test that pushes every mapped channel's request through the real server dispatcher and fails when it
falls through to "Route nicht gefunden" or "Methode nicht erlaubt".

## Current state

- `shared/ipc/channels.ts:500-521` — `export const AllowedInvokeChannels = tuple(...Object.values(IPCChannels.Window), …, ...Object.values(IPCChannels.Maintenance))`; `InvokeChannel` = its element type (`:523`).
- `src/services/transport/channel-http-registry.ts`:
  - `:21-30` `HttpMethod = "GET" | "POST" | "PATCH" | "DELETE"`; `HttpInvocationSpec = { method, path, query?, body?, responseType?, transform? }`.
  - `:909` `const routeBuilders = new Map<InvokeChannel, RouteBuilder>([ … ])` — builder shapes by argument list:
    193× `([payload])`, 62× `()`, 31× `([id])`, 25× `([messageId])`, the rest single named args
    (`([customerId])`, `([accountId])`, `([key])`, …). Builders validate hard and **throw** on bad input,
    e.g. `positiveId` (`:6862`, needs a positive safe integer), `pathTextSegment` (`:6902`, needs a non-empty
    string), `objectPayload` (`:7036`, `undefined` → `{}`, non-object → throws).
  - `:4794-4804`:
    ```ts
    export function buildHttpInvocation(channel: InvokeChannel, args: unknown[]): HttpInvocationSpec {
      const builder = routeBuilders.get(channel)
      if (!builder) {
        throw new Error(`No HTTP transport mapping registered for IPC channel ${channel}`)
      }
      return builder(args)
    }
    export function hasHttpInvocation(channel: InvokeChannel): boolean {
    ```
  - 27 builders issue **secondary** requests through `transform(body, { fetchJson })`; this plan checks only the
    primary spec (see Maintenance notes).
- `src/services/transport/renderer-transport.ts:481-491` — how the client turns a spec into a URL:
  ```ts
  function buildUrl(baseUrl, path, query) {
    const url = new URL(`${baseUrl}${path.startsWith("/") ? path : `/${path}`}`)
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value === undefined || value === null || value === "") continue
      url.searchParams.set(key, String(value))
    }
    return url.toString()
  }
  ```
- Server side — why the dispatcher, not Fastify: `packages/server/src/api/fastify-adapter.ts:242-254` registers
  every HTTP route (`/api/v1/*`, `/api/v1/auth/*`, `/api/v1/portal/*`, the 7 upload routes, …) with the **same**
  `handler`, which calls `createServerApi(options.ports).handle(...)`; they differ only in body limits and
  pre-body auth. The only route not going through the dispatcher is the WebSocket `/api/v1/events` (`:229`),
  which no invoke channel uses. The adapter passes the raw, still percent-encoded path (`extractPath(url) = url.split('?')[0]`, `:650`).
- `packages/server/src/api/server-api.ts:104-187` — `createServerApi(ports).handle(req)` answers health/openapi,
  runs the CRM gate (`isCrmApiPath` → `requirePrincipal` + `rejectUnlessCrmRead`), then walks
  `SERVER_API_ROUTE_REGISTRATIONS` (`:65-96`) and finally returns
  `error(404, 'not_found', 'Route nicht gefunden')` (`:186`). Route modules return `null` when the path is not
  theirs; some return their own `error(404, 'not_found', …)` or `error(405, 'method_not_allowed', …)` for an
  unknown sub-path/method under their prefix (e.g. `dashboard-routes.ts:19-20,52`, `maintenance-routes.ts:69`).
  Entity-level 404s use other codes (`auth_user_not_found`, `jtl_${resource}_not_found`, …), so
  **`status 404 + code 'not_found'` or `status 405 + code 'method_not_allowed'` means "no such route/method".**
- The pattern to reuse — `tests/unit/api-auth-surface.test.ts:68-83` already probes the dispatcher with a port
  proxy so that no `if (!ports.x) return 503` short-circuit hides routing and every data access throws
  recognisably:
  ```ts
  function throwingPorts(trail = ''): unknown {
    const target = function reached() { /* aufrufbar */ } as unknown as Record<string, unknown>;
    return new Proxy(target, {
      get(_t, prop) {
        if (typeof prop === 'symbol') return undefined;
        if (prop === 'then') return undefined;
        return throwingPorts(trail ? `${trail}.${String(prop)}` : String(prop));
      },
      apply() { throw new Error(`PORT_REACHED:${trail}`); },
      has() { return true; },
    });
  }
  ```
  and calls `createServerApi(throwingPorts() as ServerApiPorts).handle({ method, path, query: {}, body: {}, headers: {}, ip: '203.0.113.9' })`.
- `tests/unit/renderer-transport.test.ts:8925-8972` — test "keeps HTTP transport registry coverage explicit for
  every invoke channel" with an inline `intentionallyUnsupported` set of 27 channels (native window/update/setup,
  legacy auth, local automation settings, local backup/file dialogs, `Pgp.SetPeerKeyTrust`, file-dialog
  workflow/knowledge variants), each group with a German/English reason comment.
- Principal type (`packages/server/src/api/types.ts:48-57`): `{ userId, workspaceId, role: 'owner'|'admin'|'user', sessionId?, … }`.
  An `owner` passes `requireAdmin` and capability checks.
- Conventions: tests of server code live in `tests/unit/*.test.ts` and import from `../../packages/server/src/...`;
  shared test helpers live in `tests/setup/` (e.g. `tests/setup/websocket-routes.ts`). German comments are normal.

## Commands you will need

Prefix every command with `export PATH=/opt/node24/bin:$PATH;` in this environment.

| Purpose | Command | Expected |
|---|---|---|
| Install | `pnpm install` | exit 0 |
| Typecheck | `pnpm run typecheck` | exit 0 |
| Lint | `pnpm run lint` | exit 0, 0 warnings |
| Focused test | `pnpm exec jest tests/unit/renderer-server-route-contract.test.ts` | all pass |
| Neighbour tests | `pnpm exec jest tests/unit/api-auth-surface.test.ts tests/unit/renderer-transport.test.ts` | all pass |
| Unit suite | `pnpm run test:unit` | all pass |

## Scope

**In scope**:
- `tests/unit/renderer-server-route-contract.test.ts` (create)
- `tests/setup/server-api-probe.ts` (create — shared `throwingPorts` + `isPortReached`)
- `tests/setup/http-transport-unsupported-channels.ts` (create — the 27-channel set with its reason comments)
- `tests/unit/api-auth-surface.test.ts` (only: import `throwingPorts` from the new helper instead of the local copy)
- `tests/unit/renderer-transport.test.ts` (only: import the unsupported-channel set instead of the inline one)

**Out of scope**:
- Any change under `src/`, `shared/`, `electron/`, `packages/` — mismatches the test finds are **recorded** in the
  gap list and reported, not fixed here (each fix is its own change with its own regression test).
- Checking secondary requests made inside `transform` via `fetchJson`.
- Wiring `tests/e2e/playwright.server-client.config.ts` into a script or CI.
- Extending `SERVER_API_ROUTE_REGISTRATIONS` with a route table for non-mail modules (the dispatcher probe makes
  that unnecessary; a hand-kept list would drift the same way the registry does).

## Git workflow

- Branch: `advisor/036-renderer-server-route-contract`
- German commit messages with area prefix, e.g. `Tests: Vertragstest Renderer-HTTP-Zuordnung gegen Server-Routen`.
- Do NOT push or open a PR unless the operator says so. No CHANGELOG entry (test-only).

## Steps

### Step 1: Extract the two shared test helpers (no behaviour change)

1. Create `tests/setup/server-api-probe.ts` exporting `throwingPorts` (moved verbatim, with its comment, from
   `api-auth-surface.test.ts:62-83`) and `isPortReached(err: unknown): boolean` (`err instanceof Error && err.message.startsWith('PORT_REACHED')`).
   In `api-auth-surface.test.ts` delete the local function and import it.
2. Create `tests/setup/http-transport-unsupported-channels.ts` exporting
   `HTTP_TRANSPORT_UNSUPPORTED_CHANNELS: ReadonlySet<string>` with the 27 entries and their reason comments moved
   verbatim from `renderer-transport.test.ts:8926-8965`. In that test replace the inline set with the import.

**Verify**: `pnpm exec jest tests/unit/api-auth-surface.test.ts tests/unit/renderer-transport.test.ts` → all pass, same test count as before.

### Step 2: Write the contract test skeleton with its negative controls

Create `tests/unit/renderer-server-route-contract.test.ts`. Core pieces:

```ts
const PRINCIPAL = { userId: '00000000-0000-4000-8000-000000000001', workspaceId: '00000000-0000-4000-8000-000000000002', role: 'owner', sessionId: 's-contract' } as const;

type Outcome = 'routed' | 'no_route' | 'no_method';

async function probe(api: ServerApi, spec: HttpRequestSpec): Promise<Outcome> {
  // URL genau wie buildUrl() im Client bauen, dann wie der Fastify-Adapter zerlegen.
  const url = new URL(`https://crm.example.com${spec.path.startsWith('/') ? spec.path : `/${spec.path}`}`);
  for (const [k, v] of Object.entries(spec.query ?? {})) {
    if (v === undefined || v === null || v === '') continue;
    url.searchParams.set(k, String(v));
  }
  try {
    const res = await api.handle({ method: spec.method, path: url.pathname, query: Object.fromEntries(url.searchParams),
      body: spec.body ?? {}, headers: {}, ip: '203.0.113.9', principal: { ...PRINCIPAL } });
    const code = (res.body as { error?: { code?: unknown } } | undefined)?.error?.code;
    if (res.status === 404 && code === 'not_found') return 'no_route';
    if (res.status === 405 && code === 'method_not_allowed') return 'no_method';
    return 'routed';           // 2xx/4xx/5xx eines Handlers: die Route existiert
  } catch {
    return 'routed';           // PORT_REACHED oder ein Handler-Fehler: ein Handler hat die Anfrage angenommen
  }
}
```

Negative/positive controls as their own tests (these prove the detector works before trusting it):
- `GET /api/v1/definitely-not-a-route` → `no_route`
- `GET /api/v1/dashboard/stats-zzz` → `no_route` (dashboard module's own fallthrough)
- `DELETE /api/v1/dashboard/stats` → `no_method`
- `GET /api/v1/dashboard/stats` → `routed`

**Verify**: `pnpm exec jest tests/unit/renderer-server-route-contract.test.ts` → the 4 control tests pass.

### Step 3: Build a spec for every mapped channel

In the same file:
- `const mapped = AllowedInvokeChannels.filter((c) => !HTTP_TRANSPORT_UNSUPPORTED_CHANNELS.has(c))`; assert
  `mapped.every(hasHttpInvocation)` and `mapped.length > 300` (guards against an empty probe).
- A sample payload: a `Proxy` over `{}` whose `get(key)` returns `undefined` for `then`/symbols, `[1]` for keys
  matching `/Ids$/`, `1` for `/^id$|Id$/`, `'kontakt@example.com'` for `/email/i`, `'sample'` for
  `/token|key|name|query|search|subject|text|folder|uri|url|value|label|title/i`, else `undefined`.
- Candidate argument lists, tried in order until `buildHttpInvocation` does not throw:
  `[]`, `[1]`, `[payload]`, `['sample']`, `[1, payload]`, `[payload, payload]`.
- `SAMPLE_ARGS: Partial<Record<InvokeChannel, unknown[]>>` — explicit args for channels where no candidate
  builds; used **instead of** the candidates. Fill it by running the test and reading the `unbuildable` list;
  take realistic values from the channel's existing test in `renderer-transport.test.ts` (search the channel name).
- Assert `unbuildable` (channels where neither override nor candidates build) equals `[]`.

**Verify**: the test prints no `unbuildable` channels; control tests still pass.

### Step 4: Probe every spec and record real gaps

`const api = createServerApi(throwingPorts() as ServerApiPorts)`; probe each mapped channel's spec; collect
`failures = [{ channel, method, path, outcome }]` for outcomes other than `routed`.

Add `KNOWN_ROUTE_GAPS: Readonly<Record<string, string>>` — channel → reason. Every reason starts with either
`desktop-only:` (mapping exists for completeness but the server intentionally has no route — explain why) or
`BUG:` (the mapping or the server route is wrong — state method, path and what the server serves instead).
Two assertions, so the list cannot rot in either direction:
1. `failures.filter((f) => !(f.channel in KNOWN_ROUTE_GAPS))` equals `[]` (print method + path in the message).
2. Every `KNOWN_ROUTE_GAPS` key is still a failure — a fixed gap must be removed from the list.

For each failure, before adding it: grep the server (`grep -rn "<last path segment>" packages/server/src/api/`)
to decide `desktop-only:` vs `BUG:`. Do not change production code.

**Verify**: `pnpm exec jest tests/unit/renderer-server-route-contract.test.ts` → all pass; note the number of
`BUG:` entries for your report.

### Step 5: Prove the test bites

Temporarily change one builder path in `channel-http-registry.ts` (e.g. `IPCChannels.Sync.GetStatus`
`/api/v1/jtl/sync/status` → `/api/v1/jtl/sync/statuz`) and one method (e.g. `Sync.Run` `POST` → `PATCH`), run the
test, confirm both channels are reported, then revert with `git checkout -- src/services/transport/channel-http-registry.ts`.

**Verify**: with the mutation the test fails naming both channels; after the revert
`git diff --stat src/` is empty and the test passes.

## Test plan

- New `tests/unit/renderer-server-route-contract.test.ts`: 4 detector controls; "every mapped channel builds";
  "every mapped channel reaches a server route" (with `KNOWN_ROUTE_GAPS`); "every known gap is still a gap".
- Neighbour tests unchanged in behaviour after the helper extraction.
- Full: `pnpm run lint`, `pnpm run typecheck`, `pnpm run test:unit`.

## Done criteria

- [ ] `pnpm exec jest tests/unit/renderer-server-route-contract.test.ts tests/unit/api-auth-surface.test.ts tests/unit/renderer-transport.test.ts` passes
- [ ] Step 5 mutation was detected (state it in the report)
- [ ] `pnpm run lint` and `pnpm run typecheck` exit 0; `pnpm run test:unit` passes
- [ ] `git diff --stat src/ shared/ electron/ packages/` is empty
- [ ] Report lists every `BUG:` entry (channel, method, path) so the operator can schedule fixes
- [ ] Row 036 updated in `plans/README.md` (Runde 2) and box ticked in `plans/MASTERPLAN.md`

## STOP conditions

- A detector control from Step 2 does not give the expected outcome — the classification rule is wrong for
  this codebase; report what `handle()` returned.
- More than 15 channels end up in `KNOWN_ROUTE_GAPS` — more likely a probe problem (principal, path encoding,
  sample args) than 15 real bugs; report the list first.
- A route module turns out to be registered outside the dispatcher (a new `app.get/route` in
  `fastify-adapter.ts` with its own handler) — the dispatcher probe would miss it.
- Making a channel build seems to require changing the registry or the server.

## Maintenance notes

- New channel: if it has a mapping, the test probes it automatically; if it needs special args, add them to
  `SAMPLE_ARGS`. If it is intentionally unmapped, add it to `tests/setup/http-transport-unsupported-channels.ts`
  with a reason (both tests read that file).
- The probe accepts any handler response, so a handler that answers 400 for *every* sub-path under its prefix
  can hide a wrong sub-path. Reviewers: check the `BUG:` list and spot-check a few `routed` results.
- Follow-ups: probe the secondary `fetchJson` requests of the 27 transform-based builders (run `transform` with
  a recording `fetchJson`); fix each `BUG:` entry in its own change and delete it from the list.
