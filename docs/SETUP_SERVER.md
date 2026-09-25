# SimpleCRM Server Setup

This document describes the Docker-based server foundation in `docker/`.

## Prerequisites

- Linux host with Docker Engine and Docker Compose v2.
- A DNS name pointing to the host for TLS, or `localhost` for local smoke tests.
- Open ports 80 and 443 when using Caddy TLS.
- Node.js 24 LTS locally only if you want to generate secrets with the commands below.
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
- `MASTER_KEY`: Base64 value that decodes to exactly 32 bytes. **Generate it, do not
  invent it** — a base64-encoded passphrase decodes to 32 bytes just as well and is
  guessable. A key that looks like text or repeats itself is warned about, and refused
  outright while the database still holds no secrets: that is the last moment replacing
  it is free.
- `ACCESS_TOKEN_SECRET`: Base64 value that decodes to at least 32 bytes.
- `INITIAL_SETUP_TOKEN`: **required** before the first owner account can be created. Generate with `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`. Pass as `X-Initial-Setup-Token` header or in the setup UI.
- `TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY`: optional Cloudflare Turnstile pair for login CAPTCHA (enable separately in workspace security settings).
- `PUBLIC_DOMAIN`: domain for Caddy, for example `crm.example.com`.
- `PUBLIC_BASE_URL`: public URL, for example `https://crm.example.com`. It is also the origin
  for optional e-mail pixel/click URLs, so production tracking requires stable HTTPS and must
  remain reachable by recipients after the message was sent.
- `CORS_ALLOWED_ORIGINS`: optional comma-separated extra browser origins for server-client HTTP transport. `PUBLIC_BASE_URL` is allowed automatically. Only exact origins are accepted — there is no wildcard.

  **`null` is not an origin — avoid it.** It is what a browser sends when a document has no
  origin to name: sandboxed iframes, `file://` documents, some redirects. It identifies nobody,
  so *any* website can produce it by embedding a sandboxed iframe. Because the API answers
  allowed origins with `Access-Control-Allow-Credentials: true`, listing `null` lets foreign
  JavaScript make authenticated requests **and read the responses** — it is effectively a
  wildcard for credentialed access, not a narrow exception for one desktop client.

  Prefer giving the packaged client a real origin (a custom scheme or a loopback URL it serves
  itself) and listing that. If a client genuinely cannot do without `null`, treat it as a
  deliberate, documented risk: the server logs a `SECURITY:` warning at startup for as long as
  the value is set.

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

For any `PUBLIC_DOMAIN` other than `localhost`/`127.0.0.1`, Caddy sends
`Strict-Transport-Security: max-age=31536000` (HSTS, one year). After the first HTTPS visit a
browser refuses plain `http://` for that host, which closes the first-visit SSL-stripping gap.
Only point `PUBLIC_DOMAIN` at a host that will keep serving HTTPS. `includeSubDomains` and
`preload` are deliberately not set: they would also force HTTPS on your other subdomains or put
the domain on the browsers' preload list. Add them in `docker/Caddyfile` only if every subdomain
serves HTTPS. `localhost` is excluded because browsers apply HSTS to every port of a host, so a
local smoke test would otherwise lock other local `http://localhost` services.

## Optional Profiles

The standard stack intentionally starts only Caddy, API, migrations, and PostgreSQL. The optional services from the implementation plan are opt-in:

```sh
docker compose --profile monitor up -d monitor
docker compose --profile pgadmin up -d pgadmin
docker compose --profile geoip up -d geoip-updater
```

Profiles:

- `monitor`: Uptime Kuma on `http://127.0.0.1:3001`.
- `pgadmin`: pgAdmin on `http://127.0.0.1:5050` for setup/debug only. Never expose this publicly.
- `geoip`: updates local MaxMind GeoLite2 Country and ASN MMDB files once the MaxMind account ID
  and license key are set in the ignored `docker/.env.geoip` file. Create it with
  `cp .env.geoip.example .env.geoip`. The updater alone receives those credentials; the API
  reads the resulting volume only at `/var/lib/simplecrm/geoip`.

There is no `minio` profile any more: the `minio/minio` image is no longer published on Docker
Hub, so the profile could not be pulled. SimpleCRM keeps attachments in the `attachments` volume
and has no S3 backend. If you need S3-compatible object storage, for example as an off-host
target for copies of the `backups` volume or to try out a later attachment backend, use an
external S3-compatible service (managed, or an instance you run and patch outside this stack).
The API does not talk to it, so nothing in `docker/.env` changes. An installation that used the
old profile still has a `minio` container and a `minio_data` volume: Compose reports the
container as an orphan; remove it with `docker rm -f <project>-minio-1` and delete the volume
with `docker volume rm <project>_minio_data` once you have copied out what you still need.

The profile ports bind to `127.0.0.1` by default. Change the bind variables only behind a firewall or private VPN, and replace every `CHANGE_ME` profile password before starting the service.

GeoIP is optional. Without the profile or credentials, the normal stack starts with IP intelligence
disabled and mail delivery plus public evidence endpoints stay available. A missing, stale or invalid
MMDB has the same limited effect. GeoIP is an infrastructure approximation: proxies and caches from
Proton, Gmail or Apple can make it describe their service rather than a recipient. It must not be
used to infer a person's location or personal knowledge of an email, and SimpleCRM does not attempt
to evade tracking protection, image caching or blocking.

## Web App And First Owner

