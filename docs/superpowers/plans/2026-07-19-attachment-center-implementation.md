# Attachment Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Berechtigte Mailanhaenge workspaceweit finden, sicher ansehen, herunterladen und in neuen Entwuerfen wiederverwenden koennen.

**Architecture:** Die Anhangszentrale liest ausschliesslich ACL-gefilterte Metadaten und verschluesselte Content-Objekte. Immutable Content-Objekte koennen von Nachrichten und Entwuerfen referenziert werden; Malwarestatus und Preview-Policy werden serverseitig vor jedem Zugriff erzwungen.

**Tech Stack:** TypeScript, Fastify, PostgreSQL, React, sandboxed BrowserWindow/Web iframe, ClamAV adapter, Jest, Playwright.

## Global Constraints

- Voraussetzung: Mail-ACL und verschluesselter Content Store.
- Keine Cloudspeicher-Schnittstelle und keine Cloud-Anbindung.
- Keine aktive Vorschau fuer HTML, Office, Archive oder ausfuehrbare Formate.
- `pending`, `suspicious`, `failed` und `not_scanned` sind nicht automatisch sicher.
- Suspekte Dateien duerfen nur mit `mail.attachment.suspicious_download` und expliziter Warnbestaetigung heruntergeladen werden; Wiederverwendung bleibt gesperrt.
- Originaldateinamen werden entschluesselt nur nach `mail.attachment.read` ausgegeben.

---

## File Map

- Create: `packages/core/src/email/attachment-catalog.ts`
- Modify: `packages/core/src/email/index.ts`
- Create: `packages/server/src/migrations/0041_attachment_center.ts`
- Modify: `packages/server/src/migrations/index.ts`
- Modify: `packages/server/src/db/schema.ts`
- Create: `packages/server/src/mail-attachments/types.ts`
- Create: `packages/server/src/mail-attachments/preview-policy.ts`
- Create: `packages/server/src/mail-attachments/malware-adapter.ts`
- Create: `packages/server/src/mail-attachments/clamav-adapter.ts`
- Create: `packages/server/src/mail-attachments/catalog.ts`
- Create: `packages/server/src/mail-attachments/garbage-collector.ts`
- Create: `packages/server/src/api/mail-attachment-center-routes.ts`
- Modify: `packages/server/src/mail-compose-attachments.ts`
- Modify: `packages/server/src/jobs/types.ts`
- Modify: `packages/server/src/jobs/policy.ts`
- Modify: `packages/server/src/jobs/production-handlers.ts`
- Modify: `packages/server/src/api/openapi.ts`
- Modify: `src/services/transport/channel-http-registry.ts`
- Create: `src/app/email/attachments/page.tsx`
- Create: `src/components/email/attachment-center.tsx`
- Create: `src/components/email/attachment-preview-dialog.tsx`
- Modify: `src/components/email/email-sub-nav.tsx`
- Create: `tests/unit/attachment-preview-policy.test.ts`
- Create: `tests/unit/server-attachment-malware-policy.test.ts`
- Create: `tests/integration/server-attachment-center.test.ts`
- Create: `tests/integration/server-attachment-reference-gc.test.ts`
- Create: `tests/e2e/email-attachment-center.spec.ts`

## Stable Interfaces

```ts
export type MalwareStatus =
  | 'pending' | 'clean' | 'suspicious' | 'failed' | 'not_scanned';

export interface AttachmentCatalogQuery {
  cursor?: string;
  limit: number;
  accountIds?: readonly string[];
  contentTypes?: readonly string[];
  receivedFrom?: string;
  receivedTo?: string;
  malwareStatuses?: readonly MalwareStatus[];
  search?: string;
}
```

```ts
export interface MalwareAdapter {
  scan(input: ReadableStream<Uint8Array>, signal: AbortSignal): Promise<{
    status: 'clean' | 'suspicious';
    engine: string;
    signature: string | null;
  }>;
}
```

## Task 1: Catalog model and preview policy

- [ ] Add unit tests for cursor/query validation, MIME normalization and preview decisions for image, plain text, selected PDF, HTML, SVG, Office, archives and executables.
- [ ] Treat MIME, extension and magic bytes as separate signals; disagreement downgrades to download-only or blocked.
- [ ] Run focused tests; expect missing modules.
- [ ] Implement `attachment-catalog.ts` shared schemas and `preview-policy.ts` as a pure allowlist decision.
- [ ] Cap dimensions, decoded text length, PDF size/page count and decompression work before preview.
- [ ] Re-run; expect PASS.
- [ ] Commit: `feat(mail): define attachment catalog and preview policy`.

## Task 2: Schema and immutable references

- [ ] Add integration tests for content object references from messages and drafts, malware transitions and zero-reference GC eligibility.
- [ ] Create `0041_attachment_center.ts` adding scan metadata to `email_message_attachments` and replacing draft path JSON for new writes with `email_draft_attachment_refs(draft_message_id, content_object_id, filename_content_object_id, created_at)`.
- [ ] Add unique reference constraints and indexes for catalog sort `(workspace_id, received_at, attachment_id)`, content type and scan status.
- [ ] Store display filename only as encrypted content ref; retain non-sensitive normalized type/size/keyed-hash metadata.
- [ ] Register migration/schema and run tests; expect PASS.
- [ ] Commit: `feat(server): add attachment catalog persistence`.

## Task 3: ACL-scoped catalog and search

