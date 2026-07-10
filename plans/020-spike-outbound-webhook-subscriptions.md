# Plan 020: SPIKE: outbound webhook subscriptions + HMAC event emitter (Automation API Phase C)

> **Executor instructions**: This is a **DIRECTION SPIKE**, not a build-everything
> plan. Your deliverable is a *prototype* plus a *written design + recommendation
> doc that enumerates open questions* — NOT a finished, shipped feature. Follow
> the steps in order, run every verification command, and confirm the expected
> result before moving on. If anything in "STOP conditions" occurs, stop and
> report — do not improvise or expand scope into a full implementation. When
> done, do **not** edit `plans/README.md` — the advisor maintains the index.
>
> **Drift check (run first)**:
> `git diff --stat f24fb27..HEAD -- electron/automation/webhooks.ts tests/unit/automation-webhooks-spike.test.ts docs/AUTOMATION_API_PHASE_C_SPIKE.md`
> These three paths are the files this plan *creates*; at commit `f24fb27` they
> do not exist, so this diff should be empty. If it is non-empty, someone has
> already started Phase C — treat that as a STOP condition and reconcile before
> proceeding.
>
> **Recon re-verify (also run first, STOP-gated)**: the "Current state" excerpts
> below are quoted from existing files you must NOT modify but MUST read. Run
> `git diff --stat f24fb27..HEAD -- electron/automation/handlers.ts electron/workflow/workflow-trigger-dispatch.ts electron/workflow/http-request-guard.ts electron/sqlite-service.ts electron/email/email-webhook.ts docs/EXTERNAL_AUTOMATION_API_PLAN.md`
> If any of those changed since `f24fb27`, open the file and confirm the excerpt
> still matches before relying on it; on a real mismatch, STOP and report.

## Status

- **Priority**: P2
- **Effort**: L
- **Risk**: MED
- **Depends on**: none
- **Category**: direction
- **Planned at**: commit `f24fb27`, 2026-07-10

## Why this matters

SimpleCRM's positioning is that it is **komplementär to n8n**: the CRM is the
system of record and n8n does cross-cutting orchestration. That story only works
if events flow **both** directions. Today the *inbound* half is done — n8n can
`POST /api/v1/webhooks/incoming` to trigger a workflow — but the *outbound* half
does not exist: nothing lets a customer/deal/email event in SimpleCRM push a
signed webhook to a registered URL. The product doc
(`docs/EXTERNAL_AUTOMATION_API_PLAN.md` §Phase C) marks
"Outbound-Subscriptions + HMAC-Signatur (`X-SimpleCRM-Signature`)" and
"Event-Emitter an DB-Hooks" as **not done** while inbound is done — the single
biggest asymmetry blocking the positioning. This spike de-risks that work: it
**prototypes** a subscription store, an HMAC-signed dispatcher with bounded
retry + dead-letter, and taps the *existing* post-commit event bus for 2 events,
then **writes down the recommended API/approach and the open questions** so a
follow-up build plan can be scoped confidently. It intentionally does **not**
ship the feature (no live routes, no live emit calls).

## Current state

### The gap, per the product doc

`docs/EXTERNAL_AUTOMATION_API_PLAN.md` — Phase C checklist (lines 221–227):

```
### Phase C — Webhooks & Events (bidirektional, teilweise umgesetzt)

- [ ] Outbound-Subscriptions + HMAC-Signatur (`X-SimpleCRM-Signature`)
- [x] Inbound `POST /api/v1/webhooks/incoming` → `webhook.incoming` Trigger
- [ ] Event-Emitter an DB-Hooks (customer, deal, email)
```

The events the doc wants outbound (§4.2, lines 161–171): `customer.created` /
`customer.updated`, `deal.stage_changed`, `task.due`, `email.received`,
`workflow.run.completed` / `workflow.run.failed`. The doc's proposed
subscription API (§4.2 line 173): `POST /api/v1/webhooks/subscriptions` with
`{ url, events[], secret }`. The doc's planned (non-existent) home for this code
(§3.1 line 121): `electron/automation/webhooks.ts` — "Outbound-Subscriptions +
Inbound-Trigger".

### Inbound exists (the counterpart you are matching for direction)

`electron/automation/handlers.ts:400` — the live inbound route (note the
`/api/v1` prefix is stripped upstream at `handlers.ts:472`, so `path` here is
`/webhooks/incoming`):

