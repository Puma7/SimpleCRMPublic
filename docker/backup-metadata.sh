#!/bin/sh
# Begleitmetadaten eines Backups: schreiben (backup.sh) und pruefen
# (restore.sh, restore-drill.sh, doctor.sh).
#
# Warum ueberhaupt:
#
# 1. Ein Dump ist NICHT selbstgenuegsam. Alle Secrets (Postfach-Passwoerter,
#    OAuth-Token, KI-Schluessel) liegen mit SIMPLECRM_MASTER_KEY verschluesselt
#    in der Datenbank; der Schluessel selbst steht nur in der .env und ist
#    absichtlich nirgends im Backup. Wird ein Dump ohne dieselbe .env
#    eingespielt, ist die Datenbank vollstaendig — nur entschluesseln kann die
#    Secrets niemand mehr. Die Metadaten halten die verwendeten key_id fest
#    (nicht den Schluessel), damit dieser Fall VOR dem Ernstfall auffaellt.
#
# 2. `pg_restore` meldet Erfolg, sobald es durchgelaufen ist — nicht, ob die
#    Daten vollstaendig sind. Ein Dump, der wegen fehlender Leserechte halb
#    leer ist (Row Level Security ist auf praktisch jeder Tabelle erzwungen),
#    stellt sich genauso wieder her wie ein guter. Die mitgeschriebenen
#    Zeilenzahlen machen daraus eine Aussage.
#
#    Sie sind bewusst KEINE Gleichheitsprobe. Gezaehlt wird kurz vor dem Dump,
#    beides gegen eine laufende Datenbank — zwischen Zaehlung und Snapshot
#    koennen Zeilen dazukommen, und der Restore haette dann rechtmaessig mehr
#    als notiert. Eine Gleichheitsprobe wuerde unter Last staendig falschen
#    Alarm schlagen, und ein Alarm, den man gewohnheitsmaessig ignoriert, ist
#    schlimmer als keiner. Geprueft wird deshalb der Fall, der NICHT harmlos
#    entstehen kann: das Backup hat Zeilen gezaehlt, die Wiederherstellung hat
#    keine. Genau so sieht eine unter zu schwachen Rechten gezogene Sicherung
#    aus. Jede andere Abweichung wird benannt, aber nicht als Fehler gewertet.
#
# 3. Der Schemastand sagt, welcher Code zu diesem Dump gehoert. Beim
#    Zurueckrollen ist das die Information, die man sonst raten muesste.

BACKUP_METADATA_TABLES='workspaces users email_accounts email_messages secrets'

backup_metadata_path() {
  # $1 = Backup-Verzeichnis, $2 = Zeitstempel
  printf '%s/backup-%s.meta' "$1" "$2"
}

# Eine Zahl aus der Datenbank holen, ohne bei fehlender Tabelle abzubrechen:
# aeltere Backups kennen nicht jede Tabelle, und ein fehlendes Detail darf ein
# Backup nicht verhindern.
backup_metadata_count() {
  psql "$1" -v ON_ERROR_STOP=1 -Atc "
    SELECT CASE WHEN to_regclass('public.$2') IS NULL
      THEN 'n/a'
      ELSE (SELECT count(*)::text FROM $2)
    END" 2>/dev/null || printf 'n/a'
}

write_backup_metadata() {
  database_url="$1"
  backup_dir="$2"
  stamp="$3"
  meta_path="$(backup_metadata_path "$backup_dir" "$stamp")"

  {
    printf 'created_at=%s\n' "$stamp"
    printf 'schema_migration=%s\n' "$(psql "$database_url" -v ON_ERROR_STOP=1 -Atc \
      "SELECT coalesce(max(id), 'none') FROM simplecrm_schema_migrations" 2>/dev/null || printf 'unknown')"
    # NUR die Schluessel-KENNUNG, niemals der Schluessel. Sie steht als
    # Klartextspalte neben dem Chiffrat und verraet nichts ueber dessen Inhalt.
    printf 'secret_key_ids=%s\n' "$(psql "$database_url" -v ON_ERROR_STOP=1 -Atc "
      SELECT CASE WHEN to_regclass('public.secrets') IS NULL
        THEN 'n/a'
        ELSE coalesce((SELECT string_agg(DISTINCT key_id, ',' ORDER BY key_id) FROM secrets), 'none')
      END" 2>/dev/null || printf 'unknown')"
    for table in $BACKUP_METADATA_TABLES; do
      printf 'rows_%s=%s\n' "$table" "$(backup_metadata_count "$database_url" "$table")"
    done
  } > "$meta_path"
}

