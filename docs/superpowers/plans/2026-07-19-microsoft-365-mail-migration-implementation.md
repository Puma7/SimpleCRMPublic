# Microsoft 365 Mail Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Den bestehenden historischen Importkern um Microsoft 365 / Exchange Online ueber Microsoft Graph erweitern, ohne lokale Exchange- oder EWS-Unterstuetzung einzufuehren.

**Architecture:** Ein `MicrosoftGraphMigrationSourceAdapter` implementiert denselben read-only Source-Adapter wie IMAP. Er verwendet OAuth, immutable IDs, Paging und Delta Links; der generische Orchestrator bleibt fuer Checkpoints, Deduplizierung, Content Store, Nebenwirkungsunterdrueckung und Berichte allein verantwortlich.

**Tech Stack:** TypeScript, Microsoft Graph REST, OAuth 2.0/OIDC, Fastify, Graphile Worker, React, Jest.

## Global Constraints

- Voraussetzung: Der generische Importkern und IMAP-Adapter aus PR 3 sind stabil und gemergt.
- Ausschliesslich Microsoft 365 / Exchange Online ueber Graph; kein EWS und kein lokaler Exchange Server.
- Read-only Minimalberechtigung: delegiertes `Mail.Read` plus minimale Identitaets-/Offline-Scopes; kein `Mail.ReadWrite`, kein `Mail.Send`.
- Keine tenantweite Application Permission in der ersten Version; Import wird vom betroffenen Benutzer interaktiv autorisiert.
- Graph-Rohdaten werden nicht als neues internes Nachrichtenmodell etabliert; RFC822/MIME fliesst in die vorhandene Importpipeline.
- `Retry-After`, Delta-Token-Ablauf und Consent-Entzug muessen explizite, wiederaufnehmbare Zustaende erzeugen.

---

## File Map

- Modify: `packages/core/src/email/mail-migration.ts`
- Modify: `packages/server/src/email-oauth.ts`
- Create: `packages/server/src/mail-migration/microsoft-graph-client.ts`
- Create: `packages/server/src/mail-migration/microsoft-graph-source-adapter.ts`
- Create: `packages/server/src/mail-migration/microsoft-graph-mapping.ts`
- Modify: `packages/server/src/mail-migration/types.ts`
- Modify: `packages/server/src/mail-migration/orchestrator.ts`
- Modify: `packages/server/src/mail-migration/report.ts`
- Modify: `packages/server/src/api/mail-migration-routes.ts`
- Modify: `packages/server/src/api/openapi.ts`
- Modify: `src/components/email/migration-wizard.tsx`
- Create: `tests/unit/server-microsoft-graph-client.test.ts`
- Create: `tests/unit/server-microsoft-graph-mapping.test.ts`
- Create: `tests/integration/server-microsoft-365-migration.test.ts`
- Modify: `tests/e2e/email-migration-wizard.spec.ts`

## Stable Interfaces

```ts
export interface MicrosoftGraphCheckpoint {
  phase: 'full_scan' | 'delta';
  nextLink: string | null;
  deltaLink: string | null;
  folderImmutableId: string;
  generation: number;
}
```

```ts
export interface GraphRequestPolicy {
  maxAttempts: number;
  maxRetryAfterMs: number;
  baseBackoffMs: number;
  requestTimeoutMs: number;
}
```

## Task 1: OAuth scope and consent contract

- [ ] Add tests around `email-oauth.ts` asserting Microsoft migration requests exactly the approved scopes and rejects tokens without `Mail.Read`.
- [ ] Add negative tests proving no `Mail.ReadWrite`, `Mail.Send` or application permission is requested.
- [ ] Extend OAuth purpose/audience metadata so migration tokens cannot be confused with normal account-send credentials.
- [ ] Persist refresh tokens only through the existing encrypted secret port and bind them to workspace, user, migration run and provider tenant/account IDs.
- [ ] Revoke/delete the migration credential when run completes/cancels and expire paused/failed credentials per the 30-day import policy.
- [ ] Run focused tests; expect PASS.
- [ ] Commit: `feat(server): authorize minimal microsoft mail migration access`.

## Task 2: Bounded Graph HTTP client

- [ ] Add fake-fetch tests for success, paging, 401, 403, 404, 410, 429 with seconds/date Retry-After, 500/502/503/504, timeout, malformed JSON and oversized response.
- [ ] Implement `microsoft-graph-client.ts` with `AbortSignal`, per-request timeout, response byte cap, request ID capture and typed Graph errors.
- [ ] Honor bounded `Retry-After`; otherwise use exponential backoff with full jitter. Never retry non-transient 4xx automatically.
- [ ] Redact Authorization, URLs containing opaque cursors and response bodies from logs.
- [ ] Refresh access token once on 401; a second 401 moves the run to correctable authentication failure.
- [ ] Run client tests; expect PASS.
- [ ] Commit: `feat(server): add resilient microsoft graph client`.

