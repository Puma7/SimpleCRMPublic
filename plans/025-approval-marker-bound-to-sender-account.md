# Plan 025: Bind the outbound approval marker to the sender account

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update this plan's row in
> `plans/README.md` (section "Runde 2") AND tick its checkbox in
> `plans/MASTERPLAN.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 9e0491e3..HEAD -- packages/core/src/email/outbound-approval-marker.ts packages/server/src/mail-compose-send.ts packages/server/src/mail-outbound-approval-store.ts packages/server/src/workflow-execution.ts packages/server/src/db/postgres-mail-read-ports.ts electron/email/outbound-approval.ts electron/email/email-workflow-engine.ts electron/workflow/draft-send-prep.ts electron/email/outbound-hold-fingerprint.ts electron/email/email-store.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `9e0491e3`, 2026-09-27

Audit corrections (verified at `9e0491e3`): the finding is correct. One detail
was wrong: `packages/server/src/workflow-ai-draft-nodes.ts:591-605`
(`fingerprintReviewedDraft`) does **not** write the approval marker. It feeds the
separate `ai.review.fingerprint` variable. The workflow writers of the marker are
`packages/server/src/workflow-execution.ts:6238` and `:6440`. Extra finding: both
editions still accept **hash-less** legacy markers (`<iso>` without `|<hash>`).
Such a marker is bound to neither content nor account. This plan removes that too.

## Why this matters

The marker `sync_info` `outbound_review_approved:<draftId>` lets a draft skip the
outbound review for 24 h if the content fingerprint still matches. The fingerprint
covers subject, body, recipients and attachments, but **not the sender account**.
"Ohne Ausgangsprüfung senden" (skip) commits un-hold + marker **before** it sends.
If that send fails, a user with `mail.draft.edit` can switch the draft's "Von"
account and send normally. The marker still matches, so the mail goes out from an
identity the review never saw. With skip policy `admins`, this lets a non-admin
reuse an admin's approval for another mailbox. After this plan, the marker is
bound to the account in both editions, and an account switch drops it.

## Current state

- `packages/core/src/email/outbound-approval-marker.ts`: shared by both editions.
  - `:15-34` `outboundDraftFingerprint(input)` hashes subject, bodyText, bodyHtml,
    to/cc/bcc and attachmentPaths. There is no account.
  - `:53-56` doc comment: "a value without the `|<hash>` suffix is still treated as a
    valid marker".
  - `:81-89` `outboundHoldFingerprint` already binds the account. Its comment says:
    `// Das Absenderkonto gehört dazu (Kontowechsel = neuer Stand); der Freigabe-`
    `// Marker (outboundDraftFingerprint) bleibt unverändert.`
- Server reader `packages/server/src/mail-compose-send.ts:905-943`, inside
  `createPostgresComposeOutboundReviewPort().review` (TTL const at `:127`,
  `24 * 60 * 60 * 1000`):
  ```ts
  const currentFingerprint = outboundDraftFingerprint({
    subject: input.subject, bodyText: input.bodyText, bodyHtml: input.bodyHtml,
    to: input.to, cc: input.cc ?? null, bcc: input.bcc ?? null,
    attachmentPaths: input.attachmentPaths ?? null,
  });
  const contentMatches = parsed.fingerprint === null || parsed.fingerprint === currentFingerprint;
  ```
  `send()` already requires `draft.accountId === values.accountId` (`:378-380`).
  So the draft row's `account_id` is the sender.
- Server writers, all via `outboundDraftFingerprint` + `encodeOutboundApprovalMarker`:
  - `packages/server/src/mail-outbound-approval-store.ts:181-190`
    (`persistManualOutboundApproval`). `draftRow.account_id` is already selected
    (`:143-158`, `:30`). It is used by skip, validate, schedule and draft-approval.
  - `packages/server/src/workflow-execution.ts:6238-6248` (`email.release_outbound`,
    `draftRow` selected at `:6158` incl. `account_id`).
  - `packages/server/src/workflow-execution.ts:6440-6449` (`send_draft` with
    `runOutboundReview=false`, select at `:6334` incl. `account_id`).
