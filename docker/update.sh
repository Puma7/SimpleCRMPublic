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
COMPOSE_DIR="$(CDPATH= cd -- "$(dirname -- "$COMPOSE_FILE")" && pwd)"
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

compose() { docker compose -p "$COMPOSE_PROJECT_NAME" --project-directory "$COMPOSE_DIR" -f "$COMPOSE_FILE" "$@"; }
say() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }

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
compose up -d api caddy

say "[6/6] Verifying"
migrate_cli --check
compose ps

say "Update complete."