# Kann die Backup-Rolle ueberhaupt an alle Zeilen?
#
# Row Level Security ist auf praktisch jeder Tabelle ERZWUNGEN (FORCE). Eine
# Rolle, die sie weder per Superuser noch per BYPASSRLS umgeht, bekommt von
# pg_dump eine syntaktisch einwandfreie, inhaltlich gefilterte Sicherung — der
# gefaehrlichste Fehlerfall, weil nichts daran auffaellt. Anders als die
# Zeilenzahlen ist das hier deterministisch pruefbar, und zwar bevor der Dump
# ueberhaupt laeuft. Ein Abbruch ist richtig: keine Sicherung ist besser als
# eine, der man faelschlich vertraut.
assert_backup_role_reads_all_rows() {
  database_url="$1"
  bypass="$(psql "$database_url" -v ON_ERROR_STOP=1 -Atc \
    "SELECT (rolsuper OR rolbypassrls)::text FROM pg_roles WHERE rolname = current_user" 2>/dev/null || printf 'unknown')"
  case "$bypass" in
    true) return 0 ;;
    unknown)
      echo "warning: could not determine whether the backup role bypasses row level security" >&2
      return 0
      ;;
    *)
      echo "refusing to back up: the backup role does not bypass row level security, so pg_dump would silently produce a filtered dump" >&2
      return 1
      ;;
  esac
}

backup_metadata_value() {
  # $1 = Pfad zur .meta, $2 = Schluessel
  awk -F= -v key="$2" '$1 == key { sub(/^[^=]*=/, ""); print; found = 1 } END { if (!found) exit 1 }' "$1"
}

# Wiederhergestellte Datenbank gegen die Metadaten des Backups pruefen.
# Rueckgabe != 0, wenn eine Zeilenzahl abweicht — ein durchgelaufenes
# pg_restore allein ist kein Beweis fuer Vollstaendigkeit.
verify_backup_metadata() {
  meta_path="$1"
  database_url="$2"
  label="${3:-restore}"

  if [ ! -f "$meta_path" ]; then
    echo "warning: no backup metadata next to this dump; skipping completeness check" >&2
    return 0
  fi

  empty=0
  for table in $BACKUP_METADATA_TABLES; do
    expected="$(backup_metadata_value "$meta_path" "rows_$table" || printf 'n/a')"
    [ "$expected" = 'n/a' ] && continue
    actual="$(backup_metadata_count "$database_url" "$table")"
    [ "$actual" = "$expected" ] && continue
    if [ "$expected" -gt 0 ] 2>/dev/null && [ "$actual" = '0' ]; then
      # Der eine Fall, der nicht harmlos entstehen kann.
      echo "$label: $table is EMPTY after restore but the backup recorded $expected rows" >&2
      empty=1
    else
      echo "$label: note — $table has $actual rows, backup recorded $expected (writes between count and dump are expected)" >&2
    fi
  done

  key_ids="$(backup_metadata_value "$meta_path" 'secret_key_ids' || printf 'unknown')"
  if [ "$key_ids" != 'none' ] && [ "$key_ids" != 'n/a' ]; then
    # Kein Abbruch: der Schluessel laesst sich hier nicht pruefen, nur benennen.
    # Ohne die passende .env bleiben die Secrets unlesbar, obwohl die
    # Wiederherstellung technisch fehlerfrei war.
    echo "$label: this dump needs SIMPLECRM_MASTER_KEY with key id(s) $key_ids — restore the matching .env as well" >&2
  fi

  [ "$empty" -eq 0 ]
}
