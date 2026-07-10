# Automation API Phase C — Outbound Webhook Subscriptions + HMAC Emitter (Spike)

> **Status: DIRECTION SPIKE — prototype + recommendation, not a shipped feature.**
> Prototype code: `electron/automation/webhooks.ts` (unwired). Tests:
> `tests/unit/automation-webhooks-spike.test.ts`. Planned by
> `plans/020-spike-outbound-webhook-subscriptions.md`. This doc is the primary
> deliverable: it records the recommended API/data-model/wiring, the local
> validation result, and the open questions a follow-up **build** plan must close.
>
> Nothing here is wired to a live route or emitter. The prototype fires no real
> outbound webhook from any live trigger.

## Summary / recommendation

**Feasible — recommend GO** for a follow-up build plan, scoped small.
Outbound-subscriptions + an HMAC-signed event emitter are a natural fit for the
desktop edition: the three hard parts already have proven building blocks in the
repo. The signing is a `node:crypto` one-liner (`createHmac`), the dispatcher is a
pure loop with an injectable port seam (no new dependency — `node:http` /
`node:crypto` only), and the tap point already exists — `dispatchCrmWorkflowEvent`
is **post-commit and deduped** and already covers `customer.created` and
`deal.stage_changed`. The prototype dispatcher, subscription store, HMAC signature,
and retry→dead-letter path were validated end-to-end against a local `node:http`
sink (signature verified at the receiver; 500-responses retried to a dead letter).

