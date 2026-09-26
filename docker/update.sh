#!/bin/sh
set -eu
#
# One-command production update for a Docker Compose SimpleCRM deployment.
#
#   sh docker/update.sh                  # update to the latest origin/main
#   RELEASE=latest sh docker/update.sh   # update to the newest release tag vX.Y.Z (recommended)
#   RELEASE=v1.1.0 sh docker/update.sh   # update to exactly this release tag
#
# RELEASE, not VERSION: docker-compose.yml uses VERSION as the image tag
# (simplecrm/api:${VERSION:-dev}) and hands it to the API. This script never
# reads or sets VERSION, so an operator's image tag stays untouched.
#   BRANCH=some-branch sh docker/update.sh
#   SKIP_PULL=1   sh docker/update.sh    # use the current checkout, don't git pull
#   SKIP_BACKUP=1 sh docker/update.sh    # skip the pre-update backup (not recommended)
#
# It honors COMPOSE_PROJECT_NAME and COMPOSE_FILE. By default the project name is
# the compose file's directory basename — the same value plain
# `docker compose -f docker/docker-compose.yml ...` uses — so this script and your
# manual compose commands always act on the SAME stack.
#
# Steps: pull -> backup -> build -> reconcile checksums + migrate -> restart -> verify.
# Any failed step aborts before the next one (set -e), so a failed migration never
# leaves you on a half-updated stack. On failure the script prints the way back:
# the previous commit and the pre-update backup set to restore.

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
REPO_DIR="$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)"
COMPOSE_FILE="${COMPOSE_FILE:-$SCRIPT_DIR/docker-compose.yml}"
# The compose file's directory is what Docker Compose itself uses to derive both
# the default project name AND the project's .env file. Deriving from it (rather
# than from this script's location) keeps us correct when COMPOSE_FILE points
# outside docker/, and pinning --project-directory below stops a stray .env in
# the caller's PWD from shadowing the real one.
# COMPOSE_FILE may list several files separated by ':' like Docker Compose's own
# variable, e.g. the base file plus docker-compose.relay.yml. The first one is
# the main file and decides the project directory.
COMPOSE_DIR="$(CDPATH= cd -- "$(dirname -- "${COMPOSE_FILE%%:*}")" && pwd)"
# Did the operator explicitly choose a project, or are we deriving it? The
# simplecrm wrapper passes this through (it always exports COMPOSE_PROJECT_NAME
# for stack consistency, so the bare presence of the var isn't a reliable signal).
if [ -n "${SIMPLECRM_PROJECT_EXPLICIT:-}" ]; then
  PROJECT_EXPLICIT="$SIMPLECRM_PROJECT_EXPLICIT"
elif [ -n "${COMPOSE_PROJECT_NAME:-}" ]; then
  PROJECT_EXPLICIT=1
else
  PROJECT_EXPLICIT=0
fi
COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-$(basename "$COMPOSE_DIR")}"
BRANCH_EXPLICIT="${BRANCH:+1}"
BRANCH="${BRANCH:-main}"
RELEASE="${RELEASE:-}"
UPDATE_API_HEALTH_TIMEOUT_SECONDS="${UPDATE_API_HEALTH_TIMEOUT_SECONDS:-180}"
# Space the update needs where Docker stores its data (backup + build), and the
# build cache kept afterwards (it only speeds up the next build).
UPDATE_MIN_FREE_GB="${UPDATE_MIN_FREE_GB:-6}"
DOCKER_BUILD_CACHE_KEEP_GB="${DOCKER_BUILD_CACHE_KEEP_GB:-2}"
export COMPOSE_PROJECT_NAME

# One -f per entry of COMPOSE_FILE, in order. POSIX sh has no arrays: append
# the flags behind the arguments, then rotate the arguments to the end.
compose() {
  _argc=$#
  _ifs=$IFS
  IFS=':'
  for _file in $COMPOSE_FILE; do set -- "$@" -f "$_file"; done
  IFS=$_ifs
  while [ "$_argc" -gt 0 ]; do set -- "$@" "$1"; shift; _argc=$((_argc - 1)); done
  docker compose -p "$COMPOSE_PROJECT_NAME" --project-directory "$COMPOSE_DIR" "$@"
}
say() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
. "$SCRIPT_DIR/update-lib.sh"

