// Outbound webhook subscriptions + HMAC event emitter — PROTOTYPE (Phase C spike).
//
// This module is a SPIKE deliverable (see plans/020-spike-outbound-webhook-
// subscriptions.md and docs/AUTOMATION_API_PHASE_C_SPIKE.md). It prototypes the
// three moving parts a real outbound-webhook feature needs:
//   1. a subscription + delivery store (webhook_subscriptions / webhook_deliveries),
//   2. HMAC signing of the exact bytes that are sent (X-SimpleCRM-Signature),
//   3. a bounded-retry + dead-letter dispatcher with a fully injectable port seam.
//
// It is intentionally NOT wired: no live route registers a subscription and no
// live emitter (dispatchCrmWorkflowEvent / sqlite-service) calls emitWebhookEvent.
// Wiring is the follow-up BUILD plan's job.

import { createHmac } from 'crypto';
import { lookup as dnsLookup } from 'node:dns/promises';

export const WEBHOOK_SUBSCRIPTIONS_TABLE = 'webhook_subscriptions';
export const WEBHOOK_DELIVERIES_TABLE = 'webhook_deliveries';

// Lazy DB access — do NOT `import { getDb } from '../sqlite-service'` at module
// top level. That would load electron/sqlite-service (and its native
// better-sqlite3 / electron deps) the instant this module is imported, so even a
// pure unit test that only touches `signWebhookBody` or the injected dispatcher
// would drag in native modules and fail (or need an electron/sqlite mock). Only
// the DB functions resolve it, on demand:
function db() {
  return (require('../sqlite-service') as typeof import('../sqlite-service.js')).getDb();
}

// =============================================================================
// Step 1 — prototype subscription + delivery data model
// =============================================================================

