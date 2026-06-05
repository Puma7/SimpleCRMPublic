#!/bin/sh
set -eu

BACKUP_RETENTION_DAILY="${BACKUP_RETENTION_DAILY:-7}"
BACKUP_RETENTION_WEEKLY="${BACKUP_RETENTION_WEEKLY:-4}"
BACKUP_RETENTION_MONTHLY="${BACKUP_RETENTION_MONTHLY:-12}"

validate_retention_count() {
  name="$1"
  value="$2"

  case "$value" in
    ''|*[!0-9]*)
      echo "$name must be a non-negative integer" >&2
      exit 2
      ;;
  esac
}

select_retained_backup_stamps() {
  backup_dir="$1"
  daily="$2"
  weekly="$3"
  monthly="$4"

  for path in "$backup_dir"/db-*.dump; do
    [ -e "$path" ] || continue
    basename "$path"
  done | sort -r | awk -v daily="$daily" -v weekly="$weekly" -v monthly="$monthly" '
    function days_from_civil(y, m, d, era, yoe, doy, doe) {
      y -= (m <= 2)
      era = int((y >= 0 ? y : y - 399) / 400)
      yoe = y - era * 400
      doy = int((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1
      doe = yoe * 365 + int(yoe / 4) - int(yoe / 100) + doy
      return era * 146097 + doe - 719468
    }

    function retain(stamp, day, week, month) {
      kept_day[day] = 1
      kept_week[week] = 1
      kept_month[month] = 1
      print stamp
    }

    /^db-[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]-[0-9][0-9]-[0-9][0-9]Z\.dump$/ {
      stamp = $0
      sub(/^db-/, "", stamp)
      sub(/\.dump$/, "", stamp)
      day = substr(stamp, 1, 10)
      month = substr(stamp, 1, 7)
      year = substr(stamp, 1, 4) + 0
      month_number = substr(stamp, 6, 2) + 0
      day_number = substr(stamp, 9, 2) + 0
      week = int((days_from_civil(year, month_number, day_number) + 3) / 7)

      if (daily_count < daily && !(day in kept_day)) {
        daily_count++
        retain(stamp, day, week, month)
        next
      }

      if (weekly_count < weekly && !(week in kept_week)) {
        weekly_count++
        retain(stamp, day, week, month)
        next
      }

      if (monthly_count < monthly && !(month in kept_month)) {
        monthly_count++
        retain(stamp, day, week, month)
      }
    }
  '
}

stamp_is_retained() {
  stamp="$1"
  keep_stamps="$2"

  printf '%s\n' "$keep_stamps" | grep -Fx "$stamp" >/dev/null
}

remove_backup_set() {
  backup_dir="$1"
  stamp="$2"

  rm -f \
    "$backup_dir/db-$stamp.dump" \
    "$backup_dir/attachments-$stamp.tar" \
    "$backup_dir/audit-archive-$stamp.tar" \
    "$backup_dir/backup-$stamp.sha256"
}

remove_orphan_backup_file() {
  backup_dir="$1"
  path="$2"
  file_name="$(basename "$path")"

  case "$file_name" in
    attachments-*.tar)
      stamp="${file_name#attachments-}"
      stamp="${stamp%.tar}"
      ;;
    audit-archive-*.tar)
      stamp="${file_name#audit-archive-}"
      stamp="${stamp%.tar}"
      ;;
    backup-*.sha256)
      stamp="${file_name#backup-}"
      stamp="${stamp%.sha256}"
      ;;
    *)
      return
      ;;
  esac

  if [ ! -f "$backup_dir/db-$stamp.dump" ]; then
    rm -f "$path"
  fi
}

prune_backup_retention() {
  backup_dir="$1"

  validate_retention_count BACKUP_RETENTION_DAILY "$BACKUP_RETENTION_DAILY"
  validate_retention_count BACKUP_RETENTION_WEEKLY "$BACKUP_RETENTION_WEEKLY"
  validate_retention_count BACKUP_RETENTION_MONTHLY "$BACKUP_RETENTION_MONTHLY"

  keep_stamps="$(select_retained_backup_stamps "$backup_dir" "$BACKUP_RETENTION_DAILY" "$BACKUP_RETENTION_WEEKLY" "$BACKUP_RETENTION_MONTHLY")"

  for path in "$backup_dir"/db-*.dump; do
    [ -e "$path" ] || continue
    file_name="$(basename "$path")"
    stamp="${file_name#db-}"
    stamp="${stamp%.dump}"

    if ! stamp_is_retained "$stamp" "$keep_stamps"; then
      remove_backup_set "$backup_dir" "$stamp"
    fi
  done

  for path in "$backup_dir"/attachments-*.tar "$backup_dir"/audit-archive-*.tar "$backup_dir"/backup-*.sha256; do
    [ -e "$path" ] || continue
    remove_orphan_backup_file "$backup_dir" "$path"
  done
}
