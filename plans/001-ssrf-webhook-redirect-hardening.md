# Plan 001: Harden webhook/workflow HTTP against redirect + DNS-rebind SSRF

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in the `README.md` of the directory this plan lives in (`plans/README.md`) —
> unless a reviewer dispatched you and told you they maintain the index (for
> this plan, the advisor maintains `plans/README.md`; do **not** create or edit
> it).
>
> **Drift check (run first)**:
> `git diff --stat f24fb27..HEAD -- packages/server/src/jobs/webhook-handlers.ts packages/server/src/workflow-http-request.ts packages/server/src/jobs/pinned-fetch.ts tests/unit/webhook-ssrf-redirect.test.ts tests/unit/workflow-http-ssrf.test.ts`
> If any listed file changed since this plan was written (commit `f24fb27`),
> compare the "Current state" excerpts below against the live code before
> proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `f24fb27`, 2026-07-10

## Why this matters

In the multi-tenant SERVER edition, workflows and webhooks make outbound HTTP
requests to operator-configured URLs. Today the code validates only the
**initial** URL (protocol, host allowlist, and that the resolved IPs are not
private/reserved) and then calls the platform `fetch`, which **follows 3xx
redirects to arbitrary hosts with no re-check**. An attacker who controls (or
can influence) an allowlisted endpoint can return `302 Location:
http://169.254.169.254/…` and reach the cloud metadata service or internal
network — a classic SSRF. Separately, because the connection re-resolves DNS
after validation, a DNS-rebinding host can pass the check as a public IP and
then resolve to a private IP at connect time (a TOCTOU rebind). This plan makes
redirects safe (bounded hops, each re-validated) and pins every connection to
the exact IP that was just validated, so `fetch`/the transport can never reach
a host the allowlist/blocklist would reject.

## Current state

Files involved (roles):

- `packages/server/src/jobs/webhook-handlers.ts` — webhook dispatch. Exports
  `assertWebhookUrlAllowed` (URL/host/IP validation) and
  `createFetchWebhookDispatchPort` (the port that actually fetches). This is
  where the redirect + pinning fix mainly lives.
- `packages/server/src/workflow-http-request.ts` — workflow "HTTP request" job
  port. Reuses `assertWebhookUrlAllowed` and does the same unguarded fetch.
- `packages/server/src/server.ts` — wires both ports with default
  `globalThis.fetch`. **No edit needed** (defaults change inside the factories),
  but read it so you understand the wiring; see excerpt below.
- `packages/server/src/jobs/pinned-fetch.ts` — **does not exist yet**; you create
  it. It is the production transport that connects to a pinned IP.

There is currently **no** `redirect: 'manual'` anywhere in `packages/server/src`
(only unrelated OAuth `redirectUri` strings). Confirm with:
`grep -rn "redirect:" packages/server/src` → returns nothing.

### `webhook-handlers.ts` — the unguarded dispatch (lines 79–109 today)

```ts
export function createFetchWebhookDispatchPort(options: FetchWebhookDispatchOptions): WebhookDispatchPort {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const lookup = options.lookup ?? ((hostname: string) => dnsLookup(hostname, { all: true, verbatim: true }));

  if (!fetchImpl) {
    throw new Error('global fetch is not available for webhook dispatch');
  }

  return {
    async dispatch(input) {
      await assertWebhookUrlAllowed(input.url, options.allowlist, lookup);
      const response = await fetchImpl(input.url, {
        method: input.method,
        headers: {
          ...(input.body !== undefined ? { 'content-type': 'application/json' } : {}),
          ...input.headers,
        },
        ...(input.body !== undefined ? { body: input.body } : {}),
        signal: AbortSignal.timeout(input.timeoutMs),
      });
      const bodyPreview = (await response.text()).slice(0, 1000);
      if (!response.ok) {
        throw new Error(`webhook request failed with status ${response.status}: ${bodyPreview.slice(0, 200)}`);
      }
      return {
        status: response.status,
        ...(bodyPreview ? { bodyPreview } : {}),
      };
    },
  };
}
```

Note: `assertWebhookUrlAllowed` is called, then `fetchImpl(input.url, …)` runs
with **no `redirect` option** (defaults to `follow`) and re-resolves DNS itself.

### `webhook-handlers.ts` — `assertWebhookUrlAllowed` (lines 133–171 today)

