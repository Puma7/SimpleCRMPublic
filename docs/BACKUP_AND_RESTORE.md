# Backup And Restore

This document covers the current Docker backup, restore, restore-drill, and doctor foundation.

## Backup Set Format

`docker/backup.sh` writes files into `/backups`:

- `db-<stamp>.dump`: PostgreSQL custom-format dump from `pg_dump -Fc`.
- `attachments-<stamp>.tar`: optional attachment archive when `ATTACHMENTS_DIR` exists.
- `audit-archive-<stamp>.tar`: optional audit archive when `AUDIT_ARCHIVE_DIR` exists.
- `backup-<stamp>.sha256`: SHA-256 manifest for every file in the set.
- `backup-<stamp>.meta`: schema version, required master-key id, and row counts
  for **every table with row level security enabled** — derived from the catalog,
  not from a list in the script, so a new table is covered the moment it exists.
  Covered by the same manifest. While the backup is still running the file is
  named `backup-<stamp>.meta.partial` and is renamed once the dump exists — the
  counts are taken *before* the dump, and a concurrent backup's retention pass
  would otherwise delete a `.meta` with no matching dump as an orphan.

If the counts cannot be taken, the backup still runs — the dump is the valuable
part — but records `row_counts=failed`. **`restore.sh` then refuses to start**,
before `pg_restore` touches anything, because such a backup cannot be checked
for completeness and finding that out afterwards would leave the database
replaced and the application down. If it is the only backup you have, set
`RESTORE_ALLOW_UNVERIFIABLE=1` to accept an unverified restore deliberately; the
run then completes and only warns. In the Compose flow set it on the host —
`RESTORE_ALLOW_UNVERIFIABLE=1 sh ./simplecrm restore` — the `restore` service
passes it through.

The restore and doctor scripts verify the manifest when it exists.

### What The Manifest Proves — And What It Does Not

The manifest detects **accidental damage**: a truncated transfer, a bad disk, a
half-written file. It is **not** proof of origin. It lies next to the files it
describes, so anyone who can change a backup can recompute the hashes in the
same step and the check passes. Treat it as a corruption check, not as
protection against tampering.

If you need that guarantee, the manifest has to be authenticated or stored
apart from the backup — signed, or copied to storage the backup host cannot
write to (append-only bucket, offline medium).

Because of this, the restore path treats the metadata file as untrusted input:
table names out of `backup-<stamp>.meta` are validated as identifiers and
quoted by the server rather than pasted into SQL. `restore.sh` and
`restore-drill.sh` connect as the admin role, so a manipulated backup must not
be able to smuggle statements in through that file.

## What The Backup Does **Not** Contain

**Your `.env` is not in the backup, and a dump alone cannot be restored into a
working system.**

Every secret in the database — mailbox passwords, OAuth tokens, AI provider keys
— is encrypted with the master key. Restore a dump on a host without that exact
key and you get a complete database whose secrets nobody can decrypt.

Mind the two names for it: in `docker/.env` the variable is **`MASTER_KEY`**;
Compose passes it to the API container as `SIMPLECRM_MASTER_KEY`
(`SIMPLECRM_MASTER_KEY: ${MASTER_KEY}`). Writing `SIMPLECRM_MASTER_KEY` into
`docker/.env` does nothing — `${MASTER_KEY}` stays empty and the API comes up
without a key.

`MASTER_KEY` is the one value that cannot be replaced. The other secrets in
`docker/.env` are rotatable and only have to be internally consistent:

- `PG_PASSWORD` / `PG_ADMIN_PASSWORD`: new passwords are fine as long as the
  database roles and `docker/.env` carry the same ones. They protect access to
  the data, they do not encrypt it.
- `ACCESS_TOKEN_SECRET`: a new secret signs newly issued access tokens.
  Existing browser sessions survive it — refresh tokens are hashed
  independently of this secret, so a client simply refreshes once and continues.
  Rotate it deliberately (after a suspected leak) rather than by accident.

Keep a copy of `docker/.env` **outside** the backup volume — a password manager
or an offline copy. Without the master key your backup is only half a backup.

`backup-<stamp>.meta` records the `key_id` values the dump was encrypted with
(never the key itself), and `restore.sh` and `doctor.sh` print them as a
reminder.

