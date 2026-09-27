# Plan 027: One damaged mail original no longer stalls storage dedup or crashes `simplecrm maintenance`

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update this plan's row in
> `plans/README.md` (section "Runde 2") AND tick its checkbox in
> `plans/MASTERPLAN.md`.
>
> **Drift check (run first)**:
> `git diff --stat 9e0491e3..HEAD -- packages/server/src/mail-raw-part-dedup.ts packages/server/src/mail-raw-compression-backfill.ts packages/server/src/mail-attachment-dedup.ts packages/server/src/mail-raw-part-gc.ts packages/server/src/maintenance/storage-maintenance.ts tests/integration/postgres-mail-raw-parts.test.ts tests/integration/postgres-mail-attachment-dedup.test.ts tests/integration/postgres-mail-raw-part-gc.test.ts tests/integration/postgres-storage-maintenance.test.ts`
> If any in-scope file changed, compare the excerpts below against the live code; on a mismatch, STOP.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `9e0491e3`, 2026-09-27

Audit claim verified. One addition: `mail-attachment-dedup.ts` has the same per-item pattern (an unreadable file aborts the whole run, and every tick restarts from the first group), and `mail-raw-compression-backfill.ts` too (lower risk). Both are in scope.

## Why this matters

The server edition's storage jobs (compress originals, take attachment parts out of originals, link identical attachments, remove unreferenced parts) all walk rows or files in a fixed order. They have no error handling per item, and each tick starts from the beginning again. A single damaged stored original (for example brotli data that cannot be decompressed, or a sha256 mismatch) makes `loadStoredRaw` throw. That aborts the whole tick, the next tick starts at `lastId = 0` and hits the same row, so no later mail is ever deduplicated again. `simplecrm maintenance` (without `--check-only`) runs the same batches *before* its checks, so it crashes exactly when there is a damaged original to report. After this plan, each failing item is logged with its id, counted, and skipped. The run continues, and the maintenance report lists the failures and exits 1.

## Current state

Server edition only. The desktop edition has no raw-part storage (`grep -rln part_sha256s electron src` → nothing).

- `packages/server/src/mail-raw-part-dedup.ts:97-108`: the loop has no try/catch:
  ```ts
  for (const candidate of candidates) {
    const id = Number(candidate.id);
    result.lastId = id;
    const outcome = await dedupOneMessage(options, candidate.workspace_id, id);
  ```
  `dedupOneMessage` (`:112-202`) calls `loadStoredRaw(row)` (`:148`) and `encodeRawWithPartsForStorage` (`:183`). Both throw `StoredRawIntegrityError` (`packages/server/src/mail-raw-storage.ts:83`, throws at `:109, :161, :178, :184, :188, :194, :201, :204`). It also calls `ensurePartObject` (`packages/server/src/mail-raw-parts.ts:345-369`), whose `fileSha256` (`:356`) and `mkdir` (`:357`) throw on unreadable files or directories.
- `mail-raw-part-dedup.ts:216-235`: the ticker. `let lastId = 0;` on every tick, with one try/catch around the whole tick: `console.warn('[mail] attachment part dedup stopped (retry next tick): …')`.
- `packages/server/src/mail-raw-compression-backfill.ts:75-86`: the same unguarded loop around `convertOneRow`. `startRawCompressionBackfillRun` (`:132-171`) aborts the run on the first error ("retry next start").
- `packages/server/src/mail-attachment-dedup.ts:185-193`: `runAttachmentDedup` calls `dedupAttachmentGroup` unguarded. Inside it, `fileSha256` (`:144`, `:158`) throws on EACCES or when a file vanishes. `after = group` is set only after success. The ticker (`:206-219`) restarts from `after = null`.
- `packages/server/src/mail-raw-part-gc.ts:161-165`, uncaught `unlink`:
  ```ts
  const info = await stat(entry.file).catch(() => null);
  if (!info) continue;
  await unlink(entry.file);
  ```
  The `mkdir` calls at `:153` and `:193` are uncaught as well. `runRawPartGc` (`:199-218`) loops over workspace folders, so one throw aborts all remaining entries and workspaces.
- `packages/server/src/maintenance/storage-maintenance.ts`: `runCleanup` (`:244-264`) runs the three batch jobs. `runStorageMaintenance` (`:266-286`):
  ```ts
  // Cleanup first, so the checks see the final state.
  if (!options.checkOnly) report.cleanup = await runCleanup(options);
  report.unreferencedParts = await runRawPartGc({ ...options, checkOnly: options.checkOnly === true });
  ```
  The report type is at `:53-81` (`cleanup: { compressed; partsTakenOut; filesLinked; bytesFreed } | null`), the unreferenced-parts literal is at `:271`, and the German formatter `formatStorageMaintenanceReport` is at `:289-339`. Value columns start at character 38, e.g. `'  Frei geworden (ca.):                '`.
