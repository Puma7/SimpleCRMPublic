# Plan 022: SPIKE: GDPR erasure/anonymization counterpart to the existing export

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in the `README.md` of the directory this plan lives in (`plans/README.md`) —
> unless a reviewer dispatched you and told you they maintain the index (for
> this plan, the advisor maintains `plans/README.md`; do **not** create or edit
> it).
>
> **This is a DIRECTION SPIKE, not a build-everything plan.** Your deliverable
> is a written design + a runnable dry-run prototype + an enumerated list of
> open questions, NOT a shipped feature. Do not wire anything into production
> IPC channels or HTTP routes. Do not implement the server edition. Do not add a
> schema migration. If a step tempts you to "just finish the feature," stop —
> that is out of scope (see Scope).
>
> **Drift check (run first)**:
> `git diff --stat f24fb27..HEAD -- docs/design/gdpr-erasure-spike.md electron/email/email-gdpr-erase.ts tests/mail/email-gdpr-erase.test.ts`
> These are the files this plan creates; on a fresh branch the diff is empty
> (they do not exist at `f24fb27`), which is expected. **Then also run the
> reference drift check** in "Current state" against the read-only files whose
> excerpts this plan mirrors. If any reference excerpt no longer matches the
> live code, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: L
- **Risk**: MED
- **Depends on**: none
- **Category**: direction
- **Planned at**: commit `f24fb27`, 2026-07-10

## Why this matters

