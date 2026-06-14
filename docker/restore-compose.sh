#!/bin/sh
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
COMPOSE_FILE="${COMPOSE_FILE:-$SCRIPT_DIR/docker-compose.yml}"
# Default to the compose file's directory basename — the same value plain
# `docker compose -f docker/docker-compose.yml` and the simplecrm helper use —
# so a direct invocation restores the SAME stack the rest of the tooling targets.
COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-$(basename "$SCRIPT_DIR")}"
RESTORE_API_HEALTH_TIMEOUT_SECONDS="${RESTORE_API_HEALTH_TIMEOUT_SECONDS:-180}"

usage() {
  cat >&2 <<'USAGE'
usage: restore-compose.sh [/backups/db-STAMP.dump [/backups/attachments-STAMP.tar [/backups/audit-archive-STAMP.tar]]]

Paths are container paths inside the Compose backups volume. With no arguments, the restore
service restores the latest /backups/db-*.dump and auto-detects matching attachment and audit archives.
Optional env:
  RESTORE_CADDY_HEALTH_URL=https://crm.example.com/health
  RESTORE_CADDY_INSECURE=true
  COMPOSE_PROJECT_NAME   Compose project (default: this file's directory name)
  COMPOSE_FILE=/path/to/docker-compose.yml
USAGE
}

if [ "${1:-}" = "--help" ]; then
  usage
  exit 0
fi

if [ "$#" -gt 3 ]; then
  usage
  exit 2
fi

if [ -n "${1:-}" ]; then
  export RESTORE_DUMP_PATH="$1"
fi
if [ -n "${2:-}" ]; then
  export RESTORE_ATTACHMENTS_PATH="$2"
fi
if [ -n "${3:-}" ]; then
  export RESTORE_AUDIT_ARCHIVE_PATH="$3"
fi

compose() {
  docker compose -p "$COMPOSE_PROJECT_NAME" -f "$COMPOSE_FILE" "$@"
}

wait_for_api_health() {
  deadline=$(( $(date +%s) + RESTORE_API_HEALTH_TIMEOUT_SECONDS ))
  while [ "$(date +%s)" -le "$deadline" ]; do
    api_container="$(compose ps -q api || true)"
    if [ -n "$api_container" ]; then
      health="$(docker inspect --format='{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$api_container" 2>/dev/null || true)"
      if [ "$health" = "healthy" ]; then
        return 0
      fi
    fi
    sleep 3
  done

  compose ps || true
  compose logs --no-color --tail=120 api migrate postgres caddy || true
  echo "api did not become healthy after restore" >&2
  return 1
}

wait_for_caddy_health() {
  if [ -z "${RESTORE_CADDY_HEALTH_URL:-}" ]; then
    return 0
  fi
  if ! command -v curl >/dev/null 2>&1; then
    echo "curl is required for RESTORE_CADDY_HEALTH_URL checks" >&2
    return 1
  fi

  deadline=$(( $(date +%s) + RESTORE_API_HEALTH_TIMEOUT_SECONDS ))
  while [ "$(date +%s)" -le "$deadline" ]; do
    if [ "${RESTORE_CADDY_INSECURE:-false}" = "true" ]; then
      body="$(curl --fail --silent --show-error --insecure "$RESTORE_CADDY_HEALTH_URL" 2>/dev/null || true)"
    else
      body="$(curl --fail --silent --show-error "$RESTORE_CADDY_HEALTH_URL" 2>/dev/null || true)"
    fi
    if printf '%s' "$body" | grep -q '"api":"simplecrm-server"'; then
      return 0
    fi
    sleep 3
  done

  compose ps || true
  compose logs --no-color --tail=120 caddy api || true
  echo "caddy health route did not become healthy after restore" >&2
  return 1
}

echo "stopping public services before restore"
compose stop caddy api || true

echo "ensuring postgres is healthy"
compose up -d postgres

echo "running restore service"
compose --profile restore run --rm restore

echo "running migrations after restore"
compose run --rm migrate

echo "starting api and caddy after restore"
compose up -d api caddy

wait_for_api_health
wait_for_caddy_health

echo "restore orchestration completed successfully"