```ts
if (path === '/webhooks/incoming' && method === 'POST') {
  if (!needScope(res, ['workflows'], apiScopes)) return;
  const b = body as { secret?: string; body?: Record<string, unknown>; payload?: Record<string, unknown>; };
  const secret = String(b.secret ?? '').trim();
  if (!secret) { sendError(res, 400, 'missing_secret', 'Webhook-Secret fehlt (Feld secret)'); return; }
  const { fireWebhookWorkflows } = await import('../email/email-webhook');
  const result = await fireWebhookWorkflows({ secret, body: (b.body ?? b.payload ?? {}) as Record<string, unknown> });
  sendJson(res, 200, { data: result });
  return;
}
```

`electron/email/email-webhook.ts:1` shows the crypto/dedup conventions the
inbound side already uses — reuse these idioms (constant-time compare, a
`sync_info` dedup key), do not invent new ones:

```ts
import { createHash, timingSafeEqual } from 'crypto';
// ...
function webhookSecretMatches(provided: string, expected: string): boolean {
  const ah = createHash('sha256').update(provided, 'utf8').digest();
  const bh = createHash('sha256').update(expected, 'utf8').digest();
  return timingSafeEqual(ah, bh);
}
```

**There is no outbound side today.** `electron/automation/` contains only:
`auth.ts`, `automation-keytar.ts`, `handlers.ts`, `http-response.ts`,
`openapi.ts`, `rate-limit.ts`, `server.ts`, `settings.ts`. There is **no**
`webhooks.ts`, **no** `webhook_subscriptions` table anywhere (grep returns
nothing), and **no** `createHmac` / `X-SimpleCRM-Signature` in `electron/`
(both exist only in the separate SERVER edition under `packages/server/`).

### The post-commit event bus you will tap (do NOT modify it in this spike)

The desktop app already emits deduped, post-commit CRM events through one
function. `electron/workflow/workflow-trigger-dispatch.ts:14` defines the event
union and `:185` the dispatcher:

```ts
export type CrmWorkflowEvent =
  | { trigger: 'crm.customer_created'; customerId: number; name: string; email: string | null; }
  | { trigger: 'crm.deal_stage_changed'; dealId: number; customerId: number; oldStage: string; newStage: string; }
  | { trigger: 'task.due'; taskId: number; customerId: number | null; title: string; dueDate: string; }
  | { trigger: 'calendar.event_start'; eventId: number; customerId: number | null; title: string; startDate: string; };

export async function dispatchCrmWorkflowEvent(event: CrmWorkflowEvent): Promise<void> {
  if (!claimWorkflowTrigger(event)) return;   // sync_info-based dedup / debounce
  // ...runs matching internal workflows...
}
```

These events are fired **after the DB COMMIT**, from `electron/sqlite-service.ts`:

- Customer created — `sqlite-service.ts:1743-1753` (right after `COMMIT`):
  ```ts
  db.prepare('COMMIT').run();
  void import('./workflow/workflow-trigger-dispatch')
    .then((m) => m.dispatchCustomerCreatedWorkflow({ customerId: newCustomerId, name: String(dataToInsert.name ?? 'Kunde'), email: dataToInsert.email ? String(dataToInsert.email) : null }))
    .catch((e) => console.debug('[workflow] customer_created', e));
  ```
- Deal stage changed — `sqlite-service.ts:2483-2492`:
  ```ts
  void import('./workflow/workflow-trigger-dispatch')
    .then((m) => m.fireDealStageChangedWorkflows(dealId, Number(deal.customer_id), String(oldStage ?? ''), newStage))
    .catch((e) => console.warn('[workflow] deal stage trigger', e));
  ```

`dispatchCrmWorkflowEvent` is the correct single **tap point** for the future
outbound emitter (it is already post-commit and deduped, and covers
`customer.created` + `deal.stage_changed`). Your prototype exposes an
`emitWebhookEvent(...)` seam; your design doc recommends *where* Phase C wires it
(one added call inside `dispatchCrmWorkflowEvent`). **`email.received` has no
`CrmWorkflowEvent` variant** — new-mail workflow dispatch goes through a
different path (`electron/email/email-imap-services.ts` +
`listWorkflowsByTrigger`), so the third event is an open question, not a freebie.

### The SSRF / allowlist discipline to reuse (desktop edition)

