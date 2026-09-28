#!/bin/sh
set -eu

: "${DATABASE_URL:?DATABASE_URL is required}"

SCRIPT_DIR="$(CDPATH= cd "$(dirname "$0")" && pwd)"
. "$SCRIPT_DIR/backup-retention.sh"
. "$SCRIPT_DIR/backup-metadata.sh"
. "$SCRIPT_DIR/backup-attachments.sh"

BACKUP_DIR="${BACKUP_DIR:-/backups}"
ATTACHMENTS_DIR="${ATTACHMENTS_DIR:-/data/attachments}"
AUDIT_ARCHIVE_DIR="${AUDIT_ARCHIVE_DIR:-/data/audit-archive}"
STAMP="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
DB_DUMP="db-$STAMP.dump"
# Anhaenge inkrementell: Liste dieses Satzes, Inhalte im Speicher
# attachments-store (backup-attachments.sh).
ATTACHMENTS_LIST="attachments-$STAMP.list"
AUDIT_ARCHIVE="audit-archive-$STAMP.tar"
CHECKSUM_MANIFEST="backup-$STAMP.sha256"
METADATA_FILE="backup-$STAMP.meta"

mkdir -p "$BACKUP_DIR"

# Nur ein Lauf gleichzeitig: Scheduler, Update und `simplecrm backup` teilen das
# Backup-Volume. Die Aufraeumung eines Laufs darf keine Anhang-Objekte entfernen,
# die ein anderer gerade wiederverwendet. mkdir ist atomar, auch ueber
# Container hinweg; PIDs anderer Container sind hier nicht pruefbar, daher gilt
# eine Sperre nach BACKUP_LOCK_STALE_SECONDS als verwaist.
BACKUP_LOCK_DIR="$BACKUP_DIR/.backup.lock"
BACKUP_LOCK_WAIT_SECONDS="${BACKUP_LOCK_WAIT_SECONDS:-3600}"
BACKUP_LOCK_STALE_SECONDS="${BACKUP_LOCK_STALE_SECONDS:-43200}"

for _lock_setting in "BACKUP_LOCK_WAIT_SECONDS=$BACKUP_LOCK_WAIT_SECONDS" "BACKUP_LOCK_STALE_SECONDS=$BACKUP_LOCK_STALE_SECONDS"; do
  case "${_lock_setting#*=}" in
    ''|*[!0-9]*)
      echo "${_lock_setting%%=*} must be a non-negative integer" >&2
      exit 2
      ;;
  esac
done

backup_lock_owner() {
  cat "$BACKUP_LOCK_DIR/owner" 2>/dev/null || true
}

# Besitzerzeile „<host> <pid> <epoch>“. Ohne gueltige Zeile (Lauf zwischen mkdir
# und Schreiben der Zeile beendet) gilt die Sperre nach 60 s als verwaist.
backup_lock_is_stale() {
  # shellcheck disable=SC2046
  set -- $(backup_lock_owner)
  case "${3:-}" in
    ''|*[!0-9]*)
      _lock_mtime="$(stat -c %Y "$BACKUP_LOCK_DIR" 2>/dev/null || echo 0)"
      [ $(( $(date +%s) - _lock_mtime )) -gt 60 ]
      return
      ;;
  esac
  [ "$#" -eq 3 ] || return 0
  if [ "$1" = "$(uname -n)" ] && ! kill -0 "$2" 2>/dev/null; then
    return 0
  fi
  [ $(( $(date +%s) - $3 )) -gt "$BACKUP_LOCK_STALE_SECONDS" ]
}

acquire_backup_lock() {
  _waited=0
  until mkdir "$BACKUP_LOCK_DIR" 2>/dev/null; do
    if backup_lock_is_stale; then
      echo "backup: removing stale lock ($(backup_lock_owner))" >&2
      rm -rf "$BACKUP_LOCK_DIR"
      continue
    fi
    if [ "$_waited" -ge "$BACKUP_LOCK_WAIT_SECONDS" ]; then
      echo "backup: another backup is running ($(backup_lock_owner)); gave up after ${_waited}s" >&2
      exit 75
    fi
    sleep 5
    _waited=$((_waited + 5))
  done
  printf '%s %s %s\n' "$(uname -n)" "$$" "$(date +%s)" > "$BACKUP_LOCK_DIR/owner"
}

