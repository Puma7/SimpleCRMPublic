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
#    (nicht den Schluessel) und erinnern beim Restore daran.
#
#    Die Kennung allein sagt dabei nichts: der Server vergibt sie ohne Argument,
#    sie lautet ueberall 'default'. Seit Migration 0049 steht deshalb zusaetzlich
#    ein FINGERABDRUCK des Schluessels in der Datenbank (scrypt ueber ein festes
#    Etikett plus einen zufaelligen Salt je Installation) und wandert mit dem
#    Dump. Er wird hier nur angezeigt — pruefen kann ihn nur, wer den
#    Schluessel hat, und das ist die
#    API: sie verweigert den Start, wenn ihr SIMPLECRM_MASTER_KEY nicht zu der
#    Datenbank passt, die sie gerade vorfindet.
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

# Welche Tabellen gezaehlt werden, steht NICHT hier, sondern kommt aus dem
# Katalog: jede Tabelle mit aktivierter Row Level Security. Genau die sind dem
# stillen Fehlerfall ausgesetzt, und genau die kommen laufend dazu — aktuell
# ueber neunzig. Eine handgepflegte Liste waere schon beim naechsten
# Schema-Zuwachs unvollstaendig, ohne dass es jemandem auffiele; ausgerechnet
# die Kerntabellen der CRM (customers, deals, products, returns) fehlten in der
# ersten Fassung dieser Datei.
#
# Kosten: ein count(*) je Tabelle. Das ist deutlich billiger als der pg_dump,
# der unmittelbar danach ohnehin jede Zeile liest.
BACKUP_METADATA_COUNT_SQL="
  SELECT 'rows_' || c.relname || '=' ||
         (xpath('/row/c/text()', query_to_xml(
            format('SELECT count(*) AS c FROM %I.%I', n.nspname, c.relname),
            false, true, '')))[1]::text
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE c.relkind = 'r'
    AND n.nspname = 'public'
    AND c.relrowsecurity
  ORDER BY c.relname"

# Die Fingerabdruecke der Datenbank — an ZWEI Stellen gebraucht (beim Schreiben
# der Metadaten und beim Nachtragen nach dem Dump), deshalb einmal hier. Zwei
# handgleiche Kopien waeren die Sorte Duplikat, die genau dann auseinanderlaeuft,
# wenn es darauf ankommt.
#
# query_to_xml und nicht die naheliegende Unterabfrage: ein CASE schuetzt nicht
# vor dem Planen. Steht die Tabelle direkt im SQL, scheitert die ganze Anweisung
# schon beim Aufloesen des Namens, wenn es sie nicht gibt — der 'n/a'-Zweig
# kaeme nie zum Zug, und die Datenbank ohne Migration 0049 waere von einer
# unerreichbaren Datenbank ('unknown') nicht mehr zu unterscheiden. Derselbe
# Grund wie bei den Zeilenzahlen weiter unten.
BACKUP_METADATA_MASTER_KEY_SQL="
  SELECT CASE WHEN to_regclass('public.master_key_fingerprints') IS NULL
    THEN 'n/a'
    ELSE coalesce((xpath('/row/c/text()', query_to_xml(
           'SELECT string_agg(key_id || '':'' || fingerprint, '','' ORDER BY key_id) AS c
              FROM public.master_key_fingerprints',
           false, true, '')))[1]::text, 'none')
  END"

backup_metadata_path() {
  # $1 = Backup-Verzeichnis, $2 = Zeitstempel
  printf '%s/backup-%s.meta' "$1" "$2"
}

# Waehrend das Backup laeuft, traegt die Metadatei einen anderen Namen.
#
# Gezaehlt wird VOR dem Dump (Begruendung in backup.sh), die Datei entsteht also
# zu einem Zeitpunkt, zu dem es db-<stamp>.dump noch nicht gibt. Genau daran
# erkennt die Aufraeumung eine verwaiste Datei: laeuft parallel ein zweites
# Backup und raeumt auf, loescht es diese Metadatei mitten im Entstehen. Das
# erste Backup schriebe danach eine Pruefsummenliste ohne sie — und der Restore
# haelte den Satz fuer ein altes Backup ohne Zaehlung und pruefte nichts.
#
# Der Suffix haelt sie aus beiden Suchmustern heraus (backup-*.meta trifft
# nicht). Umbenannt wird erst, wenn der Dump liegt.
backup_metadata_partial_path() {
  printf '%s.partial' "$(backup_metadata_path "$1" "$2")"
}