```ts
export async function assertWebhookUrlAllowed(
  url: string,
  allowlist: string | readonly string[],
  lookup: WebhookLookup,
): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('webhook URL is invalid');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('webhook URL must use http or https');
  }
  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, '');
  if (isBlockedWebhookHostname(hostname) || isPrivateOrReservedWebhookIp(hostname)) {
    throw new Error('webhook URL targets a blocked host');
  }
  const allowed = normalizeWebhookAllowlist(allowlist);
  if (allowed.length === 0) {
    throw new Error('webhook allowlist is empty');
  }
  if (!hostMatchesWebhookAllowlist(hostname, allowed)) {
    throw new Error('webhook URL host is not in the allowlist');
  }
  const records = await lookup(hostname);
  if (records.length === 0) {
    throw new Error('webhook DNS lookup returned no addresses');
  }
  for (const record of records) {
    if (isPrivateOrReservedWebhookIp(record.address)) {
      throw new Error('webhook DNS lookup resolved to a blocked address');
    }
  }
}
```

It returns `void` today. `isPrivateOrReservedWebhookIp` already rejects
`169.254.169.254`, `127.0.0.1`, RFC1918, `::1`, `fc00::/7`, etc. (lines
268–288). `WebhookLookup` (line 51) is
`(hostname: string) => Promise<readonly { address: string }[]>`.

### `webhook-handlers.ts` — the injected fetch seam (`FetchLike`, lines 37–49 today)

```ts
type FetchLike = (
  url: string,
  init: {
    method: WebhookHttpMethod;
    headers: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
}>;
```

This must gain a `headers` accessor on the response (to read `Location`) and a
`redirect`/`pinnedAddresses` pair on the init (see Step 1). `FetchWebhookDispatchOptions`
(lines 27–31) already accepts optional `fetch?` and `lookup?` — tests inject these.

### `workflow-http-request.ts` — the parallel unguarded fetch (lines 70–112 today)

```ts
export function createPostgresWorkflowHttpRequestPort(
  options: PostgresWorkflowHttpRequestPortOptions,
): WorkflowHttpRequestJobPort {
  const now = () => options.now?.() ?? new Date();
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const lookup = options.lookup ?? ((hostname: string) => dnsLookup(hostname, { all: true, verbatim: true }));

  if (!fetchImpl) {
    throw new Error('global fetch is not available for workflow HTTP requests');
  }

  return {
    async request(input): Promise<void> {
      const allowlist = await withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => readWorkflowHttpAllowlist(trx, input.workspaceId),
        { applySession: options.applyWorkspaceSession },
      );

      await assertWebhookUrlAllowed(input.url, allowlist, lookup);
      const response = await fetchImpl(input.url, {
        method: input.method,
        headers: input.method === 'GET' ? {} : { 'Content-Type': 'application/json' },
        ...(input.method === 'GET' || input.body === undefined ? {} : { body: input.body }),
        signal: AbortSignal.timeout(input.timeoutMs),
      });
      const body = (await response.text()).slice(0, HTTP_RESPONSE_BODY_MAX);
      if (!response.ok) {
        throw new Error(`workflow HTTP request failed with status ${response.status}: ${body.slice(0, 200)}`);
      }
      // …enqueues a continuation job if input.continuation is set…
    },
  };
}
```

It imports `assertWebhookUrlAllowed` from `./jobs/webhook-handlers` (line 11).
`WorkflowHttpRequestFetch` (lines 41–53) is the same shape as `FetchLike` above.

### `server.ts` — how both ports are wired (do NOT edit)

```ts
// line ~717–720
createWebhookJobHandlers({
  ...(webhookAllowlist ? {
    dispatcher: createFetchWebhookDispatchPort({ allowlist: webhookAllowlist }),
  } : {}),
}),
// line ~743
workflowHttpRequest: createPostgresWorkflowHttpRequestPort({ db }),
```

Neither call passes `fetch`/`fetchImpl`, so both rely on the factory default.
Changing the default from `globalThis.fetch` to the new pinned transport
(Step 3/4) is what activates pinning in production — `server.ts` itself does not
change.

### Repo conventions to match

- **Injected-port / dependency-injection seam**: production ports take optional
  `fetch`/`fetchImpl` and `lookup` and fall back to a default. Tests inject
  fakes. Keep this — do not call `globalThis.fetch` or `dnsLookup` directly from
  new code paths that tests need to reach.
