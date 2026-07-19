# Encrypted Mail Content Store Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Alle sensiblen Mailinhalte anwendungsseitig verschluesseln, weiterhin gezielt durchsuchbar machen und mit einem getesteten Offline-Recovery-Paket wiederherstellen koennen.

**Architecture:** Jedes Content-Objekt besitzt einen zufaelligen CEK; dieser wird durch einen versionierten Workspace-KEK gewrappt. Kleine Ciphertexte liegen in PostgreSQL, grosse RFC822-/Attachment-Daten in authentifizierten Chunks im Dateispeicher. Ein separater Workspace-Suchschluessel erzeugt HMAC-basierte Token- und Prefix-Indizes.

**Tech Stack:** TypeScript, PostgreSQL, existing `libsodium-wrappers-sumo`, Node Crypto, Graphile Worker, Jest.

## Global Constraints

- Keine selbst entworfene Kryptografie; ein gepflegtes XChaCha20-Poly1305-Paket wird als direkte Dependency gepinnt.
- AAD bindet `workspaceId`, `objectId`, `kind`, `parentId`, `keyVersion` und bei Dateien `chunkIndex`.
- Schluesselfehler und Authentifizierungsfehler sind fail-closed; kein Klartextfallback nach Aktivierung.
- Search Keys sind von Encryption Keys getrennt.
- S/MIME-Private-Keys werden spaeter als `mail_content_objects.kind = smime_private_key` gespeichert und sind daher im Recovery-Paket enthalten.
- Die Contract-Phase entfernt Klartext erst nach Dual-Write, Backfill, Integritaetspruefung und Restore-Test.

---

## File Map

- Create: `packages/server/src/migrations/0039_encrypted_mail_content.ts`
- Modify: `packages/server/src/migrations/index.ts`
- Modify: `packages/server/src/db/schema.ts`
- Create: `packages/server/src/mail-content/types.ts`
- Create: `packages/server/src/mail-content/crypto.ts`
- Create: `packages/server/src/mail-content/chunked-file.ts`
- Create: `packages/server/src/mail-content/blind-index.ts`
- Create: `packages/server/src/mail-content/postgres-mail-content-port.ts`
- Create: `packages/server/src/mail-content/service.ts`
- Create: `packages/server/src/mail-content/backfill.ts`
- Create: `packages/server/src/mail-content/recovery.ts`
- Create: `packages/server/src/api/mail-encryption-routes.ts`
- Modify: `packages/server/src/mail-sync.ts`
- Modify: `packages/server/src/mail-sync-post-process.ts`
- Modify: `packages/server/src/mail-compose-send.ts`
- Modify: `packages/server/src/mail-compose-attachments.ts`
- Modify: `packages/server/src/mail-search-sql.ts`
- Modify: `packages/server/src/mail-attachment-text.ts`
- Modify: `packages/server/src/mail-gdpr-export.ts`
- Modify: `packages/server/src/jobs/types.ts`
- Modify: `packages/server/src/jobs/policy.ts`
- Modify: `packages/server/src/jobs/production-handlers.ts`
- Create: `tests/unit/server-mail-content-crypto.test.ts`
- Create: `tests/unit/server-mail-blind-index.test.ts`
- Create: `tests/unit/server-mail-content-chunks.test.ts`
- Create: `tests/integration/server-mail-content-store.test.ts`
- Create: `tests/integration/server-mail-content-backfill.test.ts`
- Create: `tests/integration/server-mail-recovery.test.ts`

## Stable Interfaces

```ts
export type MailContentKind =
  | 'subject' | 'body_text' | 'body_html' | 'rfc822'
  | 'attachment' | 'attachment_filename' | 'attachment_text'
  | 'draft_revision' | 'comment' | 'smime_private_key';

export interface MailContentService {
  put(input: PutMailContentInput): Promise<MailContentRef>;
  get(input: GetMailContentInput): Promise<Buffer>;
  deleteReference(input: DeleteMailContentReferenceInput): Promise<void>;
  searchCandidates(input: BlindSearchInput): Promise<ReadonlyArray<string>>;
}
```