# The API image runs as the unprivileged node user (uid 1000). Hand it the
# writable volumes: files written by older root-run images would otherwise
# stay root-owned and the API could not write there. Only entries with another
# owner are touched, so after the first run this is a cheap no-op.
fix_api_volume_ownership() {
  compose run --rm --no-deps --user root --cap-add CHOWN --cap-add DAC_OVERRIDE --cap-add FOWNER --entrypoint sh api -c \
    'find /app/data/attachments /app/data/audit-archive /app/data/logs \( ! -user node -o ! -group node \) -exec chown -h node:node {} +'
}

# The SMTP relay (docker-compose.relay.yml) reads its TLS key as uid 1000 too.
# A key only root can read would silently switch the relay off after this
# update, so say so. Only a warning: the relay is optional and the key is the
# operator's file.
warn_unreadable_relay_tls_key() {
  tls_dir="${SMTP_RELAY_TLS_DIR:-./relay-tls}"
  case "$tls_dir" in /*) ;; *) tls_dir="$COMPOSE_DIR/$tls_dir" ;; esac
  key="$tls_dir/key.pem"
  [ -f "$key" ] || return 0
  owner="$(stat -c %u "$key" 2>/dev/null)" || return 0
  mode="$(stat -c %a "$key" 2>/dev/null)" || return 0
  if [ "$owner" != 1000 ] && [ $(( 0$mode & 4 )) -eq 0 ]; then
    printf 'WARNING: %s is not readable for uid 1000 (the API now runs as node); the SMTP relay will not start. Fix: chown 1000 %s\n' "$key" "$key" >&2
  fi
}

# The relay's ports and TLS mount live in docker-compose.relay.yml. Recreating
# the API from the base file alone silently drops them, so an enabled relay
# without its override in COMPOSE_FILE is worth a loud hint.
warn_relay_override_missing() {
  relay_enabled="${SMTP_RELAY_ENABLED:-}"
  if [ -z "$relay_enabled" ] && [ -f "$COMPOSE_DIR/.env" ]; then
    relay_enabled="$(sed -n 's/^SMTP_RELAY_ENABLED=["'"'"']\{0,1\}\([^"'"'"']*\).*/\1/p' "$COMPOSE_DIR/.env" | tail -n 1)"
  fi
  case "$relay_enabled" in true|1|yes) ;; *) return 0 ;; esac
  case "$COMPOSE_FILE" in *docker-compose.relay.yml*) return 0 ;; esac
  printf 'WARNING: SMTP_RELAY_ENABLED is set, but COMPOSE_FILE does not include docker-compose.relay.yml; the API is recreated without the relay ports. Use: COMPOSE_FILE=%s:%s/docker-compose.relay.yml\n' "$COMPOSE_FILE" "$COMPOSE_DIR" >&2
}

# Newest release tag vX.Y.Z on origin (numeric order, so v1.10.0 > v1.9.0).
# Pre-release tags such as v1.2.0-rc1 are ignored.
latest_release_tag() {
  git -C "$REPO_DIR" ls-remote --tags --refs origin 'v*' \
    | sed -n 's#^.*refs/tags/\(v[0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*\)$#\1#p' \
    | sort -t. -k1.2,1n -k2,2n -k3,3n \
    | tail -n 1
}

# Marks the start of this update's backup inside the backups volume.
mark_backup_start() {
  compose --profile backup run --rm --no-deps --entrypoint sh backup -c \
    'dir="${BACKUP_DIR:-/backups}"; mkdir -p "$dir"; touch "$dir/.update-backup-start"' >/dev/null
}

