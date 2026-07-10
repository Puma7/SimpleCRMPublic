# SPIKE: GDPR erasure / anonymization — counterpart to the existing export

> **Status:** direction spike (plan 022). This document is a decision aid, not a
> shipped feature. It proposes a design and enumerates the open questions a human
> must answer before a feature plan is written. The accompanying prototype
> (`electron/email/email-gdpr-erase.ts`) is a **dry-run preview by default**,
> **not wired into any IPC channel or HTTP route**, and exercised only from its
> unit test.

## Problem & regulatory frame

SimpleCRM ships a GDPR **data export** ("Auskunft", Art. 15 DSGVO) on **both**
editions: the Electron standalone app (`electron/email/email-gdpr-export.ts`,
`exportEmailGdprPackage()`) and the multi-tenant server
(`packages/server/src/mail-gdpr-export.ts`, `createPostgresEmailGdprExportPort()`).
There is **no counterpart for erasure / anonymization** (Art. 17 DSGVO, "Recht
auf Löschung"). A product-source grep for
`anonymize|anonymise|erasure|erase|forget|scrub` returns exactly one benign hit
(a code comment in `packages/server/src/api/returns-routes.ts`), and the only
`redact` usages are for secrets/logs/URLs — never data-subject erasure. This is a
one-directional GDPR surface: the product can *hand out* a person's data but
cannot *erase* it. For a CRM sold into the German market that gap is a
compliance risk, and building erasure blind is dangerous because it is
destructive, touches thread/FK integrity, and the regulatory scope is genuinely
open. This spike de-risks the decision.

## Data-subject model — how a subject is identified

The export walks the whole mailbox and hands out everything; an erasure must
instead **target one data subject**. Two proposed selectors (either or both):

- **By email address(es).** A subject is matched by one or more addresses that
  appear in `email_messages.from_json` / `to_json` / `cc_json`. The prototype
  uses a naive `LIKE '%addr%'` substring match against those JSON columns; a
  production implementation must parse the JSON address structures and match on
  the normalized address, not a substring (see open questions).
- **By `customer_id`.** `email_messages.customer_id` links a message to a CRM
  contact (`REFERENCES customers(id) ON DELETE SET NULL`). Erasing "this
  customer's mail" is expressible as `customer_id = ?`.

The two selectors are OR-combined: a message is in scope if it matches any given
address **or** the given `customer_id`. Which selector is authoritative, how
addresses are normalized, and whether erasure extends from the mail module into
the `customers` record itself are **open questions** (below).

## Table → action mapping

Mirrors the exact table set the export touches (see
`electron/email/email-gdpr-export.ts` and the schema DDL in
`electron/database-schema.ts`). For each, the **proposed default is
anonymize-in-place**; the hard-delete alternative is shown for comparison.

| Table / store | PII columns | Default (anonymize-in-place) | Alt (hard-delete) |
|---|---|---|---|
| `email_messages` | `subject, from_json, to_json, cc_json, snippet, body_text, body_html, attachments_json, raw_headers, raw_rfc822_b64` | overwrite each with a tombstone (`'[erased]'` for text/addresses; `NULL` for `attachments_json`, `raw_headers`, `raw_rfc822_b64`); **keep** `id, account_id, folder_id, thread_id, imap_thread_id, date_received, created_at` | delete row → **cascades** to notes/attachments/categories/tags/read-receipts |
| `email_internal_notes` | `body` (`TEXT NOT NULL`) | set `body = '[erased]'` | removed via `message_id ON DELETE CASCADE` |
| `email_message_attachments` | file at `storage_path`; `filename_display`, `content_sha256`, `size_bytes` | **collect `storage_path` for post-commit unlink**, then tombstone the row: `filename_display = '[erased]'`, `content_sha256 = NULL`, `size_bytes = 0`, and `storage_path = '[erased]'` — a **non-null** tombstone, because the column is `TEXT NOT NULL`, so it must **never** be set to `NULL`; keep the row | removed via `message_id ON DELETE CASCADE` |
| `email_workflow_runs` | `log_json` (may embed message bodies / addresses) | set `log_json = NULL` | keep row (`message_id` is `ON DELETE SET NULL`) |
| `customers` (CRM contact) | name / email / phone / address etc. | **open question** — mail-PII-only vs. erasing the full contact record and its deals/orders | — |

### Why anonymize-in-place is the default

Hard-deleting an `email_messages` row triggers the FK cascade shape baked into
the schema: `email_internal_notes`, `email_message_attachments`, categories,
tags, and read receipts are all `ON DELETE CASCADE` on `message_id`, while
`email_workflow_runs.message_id` and `email_threads.root_message_id` are
`ON DELETE SET NULL`. A hard delete therefore silently removes related rows and
nulls out thread anchors, disturbing thread structure
(`thread_id`, `email_threads`, `email_thread_edges`) and leaving `SET NULL`
churn behind. Anonymize-in-place keeps the row skeleton (`id`, `account_id`,
`thread_id`, `date_received`) so threads stay intact and no FK is disturbed,
while every free-text / address column is overwritten with a tombstone. It is
the safer default; hard-delete should be an explicit, per-request opt-in if it
ships at all.

## Operation shape

A proposed API that mirrors the export's `plan → execute` structure:

- `planSubjectErasure(input: { emails?: string[]; customerId?: number }) → ErasurePlan`
  — a **pure preview**. It reads only: it runs the message batch walk (reusing
  the loop shape and `MESSAGE_BATCH = 2000` from the export), counts the affected
  `email_internal_notes`, `email_message_attachments` (collecting every
  `storage_path` that a real erase would unlink), and `email_workflow_runs`, and
  returns `{ selector, messageIds, counts, attachmentFiles }`. **No writes, no
  unlinks.**
- `eraseSubject(input, options: { dryRun?: boolean } = {}) → ErasureResult`
  where **`dryRun` defaults to `true`**. In dry-run it returns
  `{ dryRun: true, plan }` and touches nothing. Only an explicit `dryRun: false`
  performs the mutation, in **two distinct phases**:

  1. **Transactional DB anonymization.** Electron uses an explicit
     `BEGIN TRANSACTION` … `COMMIT` / `ROLLBACK` (per
     `electron/sqlite-service.ts`); the server follow-up would use
     `withWorkspaceTransaction` (`packages/server/src/db/workspace-context.ts`).
     Inside the transaction every in-scope row is tombstoned per the mapping
     above, including setting each attachment row's `storage_path` to a
     **non-null sentinel** (`'[erased]'`) — never `NULL`, the column is
     `TEXT NOT NULL`. The real on-disk paths were already captured in the plan.
  2. **Post-commit file cleanup.** File deletion is a **separate step that runs
     only after the transaction commits** — it is **not** inside the
     transaction. A filesystem `unlink` is not rollback-safe: a `ROLLBACK`
     restores the rows but cannot un-delete files, which would leave restored
     rows pointing at missing storage. Therefore the collected `storage_path`s
     are unlinked **after** `COMMIT`. If an unlink then fails, it is logged as an
     orphaned-file warning and does **not** corrupt the erasure — the committed
     row already points at the `'[erased]'` sentinel, so nothing references the
     leaked file. (An eventual implementation should queue such orphans for a
     sweep job.)

  Ordering is the load-bearing correctness property: **commit the DB tombstones
  first, unlink files second.** The reverse (unlink then commit) risks a rollback
  restoring rows that reference already-deleted files.

Every apply must also produce an **audit record** (who / when / subject selector
/ affected counts). Where it is stored is an open question: a new dedicated audit
table (a schema migration — explicitly out of scope for this spike) versus an
append-only log file. The prototype emits the audit record as an in-memory object
and a log line only; it persists nothing, because persisting would require a
schema change this spike must not make.

## Reuse

The prototype lifts directly from the export so the two stay in step:

- `MESSAGE_BATCH = 2000` and `NOTES_BATCH = 5000` batching constants
  (`electron/email/email-gdpr-export.ts:16-17`).
- The `ORDER BY id ASC LIMIT ? OFFSET ?` message batch loop shape
  (`email-gdpr-export.ts:91-111`).
- The attachment store's on-disk model: each `email_message_attachments.storage_path`
  is the file to unlink (`electron/email/email-message-attachments-store.ts`).
- The same table constants (`EMAIL_MESSAGES_TABLE`, etc.) from
  `electron/database-schema.ts`, and the same `getDb()` accessor.

## Cross-edition plan

- **Electron first** (prototyped here): `planSubjectErasure` / `eraseSubject`
  over `better-sqlite3`, single tenant.
- **Server as a follow-up** (design only, **not** implemented in this spike): a
  new `EmailGdprEraseApiPort` mirroring `EmailGdprExportApiPort`
  (`packages/server/src/api/types.ts:2383-2392`), constructed in
  `packages/server/src/server.ts` alongside the export port, running inside
  `withWorkspaceTransaction` (`packages/server/src/db/workspace-context.ts:45`)
  so RLS scopes every statement to the workspace, and exposed via a
  `POST /api/v1/email/gdpr-erase` route mirroring the export route
  (`packages/server/src/api/mail-routes.ts:295`, handler `:1422`). The Electron
  edition would eventually wire `eraseSubject` into a new `IPCChannels.Email.*`
  channel with a Zod schema (the export's pattern is
  `shared/ipc/email-schemas.ts:1417-1420`). **None of this wiring is done in the
  spike.**

## Open questions

These are the required output of the spike — a human must resolve them before a
feature plan is written:

1. **Regulatory scope.** Does erasure cover only the mail module, or also the CRM
   `customers` record and its related deals/orders/returns? The mail module is
   the natural first slice, but a subject's Art. 17 request is usually about the
   whole contact.
2. **Hard-delete vs. anonymize-in-place as the shipped default**, and whether the
   operator may choose per request. This spike recommends anonymize-in-place;
   confirm that satisfies the legal interpretation ("Löschung" vs.
   "Anonymisierung").
3. **Attachment rows: keep-anonymized vs. cascade-delete.** The default tombstones
   the row and unlinks the file; an alternative deletes the row outright. Both
   remove the PII; they differ in referential/thread bookkeeping.
4. **Legal-hold / retention exceptions.** Invoices, tax records, and other
   documents subject to statutory retention (e.g. §147 AO, 10-year retention)
   must **survive** an erasure request. How are those carve-outs identified and
   excluded from the walk?
5. **Audit storage & its own PII.** Where does the audit record live (new table
   vs. append-only log), and does storing the subject selector (email/customer)
   itself re-introduce the PII the operation was meant to erase? The audit may
   need its own retention/anonymization policy.
6. **Cross-edition parity vs. Electron-first.** Ship Electron first and let the
   server follow, or block until both editions have parity? Compliance is often
   an all-or-nothing posture per deployment.
7. **Address matching semantics.** The prototype's `LIKE '%addr%'` substring
   match over the JSON columns is intentionally naive; production must parse the
   address JSON and match normalized addresses to avoid false positives (e.g.
   `a@x.de` matching `ba@x.def`) and false negatives (display-name-only rows).
8. **FTS consistency.** `email_messages_fts`
   (`electron/database-schema.ts:370-384`) is an external-content FTS index over
   `email_messages`; after anonymization (column overwrite) or hard delete the
   index must be kept in sync or it will surface erased text. The spike flags
   this; it does not solve it.
9. **Reversibility / confirmation UX.** The operation is irreversible and
   destructive. What confirmation gate (typed confirmation, preview-then-apply,
   two-person approval) is required, and is the dry-run preview surfaced to the
   operator before apply?

## Recommendation

Ship **anonymize-in-place** as the default: overwrite the PII columns with a
`'[erased]'` / `NULL` tombstone while preserving each row's structural skeleton,
so thread integrity and FK safety are never disturbed. Make the operation
**dry-run-first** (`eraseSubject` defaults to `dryRun: true`; the preview
enumerates exactly what would change and which files would be unlinked),
**transactional** (commit the DB tombstones, *then* unlink files post-commit —
never the reverse), and **audited** (who/when/selector/counts). Prototype and
ship the **Electron edition first**, then mirror it on the server behind a new
`EmailGdprEraseApiPort` + `POST /api/v1/email/gdpr-erase` route running inside
`withWorkspaceTransaction`. Before any feature plan is written, a human must
answer the top two open questions: **(1) the regulatory scope** — mail-only vs.
the whole `customers` record — and **(2) hard-delete vs. anonymize-in-place** as
the legally sufficient default, plus the **legal-hold carve-outs** that must
survive an erasure.
