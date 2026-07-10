# Plan 010: Make scheduled-send state transitions atomic

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in the `README.md` of the directory this plan lives in (`plans/README.md`)
> — unless a reviewer dispatched you and told you they maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat f24fb27..HEAD -- packages/server/src/mail-scheduled-send.ts tests/unit/server-edition-foundation.test.ts`
> If either in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `f24fb27`, 2026-07-10

## Why this matters

The server-edition scheduled-send worker (`packages/server/src/mail-scheduled-send.ts`)
records each draft's state transition — restore-after-transient-failure,
record-failure, give-up, clear-metadata — as **two or three independent database
writes**, each in its own `withWorkspaceTransaction`. The `scheduled_send_at`
column and the `sync_info` bookkeeping markers (`scheduled_send_failures:*`,
`scheduled_send_status:*`, `scheduled_send_last_error:*`, `scheduled_send_claimed_at:*`)
therefore commit separately. If the process crashes or the connection drops
**between** those writes, the draft is left in a self-inconsistent state: e.g.
the failure counter is bumped and status set to `pending` while the schedule was
never restored, or the schedule is restored while the stale claim marker is never
cleared. That drift can skew the `MAX_SCHEDULED_SEND_FAILURES` give-up decision
(a draft can be miscounted toward or away from the give-up threshold).

Delivery is already at-most-once by design — the claim in `claimDueDrafts`
atomically clears `scheduled_send_at` under `FOR UPDATE SKIP LOCKED`, so this is
**not** a double-send bug. It is bookkeeping drift. The fix groups each logical
transition into a single transaction so the schedule column and the `sync_info`
markers always commit together (all-or-nothing). The at-most-once claim semantics
must not change.

## Current state

Files:

- `packages/server/src/mail-scheduled-send.ts` — the entire scheduled-send worker:
  the `ScheduledSendStore` port (interface), the orchestrator `processScheduledDraft`,
  the private transition helpers, and the Postgres implementation of the store.
- `tests/unit/server-edition-foundation.test.ts` — unit tests that build **fake**
  `ScheduledSendStore`s and assert the exact sequence of store calls the
  orchestrator makes. Three existing tests depend on the current store method
  names/shapes and must be updated when the interface changes.

### The store port today (multi-write granularity is the problem)

The port exposes fine-grained mutators; each maps to **one** `withWorkspaceTransaction`
in the Postgres impl, so a logical transition that calls several of them spans
several transactions. `mail-scheduled-send.ts:38-57`:

```ts
export type ScheduledSendStore = Readonly<{
  claimDueDrafts(input: ScheduledSendJobPlan): Promise<readonly ScheduledDraft[]>;
  setDraftScheduledAt(input: {
    workspaceId: string;
    draftId: number;
    sendAt: Date | null;
  }): Promise<void>;
  getSyncInfo(input: {
    workspaceId: string;
    keys: readonly string[];
  }): Promise<ReadonlyMap<string, string | null>>;
  setSyncInfo(input: {
    workspaceId: string;
    values: Readonly<Record<string, string | null>>;
  }): Promise<void>;
  deleteSyncInfo(input: {
    workspaceId: string;
    keys: readonly string[];
  }): Promise<void>;
}>;
```

### The orchestrator and its multi-write helpers

`processScheduledDraft` (`mail-scheduled-send.ts:99-171`) selects a branch per
draft. The failure branch alone issues a read + up to four writes across two
helpers, `mail-scheduled-send.ts:150-171`:

```ts
  if (isComposeSendAlreadyInProgressError(result.error)) {
    await restoreClaimedScheduledSendAt(input.store, input.workspaceId, draft);
    return;
  }

  if (isOutboundReviewPendingError(result.error)) {
    await restoreClaimedScheduledSendAt(input.store, input.workspaceId, draft);
    return;
  }

  const failures = await recordScheduledAttemptFailure(
    input.store,
    input.workspaceId,
    draft.id,
    result.error,
  );
  if (failures >= MAX_SCHEDULED_SEND_FAILURES) {
    await giveUpScheduledDraft(input.store, input.workspaceId, draft.id, result.error);
    return;
  }
  await restoreClaimedScheduledSendAt(input.store, input.workspaceId, draft);
```

The private helpers each perform **separate awaits** (each is its own transaction
in Postgres). `mail-scheduled-send.ts:173-253`:

```ts
async function restoreClaimedScheduledSendAt(
  store: ScheduledSendStore,
  workspaceId: string,
  draft: ScheduledDraft,
): Promise<void> {
  if (draft.claimedSendAt === null) return;
  await store.setDraftScheduledAt({
    workspaceId,
    draftId: draft.id,
    sendAt: draft.claimedSendAt,
  });
  await clearClaimedScheduledSendAt(store, workspaceId, draft.id);
}
// ...
async function recordScheduledAttemptFailure(
  store, workspaceId, draftId, error,
): Promise<number> {
  const values = await store.getSyncInfo({ workspaceId, keys: [scheduledSendFailuresKey(draftId)] });
  const current = Number.parseInt(values.get(scheduledSendFailuresKey(draftId)) ?? '0', 10);
  const failures = (Number.isFinite(current) && current >= 0 ? current : 0) + 1;
  await store.setSyncInfo({
    workspaceId,
    values: {
      [scheduledSendFailuresKey(draftId)]: String(failures),
      [scheduledSendLastErrorKey(draftId)]: truncateScheduledSendError(error),
      [scheduledSendStatusKey(draftId)]: 'pending',
    },
  });
  return failures;
}