- Skip: `packages/server/src/mail-outbound-review-skip.ts:107-162` writes the
  approval and then `outbound_review_skipped:<id>` (= the marker value).
  `packages/server/src/api/mail-routes.ts:1167-1168` says:
  `// Protokolliert wird das Überspringen selbst: ab hier gilt die Freigabe` /
  `// für diesen Inhalt, auch wenn der Versand danach scheitert.`
- Account switch on the server: `packages/server/src/db/postgres-mail-read-ports.ts:1315-1449`
  `updateComposeDraft` computes `accountMove` (`:1336-1350`). It clears the schedule
  and `approval_state`, but never touches `sync_info` markers.
- Desktop reader and writer: `electron/email/outbound-approval.ts`.
  `tryOutboundApprovalBypass` (`:30-52`) has the same `parsed.fingerprint === null ||`
  rule. `stampOutboundApprovalMarker` (`:54-63`) is used by
  `applyManualComposeOutboundApproval` (`:69-111`, has `draftRow.account_id`) and by
  `electron/workflow/draft-send-prep.ts:79-80` (`draftFingerprintFields` `:19-36`
  reads `draftRow`). Its caller is `electron/email/email-workflow-engine.ts:505-521`
  (`row = getEmailMessageById(payload.messageId)` at `:500`).
  `clearOutboundApprovalMarker` (`:65-67`) is **never called** in production code,
  only in tests and a mock.
- Desktop account switch: `electron/email/email-store.ts:2166-2178`
  (`accountMoved = true`). It clears no markers. Cycle warning:
  `outbound-approval.ts` imports `email-store`. So `email-store` must **not** import
  `outbound-approval`. `electron/email/outbound-hold-fingerprint.ts` is documented as
  the cycle-free helper module ("Eigenes Modul ohne Store-Abhängigkeiten …"), and
  `email-store.ts:37` already imports it.
  Pattern to copy: `clearOutboundHoldFingerprints` (`:60-65`, `getDb().prepare('DELETE …')`).

## Commands you will need

Prefix every command with `export PATH=/opt/node24/bin:$PATH;` (Node 24, pnpm 11.13.1, TypeScript 7).

| Purpose | Command | Expected |
|---|---|---|
| Install | `pnpm install` | exit 0 |
| Build packages (before server/Postgres tests) | `pnpm run build:packages` | exit 0 |
| Typecheck | `pnpm run typecheck` | exit 0 |
| Lint | `pnpm run lint` | exit 0, 0 warnings |
| Focused unit/integration test | `pnpm exec jest <file>` | all pass |
| Focused mail test | `pnpm exec jest --config jest.mail.config.cjs --coverageThreshold='{}' <file>` | all pass |
| Mail suite + ratchet | `pnpm run test:mail` then `pnpm run test:mail:coverage` | pass, ratchet ok |
| Server ratchet | `pnpm run test:server:coverage && node scripts/check-server-coverage-ratchet.mjs` | pass |

Embedded-Postgres tests (`tests/integration/postgres-*.test.ts`) refuse to run as root. If `id -u` is 0:
`chmod -R a+rwX .tmp-tests tests packages/core/dist packages/server/dist` then
`su tester -s /bin/bash -c "export PATH=/opt/node24/bin:\$PATH; cd /home/user/SimpleCRMPublic && node_modules/.bin/jest --cacheDirectory /tmp/jest-tester --forceExit <file>"`.
Postgres test files must keep `jest.mock('kysely', () => jest.requireActual('../../packages/server/node_modules/kysely'))`.

## Scope

**In scope**:
- `packages/core/src/email/outbound-approval-marker.ts`
- `packages/server/src/mail-compose-send.ts` (bypass block only)
- `packages/server/src/mail-outbound-approval-store.ts`
- `packages/server/src/workflow-execution.ts` (the two marker writers only)
- `packages/server/src/db/postgres-mail-read-ports.ts` (`updateComposeDraft` only)
- `electron/email/outbound-approval.ts`, `electron/email/email-workflow-engine.ts`,
  `electron/workflow/draft-send-prep.ts`, `electron/email/outbound-hold-fingerprint.ts`,
  `electron/email/email-store.ts` (`updateComposeDraft` only)
