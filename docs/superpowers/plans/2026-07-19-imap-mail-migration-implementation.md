# IMAP Mail Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Historische Nachrichten aus IMAP-Konten kontrolliert, fortsetzbar, duplikatfrei und ohne operative Inbound-Nebenwirkungen in SimpleCRM importieren.

**Architecture:** Ein provider-neutraler Migration Orchestrator speichert Runs, Ordner, Checkpoints und Item-Ergebnisse. Der IMAP-Adapter liefert stabile Quellidentitaeten und rohe RFC822-Daten; die bestehende Parse-/Threading-Pipeline wird in einem expliziten `historical_import`-Modus verwendet und schreibt ausschliesslich ueber ACL und verschluesselten Content Store.

**Tech Stack:** TypeScript, Fastify, PostgreSQL, Graphile Worker, IMAP/OAuth, React, Jest, Playwright.

## Global Constraints

- Voraussetzung: Mail-ACL und verschluesselter Content Store sind gemergt und aktiv.
- Der Import ist read-only gegenueber dem Quellsystem; keine Flags, Ordner oder Nachrichten werden dort veraendert.
- Kein Provider-zu-Provider-Upload.
- Keine Workflows, Vacation Replies, Auto Replies, Reply Suggestions, Trackingevents oder Spam-Lernsignale fuer historische Nachrichten.
- Threading, Customer Linking, Attachment Parsing und Blindindexierung bleiben aktiv.
- Quellgeheimnisse werden verschluesselt und bei Abschluss/Abbruch sofort, bei Pause/Fehler spaetestens nach 30 Tagen geloescht.

---

## File Map

- Create: `packages/core/src/email/mail-migration.ts`
- Modify: `packages/core/src/email/index.ts`
- Create: `packages/server/src/migrations/0040_mail_migration.ts`
- Modify: `packages/server/src/migrations/index.ts`
- Modify: `packages/server/src/db/schema.ts`
- Create: `packages/server/src/mail-migration/types.ts`
- Create: `packages/server/src/mail-migration/source-adapter.ts`
- Create: `packages/server/src/mail-migration/postgres-mail-migration-port.ts`
- Create: `packages/server/src/mail-migration/imap-source-adapter.ts`
- Create: `packages/server/src/mail-migration/fingerprint.ts`
- Create: `packages/server/src/mail-migration/orchestrator.ts`
- Create: `packages/server/src/mail-migration/report.ts`
- Create: `packages/server/src/api/mail-migration-routes.ts`
- Modify: `packages/server/src/mail-parse.ts`
- Modify: `packages/server/src/mail-sync-post-process.ts`
- Modify: `packages/server/src/jobs/types.ts`
- Modify: `packages/server/src/jobs/policy.ts`
- Modify: `packages/server/src/jobs/production-handlers.ts`
- Modify: `packages/server/src/api/openapi.ts`
- Modify: `src/services/transport/channel-http-registry.ts`
- Create: `src/app/email/migration/page.tsx`
- Create: `src/components/email/migration-wizard.tsx`
- Create: `tests/unit/mail-migration-fingerprint.test.ts`
- Create: `tests/unit/server-imap-migration-adapter.test.ts`
- Create: `tests/integration/server-mail-migration.test.ts`
- Create: `tests/integration/server-mail-migration-resume.test.ts`
- Create: `tests/e2e/email-migration-wizard.spec.ts`

## Stable Interfaces

```ts
export type MailMigrationRunStatus =
  | 'draft' | 'scanning' | 'ready' | 'running' | 'paused'
  | 'cancelling' | 'cancelled' | 'completed' | 'failed';

export interface MailMigrationSourceAdapter {
  testConnection(signal: AbortSignal): Promise<MigrationSourceCapabilities>;
  listFolders(signal: AbortSignal): AsyncIterable<MigrationSourceFolder>;
  scanFolder(input: ScanFolderInput, signal: AbortSignal): AsyncIterable<MigrationSourceItem>;
  fetchRfc822(input: FetchSourceItemInput, signal: AbortSignal): Promise<ReadableStream<Uint8Array>>;
}
```

