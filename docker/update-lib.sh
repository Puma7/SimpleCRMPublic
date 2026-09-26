# shellcheck shell=sh
#
# Shared helpers of update.sh, rollback.sh and `simplecrm disk`: image
# generations for a rebuild-free rollback, the rollback state and disk space.
# Sourced after the including script has defined compose() and REPO_DIR,
# COMPOSE_DIR, COMPOSE_PROJECT_NAME.
#
# Image generations: compose keeps using its moving tag (simplecrm/api:dev or
# the operator's VERSION). Each built generation additionally carries an
# immutable tag simplecrm/api:gen-<commit>-<utc stamp>. After a successful
# update exactly two generations stay: current and previous. A rollback points
# the moving tag back at the previous generation; nothing is rebuilt.
#
# State (plain key=value lines, never sourced):
#   $COMPOSE_DIR/.simplecrm-update/<project>.attempt  update in progress or failed
#   $COMPOSE_DIR/.simplecrm-update/<project>.state    last successful update
# Protected backup stamps: $BACKUP_DIR/.protected-stamps in the backups volume;
# backup-retention.sh never removes these sets.

SIMPLECRM_APP_REPOS="simplecrm/api simplecrm/web"
SIMPLECRM_IMAGE_LABEL="org.simplecrm.image"

state_dir() {
  printf '%s' "${SIMPLECRM_STATE_DIR:-$COMPOSE_DIR/.simplecrm-update}"
}

state_file() {
  printf '%s/%s.state' "$(state_dir)" "$COMPOSE_PROJECT_NAME"
}

attempt_file() {
  printf '%s/%s.attempt' "$(state_dir)" "$COMPOSE_PROJECT_NAME"
}

# state_get <file> <key>: value of the last `key=` line, or nothing.
state_get() {
  [ -f "$1" ] || return 0
  sed -n "s/^$2=//p" "$1" | tail -n 1
}

# write_kv_file <file> key=value...: atomic replace. Values are ours (commit
# ids, image refs, container paths); newlines are dropped defensively.
write_kv_file() {
  _file="$1"
  shift
  mkdir -p "$(dirname "$_file")"
  : > "$_file.tmp"
  for _pair in "$@"; do
    printf '%s\n' "$_pair" | tr -d '\r\n' >> "$_file.tmp"
    printf '\n' >> "$_file.tmp"
  done
  mv "$_file.tmp" "$_file"
}

# Image references compose uses for api/migrate and caddy (web bundle), as
# resolved from the compose files and .env (VERSION stays the operator's).
resolve_app_image_refs() {
  _images="$(compose config --images 2>/dev/null || true)"
  API_REF="$(printf '%s\n' "$_images" | grep '^simplecrm/api:' | head -n 1)"
  WEB_REF="$(printf '%s\n' "$_images" | grep '^simplecrm/web:' | head -n 1)"
  [ -n "$API_REF" ] || API_REF="simplecrm/api:${VERSION:-dev}"
  [ -n "$WEB_REF" ] || WEB_REF="simplecrm/web:${VERSION:-dev}"
}

image_id() {
  docker image inspect --format '{{.Id}}' "$1" 2>/dev/null || true
}

# Image the running container of a service was started from (what really runs,
# even if the moving tag already points at a newer build), else nothing.
running_image_id() {
  _container="$(compose ps -q "$1" 2>/dev/null | head -n 1 || true)"
  [ -n "$_container" ] || return 0
  docker inspect --format '{{.Image}}' "$_container" 2>/dev/null || true
}

# ensure_gen_tag <repo> <image id> <commit>: the generation tag of this image,
# created if it has none. Prints repo:gen-... or nothing if there is no image.
ensure_gen_tag() {
  _repo="$1"
  _id="$2"
  _commit="$3"
  [ -n "$_id" ] || return 0
  _existing="$(docker image inspect --format '{{range .RepoTags}}{{println .}}{{end}}' "$_id" 2>/dev/null \
    | grep "^$_repo:gen-" | head -n 1 || true)"
  if [ -n "$_existing" ]; then
    printf '%s\n' "$_existing"
    return 0
  fi
  _base="$_repo:gen-$(printf '%s' "$_commit" | cut -c1-12)-$(date -u +%Y%m%d%H%M%S)"
  _tag="$_base"
  _n=2
  while [ -n "$(image_id "$_tag")" ]; do
    _tag="$_base-$_n"
    _n=$((_n + 1))
  done
  docker tag "$_id" "$_tag"
  printf '%s\n' "$_tag"
}