- [ ] Add integration tests where a user has account-wide, folder-only, metadata-only and attachment-read grants.
- [ ] Assert list counts, cursors, filters and filename search never reveal inaccessible records.
- [ ] Implement `catalog.ts` using `MailAccessService.resolveScope(mail.attachment.read)` before ordering, cursor and limit.
- [ ] Use encrypted blind-index candidates for filename/extracted text, then decrypt and verify bounded result candidates.
- [ ] Implement a stable opaque cursor signed by the server and reject altered/workspace-mismatched cursors.
- [ ] Run focused tests; expect PASS.
- [ ] Commit: `feat(server): add authorized attachment catalog`.

## Task 4: Malware state machine and ClamAV adapter

- [ ] Add tests for pending-to-clean/suspicious/failed, retry limits, timeout, unavailable daemon, oversized stream and stale scan-engine version.
- [ ] Implement `malware-adapter.ts` state transitions and `clamav-adapter.ts` with streaming scan, connect/read timeout and maximum bytes.
- [ ] Queue scans after encrypted object commit; never expose pending content as safe preview/reuse.
- [ ] On scanner outage, store `failed` with non-sensitive category and retry with bounded backoff; do not classify clean.
- [ ] Rescan when policy or engine signature version requires it.
- [ ] Run tests; expect PASS.
- [ ] Commit: `feat(server): scan mail attachments through malware adapter`.

## Task 5: Preview and download endpoints

- [ ] Add route tests for clean preview, blocked active formats, suspicious download permission, warning token expiry, range requests and content-disposition injection.
- [ ] Require `mail.attachment.read` for every endpoint and `mail.attachment.suspicious_download` plus one-time confirmation token for suspicious download.
- [ ] Stream decrypted bytes; set fixed CSP, `nosniff`, safe `Content-Disposition`, no cookies, no network credentials and no cache for sensitive content.
- [ ] Render image/text/PDF in an isolated origin/frame with scripts and network disabled; use server-generated plain text for text preview.
- [ ] Do not expose storage paths, object IDs suitable for guessing, scanner internals or raw decrypted temp files.
- [ ] Run route tests; expect PASS.
- [ ] Commit: `feat(server): serve isolated attachment previews`.

## Task 6: Reuse in drafts

- [ ] Add tests that reuse requires source attachment read plus target `mail.draft.edit`, preserves immutable bytes and creates only a new reference.
- [ ] Add negative tests for suspicious/pending content, revoked source access and deleted source message with a still-live draft reference.
- [ ] Extend `mail-compose-attachments.ts` with `reuseContentObject`; never copy decrypted bytes through renderer memory.
- [ ] Ensure outgoing MIME uses the draft reference's chosen display name while content remains immutable.
- [ ] Emit audit event with IDs only.
- [ ] Run compose and integration tests; expect PASS.
- [ ] Commit: `feat(email): reuse safe attachments in drafts`.

## Task 7: Reference-aware garbage collection

- [ ] Add crash/retry tests for reference deletion, retention expiry, active download lease and object deletion between file/database phases.
- [ ] Implement GC eligibility as zero live references, retention elapsed, no active lease and no legal/export hold.
- [ ] Tombstone database object first, delete encrypted file idempotently, then finalize metadata; retries tolerate an already-missing file.
- [ ] Check `mail_message_content_refs`, `email_message_attachments`, `email_draft_attachment_refs`, revisions, comments and S/MIME-key refs as one liveness predicate before deletion.
- [ ] Never infer liveness from a denormalized count alone; verify in the deletion transaction.
- [ ] Run GC tests repeatedly; expect PASS.
- [ ] Commit: `feat(server): collect unreferenced attachment objects safely`.

## Task 8: Attachment center UI

- [ ] Add Playwright tests for navigation, search, filters, cursor loading, clean preview, blocked preview, warning-confirmed suspicious download and compose reuse.
- [ ] Implement `attachment-center.tsx` as a dense list/table with type icon, filename, source message/account, date, size and malware state.
- [ ] Use icons for preview/download/reuse with tooltips; no nested cards and no explanatory marketing copy.
- [ ] Keep selected row stable during pagination/refetch and show access-revoked state without retaining decrypted preview.
- [ ] Revoke blob URLs and close preview resources on selection change/unmount.
- [ ] Run UI/E2E tests; expect PASS.
- [ ] Commit: `feat(email): add global attachment center`.

## Task 9: Final verification

- [ ] Test 100,000 catalog rows and verify indexed cursor plans with `EXPLAIN (ANALYZE, BUFFERS)` in a disposable database.
- [ ] Fuzz filenames, MIME headers, PDFs and text decoders; enforce CPU/memory/time limits.
- [ ] Verify CSP with browser tests and assert preview frame cannot call API, navigate parent or read auth storage.
- [ ] Run `pnpm run lint`, `pnpm run test:unit`, `pnpm run test:integration`, `pnpm run test:mail:coverage`, and `pnpm run build`.
- [ ] Commit: `test(email): harden attachment center boundaries`.

## No-Regression Checklist

- [ ] Existing per-message attachment actions continue through the same policy service.
- [ ] Reusing an attachment does not extend source-message visibility.
- [ ] A malware-status event contains no filename or scanner signature.
- [ ] Range requests cannot decrypt arbitrary offsets without authenticating all relevant chunks.
- [ ] Preview failures do not mutate malware status to clean.
- [ ] Folder-only grants constrain attachment counts before aggregation.
