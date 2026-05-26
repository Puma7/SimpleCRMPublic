/** Configurable default times for snooze presets (E-Mail + Nachverfolgung). */

export type SnoozePresetId = 'tonight' | 'tomorrow' | 'next_week';

export type SnoozeSettings = {
  /** Hour 0–23 for „Heute Abend“. */
  eveningHour: number;
  eveningMinute: number;
  /** Hour 0–23 for „Morgen“. */
  morningHour: number;
  morningMinute: number;
  /** Weekday for „Nächste Woche“ (0 = Sunday … 6 = Saturday). Default Monday = 1. */
  nextWeekWeekday: number;
  nextWeekHour: number;
  nextWeekMinute: number;
};

export const DEFAULT_SNOOZE_SETTINGS: SnoozeSettings = {
  eveningHour: 18,
  eveningMinute: 0,
  morningHour: 9,
  morningMinute: 0,
  nextWeekWeekday: 1,
  nextWeekHour: 9,
  nextWeekMinute: 0,
};

const SYNC_KEY = 'snooze_default_times_v1';

export function snoozeSettingsSyncKey(): string {
  return SYNC_KEY;
}

function clampHour(h: number): number {
  if (!Number.isFinite(h)) return 0;
  return Math.min(23, Math.max(0, Math.floor(h)));
}

function clampMinute(m: number): number {
  if (!Number.isFinite(m)) return 0;
  return Math.min(59, Math.max(0, Math.floor(m)));
}

function clampWeekday(w: number): number {
  if (!Number.isFinite(w)) return 1;
  return Math.min(6, Math.max(0, Math.floor(w)));
}

export function parseSnoozeSettingsJson(raw: string | null | undefined): SnoozeSettings {
  if (!raw?.trim()) return { ...DEFAULT_SNOOZE_SETTINGS };
  try {
    const o = JSON.parse(raw) as Partial<SnoozeSettings>;
    return {
      eveningHour: clampHour(o.eveningHour ?? DEFAULT_SNOOZE_SETTINGS.eveningHour),
      eveningMinute: clampMinute(o.eveningMinute ?? DEFAULT_SNOOZE_SETTINGS.eveningMinute),
      morningHour: clampHour(o.morningHour ?? DEFAULT_SNOOZE_SETTINGS.morningHour),
      morningMinute: clampMinute(o.morningMinute ?? DEFAULT_SNOOZE_SETTINGS.morningMinute),
      nextWeekWeekday: clampWeekday(o.nextWeekWeekday ?? DEFAULT_SNOOZE_SETTINGS.nextWeekWeekday),
      nextWeekHour: clampHour(o.nextWeekHour ?? DEFAULT_SNOOZE_SETTINGS.nextWeekHour),
      nextWeekMinute: clampMinute(o.nextWeekMinute ?? DEFAULT_SNOOZE_SETTINGS.nextWeekMinute),
    };
  } catch {
    return { ...DEFAULT_SNOOZE_SETTINGS };
  }
}

export function serializeSnoozeSettings(settings: SnoozeSettings): string {
  return JSON.stringify({
    eveningHour: clampHour(settings.eveningHour),
    eveningMinute: clampMinute(settings.eveningMinute),
    morningHour: clampHour(settings.morningHour),
    morningMinute: clampMinute(settings.morningMinute),
    nextWeekWeekday: clampWeekday(settings.nextWeekWeekday),
    nextWeekHour: clampHour(settings.nextWeekHour),
    nextWeekMinute: clampMinute(settings.nextWeekMinute),
  });
}