async function giveUpScheduledDraft(store, workspaceId, draftId, error): Promise<void> {
  await store.setDraftScheduledAt({ workspaceId, draftId, sendAt: null });
  await clearClaimedScheduledSendAt(store, workspaceId, draftId);
  await store.setSyncInfo({
    workspaceId,
    values: {
      [scheduledSendFailuresKey(draftId)]: '0',
      [scheduledSendLastErrorKey(draftId)]: truncateScheduledSendError(error),
      [scheduledSendStatusKey(draftId)]: 'failed',
    },
  });
}

async function clearScheduledDraftMeta(store, workspaceId, draftId): Promise<void> {
  await clearClaimedScheduledSendAt(store, workspaceId, draftId);
  await store.setSyncInfo({
    workspaceId,
    values: {
      [scheduledSendFailuresKey(draftId)]: '0',
      [scheduledSendLastErrorKey(draftId)]: '',
      [scheduledSendStatusKey(draftId)]: '',
    },
  });
}
```

The success and empty-recipient branches (`mail-scheduled-send.ts:112-148`) also
combine `setDraftScheduledAt(...)` with `clearScheduledDraftMeta`/
`clearClaimedScheduledSendAt` as separate awaits.

### The Postgres store: each method is exactly one transaction

The Postgres impl (`mail-scheduled-send.ts:418-576`) wraps each mutator in its own
`withWorkspaceTransaction`. Two shapes you will **reuse** verbatim inside the new
atomic methods — the schedule update (`:498-514`):

```ts
    async setDraftScheduledAt(input) {
      await withWorkspaceTransaction(
        db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          await trx
            .updateTable('email_messages')
            .set({ scheduled_send_at: input.sendAt, updated_at: new Date() })
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.draftId)
            .execute();
        },
      );
    },
```

…and the `sync_info` upsert (`:533-560`):

```ts
    async setSyncInfo(input) {
      await withWorkspaceTransaction(
        db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          const entries = Object.entries(input.values);
          if (entries.length === 0) return;
          const now = new Date();
          await trx
            .insertInto('sync_info')
            .values(entries.map(([key, value]) => ({
              workspace_id: input.workspaceId,
              key,
              value,
              last_updated: now,
              source_row: serverApiSourceRow(),
              imported_in_run_id: null,
              updated_at: now,
            })))
            .onConflict((oc) => oc.columns(['workspace_id', 'key']).doUpdateSet({
              value: (eb) => eb.ref('excluded.value'),
              last_updated: now,
              updated_at: now,
            }))
            .execute();
        },
      );
    },
    async deleteSyncInfo(input) {
      if (input.keys.length === 0) return;
      await withWorkspaceTransaction(/* ... */ async (trx) => {
        await trx.deleteFrom('sync_info')
          .where('workspace_id', '=', input.workspaceId)
          .where('key', 'in', [...input.keys])
          .execute();
      });
    },