```ts
export interface MigrationSourceItem {
  sourceFolderId: string;
  stableSourceId: string;
  receivedAt: string | null;
  sizeBytes: number | null;
  flags: readonly string[];
}
```

## Task 1: Domain model and transition rules

- [ ] Add unit tests for every legal/illegal `MailMigrationRunStatus` transition, terminal-state immutability and pause/cancel idempotency.
- [ ] Run `pnpm exec jest tests/unit/mail-migration-*.test.ts --runInBand`; expect missing module failures.
- [ ] Implement types and a pure `assertMigrationTransition(from, to)` in `packages/core/src/email/mail-migration.ts`.
- [ ] Define stable progress counters: discovered, queued, imported, duplicate, skipped, conflict, failed and bytesImported.
- [ ] Re-run the focused test; expect PASS.
- [ ] Commit: `feat(mail): define historical migration state model`.

## Task 2: Durable migration schema

- [ ] Add integration tests for run/folder/checkpoint/item constraints, workspace isolation and one active item identity per source/run.
- [ ] Create `0040_mail_migration.ts` with `mail_migration_runs`, `mail_migration_folder_runs`, `mail_migration_checkpoints` and `mail_migration_items`.
- [ ] Store encrypted source configuration by reference to the server secret port; tables contain no plaintext password/token.
- [ ] Use unique `(run_id, source_folder_id, stable_source_id)` and separate indexes for pending/retryable jobs and report aggregation.
- [ ] Include `source_adapter_version`, `import_pipeline_version` and `dedupe_version` on the run for reproducibility.
- [ ] Register migration/schema and run tests; expect PASS.
- [ ] Commit: `feat(server): persist historical migration progress`.

## Task 3: IMAP adapter and source identity

- [ ] Build a fake IMAP transport in `server-imap-migration-adapter.test.ts` for capability negotiation, folder names, UIDVALIDITY changes, disconnects and OAuth refresh.
- [ ] Run focused tests; expect missing adapter failures.
- [ ] Implement connection validation with TLS verification on by default, bounded connect/socket/command timeouts and cancellation through `AbortSignal`.
- [ ] Define `stableSourceId` as `(mailbox canonical name, UIDVALIDITY, UID)`; a UIDVALIDITY change creates a new scan generation, never silently reuses old IDs.
- [ ] Stream RFC822 with a configurable maximum size and classify oversized messages as persistent skipped items so they are not downloaded forever.
- [ ] Normalize modified UTF-7 folder names while preserving original source IDs for reporting.
- [ ] Run adapter tests; expect PASS.
- [ ] Commit: `feat(server): add resilient imap migration adapter`.

## Task 4: Canonical fingerprint and duplicate policy

- [ ] Add fixtures with identical RFC822, changed line endings, reordered transport-only headers, same Message-ID/different content and missing Message-ID.
- [ ] Run fingerprint tests; expect missing implementation.
- [ ] Implement a versioned keyed fingerprint over canonicalized stable headers plus decoded body/attachment hashes; use a workspace-specific dedupe key.
- [ ] Never dedupe on Message-ID alone; retain same-Message-ID/different-content as `conflict` and import both with a report link.
- [ ] First check stable source identity for resume idempotency, then fingerprint for cross-folder/provider duplicates.
- [ ] Bound parsing and hashing memory by streaming large RFC822/attachments.
- [ ] Re-run; expect PASS.
- [ ] Commit: `feat(server): add migration-safe message deduplication`.

## Task 5: Orchestrator and checkpoint protocol