export function ensureWebhookSpikeTables(): void {
  db().exec(`
    CREATE TABLE IF NOT EXISTS ${WEBHOOK_SUBSCRIPTIONS_TABLE} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT NOT NULL,
      events TEXT NOT NULL,            -- JSON array, e.g. ["customer.created","deal.stage_changed"]
      secret TEXT NOT NULL,            -- OPEN QUESTION: keytar vs column (see design doc)
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

export type WebhookSubscriptionInput = {
  url: string;
  events: string[];
  secret: string;
};

export type WebhookSubscriptionRow = {
  id: number;
  url: string;
  secret: string;
};

/**
 * Thin prototype store helpers over the two tables. They reach the DB only
 * through the lazy `db()` seam above, so the module stays importable without
 * native modules. This is a spike, NOT a hardened DAL.
 */
export function insertSubscription(sub: WebhookSubscriptionInput): number {
  ensureWebhookSpikeTables();
  const info = db()
    .prepare(
      `INSERT INTO ${WEBHOOK_SUBSCRIPTIONS_TABLE} (url, events, secret, active)
       VALUES (?, ?, ?, 1)`,
    )
    .run(sub.url, JSON.stringify(sub.events), sub.secret);
  return Number(info.lastInsertRowid);
}

export function listSubscriptionsForEvent(event: string): WebhookSubscriptionRow[] {
  ensureWebhookSpikeTables();
  const rows = db()
    .prepare(
      `SELECT id, url, events, secret FROM ${WEBHOOK_SUBSCRIPTIONS_TABLE} WHERE active = 1`,
    )
    .all() as { id: number; url: string; events: string; secret: string }[];
  return rows
    .filter((row) => {
      try {
        const parsed = JSON.parse(row.events) as unknown;
        return Array.isArray(parsed) && parsed.includes(event);
      } catch {
        return false;
      }
    })
    .map((row) => ({ id: row.id, url: row.url, secret: row.secret }));
}

export type WebhookDeliveryRecord = {
  subscriptionId: number;
  event: string;
  payload: string;
  status: string;
  attempts: number;
  lastError?: string;
};

export function recordDelivery(row: WebhookDeliveryRecord): void {
  ensureWebhookSpikeTables();
  db()
    .prepare(
      `INSERT INTO ${WEBHOOK_DELIVERIES_TABLE}
         (subscription_id, event, payload, status, attempts, last_error)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(row.subscriptionId, row.event, row.payload, row.status, row.attempts, row.lastError ?? null);
}

// =============================================================================
// Step 2 — prototype HMAC signing with an injectable seam
// =============================================================================

export const SIGNATURE_HEADER = 'X-SimpleCRM-Signature';

/**
 * Signs the exact request body bytes with HMAC-SHA256 (node:crypto `createHmac`,
 * mirroring packages/server/src/security/access-token.ts:119). Format proposal:
 * "sha256=<hex>" (GitHub-style). Sign THEN send this same string — never
 * re-serialize the body after signing, or the signature will not verify.
 *
 * hex vs base64url is a decision recorded in the design doc (§API surface). Hex
 * is chosen here for copy/paste debuggability and because n8n's Crypto node emits
 * hex by default; base64url would be ~25% shorter.
 */
export function signWebhookBody(rawBody: string, secret: string): string {
  return `sha256=${createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')}`;
}

// =============================================================================
// Step 3 — prototype bounded-retry + dead-letter dispatcher (injected ports)
// =============================================================================

export type WebhookHttpResult = { status: number; ok: boolean };

export type WebhookDeps = {
  listSubscriptionsForEvent: (event: string) => { id: number; url: string; secret: string }[];
  // Returns the resolved+validated addresses so the fetch can be PINNED to them,
  // closing the DNS-rebinding gap plan 001 hardens (validate -> the host re-resolves
  // to a private IP at connect time). Throws if the host/addresses are blocked.
  assertUrlAllowed: (url: string) => Promise<{ addresses: string[] }>;
  // MUST pin the connection to `pinnedAddresses` (custom lookup/agent) rather than
  // re-resolving `url` — i.e. plan 001's pinned transport, not raw globalThis.fetch.
  fetchImpl: (
    url: string,
    init: {
      method: 'POST';
      headers: Record<string, string>;
      body: string;
      redirect: 'manual';
      pinnedAddresses: string[];
    },
  ) => Promise<WebhookHttpResult>;
  recordDelivery: (row: {
    subscriptionId: number;
    event: string;
    payload: string;
    status: string;
    attempts: number;
    lastError?: string;
  }) => void;
  now: () => number;
  maxAttempts?: number; // default 3
  baseBackoffMs?: number; // default 500 (exponential base)
  // Injectable sleep so tests run instantly (pass `() => Promise.resolve()` or a
  // spy). Defaults to a real timer; with baseBackoffMs = 0 the delay is skipped.
  sleep?: (ms: number) => Promise<void>;
};

export async function dispatchWebhookEvent(
  event: string,
  data: Record<string, unknown>,
  deps: WebhookDeps,
): Promise<void> {
  const maxAttempts = deps.maxAttempts ?? 3;
  const baseBackoffMs = deps.baseBackoffMs ?? 500;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const rawBody = JSON.stringify({ event, data, sentAt: new Date(deps.now()).toISOString() });
  for (const sub of deps.listSubscriptionsForEvent(event)) {
    let attempts = 0;
    let lastError: string | undefined;
    let delivered = false;
    while (attempts < maxAttempts) {
      attempts += 1;
      try {
        const { addresses } = await deps.assertUrlAllowed(sub.url); // re-validate every attempt (SSRF)
        const res = await deps.fetchImpl(sub.url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            [SIGNATURE_HEADER]: signWebhookBody(rawBody, sub.secret),
          },
          body: rawBody,
          redirect: 'manual', // do NOT auto-follow (SSRF; see plan 001)
          pinnedAddresses: addresses, // pin the socket to the validated IP (no DNS re-resolve)
        });
        if (res.ok) {
          delivered = true;
          break;
        }
        lastError = `status ${res.status}`;
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e);
      }
      // Exponential backoff BEFORE the next attempt (not after the last, not on
      // success). baseBackoffMs = 0 (tests) makes this a no-op.
      if (!delivered && attempts < maxAttempts && baseBackoffMs > 0) {
        await sleep(baseBackoffMs * 2 ** (attempts - 1));
      }
    }
    deps.recordDelivery({
      subscriptionId: sub.id,
      event,
      payload: rawBody,
      status: delivered ? 'delivered' : 'dead_letter',
      attempts,
      ...(lastError ? { lastError } : {}),
    });
  }
}