# Nur die eigene Sperre entfernen, nie die eines anderen Laufs.
release_backup_lock() {
  case "$(backup_lock_owner)" in
    "$(uname -n) $$ "*) rm -rf "$BACKUP_LOCK_DIR" ;;
  esac
}

trap release_backup_lock EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
acquire_backup_lock

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
#
# Dump und Archive ebenso: sie entstehen als .partial und bekommen ihren
# endgueltigen Namen erst, wenn alle fertig geschrieben sind. Die Umleitung
# direkt auf db-<stamp>.dump legte die Datei sofort an; ein abgebrochener
# pg_dump hinterliess dann einen abgeschnittenen Dump, den der Restore als
# neuesten waehlt und die Aufbewahrung als Tages-Backup zaehlt (und dafuer den
# intakten Satz desselben Tages loescht). Ein SIGKILL, etwa nach der
# Grace-Period von `docker compose stop`, laesst so nur .partial-Dateien zurueck,
# die kein Suchmuster trifft. Ein Satz gilt erst mit seiner Pruefsummenliste als
# fertig: scheitert der Lauf vorher, wird auch schon Umbenanntes entfernt.
#
# INT/TERM muessen den Lauf beenden. Ein Trap ohne exit faengt das Signal nur
# ab, und das Skript liefe danach weiter.
discard_unfinished_backup() {
  rm -f \
    "$BACKUP_DIR/$METADATA_FILE.partial" \
    "$BACKUP_DIR/$DB_DUMP.partial" \
    "$BACKUP_DIR/$ATTACHMENTS_LIST.partial" \
    "$BACKUP_DIR/$AUDIT_ARCHIVE.partial"
  remove_backup_set "$BACKUP_DIR" "$STAMP"
  release_backup_lock
}
trap discard_unfinished_backup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

pg_dump -Fc "$DATABASE_URL" > "$BACKUP_DIR/$DB_DUMP.partial"

if [ -d "$ATTACHMENTS_DIR" ]; then
  write_attachment_list "$ATTACHMENTS_DIR" "$BACKUP_DIR" "$BACKUP_DIR/$ATTACHMENTS_LIST.partial"
fi

if [ -d "$AUDIT_ARCHIVE_DIR" ]; then
  tar -C "$AUDIT_ARCHIVE_DIR" -cf "$BACKUP_DIR/$AUDIT_ARCHIVE.partial" .
fi

mv "$BACKUP_DIR/$DB_DUMP.partial" "$BACKUP_DIR/$DB_DUMP"

# Den Fingerabdruck aus dem fertigen Dump nachtragen. Er soll sagen, welcher
# Schluessel zu DIESEM Dump gehoert — das beantwortet keine Abfrage der
# laufenden Datenbank, weder vor noch nach dem Snapshot, wohl aber der Dump
# selbst (Begruendung in backup-metadata.sh).
refresh_backup_metadata_master_key "$BACKUP_DIR" "$STAMP"

publish_backup_metadata "$BACKUP_DIR" "$STAMP"

for archive in "$ATTACHMENTS_LIST" "$AUDIT_ARCHIVE"; do
  if [ -f "$BACKUP_DIR/$archive.partial" ]; then
    mv "$BACKUP_DIR/$archive.partial" "$BACKUP_DIR/$archive"
  fi
done

(
  cd "$BACKUP_DIR"
  sha256sum "$DB_DUMP" > "$CHECKSUM_MANIFEST"
  if [ -f "$METADATA_FILE" ]; then
    sha256sum "$METADATA_FILE" >> "$CHECKSUM_MANIFEST"
  fi
  if [ -f "$ATTACHMENTS_LIST" ]; then
    sha256sum "$ATTACHMENTS_LIST" >> "$CHECKSUM_MANIFEST"
  fi
  if [ -f "$AUDIT_ARCHIVE" ]; then
    sha256sum "$AUDIT_ARCHIVE" >> "$CHECKSUM_MANIFEST"
  fi
)
# Die Sperre gilt auch fuer die Aufraeumung (sie entfernt Anhang-Objekte).
trap release_backup_lock EXIT

prune_backup_retention "$BACKUP_DIR"
release_backup_lock
trap - EXIT INT TERM
