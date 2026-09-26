#!/bin/sh
# Where the disk space of a SimpleCRM server goes (`sh docker/simplecrm disk`).
# Read-only: it shows and suggests, it never deletes anything.
set -u

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
COMPOSE_FILE="${COMPOSE_FILE:-$SCRIPT_DIR/docker-compose.yml}"
COMPOSE_DIR="$(CDPATH= cd -- "$(dirname -- "${COMPOSE_FILE%%:*}")" && pwd)"
COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-$(basename "$COMPOSE_DIR")}"
UPDATE_MIN_FREE_GB="${UPDATE_MIN_FREE_GB:-6}"
DOCKER_BUILD_CACHE_KEEP_GB="${DOCKER_BUILD_CACHE_KEEP_GB:-2}"

compose() {
  _argc=$#
  _ifs=$IFS
  IFS=':'
  for _file in $COMPOSE_FILE; do set -- "$@" -f "$_file"; done
  IFS=$_ifs
  while [ "$_argc" -gt 0 ]; do set -- "$@" "$1"; shift; _argc=$((_argc - 1)); done
  docker compose -p "$COMPOSE_PROJECT_NAME" --project-directory "$COMPOSE_DIR" "$@"
}
. "$SCRIPT_DIR/update-lib.sh"

section() { printf '\n== %s ==\n' "$1"; }
hints=""
hint() { hints="$hints
- $1"; }

# "17.46GB" / "845.9MB" / "0B" -> GB as a number
to_gb() {
  printf '%s\n' "$1" | awk '{
    v = $0; unit = v; sub(/^[0-9.]+/, "", unit); sub(/[A-Za-z]+$/, "", v)
    f = 0
    if (unit == "B") f = 1 / 1073741824
    else if (unit == "kB" || unit == "KB") f = 1 / 1048576
    else if (unit == "MB") f = 1 / 1024
    else if (unit == "GB") f = 1
    else if (unit == "TB") f = 1024
    printf "%.2f", v * f
  }'
}

section "Speicherplatz"
docker_root="$(docker info --format '{{.DockerRootDir}}' 2>/dev/null || true)"
df -h / 2>/dev/null
if [ -n "$docker_root" ] && [ -d "$docker_root" ] && [ "$(df -P "$docker_root" 2>/dev/null | awk 'NR==2 {print $6}')" != "/" ]; then
  df -h "$docker_root" 2>/dev/null
fi
free_kb="$(docker_root_free_kb)"
case "$free_kb" in
  ''|*[!0-9]*) ;;
  *)
    if [ "$free_kb" -lt $((UPDATE_MIN_FREE_GB * 1024 * 1024)) ]; then
      hint "Nur $(awk -v k="$free_kb" 'BEGIN {printf "%.1f", k/1048576}') GB frei: Ein Update braucht ${UPDATE_MIN_FREE_GB} GB und räumt vorher den Build-Cache ab."
    fi
    ;;
esac

section "Docker (Images, Container, Volumes, Build-Cache)"
docker system df 2>/dev/null
build_cache="$(docker system df --format '{{.Type}}|{{.Size}}' 2>/dev/null | awk -F'|' '$1=="Build Cache" {print $2}')"
if [ -n "$build_cache" ]; then
  cache_gb="$(to_gb "$build_cache")"
  if awk -v c="$cache_gb" -v k="$DOCKER_BUILD_CACHE_KEEP_GB" 'BEGIN {exit !(c > k)}'; then
    hint "Build-Cache $build_cache (Budget ${DOCKER_BUILD_CACHE_KEEP_GB} GB): 'docker builder prune -af' gibt ihn frei; das nächste Update baut dann etwas länger."
  fi
fi

section "SimpleCRM-Versionen (Rollback)"
state="$(state_file)"
attempt="$(attempt_file)"
if [ -f "$state" ]; then
  echo "Aktuell:   $(state_get "$state" current_release) $(state_get "$state" current_api_image)"
  if [ -n "$(state_get "$state" previous_api_image)" ]; then
    echo "Vorherige: $(state_get "$state" previous_release) $(state_get "$state" previous_api_image)"
    echo "Rollback-Sicherung (geschützt): $(state_get "$state" rollback_backup)"
  else
    echo "Vorherige: keine (Rollback nicht möglich)"
  fi
