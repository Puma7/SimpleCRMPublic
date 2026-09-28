# Plan 033: Overlapping backup runs can no longer prune attachment objects the other run still needs

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update this plan's row in
> `plans/README.md` (section "Runde 2") AND tick its checkbox in
> `plans/MASTERPLAN.md`.
>
> **Drift check (run first)**:
> `git diff --stat 9e0491e3..HEAD -- docker/backup.sh docker/backup-attachments.sh tests/unit/server-backup-attachments.test.ts tests/unit/server-backup-restore-scripts.test.ts docs/BACKUP_AND_RESTORE.md`
> If any in-scope file changed, compare the excerpts below against the live code; on a mismatch, STOP.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `9e0491e3`, 2026-09-27

The audit's mechanism is verified and reproduced with a shell scenario: the second run's list then reports `attachment backup object missing` for both reused objects. `docs/BACKUP_AND_RESTORE.md:51-53` claims "no list being written" protects contents. That claim is wrong, because the list is written only after the copy loop.

## Why this matters

The server edition's attachment backup is content-addressed. Each set has a list, and the contents live once in `attachments-store/`. Every `backup.sh` run ends with retention, which deletes store objects that are older than one day and that no list names. A run that *reuses* an existing object neither copies nor touches it. The run also publishes its list only after the copy loop. So while run A (scheduler) is in its copy loop, run B (the pre-update backup from `simplecrm update`, or a manual `simplecrm backup`) can finish, retire the old set that was the only one naming object X, and delete X. Run A then publishes a list naming X. Its set is incomplete, and `restore.sh`, the restore drill and rollback abort on the missing object. The damage stays silent until someone needs the backup. After this plan, only one backup run at a time owns the backups volume, and a reused object is refreshed so a racing prune skips it.

## Current state

- `docker/backup-attachments.sh` (sourced by `backup.sh`, POSIX sh, BusyBox-compatible, no `set -e` of its own):
  - `write_attachment_list` (`:46-101`). The copy loop at `:84-97` skips reused objects without touching them (`:86`):
    ```sh
    while IFS="$_tab" read -r _sha _size _mtime _path; do
      _object="$(attachment_store_object "$_store" "$_sha")"
      [ -f "$_object" ] && continue
    ```
    The list is written only at the end (`:99`): `LC_ALL=C sort -t "$_tab" -k4,4 "$_work/known" > "$_out"`.
  - `prune_attachment_store` (`:179-195`) collects the shas of `attachments-*.list` and `attachments-*.list.partial` (`:186-188`). It then deletes every object from `find "$_store" -type f -mmin +1440` that is not named (`:189-193`).
- `docker/backup.sh` (`#!/bin/sh`, `set -eu`):
  - `:23` `mkdir -p "$BACKUP_DIR"`.
  - `:52-62` sets `discard_unfinished_backup` as the EXIT trap and `trap 'exit 130' INT` / `trap 'exit 143' TERM`.
  - `:67` `write_attachment_list … "$BACKUP_DIR/$ATTACHMENTS_LIST.partial"`, renamed at `:84-88`.
  - `:103` `trap - EXIT INT TERM`.
  - `:105` `prune_backup_retention "$BACKUP_DIR"`, which ends with `prune_attachment_store` (`docker/backup-retention.sh:168-170`).
  - No lock anywhere: `grep -rn 'flock\|\.lock' docker/*.sh` finds nothing.
- Callers that can overlap, all sharing the `backups` volume through the same `postgres:18-alpine` image (BusyBox userland, `docker/docker-compose.yml:178-235`):
  - the `backup-scheduler` container (`docker/backup-scheduler.sh:19-31`, a loop running `sh /app/backup.sh`);
  - `docker/update.sh:393` `compose --profile backup run --rm backup`;
  - `docker/simplecrm:144` (`simplecrm backup`).
  They run in different containers, so their PIDs are in different namespaces.
- **Lock mechanism choice: `mkdir`, not `flock`.** `mkdir` is atomic on the shared volume and works in every userland the tests use. The host's BusyBox in this environment has no `flock` applet (`busybox --list | grep -x flock` → nothing), and the Jest suite runs these scripts with host tools and with BusyBox. Stale-lock detection therefore uses an owner line `<uname -n> <pid> <epoch>`. A same-host dead PID is stale at once; any lock older than 12 h is stale.
- Tests:
  - `tests/unit/server-backup-restore-scripts.test.ts:11-56`: `runBackup(setup, invoke)` runs `backup.sh` with stubbed `psql`/`pg_dump`/`pg_restore`. It returns `{ status, files }`, where `files` is `ls -1A` of the backups dir, so hidden files show up. The four existing tests (`:61-150`) assert exact file lists, so a leftover `.backup.lock` would fail them. That is a free release check.
  - `tests/unit/server-backup-attachments.test.ts:16-50`: `runScenario(script, useBusybox)` with a `run '<function call>'` helper. Each case runs with host tools and with BusyBox.
  - `tests/integration/server-edition-foundation.test.ts:231-245` asserts, via `toContain`, strings in `backup.sh` such as `'prune_backup_retention "$BACKUP_DIR"'` and the `write_attachment_list … .partial` call. Keep those lines verbatim.

