# Operational Learnings — Server Updates, Migrations, Compose

Hard-won lessons from running and updating the Docker Compose server edition.
Read this before touching a production deployment or authoring a migration.

See also: [`SETUP_SERVER.md`](SETUP_SERVER.md) (setup + upgrade steps),
[`BACKUP_AND_RESTORE.md`](BACKUP_AND_RESTORE.md).

---

## 1. Updating a deployment

One command, from the repo root on the server:

```sh
sh docker/update.sh
```

It runs, in order, aborting on the first failure (`set -e`):
**pull `origin/main` → backup DB → build images → apply migrations →
restart `api` + `caddy` → verify** (`migrate --check` + `compose ps`).

- The script is safe to re-run; a failed step never leaves a half-updated stack
  (each migration is its own transaction, and `api` only starts after `migrate`
  exits 0 via `depends_on: service_completed_successfully`).
- A self-update during step 1 is safe: `git` replaces files via atomic
  `rename`, so the running shell finishes reading the old script; the new
  version takes effect next run.
- Flags/env: `--branch <name>` / `BRANCH=`, `--no-pull` / `SKIP_PULL=1`,
  `--no-backup` / `SKIP_BACKUP=1`, `FORCE_RESET=1` (discard local tracked-file
  changes), `REPAIR_CHECKSUMS=1` (see §3). Same surface via
  `sh docker/simplecrm update [...]`.

**First time only:** the script lives in the repo, so the very first time you
must `git pull` it onto the server manually (merge the PR that adds it, then
`git fetch && git checkout main && git reset --hard origin/main`). Every update
after that is just `sh docker/update.sh`.

---

## 2. One stack, one project name (the dual-stack trap)

Docker Compose derives the **project name** from the directory containing the
compose file. For `-f docker/docker-compose.yml` that is **`docker`**. A stack's
identity (containers + named volumes) is keyed on that project name.

**The trap:** a helper that forces a *different* `-p` (we used to hardcode
`simplecrm`) silently creates a **second, parallel stack on empty volumes**.
Both run; production keeps serving from the original while you "update" the
empty one — and the migrate check on the empty DB reports success. Pure silent
fail. This actually happened.

Rules that prevent it:

- All tooling now derives the project name (and `--project-directory`) from the
  compose file's directory, so `docker/simplecrm`, `docker/update.sh`,
  `docker/restore-compose.sh`, and plain `docker compose -f ...` all target the
  **same** stack. Override only via an explicit `COMPOSE_PROJECT_NAME`.
- `update.sh` refuses to run if a legacy stack named `simplecrm` exists while it
  would operate on a different, empty project — and tells you to re-run with
  `COMPOSE_PROJECT_NAME=simplecrm`.
- To see what stacks exist: `docker compose ls -a`. To see which is serving
  traffic: `docker port <project>-caddy-1` (the live one has 80/443 mapped).

Also: always pass `--project-directory` (the tooling does) so the project's
`.env` is loaded from the compose dir, not a stray `.env` in your shell's PWD.

---

## 3. Migration checksum integrity

The runner stores each applied migration's id + a SHA256 checksum (over id +
description + SQL) in `simplecrm_schema_migrations`. On every run it verifies the
stored checksum against the code. A mismatch **aborts the whole run** with
`Checksum mismatch for server migration <id>`. This is a feature.

**Why it happens:** an upstream change edited an *already-applied* migration.
The canonical (and legitimate) reason is the **dual-write pattern**: a baseline
migration is updated so *fresh installs* get the new schema directly, while a
*later* migration re-applies the same delta **idempotently** (`ADD COLUMN IF NOT
EXISTS`, `CREATE TABLE/INDEX IF NOT EXISTS`, `DROP CONSTRAINT IF EXISTS`) for
*existing installs*. Example in this repo: `0023_account_scope_overrides`
re-applies the deltas that PR #112 also baked into `0007`/`0008`.

**Recovery** — only when you've confirmed the delta IS backed by such a later
migration (so existing DBs converge to the same schema):

```sh
REPAIR_CHECKSUMS=1 sh docker/update.sh
# or directly:
docker compose run --rm --entrypoint node migrate \
  packages/server/dist/cli/migrate.js --repair-checksums
```

`--repair-checksums` re-stamps the stored checksum of already-applied migrations
that still exist in code, in one transaction, then applies pending migrations.
It leaves rows for unknown migration ids untouched so genuine corruption stays
visible.

**Why it's opt-in (do not auto-run it):** blindly repairing would also bless
*real* drift — a migration edit NOT backed by a later idempotent migration —
leaving production on the old schema while metadata claims it matches the new
code. `update.sh` therefore runs a plain migrate by default and only points you
at `REPAIR_CHECKSUMS=1` when migrate actually fails.

### Migration-authoring rule (avoid the whole problem)

**Never modify an already-applied migration in place to change its effect.** If
fresh installs need new baseline schema, update the baseline migration AND ship
a new, idempotent delta migration for existing installs — the `0007/0008 + 0023`
pattern. The checksum guard exists to enforce this; do not defeat it by reflex.

---

## 4. RLS makes context-less queries return 0 rows (not "empty DB")

The app role (`simplecrm_app`) is `NOSUPERUSER` and every workspace-scoped table
has `FORCE ROW LEVEL SECURITY` with `USING (app.can_access_workspace(...))`.
The app sets the workspace context per request via
`set_config('app.workspace_id', ...)`. Without that context, RLS hides
everything:

```sh
docker exec <proj>-postgres-1 psql -U simplecrm_app -d simplecrm \
  -c "SELECT count(*) FROM users;"        # -> 0, even on a full DB
```

**Do not read this as data loss.** To actually inspect row presence, bypass RLS:

```sh
# On-disk size + estimated rows (no creds, not RLS-filtered):
docker exec <proj>-postgres-1 psql -U simplecrm_app -d simplecrm -c \
 "SELECT relname, reltuples::bigint AS approx_rows,
         pg_size_pretty(pg_total_relation_size(oid)) AS on_disk
    FROM pg_class WHERE relname IN ('users','customers','email_messages')
      AND relkind='r' ORDER BY relname;"
```

A multi-MB `email_messages` table (or a multi-MB backup dump) is proof the data
is there. `reltuples = -1` means "no ANALYZE stats yet", not "zero rows".

---

## 5. Always back up before a schema change

`update.sh` does this in step 2. Manually:

```sh
docker compose -p <proj> -f docker/docker-compose.yml --profile backup run --rm backup
```

The dump lands in the `<proj>_backups` volume. Restore is orchestrated by
`docker/restore-compose.sh` (stops public services, restores, migrates,
restarts, health-waits). Data persists in named volumes (`<proj>_postgres_data`,
`<proj>_attachments`, …) — never `docker volume rm` unless you are intentionally
resetting an instance, and only after confirming which project owns the live
data (see §2 + §4).