else
  echo "Noch kein Update mit Versionsverwaltung (ab dem nächsten Update)."
fi
if [ -f "$attempt" ]; then
  echo "Nicht abgeschlossenes Update (Stufe $(state_get "$attempt" stage)): 'sh $SCRIPT_DIR/simplecrm rollback' kehrt zur Version davor zurück."
  hint "Ein Update ist nicht abgeschlossen: erneut ausführen oder 'simplecrm rollback'."
fi
for repo in $SIMPLECRM_APP_REPOS; do
  docker image ls --format '{{.Repository}}:{{.Tag}}  {{.Size}}  {{.CreatedSince}}' "$repo" 2>/dev/null
done

section "Volumes"
volumes="$(docker system df -v 2>/dev/null | sed -n '/VOLUME NAME/,/^$/p')"
printf '%s\n' "$volumes"
foreign="$(printf '%s\n' "$volumes" | awk -v p="${COMPOSE_PROJECT_NAME}_" 'NR>1 && NF>=3 && $2=="0" && index($1, p)!=1 {print $1 " (" $3 ")"}')"
if [ -n "$foreign" ]; then
  echo
  echo "Volumes anderer Compose-Projekte ohne Container (z. B. aus einer früheren Installation):"
  printf '%s\n' "$foreign" | sed 's/^/  /'
  hint "Volumes ohne Container gefunden (siehe oben). Erst prüfen, dann bei Bedarf mit 'docker volume rm <name>' entfernen. SimpleCRM löscht Volumes nie selbst."
fi

section "Datenbank"
psql_run() {
  compose exec -T postgres psql -U simplecrm_admin -d simplecrm -c "$1" 2>/dev/null
}
if psql_run "SELECT pg_size_pretty(pg_database_size('simplecrm')) AS datenbank;"; then
  psql_run "SELECT c.relname AS tabelle, pg_size_pretty(pg_total_relation_size(c.oid)) AS groesse FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r' ORDER BY pg_total_relation_size(c.oid) DESC LIMIT 8;"
  psql_run "SELECT count(*) AS mails, pg_size_pretty(coalesce(sum(pg_column_size(raw_rfc822_b64)), 0)) AS original_mails, pg_size_pretty(coalesce(sum(pg_column_size(body_text)), 0) + coalesce(sum(pg_column_size(body_html)), 0)) AS texte FROM email_messages;"
  psql_run "WITH a AS (SELECT size_bytes, row_number() OVER (PARTITION BY content_sha256 ORDER BY id) AS n FROM email_message_attachments) SELECT count(*) AS anhaenge, pg_size_pretty(coalesce(sum(size_bytes), 0)) AS gesamt, pg_size_pretty(coalesce(sum(size_bytes) FILTER (WHERE n > 1), 0)) AS davon_doppelt FROM a;"
else
  echo "Datenbank nicht erreichbar (läuft der postgres-Container?)."
fi

section "Logs"
for container in $(compose ps -q 2>/dev/null); do
  info="$(docker inspect --format '{{.Name}} {{.LogPath}}' "$container" 2>/dev/null || true)"
  name="${info%% *}"
  log_path="${info#* }"
  [ -n "$log_path" ] && [ "$log_path" != "$info" ] || continue
  size="$(du -h "$log_path" 2>/dev/null | cut -f1)"
  echo "Container-Log ${name#/}: ${size:-? (nur als root lesbar)}"
done
if command -v journalctl >/dev/null 2>&1; then
  journal="$(journalctl --disk-usage 2>/dev/null | sed -n 's/.* take up \([0-9.]*[KMGT]\{0,1\}\).*/\1/p')"
  if [ -n "$journal" ]; then
    echo "Systemjournal (journald): $journal"
    case "$journal" in
      *G|*T) hint "Das Systemjournal belegt $journal. Das gehört zu Ubuntu, nicht zu SimpleCRM: 'journalctl --vacuum-size=500M' und SystemMaxUse=500M in /etc/systemd/journald.conf.d/ begrenzen es." ;;
    esac
  fi
fi

section "Hinweise"
if [ -n "$hints" ]; then
  printf '%s\n' "$hints" | sed '1d'
else
  echo "- Keine Auffälligkeiten."
fi