- CLI: `packages/server/src/cli/maintenance.ts:59-70` prints the formatter output and returns `report.ok ? 0 : 1`. An exception reaches `maintenance failed: <stack>` (`:76-78`). `docker/simplecrm:131-132` only forwards to it. `docker/update.sh:492` runs `--check-only`, which is unaffected.
- Existing tests (embedded Postgres): `tests/integration/postgres-mail-raw-parts.test.ts` (dedup batch loop at `:131-138`), `postgres-storage-maintenance.test.ts` (two tests, the second corrupts state with `checkOnly: true`), `postgres-mail-raw-part-gc.test.ts`, `postgres-mail-attachment-dedup.test.ts`. `RawPartGcResult` results are asserted with `toMatchObject`, so adding fields is safe.

**Design decision (no migration):** failing rows are not marked in the database. Writing `raw_rfc822_part_sha256s = []` would claim "scanned, nothing to take out" and hide a transient file-system error for good. The periodic ticker keeps an in-memory set of failed message ids per process instead, so it skips them on later ticks and logs each one once. After a restart the ids are tried once more. Maintenance always retries and reports them.

## Commands you will need

Prefix every command with `export PATH=/opt/node24/bin:$PATH`.

| Purpose | Command | Expected |
|---|---|---|
| Install | `pnpm install` | exit 0 |
| Build workspace packages | `pnpm run build:packages` | exit 0 |
| Typecheck (all) | `pnpm run typecheck` | exit 0 |
| Lint | `pnpm run lint` | exit 0, 0 warnings |
| Focused test | `pnpm exec jest <test file path>` | all pass |
| Integration | `pnpm run test:integration` | all pass |
| Server coverage ratchet | `pnpm run test:server:coverage && node scripts/check-server-coverage-ratchet.mjs` | pass |

The embedded-Postgres tests refuse to run as root (initdb). As root, first run `chmod -R a+rwX .tmp-tests tests packages/core/dist packages/server/dist`, then:
`su tester -s /bin/bash -c "export PATH=/opt/node24/bin:\$PATH; cd /home/user/SimpleCRMPublic && node_modules/.bin/jest --cacheDirectory /tmp/jest-tester --forceExit <file>"`.
Keep `jest.mock('kysely', () => jest.requireActual('../../packages/server/node_modules/kysely'))` in every Postgres test file. The chmod-based tests below need a non-root user anyway.

## Scope

**In scope**: the five source files and four test files in the drift check, plus `CHANGELOG.md`.

**Out of scope**:
- Any migration or schema change, and persistent "skip" markers (see the design decision above).
- `checkOriginals` / `checkAttachments` in `storage-maintenance.ts`: they already catch per row.
- `mail-raw-storage.ts`: throwing on damage is correct. Only callers change.
- Desktop edition (`electron/`): not affected.

## Git workflow

- Branch `advisor/027-raw-part-dedup-resilience`.
- Commit messages in German, imperative, with an area prefix, e.g. `Mail-Speicher: beschädigtes Original überspringen statt Dedup und Wartung anzuhalten`.
- Do NOT push or open a PR unless the operator says so.

## Steps

### Step 1: Regression tests first (they must fail)

1. `tests/integration/postgres-mail-raw-parts.test.ts`: add a third test in the existing `describe`, placed after the two tests (it reuses their state).
   ```ts
   test('a damaged original is skipped and reported; later mail is still processed', async () => {
     const first = await rowOf(1);
     const second = await rowOf(2);
     await postgres.admin.query(`UPDATE email_messages SET raw_rfc822_z = '\\x00010203'::bytea, raw_rfc822_codec = 'br',
       raw_rfc822_part_sha256s = NULL, has_attachments = true WHERE id = $1`, [first.id]);
     await postgres.admin.query(`UPDATE email_messages SET raw_rfc822_part_sha256s = NULL WHERE id = $1`, [second.id]);
     const failures: Array<{ messageId: number; error: string }> = [];
     for (let afterId = 0; ;) {
       const batch = await runRawPartDedupBatch({ db, attachmentsRoot }, afterId);
       if (batch.seen === 0) break;
       afterId = batch.lastId;
       failures.push(...batch.failures);
     }
     expect(failures).toEqual([{ messageId: Number(first.id), error: expect.stringContaining('cannot be decompressed') }]);
     expect((await rowOf(2)).raw_rfc822_part_sha256s).toEqual([]);
     // Mit Überspringen-Liste wird die Zeile gar nicht erst gelesen.
     const skipped = await runRawPartDedupBatch({ db, attachmentsRoot }, 0, 20, new Set([Number(first.id)]));
     expect(skipped.failures).toEqual([]);
   });
   ```