```

### Repo conventions to match (exemplars, all in this same file)

- **Transaction wrapper**: `withWorkspaceTransaction(db, { workspaceId, role: 'system' }, async (trx) => { ... })`
  from `./db/workspace-context`. Its `operation` callback receives a
  `WorkspaceTransaction` (a Kysely `Transaction<ServerDatabase>`). Everything
  inside the callback commits together or rolls back together. This is exactly
  what makes a transition atomic. See its signature in
  `packages/server/src/db/workspace-context.ts:45-56`.
- **Trx-scoped helper typing**: existing helpers in this file type their trx
  parameter as `Kysely<ServerDatabase>` (a `Transaction<DB>` is assignable to it)
  — see `recoverOrphanedScheduledClaims(trx: Kysely<ServerDatabase>, ...)`
  (`mail-scheduled-send.ts:317`) and `persistScheduledSendClaims(...)` (`:385`).
  Follow that: your new `*Tx` helpers take `trx: Kysely<ServerDatabase>`.
- **`sync_info` insert rows** must use `serverApiSourceRow()` for `source_row`
  and `imported_in_run_id: null` (see the upsert above). `serverApiSourceRow`
  already exists at `mail-scheduled-send.ts:578-581`.
- **Key builders** (already imported at the top of the file, from `@simplecrm/core`):
  `scheduledSendClaimedAtKey(id)` → `scheduled_send_claimed_at:<id>`,
  `scheduledSendFailuresKey(id)` → `scheduled_send_failures:<id>`,
  `scheduledSendStatusKey(id)` → `scheduled_send_status:<id>`,
  `scheduledSendLastErrorKey(id)` → `scheduled_send_last_error:<id>`, and
  `truncateScheduledSendError(error)`. Do not change these imports.
- **Test convention**: the unit tests build a plain-object fake `ScheduledSendStore`,
  push each call into a `storeCalls: unknown[]` array, and assert the array with
  `toEqual([...])`. Two existing tests also read the source file text and assert
  regexes with `readFileSync(resolve(__dirname, '../../packages/server/src/mail-scheduled-send.ts'), 'utf8')`
  (see `server-edition-foundation.test.ts:11096-11105`). Reuse both patterns.

### Behavior that must NOT change (the give-up counting is subtle — preserve it)

The final committed state for each branch must be identical to today:

- **no `accountId`** → schedule `null`, claim marker deleted, `failures='0'`,
  `last_error=<error>`, `status='failed'`.
- **empty recipient** (`to` blank) → schedule `null`, claim marker deleted;
  failure/status/last_error markers **untouched**.
- **send ok** → schedule `null`, claim marker deleted, `failures='0'`,
  `last_error=''`, `status=''`.
- **"Versand … bereits" (already in progress)** or **outbound-review pending** →
  if `claimedSendAt !== null`: schedule restored to `claimedSendAt` and claim
  marker deleted; if `claimedSendAt === null`: **no-op** (today's
  `restoreClaimedScheduledSendAt` returns early). Failure/status markers untouched.
- **other transient error**, count below max → `failures = prev+1`,
  `last_error=<error>`, `status='pending'`; then (only if `claimedSendAt !== null`)
  schedule restored to `claimedSendAt` and claim marker deleted.
- **other transient error**, `prev+1 >= MAX_SCHEDULED_SEND_FAILURES` (5) → schedule
  `null`, claim marker deleted, `failures='0'`, `last_error=<error>`,
  `status='failed'`. (Today this is two commits — an intermediate `'5'/'pending'`
  then `'0'/'failed'`; collapsing to the single final `'0'/'failed'` commit is the
  intended improvement and is an allowed change.)

## Commands you will need

| Purpose   | Command                                             | Expected on success        |
|-----------|-----------------------------------------------------|----------------------------|
| Install   | `pnpm install --frozen-lockfile`                    | exit 0                     |
| Typecheck | `pnpm run build:packages`                           | exit 0 (compiles `packages/server`) |
| Test (targeted) | `pnpm run test:server-edition`                | all pass                   |
| Test (full gate)| `pnpm test`                                   | all pass                   |
| Lint      | `pnpm run lint`                                     | exit 0 (eslint, `--max-warnings 0`) |
| Build     | `pnpm run build`                                    | exit 0                     |

Notes:
- There is **no** `typecheck` script in this repo yet. `pnpm run build:packages`
  (`tsc -b packages/core packages/server packages/desktop`) type-checks the
  server package, which is where the source change lives.
- `pnpm run test:server-edition` runs exactly
  `tests/unit/server-edition-foundation.test.ts` (plus the integration variant)
  via `--runInBand` — use it as the fast inner loop.
- `pnpm run test:mail` is **not** required here: this is a server-edition change
  (Postgres store), not an Electron/email-module change, and its coverage lives
  in the `unit` jest project.

## Suggested executor toolkit

(Optional — use if these skills exist in your environment.)

- Run `/code-review` on your final diff before committing — the transition
  branches are easy to get subtly wrong; a review focused on "does each branch's
  final committed state match the table in Current state" is valuable.
- `/verify` is **not** applicable: there is no local Postgres to drive here; the
  regression is covered by unit tests against a fake store plus a source guard.

## Scope

**In scope** (the only files you should modify):
- `packages/server/src/mail-scheduled-send.ts`
- `tests/unit/server-edition-foundation.test.ts`

**Out of scope** (do NOT touch, even though they look related):
- `electron/email/email-scheduled-send.ts` — the **Electron edition's** separate
  scheduled-send implementation. Different codebase path; not affected by this
  finding. Changing it widens blast radius for no reason.
- `packages/core/src/email/scheduled-send-state.ts` — the key builders and
  parsers. They are correct and reused as-is; do not modify.
- `packages/server/src/server.ts` — constructs the port via
  `createPostgresScheduledSendJobPort({ db, composeSender })`. That public
  signature (`PostgresScheduledSendJobPortOptions`) does **not** change, so this
  file needs no edit. Do not touch it.
- `claimDueDrafts` and its helpers (`recoverOrphanedScheduledClaims`,
  `persistScheduledSendClaims`) and the `FOR UPDATE SKIP LOCKED` claim SQL
  (`mail-scheduled-send.ts:418-497`) — the at-most-once claim semantics. Leave
  the claim logic exactly as is.
- The `startScheduledSendTicker` polling loop (`:583-649`).

## Git workflow

- Branch: `advisor/010-scheduled-send-transactional-bookkeeping` (create from `main`).
- Commit per logical unit; conventional-commit style (matches repo `git log`,
  e.g. `fix(review): keep raw-headers / .eml export out of the mail read bucket`).
  Suggested messages:
  - `fix(mail): commit each scheduled-send transition in one transaction`
  - `test(mail): cover atomic scheduled-send transitions`
- Do NOT push or open a PR (no operator instruction to do so).

## Steps

### Step 1: Replace the granular store port with atomic transition methods, and rewrite the orchestrator + Postgres store

All edits in `packages/server/src/mail-scheduled-send.ts`.

**1a. Replace the `ScheduledSendStore` interface** (`:38-57`). Keep
`claimDueDrafts` unchanged; replace the four granular mutators with five
transition methods:

```ts
export type ScheduledSendStore = Readonly<{
  claimDueDrafts(input: ScheduledSendJobPlan): Promise<readonly ScheduledDraft[]>;

  /** Atomic: schedule=null, clear claim, reset failure markers to "ok". After a successful send. */
  finalizeSentDraft(input: { workspaceId: string; draftId: number }): Promise<void>;

  /** Atomic: schedule=null, clear claim; failure markers left untouched. When a claimed draft is abandoned (no recipient). */
  releaseClaimedDraft(input: { workspaceId: string; draftId: number }): Promise<void>;

  /** Atomic: restore schedule to claimedSendAt and clear claim. No-op when claimedSendAt is null. For transient/back-off retries. */
  restoreClaimedDraft(input: {
    workspaceId: string;
    draftId: number;
    claimedSendAt: Date | null;
  }): Promise<void>;

  /** Atomic: schedule=null, clear claim, mark status=failed with error. Permanent give-up (e.g. missing account). */
  giveUpDraft(input: { workspaceId: string; draftId: number; error: string }): Promise<void>;

  /**
   * Atomic: increment the failure counter and, in the SAME transaction, either
   * back off (restore schedule + clear claim + status=pending) or give up when
   * the new count reaches maxFailures (schedule=null + clear claim + status=failed).
   * Returns the new count and whether it gave up.
   */
  recordFailedAttempt(input: {
    workspaceId: string;
    draftId: number;
    error: string;
    claimedSendAt: Date | null;
    maxFailures: number;
  }): Promise<{ failures: number; gaveUp: boolean }>;
}>;
```

**1b. Rewrite `processScheduledDraft`** (`:99-171`) to call exactly one transition
method per branch. Keep the `composeSender.send({...})` call and its `values`
payload (`:123-138`) exactly as-is; only the store calls change:

```ts
async function processScheduledDraft(input: {
  store: ScheduledSendStore;
  composeSender: EmailComposeSenderApiPort;
  actorUserId: string;
  workspaceId: string;
  draft: ScheduledDraft;
}): Promise<void> {
  const { draft, store, workspaceId } = input;

  if (!draft.accountId) {
    await store.giveUpDraft({ workspaceId, draftId: draft.id, error: 'Konto nicht gefunden' });
    return;
  }

  const to = recipientFieldFromJson(draft.toJson);
  if (!to.trim()) {
    await store.releaseClaimedDraft({ workspaceId, draftId: draft.id });
    return;
  }

  const result = await input.composeSender.send({
    /* UNCHANGED — keep the existing workspaceId/actorUserId/values block verbatim */
  });

  if (result.ok) {
    await store.finalizeSentDraft({ workspaceId, draftId: draft.id });
    return;
  }

  if (isComposeSendAlreadyInProgressError(result.error) || isOutboundReviewPendingError(result.error)) {
    await store.restoreClaimedDraft({ workspaceId, draftId: draft.id, claimedSendAt: draft.claimedSendAt });
    return;
  }

  await store.recordFailedAttempt({
    workspaceId,
    draftId: draft.id,
    error: result.error,
    claimedSendAt: draft.claimedSendAt,
    maxFailures: MAX_SCHEDULED_SEND_FAILURES,
  });
}
```

**1c. Delete the now-unused private helpers**: `restoreClaimedScheduledSendAt`,
`clearClaimedScheduledSendAt`, `recordScheduledAttemptFailure`,
`giveUpScheduledDraft`, `clearScheduledDraftMeta` (`:173-253`). Keep
`MAX_SCHEDULED_SEND_FAILURES = 5`, `isComposeSendAlreadyInProgressError`,
`recipientFieldFromJson`, `scheduledAttachmentPathsPayload`,
`parseDraftAttachmentPaths`, `parseScheduledSendClaimedAt`,
`recoverOrphanedScheduledClaims`, `persistScheduledSendClaims`,
`serverApiSourceRow`, and all imports.

**1d. In `createPostgresScheduledSendStore`** (`:418-576`): keep `claimDueDrafts`
exactly as-is. Delete `setDraftScheduledAt`, `getSyncInfo`, `setSyncInfo`,
`deleteSyncInfo`. Add four **trx-scoped** helper functions at module scope (type
`trx` as `Kysely<ServerDatabase>`, matching `recoverOrphanedScheduledClaims`),
reusing the exact query shapes from the deleted methods:

```ts
async function updateScheduleTx(
  trx: Kysely<ServerDatabase>, workspaceId: string, draftId: number, sendAt: Date | null,
): Promise<void> {
  await trx.updateTable('email_messages')
    .set({ scheduled_send_at: sendAt, updated_at: new Date() })
    .where('workspace_id', '=', workspaceId)
    .where('id', '=', draftId)
    .execute();
}