## Task 3: Folder and message mapping

- [ ] Add mapping fixtures for default/custom/nested folders, Unicode names, missing optional fields, malformed types, moved message and deleted tombstone.
- [ ] Request `Prefer: IdType="ImmutableId"` on every relevant Graph call and assert it in tests.
- [ ] Map Graph folder immutable ID to `sourceFolderId` and message immutable ID to `stableSourceId`; retain parent folder changes as source metadata, not a new identity.
- [ ] Fetch MIME via `/messages/{id}/$value` as a bounded stream and feed it unchanged to the generic RFC822 importer.
- [ ] Do not synthesize MIME from lossy Graph JSON when `$value` is available; classify unavailable MIME explicitly.
- [ ] Run mapping tests; expect PASS.
- [ ] Commit: `feat(server): map microsoft graph mail to migration source`.

## Task 4: Full scan, paging and delta checkpointing

- [ ] Add integration tests for multi-page folder/message enumeration, crash after each page, duplicated page delivery and changed/deleted items during scan.
- [ ] Implement the Source Adapter with opaque nextLink/deltaLink stored encrypted or as protected checkpoint data; never edit/reconstruct opaque URLs.
- [ ] Persist checkpoint only after every item from the page is durably registered.
- [ ] After full scan, store final deltaLink; use delta only for resuming a still-active scan generation, not for ongoing live sync.
- [ ] On Graph `410 Gone`/expired delta token, increment generation and perform a fresh idempotent scan using immutable IDs/fingerprints.
- [ ] Run integration tests; expect PASS.
- [ ] Commit: `feat(server): checkpoint microsoft graph migration pages`.

## Task 5: Orchestrator integration and error semantics

- [ ] Add tests proving the generic orchestrator behaves identically for IMAP and Graph item outcomes/counters.
- [ ] Extend source type union with `microsoft365`; keep provider branching inside adapter construction only.
- [ ] Map throttling to retryable waiting with `nextAttemptAt`, consent removal to paused-auth-required, invalid source account to failed-config and item-specific malformed MIME to item failure.
- [ ] Revalidate initiating user's account-management permission before each batch and stop claims after revocation.
- [ ] Ensure cancellation aborts active Graph request and deletes source credential after the transaction settles.
- [ ] Run migration integration suites for both providers; expect PASS.
- [ ] Commit: `feat(server): integrate microsoft 365 migration source`.

## Task 6: Wizard and report extension

- [ ] Extend Playwright tests with Microsoft sign-in launch/callback stub, mailbox identity confirmation, folder selection, throttled progress, re-consent and completion.
- [ ] Add Microsoft 365 as source choice in `migration-wizard.tsx`; show the exact delegated read scope before redirect.
- [ ] Verify returned tenant/account identity server-side and require explicit confirmation if it differs from the target CRM mail account.
- [ ] Show throttled/auth-required states with resume actions; never render OAuth tokens or opaque Graph links.
- [ ] Extend JSON/CSV report with provider, tenant/account non-secret identifiers, Graph request ID for support and source-specific categories.
- [ ] Run UI/E2E tests; expect PASS.
- [ ] Commit: `feat(email): add microsoft 365 migration wizard`.

## Task 7: Scale, resilience and final gate

- [ ] Simulate 100,000 messages, deep folder trees, repeated 429s, intermittent 503s, token expiry and delta reset with deterministic fake Graph responses.
- [ ] Assert bounded memory, no duplicate logical messages, monotonic counters and completion after retries.
- [ ] Verify provider contract tests run unchanged against IMAP and Microsoft adapters for cancellation, max-size skip and stable identity.
- [ ] Run `pnpm run lint`, `pnpm run test:unit`, `pnpm run test:integration`, `pnpm run test:mail:coverage`, and `pnpm run build`.
- [ ] Commit: `test(server): prove microsoft mail migration resilience`.

## No-Regression Checklist

- [ ] Adding Microsoft 365 does not add Graph-specific columns to canonical email message tables.
- [ ] IMAP wizard, checkpoints and reports remain unchanged except shared source labels.
- [ ] Consent revocation never deletes already imported content or falsely marks run completed.
- [ ] Delta deletions do not delete imported historical messages; they only annotate source outcome/report.
- [ ] Opaque Graph URLs/tokens never reach client events, logs or CSV reports.
- [ ] Graph import does not become a background live-sync substitute.
