#!/bin/sh
echo "$*" >> "$DOCKER_LOG"
echo "VERSION=${VERSION-<unset>}" >> "$DOCKER_LOG.env"
store="$FAKE_STORE/images"
running="$FAKE_STORE/running"
touch "$store" "$running"
lookup() { awk -v r="$1" '$1 == r {id = $2} END {if (id != "") print id}' "$store"; }
setref() { awk -v r="$1" '$1 != r' "$store" > "$store.t"; echo "$1 $2" >> "$store.t"; mv "$store.t" "$store"; }
resolve() { case "$1" in sha256:*) echo "$1" ;; *) lookup "$1" ;; esac; }
last() { for a in "$@"; do l="$a"; done; echo "$l"; }
case "$*" in
  *"compose ls"*) printf 'NAME STATUS CONFIG\n'; for p in $FAKE_STACKS; do printf '%s running x\n' "$p"; done; exit 0 ;;
  *"config --images"*) printf 'simplecrm/web:%s\nsimplecrm/api:%s\npostgres:18-alpine\nsimplecrm/api:%s\n' "${VERSION:-dev}" "${VERSION:-dev}" "${VERSION:-dev}"; exit 0 ;;
  *"ps -q api"*) echo fakeapi; exit 0 ;;
  *"ps -q caddy"*) echo fakecaddy; exit 0 ;;
  *'db-*.dump'*) echo "${FAKE_BACKUP_DUMP-/backups/db-2026-09-26T15-00-00Z.dump}"; exit 0 ;;
  *'test -s'*) [ -z "${FAKE_MISSING_BACKUP:-}" ]; exit ;;
esac
if [ -n "${FAKE_FAIL_BUILD:-}" ]; then case "$*" in *" build"*) exit 1 ;; esac; fi
if [ -n "${FAKE_FAIL_MIGRATE:-}" ]; then
  case "$*" in *--check*|*--repair-checksums*) : ;; *migrate.js*) exit 1 ;; esac
fi
case "$*" in
  compose*" build")
    n=$(( $(cat "$FAKE_STORE/n" 2>/dev/null || echo 0) + 1 )); echo "$n" > "$FAKE_STORE/n"
    setref "simplecrm/api:${VERSION:-dev}" "sha256:api$n"; setref "simplecrm/web:${VERSION:-dev}" "sha256:web$n"; exit 0 ;;
  compose*"up -d api caddy")
    printf 'api %s\ncaddy %s\n' "$(lookup "simplecrm/api:${VERSION:-dev}")" "$(lookup "simplecrm/web:${VERSION:-dev}")" > "$running"; exit 0 ;;
esac
case "$1" in
  inspect)
    case "$*" in
      *'.Image}}'*) svc=api; [ "$(last "$@")" = fakecaddy ] && svc=caddy; awk -v s="$svc" '$1 == s {print $2}' "$running"; exit 0 ;;
      *) echo "${FAKE_API_HEALTH:-healthy}"; exit 0 ;;
    esac ;;
  image)
    case "$2" in
      inspect) id="$(resolve "$(last "$@")")"; [ -n "$id" ] || exit 1
        case "$*" in *RepoTags*) awk -v i="$id" '$2 == i {print $1}' "$store" ;; *) echo "$id" ;; esac; exit 0 ;;
      ls) awk -v r="$(last "$@"):" 'index($1, r) == 1 {print $1}' "$store"; exit 0 ;;
      rm) awk -v r="$(last "$@")" '$1 != r' "$store" > "$store.t"; mv "$store.t" "$store"; exit 0 ;;
    esac ;;
  tag) id="$(resolve "$2")"; [ -n "$id" ] || exit 1; setref "$3" "$id"; exit 0 ;;
  info) echo "${FAKE_DOCKER_ROOT:-/}"; exit 0 ;;
  builder) touch "$FAKE_STORE/pruned"; exit 0 ;;
esac
exit 0