## Commands you will need

Prefix every command with `export PATH=/opt/node24/bin:$PATH`.

| Purpose | Command | Expected |
|---|---|---|
| Install | `pnpm install` | exit 0 |
| Focused test | `pnpm exec jest tests/unit/server-backup-attachments.test.ts tests/unit/server-backup-restore-scripts.test.ts` | all pass |
| Unit | `pnpm run test:unit` | all pass |
| Integration (compose/script string checks) | `pnpm exec jest tests/integration/server-edition-foundation.test.ts` | all pass |
| Lint | `pnpm run lint` | exit 0, 0 warnings |
| Shell syntax | `sh -n docker/backup.sh && sh -n docker/backup-attachments.sh && busybox sh -n docker/backup.sh` | exit 0 |

## Scope

**In scope**: `docker/backup.sh`, `docker/backup-attachments.sh`, `tests/unit/server-backup-restore-scripts.test.ts`, `tests/unit/server-backup-attachments.test.ts`, `docs/BACKUP_AND_RESTORE.md`, `CHANGELOG.md`.

**Out of scope**:
- `docker/docker-compose.yml`, `docker/.env.example`. The lock parameters are env overrides with safe defaults and need no Compose plumbing.
- `restore.sh`, `restore-drill.sh`, `doctor.sh`, `update.sh`, `rollback.sh`: they read sets but do not prune.
- `backup-retention.sh` logic.
- Cleaning up stale `*.list.partial` files left by a SIGKILLed run.

## Git workflow

- Branch `advisor/033-backup-run-lock`.
- Commit messages in German, imperative, with an area prefix, e.g. `Backup: nur ein Lauf gleichzeitig, wiederverwendete Anhang-Objekte auffrischen`.
- Do NOT push or open a PR unless the operator says so.

## Steps

### Step 1: Regression tests first (they must fail)

1. In `tests/unit/server-backup-attachments.test.ts`, inside the `describe.each(modes)` block, add the test `'a prune from a concurrent run keeps the objects this run reuses'`. It uses `runScenario`, and the prune is triggered from a `cp` stub in the middle of the second run's copy loop:
   ```sh
   run 'write_attachment_list "$1/att" "$1/backups" "$1/backups/attachments-2026-09-01T00-00-00Z.list"'
   find "$tmp/backups/attachments-store" -type f -exec touch -t 202001010000 {} +
   # Another set that stays (prune does nothing without any list); old, so it is not "the previous list".
   printf '%s\t1\t1\t./anderer/satz.bin\n' "$(printf 'f%.0s' $(seq 1 64))" > "$tmp/backups/attachments-2026-08-01T00-00-00Z.list"
   touch -t 202001010000 "$tmp/backups/attachments-2026-08-01T00-00-00Z.list"
   printf 'Neue Rechnung' > "$tmp/att/ws/mail-sync/2/rechnung.pdf"
   repo="$(pwd)"
   if [ -L "$tmp/bin/cp" ]; then real_cp="$(command -v busybox) cp"; rm -f "$tmp/bin/cp"; else real_cp="$(command -v cp)"; fi
   cat > "$tmp/bin/cp" <<STUB
   #!/bin/sh
   # Ein paralleler Lauf: seine Aufbewahrung entfernt den alten Satz und raeumt den Speicher auf.
   if [ ! -f "$tmp/pruned" ]; then
     : > "$tmp/pruned"
     rm -f "$tmp/backups/attachments-2026-09-01T00-00-00Z.list"
     "$SH" -c '. "$repo/docker/backup-attachments.sh"; prune_attachment_store "\$1"' sh "$tmp/backups"
   fi
   exec $real_cp "\$@"
   STUB
   chmod +x "$tmp/bin/cp"
   run 'write_attachment_list "$1/att" "$1/backups" "$1/backups/attachments-2026-09-02T00-00-00Z.list.partial"'
   [ -f "$tmp/pruned" ] && echo pruned=yes
   run 'verify_attachment_list "$1/backups/attachments-2026-09-02T00-00-00Z.list.partial"' 2>&1 && echo concurrent=complete || echo concurrent=incomplete
   ```
   Expect `pruned=yes` and `concurrent=complete`. Today, with host tools, the output is `attachment backup object missing: … (./ws/mail-sync/1/notiz.txt)`, then the same for `vertrag.pdf`, then `concurrent=incomplete`.