# Die fertige Metadatei sichtbar machen. mv ist innerhalb eines Verzeichnisses
# atomar: entweder sieht ein paralleler Lauf die vollstaendige Datei oder gar
# keine, nie eine halbe.
publish_backup_metadata() {
  partial_path="$(backup_metadata_partial_path "$1" "$2")"
  [ -f "$partial_path" ] || return 0
  mv "$partial_path" "$(backup_metadata_path "$1" "$2")"
}

# Den Fingerabdruck NACH dem Dump nachtragen.
#
# Die Zeilenzahlen entstehen absichtlich vor dem Dump (Begruendung in
# backup.sh), und bei ihnen ist das Fenster harmlos: verify_backup_metadata
# prueft ausdruecklich nicht auf Gleichheit. Beim Fingerabdruck ist es das
# nicht. Legt der erste Start nach einem Upgrade ihn genau zwischen Metadaten
# und pg_dump an, stuende 'none' in der Datei, waehrend der Dump die Zeile
# enthaelt — Restore und Doctor versprechen dann freie Schluesselwahl, und die
# wiederhergestellte API verweigert mit einer anderen .env den Start.
#
# Deshalb hier eine zweite Abfrage, wenn der Dump liegt. Ganz schliessen laesst
# sich das Fenster damit nicht (dafuer braeuchte es einen exportierten
# Snapshot fuer beide Seiten); es kippt nur in die harmlose Richtung: gemeldet
# wird eher ein Fingerabdruck zu viel als einer zu wenig.
refresh_backup_metadata_master_key() {
  database_url="$1"
  partial_path="$(backup_metadata_partial_path "$2" "$3")"
  [ -f "$partial_path" ] || return 0

  fingerprints="$(psql "$database_url" -v ON_ERROR_STOP=1 -Atc \
    "$BACKUP_METADATA_MASTER_KEY_SQL" 2>/dev/null || printf 'unknown')"

  # Bewusst NUR diese eine Zeile ersetzen und die Datei sonst unangetastet
  # lassen: die Zeilenzahlen sollen ihren Stand von VOR dem Dump behalten
  # (Begruendung in backup.sh), und jede weitere Aenderung hier waere eine
  # Fehlerquelle mehr. Die Pruefsumme entsteht ohnehin erst spaeter.
  #
  # Ueber eine Nebendatei und mv, nicht in place: bricht der Lauf mitten im
  # Schreiben ab, ist entweder die alte oder die neue Datei da, nie eine halbe.
  awk -v value="$fingerprints" '
    /^master_key_fingerprints=/ { print "master_key_fingerprints=" value; next }
    { print }
  ' "$partial_path" > "$partial_path.new" && mv "$partial_path.new" "$partial_path"
}

# Ist das ueberhaupt ein Tabellenname?
#
# Die Namen fuer die Restore-Pruefung kommen aus der .meta-Datei DES BACKUPS,
# und ein Backup ist kein vertrauenswuerdiger Eingang: die SHA-256-Liste liegt
# direkt daneben und wird beim Manipulieren einfach mitgeschrieben, sie belegt
# also Unversehrtheit gegen Bitfehler, nicht Herkunft. Ein praeparierter
# rows_-Eintrag darf deshalb nicht in SQL landen — restore.sh und
# restore-drill.sh laufen mit der Admin-Rolle und damit mit deutlich mehr
# Rechten als das pg_restore selbst, das bewusst als App-Rolle arbeitet.
backup_metadata_is_identifier() {
  case "$1" in
    '' | *[!abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_]*) return 1 ;;
    [0123456789]*) return 1 ;;
  esac
  [ "${#1}" -le 63 ]
}

# Eine Zahl aus der Datenbank holen, ohne bei fehlender Tabelle abzubrechen:
# aeltere Backups kennen nicht jede Tabelle, und ein fehlendes Detail darf ein
# Backup nicht verhindern.
#
# Der Name wird NICHT in den Befehlstext geschrieben. psql bekommt ihn als
# -v-Variable, `:'tbl'` macht daraus ein maskiertes String-Literal und
# `format('%I', ...)` serverseitig einen Bezeichner. Die Anweisung kommt ueber
# stdin (-f -), nicht ueber -c: mit -c reicht psql den Text unveraendert an den
# Server weiter und ersetzt gar keine Variablen.
BACKUP_METADATA_TABLE_COUNT_SQL="
  SELECT CASE WHEN to_regclass(format('public.%I', :'tbl')) IS NULL
    THEN 'n/a'
    ELSE (xpath('/row/c/text()', query_to_xml(
            format('SELECT count(*) AS c FROM public.%I', :'tbl'),
            false, true, '')))[1]::text
  END"

