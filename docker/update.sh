#!/bin/sh
set -eu
#
# One-command production update for a Docker Compose SimpleCRM deployment.
#
#   sh docker/update.sh                  # update to the latest origin/main
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
# leaves you on a half-updated stack.

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
BRANCH="${BRANCH:-main}"
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
  say "[1/6] Updating source to origin/$BRANCH"
  # Reset to FETCH_HEAD (the exact commit we just fetched) rather than the
  # remote-tracking ref origin/$BRANCH, which a plain branch fetch may leave
  # stale — otherwise we could rebuild the previous commit and report success.
  git -C "$REPO_DIR" fetch origin "$BRANCH"
  git -C "$REPO_DIR" checkout -B "$BRANCH" FETCH_HEAD
  git -C "$REPO_DIR" reset --hard FETCH_HEAD
fi

if [ "${SKIP_BACKUP:-0}" = "1" ]; then
  say "[2/6] Skipping backup (SKIP_BACKUP=1) — not recommended"
else
  say "[2/6] Backing up the database"
  compose --profile backup run --rm backup
fi

say "[3/6] Building images"
compose build

if [ "${REPAIR_CHECKSUMS:-0}" = "1" ]; then
  # Explicit recovery only. --repair-checksums re-stamps the stored checksum of
  # ANY already-applied migration whose definition changed in code. That is the
  # right move when an upstream change re-defined an early migration AND a later
  # migration re-applies the delta idempotently — but it would also silently
  # bless genuine drift. So it is opt-in: the operator runs it after confirming
  # the situation (the runner's "Checksum mismatch" error points here).
  say "[4/6] Reconciling migration checksums + applying pending migrations (REPAIR_CHECKSUMS=1)"
  migrate_cli --repair-checksums
else
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

say "[5/6] Draining old workers and restarting api + web"
# Graphile Worker migrations may change lock ownership semantics. Scale the old
# API/worker generation to zero before a newly built API migrates its schema.
compose stop api
fix_api_volume_ownership
warn_unreadable_relay_tls_key
warn_relay_override_missing
compose up -d api caddy

say "[6/6] Verifying"
migrate_cli --check
compose ps

say "Update complete."
