# shellcheck shell=sh
#
# Inkrementelle Anhangssicherung (von backup.sh, restore.sh, restore-drill.sh,
# doctor.sh und backup-retention.sh eingebunden; POSIX sh, BusyBox-tauglich).
#
# Statt jedes Mal den ganzen Anhang-Ordner als tar zu kopieren, liegt jeder
# Dateiinhalt genau einmal im Speicher des Backup-Volumes:
#
#   <backups>/attachments-store/<aa>/<sha256>
#
# Ein Sicherungssatz hat dazu eine Liste attachments-<stamp>.list mit einer
# Zeile je Datei:  sha256 <TAB> Groesse <TAB> mtime <TAB> ./relativer/pfad
#
# - Sichern liest nur neue oder geaenderte Dateien (gleicher Pfad, gleiche
#   Groesse, gleiche mtime wie in der letzten Liste: Pruefsumme uebernommen;
#   Anhang-Dateien werden nur einmal geschrieben) und kopiert nur Inhalte, die
#   noch nicht im Speicher sind. Gleicher Inhalt in mehreren Mails: ein Objekt.
# - Jeder Satz ist fuer sich vollstaendig: Liste + Speicher ergeben den ganzen
#   Anhang-Ordner zum Zeitpunkt der Sicherung.
# - Wiederherstellen prueft jedes Objekt gegen seine Pruefsumme und legt
#   gleiche Inhalte wieder als Hardlink an.
# - Die Aufbewahrung entfernt Objekte erst, wenn keine Liste sie mehr nennt
#   und sie aelter als ein Tag sind (ein laufender Lauf kann gerade welche
#   anlegen). Ohne jede Liste wird nichts entfernt.
#
# Alte Saetze mit attachments-<stamp>.tar bleiben lesbar (restore.sh).

attachment_store_dir() {
  printf '%s/attachments-store' "$1"
}

attachment_store_object() {
  printf '%s/%s/%s' "$1" "$(printf '%s' "$2" | cut -c1-2)" "$2"
}

attachment_tab() {
  printf '\t'
}

# Neueste veroeffentlichte Liste (fuer die Uebernahme von Pruefsummen) oder nichts.
latest_attachment_list() {
  ls -1t "$1"/attachments-*.list 2>/dev/null | head -n 1 || true
}

# write_attachment_list <anhang-ordner> <backup-ordner> <ausgabe-datei>
write_attachment_list() {
  _src="$1"
  _backup_dir="$2"
  _out="$3"
  _store="$(attachment_store_dir "$_backup_dir")"
  _tab="$(attachment_tab)"
  _nl="$(printf '\nx')"
  _nl="${_nl%x}"
  _work="$(mktemp -d)"

  # Zeilenweise Liste: ein Tab oder Zeilenumbruch im Namen wuerde sie brechen.
  # Die Anwendung entfernt Steuerzeichen aus Dateinamen; kommt trotzdem so ein
  # Name vor, bricht die Sicherung ab statt die Datei auszulassen.
  _odd="$(cd "$_src" && find . \( -name "*$_tab*" -o -name "*$_nl*" \) -print | head -n 1)"
  if [ -n "$_odd" ]; then
    echo "attachment backup: file name with tab or line break, cannot list it safely" >&2
    rm -rf "$_work"
    return 1
  fi

  (cd "$_src" && find . -type f ! -name '.dedup-*' ! -name '*.restore-partial.*' -exec stat -c "%s${_tab}%Y${_tab}%n" {} +) > "$_work/current"

  _previous="$(latest_attachment_list "$_backup_dir")"
  [ -n "$_previous" ] && [ -f "$_previous" ] || _previous=/dev/null
  : > "$_work/known"
  : > "$_work/unknown"
  # FILENAME statt NR == FNR: die vorige Liste kann leer sein (/dev/null).
  awk -F "$_tab" -v OFS="$_tab" -v previous="$_previous" -v known="$_work/known" -v unknown="$_work/unknown" '
    FILENAME == previous { if (NF == 4) { sha[$4] = $1; size[$4] = $2; mtime[$4] = $3 } next }
    ($3 in sha) && size[$3] == $1 && mtime[$3] == $2 { print sha[$3], $1, $2, $3 > known; next }
    { print $1, $2, $3 > unknown }
  ' "$_previous" "$_work/current"

  while IFS="$_tab" read -r _size _mtime _path; do
    _sha="$(sha256sum "$_src/$_path" | awk '{ print $1 }')"
    printf '%s\t%s\t%s\t%s\n' "$_sha" "$_size" "$_mtime" "$_path" >> "$_work/known"
  done < "$_work/unknown"

  while IFS="$_tab" read -r _sha _size _mtime _path; do
    _object="$(attachment_store_object "$_store" "$_sha")"
    [ -f "$_object" ] && continue
    mkdir -p "$(dirname "$_object")"
    _tmp="$_object.partial.$$"
    cp "$_src/$_path" "$_tmp"
    if [ "$(sha256sum "$_tmp" | awk '{ print $1 }')" != "$_sha" ]; then
      rm -f "$_tmp"
      rm -rf "$_work"
      echo "attachment backup: $_path changed while it was being saved" >&2
      return 1
    fi
    mv "$_tmp" "$_object"
  done < "$_work/known"

  LC_ALL=C sort -t "$_tab" -k4,4 "$_work/known" > "$_out"
  rm -rf "$_work"
}

