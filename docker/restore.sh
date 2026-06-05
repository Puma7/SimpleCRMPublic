#!/bin/sh
set -eu

: "${DATABASE_URL:?DATABASE_URL is required}"

DUMP_PATH="${1:-}"
ATTACHMENTS_ARCHIVE="${2:-}"
AUDIT_ARCHIVE="${3:-}"
ATTACHMENTS_DIR="${ATTACHMENTS_DIR:-/data/attachments}"
AUDIT_ARCHIVE_DIR="${AUDIT_ARCHIVE_DIR:-/data/audit-archive}"
PG_RESTORE_ROLE="${PG_RESTORE_ROLE:-}"

if [ -z "$DUMP_PATH" ]; then
  echo "usage: restore.sh /path/to/db.dump [/path/to/attachments.tar] [/path/to/audit-archive.tar]" >&2
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
  echo "warning: checksum manifest not found; restoring without backup hash verification" >&2
fi

if [ -n "$PG_RESTORE_ROLE" ]; then
  pg_restore --role="$PG_RESTORE_ROLE" --clean --if-exists --no-owner --dbname "$DATABASE_URL" "$DUMP_PATH"
else
  pg_restore --clean --if-exists --no-owner --dbname "$DATABASE_URL" "$DUMP_PATH"
fi

if [ -n "$ATTACHMENTS_ARCHIVE" ]; then
  mkdir -p "$ATTACHMENTS_DIR"
  tar -C "$ATTACHMENTS_DIR" -xf "$ATTACHMENTS_ARCHIVE"
fi

if [ -n "$AUDIT_ARCHIVE" ]; then
  mkdir -p "$AUDIT_ARCHIVE_DIR"
  tar -C "$AUDIT_ARCHIVE_DIR" -xf "$AUDIT_ARCHIVE"
fi