2. In `tests/unit/server-backup-restore-scripts.test.ts` `describe('docker backup.sh')`, add these tests using `runBackup`. Use the pg_dump stub `printf 'PGDMP-complete'` unless a test says otherwise.
   - `'waits for a running backup and gives up without touching it'`. Setup: `mkdir "$BACKUP_DIR/.backup.lock"; printf 'other-host 1 %s\n' "$(date +%s)" > "$BACKUP_DIR/.backup.lock/owner"; export BACKUP_LOCK_WAIT_SECONDS=0`. Expect `status` 75 and `files` equal to `['.backup.lock']`.
   - `'takes over a stale lock'`. Owner line `other-host 1 1000000000`. Expect status 0, and files equal to the complete-set list of the existing success test (no `.backup.lock`).
   - `'takes over the lock of a finished run on the same host'`. In setup: `sh -c 'exit 0' & dead=$!; wait "$dead"; printf '%s %s %s\n' "$(uname -n)" "$dead" "$(date +%s)" > …/owner`. Expect status 0 and no `.backup.lock`.
   - `'holds the lock while it dumps'`. pg_dump stub: `[ -f "$BACKUP_DIR/.backup.lock/owner" ] || exit 9; printf 'PGDMP-complete'`. Expect status 0.

**Verify**: `pnpm exec jest tests/unit/server-backup-attachments.test.ts tests/unit/server-backup-restore-scripts.test.ts`. The new tests fail: `concurrent=incomplete`, status 0 instead of 75, and status non-zero for the dump stub (the lock file is missing). The existing tests pass.

### Step 2: Refresh reused objects (defense in depth)

In `docker/backup-attachments.sh`, replace `:86` with:
```sh
    if [ -f "$_object" ]; then
      # Wiederverwendet: frisches mtime, damit die Aufraeumung eines parallelen
      # Laufs (nur Objekte aelter als ein Tag) es nicht entfernt, bevor diese
      # Liste es nennt.
      touch -c "$_object" 2>/dev/null || true
      continue
    fi
```
Also correct the header comment at `:22-24`: an object is protected by a list, or by being younger than one day. A reused object is refreshed.

**Verify**: `pnpm exec jest tests/unit/server-backup-attachments.test.ts` → all pass, both modes (BusyBox is skipped if absent).

### Step 3: One backup run at a time

In `docker/backup.sh`, add the following directly after `mkdir -p "$BACKUP_DIR"` (`:23`) and before `assert_backup_role_reads_all_rows`. It keeps the German comment style and uses POSIX sh, safe under `set -eu`:
```sh
# Nur ein Lauf gleichzeitig: Scheduler, Update und `simplecrm backup` teilen das
# Backup-Volume. Die Aufraeumung eines Laufs darf keine Anhang-Objekte entfernen,
# die ein anderer gerade wiederverwendet. mkdir ist atomar, auch ueber
# Container hinweg; PIDs anderer Container sind hier nicht pruefbar, daher gilt
# eine Sperre nach BACKUP_LOCK_STALE_SECONDS als verwaist.
BACKUP_LOCK_DIR="$BACKUP_DIR/.backup.lock"
BACKUP_LOCK_WAIT_SECONDS="${BACKUP_LOCK_WAIT_SECONDS:-3600}"
BACKUP_LOCK_STALE_SECONDS="${BACKUP_LOCK_STALE_SECONDS:-43200}"
```
Validate both values with a `case … ''|*[!0-9]*)` check, as in `docker/backup-scheduler.sh:7-12` (message plus `exit 2`). Then define:
- `backup_lock_owner()`: `cat "$BACKUP_LOCK_DIR/owner" 2>/dev/null || true`.
- `backup_lock_is_stale()`. Read the owner into positional parameters (`set -- $(backup_lock_owner)` with a `# shellcheck disable=SC2046` comment). If `$# -ne 3` or `$3` is not numeric: stale when the directory's `stat -c %Y` is more than 60 s old. That covers a run killed between `mkdir` and writing the owner. Otherwise it is stale when (`$1` = `$(uname -n)` and `! kill -0 "$2" 2>/dev/null`), or when `$(( $(date +%s) - $3 )) -gt $BACKUP_LOCK_STALE_SECONDS`.
- `acquire_backup_lock()`. Loop `until mkdir "$BACKUP_LOCK_DIR" 2>/dev/null`:
  - if stale, print `backup: removing stale lock (<owner>)` to stderr, `rm -rf` the directory and `continue`;
  - if `_waited -ge BACKUP_LOCK_WAIT_SECONDS`, print `backup: another backup is running (<owner>); gave up after ${_waited}s` and `exit 75`;
  - otherwise `sleep 5` and add 5 to `_waited`.
  
  After the loop, write `printf '%s %s %s\n' "$(uname -n)" "$$" "$(date +%s)" > "$BACKUP_LOCK_DIR/owner"`.