# The newest database dump written after mark_backup_start, as the path the
# restore service sees (/backups/<name>; the backup service mounts the volume
# at BACKUP_DIR, which may differ), or nothing. Nothing also when retention
# removed the new set right away (all BACKUP_RETENTION_* set to 0): an older
# set must never pass for this update's backup.
latest_backup_dump() {
  _dump="$(compose --profile backup run --rm --no-deps --entrypoint sh backup -c \
    'dir="${BACKUP_DIR:-/backups}"; set -- $(find "$dir" -maxdepth 1 -name "db-*.dump" -newer "$dir/.update-backup-start" 2>/dev/null); [ "$#" -gt 0 ] && ls -1t "$@" | head -n 1' \
    2>/dev/null | tr -d '\r' | tail -n 1 || true)"
  [ -n "$_dump" ] && printf '/backups/%s\n' "$(basename "$_dump")"
  return 0
}

# Printed when the update stops after the source was changed: one command back
# to the version that ran before, with its images (no rebuild) and, once the
# migrations may have run, the pre-update backup.
print_way_back() {
  # Same stack as this update: project and every compose file (relay override,
  # custom locations), so a copied command never hits the default stack.
  selection="COMPOSE_PROJECT_NAME=\"$COMPOSE_PROJECT_NAME\" COMPOSE_FILE=\"$COMPOSE_FILE\""
  echo >&2
  echo "==> Update stopped during: $UPDATE_STAGE" >&2
  echo "    Previous version: $FROM_REV${FROM_API_GEN:+ (images $FROM_API_GEN, $FROM_WEB_GEN)}" >&2
  [ -n "$ROLLBACK_BACKUP" ] && echo "    Pre-update backup: $ROLLBACK_BACKUP" >&2
  echo >&2
  if [ "$DATA_CHANGED" = 1 ]; then
    echo "Migrations of the new version may already have run. Fix the cause and re-run" >&2
    echo "the update, or go back to the previous version and its data." >&2
  else
    echo "The database is unchanged and the running version keeps running." >&2
  fi
  if [ -n "$FROM_API_GEN" ]; then
    echo "Back to the previous version (its images are kept, nothing is rebuilt):" >&2
    echo "  $selection sh \"$SCRIPT_DIR/simplecrm\" rollback" >&2
  else
    # No image of the previous version (fresh install): rebuild it from git.
    echo "Back to the previous version:" >&2
    echo "  git -C \"$REPO_DIR\" checkout --detach $FROM_REV" >&2
    if [ "$DATA_CHANGED" = 1 ]; then
      echo "  $selection docker compose -p \"$COMPOSE_PROJECT_NAME\" --project-directory \"$COMPOSE_DIR\" build" >&2
      echo "  $selection sh \"$SCRIPT_DIR/simplecrm\" restore ${ROLLBACK_BACKUP:-/backups/db-<stamp>.dump}" >&2
    else
      echo "  $selection SKIP_PULL=1 SKIP_BACKUP=1 sh \"$SCRIPT_DIR/update.sh\"" >&2
    fi
  fi
}

# The attempt record: what ran before this update, the backup that matches it
# and how far the update got. The rollback command reads it; it is replaced by
# the state only on success. data_changed=1 once migrations may have run (in
# this attempt or in a failed one before it).
write_attempt() {
  write_kv_file "$(attempt_file)" \
    "stage=$UPDATE_STAGE" \
    "data_changed=$DATA_CHANGED" \
    "from_commit=$FROM_COMMIT" \
    "from_release=$FROM_RELEASE" \
    "from_api_image=$FROM_API_GEN" \
    "from_web_image=$FROM_WEB_GEN" \
    "backup=$ROLLBACK_BACKUP" \
    "started_at=$STARTED_AT"
}

set_stage() {
  UPDATE_STAGE="$1"
  case "$1" in migrate|restart|verify) DATA_CHANGED=1 ;; esac
  write_attempt
}

# Stop before anything changes when the disk is too full for backup and build.
# The build cache is the one thing that may go first (it only speeds builds up).
ensure_free_space() {
  need_kb=$((UPDATE_MIN_FREE_GB * 1024 * 1024))
  free_kb="$(docker_root_free_kb)"
  case "$free_kb" in ''|*[!0-9]*) return 0 ;; esac
  [ "$free_kb" -ge "$need_kb" ] && return 0
  say "Only $(awk -v k="$free_kb" 'BEGIN {printf "%.1f", k/1048576}') GB free (need ${UPDATE_MIN_FREE_GB} GB): clearing the Docker build cache"
  prune_build_cache 0
  free_kb="$(docker_root_free_kb)"
  case "$free_kb" in ''|*[!0-9]*) return 0 ;; esac
  [ "$free_kb" -ge "$need_kb" ] && return 0
  echo "ERROR: only $(awk -v k="$free_kb" 'BEGIN {printf "%.1f", k/1048576}') GB free where Docker stores images, build cache and volumes; the update needs ${UPDATE_MIN_FREE_GB} GB for backup and build." >&2
  echo "Nothing was changed. \`sh $SCRIPT_DIR/simplecrm disk\` shows where the space goes; UPDATE_MIN_FREE_GB changes the limit." >&2
  exit 5
}

