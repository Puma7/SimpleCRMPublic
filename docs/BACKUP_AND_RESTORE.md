# Backup And Restore

This document covers the current Docker backup, restore, restore-drill, and doctor foundation.

## Backup Set Format

`docker/backup.sh` writes files into `/backups`:

- `db-<stamp>.dump`: PostgreSQL custom-format dump from `pg_dump -Fc`.
- `attachments-<stamp>.tar`: optional attachment archive when `ATTACHMENTS_DIR` exists.
- `audit-archive-<stamp>.tar`: optional audit archive when `AUDIT_ARCHIVE_DIR` exists.
- `backup-<stamp>.sha256`: SHA-256 manifest for every file in the set.
- `backup-<stamp>.meta`: schema version, required master-key id, and row counts
  for the core tables. Covered by the same manifest, so it cannot be edited
  without breaking checksum verification.

The restore and doctor scripts verify the manifest when it exists.

## What The Backup Does **Not** Contain

**Your `.env` is not in the backup, and a dump alone cannot be restored into a
working system.**

Every secret in the database — mailbox passwords, OAuth tokens, AI provider keys
— is encrypted with `SIMPLECRM_MASTER_KEY`, which lives only in `docker/.env`.
Restore a dump on a host without that exact key and you get a complete database
whose secrets nobody can decrypt. The same applies to `ACCESS_TOKEN_SECRET`
(all sessions become invalid) and to `PG_PASSWORD` / `PG_ADMIN_PASSWORD`.

Keep a copy of `docker/.env` **outside** the backup volume — a password manager
or an offline copy. Without it your backup is only half a backup.

`backup-<stamp>.meta` records the `key_id` values the dump was encrypted with
(never the key itself). `restore.sh` and `doctor.sh` print them, so a key
mismatch surfaces during a drill instead of during an incident.

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

**`--clean` only drops what the dump knows about.** Tables and columns created
by migrations that ran *after* the dump was taken survive the restore, because
they do not appear in the archive. At the same time `simplecrm_schema_migrations`
comes back at the dump's state, so the migrate CLI will re-apply those
migrations on the next update. Today's migrations are written with
`IF NOT EXISTS` and tolerate that, but it is a property of those migrations, not
a guarantee. **Roll back code and data together, not one without the other.**

**The restore is verified, not just executed.** After `pg_restore` finishes,
`restore.sh` compares the restored row counts against `backup-<stamp>.meta`.

This is deliberately **not** an equality check. The counts are taken just before
`pg_dump` starts, both against a live database, so rows written in between show
up in the dump but not in the recorded numbers. Demanding equality would raise
false alarms under normal write load, and an alarm that gets ignored out of habit
is worse than no alarm. The restore therefore fails only on the case that cannot
arise harmlessly: **the backup recorded rows and the restore has none.** Any
other divergence is printed as a note.

The underlying failure mode — row level security is forced on nearly every table,
so a dump taken by a role that does not bypass it restores cleanly while being
silently filtered — is checked directly at its cause: `backup.sh` refuses to run
when the backup role neither is a superuser nor holds `BYPASSRLS`. No backup is
better than one you wrongly trust.

Do not skip the pre-update backup in `docker/update.sh`. The migration path is
exercised on an empty database in CI; migrating **populated** production data is
not, and the backup is the actual safety net.