```ts
export interface CipherEnvelopeV1 {
  version: 1;
  algorithm: 'xchacha20-poly1305';
  keyVersion: number;
  nonce: Uint8Array;
  ciphertext: Uint8Array;
  wrappedCek: Uint8Array;
}
```

## Task 1: Reuse and narrow the existing crypto primitive

- [ ] Add `tests/unit/server-mail-content-crypto.test.ts` with official/library vectors, randomized round trips and negative tests for mutated nonce, ciphertext, AAD and wrapped CEK.
- [ ] Reuse the existing direct `libsodium-wrappers-sumo` dependency and the established loader patterns from `packages/server/src/security/secret-envelope.ts`; do not add a second cryptographic implementation.
- [ ] Implement only a narrow adapter in `crypto.ts`: `generateCek`, `wrapCek`, `unwrapCek`, `encrypt`, `decrypt`; do not expose sodium-specific types.
- [ ] Zero temporary key buffers in `finally` where the runtime permits and never stringify keys.
- [ ] Run `pnpm exec jest tests/unit/server-mail-content-crypto.test.ts --runInBand`; expect PASS.
- [ ] Commit: `feat(server): add authenticated mail content crypto adapter`.

## Task 2: Schema and key metadata

- [ ] Add integration tests for workspace key versions, content object uniqueness, reference integrity and workspace isolation.
- [ ] Create `0039_encrypted_mail_content.ts` with `mail_workspace_keys`, `mail_content_objects`, `mail_message_content_refs` and `mail_search_terms`.
- [ ] Store wrapped workspace keys and wrapped search keys only; the instance master key remains outside PostgreSQL and is loaded through the existing secrets/config boundary.
- [ ] Add unique `(workspace_id, object_id)`, reference indexes, blind-index lookup indexes and check constraints for kinds/versions/storage modes.
- [ ] Add `encryption_state` and nullable encrypted reference columns without dropping existing plaintext fields.
- [ ] Register migration/schema and run the focused integration test; expect PASS.
- [ ] Commit: `feat(server): add encrypted mail content schema`.

## Task 3: Bounded database objects

- [ ] Add integration tests that put/get subject, text body, HTML body and filename; assert ciphertext differs for identical plaintext because CEKs/nonces are random.
- [ ] Add tests that swapping object IDs, workspaces, kinds or parent IDs causes authenticated decryption failure.
- [ ] Implement `postgres-mail-content-port.ts` with transactions that persist object plus references atomically.
- [ ] Implement `service.ts` with a bounded in-database threshold from configuration and no plaintext logging.
- [ ] Map integrity failures to internal `mail_content_integrity_failed`; map unavailable key versions to `mail_content_unavailable`.
- [ ] Run focused tests; expect PASS.
- [ ] Commit: `feat(server): persist encrypted bounded mail content`.

## Task 4: Chunked file objects

- [ ] Add tests for empty file, exact chunk boundary, multi-chunk file, interrupted temporary write, reordered chunks, truncated final chunk and path traversal attempts.
- [ ] Implement `chunked-file.ts` with a versioned header, fixed maximum chunk size, per-chunk nonce/AAD and final manifest authentication.
- [ ] Write to a workspace-scoped temporary path, fsync file and directory where supported, then atomically rename; database reference becomes visible only after storage commit.
- [ ] Ensure reads accept only object IDs resolved by the content port; never concatenate user filenames into paths.
- [ ] Add orphan temporary-file cleanup with an age floor and tests proving active writes are not deleted.
- [ ] Run focused tests; expect PASS.
- [ ] Commit: `feat(server): encrypt chunked mail objects at rest`.

## Task 5: Blind search index

- [ ] Add `tests/unit/server-mail-blind-index.test.ts` for Unicode normalization, case folding, German umlauts, punctuation, token dedupe, bounded prefix generation and stopword policy.
- [ ] Add adversarial tests for 10 MB single tokens and huge token counts; assert configured per-field limits prevent memory blowup.
- [ ] Implement HMAC-SHA-256 token and prefix digests with a domain separator containing workspace, field class and index version.
- [ ] Update `mail-search-sql.ts` to obtain ACL-scoped candidate IDs from `mail_search_terms`, decrypt only bounded candidates and verify the original query against plaintext before returning snippets.
- [ ] Return an explicit unsupported-search error for syntax the blind index cannot preserve; do not silently broaden results.
- [ ] Run search and blind-index suites; expect PASS.
- [ ] Commit: `feat(server): add blind-indexed encrypted mail search`.