2. `tests/integration/postgres-storage-maintenance.test.ts`: add a third test after the existing two. Set uid 1 to the same damaged `'br'` value, set `raw_rfc822_part_sha256s = NULL` on uid 4, then call `runStorageMaintenance({ db, attachmentsRoot })` (no `checkOnly`). Expect: it resolves, `report.cleanup!.failed` ≥ 1, `report.cleanup!.examples.join('\n')` contains `message <id of uid 1>`, uid 4's `raw_rfc822_part_sha256s` equals `[]` again, `report.ok` is `false`, and `formatStorageMaintenanceReport(report)` contains `Nicht bearbeitet (Fehler):`.
3. `tests/integration/postgres-mail-raw-part-gc.test.ts`: add a test that skips when `process.getuid?.() === 0`. It creates two set-aside files for random shas that no message names, each in its own bucket under `setAsidePartsDir(partsDir)`. Use `setAsidePartPath(partsDir, sha, Date.now() - UNREFERENCED_GRACE_MS - 60_000)` from `mail-raw-parts`. Then `chmodSync(<bucket of file A>, 0o555)`, run `runRawPartGc({ db, attachmentsRoot })`, and restore `0o755` in `finally`. Expect: it resolves, `failed: 1`, `removed: 1`, file A still exists, file B is gone, and `result.failures[0]` contains file A's name.
4. `tests/integration/postgres-mail-attachment-dedup.test.ts`: add a test after the existing one (non-root guard). It `chmodSync(third, 0o000)` (the damaged copy is still its own inode), runs `runAttachmentDedup({ db, attachmentsRoot })`, and restores `0o644` in `finally`. Expect: it resolves and `failed === 1`.

**Verify**: run the four files (as a non-root user). The new tests fail: either TypeScript errors on `failures`/`failed`, or rejections like `stored original cannot be decompressed` / `EACCES`. The old tests still pass.

### Step 2: Per-row isolation in the two batch functions

- `mail-raw-part-dedup.ts`:
  - Add `failures: Array<{ messageId: number; error: string }>` to `RawPartDedupBatchResult` and initialise it to `[]`.
  - Add a 4th parameter `skipIds?: ReadonlySet<number>`.
  - In the loop, after `result.lastId = id;`: `if (skipIds?.has(id)) continue;`. Then wrap `dedupOneMessage` in `try { … } catch (error) { result.failures.push({ messageId: id, error: error instanceof Error ? error.message : String(error) }); continue; }`.
  - Ticker: create `const failedIds = new Set<number>();` once, outside `tick`, and pass it to `runRawPartDedupBatch(options, lastId, undefined, failedIds)`. For each failure whose id is not yet in the set: add it (only while `failedIds.size < 10_000`) and `console.warn(`[mail] attachment part dedup skipped message ${f.messageId} (stored original unreadable, see simplecrm maintenance): ${f.error}`)`.
  - Update the doc comment above `startRawPartDedupTicker` to say this.
- `mail-raw-compression-backfill.ts`: the same pattern. Add `failures` to `RawCompressionBatchResult` and catch around `convertOneRow`. In `startRawCompressionBackfillRun`, log each failure with its id and continue. Change the doc comment "A failing row aborts the run" to say it is skipped and logged.

**Verify**: `pnpm run build:packages` → exit 0. `postgres-mail-raw-parts.test.ts` → all pass.

### Step 3: Attachment dedup and part GC keep going

- `mail-attachment-dedup.ts`:
  - Add `failed: number; failures: string[]` to `AttachmentDedupResult`.
  - In `runAttachmentDedup`, set `after = group;` *before* the call, then `try { outcome = await dedupAttachmentGroup(...) } catch (error) { total.failed += 1; if (total.failures.length < 10) total.failures.push(`workspace ${group.workspace_id} sha256 ${group.content_sha256}: ${message}`); continue; }`.
  - The ticker warns when `result.failed > 0`.
- `mail-raw-part-gc.ts`:
  - Add `failed: number; failures: string[]` (at most 10 entries) to `RawPartGcResult` and initialise it at `:200`.
  - Wrap the per-entry filesystem operations (`mkdir`+`rename` at `:153-154`, `unlink` at `:163`, `mkdir` at `:193`) so that one failure counts `failed`, records `<path>: <message>`, and goes on with the next entry. Count `removed`/`bytesFreed` only after a successful unlink.
  - In `runRawPartGc`, wrap each workspace's `sweepSetAside` + `setAsideUnreferenced` in try/catch (record `workspace <id>: <message>`).
  - **Never** turn a failed `referencedShas` query into "not referenced": the catch must skip the batch, never remove anything.
  - The ticker warns when `failed > 0`.

