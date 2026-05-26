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

/** `datetime-local` value (YYYY-MM-DDTHH:mm) for a future wake time. */
export function defaultCustomSnoozeLocalValue(
  now: Date = new Date(),
  minutesAhead = 60,
): string {
  const d = new Date(now.getTime() + minutesAhead * 60 * 1000);
  return toDatetimeLocalValue(d);
}

/** Minimum allowed `datetime-local` value (now, minute precision). */
export function minCustomSnoozeLocalValue(now: Date = new Date()): string {
  return toDatetimeLocalValue(now);
}

function toDatetimeLocalValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Parse browser `datetime-local` input to ISO UTC for storage. */
export function parseLocalDatetimeInput(value: string): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const d = new Date(trimmed);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

export function validateSnoozeUntil(
  iso: string,
  now: Date = new Date(),
): { ok: true } | { ok: false; message: string } {
  const wake = new Date(iso);
  if (Number.isNaN(wake.getTime())) {
    return { ok: false, message: 'Ungültiges Datum.' };
  }
  if (wake.getTime() <= now.getTime() + 30_000) {
    return { ok: false, message: 'Der Zeitpunkt muss in der Zukunft liegen.' };
  }
  return { ok: true };
}

export function formatSnoozeWakeLabel(iso: string, locale = 'de-DE'): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(locale, {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

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
