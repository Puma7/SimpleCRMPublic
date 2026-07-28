#!/bin/sh
set -eu

: "${DATABASE_URL:?DATABASE_URL is required}"

SCRIPT_DIR="$(CDPATH= cd "$(dirname "$0")" && pwd)"
. "$SCRIPT_DIR/backup-retention.sh"
. "$SCRIPT_DIR/backup-metadata.sh"

BACKUP_DIR="${BACKUP_DIR:-/backups}"
ATTACHMENTS_DIR="${ATTACHMENTS_DIR:-/data/attachments}"
AUDIT_ARCHIVE_DIR="${AUDIT_ARCHIVE_DIR:-/data/audit-archive}"
STAMP="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
DB_DUMP="db-$STAMP.dump"
ATTACHMENTS_ARCHIVE="attachments-$STAMP.tar"
AUDIT_ARCHIVE="audit-archive-$STAMP.tar"
CHECKSUM_MANIFEST="backup-$STAMP.sha256"
METADATA_FILE="backup-$STAMP.meta"

mkdir -p "$BACKUP_DIR"

pg_dump -Fc "$DATABASE_URL" > "$BACKUP_DIR/$DB_DUMP"

if [ -d "$ATTACHMENTS_DIR" ]; then
  tar -C "$ATTACHMENTS_DIR" -cf "$BACKUP_DIR/$ATTACHMENTS_ARCHIVE" .
fi

if [ -d "$AUDIT_ARCHIVE_DIR" ]; then
  tar -C "$AUDIT_ARCHIVE_DIR" -cf "$BACKUP_DIR/$AUDIT_ARCHIVE" .
fi

# Begleitmetadaten: Schemastand, benoetigte Schluessel-Kennung und Zeilenzahlen.
# Sie gehen in dieselbe Pruefsumme wie der Dump — sonst waere die Aussage
# manipulierbar, gegen die spaeter verglichen wird.
write_backup_metadata "$DATABASE_URL" "$BACKUP_DIR" "$STAMP"

(
  cd "$BACKUP_DIR"
  sha256sum "$DB_DUMP" > "$CHECKSUM_MANIFEST"
  if [ -f "$METADATA_FILE" ]; then
    sha256sum "$METADATA_FILE" >> "$CHECKSUM_MANIFEST"
  fi
  if [ -f "$ATTACHMENTS_ARCHIVE" ]; then
    sha256sum "$ATTACHMENTS_ARCHIVE" >> "$CHECKSUM_MANIFEST"
  fi
  if [ -f "$AUDIT_ARCHIVE" ]; then
    sha256sum "$AUDIT_ARCHIVE" >> "$CHECKSUM_MANIFEST"
  fi
)

prune_backup_retention "$BACKUP_DIR"
