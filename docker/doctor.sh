#!/bin/sh
set -eu

: "${DATABASE_URL:?DATABASE_URL is required}"

BACKUP_DIR="${BACKUP_DIR:-/backups}"
DOCTOR_REQUIRE_BACKUP="${DOCTOR_REQUIRE_BACKUP:-false}"

fail_backup_check() {
  message="$1"
  if [ "$DOCTOR_REQUIRE_BACKUP" = "true" ]; then
    echo "$message" >&2
    exit 1
  fi
  echo "backup_warning=$message" >&2
}

check_latest_backup() {
  if [ ! -d "$BACKUP_DIR" ]; then
    fail_backup_check "backup directory not found: $BACKUP_DIR"
    echo "latest_backup=none"
    return
  fi

  latest_dump="$(ls -1t "$BACKUP_DIR"/db-*.dump 2>/dev/null | head -n 1 || true)"
  if [ -z "$latest_dump" ]; then
    fail_backup_check "no db-*.dump backup found in $BACKUP_DIR"
    echo "latest_backup=none"
    return
  fi

  dump_file="$(basename "$latest_dump")"
  stamp="${dump_file#db-}"
  stamp="${stamp%.dump}"
  manifest="backup-$stamp.sha256"

  if [ ! -f "$BACKUP_DIR/$manifest" ]; then
    fail_backup_check "checksum manifest not found for $dump_file"
    echo "latest_backup=$dump_file"
    echo "backup_checksum=missing"
    return
  fi

  (
    cd "$BACKUP_DIR"
    sha256sum -c "$manifest" >/dev/null
  ) || {
    echo "backup checksum verification failed for $manifest" >&2
    exit 1
  }

  echo "latest_backup=$dump_file"
  echo "backup_checksum=ok"
}

pg_isready -d "$DATABASE_URL"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -Atc "select 'database=' || current_database()"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -Atc "select 'db_size=' || pg_size_pretty(pg_database_size(current_database()))"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -Atc "select 'applied_migrations=' || count(*) from simplecrm_schema_migrations"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -Atc "select 'latest_migration=' || coalesce(max(id), 'none') from simplecrm_schema_migrations"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -Atc "select 'ready_jobs=' || count(*) from job_queue where locked_at is null and run_after <= now()"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -Atc "select 'queue_lag_seconds=' || coalesce(extract(epoch from max(now() - run_after))::integer, 0) from job_queue where locked_at is null and run_after <= now()"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -Atc "select 'stale_locks=' || count(*) from conversation_locks where last_heartbeat_at < now() - interval '2 minutes'"
check_latest_backup