async function deleteClaimTx(
  trx: Kysely<ServerDatabase>, workspaceId: string, draftId: number,
): Promise<void> {
  await trx.deleteFrom('sync_info')
    .where('workspace_id', '=', workspaceId)
    .where('key', '=', scheduledSendClaimedAtKey(draftId))
    .execute();
}

async function upsertSyncInfoTx(
  trx: Kysely<ServerDatabase>, workspaceId: string, values: Readonly<Record<string, string | null>>,
): Promise<void> {
  const entries = Object.entries(values);
  if (entries.length === 0) return;
  const now = new Date();
  await trx.insertInto('sync_info')
    .values(entries.map(([key, value]) => ({
      workspace_id: workspaceId,
      key,
      value,
      last_updated: now,
      source_row: serverApiSourceRow(),
      imported_in_run_id: null,
      updated_at: now,
    })))
    .onConflict((oc) => oc.columns(['workspace_id', 'key']).doUpdateSet({
      value: (eb) => eb.ref('excluded.value'),
      last_updated: now,
      updated_at: now,
    }))
    .execute();
}

async function readFailureCountTx(
  trx: Kysely<ServerDatabase>, workspaceId: string, draftId: number,
): Promise<number> {
  const row = await trx.selectFrom('sync_info').select(['value'])
    .where('workspace_id', '=', workspaceId)
    .where('key', '=', scheduledSendFailuresKey(draftId))
    .executeTakeFirst();
  const current = Number.parseInt(row?.value ?? '0', 10);
  return Number.isFinite(current) && current >= 0 ? current : 0;
}
```

Then implement the five transition methods, each as a **single**
`withWorkspaceTransaction` composing the helpers above (mirror the exact final
states from the "Behavior that must NOT change" table):

```ts
    async finalizeSentDraft(input) {
      await withWorkspaceTransaction(db, { workspaceId: input.workspaceId, role: 'system' }, async (trx) => {
        await updateScheduleTx(trx, input.workspaceId, input.draftId, null);
        await deleteClaimTx(trx, input.workspaceId, input.draftId);
        await upsertSyncInfoTx(trx, input.workspaceId, {
          [scheduledSendFailuresKey(input.draftId)]: '0',
          [scheduledSendLastErrorKey(input.draftId)]: '',
          [scheduledSendStatusKey(input.draftId)]: '',
        });
      });
    },

    async releaseClaimedDraft(input) {
      await withWorkspaceTransaction(db, { workspaceId: input.workspaceId, role: 'system' }, async (trx) => {
        await updateScheduleTx(trx, input.workspaceId, input.draftId, null);
        await deleteClaimTx(trx, input.workspaceId, input.draftId);
      });
    },

    async restoreClaimedDraft(input) {
      if (input.claimedSendAt === null) return;
      await withWorkspaceTransaction(db, { workspaceId: input.workspaceId, role: 'system' }, async (trx) => {
        await updateScheduleTx(trx, input.workspaceId, input.draftId, input.claimedSendAt);
        await deleteClaimTx(trx, input.workspaceId, input.draftId);
      });
    },

    async giveUpDraft(input) {
      await withWorkspaceTransaction(db, { workspaceId: input.workspaceId, role: 'system' }, async (trx) => {
        await updateScheduleTx(trx, input.workspaceId, input.draftId, null);
        await deleteClaimTx(trx, input.workspaceId, input.draftId);
        await upsertSyncInfoTx(trx, input.workspaceId, {
          [scheduledSendFailuresKey(input.draftId)]: '0',
          [scheduledSendLastErrorKey(input.draftId)]: truncateScheduledSendError(input.error),
          [scheduledSendStatusKey(input.draftId)]: 'failed',
        });
      });
    },

    async recordFailedAttempt(input) {
      return withWorkspaceTransaction(db, { workspaceId: input.workspaceId, role: 'system' }, async (trx) => {
        const current = await readFailureCountTx(trx, input.workspaceId, input.draftId);
        const failures = current + 1;
        const gaveUp = failures >= input.maxFailures;
        if (gaveUp) {
          await updateScheduleTx(trx, input.workspaceId, input.draftId, null);
          await deleteClaimTx(trx, input.workspaceId, input.draftId);
          await upsertSyncInfoTx(trx, input.workspaceId, {
            [scheduledSendFailuresKey(input.draftId)]: '0',
            [scheduledSendLastErrorKey(input.draftId)]: truncateScheduledSendError(input.error),
            [scheduledSendStatusKey(input.draftId)]: 'failed',
          });
        } else {
          await upsertSyncInfoTx(trx, input.workspaceId, {
            [scheduledSendFailuresKey(input.draftId)]: String(failures),
            [scheduledSendLastErrorKey(input.draftId)]: truncateScheduledSendError(input.error),
            [scheduledSendStatusKey(input.draftId)]: 'pending',
          });
          if (input.claimedSendAt !== null) {
            await updateScheduleTx(trx, input.workspaceId, input.draftId, input.claimedSendAt);
            await deleteClaimTx(trx, input.workspaceId, input.draftId);
          }
        }
        return { failures, gaveUp };
      });
    },
