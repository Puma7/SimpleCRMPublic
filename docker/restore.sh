#!/bin/sh
set -eu

: "${DATABASE_URL:?DATABASE_URL is required}"

SCRIPT_DIR="$(CDPATH= cd "$(dirname "$0")" && pwd)"
. "$SCRIPT_DIR/backup-metadata.sh"

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

validate_tar_archive() {
  archive_path="$1"
  archive_entries="$(tar -tf "$archive_path")"
  printf '%s\n' "$archive_entries" | awk '
    $0 == "" || $0 ~ /^\// || $0 ~ /(^|\/)\.\.($|\/)/ || $0 ~ /\\/ || $0 ~ /^[A-Za-z]:/ {
      print "unsafe tar entry: " $0 > "/dev/stderr";
      exit 1;
    }
  '
  archive_listing="$(tar -tvf "$archive_path")"
  printf '%s\n' "$archive_listing" | awk '{ if ($1 !~ /^[-d]/) { print "unsafe tar entry: " $0 > "/dev/stderr"; exit 1 } }'
}

DUMP_DIR="$(dirname "$DUMP_PATH")"
DUMP_FILE="$(basename "$DUMP_PATH")"
CHECKSUM_MANIFEST=""
METADATA_PATH=""
case "$DUMP_FILE" in
  db-*.dump)
    STAMP="${DUMP_FILE#db-}"
    STAMP="${STAMP%.dump}"
    CHECKSUM_MANIFEST="$DUMP_DIR/backup-$STAMP.sha256"
    METADATA_PATH="$DUMP_DIR/backup-$STAMP.meta"
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
  if [ -n "$METADATA_PATH" ] && [ -f "$METADATA_PATH" ]; then
    verify_backup_file "$METADATA_PATH" "$CHECKSUM_MANIFEST"
  fi
  if [ -n "$METADATA_PATH" ] && [ ! -f "$METADATA_PATH" ] \
    && backup_metadata_is_listed "$CHECKSUM_MANIFEST" "$(basename "$METADATA_PATH")"; then
    echo "backup metadata is listed in the checksum manifest but missing: $METADATA_PATH" >&2
    exit 1
  fi
else
  echo "warning: checksum manifest not found; restoring without backup hash verification" >&2
fi

if [ -n "$ATTACHMENTS_ARCHIVE" ]; then
  validate_tar_archive "$ATTACHMENTS_ARCHIVE"
fi

if [ -n "$AUDIT_ARCHIVE" ]; then
  validate_tar_archive "$AUDIT_ARCHIVE"
fi

if [ -n "$PG_RESTORE_ROLE" ]; then
  pg_restore --role="$PG_RESTORE_ROLE" --clean --if-exists --no-owner --dbname "$DATABASE_URL" "$DUMP_PATH"
else
  pg_restore --clean --if-exists --no-owner --dbname "$DATABASE_URL" "$DUMP_PATH"
fi

if [ -n "$ATTACHMENTS_ARCHIVE" ]; then
  mkdir -p "$ATTACHMENTS_DIR"
  tar -C "$ATTACHMENTS_DIR" --no-same-owner --no-same-permissions -xf "$ATTACHMENTS_ARCHIVE"
fi

if [ -n "$AUDIT_ARCHIVE" ]; then
  mkdir -p "$AUDIT_ARCHIVE_DIR"
  tar -C "$AUDIT_ARCHIVE_DIR" --no-same-owner --no-same-permissions -xf "$AUDIT_ARCHIVE"
fi

# Ein durchgelaufenes pg_restore heisst nur "keine Fehler", nicht "vollstaendig".
# Gegen die im Backup festgehaltenen Zeilenzahlen pruefen und benennen, welcher
# Master-Key zu diesem Stand gehoert — ohne die passende .env bleiben alle
# Secrets unlesbar, obwohl die Wiederherstellung technisch sauber war.
if [ -n "$METADATA_PATH" ]; then
  verify_backup_metadata "$METADATA_PATH" "$DATABASE_URL" 'restore'
fi