- `release_backup_lock()`. Remove the directory only if its owner line starts with `"$(uname -n) $$ "` (a `case` pattern). Never remove another run's lock.

Wire the traps:
1. Before `acquire_backup_lock`, set `trap release_backup_lock EXIT`, `trap 'exit 130' INT` and `trap 'exit 143' TERM`, then call `acquire_backup_lock`.
2. Append `release_backup_lock` as the last line of `discard_unfinished_backup`.
3. Replace `:103` `trap - EXIT INT TERM` with `trap release_backup_lock EXIT` (the INT/TERM traps stay). The lock must be held during `prune_backup_retention`.
4. After `prune_backup_retention "$BACKUP_DIR"`, add `release_backup_lock` and `trap - EXIT INT TERM`.

Keep the lines asserted by `server-edition-foundation.test.ts` unchanged.

**Verify**: the shell syntax row → exit 0. `pnpm exec jest tests/unit/server-backup-restore-scripts.test.ts` → all pass, including the SIGTERM test (no `.backup.lock` left behind).

### Step 4: Docs and changelog

- `docs/BACKUP_AND_RESTORE.md`: in "Incremental attachments" (`:51-53`), fix the retention bullet as in Step 2. Under "Run The Scheduler", add a short paragraph: only one backup runs at a time (`.backup.lock` in the backups volume); another run waits up to `BACKUP_LOCK_WAIT_SECONDS` (default 3600) and then exits with code 75; a lock older than `BACKUP_LOCK_STALE_SECONDS` (default 43200) or from a finished process in the same container is taken over.
- `CHANGELOG.md` `[Unreleased]` `### Fixed`: `- **Server:** Liefen zwei Sicherungen gleichzeitig (Zeitplan und Update oder \`simplecrm backup\`), konnte die Aufräumung der einen Anhang-Inhalte entfernen, die die andere gerade wiederverwendete; deren Satz war dann unvollständig und Wiederherstellen oder Rollback brachen ab. Jetzt läuft immer nur eine Sicherung, die zweite wartet (höchstens eine Stunde).`

**Verify**: `pnpm exec jest tests/unit/server-edition-docs.test.ts tests/integration/server-edition-foundation.test.ts` → all pass. `pnpm run test:unit` → all pass. `pnpm run lint` → 0 warnings.

## Test plan

- The race regression runs in both modes (host tools and BusyBox) and fails without Step 2. The `cp` stub calls the real prune in the middle of the copy loop.
- Four lock tests in `server-backup-restore-scripts.test.ts`: refuse on a live foreign lock, take over a stale one, take over one from a dead same-host PID, and hold the lock during the dump. The existing four tests prove release on success, failure and SIGTERM, because they assert exact `ls -1A` listings.

## Done criteria

- [ ] New tests fail before Steps 2–3 and pass after them. `pnpm run test:unit` and `server-edition-foundation.test.ts` pass.
- [ ] `grep -n 'acquire_backup_lock\|release_backup_lock' docker/backup.sh` shows the definitions plus the call sites (acquire, the discard trap, the EXIT trap, and after prune).
- [ ] `grep -n 'touch -c "\$_object"' docker/backup-attachments.sh` matches.
- [ ] `sh -n` / `busybox sh -n` pass. `git status` shows only in-scope files.
- [ ] `plans/README.md` row and `plans/MASTERPLAN.md` checkbox are updated.

## STOP conditions

- `busybox sh` rejects a construct you used (e.g. `kill -0` or `stat -c %Y` behave differently). Report; do not switch to `flock` without confirming it exists in `postgres:18-alpine`.
- An existing `server-backup-restore-scripts` test fails because of a leftover `.backup.lock`, and the fix would mean giving up the owner check in `release_backup_lock`.
- Keeping the `toContain` strings in `server-edition-foundation.test.ts` seems to require changing that test.

## Maintenance notes

- The stale-lock takeover has a small time-of-check/time-of-use window: two waiters could both judge the same lock stale. With at most two concurrent runs and a 12 h threshold this is acceptable. A reviewer should confirm that `release_backup_lock` only removes its own lock.
- If restore or rollback ever start pruning, they must take the same lock.
- Deferred: removing orphaned `attachments-*.list.partial` files after a SIGKILL. Such files keep their objects forever, which is safe but wastes space.
