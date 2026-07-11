# SimpleCRM Server Setup

This document describes the Docker-based server foundation in `docker/`.

## Prerequisites

- Linux host with Docker Engine and Docker Compose v2.
- A DNS name pointing to the host for TLS, or `localhost` for local smoke tests.
- Open ports 80 and 443 when using Caddy TLS.
- Node.js 22 locally only if you want to generate secrets with the commands below.
- PostgreSQL needs the trusted extensions `pgcrypto` and `pg_trgm` (mail search). The bundled `docker/postgres-init/001-create-app-role.sh` creates both on fresh containers; migration `0026_mail_search_overhaul` also runs `CREATE EXTENSION IF NOT EXISTS pg_trgm` for existing databases (trusted on `postgres:18`, so the non-superuser app role may install it).

## Configure Environment

Copy the template and edit values:

```sh
cd docker
cp .env.example .env
```

Generate required Base64 secrets:

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Set these in `docker/.env`:

- `PG_ADMIN_PASSWORD`: strong PostgreSQL admin password used only by bootstrap and maintenance profiles.
- `PG_PASSWORD`: strong PostgreSQL password for the non-superuser `simplecrm_app` role used by API and migrations.
- `MASTER_KEY`: Base64 value that decodes to exactly 32 bytes.
- `ACCESS_TOKEN_SECRET`: Base64 value that decodes to at least 32 bytes.
- `INITIAL_SETUP_TOKEN`: **required** before the first owner account can be created. Generate with `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`. Pass as `X-Initial-Setup-Token` header or in the setup UI.
- `TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY`: optional Cloudflare Turnstile pair for login CAPTCHA (enable separately in workspace security settings).
- `PUBLIC_DOMAIN`: domain for Caddy, for example `crm.example.com`.
- `PUBLIC_BASE_URL`: public URL, for example `https://crm.example.com`.
- `CORS_ALLOWED_ORIGINS`: optional comma-separated extra browser origins for server-client HTTP transport. `PUBLIC_BASE_URL` is allowed automatically. Add `null` only for trusted packaged desktop/file-origin clients that require it.

Invite SMTP variables are optional. If they are empty, invite creation can still return a manual link. E-mail MFA codes also use the invite SMTP configuration when enabled.

See [LOGIN_SECURITY.md](LOGIN_SECURITY.md) for CAPTCHA, PIN keypad, and MFA operator guidance.

## Start The Stack

```sh
cd docker
docker compose up -d --build
```

Building the `caddy` web image runs `vite build`, which is memory-hungry (Monaco). On small hosts (for example a 4 GB VPS) add swap first so the build does not get OOM-killed:

```sh
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
```

Operator wrapper equivalent:

```sh
cd docker
sh ./simplecrm up
```

Standard services:

- `postgres`: PostgreSQL 18.
- `migrate`: one-shot migration runner.
- `api`: Fastify API on port 3000 inside the Compose network.
- `caddy`: public reverse proxy with gzip/zstd compression and JSON access logs in the `caddy_logs` volume.

Check health:

```sh
sh ./simplecrm ps
curl -fsS http://localhost/health
```

Recent logs:

```sh
sh ./simplecrm logs api caddy
```

For a real domain, use:

```sh
curl -fsS https://crm.example.com/health
```

## Optional Profiles

The standard stack intentionally starts only Caddy, API, migrations, and PostgreSQL. The optional services from the implementation plan are opt-in:

```sh
docker compose --profile minio up -d minio
docker compose --profile monitor up -d monitor
docker compose --profile pgadmin up -d pgadmin
```

Profiles:

- `minio`: S3-compatible storage drill for future attachment growth. Console defaults to `http://127.0.0.1:9001`.
- `monitor`: Uptime Kuma on `http://127.0.0.1:3001`.
- `pgadmin`: pgAdmin on `http://127.0.0.1:5050` for setup/debug only. Never expose this publicly.

The profile ports bind to `127.0.0.1` by default. Change the bind variables only behind a firewall or private VPN, and replace every `CHANGE_ME` profile password before starting the service.

## Web App And First Owner

The `caddy` service builds and serves the browser app (single-page app) at
`PUBLIC_BASE_URL` and reverse-proxies the API, health probes, OpenAPI and the
WebSocket event stream to the `api` service. Open `PUBLIC_BASE_URL` in a browser;
because the bundle is served by the server itself, it talks to the same origin
automatically (no `?serverUrl=` query and no extra `CORS_ALLOWED_ORIGINS` entry
needed for the served app).

On first start the app runs the initial setup flow, which calls:

- `GET /api/v1/auth/setup-state`
- `POST /api/v1/auth/initial-setup`

When setup is required, create the first server owner with email and password. Additional desktop or browser clients can then connect to the same URL.

You can also create the owner without a browser, directly against the API:

```sh
curl -fsS -X POST "$PUBLIC_BASE_URL/api/v1/auth/initial-setup" \
  -H 'Content-Type: application/json' \
  -H "X-Initial-Setup-Token: $INITIAL_SETUP_TOKEN" \
  -d '{"email":"owner@example.com","password":"change-me-min-12-chars","workspaceName":"Acme"}'
```

