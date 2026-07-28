#!/bin/sh
set -eu

: "${DATABASE_URL:?DATABASE_URL is required}"

SCRIPT_DIR="$(CDPATH= cd "$(dirname "$0")" && pwd)"
. "$SCRIPT_DIR/backup-metadata.sh"

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

  # Schemastand und Schluessel-Kennung des Backups sichtbar machen. Ohne die
  # passende .env (SIMPLECRM_MASTER_KEY) laesst sich aus einem technisch
  # einwandfreien Dump kein einziges Secret entschluesseln — das soll man hier
  # sehen und nicht erst im Ernstfall.
  meta="$BACKUP_DIR/backup-$stamp.meta"
  if [ ! -f "$meta" ]; then
    echo "backup_metadata=missing"
    return
  fi
  echo "backup_metadata=ok"
  echo "backup_schema_migration=$(backup_metadata_value "$meta" 'schema_migration' || echo unknown)"
  echo "backup_secret_key_ids=$(backup_metadata_value "$meta" 'secret_key_ids' || echo unknown)"

  # Ein Backup, dessen Zaehlung gescheitert ist, sieht hier sonst tadellos aus:
  # Pruefsumme stimmt, Metadatei da. Erst ein echter Restore wuerde es
  # ablehnen — also im Ernstfall. Genau dafuer gibt es doctor.
  counts="$(backup_metadata_value "$meta" 'row_counts' || echo unknown)"
  if [ "$counts" = 'failed' ] || { [ "$counts" = 'unknown' ] && ! grep -q '^rows_' "$meta"; }; then
    echo "backup_row_counts=missing"
    fail_backup_check "latest backup has no row counts; a restore will refuse to report it as verified"
    return
  fi
  echo "backup_row_counts=ok"
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