backup_metadata_count() {
  backup_metadata_is_identifier "$2" || { printf 'n/a'; return 0; }
  printf '%s' "$BACKUP_METADATA_TABLE_COUNT_SQL" \
    | psql "$1" -v ON_ERROR_STOP=1 -v tbl="$2" -At -f - 2>/dev/null \
    || printf 'n/a'
}

write_backup_metadata() {
  database_url="$1"
  backup_dir="$2"
  stamp="$3"
  meta_path="$(backup_metadata_partial_path "$backup_dir" "$stamp")"

  # Die Zaehlung zuerst und getrennt, damit ihr Scheitern sichtbar wird. Ein
  # `|| true` mitten in der Datei erzeugte sonst eine Metadatei GANZ OHNE
  # rows_-Eintraege: verify_backup_metadata liefe dann ueber null Tabellen und
  # meldete Erfolg — die Vollstaendigkeitspruefung waere lautlos verschwunden,
  # obwohl die Datei ordentlich in der Pruefsumme steht.
  #
  # Der Dump wird trotzdem gezogen: er ist das wertvolle Stueck, und ihn wegen
  # einer gescheiterten Zaehlung ausfallen zu lassen waere der teurere Fehler.
  # Stattdessen sagt die Metadatei selbst, dass sie unvollstaendig ist, und
  # jeder Restore verweigert daraufhin die Erfolgsmeldung.
  if counts="$(psql "$database_url" -v ON_ERROR_STOP=1 -Atc "$BACKUP_METADATA_COUNT_SQL" 2>&1)" \
    && [ -n "$counts" ]; then
    row_counts='ok'
  else
    row_counts='failed'
    counts=''
    echo "warning: could not record row counts for this backup; a restore will refuse to report it as verified" >&2
  fi

  {
    printf 'created_at=%s\n' "$stamp"
    printf 'schema_migration=%s\n' "$(psql "$database_url" -v ON_ERROR_STOP=1 -Atc \
      "SELECT coalesce(max(id), 'none') FROM simplecrm_schema_migrations" 2>/dev/null || printf 'unknown')"
    # NUR die Schluessel-KENNUNG, niemals der Schluessel. Sie steht als
    # Klartextspalte neben dem Chiffrat und verraet nichts ueber dessen Inhalt.
    printf 'secret_key_ids=%s\n' "$(psql "$database_url" -v ON_ERROR_STOP=1 -Atc "
      SELECT CASE WHEN to_regclass('public.secrets') IS NULL
        THEN 'n/a'
        ELSE coalesce((xpath('/row/c/text()', query_to_xml(
               'SELECT string_agg(DISTINCT key_id, '','' ORDER BY key_id) AS c FROM public.secrets',
               false, true, '')))[1]::text, 'none')
      END" 2>/dev/null || printf 'unknown')"
    # Der Fingerabdruck macht aus der Kennung eine Aussage. Er ist ein HMAC des
    # Master-Keys ueber ein festes Etikett — nicht geheim, aber eindeutig: zwei
    # verschiedene Schluessel ergeben zwei verschiedene Werte. Wer diesen Stand
    # wiederherstellt und die passende .env sucht, kann sie damit erkennen,
    # statt sie zu vermuten.
    # Er wird nach dem Dump noch einmal nachgetragen (refresh_backup_metadata_master_key):
    # legt der erste Start nach einem Upgrade die Zeile genau zwischen hier und
    # pg_dump an, stuende sonst 'none' in der Datei, waehrend der Dump sie hat.
    printf 'master_key_fingerprints=%s\n' "$(psql "$database_url" -v ON_ERROR_STOP=1 -Atc \
      "$BACKUP_METADATA_MASTER_KEY_SQL" 2>/dev/null || printf 'unknown')"
    # Wie viele Zeilen ausserhalb von `secrets` haengen am Master-Key?
    #
    # Die blosse Zeilenzahl von email_tracking_events taugt dafuer nicht: die
    # meisten Ereignisse tragen gar keine versiegelten Rohmetadaten, und sie als
    # Schluesselmaterial zu zaehlen behauptete eine .env-Abhaengigkeit, die die
    # Startpruefung selbst nicht sieht — sie schaut ausdruecklich nur auf
    # Ereignisse mit gefuellten raw_metadata_-Spalten. Deshalb hier derselbe
    # Massstab wie dort — und aus demselben Grund gehoeren die
    # Resolver-Zeilen dazu: ihr token_hash haengt am Tracking-Schluessel, und
    # die Startpruefung rechnet ihn nach. Eine Installation, die nur Oeffnungen
    # zaehlt, hat gar nichts anderes.
    #
    # Die Zaehlungen laufen ueber query_to_xml und nicht als gewoehnliche
    # Unterabfragen: ein CASE schuetzt nicht vor dem Planen. Steht die Tabelle
    # direkt im SQL, scheitert die ganze Anweisung schon beim Aufloesen des
    # Namens, wenn es sie nicht gibt — der 'n/a'-Zweig kaeme nie zum Zug.
    # Derselbe Grund wie bei den Zeilenzahlen weiter oben.
    printf 'master_key_encrypted_rows=%s\n' "$(psql "$database_url" -v ON_ERROR_STOP=1 -Atc "
      SELECT CASE
        WHEN to_regclass('public.email_tracking_links') IS NULL
          OR to_regclass('public.email_tracking_events') IS NULL
          OR to_regclass('public.email_tracking_token_resolver') IS NULL
        THEN 'n/a'
        ELSE ((xpath('/row/c/text()', query_to_xml(
                 'SELECT count(*) AS c FROM public.email_tracking_links',
                 false, true, '')))[1]::text::bigint
            + (xpath('/row/c/text()', query_to_xml(
                 'SELECT count(*) AS c FROM public.email_tracking_events
                  WHERE raw_metadata_ciphertext IS NOT NULL',
                 false, true, '')))[1]::text::bigint
            + (xpath('/row/c/text()', query_to_xml(
                 'SELECT count(*) AS c FROM public.email_tracking_token_resolver',
                 false, true, '')))[1]::text::bigint)::text
      END" 2>/dev/null || printf 'unknown')"
    # Bewusst NICHT 'rows_...': die Pruefschleife liest jeden rows_-Eintrag als
    # Tabellennamen, ein Marker in dem Namensraum waere eine Tabelle namens
    # 'recorded' und die Pruefung suchte sie vergeblich.
    printf 'row_counts=%s\n' "$row_counts"
    # Bewusst ein if statt `[ -n ... ] && ...`: der letzte Befehl bestimmt den
    # Status der Klammergruppe. Bei leerer Zaehlung liefe die Kurzschluss-Form
    # auf Status 1 hinaus, write_backup_metadata schluege fehl und `set -e` in
    # backup.sh braeche VOR dem pg_dump ab — genau das Gegenteil des hier
    # beabsichtigten Verhaltens.
    if [ -n "$counts" ]; then
      printf '%s\n' "$counts"
    fi
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
      # Nicht feststellbar ist nicht dasselbe wie in Ordnung — und hier faellt
      # es besonders ins Gewicht: kann die Rolle die Zeilen nicht alle sehen,
      # ist nicht nur der Dump gefiltert, sondern auch die Zaehlung, die ihn
      # belegen soll. Beide laufen ueber dieselbe Verbindung. Die spaetere
      # Restore-Pruefung verglich dann gefiltert mit gefiltert und meldete
      # Erfolg. Genau das Vertrauen, das diese Pruefung herstellen soll, waere
      # damit unbegruendet — also lieber kein Backup als eines, dem man
      # faelschlich traut.
      echo "refusing to back up: could not determine whether the backup role bypasses row level security" >&2
      echo "hint: the backup role needs to read pg_roles; without that this backup cannot be shown to be complete" >&2
      return 1
      ;;
    *)
      echo "refusing to back up: the backup role does not bypass row level security, so pg_dump would silently produce a filtered dump" >&2
      return 1
      ;;
  esac
}