Outbound HTTP from desktop workflows is already guarded. Reuse this — do not
write a new URL validator. `electron/workflow/http-request-guard.ts:7`:

```ts
export async function assertWorkflowHttpUrlAllowed(url: string, allowlistRaw: string): Promise<...> {
  const base = validateHttpRequestUrl(url, allowlistRaw);       // protocol + host-allowlist
  // ...resolves DNS and rejects private/reserved IPs via isPrivateOrReservedIp(addr)...
}
```

The allowlist string lives in `sync_info` under key `workflow_http_allowlist`
(see `electron/workflow/nodes/integration-nodes.ts:8,45`). Helpers
`validateHttpRequestUrl` and `isPrivateOrReservedIp` come from
`shared/workflow-http-allowlist.ts`. **Cross-reference `plans/001-ssrf-webhook-redirect-hardening.md`**:
that plan hardens the *server* edition against redirect + DNS-rebind SSRF
(bounded, re-validated hops + IP pinning). The desktop guard here validates the
initial URL but the prototype's dispatcher must set `redirect: 'manual'` and
re-validate any redirect target — call this out in the design doc as a parity
item (desktop vs server).

### KV + DB handle you'll use for the prototype store

From `electron/sqlite-service.ts` (all exported): `getDb()` (`:888`) returns the
`better-sqlite3` handle; `getSyncInfo(key)` (`:1216`), `setSyncInfo(key,value)`
(`:1222`), `deleteSyncInfo` (`:1233`), `tryClaimSyncInfo(key,value)` (`:1238`,
atomic insert-or-ignore, returns `true` if it claimed). The prototype's
subscription/DLQ tables are created with `getDb().exec('CREATE TABLE IF NOT
EXISTS ...')`, matching the migration idiom already used in `runMigrations()`
(`sqlite-service.ts:449`, all `CREATE TABLE IF NOT EXISTS` / `ALTER TABLE`).
Table-name constants live in `electron/database-schema.ts` (e.g.
`SYNC_INFO_TABLE = 'sync_info'` at `:5`).

### Secret-generation / storage conventions

`electron/automation/automation-keytar.ts:22` generates the API key with
`` `scrm_${randomBytes(32).toString('hex')}` `` and stores it in the OS keychain
via `keytar`. For **per-subscription** secrets you have a choice (keytar vs a DB
column) — this is an explicit open question for the doc, not something to hard-
decide in the prototype. HMAC signing pattern to mirror (from the server
edition, `packages/server/src/security/access-token.ts:119`):
`createHmac('sha256', secret).update(payload, 'utf8').digest(...)`.

## Commands you will need

| Purpose   | Command                                                       | Expected on success |
|-----------|--------------------------------------------------------------|---------------------|
| Install   | `pnpm install --frozen-lockfile`                             | exit 0              |
| Typecheck | `npx tsc -p tsconfig.electron.json --noEmit` (there is no `typecheck` script yet — plan 002 adds one) | exit 0, no errors |
| Build     | `pnpm run build`                                             | exit 0              |
| Tests     | `pnpm test -- tests/unit/automation-webhooks-spike.test.ts`  | all pass            |
| Full test | `pnpm test`                                                 | all pass            |
| Lint      | `pnpm run lint`                                             | exit 0 (eslint, `--max-warnings 0`) |

Notes: CI runs on **Node 24** with pnpm (`.github/workflows/ci.yml`). Do NOT add
a dependency — `pnpm install --frozen-lockfile` must stay valid (no change to
`package.json` / `pnpm-lock.yaml`). `pnpm test` runs jest; unit tests live in
`tests/unit/*.test.ts` and run in the jsdom `unit` project. `pnpm run test:mail`
is only for `electron/email` changes — **not needed here**; do not run it.

## Suggested executor toolkit

- To validate against a real n8n webhook node (optional but recommended): run a
  local n8n (`npx n8n` if available, add a **Webhook** node, copy its test URL).
  If n8n is unavailable, a tiny throwaway `node:http` sink in your **scratchpad**
  (out of repo) is an acceptable substitute — see Step 5. Either way the sink is
  **not** committed.
- Read before starting: `plans/001-ssrf-webhook-redirect-hardening.md` (the
  redirect/rebind hardening you must reference for the desktop-vs-server parity
  open question) and `docs/EXTERNAL_AUTOMATION_API_PLAN.md` §3–§4.

## Scope

**In scope** (the only files you create; this plan modifies nothing existing):