The one genuinely open architectural decision is **SSRF transport parity between
the desktop and server editions** (see Open Question #4): the server edition
already has plan 001's pinned, redirect-guarded transport
(`packages/server/src/jobs/{pinned-fetch,webhook-handlers}`); the desktop guard
(`electron/workflow/http-request-guard.ts`) validates the initial URL but does not
pin the socket to the validated IP. The recommended shape is a small build plan
that (a) adds `POST/GET/DELETE /api/v1/webhooks/subscriptions`, (b) adds **one**
`emitWebhookEvent(...)` call inside `dispatchCrmWorkflowEvent`, and (c) resolves
the transport-parity question by sharing one hardened, pinned dispatcher across
editions (ideally extracted to `shared/`).

## Data model

Prototyped in `electron/automation/webhooks.ts` via the repo's
`CREATE TABLE IF NOT EXISTS` idiom (`ensureWebhookSpikeTables()`), reached through
a lazy `db()` seam so the module stays importable without native modules.

**`webhook_subscriptions`** (as prototyped):

| column       | type                         | notes                                                        |
|--------------|------------------------------|--------------------------------------------------------------|
| `id`         | INTEGER PK AUTOINCREMENT     |                                                              |
| `url`        | TEXT NOT NULL                | delivery target                                              |
| `events`     | TEXT NOT NULL                | JSON array, e.g. `["customer.created","deal.stage_changed"]` |
| `secret`     | TEXT NOT NULL                | HMAC secret — see Open Question #3 (keytar vs column)        |
| `active`     | INTEGER NOT NULL DEFAULT 1   | soft on/off                                                  |
| `created_at` | TEXT NOT NULL DEFAULT now    |                                                              |

**`webhook_deliveries`** (as prototyped):

| column            | type                       | notes                                        |
|-------------------|----------------------------|----------------------------------------------|
| `id`              | INTEGER PK AUTOINCREMENT   |                                              |
| `subscription_id` | INTEGER NOT NULL           |                                              |
| `event`           | TEXT NOT NULL              |                                              |
| `payload`         | TEXT NOT NULL              | the **exact** JSON string that was/would be signed |
| `status`          | TEXT NOT NULL              | `pending` \| `delivered` \| `dead_letter`    |
| `attempts`        | INTEGER NOT NULL DEFAULT 0 |                                              |
| `last_error`      | TEXT                       |                                              |
| `created_at`      | TEXT NOT NULL DEFAULT now  |                                              |

**Columns to add for the real build** (deferred in the spike):

- `webhook_subscriptions`: `disabled_at TEXT` (auto-disable after repeated
  failures), `secret_ref TEXT` (if secrets move to keytar — a keychain handle
  instead of the raw value), `updated_at`, and an index on `active`.
- `webhook_deliveries`: `next_attempt_at TEXT` (so a background worker can drive
  retries instead of an in-process loop — needed for at-least-once across app
  restarts), `delivered_at TEXT`, `response_status INTEGER`, and an index on
  `(status, next_attempt_at)`. Prototype status starts at `delivered`/`dead_letter`
  (terminal) only; the `pending` state is reserved for the persisted-queue build.

## API surface

Mirror the inbound side (`electron/automation/handlers.ts`) — the `/api/v1` prefix
is stripped upstream (`handlers.ts:472`), so handlers match on `/webhooks/...`.
Proposed routes (specified only — **not** added to `handlers.ts` in this spike):

```
POST   /api/v1/webhooks/subscriptions
  body:  { "url": string, "events": string[], "secret": string }
  201 -> { "data": { "id": number, "url": string, "events": string[], "active": true } }
         (the secret is NEVER echoed back)

GET    /api/v1/webhooks/subscriptions
  200 -> { "data": [ { "id", "url", "events", "active", "created_at" } ] }

DELETE /api/v1/webhooks/subscriptions/:id
  200 -> { "data": { "deleted": true } }
```

**Scope gate**: reuse the existing `workflows` `AutomationScope` (from
`shared/automation-api.ts` — scopes are `read | write | email | workflows`). The
inbound webhook route is already gated on `['workflows']`; outbound subscription
management is the same concern, so a new scope is not warranted for v1. Revisit
only if outbound needs to be delegated independently of workflow access.

**Signed payload envelope** (what the dispatcher signs and sends):

```json
{ "event": "customer.created", "data": { "customerId": 42, "name": "ACME" }, "sentAt": "1970-01-01T00:00:00.000Z" }
```

**Signature header**: `X-SimpleCRM-Signature: sha256=<hex>` where
`<hex> = HMAC_SHA256(rawBody, subscription.secret)` over the **exact** serialized
body bytes (sign-then-send; never re-serialize after signing). `createHmac` from
`node:crypto`, mirroring `packages/server/src/security/access-token.ts:119`.

- **hex vs base64url**: recommend **hex**. It is what the n8n *Crypto* node emits
  by default (frictionless verification for the primary integration target) and it
  is trivial to eyeball/paste while debugging. base64url is ~25% shorter on the
  wire but that saving is irrelevant for a 64-char digest; the server edition's
  *access token* uses base64url for a different reason (compactness in a token),
  which does not apply to a webhook header. Keep the `sha256=` prefix so the
  algorithm is self-describing and future algorithm rotation is possible.

## Emitter wiring

**Exact recommended tap (one call, not added in this spike):** inside
`dispatchCrmWorkflowEvent` (`electron/workflow/workflow-trigger-dispatch.ts:185`),
after the dedup claim succeeds, add a single fire-and-forget call:

```ts
// after: if (!claimWorkflowTrigger(event)) return;
void import('../automation/webhooks')
  .then((m) => m.emitWebhookEvent(OUTBOUND_EVENT_NAME[event.trigger], outboundPayload(event)))
  .catch((e) => console.debug('[webhook] emit', e));
```

Why here: `dispatchCrmWorkflowEvent` is already **post-commit** (it is invoked from
`sqlite-service.ts:1743` after `COMMIT` for customer-created and `sqlite-service.ts:2483`
for deal-stage-changed) and already **deduped/debounced** via `claimWorkflowTrigger`
(`sync_info`-based). So outbound webhooks inherit exactly-fired-once semantics for
free and need no change to `sqlite-service.ts`.

**Event-name mapping**: the internal bus uses `crm.customer_created` /
`crm.deal_stage_changed`; the outbound (product-doc) names are `customer.created` /
`deal.stage_changed`. The emitter maps internal→outbound; only these two variants
are wired for v1 (the other `CrmWorkflowEvent` variants — `task.due`,
`calendar.event_start` — can be added later without new plumbing).

The prototype exposes `emitWebhookEvent(event, data)` as an **unwired** production
seam: it builds `WebhookDeps` from the real store helpers plus plan 001's
**pinned, redirect-guarded** transport and its addresses-returning resolver
(`createPinnedFetch` + `assertWebhookUrlAllowed`), never a raw `globalThis.fetch`.
It type-checks but is **not called** from any live path in this spike.

## Validation

Method: a throwaway `node:http` sink + driver in the executor scratchpad
(out-of-repo, **not** committed). n8n was not available in the sandbox, so the
`node:http` sink was used as the documented substitute. The driver imports the
**compiled** `dispatchWebhookEvent` / `signWebhookBody` from the real prototype
module and POSTs a `customer.created` payload with the `X-SimpleCRM-Signature`
header; the sink recomputes `HMAC_SHA256(rawBody, secret)` and compares.

Observed:

```
[SINK 200] received path=/hooks/crm | signature verifies=true
[SINK 200] X-SimpleCRM-Signature=sha256=9e2e82fc54968ef04be95ef1727336ba1ce7275500c53f47aa61380b8dd66b50
[DISPATCH 200] status=delivered attempts=1
[SINK 500] POSTs received=3
[DISPATCH 500] status=dead_letter attempts=3 lastError=status 500
```

Confirms: (a) the sink receives the POST at the subscription path; (b) the
signature recomputed at the receiver **matches** the header (sign-then-send holds
over a real socket); (c) against a 500 sink the dispatcher retries up to
`maxAttempts` (3 POSTs observed) and then records `dead_letter`. The four injected
unit tests (`tests/unit/automation-webhooks-spike.test.ts`) additionally lock in
signature determinism, the pinned+manual-redirect init, retry→DLQ, and SSRF
rejection (fetch never called when the resolver throws).

## Open questions

Each with a recommendation for the build plan.

1. **Which events first?** — **Recommend** starting with `customer.created` +
   `deal.stage_changed` only: both already flow through
   `dispatchCrmWorkflowEvent`, so wiring is one line and inherits post-commit +
   dedup. `email.received` is **not** a freebie — new-mail dispatch does not go
   through `CrmWorkflowEvent`; it uses a separate path
   (`electron/email/email-imap-services.ts` + `listWorkflowsByTrigger`). Adding a
   `crm.email_received` bus variant (or a parallel emit at the mail-ingest tap) is
   its own small task — **defer** it to a second increment. `task.due`,
   `calendar.event_start`, and `workflow.run.completed/failed` are similarly
   deferred (the first two are cheap once the pattern lands; the last needs a
   run-completion hook).

2. **Retry / DLQ policy** — **Recommend** `maxAttempts = 3` with exponential
   backoff `base=500ms` (0.5s, 1s, 2s) for the in-process v1, then auto-disable a
   subscription (`disabled_at`) after N consecutive dead-letters (propose N=20 over
   a rolling window) to stop hammering a dead endpoint. Retain `webhook_deliveries`
   ~30 days with a manual replay endpoint (`POST /webhooks/deliveries/:id/replay`).
   **Caveat**: the prototype loop is in-process; a durable build should persist
   `pending` deliveries with `next_attempt_at` and drive retries from a background
   worker so a crash mid-backoff does not silently drop the delivery.

3. **Per-subscription secrets** — **Recommend** storing the secret in a DB column
   for v1 (simplicity; it is a shared HMAC secret, not a login credential, and the
   SQLite file already holds comparable secrets). Contrast: the **single** API key
   lives in the OS keychain via keytar (`automation-keytar.ts`) because there is
   exactly one; per-subscription secrets are many and 1:1 with a DB row, so keytar
   adds bookkeeping (a `secret_ref` indirection) for marginal benefit. Never echo
   the secret back on `GET`. Support rotation by allowing the secret to be replaced
   on the subscription; consider a short dual-secret overlap window so in-flight
   consumers can migrate.

4. **Desktop vs server SSRF parity** — the desktop guard
   (`assertWorkflowHttpUrlAllowed`, `electron/workflow/http-request-guard.ts`)
   validates the initial URL and rejects private/reserved DNS results, **but** it
   returns only `{ ok }` (no addresses) and provides **no pinned transport**, so a
   DNS-rebind between validate and connect, or a 3xx redirect to a private target,
   is not closed on desktop. The server edition already has plan 001's hardening:
   `assertWebhookUrlAllowed` returns validated addresses and `createPinnedFetch`
   pins the socket to them with `redirect: 'manual'`, and `guardedFetch`
   re-validates each redirect hop. **Recommend** the build plan share **one**
   hardened, pinned dispatcher across editions — ideally by extracting the pinned
   transport + resolver into `shared/` so both `electron/` and `packages/server`
   consume it (the prototype's `emitWebhookEvent` currently reaches the server
   module via a lazy require + local structural types purely to avoid coupling the
   desktop build graph; that is a spike stopgap, not the shipping shape). At
   minimum, Phase C outbound on desktop MUST pin to the validated IP and set
   `redirect: 'manual'`, matching plan 001 — do not ship the unpinned desktop guard
   for outbound webhooks.

5. **Delivery ordering / at-least-once + app-closed loss** — the prototype is
   **at-most-once per in-process run** with no ordering guarantee across
   subscriptions. On the **desktop** edition the app may be closed when an event
   would fire, so events raised while closed are simply not produced (the tap is
   in-process). **Recommend** for v1: document at-least-once *intent* backed by the
   persisted `pending` + `next_attempt_at` queue (Open Question #2) so a delivery
   survives a restart; accept that events occurring while the app is fully closed
   are out of scope for the desktop edition (this is a fundamental desktop
   limitation and a strong argument for the server edition owning outbound webhooks
   long-term). Do not promise ordered delivery; consumers must treat `sentAt` +
   payload as the source of truth and be idempotent.
```