# Steht die Metadatei in der Pruefsummenliste?
#
# Fehlt sie DORT, stammt das Backup aus der Zeit davor und die Pruefung entfaellt
# zu Recht. Steht sie drin und die Datei fehlt trotzdem, ist der Satz
# unvollstaendig — dann darf nicht stillschweigend ungeprueft wiederhergestellt
# werden, nur weil die Datei abhandengekommen ist.
backup_metadata_is_listed() {
  manifest_path="$1"
  meta_name="$2"
  [ -f "$manifest_path" ] || return 1
  awk -v name="$meta_name" '($2 == name || $2 == "*" name) { found = 1 } END { exit !found }' "$manifest_path"
}

# Laesst sich diese Sicherung ueberhaupt pruefen?
#
# Diese Frage ist VOR dem Restore beantwortbar — sie steht in der Metadatei. Sie
# erst danach zu stellen war falsch herum: verify_backup_metadata laeuft nach
# `pg_restore --clean` und nach dem Auspacken der Archive, also wenn die
# Produktivdaten bereits ersetzt sind. Das Ergebnis war ein Abbruch mitten in
# restore-compose.sh — Datenbank ausgetauscht, Migrationen nicht gelaufen, API
# und Caddy aus. Der teuerste denkbare Zeitpunkt fuer die Erkenntnis, dass diese
# Sicherung nichts belegt.
#
# Rueckgabe 0 = pruefbar (auch fuer aeltere Backups ohne Metadatei: dort gibt es
# nichts zu pruefen und nie etwas zu pruefen gegeben).
backup_metadata_is_verifiable() {
  meta_path="$1"
  [ -f "$meta_path" ] || return 0

  # Kein Schluessel darf zweimal vorkommen.
  #
  # backup_metadata_value liefert JEDE passende Zeile. Zwei Eintraege fuer
  # dieselbe Tabelle ergeben damit einen Wert aus zwei Zeilen, der erst nach dem
  # Restore an der Zahlenpruefung scheitert — also wieder: Produktivdaten
  # ersetzt, Dienste gestoppt, dann der Abbruch. Und es trifft nicht nur die
  # Zeilenzahlen: eine zusaetzliche Zeile `row_counts=ok` neben `row_counts=failed`
  # wuerde den Marker verdecken, weil der Vergleich dann gegen "failed\nok"
  # laeuft und ungleich 'failed' ist. Eine echte Metadatei hat jeden Schluessel
  # genau einmal.
  if [ -n "$(sed -n 's/^\([^=]*\)=.*/\1/p' "$meta_path" | sort | uniq -d)" ]; then
    return 1
  fi

  recorded="$(backup_metadata_value "$meta_path" 'row_counts' || printf 'unknown')"
  [ "$recorded" != 'failed' ] || return 1
  grep -q '^rows_' "$meta_path" || return 1

  # Auch die Eintraege selbst pruefen, und zwar HIER.
  #
  # Ob ein Tabellenname ein Bezeichner und eine Zeilenzahl eine Zahl ist, steht
  # allein in der Datei — dafuer braucht es keine Datenbank und keinen Restore.
  # Diese Pruefungen erst nachher laufen zu lassen hiess: eine manipulierte
  # Sicherung ersetzt zuerst die Produktivdaten und faellt dann durch, mit
  # gestoppter API und gestopptem Caddy. Was sich vorher entscheiden laesst,
  # wird vorher entschieden.
  while IFS= read -r entry; do
    entry_table="${entry%%=*}"
    entry_table="${entry_table#rows_}"
    entry_value="${entry#*=}"
    backup_metadata_is_identifier "$entry_table" || return 1
    case "$entry_value" in
      '' | *[!0123456789]*) return 1 ;;
    esac
  done <<EOF
