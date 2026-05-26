import {
  DEFAULT_SNOOZE_SETTINGS,
  type SnoozePresetId,
  type SnoozeSettings,
} from './snooze-settings';

function atLocalTime(base: Date, hour: number, minute: number): Date {
  const d = new Date(base);
  d.setHours(hour, minute, 0, 0);
  return d;
}

function nextWeekday(from: Date, targetWeekday: number, hour: number, minute: number): Date {
  const d = new Date(from);
  const current = d.getDay();
  let daysAhead = (targetWeekday - current + 7) % 7;
  if (daysAhead === 0) {
    const candidate = atLocalTime(d, hour, minute);
    if (candidate <= from) daysAhead = 7;
  }
  d.setDate(d.getDate() + daysAhead);
  return atLocalTime(d, hour, minute);
}

/** Compute ISO timestamp for a snooze preset using configured default times. */
export function computeSnoozeUntil(
  preset: SnoozePresetId,
  settings: SnoozeSettings = DEFAULT_SNOOZE_SETTINGS,
  now: Date = new Date(),
): string {
  switch (preset) {
    case 'tonight': {
      let tonight = atLocalTime(now, settings.eveningHour, settings.eveningMinute);
      if (tonight <= now) {
        tonight = atLocalTime(
          new Date(now.getTime() + 24 * 60 * 60 * 1000),
          settings.eveningHour,
          settings.eveningMinute,
        );
      }
      return tonight.toISOString();
    }
    case 'tomorrow': {
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      return atLocalTime(tomorrow, settings.morningHour, settings.morningMinute).toISOString();
    }
    case 'next_week':
      return nextWeekday(
        now,
        settings.nextWeekWeekday,
        settings.nextWeekHour,
        settings.nextWeekMinute,
      ).toISOString();
    default:
      return new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
  }
}

const WEEKDAY_LABELS = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];

export function formatSnoozePresetLabel(
  preset: SnoozePresetId,
  settings: SnoozeSettings = DEFAULT_SNOOZE_SETTINGS,
): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  switch (preset) {
    case 'tonight':
      return `Heute Abend (${pad(settings.eveningHour)}:${pad(settings.eveningMinute)})`;
    case 'tomorrow':
      return `Morgen (${pad(settings.morningHour)}:${pad(settings.morningMinute)})`;
    case 'next_week':
      return `Nächste Woche (${WEEKDAY_LABELS[settings.nextWeekWeekday] ?? 'Mo'} ${pad(settings.nextWeekHour)}:${pad(settings.nextWeekMinute)})`;
    default:
      return preset;
  }
}