UPDATE_STAGE=preflight
DATA_CHANGED=0
PREV_REV="$(git -C "$REPO_DIR" rev-parse --short HEAD 2>/dev/null || echo unknown)"
FROM_REV="$PREV_REV"
# BACKUP_DUMP: taken by this run. ROLLBACK_BACKUP: the one matching the version
# a rollback returns to (the same, unless a failed attempt migrated before).
BACKUP_DUMP=""
ROLLBACK_BACKUP=""
FETCHED_COMMIT=""
FROM_COMMIT=""
FROM_RELEASE=""
FROM_API_GEN=""
FROM_WEB_GEN=""
STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
on_exit() {
  status=$?
  if [ "$status" -ne 0 ] && [ "$UPDATE_STAGE" != "preflight" ]; then
    write_attempt 2>/dev/null || true
    print_way_back
  fi
  return "$status"
}
trap on_exit EXIT

# True when Compose knows a (running or stopped) project named "$1".
project_has_stack() {
  docker compose ls -a 2>/dev/null | awk 'NR>1 {print $1}' | grep -qx "$1"
}

# Run the migrate CLI inside a one-off container of the migrate service.
# --entrypoint node lets us pass CLI flags (the service's default command takes none).
migrate_cli() {
  compose run --rm --entrypoint node migrate packages/server/dist/cli/migrate.js "$@"
}

say "Project: $COMPOSE_PROJECT_NAME    Compose file: $COMPOSE_FILE"

# The API refuses to start with a proxy hop count such as TRUST_PROXY=1 (fastify
# >= 5.12 ignores hop counts; see docs/SETUP_SERVER.md). Stop here, before
# anything is rebuilt or restarted, instead of leaving the new API crash-looping.
trust_proxy_value="${TRUST_PROXY:-}"
if [ -z "$trust_proxy_value" ] && [ -f "$COMPOSE_DIR/.env" ]; then
  trust_proxy_value="$(sed -n 's/^TRUST_PROXY=["'"'"']\{0,1\}\([^"'"'"']*\).*/\1/p' "$COMPOSE_DIR/.env" | tail -n 1)"
fi
case "$trust_proxy_value" in
  ''|*[!0-9]*) ;;
  *)
    printf 'ERROR: TRUST_PROXY=%s is a proxy hop count, which the API no longer accepts.\n' "$trust_proxy_value" >&2
    printf 'Remove the line from %s/.env to trust the bundled Caddy (CADDY_PROXY_IP), or list your proxy IPs/CIDRs.\n' "$COMPOSE_DIR" >&2
    exit 4
    ;;
esac

# Guard against a silent stack swap. An older version of this tooling hardcoded
# the project name "simplecrm". If a stack still runs under that name and the
# operator did not explicitly pick a project, operating on the derived default
# would start a SECOND, empty stack and leave the real one un-updated.
if [ "$PROJECT_EXPLICIT" = "0" ] \
  && [ "$COMPOSE_PROJECT_NAME" != "simplecrm" ] \
  && project_has_stack simplecrm \
  && ! project_has_stack "$COMPOSE_PROJECT_NAME"; then
  cat >&2 <<EOF

Refusing to update: an existing Compose stack named 'simplecrm' is present, but
this tool would operate on project '$COMPOSE_PROJECT_NAME' (derived from the
compose directory). That would start a SECOND, empty stack and leave 'simplecrm'
un-updated.

  - Update your existing stack:        COMPOSE_PROJECT_NAME=simplecrm sh docker/update.sh
  - Intentionally use '$COMPOSE_PROJECT_NAME': set COMPOSE_PROJECT_NAME=$COMPOSE_PROJECT_NAME explicitly.