$(grep '^rows_' "$meta_path")
EOF
  return 0
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

  # Eine Metadatei ohne Zaehlung darf nicht als geprueft durchgehen. Sie
  # entsteht, wenn die Katalog-Abfrage beim Backup gescheitert ist (Sperren,
  # statement_timeout) — die Datei sieht dann vollstaendig aus, enthaelt aber
  # nichts zu pruefen. Aeltere Backups ohne den Marker gelten als in Ordnung,
  # solange sie Zeilen fuehren.
  recorded="$(backup_metadata_value "$meta_path" 'row_counts' || printf 'unknown')"
  if [ "$recorded" = 'failed' ] || ! grep -q '^rows_' "$meta_path"; then
    echo "$label: this backup carries no row counts, so completeness cannot be verified" >&2
    # Die Schluessel-Auskunft haengt nicht an der Zaehlung — und gerade hier
    # wird sie gebraucht: mit RESTORE_ALLOW_UNVERIFIABLE=1 laeuft der Restore
    # trotz dieses Rueckwegs weiter, und ohne diesen Aufruf erfuehre der
    # Betreiber von der noetigen .env erst beim Startabbruch der API.
    report_master_key_material "$meta_path" "$label"
    return 1
  fi

  # Ueber die Tabellen laufen, die IM BACKUP stehen — nicht ueber eine hier
  # gepflegte Liste. Damit prueft ein Restore genau das, was seine Sicherung
  # erfasst hat, auch wenn das Schema sich seither veraendert hat.
  empty=0
  for table in $(awk -F= '/^rows_/ { sub(/^rows_/, "", $1); print $1 }' "$meta_path"); do
    # Was kein Bezeichner ist, kann keine Tabelle aus einem echten Backup sein.
    # Nicht ueberspringen, sondern melden und die Pruefung durchfallen lassen:
    # eine Metadatei mit solchen Eintraegen wurde veraendert, und dann ist auch
    # der Rest ihrer Angaben nichts mehr wert.
    if ! backup_metadata_is_identifier "$table"; then
      echo "$label: metadata lists '$table', which is not a valid table name; this file has been altered" >&2
      empty=1
      continue
    fi
    # Die Zahl muss eine Zahl sein.
    #
    # Frueher wurde 'n/a' uebersprungen und alles andere Nichtnumerische fiel in
    # den blossen Hinweiszweig. Damit liess sich die ganze Pruefung aushebeln:
    # in einer manipulierten Metadatei jeden Wert durch Text ersetzen, die
    # Pruefsumme daneben neu berechnen — und verify_backup_metadata meldete
    # Erfolg, ohne eine einzige Tabelle geprueft zu haben. Ein Wert, der keine
    # Zahl ist, kommt aus keinem echten Backup.
    expected="$(backup_metadata_value "$meta_path" "rows_$table" || printf '')"
    case "$expected" in
      '' | *[!0123456789]*)
        echo "$label: metadata records '$expected' as the row count for $table, which is not a number; this file has been altered" >&2
        empty=1
        continue
        ;;
    esac
    actual="$(backup_metadata_count "$database_url" "$table")"
    [ "$actual" = "$expected" ] && continue
    if [ "$actual" = 'n/a' ]; then
      # Die Tabelle fehlt nach der Wiederherstellung, oder die Abfrage ist
      # gescheitert. Beides heisst: die Vollstaendigkeit wurde NICHT geprueft —
      # das als Erfolg zu melden waere die schlimmere Variante des Fehlers, den
      # diese Pruefung verhindern soll.
      echo "$label: cannot read $table after restore, but the backup recorded $expected rows" >&2
      empty=1
    elif [ "$expected" -gt 0 ] 2>/dev/null && [ "$actual" = '0' ]; then
      # Auffaellig, aber KEIN Abbruch. Wird die letzte Zeile einer Tabelle
      # zwischen Zaehlung und Dump-Snapshot geloescht, ist genau das hier das
      # rechtmaessige Ergebnis — ein einzelnes Postfach oder ein einzelnes
      # Secret reichen dafuer. Die eigentliche Ursache eines still gefilterten
      # Dumps faengt ohnehin assert_backup_role_reads_all_rows deterministisch
      # ab, und zwar bevor der Dump laeuft.
      echo "$label: WARNING — $table is empty after restore but the backup recorded $expected rows; check this before trusting the restore" >&2
    else
      echo "$label: note — $table has $actual rows, backup recorded $expected (writes between count and dump are expected)" >&2
    fi
  done

  report_master_key_material "$meta_path" "$label"

  [ "$empty" -eq 0 ]
}

