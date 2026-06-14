# Returns / RMA Suite

Internal returns management plus a public, unauthenticated customer portal.
Built in seven phases (PR #108). **JTL is read-only throughout** — writing
returns/credits back into JTL is a deliberately deferred phase.

---

## Overview

- **Internal app** (`/returns`, authenticated): list, filter, search, create
  (with optional JTL order auto-fill), edit status/outcome/notes, analytics,
  and portal administration.
- **Workflow nodes**: decide and apply an outcome automatically inside the mail
  workflow engine.
- **Public portal** (`/portal/$token/...`, unauthenticated): customers create a
  return and look up its status. The per-workspace portal token is the only
  credential.

All data lives in the workspace's own Postgres tables (workspace-scoped, RLS).

---

## Data model (migrations 0021 + 0022)

| Table | Purpose |
|---|---|
| `return_reasons` | Workspace reason vocabulary. A default set (`size_wrong`, `not_liked`, `defective`, `wrong_item`, `late_delivery`, `other`) is seeded lazily on first read. |
| `returns` | Header: `return_number` (`R-` + random hex, unique per workspace), `status`, `outcome`, optional `customer_id` / `email_message_id` / `jtl_order_number` / `jtl_kauftrag`, free `customer_email` / `customer_name` / `notes`. |
| `return_items` | Line items: `sku`, `product_name`, `quantity`, `condition`, optional `product_id` / `reason_id`. |
| `workspace_portal_settings` | Per-workspace portal token + enabled flag. **Not** under RLS (the public resolver runs before any workspace context exists). |

Enums (single source of truth in `db/schema.ts`, mirrored by the migration
CHECK constraints):

- `status`: pending, approved, received, refunded, exchanged, credited, rejected, cancelled
- `outcome`: refund, exchange, credit, keep (nullable = undecided)
- `item condition`: new, opened, used, damaged

---

## HTTP API

Authenticated (workspace from the JWT):

| Method + path | Purpose |
|---|---|
| `GET /api/v1/return-reasons` | Reason vocabulary (seeds defaults on first call) |
| `GET /api/v1/returns` | List with `status` / `customerId` / `search` / `limit` / `offset` |
| `POST /api/v1/returns` | Create (one+ items); audits `returns.create` |
| `GET /api/v1/returns/:id` | Single return with items |
| `PATCH /api/v1/returns/:id` | Update status / outcome / notes; audits `returns.update` |
| `GET /api/v1/returns/analytics` | Totals, by-status, by-outcome, top reasons; optional `sinceDays` window |
| `GET /api/v1/returns/jtl-order-lookup` | Read-only JTL order lookup for the create flow (graceful when JTL unconfigured) |
| `GET/POST /api/v1/returns/portal-settings` | Admin: read / `rotate` / `set_enabled` / `revoke` the portal token; audited |

Public — **unauthenticated**, token-in-path (`handlePublicPortalRoute` runs
before the authenticated dispatcher):

| Method + path | Purpose |
|---|---|
| `POST /api/v1/portal/returns/:token` | Customer creates a return (CAPTCHA + rate limit) |
| `GET /api/v1/portal/returns/:token/:returnNumber` | Public status lookup (narrowed record) |

---

## Public portal security

- **Workspace resolution:** a 32-byte random token (`workspace_portal_settings`)
  resolves the workspace. The resolver validates the exact token shape *before*
  the DB query and compares with `timingSafeEqual`. Rotating the token
  invalidates every previously printed URL; the `enabled` flag pauses the portal
  without destroying the URL.
- **Status codes are deliberate** (no enumeration): unknown token → 404
  `portal_not_found`; disabled → 403 `portal_disabled`; missing CAPTCHA → 403
  `captcha_required`; unknown return → 404 `return_not_found`.
- **CAPTCHA** reuses the workspace login-security Turnstile gate when enabled.
  When `loginSecurity` is not configured the gate degrades open, but the
  `returns.portal.create` audit records `captcha: 'unavailable'` so it's visible.
- **Rate limiting** (sliding window, per IP, before token resolution so it also
  throttles probing): create 10/h, lookup 30/min → 429 with `retryAfterSeconds`.
- **Status lookup** matches `return_number` with case-insensitive *exact*
  equality (`lower() = lower()`), never `ILIKE`, plus a strict
  `^[A-Za-z0-9_-]{1,64}$` allowlist on the path segment — so a `%` wildcard
  can't surface another customer's record.
- The public record (`PortalReturnRecord`) is narrowed: status, outcome, order
  number, timestamps, items (sku / name / qty / condition / reason). No internal
  ids, no PII beyond what the customer typed.

SPA routes (bypass the auth gate and the internal chrome):
`/portal/$token/returns/new`, `/portal/$token/returns/lookup`,
`/portal/$token/returns/$returnNumber`.

---

## Workflow nodes

Operate on the workspace's own returns table — **never** JTL. A run resolves
"its" return via `config.returnId` → the `returns.id` variable → the return
linked to the triggering email (`email_message_id`). No return found → routes to
`no_return` instead of failing.

- **`returns.evaluate`** (read-only decision; runs live even in dry-run).
  Suggests an outcome and routes to `refund` / `exchange` / `credit` / `keep` /
  `needs_review` / `no_return`. Fixed precedence (tunable via config):
  1. `needs_review` — any item condition in `reviewConditions` (default: damaged)
  2. `exchange` — any reason code in `exchangeReasonCodes` (default: size_wrong, wrong_item)
  3. `credit` — any reason code in `creditReasonCodes` (default: none)
  4. else `defaultOutcome` (default: refund)
  Wire each output port to a follow-up node. The editor allows exactly these
  labels (see `workflow-edge-labels.ts`).
- **`returns.offer_exchange`** / **`returns.offer_credit`** (action): set the
  linked return's `outcome` (and optionally `status` via `config.status`).
  Idempotent; dry-run guarded.

The pure decision logic is exported as `decideWorkflowReturnOutcomePort()` and
unit-tested without a database.

---

## Analytics

`GET /api/v1/returns/analytics` aggregates `totalCount`, `byStatus`,
`byOutcome` (null = undecided), and `topReasons` (`return_items` grouped by
reason, left-joined to the current vocabulary so deleted reasons and
reason-less items still count). Optional `sinceDays` (1..3650) window on
`created_at`; the reason aggregation joins the parent return to honour the same
window. Surfaced in the `/returns` page "Auswertung" panel (30d / 90d / 1y / all).

---

## Deliberately deferred

- **JTL write-back** — no return/credit is ever written to JTL. The existing
  `jtl.prepare_action` node plus the `returns.*` nodes are the wiring point once
  the JTL RMA schema is confirmed.
- **Electron/SQLite mirror** for returns (Desktop edition offline use).
- **E-mail notifications** on status change (the public lookup URL is already
  shareable; an automated mail is a small follow-up on the existing mail infra).