- **Node built-ins only, no HTTP client dependency**: these files import
  `node:dns/promises` and `node:net` directly. Do **not** add `undici`,
  `node-fetch`, `axios`, or any new package. The pinned transport uses
  `node:http`/`node:https` (their `lookup` request option is honored, and for
  `https` the TLS certificate is still validated against the URL hostname while
  the socket connects to the pinned IP).
- **Test layout**: unit tests live in `tests/unit/*.test.ts`, import server code
  by relative path (e.g. `import { … } from '../../packages/server/src/jobs/webhook-handlers'`),
  and use `describe`/`test`/`it` + `expect`. Exemplars:
  `tests/unit/postgres-job-queue-worker.test.ts` (imports a server port and
  drives it with hand-built fakes) and `tests/unit/workflow-http-allowlist.test.ts`
  (SSRF/allowlist assertions). Model your new tests after these.

## Commands you will need

| Purpose   | Command                                                                                         | Expected on success |
|-----------|-------------------------------------------------------------------------------------------------|---------------------|
| Install   | `pnpm install --frozen-lockfile`                                                                | exit 0              |
| Typecheck | `pnpm run build` (there is no `typecheck` script yet; the build's first step, `tsc -b packages/…`, type-checks the server package) | exit 0, no TS errors |
| Tests     | `pnpm test -- tests/unit/webhook-ssrf-redirect.test.ts tests/unit/workflow-http-ssrf.test.ts`   | all pass            |
| Full test | `pnpm test`                                                                                     | all pass            |
| Lint      | `pnpm run lint`                                                                                 | exit 0 (eslint, `--max-warnings 0`) |

Notes: CI runs on **Node 24** with pnpm (`.github/workflows/ci.yml`). If your
shell is on an older Node you may see a `WARN Unsupported engine` line and the
build may fail to resolve `@types/node` — that is an environment issue, not a
plan issue; use Node 24. `pnpm test` runs jest; the `tests/unit/**` files run in
the `unit` project (jsdom env). Do NOT add a new dependency — `pnpm install
--frozen-lockfile` must stay valid (the lockfile must not change).

## Scope

**In scope** (the only files you may modify or create):

- `packages/server/src/jobs/webhook-handlers.ts` (modify)
- `packages/server/src/workflow-http-request.ts` (modify)
- `packages/server/src/jobs/pinned-fetch.ts` (create)
- `tests/unit/webhook-ssrf-redirect.test.ts` (create)
- `tests/unit/workflow-http-ssrf.test.ts` (create)

**Out of scope** (do NOT touch, even though they look related):

- `packages/server/src/server.ts` — the wiring passes no `fetch`, so changing
  the factory defaults is sufficient; editing it risks the broader server setup
  and is unnecessary.
- `packages/server/src/jobs/index.ts` — `webhook-handlers` is already re-exported
  via `export * from './webhook-handlers'`; you do not need to add exports.
- The host/IP allowlist logic (`isBlockedWebhookHostname`,
  `isPrivateOrReservedWebhookIp`, `normalizeWebhookAllowlist`,
  `hostMatchesWebhookAllowlist`) — it is correct; reuse it, don't rewrite it.
- `package.json` / `pnpm-lock.yaml` — no new dependency. If you think you need
  one, STOP (see STOP conditions).

## Git workflow

- Branch: `advisor/001-ssrf-webhook-redirect-hardening` (create off `main`).
- Commit per logical unit; conventional-commit messages, e.g.
  `fix(server): pin webhook/workflow HTTP and re-validate redirects (SSRF)`
  and `test(server): add SSRF redirect + DNS-rebind coverage`.
  (Example style from this repo's `git log`: `fix(review): keep raw-headers /
  .eml export out of the mail read bucket`.)
- Do **not** push or open a PR.

## Steps

### Step 1: Create the pinned transport `packages/server/src/jobs/pinned-fetch.ts`

Create a new file that exports the fetch seam types and a `createPinnedFetch()`
factory. It performs the request over `node:http`/`node:https`, connecting to a
caller-supplied pre-validated IP (never re-resolving DNS), and does **not**
follow redirects (Node's low-level `request` never auto-follows, which gives us
`redirect: 'manual'` semantics for free). Target shape:

```ts
import http from 'node:http';
import https from 'node:https';
import { isIP } from 'node:net';

export type GuardedHttpInit = Readonly<{
  method: 'GET' | 'POST';
  headers: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
  redirect: 'manual';
  /** Pre-validated public IP(s). The socket connects to pinnedAddresses[0]; DNS is never re-resolved. */
  pinnedAddresses: readonly string[];
}>;

export type GuardedHttpResponse = Readonly<{
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}>;

export type GuardedFetch = (url: string, init: GuardedHttpInit) => Promise<GuardedHttpResponse>;

const MAX_RESPONSE_BYTES = 256 * 1024;

export function createPinnedFetch(): GuardedFetch {
  return (url, init) =>
    new Promise<GuardedHttpResponse>((resolve, reject) => {
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        reject(new Error('pinned fetch received an invalid URL'));
        return;
      }
      const pinned = init.pinnedAddresses[0];
      if (!pinned) {
        reject(new Error('pinned fetch requires at least one pinned address'));
        return;
      }
      const transport = parsed.protocol === 'https:' ? https : http;
      const family = isIP(pinned) === 6 ? 6 : 4;
      // Custom lookup: ignore the hostname, always return the pre-validated IP,
      // so the connection cannot be redirected to another (private) address.
      const lookup = ((_hostname: string, _options: unknown, cb: (err: Error | null, address: string, family: number) => void) => {
        cb(null, pinned, family);
      }) as unknown as http.RequestOptions['lookup'];

      const req = transport.request(
        url,
        { method: init.method, headers: init.headers, ...(init.signal ? { signal: init.signal } : {}), lookup },
        (res) => {
          const chunks: Buffer[] = [];
          let total = 0;
          res.on('data', (c: Buffer) => {
            total += c.length;
            if (total <= MAX_RESPONSE_BYTES) chunks.push(c);
          });
          res.on('end', () => {
            const status = res.statusCode ?? 0;
            const text = Buffer.concat(chunks).toString('utf8');
            resolve({
              ok: status >= 200 && status < 300,
              status,
              headers: {
                get: (name) => {
                  const v = res.headers[name.toLowerCase()];
                  if (v === undefined) return null;
                  return Array.isArray(v) ? v.join(', ') : v;
                },
              },
              text: async () => text,
            });
          });
          res.on('error', reject);
        },
      );
      req.on('error', reject);
      if (init.body !== undefined) req.write(init.body);
      req.end();
    });
}
```

Why this is safe for HTTPS: `transport.request(url, …)` sets the TLS
`servername` from the URL hostname, so the certificate is still checked against
the real host — only the IP we dial is pinned.

**Verify**: `pnpm run build` → exit 0 (the new file type-checks). If build is too
slow locally, at minimum confirm the file has no syntax errors by re-reading it;
the authoritative gate is the Step 5 build.

### Step 2: Make `assertWebhookUrlAllowed` return the validated addresses

In `packages/server/src/jobs/webhook-handlers.ts`, change the signature from
`Promise<void>` to `Promise<readonly string[]>` and return the resolved
addresses after all checks pass. Only the final block changes:

```ts
export async function assertWebhookUrlAllowed(
  url: string,
  allowlist: string | readonly string[],
  lookup: WebhookLookup,
): Promise<readonly string[]> {
  // …all existing validation unchanged…
  const records = await lookup(hostname);
  if (records.length === 0) {
    throw new Error('webhook DNS lookup returned no addresses');
  }
  for (const record of records) {
    if (isPrivateOrReservedWebhookIp(record.address)) {
      throw new Error('webhook DNS lookup resolved to a blocked address');
    }
  }
  return records.map((record) => record.address);
}
```

Do not change any of the validation logic above this block.

**Verify**: `pnpm run build` → exit 0.

### Step 3: Add `guardedFetch` and rewrite the webhook dispatch to use it

Still in `webhook-handlers.ts`:

1. Add an import at the top:
   `import { createPinnedFetch, type GuardedFetch } from './pinned-fetch';`
2. Replace the local `FetchLike` type with `GuardedFetch` (delete the old
   `FetchLike` definition and change `FetchWebhookDispatchOptions.fetch?: FetchLike`
   to `fetch?: GuardedFetch`; if `FetchLike` is referenced elsewhere in the file,
   alias `type FetchLike = GuardedFetch;`).
3. Add an exported `guardedFetch` helper that re-validates every hop and pins:

```ts
export async function guardedFetch(args: {
  url: string;
  allowlist: string | readonly string[];
  lookup: WebhookLookup;
  fetchImpl: GuardedFetch;
  init: { method: WebhookHttpMethod; headers: Record<string, string>; body?: string; timeoutMs: number };
  maxRedirects?: number;
}): Promise<{ ok: boolean; status: number; headers: { get(name: string): string | null }; text(): Promise<string> }> {
  const maxRedirects = args.maxRedirects ?? 3;
  let currentUrl = args.url;
  for (let hop = 0; ; hop += 1) {
    const addresses = await assertWebhookUrlAllowed(currentUrl, args.allowlist, args.lookup);
    const signal =
      typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
        ? AbortSignal.timeout(args.init.timeoutMs)
        : undefined;
    const response = await args.fetchImpl(currentUrl, {
      method: args.init.method,
      headers: args.init.headers,
      ...(args.init.body !== undefined ? { body: args.init.body } : {}),
      ...(signal ? { signal } : {}),
      redirect: 'manual',
      pinnedAddresses: addresses,
    });
    if (response.status >= 300 && response.status < 400) {
      if (hop >= maxRedirects) {
        throw new Error(`webhook exceeded ${maxRedirects} redirects`);
      }
      const location = response.headers.get('location');
      if (!location) {
        throw new Error('webhook redirect response is missing a Location header');
      }
      currentUrl = new URL(location, currentUrl).toString();
      continue; // re-runs assertWebhookUrlAllowed on the new URL → blocks private/off-allowlist hops
    }
    return response;
  }
}
```

4. Rewrite `createFetchWebhookDispatchPort` to default to the pinned transport
   and route through `guardedFetch`:

```ts
export function createFetchWebhookDispatchPort(options: FetchWebhookDispatchOptions): WebhookDispatchPort {
  const fetchImpl = options.fetch ?? createPinnedFetch();
  const lookup = options.lookup ?? ((hostname: string) => dnsLookup(hostname, { all: true, verbatim: true }));

  return {
    async dispatch(input) {
      const response = await guardedFetch({
        url: input.url,
        allowlist: options.allowlist,
        lookup,
        fetchImpl,
        init: {
          method: input.method,
          headers: {
            ...(input.body !== undefined ? { 'content-type': 'application/json' } : {}),
            ...input.headers,
          },
          ...(input.body !== undefined ? { body: input.body } : {}),
          timeoutMs: input.timeoutMs,
        },
      });
      const bodyPreview = (await response.text()).slice(0, 1000);
      if (!response.ok) {
        throw new Error(`webhook request failed with status ${response.status}: ${bodyPreview.slice(0, 200)}`);
      }
      return { status: response.status, ...(bodyPreview ? { bodyPreview } : {}) };
    },
  };
}
```

The old `if (!fetchImpl) throw …` guard can be removed (the default always
returns a function). Keep everything else in the file unchanged.

**Verify**: `pnpm run build` → exit 0.

### Step 4: Route the workflow HTTP port through `guardedFetch` too

In `packages/server/src/workflow-http-request.ts`:

1. Update imports:
   - line 11 becomes `import { assertWebhookUrlAllowed, guardedFetch } from './jobs/webhook-handlers';`
   - add `import { createPinnedFetch, type GuardedFetch } from './jobs/pinned-fetch';`
   - change `WorkflowHttpRequestFetch` to `= GuardedFetch` (or delete it and use
     `GuardedFetch` where it was referenced in `PostgresWorkflowHttpRequestPortOptions`).
2. Default `fetchImpl` to the pinned transport:
   `const fetchImpl = options.fetchImpl ?? createPinnedFetch();`
   (remove the now-dead `if (!fetchImpl) throw …` guard).
3. Replace the `await assertWebhookUrlAllowed(…)` + `await fetchImpl(…)` block
   inside `request(input)` with a single `guardedFetch` call, keeping the
   workflow's header/body rules:

```ts
const response = await guardedFetch({
  url: input.url,
  allowlist,
  lookup,
  fetchImpl,
  init: {
    method: input.method,
    headers: input.method === 'GET' ? {} : { 'Content-Type': 'application/json' },
    ...(input.method === 'GET' || input.body === undefined ? {} : { body: input.body }),
    timeoutMs: input.timeoutMs,
  },
});
const body = (await response.text()).slice(0, HTTP_RESPONSE_BODY_MAX);
if (!response.ok) {
  throw new Error(`workflow HTTP request failed with status ${response.status}: ${body.slice(0, 200)}`);
}
// leave the existing `if (input.continuation) { … }` block unchanged
```

**Verify**: `pnpm run build` → exit 0.

### Step 5: Add unit tests

Create the two test files described in the Test plan below.

**Verify**:
`pnpm test -- tests/unit/webhook-ssrf-redirect.test.ts tests/unit/workflow-http-ssrf.test.ts`
→ all pass (5 tests). Then `pnpm run lint` → exit 0, and `pnpm run build` → exit 0.

## Test plan

Model the tests after `tests/unit/postgres-job-queue-worker.test.ts` (imports a
server port and drives it with hand-built fakes). All fakes are injected — no
network, no real DNS, no undici. Use a public example IP such as
`93.184.216.34` for the "allowed" resolution.

### `tests/unit/webhook-ssrf-redirect.test.ts` (new) — the webhook path

Import `createFetchWebhookDispatchPort` and `guardedFetch` from
`../../packages/server/src/jobs/webhook-handlers`. A fake `fetchImpl` matches
`GuardedFetch`: `(url, init) => Promise<{ ok, status, headers: { get }, text }>`.

1. **302 to metadata is blocked** — allowlist `'example.com'`, dispatch to
   `https://api.example.com/hook`. `lookup` returns `[{ address: '93.184.216.34' }]`
   for the first host. `fetchImpl` returns `{ status: 302, ok: false, headers:
   { get: (n) => (n.toLowerCase() === 'location' ? 'http://169.254.169.254/latest/meta-data/' : null) }, text: async () => '' }`.
   Expect the dispatch to **reject** (the 2nd hop calls `assertWebhookUrlAllowed`
   on `169.254.169.254` → throws "blocked host"). Assert `fetchImpl` was called
   exactly once (it never connected to the metadata address).
2. **DNS-rebind is blocked / connection is pinned** — allowlist `'example.com'`,
   dispatch to `https://api.example.com/hook`. `lookup` is a `jest.fn()` that
   returns `[{ address: '93.184.216.34' }]` on its first call and
   `[{ address: '169.254.169.254' }]` on any later call. `fetchImpl` captures
   `init.pinnedAddresses` and returns `{ status: 200, ok: true, headers: { get: () => null }, text: async () => 'ok' }`.
   Assert: dispatch resolves; captured `pinnedAddresses` equals
   `['93.184.216.34']` (the validated public IP, not the rebind private one);
   and `lookup` was called exactly once (no second, rebindable resolution).
3. **Normal allowlisted request succeeds** — allowlist `'example.com'`, dispatch
   to `https://api.example.com/hook`. `lookup` returns `[{ address: '93.184.216.34' }]`;
   `fetchImpl` returns `{ status: 200, ok: true, headers: { get: () => null }, text: async () => 'pong' }`.
   Assert the result is `{ status: 200, bodyPreview: 'pong' }` and `init.redirect === 'manual'`.

### `tests/unit/workflow-http-ssrf.test.ts` (new) — the workflow path

Import `createPostgresWorkflowHttpRequestPort` from
`../../packages/server/src/workflow-http-request`. The port reads its allowlist
from the DB, so supply a minimal fake `db` plus `applyWorkspaceSession` to skip
the session SQL. **The `workspaceId` must be a UUID** (validated by
`withWorkspaceTransaction`), e.g. `'00000000-0000-4000-8000-000000000000'`.

```ts
const fakeTrx = {
  selectFrom: () => ({
    select: () => ({
      where: () => ({
        where: () => ({ executeTakeFirst: async () => ({ value: 'example.com' }) }),
      }),
    }),
  }),
};
const db = { transaction: () => ({ execute: async (cb: (t: unknown) => unknown) => cb(fakeTrx) }) } as unknown as never;
const port = createPostgresWorkflowHttpRequestPort({
  db,
  applyWorkspaceSession: async () => {},
  lookup: async () => [{ address: '93.184.216.34' }],
  fetchImpl: async (_url, init) => ({
    status: 302,
    ok: false,
    headers: { get: (n: string) => (n.toLowerCase() === 'location' ? 'http://169.254.169.254/' : null) },
    text: async () => '',
  }),
});
```

1. **302 to metadata is blocked** — call
   `port.request({ workspaceId: '00000000-0000-4000-8000-000000000000', method: 'POST', url: 'https://api.example.com/hook', timeoutMs: 5000 })`
   and expect it to **reject** (redirect target `169.254.169.254` fails
   re-validation).
2. **Happy path succeeds** — same setup but `fetchImpl` returns
   `{ status: 200, ok: true, headers: { get: () => null }, text: async () => 'ok' }`
   and no `continuation`. Expect `port.request(...)` to resolve without throwing.

Verification: `pnpm test -- tests/unit/webhook-ssrf-redirect.test.ts tests/unit/workflow-http-ssrf.test.ts`
→ all pass (5 tests total).

Optional (recommended, not required for Done): an integration test under
`tests/integration/` that starts a loopback `http.Server`, calls
`createPinnedFetch()` directly with `pinnedAddresses: ['127.0.0.1']` and
`redirect: 'manual'`, and asserts (a) it reaches the local server and returns
its body, and (b) a `302` response is returned verbatim (not followed). This
exercises the real `node:http` transport that unit tests bypass. Model after an
existing `tests/integration/*.test.ts`.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `pnpm run build` exits 0 (server package type-checks; no TS errors).
- [ ] `pnpm test -- tests/unit/webhook-ssrf-redirect.test.ts tests/unit/workflow-http-ssrf.test.ts` passes; the 5 new tests exist and pass.
- [ ] `pnpm test` exits 0 (no existing test regressed).
- [ ] `pnpm run lint` exits 0.
- [ ] `grep -rn "redirect: 'manual'" packages/server/src` returns at least one match (in `guardedFetch`), and the two dispatch/request call sites no longer call `fetchImpl` directly — they go through `guardedFetch` (`grep -n "guardedFetch(" packages/server/src/jobs/webhook-handlers.ts packages/server/src/workflow-http-request.ts` shows 3 matches: the definition + two call sites).
- [ ] `git status` shows only the 5 in-scope files changed (plus your `plans/README.md` status-row edit, unless the advisor owns it). `pnpm-lock.yaml` and `package.json` are unchanged.
- [ ] `plans/README.md` status row for plan 001 updated (unless a reviewer told you they maintain it).

## STOP conditions

Stop and report back (do not improvise) if:

- The code at the locations in "Current state" doesn't match the excerpts — e.g.
  `assertWebhookUrlAllowed` already returns something other than `void`, or a
  `redirect:`/pinning mechanism already exists (the codebase drifted since
  `f24fb27`).
- You conclude you need to add a dependency (`undici`, `node-fetch`, `axios`,
  etc.) or edit `package.json`/`pnpm-lock.yaml`. The design is intentionally
  dependency-free via `node:http`/`node:https`; if that seems impossible, report
  why instead of adding a package.
- Implementing the fix appears to require editing an out-of-scope file
  (`server.ts`, `jobs/index.ts`, or the allowlist helpers).
- The recommended integration test (or manual check) shows `node:http`/`https`
  is **not** honoring the custom `lookup` (i.e. the connection is not actually
  pinned to `pinnedAddresses[0]`) — the pinning is load-bearing; report before
  shipping a false sense of safety.
- Any verification command fails twice after a reasonable fix attempt.

## Maintenance notes

For the human/agent who owns this code next:

- **Redirect policy**: `guardedFetch` currently re-issues each hop with the
  *same* method, headers, and body to the (re-validated, still-allowlisted)
  redirect target. If a stricter policy is wanted (drop the body, or force `GET`
  on 303, or reject `307/308` to avoid re-sending a POST body), change it in the
  one `guardedFetch` helper — both callers inherit it. `maxRedirects` defaults
  to 3.
- **Address selection**: `createPinnedFetch` dials `pinnedAddresses[0]` only. If
  you want connect-failover across multiple validated A/AAAA records, iterate
  the array in the transport (all entries are already validated public IPs).
- **Where raw sockets live**: `pinned-fetch.ts` is the only place the server
  edition talks HTTP without the platform `fetch`. A reviewer should scrutinize
  (a) that `lookup` is actually passed to `transport.request` and returns the
  pinned IP, (b) that TLS `servername` still derives from the URL host (cert
  validation intact), and (c) the `MAX_RESPONSE_BYTES` cap.
- **Typecheck**: once plan 002 adds a `pnpm run typecheck` script, swap the
  build-based typecheck in "Commands you will need" and "Done criteria" for it.
- **Deferred**: this plan does not add per-request egress logging or a global
  outbound-request timeout budget; those were considered out of scope to keep
  the change low-risk.