- [ ] Add `server-mail-migration-resume.test.ts` that kills execution before/after discovery, item claim, fetch, encrypted content commit, metadata commit and checkpoint advance.
- [ ] Assert rerun yields exactly one imported logical message or one recorded conflict and monotonic counters.
- [ ] Implement scan and import as bounded Graphile jobs; claim items with `FOR UPDATE SKIP LOCKED` and a lease expiry.
- [ ] Persist item state after encrypted content/message transaction commits; advance folder checkpoint only across a contiguous terminal prefix.
- [ ] Make cancel cooperative and terminal; pause prevents new claims but lets the active transaction finish.
- [ ] Retry network/5xx failures with bounded exponential backoff and jitter; classify authentication/configuration errors as non-retryable until user correction.
- [ ] Run resume tests repeatedly; expect PASS.
- [ ] Commit: `feat(server): orchestrate resumable mail imports`.

## Task 6: Historical import processing mode

- [ ] Add regression tests around `mail-parse.ts` and `mail-sync-post-process.ts` proving historical imports run parsing, threading, customer linking, attachment extraction and search indexing.
- [ ] Add negative assertions proving no workflow, auto reply, vacation reply, reply suggestion, tracking event, notification burst or spam-learning event occurs.
- [ ] Introduce an explicit context `{ ingestionMode: 'live_sync' | 'historical_import' }`; do not infer mode from dates or folders.
- [ ] Route imported RFC822 through the encrypted content store before metadata is visible.
- [ ] Preserve original received/sent timestamps and source flags without pretending they were observed live.
- [ ] Run focused mail/integration tests; expect PASS.
- [ ] Commit: `feat(server): isolate historical import side effects`.

## Task 7: API, authorization and secret lifecycle

- [ ] Add route tests for create/test/scan/start/pause/resume/cancel/status/report and for unauthorized account access.
- [ ] Require `mail.account.manage` on target account and revalidate it in every user-triggered job.
- [ ] Implement routes with idempotency keys for state-changing operations and stable conflict errors for illegal transitions.
- [ ] Encrypt source credentials through the secret port; delete immediately on completed/cancelled and via cleanup job at 30 days for paused/failed.
- [ ] Redact folder names/message IDs from generic logs; expose detailed item errors only through the authorized report.
- [ ] Run route tests; expect PASS.
- [ ] Commit: `feat(server): expose authorized mail migration api`.

## Task 8: Wizard and reports

- [ ] Add Playwright tests for IMAP configuration, connection error, folder selection, exclusion of Gmail All Mail by default, progress, pause/resume and final report download.
- [ ] Implement `migration-wizard.tsx` as steps: source, connection, folders, scan summary, confirmation, progress, report.
- [ ] Use server events for progress but always refetch authoritative state after reconnect.
- [ ] Implement JSON and CSV reports with source folder, counts, conflict reason and sanitized error category; stream large reports.
- [ ] Make credentials write-only in UI and clear local form state after submission.
- [ ] Run UI/E2E tests; expect PASS.
- [ ] Commit: `feat(email): add imap migration wizard`.

## Task 9: Scale and final gates

- [ ] Create a deterministic 100,000-message synthetic IMAP fixture with duplicates, large attachments, malformed MIME and disconnect injection.
- [ ] Verify bounded worker memory, cursor query plans, retry throughput and report generation; save measurements under `.hermes/reports/`.
- [ ] Verify backup/restore during a paused run and successful continuation afterward.
- [ ] Run `pnpm run lint`, `pnpm run test:unit`, `pnpm run test:integration`, `pnpm run test:mail:coverage`, and `pnpm run build`.
- [ ] Commit: `test(server): prove mail migration resume and scale`.

## No-Regression Checklist

- [ ] Imported Sent messages do not trigger SMTP or append another Sent copy.
- [ ] POP3/live IMAP synchronization keeps its existing UID/idempotency behavior.
- [ ] Source deletion, flag mutation and folder creation methods are absent from the adapter interface.
- [ ] Counts remain correct when one item is retried or reclassified.
- [ ] A revoked account delegation pauses user-started jobs before the next item claim.
- [ ] Final reports distinguish `duplicate`, `conflict`, `skipped` and `failed` without collapsing data loss into success.