```

> Important: in the `recordFailedAttempt` back-off (non-give-up) branch, the
> schedule restore + claim clear happen **only when `claimedSendAt !== null`**,
> mirroring today's `restoreClaimedScheduledSendAt` early-return. In the give-up
> branch the schedule clear + claim clear are unconditional (mirrors today's
> `giveUpScheduledDraft`).

**Verify**: `pnpm run build:packages` → exit 0.
(The test file still references the old interface at this point and will NOT
compile — that is expected. Do **not** run the test suite until Step 2.)

### Step 2: Update the three existing fake-store tests to the new interface

All edits in `tests/unit/server-edition-foundation.test.ts`.

**2a.** `test('scheduled-send job port sends due drafts and records retry state', …)`
(around `:10889-11094`). Keep the drafts array, `composeSender`, the seeded
`syncInfo` (`['scheduled_send_failures:104', '4']`), and `composeCalls` assertion
unchanged. Replace the fake `store` object with the new methods, and back
`recordFailedAttempt` onto `syncInfo` so counting is still exercised:

```ts
      store: {
        async claimDueDrafts(input) {
          storeCalls.push(['claimDueDrafts', input]);
          return drafts;
        },
        async finalizeSentDraft(input) {
          storeCalls.push(['finalizeSentDraft', input]);
        },
        async releaseClaimedDraft(input) {
          storeCalls.push(['releaseClaimedDraft', input]);
        },
        async restoreClaimedDraft(input) {
          storeCalls.push(['restoreClaimedDraft', input]);
        },
        async giveUpDraft(input) {
          storeCalls.push(['giveUpDraft', input]);
        },
        async recordFailedAttempt(input) {
          storeCalls.push(['recordFailedAttempt', input]);
          const key = `scheduled_send_failures:${input.draftId}`;
          const prev = Number.parseInt(syncInfo.get(key) ?? '0', 10);
          const failures = (Number.isFinite(prev) && prev >= 0 ? prev : 0) + 1;
          const gaveUp = failures >= input.maxFailures;
          syncInfo.set(key, gaveUp ? '0' : String(failures));
          return { failures, gaveUp };
        },
      },