- Tests: `tests/unit/outbound-approval-marker.test.ts`, `tests/unit/server-edition-foundation.test.ts`,
  `tests/integration/postgres-outbound-hold-visibility.test.ts`, `tests/integration/postgres-compose-draft-account-move.test.ts`,
  `tests/mail/email-outbound-approval-runtime.test.ts`, `tests/mail/email-outbound-review-skip.test.ts`,
  `tests/integration/ipc-email-compose-draft-account-move.test.ts`
- `docs/WORKFLOW_PHASES.md` (line ~92), `CHANGELOG.md`

**Out of scope**:
- `outboundDraftFingerprint` itself and `outboundHoldFingerprint`. Do not change
  their output. Stored `outbound_hold_fingerprint:<id>` values and the separate
  `ai.review.fingerprint` (`workflow-ai-draft-nodes.ts:591`, `electron/workflow/nodes/ai-nodes.ts:999-1019`)
  depend on them.
- The content normalization of held drafts (plan 026).
- `ComposeOutboundReviewInput` (`mail-compose-send.ts:277-292`). Do not add a field.
  The review reads the account from the DB row instead, so ~9 test call sites stay unchanged.
- Clearing the desktop marker after a successful send. The draft becomes `sent` and
  cannot be re-sent, so this is harmless. Mention it in the PR only.

## Git workflow

- Branch: `advisor/025-approval-marker-sender-account`
- Commits in German, imperative, area prefix. Example:
  `Ausgangsprüfung: Freigabe-Marker an das Absenderkonto binden`
- Do NOT push or open a PR unless the operator says so.

## Steps

### Step 1: Core — add `outboundApprovalFingerprint` (test first)

Add these tests in `tests/unit/outbound-approval-marker.test.ts`. They must fail
because the export does not exist yet:
- The same content with `accountId: 1` and `accountId: 2` gives different values.
- `accountId: 501` and `accountId: '501'` give the same value. (The server returns
  bigint ids as strings, see `tests/unit/outbound-hold-content.test.ts:46-47`.)
- The result is `/^[0-9a-f]{32}$/` and differs from `outboundDraftFingerprint(content)`.

In `outbound-approval-marker.ts`:
- Extract the inline parameter type of `outboundDraftFingerprint` into
  `export type OutboundDraftFingerprintInput`. The function body stays unchanged.
- Add the following:
  ```ts
  /** Freigabe-Marker: Inhalt plus Absenderkonto. Nach einem Kontowechsel ginge
   *  derselbe Text über eine Absender-Identität raus, die die Prüfung nie sah. */
  export function outboundApprovalFingerprint(
    input: OutboundDraftFingerprintInput & { accountId: unknown },
  ): string {
    const { accountId, ...content } = input;
    return createHash('sha256')
      .update(`approval|${outboundDraftFingerprint(content)}|account:${approvalAccountKey(accountId)}`)
      .digest('hex').slice(0, 32);
  }
  function approvalAccountKey(value: unknown): string {
    if (value === null || value === undefined) return '';
    const text = String(value).trim();
    return /^\d+$/.test(text) ? String(Number(text)) : text;
  }
  ```
- Rewrite the comments at `:53-56` and `:83-84`. Markers without a hash are
  invalid now, and the approval marker binds the account through
  `outboundApprovalFingerprint`.

**Verify**: `pnpm exec jest tests/unit/outbound-approval-marker.test.ts` → all pass.

### Step 2: Server regression tests (RED)

1. In `tests/unit/server-edition-foundation.test.ts`, next to the test
   `'reviewOutbound.review denies bypass when the approval-marker fingerprint mismatches the current content'`
   (~`:14984`), add a new test named
   `'reviewOutbound.review denies bypass when the draft moved to another sender account'`.
   Build it like test 83. Give the message row `account_id: 6`. Seed the marker as
   `encodeOutboundApprovalMarker(now, outboundApprovalFingerprint({ subject: 'After approval', bodyText: 'ok', bodyHtml: null, to: 'kunde@example.com', cc: null, bcc: null, attachmentPaths: null, accountId: 5 }))`,
   using the same review input. Expect `result` not to equal `{ allowed: true }` and
   the marker row to be deleted. Add a second test where a **hash-less** marker
   (`now.toISOString()`) is not accepted.