# Was sagt dieses Backup ueber den Schluessel, den es zum Lesen braucht?
#
# Eigene Funktion, weil BEIDE Wege sie brauchen: restore.sh ueber
# verify_backup_metadata und doctor.sh direkt. Doctor ruft
# verify_backup_metadata nicht auf (er prueft nur, OB sich das Backup
# ueberhaupt verifizieren liesse) — haenge man diese Ausgabe dort hinein,
# bliebe doctor genau bei dem Backup stumm, dessen Restore spaeter am
# Schluessel scheitert.
# Haengt an diesem Backup ueberhaupt etwas am Master-Key? 'yes', 'no' oder
# 'unknown'.
#
# Gezaehlt wird master_key_encrypted_rows und NICHT die Zeilenzahl von
# email_tracking_events: die meisten Ereignisse tragen keine versiegelten
# Rohmetadaten, und sie mitzuzaehlen behauptete eine .env-Abhaengigkeit, die die
# Startpruefung gar nicht sieht — sie wuerde dort einen neuen Schluessel
# anstandslos eintragen. Eine Warnung, die der Wirklichkeit widerspricht, ist
# schlimmer als keine.
backup_metadata_encrypted_state() {
  if [ "$2" = 'unknown' ]; then
    # Die Secret-Abfrage ist beim Schreiben gescheitert. Dann ist ueber die
    # Secrets nichts bekannt, und ein Tracking-Zaehler von 0 sagt darueber
    # nichts aus — 'no' zu melden hiesse, aus einem fehlgeschlagenen Blick eine
    # Entwarnung zu machen.
    printf 'unknown'
    return 0
  fi
  if [ "$2" != 'none' ] && [ "$2" != 'n/a' ]; then
    # Secrets sind eindeutig; was der Zaehler sagt, aendert daran nichts.
    printf 'yes'
    return 0
  fi
  case "$(backup_metadata_value "$1" 'master_key_encrypted_rows' || printf 'unknown')" in
    '0' | 'n/a')
      # Nichts NACHPRUEFBARES. Aufbewahrte Tracking-Ereignisse sind damit aber
      # nicht vom Tisch: ihr dedupe_key kann ein HMAC ueber den
      # Tracking-Schluessel sein, und die Aufbewahrung laesst sie 365 Tage
      # stehen, waehrend Rohdaten nach 7 Tagen und abgelaufene Resolver
      # frueher verschwinden. Der Start behandelt genau diesen Zustand als
      # "nicht festlegbar" — hier heisst er deshalb 'unknown' und nicht 'no'.
      case "$(backup_metadata_value "$1" 'rows_email_tracking_events' || printf '0')" in
        '' | '0' | *[!0123456789]*) printf 'no' ;;
        *) printf 'retained' ;;
      esac
      ;;
    # Aeltere Backups fuehren den Zaehler nicht. Dann ist die Antwort "weiss
    # nicht" — und die wird auch so gesagt, statt eine der beiden Behauptungen
    # zu raten.
    '' | *[!0123456789]*) printf 'unknown' ;;
    *) printf 'yes' ;;
  esac
}