EOF
  exit 3
fi

if [ -n "$RELEASE" ] && { [ "${SKIP_PULL:-0}" = "1" ] || [ -n "$BRANCH_EXPLICIT" ]; }; then
  echo "--version (RELEASE) cannot be combined with --branch or --no-pull." >&2
  exit 2
fi

if [ -n "$RELEASE" ]; then
  if [ "$RELEASE" = "latest" ]; then
    RELEASE="$(latest_release_tag)"
    if [ -z "$RELEASE" ]; then
      echo "No release tag vX.Y.Z found on origin." >&2
      exit 3
    fi
  fi
  if ! printf '%s\n' "$RELEASE" | grep -Eq '^v[0-9]+\.[0-9]+\.[0-9]+$'; then
    echo "--version must be a release tag like v1.1.0 (or 'latest'), got: $RELEASE" >&2
    exit 2
  fi
fi

# Fetch the target first: an unknown release tag or branch stops here, before
# anything touches Docker (the checkout itself happens further down).
if [ "${SKIP_PULL:-0}" != "1" ]; then
  if [ -n "$RELEASE" ]; then
    say "Fetching release $RELEASE"
    # A release tag names one tested commit. Fetch exactly that tag; if a local
    # tag of the same name points elsewhere, git refuses instead of guessing.
    git -C "$REPO_DIR" fetch --no-tags origin "refs/tags/$RELEASE:refs/tags/$RELEASE"
  else
    say "Fetching origin/$BRANCH"
    git -C "$REPO_DIR" fetch origin "$BRANCH"
    FETCHED_COMMIT="$(git -C "$REPO_DIR" rev-parse FETCH_HEAD)"
  fi
fi

ensure_free_space

resolve_app_image_refs
prior_attempt="$(attempt_file)"
if [ -f "$prior_attempt" ] && [ -n "$(state_get "$prior_attempt" from_commit)" ]; then
  # A failed update left checkout, images and maybe the schema half-way. The
  # last good version is still the one before that attempt, and after its
  # migrations only the backup taken before them matches it: keep both as the
  # rollback target of this run.
  say "An earlier update did not finish (started $(state_get "$prior_attempt" started_at), stopped during: $(state_get "$prior_attempt" stage)). Rollback target stays the version that ran before it."
  FROM_COMMIT="$(state_get "$prior_attempt" from_commit)"
  FROM_RELEASE="$(state_get "$prior_attempt" from_release)"
  FROM_API_GEN="$(state_get "$prior_attempt" from_api_image)"
  FROM_WEB_GEN="$(state_get "$prior_attempt" from_web_image)"
  if [ -z "$FROM_API_GEN" ] || [ -z "$FROM_WEB_GEN" ] \
    || [ -z "$(image_id "$FROM_API_GEN")" ] || [ -z "$(image_id "$FROM_WEB_GEN")" ]; then
    FROM_API_GEN=""
    FROM_WEB_GEN=""
  fi
  case "$(state_get "$prior_attempt" stage)" in migrate|restart|verify) DATA_CHANGED=1 ;; esac
  [ "$(state_get "$prior_attempt" data_changed)" = 1 ] && DATA_CHANGED=1
  [ "$DATA_CHANGED" = 1 ] && ROLLBACK_BACKUP="$(state_get "$prior_attempt" backup)"
  STARTED_AT="$(state_get "$prior_attempt" started_at)"
  FROM_REV="$(printf '%s' "$FROM_COMMIT" | cut -c1-7)"
else
  # What runs now is the rollback target of this update. Tag its images as a
  # generation so the build below cannot turn them into anonymous leftovers.
  FROM_COMMIT="$(git -C "$REPO_DIR" rev-parse HEAD 2>/dev/null || true)"
  FROM_RELEASE="$(git -C "$REPO_DIR" describe --tags --exact-match HEAD 2>/dev/null || true)"
  from_api_id="$(running_image_id api)"
  [ -n "$from_api_id" ] || from_api_id="$(image_id "$API_REF")"
  from_web_id="$(running_image_id caddy)"
  [ -n "$from_web_id" ] || from_web_id="$(image_id "$WEB_REF")"
  FROM_API_GEN="$(ensure_gen_tag simplecrm/api "$from_api_id" "$FROM_COMMIT")"
  FROM_WEB_GEN="$(ensure_gen_tag simplecrm/web "$from_web_id" "$FROM_COMMIT")"