2. In `tests/integration/postgres-outbound-hold-visibility.test.ts`, add
   `'„Ohne Ausgangsprüfung senden“: Versand scheitert, Kontowechsel ⇒ erneute Prüfung'`.
   Insert a second account (`id = source_sqlite_id = 502`, same columns as the
   `beforeAll` insert, `email_address 'vertrieb@example.test'`) inside the test.
   Then take draft 5206 through the steps of the existing test at `:306`:
   `seedHoldWorkflow`, `seedWorkflowScheduledDraft(5206)`, tick, run the jobs, and
   `prepare`. Send with `smtpSend: jest.fn(async () => { throw new Error('SMTP down'); })`
   and expect `ok: false`. Then call
   `createPostgresEmailMessageReadPort({ db }).updateComposeDraft({ workspaceId: WORKSPACE_ID, messageId: 5206, values: { accountId: 502 } })`.
   Send again with `{ ...prepared.values, accountId: 502 }` and a fresh `smtpSend` mock.
   Expect `ok: false`, `smtpSend` not called, `takeWorkflowJobs()` length ≥ 1,
   `syncInfoValue('outbound_review_approved:5206')` `null` and
   `syncInfoValue('outbound_review_skipped:5206')` `null`.
3. In `tests/integration/postgres-compose-draft-account-move.test.ts`, add a
   test: seed both markers for the draft, move it, and expect both rows to be gone.
   A move to the **same** account keeps them.

**Verify**: `pnpm run build:packages`, then run the three files. The new tests FAIL
(bypass allowed / SMTP called / markers still present). All others pass.

### Step 3: Server fix — writers and reader

- `mail-outbound-approval-store.ts:181`: use `outboundApprovalFingerprint({ ...same fields, accountId: draftRow?.account_id ?? null })`.
- `workflow-execution.ts:6238` and `:6440`: do the same with `draftRow?.account_id` / `draftRow.account_id`.
  Swap the `outboundDraftFingerprint` import only if it becomes unused (lint will tell).
- `mail-compose-send.ts:912-925`: inside `if (approval?.value)`, read the current
  sender in the same `trx`:
  `const draftAccount = await trx.selectFrom('email_messages').select('account_id').where('workspace_id', '=', input.workspaceId).where('id', '=', input.draftMessageId).executeTakeFirst();`.
  Compute `currentFingerprint` with `outboundApprovalFingerprint({ ...existing fields, accountId: draftAccount?.account_id ?? null })`
  and set `const contentMatches = parsed.fingerprint !== null && parsed.fingerprint === currentFingerprint;`.
  Update the comment block at `:894-904`: the account is part of the fingerprint,
  and a marker without a hash is invalid.
- Backward compatibility (decided): markers written before this change, with the
  content-only hash or no hash, **do not match** and are deleted. The draft then
  goes through the review again. Reasons: it is fail-safe, the TTL is 24 h, and all
  writers have written `iso|hash` since at least 2026-07. The cost is one extra
  review for drafts approved in the 24 h before the upgrade.
- Update the SMTP-retry test (`server-edition-foundation.test.ts` ~`:14855`, draft 81).
  It seeds a hash-less marker. Seed a real one built with `outboundApprovalFingerprint`
  (give the row an `account_id`) so it still asserts the retry bypass.

**Verify**: `pnpm exec jest tests/unit/server-edition-foundation.test.ts -t "reviewOutbound.review"` → all pass.

### Step 4: Server fix — account switch drops the markers