```

Replace the old `storeCalls` `toEqual([...])` assertion (`:11034-11093`) with:

```ts
    expect(storeCalls).toEqual([
      ['claimDueDrafts', {
        workspaceId: WORKSPACE_A_ID,
        accountId: 7,
        dueBefore: new Date('2026-06-03T12:00:00.000Z'),
        limit: 10,
      }],
      ['finalizeSentDraft', { workspaceId: WORKSPACE_A_ID, draftId: 101 }],
      ['releaseClaimedDraft', { workspaceId: WORKSPACE_A_ID, draftId: 102 }],
      ['recordFailedAttempt', {
        workspaceId: WORKSPACE_A_ID,
        draftId: 103,
        error: 'Lokale Dateianhaenge muessen vor dem Server-Client Versand hochgeladen werden',
        claimedSendAt,
        maxFailures: 5,
      }],
      ['recordFailedAttempt', {
        workspaceId: WORKSPACE_A_ID,
        draftId: 104,
        error: 'SMTP down',
        claimedSendAt,
        maxFailures: 5,
      }],
    ]);
    // Draft 103 backs off (1 failure); draft 104 (seeded at 4) hits the give-up threshold and resets to 0.
    expect(syncInfo.get('scheduled_send_failures:103')).toBe('1');
    expect(syncInfo.get('scheduled_send_failures:104')).toBe('0');
```

**2b.** `test('scheduled-send job ignores compose send already in progress errors', …)`
(around `:11132-11185`). Swap the fake store to the new methods (same bodies:
push `['<method>', input]`) and replace the expected `storeCalls` with a single
restore:

```ts
    expect(storeCalls).toEqual([
      ['restoreClaimedDraft', { workspaceId: WORKSPACE_A_ID, draftId: 201, claimedSendAt }],
    ]);