fi
ROLLBACK_BACKUP_BEFORE="$(state_get "$(state_file)" rollback_backup)"

if [ "${SKIP_PULL:-0}" = "1" ]; then
  say "[1/6] Skipping source update (SKIP_PULL=1)"
else
  # 'git reset --hard' discards local modifications to tracked files. Refuse if
  # any exist (untracked files are preserved by reset and ignored here), unless
  # the operator opts in with FORCE_RESET=1.
  if [ "${FORCE_RESET:-0}" != "1" ] && [ -n "$(git -C "$REPO_DIR" status --porcelain --untracked-files=no)" ]; then
    echo "Local changes to tracked files would be discarded by 'git reset --hard':" >&2
    git -C "$REPO_DIR" status --short --untracked-files=no >&2
    echo "Commit or stash them, or re-run with FORCE_RESET=1 to discard." >&2
    exit 3
  fi
  if [ -n "$RELEASE" ]; then
    say "[1/6] Updating source to release $RELEASE (previous: $PREV_REV)"
    # From here on the checkout changes: a failure prints the way back.
    set_stage source
    git -C "$REPO_DIR" checkout --force --detach "refs/tags/$RELEASE"
  else
    say "[1/6] Updating source to origin/$BRANCH (previous: $PREV_REV)"
    # Reset to the exact commit fetched above rather than the remote-tracking
    # ref origin/$BRANCH, which a plain branch fetch may leave stale — otherwise
    # we could rebuild the previous commit and report success.
    set_stage source
    git -C "$REPO_DIR" checkout -B "$BRANCH" "$FETCHED_COMMIT"
    git -C "$REPO_DIR" reset --hard "$FETCHED_COMMIT"
  fi
fi

set_stage backup
if [ "${SKIP_BACKUP:-0}" = "1" ]; then
  say "[2/6] Skipping backup (SKIP_BACKUP=1) — not recommended"
else
  say "[2/6] Backing up the database"
  mark_backup_start
  compose --profile backup run --rm backup
  BACKUP_DUMP="$(latest_backup_dump)"
  if [ -z "$BACKUP_DUMP" ]; then
    echo "ERROR: the backup run left no new backup set in the backups volume." >&2
    echo "Check its output above and BACKUP_RETENTION_DAILY/WEEKLY/MONTHLY (all 0 removes every set, the new one included)." >&2
    echo "Nothing was built or migrated." >&2
    exit 1
  fi
  echo "Pre-update backup: $BACKUP_DUMP"
  [ "$DATA_CHANGED" = 1 ] || ROLLBACK_BACKUP="$BACKUP_DUMP"
  write_attempt
  # Retention must not remove this set, the rollback set of a failed attempt,
  # nor the one the last update kept for its rollback, while this runs.
  protect_backup_stamps "$(backup_stamp_of "$ROLLBACK_BACKUP_BEFORE")" \
    "$(backup_stamp_of "$ROLLBACK_BACKUP")" "$(backup_stamp_of "$BACKUP_DUMP")"
fi

set_stage build
# Only the running generation is still needed as rollback target of this
# update; older generations go before the build needs the space.
[ -n "$FROM_API_GEN" ] && cleanup_app_generations "$FROM_API_GEN" "$FROM_WEB_GEN"
say "[3/6] Building images"
compose build

if [ "${REPAIR_CHECKSUMS:-0}" = "1" ]; then
  # Explicit recovery only. --repair-checksums re-stamps the stored checksum of
  # ANY already-applied migration whose definition changed in code. That is the
  # right move when an upstream change re-defined an early migration AND a later
  # migration re-applies the delta idempotently — but it would also silently
  # bless genuine drift. So it is opt-in: the operator runs it after confirming
  # the situation (the runner's "Checksum mismatch" error points here).
  set_stage migrate
  say "[4/6] Reconciling migration checksums + applying pending migrations (REPAIR_CHECKSUMS=1)"
  migrate_cli --repair-checksums