In `postgres-mail-read-ports.ts` `updateComposeDraft`, inside the transaction after
the `composeDraftUpdate` row is returned (~`:1437`), add this when `accountMove !== undefined`:
```ts
// Kontowechsel: Freigabe und „ohne Prüfung“ galten dem bisherigen Absender.
await trx.deleteFrom('sync_info')
  .where('workspace_id', '=', input.workspaceId)
  .where('key', 'in', [outboundReviewApprovedKey(input.messageId), outboundReviewSkippedKey(input.messageId)])
  .execute();
```
Import `outboundReviewApprovedKey` from `'../mail-outbound-approval-store'` (already
imported there for `persistManualOutboundApproval`) and `outboundReviewSkippedKey`
from `'@simplecrm/core'`.

**Verify**: `pnpm run build:packages`, then the two Postgres files from Step 2 → all pass (as non-root).

### Step 5: Desktop regression tests (RED)

- `tests/mail/email-outbound-approval-runtime.test.ts`: `stampOutboundApprovalMarker(22, { ...fingerprintInput, accountId: 1 })`
  followed by `tryOutboundApprovalBypass(22, { ...fingerprintInput, accountId: 2 })` → `false`.
  Change `'accepts a fresh matching marker and a fresh legacy marker'` so the legacy
  (hash-less) marker gives `false` and is cleared. Add `accountId` to the fingerprint
  inputs there. Use `outboundApprovalFingerprint` wherever the expected marker is computed.
- `tests/mail/email-outbound-review-skip.test.ts`: add a test with `insertHeldDraft(67)`.
  Make `mockSendComposeDraft` resolve once with `{ ok: false, error: 'SMTP down' }`,
  then run the skip (expect failure). Then run
  `db.prepare('UPDATE email_messages SET account_id = 2, folder_id = 20 WHERE id = 67').run()`
  (same style as the test at `:260`). Expect `tryOutboundApprovalBypass(67, { ...values of the failed send call, accountId: 2 })`
  to be `false`, and `{ …, accountId: 1 }` before the switch to be `true`. Also add
  `accountId: 1` to the existing call at `:131`.
- `tests/integration/ipc-email-compose-draft-account-move.test.ts`: before the move,
  call `setSyncInfo('outbound_review_approved:'+draftId, 'x|y')` and the same for
  `outbound_review_skipped:`. After `updateComposeDraft(draftId, { accountId: salesAccountId })`,
  `getSyncInfo(...)` returns `''` or `null` for both. Import both from `electron/sqlite-service`.

**Verify**: run the three files → the new assertions FAIL, everything else passes.

### Step 6: Desktop fix

- `electron/email/outbound-approval.ts`: `tryOutboundApprovalBypass` and
  `stampOutboundApprovalMarker` take `OutboundDraftFingerprintInput & { accountId: number | string | null }`
  and use `outboundApprovalFingerprint`. Set `contentMatches = parsed.fingerprint !== null && …`.
  `applyManualComposeOutboundApproval` passes `accountId: draftRow.account_id`.
- `electron/email/email-workflow-engine.ts:510-518`: add `accountId: row.account_id`.
- `electron/workflow/draft-send-prep.ts:27-35`: add `accountId: draftRow.account_id`.
- Move `OUTBOUND_REVIEW_APPROVED_PREFIX` and `outboundReviewApprovedKey` from
  `outbound-approval.ts` into `electron/email/outbound-hold-fingerprint.ts`.
  Re-export them from `outbound-approval.ts`
  (`export { OUTBOUND_REVIEW_APPROVED_PREFIX, outboundReviewApprovedKey } from './outbound-hold-fingerprint';`)
  so existing importers keep working. Add
  `clearOutboundReviewApprovalMarkers(...draftIds)` there. It deletes both keys
  (`outboundReviewApprovedKey`, `outboundReviewSkippedKey` from
  `../../packages/core/src/email/outbound-review-skip`), shaped like `clearOutboundHoldFingerprints`.
- `electron/email/email-store.ts`: after the `UPDATE` at `:2197-2199`, add
  `if (accountMoved) clearOutboundReviewApprovalMarkers(messageId);`.

**Verify**: the three files from Step 5 → all pass. `pnpm run test:mail` → pass.
If an `email-store*` mail test now fails with `no such table: sync_info`, STOP (see below).

