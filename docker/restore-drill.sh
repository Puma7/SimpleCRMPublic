#!/bin/sh
set -eu

: "${DATABASE_URL:?DATABASE_URL is required}"

DUMP_PATH="${1:-}"
ATTACHMENTS_ARCHIVE="${2:-}"
AUDIT_ARCHIVE="${3:-}"
PG_APP_USER="${PG_APP_USER:-simplecrm_app}"
PG_RESTORE_ROLE="${PG_RESTORE_ROLE:-$PG_APP_USER}"

if [ -z "$DUMP_PATH" ]; then
  echo "usage: restore-drill.sh /path/to/db.dump [/path/to/attachments.tar] [/path/to/audit-archive.tar]" >&2
  exit 2
fi

verify_backup_file() {
  file_path="$1"
  manifest_path="$2"
  file_name="$(basename "$file_path")"
  expected_hash="$(awk -v name="$file_name" '($2 == name || $2 == "*" name) { print $1; found = 1 } END { if (!found) exit 1 }' "$manifest_path")" || {
    echo "checksum manifest does not include $file_name" >&2
    exit 1
  }
  actual_hash="$(sha256sum "$file_path" | awk '{ print $1 }')"
  if [ "$actual_hash" != "$expected_hash" ]; then
    echo "checksum mismatch for $file_name" >&2
    exit 1
  fi
}

derive_database_url() {
  source_url="$1"
  target_database="$2"
  url_without_query="${source_url%%\?*}"
  query=""
  if [ "$url_without_query" != "$source_url" ]; then
    query="?${source_url#*\?}"
  fi
  prefix="${url_without_query%/*}"
  if [ "$prefix" = "$url_without_query" ]; then
    echo "RESTORE_DRILL_DATABASE_URL is required when DATABASE_URL is not a slash-delimited PostgreSQL URL" >&2
    exit 2
  fi
  printf '%s/%s%s' "$prefix" "$target_database" "$query"
}

quote_ident_literal() {
  printf '%s' "$1" | sed "s/'/''/g"
}

DUMP_DIR="$(dirname "$DUMP_PATH")"
DUMP_FILE="$(basename "$DUMP_PATH")"
CHECKSUM_MANIFEST=""
case "$DUMP_FILE" in
  db-*.dump)
    STAMP="${DUMP_FILE#db-}"
    STAMP="${STAMP%.dump}"
    CHECKSUM_MANIFEST="$DUMP_DIR/backup-$STAMP.sha256"
    ;;
esac

if [ -n "$CHECKSUM_MANIFEST" ] && [ -f "$CHECKSUM_MANIFEST" ]; then
  verify_backup_file "$DUMP_PATH" "$CHECKSUM_MANIFEST"
  if [ -n "$ATTACHMENTS_ARCHIVE" ]; then
    verify_backup_file "$ATTACHMENTS_ARCHIVE" "$CHECKSUM_MANIFEST"
  fi
  if [ -n "$AUDIT_ARCHIVE" ]; then
    verify_backup_file "$AUDIT_ARCHIVE" "$CHECKSUM_MANIFEST"
  fi
else
  echo "warning: checksum manifest not found; restore drill continues without backup hash verification" >&2
fi

if [ -n "$ATTACHMENTS_ARCHIVE" ]; then
  tar -tf "$ATTACHMENTS_ARCHIVE" >/dev/null
fi
if [ -n "$AUDIT_ARCHIVE" ]; then
  tar -tf "$AUDIT_ARCHIVE" >/dev/null
fi

DRILL_DB_NAME="${RESTORE_DRILL_DB_NAME:-simplecrm_restore_drill_$(date -u +%Y%m%d%H%M%S)_$$}"
if ! printf '%s\n' "$DRILL_DB_NAME" | grep -Eq '^[A-Za-z_][A-Za-z0-9_]{0,62}$'; then
  echo "RESTORE_DRILL_DB_NAME must contain only letters, digits, and underscores, must not start with a digit, and must be at most 63 characters" >&2
  exit 2
fi
if ! printf '%s\n' "$PG_APP_USER" | grep -Eq '^[A-Za-z_][A-Za-z0-9_]{0,62}$'; then
  echo "PG_APP_USER must contain only letters, digits, and underscores, must not start with a digit, and must be at most 63 characters" >&2
  exit 2
fi

DRILL_DATABASE_URL="${RESTORE_DRILL_DATABASE_URL:-$(derive_database_url "$DATABASE_URL" "$DRILL_DB_NAME")}"
MAINTENANCE_DATABASE_URL="${RESTORE_DRILL_MAINTENANCE_DATABASE_URL:-$DATABASE_URL}"
DRILL_DB_SQL="$(quote_ident_literal "$DRILL_DB_NAME")"
PG_APP_USER_SQL="$(quote_ident_literal "$PG_APP_USER")"
CREATED_DRILL_DB="false"

cleanup() {
  if [ "$CREATED_DRILL_DB" = "true" ]; then
    psql "$MAINTENANCE_DATABASE_URL" -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS \"$DRILL_DB_SQL\" WITH (FORCE);" >/dev/null
  fi
}
trap cleanup EXIT INT TERM

psql "$MAINTENANCE_DATABASE_URL" -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS \"$DRILL_DB_SQL\" WITH (FORCE);" >/dev/null
psql "$MAINTENANCE_DATABASE_URL" -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"$DRILL_DB_SQL\" OWNER \"$PG_APP_USER_SQL\";" >/dev/null
CREATED_DRILL_DB="true"

if [ -n "$PG_RESTORE_ROLE" ]; then
  pg_restore --role="$PG_RESTORE_ROLE" --no-owner --dbname "$DRILL_DATABASE_URL" "$DUMP_PATH"
else
  pg_restore --no-owner --dbname "$DRILL_DATABASE_URL" "$DUMP_PATH"
fi
psql "$DRILL_DATABASE_URL" -v ON_ERROR_STOP=1 -c "SELECT count(*) FROM workspaces;" >/dev/null

echo "restore drill succeeded for $DUMP_FILE using temporary database $DRILL_DB_NAME"