## Task 6: Dual-write all content producers

- [ ] Add characterization tests for inbound sync, post-process attachments, draft save, send/finalize, attachment reuse and GDPR export.
- [ ] Introduce `mailContentService` dependencies into `mail-sync.ts`, `mail-sync-post-process.ts`, `mail-compose-send.ts` and `mail-compose-attachments.ts`.
- [ ] During expand phase, write encrypted objects first and plaintext legacy fields second in the same logical transaction/commit protocol; do not mark `encryption_state=complete` until all required refs exist.
- [ ] Make retries idempotent by deterministic reference identity while retaining random content-object encryption.
- [ ] Change exports to authorize, decrypt and stream content without writing plaintext temp files.
- [ ] Run focused mail/server suites; expect PASS.
- [ ] Commit: `feat(server): dual write encrypted mail content`.

## Task 7: Resumable backfill and verification

- [ ] Add `server-mail-content-backfill.test.ts` covering batches, restart after every transition, partially encrypted messages, missing attachments and concurrent new writes.
- [ ] Add job type `mail.content.backfill` with workspace, cursor and bounded batch size; make the cursor monotonic by primary key.
- [ ] Encrypt only missing refs, verify decrypt-and-hash before marking each message complete, and persist failure reason without plaintext.
- [ ] Add metrics for totals, complete, retryable, permanent failure and oldest unencrypted record.
- [ ] Add a read switch `mailEncryptedReadMode=prefer_encrypted|encrypted_only`; test both modes.
- [ ] Run focused integration tests; expect PASS.
- [ ] Commit: `feat(server): backfill encrypted mail content safely`.

## Task 8: Recovery package and key rotation

- [ ] Add recovery tests that export a package, destroy database key metadata in an isolated test database, restore into a fresh instance and decrypt/search representative content.
- [ ] Implement `recovery.ts` with a versioned manifest, Argon2id-derived package key, authenticated archive contents and explicit inclusion of workspace KEKs/search key; exclude instance credentials and OAuth tokens.
- [ ] Require Owner reauthentication plus `mail.account.manage`, audit the action and stream the package once without server-side retention.
- [ ] Implement key rotation as rewrapping CEKs/index version migration; never require decrypting every payload into a persistent intermediate file.
- [ ] Test wrong passphrase, truncated package, version mismatch and interrupted rotation.
- [ ] Run recovery tests; expect PASS.
- [ ] Commit: `feat(server): add mail encryption recovery and rotation`.

## Task 9: Encrypted-only cutover and scanner gate

- [ ] Add a test utility that plants unique canary subjects, bodies, filenames, comments and attachment text, then scans PostgreSQL dumps, content storage, structured logs and event payloads.
- [ ] Switch all readers to `encrypted_only`; tests must fail if any code path accesses a legacy plaintext column.
- [ ] Keep plaintext columns nullable for one stable release but overwrite migrated values with `NULL` only in a separately reviewed contract migration.
- [ ] Run a production-like backup/restore rehearsal and attach machine-readable evidence to the PR.
- [ ] Run `pnpm run lint`, `pnpm run test:unit`, `pnpm run test:integration`, `pnpm run test:mail:coverage`, and `pnpm run build`.
- [ ] Commit: `feat(server): enforce encrypted-only mail content reads`.

## No-Regression Checklist

- [ ] Search candidates are ACL-filtered before decryption.
- [ ] Backups include ciphertext, object files and wrapped keys, but not the offline recovery passphrase.
- [ ] Database rollback cannot point at a newer incompatible object manifest without a detected error.
- [ ] Deleted references do not delete shared content until reference-aware GC confirms zero live refs and retention expiry.
- [ ] Crash between SMTP acceptance and sent-finalization preserves the existing send recovery contract.
- [ ] No telemetry dimension contains raw blind-index digests that permit cross-workspace correlation.
