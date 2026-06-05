#!/bin/sh
set -eu

: "${DATABASE_URL:?DATABASE_URL is required}"

SCRIPT_DIR="$(CDPATH= cd "$(dirname "$0")" && pwd)"
. "$SCRIPT_DIR/backup-retention.sh"

BACKUP_DIR="${BACKUP_DIR:-/backups}"
ATTACHMENTS_DIR="${ATTACHMENTS_DIR:-/data/attachments}"
AUDIT_ARCHIVE_DIR="${AUDIT_ARCHIVE_DIR:-/data/audit-archive}"
STAMP="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
DB_DUMP="db-$STAMP.dump"
ATTACHMENTS_ARCHIVE="attachments-$STAMP.tar"
AUDIT_ARCHIVE="audit-archive-$STAMP.tar"
CHECKSUM_MANIFEST="backup-$STAMP.sha256"

mkdir -p "$BACKUP_DIR"

pg_dump -Fc "$DATABASE_URL" > "$BACKUP_DIR/$DB_DUMP"

if [ -d "$ATTACHMENTS_DIR" ]; then
  tar -C "$ATTACHMENTS_DIR" -cf "$BACKUP_DIR/$ATTACHMENTS_ARCHIVE" .
fi

if [ -d "$AUDIT_ARCHIVE_DIR" ]; then
  tar -C "$AUDIT_ARCHIVE_DIR" -cf "$BACKUP_DIR/$AUDIT_ARCHIVE" .
fi

(
  cd "$BACKUP_DIR"
  sha256sum "$DB_DUMP" > "$CHECKSUM_MANIFEST"
  if [ -f "$ATTACHMENTS_ARCHIVE" ]; then
    sha256sum "$ATTACHMENTS_ARCHIVE" >> "$CHECKSUM_MANIFEST"
  fi
  if [ -f "$AUDIT_ARCHIVE" ]; then
    sha256sum "$AUDIT_ARCHIVE" >> "$CHECKSUM_MANIFEST"
  fi
)

prune_backup_retention "$BACKUP_DIR"