SimpleCRM ships a GDPR **data export** ("Auskunft", Art. 15 DSGVO) on **both**
editions — the Electron standalone app and the multi-tenant server — but there
is **no counterpart for erasure / anonymization** (Art. 17 DSGVO, "Recht auf
Löschung"). A grep across product source for `anonymize|erasure|forget|scrub`
returns only log-secret redaction and URL redaction (see proof in Current
state); there is no operation that removes or anonymizes a data subject's
personal data on request. For a CRM sold into the German market this is a
one-directional GDPR surface: the product can *hand out* a person's data but
cannot *erase* it. Building erasure blind is risky — it is destructive, it
touches thread/FK integrity, and the regulatory scope (hard-delete vs
anonymize-in-place, which tables, which edition first) is genuinely open. This
spike de-risks that: it produces a concrete design, a **dry-run/preview
prototype** on the simpler (Electron) edition that enumerates exactly what an
erasure would touch **without mutating anything**, and a written recommendation
with the open questions surfaced so a human can decide scope before a feature
plan is written.

## Current state

### The two exports this erasure must mirror (READ-ONLY reference files)

**Electron edition** — `electron/email/email-gdpr-export.ts`, exports
`exportEmailGdprPackage()`. Synchronous `better-sqlite3` via `getDb()`, single
tenant, streams a ZIP with `archiver`. Batching constants and the table set it
walks (`electron/email/email-gdpr-export.ts:16-19`, `:41-43`):

```ts
const MESSAGE_BATCH = 2000;
const NOTES_BATCH = 5000;
const RUNS_LIMIT = 5000;
const MAX_EXPORT_ATTACH_BYTES = 4 * 1024 * 1024 * 1024;
...
export async function exportEmailGdprPackage(
  options: { skipAttachments?: boolean } = {},
): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
```

The message batch loop to reuse for the erase walk (`:91-111`):

```ts
      const messagesStream = new PassThrough();
      archive.append(messagesStream, { name: 'messages_index.jsonl' });
      let offset = 0;
      for (;;) {
        const batch = db
          .prepare(
            `SELECT id, account_id, subject, snippet, date_received, ticket_code, customer_id, assigned_to,
                    folder_kind, archived, seen_local, has_attachments, thread_id, imap_thread_id, created_at
             FROM ${EMAIL_MESSAGES_TABLE}
             ORDER BY id ASC
             LIMIT ? OFFSET ?`,
          )
          .all(MESSAGE_BATCH, offset) as Record<string, unknown>[];
        if (batch.length === 0) break;
```

The attachment walk it does (`:143-159`) — the erase prototype must find the
same on-disk files to enumerate for deletion:

```ts
      if (!options.skipAttachments) {
        const attRoot = getAttachmentsRootForExport();
        fs.mkdirSync(attRoot, { recursive: true });
        const attBytes = dirSizeBytes(attRoot);
        ...
          archive.directory(attRoot, 'attachments');
```

**Server edition** — `packages/server/src/mail-gdpr-export.ts`, exports
`createPostgresEmailGdprExportPort()` returning an `EmailGdprExportApiPort`.
Kysely/Postgres, multi-tenant, everything runs inside a workspace-scoped
transaction (`packages/server/src/mail-gdpr-export.ts:40-44`, `:131-151`):

```ts
export function createPostgresEmailGdprExportPort(
  options: PostgresEmailGdprExportPortOptions,
): EmailGdprExportApiPort {
  return {
    async export(input): Promise<EmailGdprExportResult> {
...
  await withWorkspaceTransaction(
    input.db,
    { workspaceId: input.workspaceId, role: 'system' },
    async (trx) => {
      await appendAccounts(trx, input.workspaceId, input.archive);
      await appendMessageIndex(trx, input.workspaceId, input.archive);
      await appendInternalNotes(trx, input.workspaceId, input.archive);
      await appendWorkflows(trx, input.workspaceId, input.archive);
      await appendWorkflowRuns(trx, input.workspaceId, input.archive);
```

### The table set the export touches (the set an erasure must mirror)

From the two exports above, the personal-data-bearing tables are:
`email_accounts`, `email_messages`, `email_internal_notes`, `email_workflows`
(metadata only), `email_workflow_runs`, and `email_message_attachments` (+ the
on-disk attachment files). Table constants live in
`electron/database-schema.ts:20-36`
(`EMAIL_MESSAGES_TABLE = 'email_messages'`, etc.).

The **PII-bearing columns** the erasure must reason about (Electron schema DDL):

- `email_messages` (`electron/database-schema.ts:318-366`) — free-text and
  address PII in: `subject`, `from_json`, `to_json`, `cc_json`, `snippet`,
  `body_text`, `body_html`, `attachments_json`, `raw_headers`,
  `raw_rfc822_b64`. Structural/FK columns to **preserve** for thread integrity:
  `id`, `account_id`, `folder_id`, `thread_id`, `imap_thread_id`,
  `date_received`, `created_at`. FK links:
  `customer_id REFERENCES customers(id) ON DELETE SET NULL`,
  `assigned_to REFERENCES email_team_members(id) ON DELETE SET NULL`.
- `email_internal_notes` (`electron/database-schema.ts:570-578`) —
  `body TEXT NOT NULL` (free text), `message_id ... ON DELETE CASCADE`.
- `email_message_attachments` (`electron/database-schema.ts:810-822`) —
  `filename_display TEXT NOT NULL`, `content_type`, `size_bytes`,
  `storage_path TEXT NOT NULL` (points at the on-disk file), `content_sha256`,
  `message_id ... ON DELETE CASCADE`.
- `email_workflow_runs` (`electron/database-schema.ts:824-837`) —
  `log_json TEXT` (may embed message bodies / addresses),
  `message_id ... ON DELETE SET NULL`.

Note the FK cascade shape: **hard-deleting an `email_messages` row cascades** to
`email_internal_notes`, `email_message_attachments`, categories, tags, read
receipts, etc. (all `ON DELETE CASCADE` on `message_id`), while
`email_workflow_runs.message_id` and `email_threads.root_message_id` are
`ON DELETE SET NULL`. This is exactly why "anonymize-in-place" (blank the PII
columns, keep the row) is the safer default the design should center on — it
preserves thread structure and dangling-FK safety that a hard delete would
disturb.

### How the attachment store resolves on-disk files (Electron)

`electron/email/email-message-attachments-store.ts:20-24` — attachment root:

```ts
function attachmentsRoot(): string {
  const root = path.join(app.getPath('userData'), 'email-attachments');
  fs.mkdirSync(root, { recursive: true });
  return root;
}
```

`storage_path` on each `email_message_attachments` row is the file to unlink
when erasing that attachment.

### Transaction exemplars (use these patterns; do not invent your own)

- **Electron / better-sqlite3** — explicit `BEGIN`/`COMMIT`/`ROLLBACK` around a
  multi-statement mutation (`electron/sqlite-service.ts:1711-1743`):

```ts
    const db = getDb();
    db.prepare('BEGIN TRANSACTION').run();
    try {
        ...
        db.prepare('COMMIT').run();
    } // catch → db.prepare('ROLLBACK').run();
```

  (`better-sqlite3` also offers `db.transaction(fn)`; either is acceptable in
  the prototype. Match whichever the reviewer's exemplar shows — the explicit
  form above is what the current codebase uses.)

- **Server / Kysely** — `withWorkspaceTransaction`
  (`packages/server/src/db/workspace-context.ts:45-56`) wraps
  `db.transaction().execute(...)` and applies the RLS session. The server-side
  erasure (a follow-up, NOT this spike) would run inside this.

### How the export is wired today (the pattern an eventual erase would mirror — do NOT wire the spike)

- **Electron IPC**: `electron/ipc/email.ts:2864-2873` registers
  `IPCChannels.Email.EmailGdprExport` → `exportEmailGdprPackage(...)`. Channel
  string `EmailGdprExport: 'email:gdpr-export'` at `shared/ipc/channels.ts:373`;
  Zod schema at `shared/ipc/email-schemas.ts:1417-1420`.
- **Server HTTP**: `packages/server/src/api/mail-routes.ts:295-296` routes
  `/api/v1/email/gdpr-export` → `handleEmailGdprExport` (`:1422`); port type
  `EmailGdprExportApiPort` at `packages/server/src/api/types.ts:2383-2392`; port
  constructed at `packages/server/src/server.ts:496`.

**The spike does NOT touch any of these wiring points.** They are documented so
your design's "how it would ship" section is accurate.

### Proof that no erasure exists today

`grep -rniE "\b(anonymize|anonymise|erasure|erase|forget|scrub)\b"` across
`electron/`, `packages/server/src/`, `src/`, `shared/` (excluding
`node_modules`, `dist/`, `*.d.ts`) returns **one** product-source hit, and it is
a benign code comment — `packages/server/src/api/returns-routes.ts:507`
(`// … makes it impossible to forget the token …`) — not an erasure operation.
Separately, a `redact` search shows the only redaction usages are for
secrets/logs/URLs, never data-subject erasure:
`electron/diagnostics/app-log-store.ts:24-27` (`redactSecrets`),
`packages/server/src/diagnostics/server-log-store.ts:130-133` (same), and
`electron/auth/setup-token.ts:75` (`redactOneTimeSetupTokenInDatabase`); the
export also writes an `accounts_redacted.json` label. None erase a data subject.
This confirms the one-directional GDPR surface (Art. 15 export, no Art. 17 erasure).

### Reference drift check (run after the primary drift check)

Run and confirm the excerpts above still match:

```
git diff --stat f24fb27..HEAD -- \
  electron/email/email-gdpr-export.ts \
  packages/server/src/mail-gdpr-export.ts \
  electron/database-schema.ts \
  electron/email/email-message-attachments-store.ts \
  electron/ipc/email.ts \
  packages/server/src/api/types.ts
```

If any of these changed since `f24fb27`, open the file and re-verify the quoted
excerpt before proceeding; on a real mismatch, STOP and report.

## Commands you will need

| Purpose            | Command                                             | Expected on success |
|--------------------|-----------------------------------------------------|---------------------|
| Install            | `pnpm install --frozen-lockfile`                    | exit 0              |
| Typecheck (electron main) | `npx tsc -p tsconfig.electron.json --noEmit` | exit 0, no errors   |
| Lint               | `pnpm run lint`                                     | exit 0 (eslint, `--max-warnings 0`) |
| Mail tests         | `pnpm run test:mail`                                | all pass            |
| Build (optional sanity) | `pnpm run build`                               | exit 0              |

Notes:
- This repo uses **pnpm** (CI: `.github/workflows/ci.yml`). Do not use `npm ci`.
- There is **no `pnpm run typecheck` script yet** (a separate plan 002 adds it).
  Until then, type-check the Electron-main code — where the prototype lives —
  with `npx tsc -p tsconfig.electron.json --noEmit`.
- The prototype's test lives under `tests/mail/`, which is covered by
  `pnpm run test:mail` (config `jest.mail.config.cjs`) — the same runner as the
  existing `tests/mail/email-gdpr-export.test.ts`.

## Scope

**In scope** (the only files you create/modify):

- `docs/design/gdpr-erasure-spike.md` (create) — the design + open questions +
  recommendation. This is the primary deliverable.
- `electron/email/email-gdpr-erase.ts` (create) — the dry-run/preview prototype
  (Electron edition only). Defaults to preview; the apply path is guarded and
  NOT wired into IPC.
- `tests/mail/email-gdpr-erase.test.ts` (create) — proves the preview runs and
  mutates nothing.

Create `docs/design/` if it does not exist.

**Out of scope** (do NOT touch, even though they look related):

- `electron/email/email-gdpr-export.ts`, `packages/server/src/mail-gdpr-export.ts`
  — the working exports. Read-only references; changing them is not part of this
  spike.
- `electron/ipc/email.ts`, `shared/ipc/channels.ts`, `shared/ipc/email-schemas.ts`
  — do **not** register an IPC channel. The prototype must stay un-invokable
  from the production UI; it is exercised only from its test.
- `packages/server/**` — the server-edition erasure is a *follow-up* the design
  describes but does **not** implement in this spike.
- `electron/database-schema.ts` and any migration file — no schema changes. If
  the design concludes an audit table is needed, write that as an open
  question / follow-up, do not add it here.
- The public/response shape of the export — untouched.

## Git workflow

- Branch: `advisor/022-spike-gdpr-erasure-counterpart`
- Commit per logical unit; conventional-commit style (matches this repo's
  history, e.g. `fix(review): keep raw-headers / .eml export out of the mail
  read bucket`). Suggested messages:
  - `docs(gdpr): spike design for data-subject erasure/anonymization`
  - `feat(gdpr): dry-run erasure preview prototype (electron, unwired)`
  - `test(gdpr): cover erasure preview (mutates nothing)`
- Do **NOT** push or open a PR unless the operator instructs it.

## Steps

### Step 1: Confirm the ground truth (investigate)

Run the reference drift check (see Current state) and the erasure-absence grep
to confirm nothing has changed since `f24fb27`:

```
grep -rniE "\b(anonymize|anonymise|erasure|erase|forget|scrub)\b" \
  --include='*.ts' electron packages/server/src src shared \
  | grep -viE 'node_modules|dist/|\.d\.ts'
```

Read (do not modify) the four reference files quoted in Current state so you
understand the export's table set, batching, and attachment walk before you
design the mirror.

**Verify**: at commit `f24fb27` this grep returns exactly **one** benign hit — a
code comment at `packages/server/src/api/returns-routes.ts:507`
(`// … makes it impossible to forget the token …`) — and **no** erasure or
anonymization *function, route, or handler*. That single comment hit is expected.
If the grep now returns a real data-subject erasure operation (an actual
function/endpoint, not a comment), STOP — the finding may already be addressed.

### Step 2: Write the design document

Create `docs/design/gdpr-erasure-spike.md`. It MUST contain these sections
(this document is the spike's main output — a human reads it to decide scope):

1. **Problem & regulatory frame** — one paragraph: Art. 15 export exists on both
   editions; Art. 17 erasure does not. Cite the two export files.
2. **Data-subject model** — how a subject is identified for erasure. Propose:
   by one or more email addresses (matched in `email_messages.from_json` /
   `to_json` / `cc_json`) and/or by `customer_id`. State the ambiguity as an
   open question (below).
3. **Table → action mapping** — a table mirroring the export's set. For each,
   the proposed default action:

   | Table / store | PII columns | Default (anonymize-in-place) | Alt (hard-delete) |
   |---|---|---|---|
   | `email_messages` | `subject, from_json, to_json, cc_json, snippet, body_text, body_html, attachments_json, raw_headers, raw_rfc822_b64` | overwrite each with a tombstone (`'[erased]'` / `NULL`); keep `id, account_id, thread_id, date_received` | delete row → cascades to notes/attachments |
   | `email_internal_notes` | `body` | set `body='[erased]'` | cascade on message delete |
   | `email_message_attachments` | file at `storage_path`, `filename_display`, `content_sha256` | unlink file; `filename_display='[erased]'`, `content_sha256=NULL`, `size_bytes=0`; keep row | cascade on message delete |
   | `email_workflow_runs` | `log_json` | set `log_json=NULL` | keep row (`message_id` is `SET NULL`) |
   | `customers` (contact) | name/email/etc. | open question — mail-PII-only vs full contact record | — |

   Explain **why anonymize-in-place is the default**: it preserves thread
   structure (`thread_id`, `email_threads`, `email_thread_edges`) and avoids the
   FK cascade/`SET NULL` churn a hard delete triggers (see the cascade shape
   noted in Current state).
4. **Operation shape** — a proposed API mirroring the export:
   `planSubjectErasure(input) → ErasurePlan` (pure preview) and
   `eraseSubject(input, { dryRun }) → ErasureResult` where **`dryRun` defaults
   to `true`**. Describe execution in **two phases**: (a) the DB anonymization is
   transactional (Electron `BEGIN/COMMIT/ROLLBACK`, Server
   `withWorkspaceTransaction`) and clears each attachment row's metadata /
   `storage_path`; (b) file deletion is a **separate post-commit cleanup step**,
   NOT inside the transaction — a filesystem `unlink` is not rollback-safe (a
   `ROLLBACK` restores the rows but cannot un-delete files, leaving rows pointing
   at missing storage). So unlink the collected paths only **after** the DB
   transaction commits; a failed unlink then leaks an orphaned file (log it /
   queue for cleanup) but does not corrupt the erasure, because the committed rows
   no longer reference it. Also require an **audit record** (who/when/subject
   selector/affected counts) — note where it would be stored (open question: new
   audit table vs append-only log file).
5. **Reuse** — call out that the message/notes batching constants
   (`MESSAGE_BATCH=2000`, `NOTES_BATCH=5000`) and the attachment walk are lifted
   from the export.
6. **Cross-edition plan** — Electron first (prototyped here), Server as a
   follow-up via a new `EmailGdprEraseApiPort` mirroring `EmailGdprExportApiPort`
   (`packages/server/src/api/types.ts:2383-2392`) and a
   `POST /api/v1/email/gdpr-erase` route mirroring the export route
   (`packages/server/src/api/mail-routes.ts:295`, `:1422`). Do not implement.
7. **Open questions** (enumerate explicitly — this is a required output):
   - Exact regulatory scope: does erasure cover only the mail module, or the CRM
     `customers` record and related deals/orders too?
   - Hard-delete vs anonymize-in-place as the shipped default (and whether the
     operator can choose per request).
   - Attachment rows: keep-anonymized vs cascade-delete.
   - Legal-hold / retention exceptions (invoices, tax records) that must survive
     an erasure request.
   - Audit storage location and whether it itself contains PII (the subject
     selector).
   - Cross-edition parity vs shipping Electron first.
   - Reversibility / confirmation UX given the operation is destructive.
8. **Recommendation** — 3–6 sentences: recommended default (anonymize-in-place,
   dry-run-first, transactional, audited), edition order, and the top 2 open
   questions a human must answer before a feature plan is written.

**Verify**: `test -f docs/design/gdpr-erasure-spike.md` → exit 0, and the file
contains headings for the table→action mapping, the operation shape, and the
open-questions list (`grep -c '^##' docs/design/gdpr-erasure-spike.md` returns
≥ 6).

### Step 3: Build the dry-run/preview prototype (Electron, unwired)

Create `electron/email/email-gdpr-erase.ts`. It imports the same table
constants and `getDb` the export uses. It exports:

- A pure preview:
  `export function planSubjectErasure(input: { emails?: string[]; customerId?: number }): ErasurePlan`
  that **reads only** — runs the message batch walk (reuse the loop shape from
  `email-gdpr-export.ts:91-111`, `MESSAGE_BATCH = 2000`) to find matching
  `email_messages` rows, counts affected `email_internal_notes`,
  `email_message_attachments` (collecting each `storage_path` that would be
  unlinked), and `email_workflow_runs`. It returns a plan object:
  `{ messageIds: number[]; counts: { messages; notes; attachments; workflowRuns }; attachmentFiles: string[] }`.
  It performs **no writes and unlinks no files.**
- A guarded apply:
  `export function eraseSubject(input, options: { dryRun?: boolean } = {}): ErasureResult`
  where `dryRun` **defaults to `true`**. When `dryRun` is `true` (or unset) it
  returns `{ dryRun: true, plan }` and touches nothing. Only when `dryRun` is
  explicitly `false` does it open a transaction (`db.prepare('BEGIN
  TRANSACTION').run()` … `COMMIT` / `ROLLBACK`, per
  `electron/sqlite-service.ts:1711-1743`) and anonymize in place per the
  table→action mapping. **Unlink the attachment files only AFTER that transaction
  commits** — not inside it (a `ROLLBACK` cannot un-delete files). Collect the
  `storage_path`s during the transaction, `COMMIT`, then unlink; wrap each unlink
  so a failure logs an orphaned-file warning instead of throwing (the row is
  already anonymized, so a leaked file is not a data-integrity problem). Keep the
  apply path minimal — this is a prototype, not the shipped feature. Add a top-of-file comment: `// SPIKE PROTOTYPE — not
  wired into IPC. Preview is the supported path; apply is dry-run by default.`

Do **not** import this module from `electron/ipc/email.ts` or register any
channel.

**Verify**:
- `npx tsc -p tsconfig.electron.json --noEmit` → exit 0.
- `grep -rn "email-gdpr-erase" electron/ipc shared` → **no matches** (proves the
  prototype is unwired).

### Step 4: Test the preview (proves it mutates nothing)

Create `tests/mail/email-gdpr-erase.test.ts`, modeled structurally on
`tests/mail/email-gdpr-export.test.ts` (same `createSqliteMock` helper from
`./helpers/sqlite-mock`, same `jest.mock('../../electron/sqlite-service', () =>
({ getDb: () => db }))` pattern). Cover:

- **Preview enumerates**: given a mocked DB returning matching messages, notes,
  and attachments, `planSubjectErasure({ emails: ['a@x.de'] })` returns the
  expected `counts` and an `attachmentFiles` list, and the sqlite mock records
  **only `SELECT`** statements (no `UPDATE`/`DELETE`, no `BEGIN`).
- **`eraseSubject` defaults to dry-run**: calling it without `options` returns
  `{ dryRun: true, ... }` and performs no write statements and no `fs.unlink`.
- **Explicit apply commits, then unlinks**: calling with `{ dryRun: false }`
  issues a `BEGIN TRANSACTION` and a matching `COMMIT` (assert via the mock's
  recorded statements), and unlinks the collected attachment files (mock
  `fs.unlink` / `fs.rmSync`) **after** the `COMMIT`, not before or inside the
  transaction (assert the unlink calls occur after the recorded `COMMIT`).
- **Rollback leaves files untouched**: on a thrown SQL error mid-apply, assert
  `ROLLBACK` is issued AND `fs.unlink`/`fs.rmSync` was **never** called (file
  deletion is post-commit, so a rolled-back apply deletes nothing).

**Verify**: `pnpm run test:mail` → all pass, including the new
`tests/mail/email-gdpr-erase.test.ts` cases.

### Step 5: Final lint + write-up

Run lint and confirm the design doc's recommendation and open questions are
complete.

**Verify**: `pnpm run lint` → exit 0. `git status --porcelain` shows only the
three in-scope files created.

## Test plan

- New test file: `tests/mail/email-gdpr-erase.test.ts`, structural pattern
  copied from `tests/mail/email-gdpr-export.test.ts` (sqlite mock + electron
  mock; no real DB, no real filesystem writes).
- Cases (list): (1) preview enumerates counts + attachment files; (2) preview
  issues only SELECTs — **no mutation**; (3) `eraseSubject` default is dry-run
  and mutates nothing; (4) explicit `{ dryRun: false }` wraps writes in
  `BEGIN`/`COMMIT` and unlinks files **after** the commit; (5) error path issues
  `ROLLBACK` and unlinks **nothing**.
- Verification: `pnpm run test:mail` → all pass, including the ≥ 5 new cases.
- This is a spike: test coverage proves the **preview is non-destructive**, not
  that a full feature is production-ready.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `docs/design/gdpr-erasure-spike.md` exists and contains the table→action
      mapping, the operation shape (`planSubjectErasure` / `eraseSubject` with
      `dryRun` default), the enumerated open-questions list, and a
      recommendation (`grep -c '^##' docs/design/gdpr-erasure-spike.md` ≥ 6).
- [ ] `electron/email/email-gdpr-erase.ts` exists, exports a read-only
      `planSubjectErasure` and a `dryRun`-defaulting `eraseSubject`, and is
      **not** imported by any IPC/wiring file
      (`grep -rn "email-gdpr-erase" electron/ipc shared` → no matches).
- [ ] `npx tsc -p tsconfig.electron.json --noEmit` exits 0.
- [ ] `pnpm run lint` exits 0.
- [ ] `pnpm run test:mail` passes, including the new erasure-preview tests.
- [ ] No files outside the in-scope list are modified (`git status --porcelain`
      shows only the three created files).
- [ ] `plans/README.md` status row updated (unless the advisor maintains it).

**Explicitly NOT part of Done (deferred by design):** no IPC channel or HTTP
route registered; no server-edition (`packages/server`) implementation; no
schema migration or audit table created; the erasure feature is **not** shipped.
Those are follow-ups the design document proposes.

## STOP conditions

Stop and report back (do not improvise) if:

- Any reference excerpt in "Current state" no longer matches the live code (the
  export, schema, attachment store, or wiring drifted since `f24fb27`).
- The Step-1 grep reveals an erasure/anonymization operation already exists —
  the finding may be resolved; report before building a duplicate.
- You cannot exercise the dry-run preview from its test **without** wiring it
  into an IPC channel or HTTP route. The prototype must be testable in
  isolation; if it is not, the design is wrong — stop and reconsider rather than
  wiring production surface.
- The prototype would need a schema migration (e.g. an audit table) just to run
  its preview. Record it as an open question and STOP; do not add a migration.
- At any point the apply path could run against a real user database or delete
  real attachment files (i.e. anything other than the test's mock/temp DB).
  Erasure is destructive — STOP.
- Any step's verification fails twice after a reasonable fix attempt.

## Maintenance notes

For the human/agent who owns this after the spike lands:

- This is a **spike**. The deliverable is a decision aid, not a feature. Before
  writing the feature plan, a human must answer the top open questions
  (regulatory scope; hard-delete vs anonymize; legal-hold exceptions;
  cross-edition order).
- If/when the feature is built: the server edition must mirror
  `EmailGdprExportApiPort` (`packages/server/src/api/types.ts:2383-2392`) with a
  new `EmailGdprEraseApiPort`, run inside `withWorkspaceTransaction`
  (`packages/server/src/db/workspace-context.ts:45`), and register a
  `POST /api/v1/email/gdpr-erase` route mirroring the export route
  (`packages/server/src/api/mail-routes.ts:295`, `:1422`). The Electron edition
  would wire `eraseSubject` into a new `IPCChannels.Email.*` channel with a Zod
  schema (`shared/ipc/email-schemas.ts:1417-1420` is the export's pattern).
- A reviewer of this spike PR should scrutinize: (1) that the prototype's
  preview truly performs no writes/unlinks (the whole point), (2) that nothing
  is wired into production IPC/routes, (3) that the table→action mapping matches
  the live schema's PII columns and FK cascade shape, and (4) that the open
  questions are honest, not glossed.
- Follow-up explicitly deferred: FTS index (`email_messages_fts`,
  `electron/database-schema.ts:370-384`) consistency after anonymization — a
  hard delete or column overwrite must keep the external-content FTS index in
  sync; the design should flag this but the spike does not solve it.