# Format und Pfade einer Liste pruefen (kein absoluter Pfad, kein ..).
validate_attachment_list() {
  awk -F "$(attachment_tab)" '
    NF != 4 || length($1) != 64 || $1 ~ /[^0-9a-f]/ || $2 !~ /^[0-9]+$/ \
      || substr($4, 1, 2) != "./" || $4 ~ /(^|\/)\.\.(\/|$)/ || $4 ~ /\\/ {
      print "unsafe or malformed attachment list entry: " $0 > "/dev/stderr"
      bad = 1
    }
    END { exit bad }
  ' "$1"
}

# verify_attachment_list <liste> [deep]: alle Objekte vorhanden; mit deep auch
# jede Pruefsumme. Meldet fehlende Objekte und gibt dann 1 zurueck.
verify_attachment_list() {
  _list="$1"
  _store="$(attachment_store_dir "$(dirname "$_list")")"
  _tab="$(attachment_tab)"
  validate_attachment_list "$_list" || return 1
  _unique="$(mktemp)"
  # Jedes Objekt einmal pruefen, auch wenn mehrere Pfade denselben Inhalt haben.
  awk -F "$_tab" -v OFS="$_tab" '!seen[$1]++ { print $1, $4 }' "$_list" > "$_unique"
  _missing=0
  while IFS="$_tab" read -r _sha _path; do
    _object="$(attachment_store_object "$_store" "$_sha")"
    if [ ! -f "$_object" ]; then
      echo "attachment backup object missing: $_sha ($_path)" >&2
      _missing=$((_missing + 1))
    elif [ "${2:-}" = "deep" ] && [ "$(sha256sum "$_object" | awk '{ print $1 }')" != "$_sha" ]; then
      echo "attachment backup object damaged: $_sha ($_path)" >&2
      _missing=$((_missing + 1))
    fi
  done < "$_unique"
  rm -f "$_unique"
  [ "$_missing" -eq 0 ]
}

# restore_attachment_list <liste> <ziel-ordner>: stellt jede Datei der Liste
# her. Vorhandene Dateien mit gleichem Inhalt bleiben, gleiche Inhalte werden
# Hardlinks. Dateien, die nicht in der Liste stehen, bleiben unberuehrt.
restore_attachment_list() {
  _list="$1"
  _target="$2"
  _store="$(attachment_store_dir "$(dirname "$_list")")"
  _tab="$(attachment_tab)"
  _seen="$(mktemp -d)"
  mkdir -p "$_target"
  while IFS="$_tab" read -r _sha _size _mtime _path; do
    _dest="$_target/${_path#./}"
    if [ -f "$_dest" ] && [ "$(stat -c %s "$_dest")" = "$_size" ] \
      && [ "$(sha256sum "$_dest" | awk '{ print $1 }')" = "$_sha" ]; then
      [ -f "$_seen/$_sha" ] || printf '%s' "$_dest" > "$_seen/$_sha"
      continue
    fi
    mkdir -p "$(dirname "$_dest")"
    _tmp="$_dest.restore-partial.$$"
    rm -f "$_tmp"
    if [ -f "$_seen/$_sha" ] && ln "$(cat "$_seen/$_sha")" "$_tmp" 2>/dev/null; then
      :
    else
      cp "$(attachment_store_object "$_store" "$_sha")" "$_tmp"
      if [ "$(sha256sum "$_tmp" | awk '{ print $1 }')" != "$_sha" ]; then
        rm -f "$_tmp"
        rm -rf "$_seen"
        echo "attachment backup object damaged: $_sha ($_path)" >&2
        return 1
      fi
      printf '%s' "$_dest" > "$_seen/$_sha"
    fi
    mv -f "$_tmp" "$_dest"
  done < "$_list"
  rm -rf "$_seen"
}

# prune_attachment_store <backup-ordner>: Objekte, die keine Liste (auch keine
# gerade entstehende) mehr nennt und die aelter als ein Tag sind.
prune_attachment_store() {
  _store="$(attachment_store_dir "$1")"
  [ -d "$_store" ] || return 0
  # Ohne jede Liste nichts anfassen: dann stimmt eher etwas mit dem Ordner nicht.
  ls "$1"/attachments-*.list >/dev/null 2>&1 || return 0
  _referenced="$(mktemp)"
  _objects="$(mktemp)"
  for _list in "$1"/attachments-*.list "$1"/attachments-*.list.partial; do
    [ -f "$_list" ] && cut -f1 "$_list"
  done | LC_ALL=C sort -u > "$_referenced"
  find "$_store" -type f -mmin +1440 > "$_objects"
  awk -v referenced="$_referenced" 'FILENAME == referenced { ref[$1] = 1; next } { n = split($0, part, "/"); name = part[n]; if (name ~ /\.partial\./ || !(name in ref)) print }' \
    "$_referenced" "$_objects" | while IFS= read -r _object; do
    rm -f "$_object"
  done
  rm -f "$_referenced" "$_objects"
}
