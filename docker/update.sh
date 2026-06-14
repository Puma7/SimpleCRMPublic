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
COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-$(basename "$SCRIPT_DIR")}"
BRANCH="${BRANCH:-main}"
export COMPOSE_PROJECT_NAME

compose() { docker compose -p "$COMPOSE_PROJECT_NAME" -f "$COMPOSE_FILE" "$@"; }
say() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }

# Run the migrate CLI inside a one-off container of the migrate service.
# --entrypoint node lets us pass CLI flags (the service's default command takes none).
migrate_cli() {
  compose run --rm --entrypoint node migrate packages/server/dist/cli/migrate.js "$@"
}

say "Project: $COMPOSE_PROJECT_NAME    Compose file: $COMPOSE_FILE"

if [ "${SKIP_PULL:-0}" = "1" ]; then
  say "[1/6] Skipping source update (SKIP_PULL=1)"
else
  say "[1/6] Updating source to origin/$BRANCH"
  git -C "$REPO_DIR" fetch origin "$BRANCH"
  git -C "$REPO_DIR" checkout "$BRANCH"
  git -C "$REPO_DIR" reset --hard "origin/$BRANCH"
fi

if [ "${SKIP_BACKUP:-0}" = "1" ]; then
  say "[2/6] Skipping backup (SKIP_BACKUP=1) — not recommended"
else
  say "[2/6] Backing up the database"
  compose --profile backup run --rm backup
fi

say "[3/6] Building images"
compose build

say "[4/6] Reconciling migration checksums + applying pending migrations"
# --repair-checksums re-stamps already-applied migrations whose definition was
# changed upstream (their real delta is delivered idempotently by a later
# migration), then applies anything pending. Safe + idempotent to re-run.
migrate_cli --repair-checksums

say "[5/6] Restarting api + web"
compose up -d api caddy

say "[6/6] Verifying"
migrate_cli --check
compose ps

say "Update complete."