**Verify**: `pnpm run build:packages` → exit 0. The GC and attachment-dedup test files → all pass.

### Step 4: Maintenance report surfaces failures instead of crashing

In `storage-maintenance.ts`:
- Extend `cleanup` with `failed: number; examples: string[]`.
- In `runCleanup`, add each batch's `failures` to `failed`, push examples as `message ${id}: ${error}` (up to `MAX_EXAMPLES`), and add `linked.failed` / `linked.failures`.
- Wrap each of the three steps in its own try/catch that records `compress originals stopped: …` / `take parts out stopped: …` / `link identical attachments stopped: …` and continues with the next step.
- In `runStorageMaintenance`, wrap `runRawPartGc` too (on throw: keep the zero result and record `unreferenced parts stopped: …` in `unreferencedParts.failures`, `failed += 1`). Extend the literal at `:271` with `failed: 0, failures: []`.
- `ok` additionally requires `(report.cleanup?.failed ?? 0) === 0 && report.unreferencedParts.failed === 0`.
- Formatter:
  - Add `  Nicht bearbeitet (Fehler):          ${report.cleanup.failed}` (10 spaces after the colon, so the value starts at column 38) to the cleanup block.
  - Add `  Nicht entfernbar (Fehler):          ${u.failed}` only when `u.failed > 0`.
  - Merge `report.cleanup?.examples ?? []` and `u.failures` into the `Beispiele:` list.

**Verify**: `pnpm exec jest tests/integration/postgres-storage-maintenance.test.ts` (non-root) → 3 passed. `pnpm run typecheck` → exit 0.

### Step 5: Changelog, full gates

Add a `### Fixed` entry in `CHANGELOG.md` `[Unreleased]`, e.g.: `- **Server:** Ein beschädigtes Mail-Original hielt das Herausnehmen der Anhänge aus Originalen für alle späteren Mails an, und \`simplecrm maintenance\` brach ab, statt es zu melden. Jetzt wird die betroffene Mail übersprungen und mit ihrer ID gemeldet; die Wartung zeigt „Nicht bearbeitet (Fehler)“ und endet mit Exit-Code 1. Gleiches gilt für nicht lesbare Anhang-Dateien und nicht entfernbare Anhangkopien.`

**Verify**: `pnpm run lint` → 0 warnings. `pnpm run test:integration` → all pass. The server coverage ratchet → pass.

## Test plan

Four new integration tests (Step 1): the dedup batch skips and reports a damaged row and still marks the next row; maintenance without `--check-only` resolves and reports; GC keeps going after an `EACCES` unlink; attachment dedup keeps going after an `EACCES` read. The existing tests must stay green unchanged. They use `toMatchObject` on the result objects, so the new fields do not break them.

## Done criteria

- [ ] The four new tests fail before Steps 2–4 and pass after them.
- [ ] `pnpm run typecheck`, `pnpm run lint`, `pnpm run test:integration` and the server coverage ratchet all pass.
- [ ] `grep -n "retry next tick" packages/server/src/mail-raw-part-dedup.ts` still matches (a tick-level catch for DB outages remains), and `grep -n "skipIds" packages/server/src/mail-raw-part-dedup.ts` matches.
- [ ] No migration file added (`git status packages/server/src/migrations` is clean).
- [ ] `CHANGELOG.md` has the entry. `plans/README.md` row and `plans/MASTERPLAN.md` checkbox are updated.

## STOP conditions

- Any catch you add would make GC treat a failed DB lookup as "unreferenced", or would let it delete anything it did not delete before.
- The damaged-row test cannot be built because a CHECK constraint or trigger rejects the `UPDATE` (e.g. a codec/sha constraint). Report the constraint instead of weakening the test.
- Fixing this seems to need a schema change or a change to `loadStoredRaw` semantics.
- Postgres tests cannot run in your environment even as a non-root user. Report; do not mark the plan done on unit tests alone.

## Maintenance notes

- New batch jobs over `email_messages` should follow this pattern: per-item try/catch, advance the cursor on failure, report ids.
- The in-memory `failedIds` set is per process and capped at 10 000 entries. A heavily damaged store therefore still logs at most once per id per start.
- Reviewers: check that `after = group` / `result.lastId = id` advance *before* the risky call, and that `ok` turns false when there are failures (CLI exit 1).
- Deferred: a persistent "damaged" marker (would need a migration), and automatic repair from the IMAP source.
