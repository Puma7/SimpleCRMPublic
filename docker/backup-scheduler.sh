#!/bin/sh
set -eu

BACKUP_INTERVAL_SECONDS="${BACKUP_INTERVAL_SECONDS:-86400}"
BACKUP_RUN_ON_START="${BACKUP_RUN_ON_START:-true}"

case "$BACKUP_INTERVAL_SECONDS" in
  ''|*[!0-9]*)
    echo "BACKUP_INTERVAL_SECONDS must be a positive integer" >&2
    exit 2
    ;;
esac

if [ "$BACKUP_INTERVAL_SECONDS" -le 0 ]; then
  echo "BACKUP_INTERVAL_SECONDS must be greater than zero" >&2
  exit 2
fi

run_backup() {
  echo "starting scheduled backup at $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  sh /app/backup.sh
  echo "finished scheduled backup at $(date -u +%Y-%m-%dT%H:%M:%SZ)"
}

if [ "$BACKUP_RUN_ON_START" = "true" ]; then
  run_backup
fi

while :; do
  sleep "$BACKUP_INTERVAL_SECONDS"
  run_backup
done