// =============================================================================
// Unwired production seam — reuses plan 001's hardened, pinned transport
// =============================================================================
//
// `emitWebhookEvent` is the tap the follow-up BUILD plan would call from
// dispatchCrmWorkflowEvent (electron/workflow/workflow-trigger-dispatch.ts:185),
// covering customer.created + deal.stage_changed (already post-commit + deduped).
// It is NOT wired in this spike: no live route registers a subscription and no
// emitter calls it. It exists and type-checks only.
//
// It reuses plan 001's SERVER-edition hardened path — the PINNED, redirect-guarded
// transport (`createPinnedFetch`) plus the resolver that returns validated
// addresses (`assertWebhookUrlAllowed`) — from
// packages/server/src/jobs/{pinned-fetch,webhook-handlers}. It deliberately does
// NOT build fetchImpl from a raw globalThis.fetch: that would re-resolve DNS at
// connect time and reopen the rebinding hole even after assertUrlAllowed passed.
//
// Those modules are pulled in with a LAZY require + locally-declared structural
// types (never a static `import` / `typeof import(...)`), so this desktop module
// does not drag the server build graph into dist-electron and stays importable in
// pure unit tests. Whether the desktop edition should physically reuse the server
// transport cross-edition, or the transport should be extracted to `shared/` so
// both editions share ONE hardened dispatcher, is OPEN QUESTION #4 (desktop<->server
// parity) in docs/AUTOMATION_API_PHASE_C_SPIKE.md.

type Plan001PinnedFetch = (
  url: string,
  init: {
    method: 'POST';
    headers: Record<string, string>;
    body: string;
    redirect: 'manual';
    pinnedAddresses: readonly string[];
  },
) => Promise<{ ok: boolean; status: number }>;

interface Plan001PinnedFetchModule {
  createPinnedFetch(): Plan001PinnedFetch;
}

interface Plan001WebhookHandlersModule {
  assertWebhookUrlAllowed(
    url: string,
    allowlist: string | readonly string[],
    lookup: (hostname: string) => Promise<readonly { address: string }[]>,
  ): Promise<readonly string[]>;
}

export async function emitWebhookEvent(event: string, data: Record<string, unknown>): Promise<void> {
  const sqlite = require('../sqlite-service') as typeof import('../sqlite-service.js');
  // Desktop workflow HTTP allowlist (sync_info key), reused as-is (do not rewrite).
  const allowlist = sqlite.getSyncInfo('workflow_http_allowlist') ?? '';
  const { createPinnedFetch } = require('../../packages/server/src/jobs/pinned-fetch') as Plan001PinnedFetchModule;
  const { assertWebhookUrlAllowed } = require('../../packages/server/src/jobs/webhook-handlers') as Plan001WebhookHandlersModule;
  const pinnedFetch = createPinnedFetch();
  await dispatchWebhookEvent(event, data, {
    listSubscriptionsForEvent,
    recordDelivery,
    now: () => Date.now(),
    assertUrlAllowed: async (url) => ({
      addresses: [
        ...(await assertWebhookUrlAllowed(url, allowlist, (hostname) =>
          dnsLookup(hostname, { all: true, verbatim: true }),
        )),
      ],
    }),
    fetchImpl: async (url, init) => {
      // Plan 001's PINNED transport: connects to init.pinnedAddresses (never
      // re-resolves DNS) with redirect:'manual' (blocks/never follows 3xx). This
      // is the hardened path, NOT a raw globalThis.fetch.
      const res = await pinnedFetch(url, init);
      return { ok: res.ok, status: res.status };
    },
  });
}