The id alone says nothing — the server derives it without passing one, so it is
`default` everywhere. **The fingerprint next to it does say something.** Since
migration 0049 the server stores a fingerprint of the master key in the
database, so it travels with the dump. The key cannot be read out of it.

**Treat that value as a key checker, not as public information.** It is derived
with scrypt, deliberately expensive, and that is not decoration: against a
*random* 32-byte key nothing about it matters, but against a key someone typed
as a passphrase and base64-encoded, a cheap fingerprint would be exactly the
offline oracle it is meant not to be — compute once per guess and compare, no
access to any encrypted secret needed. At roughly 100 ms per candidate that
turns a wordlist run of seconds into one of weeks. Generate the key with
`openssl rand -base64 32`; the server refuses to start on a production
configuration whose key decodes to printable text or to one repeated byte.

Nothing in the backup path can check it — checking needs the key, and the key
lives with the API. **The API does check it: it refuses to start when its
`SIMPLECRM_MASTER_KEY` does not match the database it finds.** A dump restored
with the wrong `.env` therefore fails immediately and visibly, instead of
surfacing weeks later as a mailbox that stopped syncing.

A **missing** key is the same mistake the other way round and is refused too:
if this database was already run with a key, starting without one would mean
working on secrets nobody can read. Only a database with neither a fingerprint
nor a single stored secret counts as a fresh installation and still starts
without a key.

**An empty fingerprint table proves nothing.** Migration 0049 creates it without
a backfill, and a dump taken before 0049 brings it along empty — which is
precisely the case this is meant to catch: an old dump restored with the wrong
`.env`. Taking that as "fresh" would record the wrong key as the truth and
reject the right one later. So when the table is empty but secrets exist, the
key is tried against one of them: the envelope is AEAD-sealed, a foreign key
fails authentication rather than returning garbage. Only a key that proves
itself gets its fingerprint recorded. Secrets that carry a different key id are
the same refusal: decryption checks the id before it starts, so that key cannot
read anything here either — starting anyway would mean writing new secrets
under a second key beside the unreadable ones.

**There is no online re-keying.** Re-encrypting needs the old key, and if you
had it this would not be a problem. So the error message names the path that
actually works: restore the original `.env` — or, if the old key is gone for
good, accept that the encrypted rows are lost, delete them together with the
fingerprint row, and enter every credential again. Clearing
`master_key_fingerprints` alone is not enough; the unreadable rows in `secrets`
would refuse the next start just the same.

The check tolerates exactly one failure: the table not existing yet, because
migrations are a separate service and the API must not depend on the schema
already being current. Every other database error — connection lost, rotated
`PG_PASSWORD`, `too many clients` — aborts the start. A check that could not run
must not look like a check that passed.

Backups taken before 0049 carry no fingerprint; `restore.sh` says so explicitly
rather than implying a check it cannot perform.

## Run A One-Shot Backup

```sh
cd docker
sh ./simplecrm backup
```

Equivalent direct Compose command:

```sh
docker compose --profile backup run --rm backup
```

## Run The Scheduler

```sh
cd docker
sh ./simplecrm backup-scheduler
```

Equivalent direct Compose command:

```sh
docker compose --profile backup-scheduler up -d backup-scheduler
```

Relevant environment values:

- `BACKUP_INTERVAL_SECONDS`: default `86400`.
- `BACKUP_RUN_ON_START`: default `true`.
- `BACKUP_RETENTION_DAILY`: default `7`.
- `BACKUP_RETENTION_WEEKLY`: default `4`.
- `BACKUP_RETENTION_MONTHLY`: default `12`.

Retention keeps the latest backup generations by UTC stamp: 7 daily + 4 weekly + 12 monthly. Each retained `db-*.dump` keeps its matching attachment archive, audit archive, and checksum manifest. Companion files without a matching database dump are removed as orphans.

## Check Backups

Container doctor:

```sh
cd docker
sh ./simplecrm doctor
```

Equivalent direct Compose command:

```sh
docker compose --profile doctor run --rm doctor
```

Node doctor:

```sh
npm run build:packages
npm run doctor:server -- --database-url "$DATABASE_URL" --backup-dir /path/to/backups
```

Doctor checks:

- database connectivity and size;
- migration status;
- ready job count and queue lag;
- stale conversation-lock count;
- latest backup set and SHA-256 manifest verification.

## Restore With Compose Orchestration

Use the host-side orchestration script when running the Docker stack:

```sh
cd docker
sh ./simplecrm restore
```