The `caddy` service builds and serves the browser app (single-page app) at
`PUBLIC_BASE_URL` and reverse-proxies the API, public `/t/*` e-mail evidence endpoints,
health probes, OpenAPI and the
WebSocket event stream to the `api` service. Open `PUBLIC_BASE_URL` in a browser;
because the bundle is served by the server itself, it talks to the same origin
automatically (no `?serverUrl=` query and no extra `CORS_ALLOWED_ORIGINS` entry
needed for the served app). The served app ignores a `?serverUrl=` pointing to another
origin and drops a foreign server URL an older build stored in the browser; the login page
offers "Server-Verbindung zurücksetzen" to clear the stored connection.

Caddy deliberately excludes `/t/*` from access logs because those paths contain opaque
bearer-like tracking tokens. It also redacts the other bearer-like secrets before a line is
written: the access token the event stream sends as WebSocket subprotocol
(`Sec-WebSocket-Protocol`, request and response) and invitation tokens in
`/api/v1/auth/invitations/<token>` and `/login?invite=<token>`; the API redacts invitation
tokens in its own request log as well. Keep these rules when replacing the bundled proxy. Configure
`TRUST_PROXY` only for known proxy addresses (the bundled stack uses `uniquelocal`, the private
compose network Caddy runs on; hop counts such as `1` are not supported since fastify 5.12);
IP-based classification and abuse limits use the resolved client IP. After setup, e-mail tracking remains disabled until an owner/admin records
the legal basis, HTTPS privacy notice and retention choices under the e-mail settings. See
[EMAIL_EVIDENCE_TRACKING.md](EMAIL_EVIDENCE_TRACKING.md).

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

The legacy Compose doctor is a PostgreSQL-shell check for backups and database state. It does not
run the Node GeoIP check:

```sh
cd docker
docker compose --profile doctor run --rm doctor
```

For the Node doctor, including `geoip_intelligence`, run the already-built CLI in the API image:

```sh
cd docker
docker compose exec api node packages/server/dist/cli/doctor.js --no-color
```

The API container already has `DATABASE_URL`; it does not mount the backup volume, so omit
`--backup-dir` there. The same holds for the admin diagnosis in the app: it deliberately reports the
backup check as a warning, because the API is not meant to read dumps (see
[BACKUP_AND_RESTORE.md](BACKUP_AND_RESTORE.md#check-backups)). For a host installation after building packages, use:

```sh
pnpm run build:packages
$env:DATABASE_URL='postgres://simplecrm_app:password@localhost:5432/simplecrm'
pnpm run doctor:server -- --backup-dir C:\path\to\backups
```

The Doctor includes `geoip_intelligence` as `ready`, `missing`, `stale` or `invalid`. It reports
only database state and build timestamps, never MaxMind credentials or raw event IP addresses.

## Upgrade / Restart

### One command (recommended)

From the repository root:

```sh
sh docker/update.sh
```

This does the whole safe sequence in order and stops on the first failure:
pull `origin/main` → back up the database → rebuild images → apply pending
migrations → stop all old API/Graphile workers → restart `api` + `caddy` →
verify. Useful flags / env:

```sh
BRANCH=some-branch sh docker/update.sh   # update to a specific branch
SKIP_PULL=1   sh docker/update.sh        # use the current checkout, don't git pull
SKIP_BACKUP=1 sh docker/update.sh        # skip the pre-update backup (not recommended)
FORCE_RESET=1 sh docker/update.sh        # discard local changes to tracked files
REPAIR_CHECKSUMS=1 sh docker/update.sh   # opt into the checksum repair (see below)
```

The scale-to-zero step is required when moving from Graphile Worker 0.16 to
0.17 because that release changes worker lock ownership in its database schema.
For deployments managed outside this Compose project, stop every old API/worker
replica after the backup and before starting the first new replica. Do not run
0.16 and 0.17 workers against the same database concurrently.

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
docker compose stop api
# one-time after the switch to the non-root API image, see below; a no-op later
docker compose run --rm --no-deps --user root --cap-add CHOWN --cap-add DAC_OVERRIDE --cap-add FOWNER \
  --entrypoint sh api -c 'find /app/data/attachments /app/data/audit-archive /app/data/logs \( ! -user node -o ! -group node \) -exec chown -h node:node {} +'
docker compose up -d
```

### Non-root API container

The `api` image (also used by `migrate`) runs as the unprivileged `node` user (uid 1000) of the
Node base image, with `no-new-privileges` and all Linux capabilities dropped. Its writable volumes
(`attachments`, `audit_archives`, `server_logs`) must therefore belong to uid 1000. Fresh volumes
get that owner from the image. Volumes of an existing installation were written by the earlier
root-run image: `docker/update.sh` hands them over right after stopping the old API (only entries
with another owner are changed, so later runs are a cheap no-op), and `restore-compose.sh` does the
same after unpacking a backup, because the restore service extracts archives as root. If you update
with the manual steps above, run the `chown` step once before starting the new API — otherwise the
API cannot write attachments or its log file.

The SMTP relay (`docker-compose.relay.yml`) now reads its TLS key as uid 1000 too: make
`relay-tls/key.pem` readable for that user (for example `chown 1000 relay-tls/key.pem`), otherwise
the API logs `[smtp-relay] TLS key/cert could not be read` and does not start the relay. Binding
587/465 without capabilities relies on `net.ipv4.ip_unprivileged_port_start=0`, which the relay
override sets.

Image tags: the stack follows fixed release lines instead of `latest` — `postgres:18-alpine`,
`caddy:2` and `node:24`/`node:24-alpine` (image builds), `louislam/uptime-kuma:1` (`monitor`) and
`dpage/pgadmin4:9` (`pgadmin`); `geoip-updater` is pinned by digest.

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