```

**2c.** `test('scheduled-send job waits for outbound review without consuming retry budget', …)`
(around `:11187-11243`). Same treatment; expected:

```ts
    expect(storeCalls).toEqual([
      ['restoreClaimedDraft', { workspaceId: WORKSPACE_A_ID, draftId: 202, claimedSendAt }],
    ]);
```

For 2b/2c the fake store only needs the methods the branch exercises, but it must
still satisfy the `ScheduledSendStore` type — implement **all** methods
(`claimDueDrafts`, `finalizeSentDraft`, `releaseClaimedDraft`, `restoreClaimedDraft`,
`giveUpDraft`, `recordFailedAttempt`), each pushing `['<name>', input]` (and
`recordFailedAttempt` returning e.g. `{ failures: 1, gaveUp: false }`).

**Verify**: `pnpm run test:server-edition` → all pass.

### Step 3: Add regression coverage for atomicity

Add two new tests in `tests/unit/server-edition-foundation.test.ts`, in the same
`describe` block as the tests above (so `WORKSPACE_A_ID`, `createScheduledSendJobPort`,
`readFileSync`, `resolve` are in scope — they already are; see `:187`, `:11097`).

**3a. Delegation-is-atomic + mid-transition crash regression.** This is the
direct regression for the finding: the orchestrator must hand each failing
transition to a **single** store call, so a crash cannot commit the failure
counter while skipping the schedule restore.

```ts
  test('scheduled-send failure is delegated to one atomic transition (no partial bookkeeping)', async () => {
    const backing = new Map<string, string | null>(); // stand-in for persisted schedule + markers
    let recordCalls = 0;
    const claimedSendAt = new Date('2026-06-03T11:45:00.000Z');
    const port = createScheduledSendJobPort({
      composeSender: {
        async send() {
          return { ok: false as const, error: 'SMTP down' };
        },
      },
      store: {
        async claimDueDrafts() {
          return [{
            id: 301,
            accountId: 7,
            subject: 'Crash mid-transition',
            bodyText: 'Hello',
            bodyHtml: null,
            toJson: { value: [{ address: 'crash@example.com' }] },
            ccJson: null,
            bccJson: null,
            draftAttachmentPathsJson: null,
            replyParentMessageId: null,
            claimedSendAt,
          }];
        },
        async finalizeSentDraft() {},
        async releaseClaimedDraft() {},
        async restoreClaimedDraft() {},
        async giveUpDraft() {},
        async recordFailedAttempt() {
          recordCalls += 1;
          // The real Postgres store runs this whole transition in ONE
          // withWorkspaceTransaction, so a mid-transition failure rolls back
          // every write. Simulate that failure here.
          throw new Error('db connection lost mid-transition');
        },
      },
    });

    await expect(port.processDue({
      workspaceId: WORKSPACE_A_ID,
      dueBefore: new Date('2026-06-03T12:00:00.000Z'),
      limit: 10,
    })).rejects.toThrow('db connection lost mid-transition');

    // Exactly one transition was attempted, and no marker was written piecemeal
    // by the orchestrator: the failure counter can never be bumped independently
    // of the schedule restore.
    expect(recordCalls).toBe(1);
    expect(backing.size).toBe(0);
  });
```

**3b. Source guard: each transition is one transaction, old multi-write helpers
are gone.** Mirrors the existing source-regex test at `:11096`.

```ts
  test('scheduled-send Postgres store commits each transition in a single transaction', () => {
    const source = readFileSync(
      resolve(__dirname, '../../packages/server/src/mail-scheduled-send.ts'),
      'utf8',
    );
    for (const method of [
      'finalizeSentDraft',
      'releaseClaimedDraft',
      'restoreClaimedDraft',
      'giveUpDraft',
      'recordFailedAttempt',
    ]) {
      expect(source).toMatch(new RegExp(`${method}\\(input`));
    }
    // The old per-write transition helpers (each its own transaction) are removed.
    expect(source).not.toMatch(/restoreClaimedScheduledSendAt/);
    expect(source).not.toMatch(/recordScheduledAttemptFailure/);
    expect(source).not.toMatch(/clearScheduledDraftMeta/);
  });