## Server Doctor

One-shot container doctor:

```sh
cd docker
docker compose --profile doctor run --rm doctor
```

Node CLI doctor after building packages:

```sh
npm run build:packages
$env:DATABASE_URL='postgres://simplecrm_app:password@localhost:5432/simplecrm'
npm run doctor:server -- --backup-dir C:\path\to\backups
```

## Upgrade / Restart

### One command (recommended)

From the repository root:

```sh
sh docker/update.sh
```

This does the whole safe sequence in order and stops on the first failure:
pull `origin/main` → back up the database → rebuild images → apply pending
migrations → restart `api` + `caddy` → verify. Useful flags / env:

```sh
BRANCH=some-branch sh docker/update.sh   # update to a specific branch
SKIP_PULL=1   sh docker/update.sh        # use the current checkout, don't git pull
SKIP_BACKUP=1 sh docker/update.sh        # skip the pre-update backup (not recommended)
FORCE_RESET=1 sh docker/update.sh        # discard local changes to tracked files
REPAIR_CHECKSUMS=1 sh docker/update.sh   # opt into the checksum repair (see below)
```

The operator wrapper exposes the same thing as `sh docker/simplecrm update`
(alias `upgrade`; accepts `--no-pull` / `--no-backup` / `--repair-checksums` /
`--branch <name>`).

The updater does NOT repair checksums by default — that would silently bless a
genuine migration drift. If migrate fails with "Checksum mismatch", review the
change and re-run once with `REPAIR_CHECKSUMS=1` (the error message points here).

If a stack from an older install still runs under the project name `simplecrm`,
the updater refuses to proceed (it would otherwise start a second, empty stack)
and tells you to re-run with `COMPOSE_PROJECT_NAME=simplecrm` to target it.

Both default the Compose project name to the compose file's directory
(`docker`) — the same value plain `docker compose -f docker/docker-compose.yml`
uses — so the helper and your manual compose commands always act on one stack.
Override with `COMPOSE_PROJECT_NAME` if your deployment uses a different name.

### Manual steps

If you prefer to drive it yourself (rebuild `caddy` too — it contains the web bundle):

```sh
cd docker
docker compose build api migrate caddy
docker compose run --rm migrate          # apply pending migrations first
docker compose up -d
```

### "Checksum mismatch for server migration ..."

This means an already-applied migration was re-defined upstream (its real
schema delta for existing databases is delivered idempotently by a later
migration). The migration runner blocks rather than silently diverge. Reconcile
the stored checksums, then migrate — `docker/update.sh` does this automatically,
or run it explicitly:

```sh
docker compose run --rm --entrypoint node migrate \
  packages/server/dist/cli/migrate.js --repair-checksums
```

This only re-stamps migrations that still exist in code; rows for unknown
migration ids are left untouched so genuine corruption stays visible.

Data lives in Docker volumes:

- `postgres_data`
- `attachments`
- `audit_archives`
- `caddy_logs`
- `backups`
- `minio_data` when the `minio` profile is used
- `uptime_kuma_data` when the `monitor` profile is used
- `pgadmin_data` when the `pgadmin` profile is used

Do not delete volumes unless you are intentionally resetting the instance.

## Troubleshooting

### Setup-state and login diagnostics

Check whether initial setup is still required:

```sh
set -a && source .env && set +a
curl -fsS "$PUBLIC_BASE_URL/api/v1/auth/setup-state"
```

- `needsInitialSetup: true` — open the browser app and complete Ersteinrichtung.
- `needsInitialSetup: false` — an owner already exists; use the login form with the same email and password from setup.

### PostgreSQL row-level security (RLS)

The API connects as `simplecrm_app`, which is subject to RLS. Direct SQL checks with that role can show **zero users** even when setup succeeded:

```sh
docker compose exec postgres psql -U simplecrm_app -d simplecrm -c "SELECT email FROM users;"
```

For operator diagnostics, use the admin role instead:

```sh
docker compose exec postgres psql -U simplecrm_admin -d simplecrm \
  -c "SELECT email, role, created_at FROM users;"
```

An empty result from `simplecrm_app` does **not** mean the database is empty.

### Login fails after setup

If setup completed but login returns invalid credentials:

1. Confirm the exact email stored in `users` (admin query above).
2. Use the same email (case-insensitive) and the password chosen during Ersteinrichtung.
3. Check API logs: `sh ./simplecrm logs api`
4. As a last resort, reset the password hash via admin SQL or recreate the instance only if you accept data loss.

## Known Limits

- `JOB_WORKER_ENABLED` defaults to `false`. For productive server deployments with mail sync and workflows (including **Weiterleiten / `email.forward_copy`**), set it to `true` in `docker/.env` and restart the API container.
- Workflow side-effects enqueue rows into PostgreSQL `job_queue`; the in-process worker polls that table in addition to Graphile Worker.
- Production worker handler coverage is still being hardened.
- Full production workflow side-effect parity and concrete mail-sync adapter replacement remain open.