Equivalent direct script call:

```sh
sh restore-compose.sh
```

With no arguments, it restores the latest `db-*.dump` from the Compose `backups` volume and auto-detects matching attachments/audit archives.

Explicit paths are container paths inside the backups volume:

```sh
sh ./simplecrm restore /backups/db-2026-06-05T10-00-00Z.dump \
  /backups/attachments-2026-06-05T10-00-00Z.tar \
  /backups/audit-archive-2026-06-05T10-00-00Z.tar
```

The script:

1. stops `caddy` and `api`;
2. ensures `postgres` is running;
3. runs the `restore` profile;
4. runs migrations;
5. restarts `api` and `caddy`;
6. waits for API health and optional Caddy health.

Optional health check:

```sh
RESTORE_CADDY_HEALTH_URL=https://crm.example.com/health sh restore-compose.sh
```

## Restore Drill

A restore drill verifies a backup without replacing production data:

```sh
cd docker
sh ./simplecrm restore-drill
```

Equivalent direct Compose command:

```sh
docker compose --profile restore-drill run --rm restore-drill
```

The drill creates a temporary database, restores the dump, verifies the core schema by querying `workspaces`, validates archive tar files when supplied, and drops the temporary database on exit.

## Direct Script Restore

Inside a PostgreSQL client environment:

```sh
DATABASE_URL="postgres://simplecrm_admin:admin-password@postgres:5432/simplecrm" \
PG_RESTORE_ROLE="simplecrm_app" \
  sh docker/restore.sh /backups/db-STAMP.dump /backups/attachments-STAMP.tar /backups/audit-archive-STAMP.tar
```

`restore.sh` uses:

```sh
pg_restore --role="$PG_RESTORE_ROLE" --clean --if-exists --no-owner --dbname "$DATABASE_URL" "$DUMP_PATH"
```

## Known Limits

- Restore should be treated as an operator action; confirm you have the right backup before running it.
- Production restore runbooks and live 100k-mail restore drills are not complete.

## Rolling Back To An Earlier Backup

`restore.sh` runs `pg_restore --clean --if-exists --no-owner` with
`PG_RESTORE_ROLE=simplecrm_app`, so restored objects are owned by the
application role again and later migrations keep working.

Two things to know before you rely on it:

**Restoring an older dump onto the current database does not work across a
schema change.** `pg_restore --clean` drops only the objects it is about to
restore — objects created by later migrations are not in the archive and stay
put. If such a newer table has a foreign key into an older one, the drop fails:
restoring a pre-0038 dump onto a current database makes `pg_restore` try to
`DROP TABLE workspaces` while `mail_acl_bindings` still references it, which
errors out without `CASCADE` and aborts the whole restore. `restore-compose.sh`
then stops before migrations and before restarting the services.

**For a rollback across migrations, restore into an empty database.** Drop and
recreate the database (or point `DATABASE_URL` at a fresh one) and restore
there — that is the only way the newer objects actually disappear. The restore
drill already works this way: it creates a throwaway database per run, which is
why it passes where an in-place rollback would not.

Restoring a dump of the **same** schema version onto the current database is
unaffected and works as expected.

**Roll back code and data together, not one without the other.**

**The restore is verified, not just executed.** After `pg_restore` finishes,
`restore.sh` compares the restored row counts against `backup-<stamp>.meta`.

This is deliberately **not** an equality check. The counts are taken just before
`pg_dump` starts, both against a live database, so rows written in between show
up in the dump but not in the recorded numbers. Demanding equality would raise
false alarms under normal write load, and an alarm that gets ignored out of habit
is worse than no alarm. The restore therefore fails only when a recorded table
**cannot be read back at all** — it is missing, or the query failed, so
completeness was never checked. A table that comes back empty is reported
loudly but does not fail the restore: deleting the last row of a table between
the count and the dump snapshot produces exactly that, legitimately. Any other
divergence is printed as a note.

The underlying failure mode — row level security is forced on nearly every table,
so a dump taken by a role that does not bypass it restores cleanly while being
silently filtered — is checked directly at its cause: `backup.sh` refuses to run
when the backup role neither is a superuser nor holds `BYPASSRLS`. No backup is
better than one you wrongly trust.

Do not skip the pre-update backup in `docker/update.sh`. The migration path is
exercised on an empty database in CI; migrating **populated** production data is
not, and the backup is the actual safety net.