report_master_key_material() {
  meta_path="$1"
  label="${2:-restore}"

  key_ids="$(backup_metadata_value "$meta_path" 'secret_key_ids' || printf 'unknown')"
  # 'unknown' heisst: die Abfrage ist beim Schreiben gescheitert. Dann steht
  # hier keine Erinnerung, die so tut, als waeren Secrets da — der Zweig
  # darunter sagt stattdessen, dass es unbekannt ist.
  if [ "$key_ids" != 'none' ] && [ "$key_ids" != 'n/a' ] && [ "$key_ids" != 'unknown' ]; then
    # ERINNERUNG, KEINE PRUEFUNG — und das muss so dastehen, damit sich niemand
    # darauf verlaesst: der Server vergibt die Kennung ueber
    # parseBase64MasterKey ohne Argument, sie lautet also in jeder Installation
    # 'default'. Ein falscher Schluessel traegt damit dieselbe Kennung wie der
    # richtige; ob die .env passt, laesst sich hier nicht feststellen.
    echo "$label: reminder — the secrets in this dump are encrypted with SIMPLECRM_MASTER_KEY (recorded key id: $key_ids)." >&2
  fi

  # AUSSERHALB der key_ids-Bedingung: der Fingerabdruck gilt der Installation,
  # nicht den einzelnen Secrets. Wurden alle Secrets regulaer geloescht, steht
  # er trotzdem noch da und die API weist nach dem Restore weiterhin einen
  # abweichenden Master-Key ab. Haenge man diese Ausgabe an 'es gibt Secrets',
  # bliebe genau dieser zulaessige Zustand stumm — und der Betreiber erfuehre
  # erst beim Startabbruch, welche .env er braucht.
  fingerprints="$(backup_metadata_value "$meta_path" 'master_key_fingerprints' || printf 'unknown')"
  case "$fingerprints" in
    'unknown' | 'n/a' | '')
      # Keine Fingerabdruck-Tabelle. Das ist nicht nur "altes Backup": der
      # backup-scheduler haengt in docker-compose.yml an postgres und NICHT am
      # migrate-Dienst, sein Start-Backup kann also vor Migration 0049 laufen.
      # Auch dieser Stand braucht die urspruengliche .env, wenn etwas darin
      # verschluesselt ist — und das steht nicht nur in secret_key_ids.
      case "$(backup_metadata_encrypted_state "$meta_path" "$key_ids")" in
        'yes')
          echo "$label: this backup predates the master-key fingerprint, so a wrong .env cannot be detected here; it does contain data encrypted with the master key, so restore it from the same system." >&2
          ;;
        'retained')
          echo "$label: this backup predates the master-key fingerprint and holds no verifiable encrypted rows, but it does hold retained tracking events whose dedupe keys may be bound to the master key; restore it from the same system." >&2
          ;;
        'unknown')
          echo "$label: this backup predates the master-key fingerprint and does not record how much is encrypted with the master key; if this installation used secrets or e-mail tracking, restore it from the same system." >&2
          ;;
      esac
      ;;
    'none')
      # Tabelle vorhanden, aber leer — und das heisst zweierlei.
      #
      # Nicht nur `secrets` haengt am Master-Key: aus ihm leitet die API auch
      # die Tracking-Schluessel ab. Ein Backup ohne ein einziges Secret, aber
      # mit versiegelten Tracking-Daten braucht die urspruengliche .env genauso.
      #
      # Gezaehlt wird dafuer master_key_encrypted_rows und NICHT die Zeilenzahl
      # von email_tracking_events: die meisten Ereignisse tragen keine
      # versiegelten Rohmetadaten, und sie mitzuzaehlen behauptete eine
      # .env-Abhaengigkeit, die die Startpruefung gar nicht sieht — sie wuerde
      # dort einen neuen Schluessel anstandslos eintragen. Eine Warnung, die der
      # Wirklichkeit widerspricht, ist schlimmer als keine.
      encrypted="$(backup_metadata_encrypted_state "$meta_path" "$key_ids")"

      if [ "$encrypted" = 'retained' ]; then
        # Nichts Nachpruefbares, aber aufbewahrte Ereignisse: genau der Zustand,
        # in dem der Start weiterlaeuft, ohne einen Fingerabdruck zu
        # hinterlegen. Die Auskunft sagt dasselbe.
        echo "$label: no fingerprint travelled with this dump and nothing in it can be checked against a key, but it holds retained tracking events whose dedupe keys may be bound to the master key — the API will start without recording a fingerprint; with a different .env, re-delivered delivery evidence gets stored twice." >&2
      elif [ "$encrypted" = 'unknown' ]; then
        echo "$label: no fingerprint travelled with this dump, and it does not record how many rows are encrypted with the master key; if this installation used e-mail tracking, the original .env is still required." >&2
      elif [ "$encrypted" = 'yes' ]; then
        # Die Tabelle ist nur noch nicht zurueckgefuellt (Backup aus dem Zustand
        # direkt nach dem Upgrade auf 0049). Von freier Schluesselwahl kann
        # keine Rede sein — die API probiert den Schluessel beim Start an den
        # vorhandenen Daten und bricht bei der falschen .env ab. Genau das hier
        # zu behaupten waere die gefaehrlichste Auskunft von allen: sie klaenge
        # nach Entwarnung.
        echo "$label: no fingerprint travelled with this dump, but it contains data encrypted with the master key (secrets and/or e-mail tracking); the original .env is still required — the API trial-decrypts it at startup and refuses a key that cannot read it." >&2
      else
        echo "$label: no master key fingerprint travelled with this dump; the API will record the key it starts with." >&2
      fi
      ;;
    *)
      # Der Wert ist ein Pruefer, kein Geheimnis — aber auch nichts, was man
      # herumreicht: er ist mit Absicht teuer abzuleiten (scrypt), damit sich
      # geratene Schluessel nicht im Vorbeigehen daran testen lassen. Geprueft
      # wird er beim Start der API; dort liegt der Schluessel, hier nicht.
      echo "$label: master key fingerprint recorded with this dump: $fingerprints" >&2
      echo "$label: the API refuses to start if its SIMPLECRM_MASTER_KEY does not match this value." >&2
      ;;
  esac
}
