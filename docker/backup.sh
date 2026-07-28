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

# Vor allem anderen: darf diese Rolle alle Zeilen sehen? Sonst waere der Dump
# still gefiltert (Begruendung in backup-metadata.sh).
assert_backup_role_reads_all_rows "$DATABASE_URL"

# Zaehlen VOR dem Dump. pg_dump friert seinen Snapshot beim Start ein; wird
# danach gezaehlt, faengt die Zahl auch die Schreibvorgaenge waehrend der
# Dump-Laufzeit ein und ein vollstaendiger Restore erschiene spaeter zu klein.
# Das Fenster ist damit nicht geschlossen, nur auf die Dauer der Zaehlung
# verkleinert — deshalb prueft verify_backup_metadata bewusst nicht auf
# Gleichheit (Begruendung dort).
write_backup_metadata "$DATABASE_URL" "$BACKUP_DIR" "$STAMP"
# Bis der Dump liegt, heisst die Datei .partial und ist damit fuer die
# Aufraeumung eines parallel laufenden Backups unsichtbar (Begruendung in
# backup-metadata.sh). Bricht dieser Lauf vorher ab, bleibt kein Rest liegen.
trap 'rm -f "$BACKUP_DIR/$METADATA_FILE.partial"' EXIT INT TERM

pg_dump -Fc "$DATABASE_URL" > "$BACKUP_DIR/$DB_DUMP"

# Den Fingerabdruck aus dem fertigen Dump nachtragen. Er soll sagen, welcher
# Schluessel zu DIESEM Dump gehoert — das beantwortet keine Abfrage der
# laufenden Datenbank, weder vor noch nach dem Snapshot, wohl aber der Dump
# selbst (Begruendung in backup-metadata.sh).
refresh_backup_metadata_master_key "$BACKUP_DIR" "$STAMP"

publish_backup_metadata "$BACKUP_DIR" "$STAMP"
trap - EXIT INT TERM

if [ -d "$ATTACHMENTS_DIR" ]; then
  tar -C "$ATTACHMENTS_DIR" -cf "$BACKUP_DIR/$ATTACHMENTS_ARCHIVE" .
fi

if [ -d "$AUDIT_ARCHIVE_DIR" ]; then
  tar -C "$AUDIT_ARCHIVE_DIR" -cf "$BACKUP_DIR/$AUDIT_ARCHIVE" .
fi

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