- `electron/automation/webhooks.ts` (create) — the **prototype** module:
  subscription store (prototype `webhook_subscriptions` + `webhook_deliveries`
  tables via `getDb()`), HMAC signing, and a bounded-retry + dead-letter
  dispatcher with an injectable `fetchImpl` / `sign` / `now` seam. Exports an
  `emitWebhookEvent(...)` seam but is **not** wired to any live route or emitter.
- `tests/unit/automation-webhooks-spike.test.ts` (create) — unit tests over the
  pure/injected logic (signing, retry→DLQ, SSRF rejection).
- `docs/AUTOMATION_API_PHASE_C_SPIKE.md` (create) — **the primary deliverable**:
  the recommended API + data model + wiring, the local-n8n validation result,
  and the enumerated open questions.

**Out of scope** (read for recon; do NOT modify — modifying them turns this
spike into a half-shipped feature):

- `electron/automation/handlers.ts` — do **not** add live `/webhooks/subscriptions`
  routes; only *specify* their shape in the doc. Wiring live routes is the
  follow-up build plan's job.
- `electron/workflow/workflow-trigger-dispatch.ts` and
  `electron/sqlite-service.ts` — do **not** add a live `emitWebhookEvent` call at
  the tap points; only *recommend* the exact one-line insertion in the doc.
- `electron/workflow/http-request-guard.ts`, `shared/workflow-http-allowlist.ts`
  — reuse them as-is; do not rewrite the SSRF validator.
- `electron/automation/server.ts`, `openapi.ts`, `settings.ts`, `auth.ts` — no
  live registration/spec/scope changes in a spike.
- `package.json` / `pnpm-lock.yaml` — no new dependency. If you think you need
  one, STOP.

## Git workflow

