# SimpleCRM Server Setup

This document describes the Docker-based server foundation in `docker/`.

## Prerequisites

- Linux host with Docker Engine and Docker Compose v2.
- A DNS name pointing to the host for TLS, or `localhost` for local smoke tests.
- Open ports 80 and 443 when using Caddy TLS.
- Node.js 22 locally only if you want to generate secrets with the commands below.

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
- `PUBLIC_DOMAIN`: domain for Caddy, for example `crm.example.com`.
- `PUBLIC_BASE_URL`: public URL, for example `https://crm.example.com`.
- `CORS_ALLOWED_ORIGINS`: optional comma-separated extra browser origins for server-client HTTP transport. `PUBLIC_BASE_URL` is allowed automatically. Add `null` only for trusted packaged desktop/file-origin clients that require it.

Invite SMTP variables are optional. If they are empty, invite creation can still return a manual link.

## Start The Stack

```sh
cd docker
docker compose up -d --build
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

## First Owner

Open `PUBLIC_BASE_URL` in the browser. The server login page calls:

- `GET /api/v1/auth/setup-state`
- `POST /api/v1/auth/initial-setup`

When setup is required, create the first server owner with email and password. Server-client desktop/browser clients can then connect to the same URL.

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

After pulling new code:

```sh
cd docker
docker compose build api migrate
docker compose up -d
docker compose run --rm migrate
```

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

## Known Limits

- `JOB_WORKER_ENABLED` defaults to `false`; production worker handler coverage is still being hardened.
- Full production workflow side-effect parity and concrete mail-sync adapter replacement remain open.