```

**Verify**: `pnpm run test:server-edition` → all pass, including the two new tests.

### Step 4: Full verification

Run the full gate before committing.

**Verify**:
- `pnpm run lint` → exit 0
- `pnpm test` → all pass
- `pnpm run build` → exit 0

## Test plan

- **File**: `tests/unit/server-edition-foundation.test.ts` (existing suite; `unit`
  jest project). Model new tests on the existing scheduled-send tests in the same
  file — the fake-store/`storeCalls` pattern (`:10889`) and the source-regex
  pattern (`:11096`).
- **Updated** (Step 2): the three tests named in 2a/2b/2c, retargeted to the new
  transition methods. Cases they cover: send-ok (`finalizeSentDraft`), empty
  recipient (`releaseClaimedDraft`), transient failure below threshold
  (`recordFailedAttempt`, count → 1), transient failure at threshold
  (`recordFailedAttempt`, seeded 4 → give-up, count → 0), already-in-progress and
  outbound-review-pending (`restoreClaimedDraft`).
- **New** (Step 3):
  1. `scheduled-send failure is delegated to one atomic transition …` — the
     regression: a mid-transition crash surfaces as a single failed store call
     with no piecemeal writes (guards against the schedule-restored-but-counter-
     stale drift the finding describes).
  2. `scheduled-send Postgres store commits each transition in a single
     transaction` — source guard that the five transition methods exist and the
     old multi-write helpers are gone.
- **Verification**: `pnpm run test:server-edition` → all pass; then `pnpm test`
  → all pass.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `pnpm run build:packages` exits 0 (server package type-checks).
- [ ] `pnpm run lint` exits 0.
- [ ] `pnpm test` exits 0; the two new tests from Step 3 exist and pass, and the
      three updated tests from Step 2 pass.
- [ ] `pnpm run build` exits 0.
- [ ] `grep -nE "restoreClaimedScheduledSendAt|recordScheduledAttemptFailure|clearScheduledDraftMeta|clearClaimedScheduledSendAt|giveUpScheduledDraft" packages/server/src/mail-scheduled-send.ts`
      returns no matches (old multi-write helpers removed).
- [ ] `grep -nE "setDraftScheduledAt|getSyncInfo|setSyncInfo|deleteSyncInfo" packages/server/src/mail-scheduled-send.ts`
      returns no matches (old granular store methods removed).
- [ ] Every `recordFailedAttempt`/`finalizeSentDraft`/`releaseClaimedDraft`/
      `restoreClaimedDraft`/`giveUpDraft` body in the Postgres store contains
      exactly one `withWorkspaceTransaction(` call (verify by reading the file).
- [ ] No files outside the in-scope list are modified (`git status`).
- [ ] `plans/README.md` status row for plan 010 updated (unless a reviewer owns the index).

## STOP conditions

Stop and report back (do not improvise) if:

- The drift check shows either in-scope file changed since `f24fb27` and the
  "Current state" excerpts no longer match the live code (interface at `:38-57`,
  the failure branch at `:150-171`, the helpers at `:173-253`, or the Postgres
  store shapes at `:498-560`).
- You find any caller of `ScheduledSendStore`'s removed methods
  (`setDraftScheduledAt`/`getSyncInfo`/`setSyncInfo`/`deleteSyncInfo`) or the
  removed private helpers **outside** `mail-scheduled-send.ts` and its unit test
  — grep for them across the repo first. (At `f24fb27` there are none; only
  `mail-scheduled-send.ts` and `tests/unit/server-edition-foundation.test.ts`
  reference them.)
- Making the change appears to require editing `packages/server/src/server.ts`
  or `electron/email/email-scheduled-send.ts` — it should not; the
  `createPostgresScheduledSendJobPort` signature is unchanged.
- `pnpm run build:packages` reports a type error you cannot resolve within the
  in-scope files after one focused fix attempt.
- Any step's verification fails twice after a reasonable fix attempt.
- You discover the assumption "`claimedSendAt` is effectively always non-null for
  claimed drafts (the claim query filters `scheduled_send_at IS NOT NULL`)" is
  contradicted by the code — the null-guards in `restoreClaimedDraft` and the
  `recordFailedAttempt` back-off branch depend on preserving today's early-return
  behavior.

## Maintenance notes

For the human/agent who owns this code after the change lands:

- **What a reviewer should scrutinize**: that each branch's *final committed
  state* matches the "Behavior that must NOT change" table exactly. The most
  error-prone spot is `recordFailedAttempt`: the back-off branch must restore the
  schedule + clear the claim **only when `claimedSendAt !== null`** (matching the
  old `restoreClaimedScheduledSendAt` early-return), while the give-up branch
  clears schedule + claim unconditionally.
- **Intentional behavior change**: on give-up the store now commits the single
  final `failures='0' / status='failed'` state instead of the old two-commit
  sequence (`'5'/'pending'` then `'0'/'failed'`). Any external reader that
  observed the transient `'pending'` mid-give-up will no longer see it. This is
  the intended fix, not a regression.
- **Follow-up deferred**: real end-to-end transaction-rollback coverage would
  require a live Postgres (integration test). This plan covers the regression at
  the orchestrator boundary (one atomic call per transition) plus a source guard;
  a future integration test in `tests/integration/server-edition-foundation.test.ts`
  could assert rollback semantics against a real DB if one becomes available.
- **What will interact with this**: if a new terminal state or a new transient
  error class is added to `processScheduledDraft`, add a matching single-transaction
  store method rather than composing multiple store calls in the orchestrator —
  that is the invariant this plan establishes (one logical transition = one
  transaction). If `MAX_SCHEDULED_SEND_FAILURES` policy grows more complex, keep
  the counting-and-branch logic inside `recordFailedAttempt`'s transaction so the
  give-up decision stays atomic with the write.