### Step 7: Docs, CHANGELOG, full gate

- `docs/WORKFLOW_PHASES.md:92`: add that the Freigabe-Marker binds content **and
  Absenderkonto** (`outboundApprovalFingerprint`), that a marker without a hash is
  invalid, and that a "Von" switch deletes `outbound_review_approved:<id>` and
  `outbound_review_skipped:<id>`.
- `CHANGELOG.md` `[Unreleased]` → `### Fixed`:
  `- **Beide Editionen:** Eine Freigabe an der Ausgangsprüfung vorbei („Ohne Ausgangsprüfung senden“, Freigabe durch einen Workflow) gilt nur noch für das Absenderkonto, für das sie erteilt wurde. Scheiterte der Versand danach, ließ sich der Entwurf auf ein anderes Konto umstellen und ungeprüft senden. Ein Kontowechsel verwirft die Freigabe jetzt; Freigaben aus den 24 Stunden vor dem Update werden einmal neu geprüft.`

**Verify**: `pnpm run typecheck`, `pnpm run lint`, `pnpm run test:unit`, `pnpm run test:mail:coverage`,
server ratchet → all pass. Postgres files from Step 2 pass as non-root.

## Test plan

- Core: 3 new cases in `tests/unit/outbound-approval-marker.test.ts`.
- Server unit: account mismatch denied, hash-less denied, SMTP-retry bypass updated (`server-edition-foundation.test.ts`).
- Server Postgres: skip → SMTP failure → account switch → normal send is re-reviewed (`postgres-outbound-hold-visibility.test.ts`). Markers are dropped on a move and kept on a same-account save (`postgres-compose-draft-account-move.test.ts`).
- Desktop: bypass denied for another account, legacy denied (`email-outbound-approval-runtime.test.ts`). Skip + failed send + switch (`email-outbound-review-skip.test.ts`). Markers are dropped on a move (`ipc-email-compose-draft-account-move.test.ts`).

## Done criteria

- [ ] `pnpm run typecheck` and `pnpm run lint` exit 0
- [ ] `pnpm run test:unit`, `pnpm run test:mail:coverage` and the server ratchet pass. The new tests exist and pass
- [ ] The 3 Postgres test files above pass (as non-root)
- [ ] `grep -rn "parsed.fingerprint === null ||" packages/server/src electron` → no matches
- [ ] `grep -rn "outboundDraftFingerprint(" packages/server/src/mail-outbound-approval-store.ts packages/server/src/mail-compose-send.ts electron/email/outbound-approval.ts` → no matches
- [ ] `git status` shows only in-scope files. CHANGELOG entry present. README row and MASTERPLAN checkbox updated

## STOP conditions

- An excerpt in "Current state" does not match the live code (drift).
- A Postgres integration test other than the new ones changes result. Some flow
  may rely on a marker surviving an account move. Report which one.
- `tests/integration/postgres-workflow-review-send-draft.test.ts` or
  `postgres-workflow-templates-partial-automation.test.ts` fails on marker values.
  Report it. Do not "fix" it by removing the account from the fingerprint.
- Desktop mail tests fail with `no such table: sync_info` after Step 6. Do not wrap
  the clearing in try/catch. Report which test (setup gap vs. real behaviour).
- The fix appears to need a new field on `ComposeOutboundReviewInput` or changes to
  `outboundDraftFingerprint`'s output.

## Maintenance notes

- Any new marker writer must use `outboundApprovalFingerprint` with the draft row's
  `account_id`. A reviewer should grep for `encodeOutboundApprovalMarker(`. Every
  call must be preceded by `outboundApprovalFingerprint`.
- Reviewers should check that account ids are normalized consistently (number vs.
  bigint-string). The core helper does this. Do not add `Number()` at the call sites.
- Deferred: the `ai.review.fingerprint` check (`send_draft` after an AI review) does
  not include the account either. An account switch after the AI review is not caught
  there, but the new approval marker binding covers the actual send. Also deferred:
  desktop never deletes the approval marker after a successful send.