else
  set_stage migrate
  say "[4/6] Applying pending migrations"
  if ! migrate_cli; then
    cat >&2 <<EOF

Migration failed. If this is a "Checksum mismatch" — an upstream change
re-defined an already-applied migration whose delta is re-applied idempotently
by a later migration — review the change, then re-run this update once with:

    REPAIR_CHECKSUMS=1 sh docker/update.sh

This re-stamps the affected checksums first. Do NOT use it to paper over a
migration edit that is not backed by such a later migration.
EOF
    exit 1
  fi
fi

set_stage restart
say "[5/6] Draining old workers and restarting api + web"
# Graphile Worker migrations may change lock ownership semantics. Scale the old
# API/worker generation to zero before a newly built API migrates its schema.
compose stop api
fix_api_volume_ownership
warn_unreadable_relay_tls_key
warn_relay_override_missing
compose up -d api caddy

set_stage verify
say "[6/6] Verifying"
wait_for_api_health
migrate_cli --check
compose ps

# Commit: the new version is current, the one before it the rollback target,
# together with the backup taken right before its migrations.
NEW_COMMIT="$(git -C "$REPO_DIR" rev-parse HEAD 2>/dev/null || true)"
NEW_API_GEN="$(ensure_gen_tag simplecrm/api "$(image_id "$API_REF")" "$NEW_COMMIT")"
NEW_WEB_GEN="$(ensure_gen_tag simplecrm/web "$(image_id "$WEB_REF")" "$NEW_COMMIT")"
write_kv_file "$(state_file)" \
  "current_commit=$NEW_COMMIT" \
  "current_release=${RELEASE:-$(git -C "$REPO_DIR" describe --tags --exact-match HEAD 2>/dev/null || true)}" \
  "current_api_image=$NEW_API_GEN" \
  "current_web_image=$NEW_WEB_GEN" \
  "previous_commit=$FROM_COMMIT" \
  "previous_release=$FROM_RELEASE" \
  "previous_api_image=$FROM_API_GEN" \
  "previous_web_image=$FROM_WEB_GEN" \
  "rollback_backup=$ROLLBACK_BACKUP" \
  "updated_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
rm -f "$(attempt_file)"
UPDATE_STAGE="done"
# The protection moves to this update's rollback backup; the old rollback set
# goes back to normal retention. Without a backup (SKIP_BACKUP) nothing stays
# protected.
protect_backup_stamps "$(backup_stamp_of "$ROLLBACK_BACKUP")" || echo "WARNING: could not update the protected backup list" >&2

say "Cleaning up: keeping the current and the previous version, build cache down to ${DOCKER_BUILD_CACHE_KEEP_GB} GB"
cleanup_app_generations "$NEW_API_GEN" "$NEW_WEB_GEN" "$FROM_API_GEN" "$FROM_WEB_GEN"
prune_build_cache "$DOCKER_BUILD_CACHE_KEEP_GB"

# Maintenance check on the new version: attachment files and stored originals
# against the database. Only reports; the update itself is already complete.
say "Checking attachments and stored mail originals"
compose run --rm --no-deps --entrypoint node api packages/server/dist/cli/maintenance.js --check-only \
  || echo "WARNING: the maintenance check reported problems (see above). Nothing was changed; details: sh $SCRIPT_DIR/simplecrm maintenance --check-only" >&2

NEW_REV="$(git -C "$REPO_DIR" rev-parse --short HEAD 2>/dev/null || echo unknown)"
say "Update complete: $FROM_REV -> $NEW_REV${RELEASE:+ ($RELEASE)}"
[ -n "$ROLLBACK_BACKUP" ] && echo "Pre-update backup kept for a rollback: $ROLLBACK_BACKUP"
[ -n "$FROM_API_GEN" ] && echo "Previous version kept for a rollback: $FROM_API_GEN, $FROM_WEB_GEN (sh $SCRIPT_DIR/simplecrm rollback)"
exit 0