# Remove every generation tag of the app repos except the given ones, then the
# app's own dangling images (label). Never touches other images or volumes.
cleanup_app_generations() {
  for _repo in $SIMPLECRM_APP_REPOS; do
    docker image ls --format '{{.Repository}}:{{.Tag}}' "$_repo" 2>/dev/null | while read -r _ref; do
      case "$_ref" in
        "$_repo":gen-*) ;;
        *) continue ;;
      esac
      _keep=0
      for _wanted in "$@"; do
        [ "$_ref" = "$_wanted" ] && _keep=1
      done
      [ "$_keep" = 1 ] || docker image rm "$_ref" >/dev/null 2>&1 || true
    done
  done
  docker image prune -f --filter "label=$SIMPLECRM_IMAGE_LABEL" >/dev/null 2>&1 || true
}

# Free space (KiB) where Docker keeps images, build cache and volumes.
docker_root_free_kb() {
  _root="$(docker info --format '{{.DockerRootDir}}' 2>/dev/null || true)"
  [ -n "$_root" ] && [ -d "$_root" ] || _root=/
  df -Pk "$_root" 2>/dev/null | awk 'NR==2 {print $4}'
}

# prune_build_cache <keep GB>: build cache down to the budget. Newer Docker
# calls the budget --reserved-space, older --keep-storage.
prune_build_cache() {
  docker builder prune -af --reserved-space "${1}gb" >/dev/null 2>&1 \
    || docker builder prune -af --keep-storage "${1}gb" >/dev/null 2>&1 \
    || true
}

# protect_backup_stamps <stamp>...: replace the protected list in the backups
# volume (empty and repeated stamps are dropped). An empty list removes all
# protection.
protect_backup_stamps() {
  _stamps=""
  for _s in "$@"; do
    [ -n "$_s" ] || continue
    case " $_stamps " in *" $_s "*) continue ;; esac
    _stamps="${_stamps:+$_stamps }$_s"
  done
  # Stamps are backup file names (db-<stamp>.dump) without spaces.
  # shellcheck disable=SC2086
  set -- $_stamps
  compose --profile backup run --rm --no-deps --entrypoint sh backup -c \
    'dir="${BACKUP_DIR:-/backups}"; mkdir -p "$dir"; : > "$dir/.protected-stamps.tmp"; for s in "$@"; do [ -n "$s" ] && printf "%s\n" "$s" >> "$dir/.protected-stamps.tmp"; done; mv "$dir/.protected-stamps.tmp" "$dir/.protected-stamps"' \
    sh "$@" >/dev/null
}

# backup_dump_present <path>: the dump is (still) in the backups volume.
backup_dump_present() {
  compose --profile backup run --rm --no-deps --entrypoint sh backup -c \
    'test -s "${BACKUP_DIR:-/backups}/$1"' sh "$(basename "$1")" >/dev/null 2>&1
}

# /backups/db-<stamp>.dump -> <stamp>
backup_stamp_of() {
  _name="$(basename "${1:-}")"
  _name="${_name#db-}"
  printf '%s' "${_name%.dump}"
}

# Wait until the API container reports healthy (its healthcheck probes
# /health/ready, i.e. the database is reachable). `compose up -d` alone returns
# as soon as the container starts, even if the new version crash-loops.
wait_for_api_health() {
  _timeout="${UPDATE_API_HEALTH_TIMEOUT_SECONDS:-180}"
  _deadline=$(( $(date +%s) + _timeout ))
  while :; do
    _api="$(compose ps -q api || true)"
    if [ -n "$_api" ]; then
      _health="$(docker inspect --format='{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$_api" 2>/dev/null || true)"
      [ "$_health" = "healthy" ] && return 0
    fi
    [ "$(date +%s)" -lt "$_deadline" ] || break
    sleep 3
  done
  compose ps || true
  compose logs --no-color --tail=120 api migrate || true
  echo "ERROR: the API did not become healthy within ${_timeout}s." >&2
  return 1
}
