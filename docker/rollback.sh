#!/bin/sh
set -eu
#
# Back to the version that ran before the last update, without rebuilding:
#
#   sh docker/simplecrm rollback          # shows the plan and asks
#   sh docker/simplecrm rollback --yes    # no question (scripts)
#
# Target:
# - An update that failed or was interrupted (attempt record present): the
#   version that ran before it (also across repeated failed attempts). Before
#   any migrations nothing but the images has to go back; after them the
#   backup taken before the first migrations is restored as well.
# - Otherwise the last successful update: its previous version plus the
#   backup taken right before that update's migrations. Changes made since
#   that backup are lost.
#
# Steps: check out the previous commit, point the compose image tags at the
# kept previous images (docker tag), then either restart api + web or restore
# the backup (restore-compose.sh restores database and attachments, runs the
# old migrations, starts api + web and waits until they are healthy).

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
REPO_DIR="$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)"
COMPOSE_FILE="${COMPOSE_FILE:-$SCRIPT_DIR/docker-compose.yml}"
COMPOSE_DIR="$(CDPATH= cd -- "$(dirname -- "${COMPOSE_FILE%%:*}")" && pwd)"
COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-$(basename "$COMPOSE_DIR")}"
export COMPOSE_PROJECT_NAME COMPOSE_FILE

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

ASSUME_YES=0
for arg in "$@"; do
  case "$arg" in
    --yes|-y) ASSUME_YES=1 ;;
    *) echo "unknown rollback flag: $arg" >&2; exit 2 ;;
  esac
done

attempt="$(attempt_file)"
state="$(state_file)"
if [ -f "$attempt" ]; then
  reason="the update started $(state_get "$attempt" started_at) did not finish (stopped during: $(state_get "$attempt" stage))"
  target_commit="$(state_get "$attempt" from_commit)"
  target_release="$(state_get "$attempt" from_release)"
  target_api="$(state_get "$attempt" from_api_image)"
  target_web="$(state_get "$attempt" from_web_image)"
  backup="$(state_get "$attempt" backup)"
  restore_data="$(state_get "$attempt" data_changed)"
  case "$(state_get "$attempt" stage)" in
    migrate|restart|verify) restore_data=1 ;;
  esac
  [ "$restore_data" = 1 ] || restore_data=0
elif [ -n "$(state_get "$state" previous_api_image)" ]; then
  reason="undo the update of $(state_get "$state" updated_at)"
  target_commit="$(state_get "$state" previous_commit)"
  target_release="$(state_get "$state" previous_release)"
  target_api="$(state_get "$state" previous_api_image)"
  target_web="$(state_get "$state" previous_web_image)"
  backup="$(state_get "$state" rollback_backup)"
  restore_data=1
else
  echo "Nothing to roll back to: no update of project '$COMPOSE_PROJECT_NAME' is recorded in $(state_dir)." >&2
  exit 3
fi

if [ -z "$target_api" ] || [ -z "$target_web" ] \
  || [ -z "$(image_id "$target_api")" ] || [ -z "$(image_id "$target_web")" ]; then
  echo "The images of the previous version are not on this server (${target_api:-?}, ${target_web:-?})." >&2
  echo "Rebuild it instead: git -C \"$REPO_DIR\" checkout --detach $target_commit && SKIP_PULL=1 SKIP_BACKUP=1 sh \"$SCRIPT_DIR/update.sh\"" >&2
  exit 4
fi
if [ "$restore_data" = 1 ] && [ -z "$backup" ]; then
  echo "The migrations of the newer version may have run, but no pre-update backup is recorded (update with SKIP_BACKUP=1)." >&2
  echo "Restore a backup set that matches version ${target_release:-$target_commit} yourself: sh \"$SCRIPT_DIR/simplecrm\" restore /backups/db-<stamp>.dump" >&2
  exit 4
fi
if [ "$restore_data" = 1 ]; then
  # The restore service mounts the backups volume at /backups.
  backup="/backups/$(basename "$backup")"
  # restore-compose stops api and web first: check the dump before anything changes.
  if ! backup_dump_present "$backup"; then
    echo "The pre-update backup $backup is no longer in the backups volume. Nothing was changed." >&2
    echo "Restore a backup set that matches version ${target_release:-$target_commit} yourself: sh \"$SCRIPT_DIR/simplecrm\" restore /backups/db-<stamp>.dump" >&2
    exit 4
  fi
fi

resolve_app_image_refs
cat <<EOF

Rollback of project '$COMPOSE_PROJECT_NAME': $reason.
  Version:  ${target_release:-$(printf '%s' "$target_commit" | cut -c1-12)} (commit $target_commit)
  Images:   $target_api, $target_web (kept on this server, nothing is rebuilt)
EOF
if [ "$restore_data" = 1 ]; then
  cat <<EOF
  Data:     database and attachments are restored from $backup.
            Everything changed in SimpleCRM after that backup is lost.
EOF
else
  echo "  Data:     unchanged (the update stopped before its migrations)."
fi
echo

if [ "$ASSUME_YES" != 1 ]; then
  if [ -t 0 ]; then
    printf 'Roll back now? [y/N] '
    read -r answer
    case "$answer" in y|Y|yes|j|J|ja) ;; *) echo "Nothing changed."; exit 1 ;; esac
  else
    echo "Not a terminal: re-run with --yes to roll back." >&2
    exit 2
  fi
fi

if [ "${FORCE_RESET:-0}" != "1" ] && [ -n "$(git -C "$REPO_DIR" status --porcelain --untracked-files=no)" ]; then
  echo "Local changes to tracked files would be discarded by the checkout:" >&2
  git -C "$REPO_DIR" status --short --untracked-files=no >&2
  echo "Commit or stash them, or re-run with FORCE_RESET=1 to discard." >&2
  exit 3
fi

say "[1/3] Checking out the previous version"
git -C "$REPO_DIR" checkout --force --detach "$target_commit"

say "[2/3] Pointing $API_REF and $WEB_REF at the previous images"
docker tag "$target_api" "$API_REF"
docker tag "$target_web" "$WEB_REF"

if [ "$restore_data" = 1 ]; then
  say "[3/3] Restoring $backup and restarting (restore-compose)"
  sh "$SCRIPT_DIR/restore-compose.sh" "$backup"
else
  say "[3/3] Restarting api + web on the previous images"
  compose up -d api caddy
  wait_for_api_health
fi

write_kv_file "$state" \
  "current_commit=$target_commit" \
  "current_release=$target_release" \
  "current_api_image=$target_api" \
  "current_web_image=$target_web" \
  "previous_commit=" \
  "previous_release=" \
  "previous_api_image=" \
  "previous_web_image=" \
  "rollback_backup=$backup" \
  "updated_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
rm -f "$attempt"

say "Rollback complete: running ${target_release:-$target_commit} again."