- Branch: `advisor/020-spike-outbound-webhook-subscriptions` (create off `main`).
- Commit per logical unit; conventional-commit messages, e.g.
  `feat(automation): prototype outbound webhook dispatcher (Phase C spike)`,
  `test(automation): cover webhook signing + retry/DLQ`,
  `docs(automation): Phase C spike design + open questions`.
  (Example style from this repo's `git log`: `fix(review): keep raw-headers /
  .eml export out of the mail read bucket`.)
- Do **not** push or open a PR.

## Steps

### Step 1: Prototype the subscription + delivery data model in `electron/automation/webhooks.ts`

Create `electron/automation/webhooks.ts`. Add an idempotent table-init function
using the repo's `CREATE TABLE IF NOT EXISTS` idiom and `getDb()` from
`../sqlite-service`. Target shape (prototype — column set is a *proposal*, not
frozen):

```ts
import { getDb } from '../sqlite-service';

export const WEBHOOK_SUBSCRIPTIONS_TABLE = 'webhook_subscriptions';
export const WEBHOOK_DELIVERIES_TABLE = 'webhook_deliveries';

export function ensureWebhookSpikeTables(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${WEBHOOK_SUBSCRIPTIONS_TABLE} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT NOT NULL,
      events TEXT NOT NULL,            -- JSON array, e.g. ["customer.created","deal.stage_changed"]
      secret TEXT NOT NULL,            -- OPEN QUESTION: keytar vs column (see doc)
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS ${WEBHOOK_DELIVERIES_TABLE} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      subscription_id INTEGER NOT NULL,
      event TEXT NOT NULL,
      payload TEXT NOT NULL,           -- the exact JSON string that was/would be signed
      status TEXT NOT NULL,            -- 'pending' | 'delivered' | 'dead_letter'
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
}
```

Add minimal prototype store helpers (`insertSubscription`,
`listSubscriptionsForEvent`, `recordDelivery`) over these tables. Keep them thin
— this is a spike, not a hardened DAL.

**Verify**: `npx tsc -p tsconfig.electron.json --noEmit` → exit 0 (file type-checks).

### Step 2: Prototype HMAC signing with an injectable seam

In the same file, add a pure signing function and its header name. Use
`node:crypto` `createHmac` (mirrors `packages/server/src/security/access-token.ts:119`).
Propose the GitHub-style header the doc names:

```ts
import { createHmac } from 'crypto';

export const SIGNATURE_HEADER = 'X-SimpleCRM-Signature';

/** Signs the exact request body bytes. Format proposal: "sha256=<hex>". */
export function signWebhookBody(rawBody: string, secret: string): string {
  return `sha256=${createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')}`;
}
```

The signature MUST cover the **exact** serialized body string that is sent (sign
then send that same string; never re-serialize). Note in a code comment that hex
vs base64url is a decision recorded in the design doc.

**Verify**: `npx tsc -p tsconfig.electron.json --noEmit` → exit 0.

### Step 3: Prototype the bounded-retry + dead-letter dispatcher with injected ports

Add `dispatchWebhookEvent` with a dependency-injection seam (mirrors the
injected-port convention in `plans/001` and the existing automation tests, which
inject fakes via `jest.mock`). No direct `globalThis.fetch`, no direct DNS from
the core loop — everything the test needs is injectable.

```ts
export type WebhookHttpResult = { status: number; ok: boolean };
export type WebhookDeps = {
  listSubscriptionsForEvent: (event: string) => { id: number; url: string; secret: string }[];
  assertUrlAllowed: (url: string) => Promise<void>;              // wraps assertWorkflowHttpUrlAllowed
  fetchImpl: (url: string, init: { method: 'POST'; headers: Record<string, string>; body: string; redirect: 'manual' }) => Promise<WebhookHttpResult>;
  recordDelivery: (row: { subscriptionId: number; event: string; payload: string; status: string; attempts: number; lastError?: string }) => void;
  now: () => number;
  maxAttempts?: number;      // default 3
  baseBackoffMs?: number;    // default 500 (exponential; skip real sleeps when injected in tests)
};

export async function dispatchWebhookEvent(event: string, data: Record<string, unknown>, deps: WebhookDeps): Promise<void> {
  const maxAttempts = deps.maxAttempts ?? 3;
  const rawBody = JSON.stringify({ event, data, sentAt: new Date(deps.now()).toISOString() });
  for (const sub of deps.listSubscriptionsForEvent(event)) {
    let attempts = 0;
    let lastError: string | undefined;
    let delivered = false;
    while (attempts < maxAttempts) {
      attempts += 1;
      try {
        await deps.assertUrlAllowed(sub.url);                    // re-validate every attempt (SSRF)
        const res = await deps.fetchImpl(sub.url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', [SIGNATURE_HEADER]: signWebhookBody(rawBody, sub.secret) },
          body: rawBody,
          redirect: 'manual',                                    // do NOT auto-follow (SSRF; see plan 001)
        });
        if (res.ok) { delivered = true; break; }
        lastError = `status ${res.status}`;
      } catch (e) { lastError = e instanceof Error ? e.message : String(e); }
      // exponential backoff between attempts (in the real build; injected no-op in tests)
    }
    deps.recordDelivery({ subscriptionId: sub.id, event, payload: rawBody, status: delivered ? 'delivered' : 'dead_letter', attempts, ...(lastError ? { lastError } : {}) });
  }
}
```

Also add the (unwired) production seam that the design doc references — an
`emitWebhookEvent(event, data)` that builds `WebhookDeps` from the real store +
`assertWorkflowHttpUrlAllowed(url, getSyncInfo('workflow_http_allowlist') ?? '')`
+ a real `fetchImpl`. It must exist and type-check but is **not called** from any
live path in this spike.

**Verify**: `npx tsc -p tsconfig.electron.json --noEmit` → exit 0.

### Step 4: Unit tests over the pure/injected logic

Create `tests/unit/automation-webhooks-spike.test.ts`. Model structure after the
existing `tests/unit/automation-api.test.ts` (same directory; `describe`/`test`/
`expect`, fakes injected — no DB, no network, no keytar). Cover:

1. **Signature determinism + verification** — `signWebhookBody(body, secret)`
   equals a value an independent `createHmac('sha256', secret)` reproduces, and
   is stable across calls; a different secret or body changes it.
2. **Happy path** — one subscription, `fetchImpl` returns `{ ok: true, status: 200 }`.
   Assert `recordDelivery` was called once with `status: 'delivered'`,
   `attempts: 1`, and that the `fetchImpl` init carried `redirect: 'manual'` and
   a `X-SimpleCRM-Signature` header matching `signWebhookBody(body, secret)`.
3. **Retry then dead-letter** — `fetchImpl` always returns `{ ok: false, status: 500 }`.
   Assert it was called `maxAttempts` (3) times for the subscription and
   `recordDelivery` recorded `status: 'dead_letter'`, `attempts: 3`, and a
   `lastError` containing `500`.
4. **SSRF rejection** — `assertUrlAllowed` throws (`new Error('blocked host')`).
   Assert `fetchImpl` was **never** called and `recordDelivery` recorded
   `dead_letter` with the block reason in `lastError`.

Inject `maxAttempts: 3`, a `now: () => 0`, and a `baseBackoffMs: 0` (or make the
loop skip sleeping when it is 0) so the test runs instantly.

**Verify**: `pnpm test -- tests/unit/automation-webhooks-spike.test.ts` → all
pass (the 4 cases). Then `pnpm run lint` → exit 0.

### Step 5: Validate end-to-end against a local n8n (or throwaway) webhook sink

This step exercises the real signing + a real HTTP POST once, to prove the
approach and to capture a result for the doc. Do it in your **scratchpad** (out
of repo), not in committed code.

- Start a sink: either an n8n **Webhook** node (copy its test URL) or a ~15-line
  `node:http` server in the scratchpad that logs headers + body and returns 200
  (and a second run that returns 500 to observe retry→DLQ).
- Write a tiny scratchpad driver that imports `signWebhookBody` from the built
  module (or re-implements the one-liner) and POSTs a `customer.created` payload
  with the `X-SimpleCRM-Signature` header to the sink.
- Confirm: (a) the sink receives the POST; (b) recomputing
  `HMAC-SHA256(rawBody, secret)` at the sink matches the header (signature
  verifies); (c) against the 500 sink, the dispatcher retries up to `maxAttempts`
  and then records `dead_letter`.
- If n8n is genuinely unavailable in your environment, the `node:http` sink is a
  full substitute; record in the doc which one you used.

**Verify**: paste the observed sink log line (received path + matching signature)
into the design doc's "Validation" section. No repo file changes in this step.

### Step 6: Write the design + open-questions doc `docs/AUTOMATION_API_PHASE_C_SPIKE.md`

This is the **primary deliverable**. Sections (all required):

1. **Summary / recommendation** — one paragraph: is outbound-subscriptions +
   HMAC emitter feasible on the desktop edition as prototyped? Recommended
   go/no-go and rough shape.
2. **Data model** — the `webhook_subscriptions` / `webhook_deliveries` tables as
   prototyped, plus any columns you'd add for the real build (e.g.
   `next_attempt_at`, `disabled_at`).
3. **API surface** — the exact `POST/GET/DELETE /api/v1/webhooks/subscriptions`
   request/response shapes (mirror the doc's `{ url, events[], secret }`), which
   `AutomationScope` gates them (propose `workflows` or a new scope), and the
   signed-payload envelope (`{ event, data, sentAt }`) + header format
   (`X-SimpleCRM-Signature: sha256=<hex>` — justify hex vs base64url).
4. **Emitter wiring** — the exact recommended tap: one added call to
   `emitWebhookEvent(...)` inside `dispatchCrmWorkflowEvent`
   (`electron/workflow/workflow-trigger-dispatch.ts:185`), covering
   `customer.created` and `deal.stage_changed`, with a note that it is already
   post-commit and deduped.
5. **Validation** — the Step 5 result (sink log + signature match; retry/DLQ
   observation).
6. **Open questions** (enumerate at minimum, each with your recommendation):
   - **Which events first?** — start with `customer.created` +
     `deal.stage_changed` (bus taps exist); `email.received` needs a new
     `CrmWorkflowEvent`/path (see `email-imap-services.ts`) — defer or design?
   - **Retry / DLQ policy** — attempt count, backoff schedule, when to auto-
     disable a subscription, retention/replay of `webhook_deliveries`.
   - **Per-subscription secrets** — keytar (like the API key,
     `automation-keytar.ts`) vs a DB column; rotation.
   - **Desktop vs server parity** — the desktop guard
     (`assertWorkflowHttpUrlAllowed`) validates the initial URL; does Phase C
     need the redirect-revalidation + IP-pinning from
     `plans/001-ssrf-webhook-redirect-hardening.md`? Should the two editions
     share one hardened dispatcher?
   - **Delivery ordering / at-least-once semantics**, and whether the app being
     closed (desktop) means events are lost vs queued.

**Verify**: `docs/AUTOMATION_API_PHASE_C_SPIKE.md` exists and every section above
is present (`grep -c '^## ' docs/AUTOMATION_API_PHASE_C_SPIKE.md` ≥ 6).

## Test plan

- New file: `tests/unit/automation-webhooks-spike.test.ts`, covering the 4 cases
  in Step 4 (signature determinism, happy path, retry→dead-letter, SSRF
  rejection). All dependencies injected — no DB, no network, no keytar.
- Structural pattern to model after: `tests/unit/automation-api.test.ts` (same
  directory; injects fakes, drives a handler with hand-built request/response).
- This spike does **not** add integration tests or DB-backed tests for the
  prototype store — the store is validated manually in Step 5 and specified for
  the follow-up build plan.
- Verification: `pnpm test -- tests/unit/automation-webhooks-spike.test.ts` →
  all pass (4 tests); `pnpm test` → no existing test regresses.

## Done criteria

This is a spike — "done" means the prototype runs and the design/open-questions
are written, NOT that the feature ships. ALL must hold:

- [ ] `electron/automation/webhooks.ts` exists and exports `signWebhookBody`,
      `dispatchWebhookEvent`, `ensureWebhookSpikeTables`, and an (unwired)
      `emitWebhookEvent`.
- [ ] `npx tsc -p tsconfig.electron.json --noEmit` exits 0 and `pnpm run build` exits 0.
- [ ] `pnpm test -- tests/unit/automation-webhooks-spike.test.ts` passes; the 4
      spike tests exist and pass.
- [ ] `pnpm test` exits 0 (no existing test regressed) and `pnpm run lint` exits 0.
- [ ] `docs/AUTOMATION_API_PHASE_C_SPIKE.md` exists with all 6 required sections,
      including the enumerated **open questions** and the Step 5 validation
      result.
- [ ] `grep -rn "X-SimpleCRM-Signature" electron/automation/webhooks.ts` returns
      a match; `grep -rn "createHmac" electron/automation/webhooks.ts` returns a
      match.
- [ ] No live wiring was added: `git diff --stat f24fb27..HEAD` shows only the 3
      in-scope files changed (plus your branch's commits); `handlers.ts`,
      `workflow-trigger-dispatch.ts`, and `sqlite-service.ts` are **unchanged**.
      `package.json` / `pnpm-lock.yaml` unchanged.
- [ ] `plans/README.md` is **not** modified by you (the advisor maintains it).

## STOP conditions

Stop and report back (do not improvise) if:

- The recon re-verify diff shows `handlers.ts`, `workflow-trigger-dispatch.ts`,
  `http-request-guard.ts`, or `sqlite-service.ts` drifted such that a quoted
  excerpt no longer matches (the codebase moved since `f24fb27`).
- A `webhook_subscriptions` table, an outbound dispatcher, `createHmac`, or
  `X-SimpleCRM-Signature` already exists in `electron/` — Phase C was already
  started; report rather than duplicate it.
- You find yourself needing to modify an out-of-scope file (adding a live route
  to `handlers.ts`, a live `emitWebhookEvent` call to the bus, or a new scope in
  `settings.ts`/`auth.ts`) to make the prototype "work." That is the follow-up
  build plan's job — a spike must not ship it. Document the needed change in the
  doc instead.
- You conclude you need a new dependency (an HTTP client, a queue lib, etc.).
  The prototype must stay dependency-free via `node:http`/`node:crypto`; if that
  seems impossible, report why.
- Any verification command fails twice after a reasonable fix attempt.

## Maintenance notes

For the human/agent who scopes the follow-up **build** plan from this spike:

- The prototype in `electron/automation/webhooks.ts` is **not wired** — no live
  route, no live emit call. Shipping it means (a) adding
  `POST/GET/DELETE /api/v1/webhooks/subscriptions` in `handlers.ts` behind a
  scope, (b) adding one `emitWebhookEvent(...)` call inside
  `dispatchCrmWorkflowEvent`, and (c) hardening the dispatcher (real backoff,
  persistence of pending deliveries, auto-disable). The design doc spells each
  out.
- A reviewer of the eventual PR should scrutinize: the SSRF re-validation on
  redirects (parity with `plans/001`), that the signed bytes are the exact bytes
  sent, per-subscription secret storage, and that a desktop app-close does not
  silently drop pending deliveries.
- Deferred by design in this spike: `email.received` (needs a new event source),
  `workflow.run.completed/failed`, live UI for managing subscriptions, and any
  server-edition (`packages/server`) counterpart — all listed as open questions
  in the doc.
