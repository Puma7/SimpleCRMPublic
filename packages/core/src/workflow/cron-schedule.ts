/**
 * Cron-Zeitplaene fuer Workflows — rein, ohne Abhaengigkeiten.
 *
 * Der Desktop plant Zeitplan-Workflows mit node-cron im Main-Prozess. Der
 * Server hat keinen solchen Dauer-Prozess je Workflow, sondern einen
 * Minutentakt (jobs/workflow-schedule-tick.ts), der fuer jeden aktiven
 * Zeitplan-Workflow fragt: welcher faellige Zeitpunkt liegt zuletzt vor
 * „jetzt"? Genau diese Frage beantwortet dieses Modul, dazu die Anzeige
 * „naechste Ausfuehrung" im Editor und die Pruefung beim Speichern.
 *
 * Format: fuenf Felder `Minute Stunde Tag Monat Wochentag` mit `*`, Listen
 * (`1,15`), Bereichen (`1-5`), Schritten (`*\/15`, `0-30/10`, `5/20`) sowie
 * Monats- und Tagesnamen (`JAN`, `MON-FRI`). Wochentag 0 und 7 sind Sonntag.
 * Sekunden (6 Felder), `?`, `L`, `W` und `#` kennt nur der Desktop (node-cron).
 *
 * Tag-des-Monats und Wochentag muessen BEIDE passen (`0 6 1 * 1` = nur ein
 * Montag, der auf den Ersten faellt) — wie node-cron 4 auf dem Desktop, damit
 * ein exportierter Workflow in beiden Editionen zu denselben Zeiten laeuft.
 * Das klassische Unix-crontab laesst dort eines von beiden genuegen; siehe
 * docs/USER_GUIDE_WORKFLOWS.md.
 *
 * Zeitzone: Felder werden als Wanduhrzeit in einer IANA-Zeitzone gelesen
 * (Intl.DateTimeFormat). Beim Vorstellen der Uhr (Sommerzeit) gibt es die
 * uebersprungenen Uhrzeiten nicht — sie fallen aus. Beim Zurueckstellen gibt
 * es eine Uhrzeit zweimal — sie zaehlt nur beim ersten Mal.
 */

/** Mindestabstand zweier Ausfuehrungen eines Zeitplan-Workflows (Desktop und Server). */
export const WORKFLOW_CRON_MIN_INTERVAL_MINUTES = 15;
/** Zeitzone eines Workspaces, solange niemand eine andere einstellt (nur Server). */
export const WORKFLOW_SCHEDULE_DEFAULT_TIME_ZONE = 'Europe/Berlin';
/**
 * So weit holt der Server-Taktgeber einen verpassten Zeitpunkt nach (Server
 * war aus, Takt verspaetet). Aeltere Zeitpunkte verfallen.
 */
export const WORKFLOW_SCHEDULE_CATCH_UP_MINUTES = 15;

export type ParsedCronExpression = Readonly<{
  /** Der getrimmte Ausdruck. */
  source: string;
  minutes: ReadonlySet<number>;
  hours: ReadonlySet<number>;
  daysOfMonth: ReadonlySet<number>;
  months: ReadonlySet<number>;
  /** 0 = Sonntag … 6 = Samstag (7 ist bereits auf 0 abgebildet). */
  daysOfWeek: ReadonlySet<number>;
}>;

export type CronParseResult =
  | Readonly<{ ok: true; cron: ParsedCronExpression }>
  | Readonly<{ ok: false; error: string }>;

type CronFieldSpec = Readonly<{
  label: string;
  min: number;
  max: number;
  /** Obergrenze fuer `*` (Wochentag: 0–6, obwohl 7 als Wert erlaubt ist). */
  starMax: number;
  names?: Readonly<Record<string, number>>;
}>;

const MONTH_NAMES: Readonly<Record<string, number>> = {
  JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6,
  JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12,
};
const WEEKDAY_NAMES: Readonly<Record<string, number>> = {
  SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6,
};

const CRON_FIELDS: readonly CronFieldSpec[] = [
  { label: 'Minute', min: 0, max: 59, starMax: 59 },
  { label: 'Stunde', min: 0, max: 23, starMax: 23 },
  { label: 'Tag', min: 1, max: 31, starMax: 31 },
  { label: 'Monat', min: 1, max: 12, starMax: 12, names: MONTH_NAMES },
  { label: 'Wochentag', min: 0, max: 7, starMax: 6, names: WEEKDAY_NAMES },
];

const MAX_CRON_EXPRESSION_LENGTH = 200;
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
/** Groesster Zeitzonen-Versatz (Kiribati +14 h) — Suchfenster fuer Wanduhrzeiten. */
const MAX_ZONE_OFFSET_MS = 14 * HOUR_MS;
/** Laengster angenommener Uhr-Ruecksprung; reale Zonen springen hoechstens 2 h. */
const MAX_FOLD_MS = 3 * HOUR_MS;
/**
 * Suchfenster fuer den naechsten Termin. Der 29. Februar an einem bestimmten
 * Wochentag kommt nur alle 28 Jahre (ueber Jahrhundertgrenzen bis zu 40)
 * vor; die Suche laeuft tageweise und prueft Uhrzeiten nur an passenden Tagen.
 */
const DEFAULT_NEXT_SLOT_HORIZON_DAYS = 366 * 40;

export function parseCronExpression(expression: string): CronParseResult {
  const source = typeof expression === 'string' ? expression.trim() : '';
  if (!source) return { ok: false, error: 'Cron-Ausdruck ist leer' };
  if (source.length > MAX_CRON_EXPRESSION_LENGTH) {
    return { ok: false, error: `Cron-Ausdruck ist zu lang (max. ${MAX_CRON_EXPRESSION_LENGTH} Zeichen)` };
  }
  const parts = source.split(/\s+/);
  if (parts.length === 6) {
    return {
      ok: false,
      error: 'Sekunden-Feld wird nicht unterstützt — bitte 5 Felder verwenden (Minute Stunde Tag Monat Wochentag)',
    };
  }
  if (parts.length !== 5) {
    return {
      ok: false,
      error: 'Cron muss genau 5 Felder haben (Minute Stunde Tag Monat Wochentag), z. B. „0 6 * * 1“',
    };
  }

  const sets: Set<number>[] = [];
  for (let index = 0; index < CRON_FIELDS.length; index += 1) {
    const parsed = parseCronField(parts[index]!, CRON_FIELDS[index]!);
    if (typeof parsed === 'string') return { ok: false, error: parsed };
    sets.push(parsed);
  }
  const daysOfWeek = new Set<number>();
  for (const value of sets[4]!) daysOfWeek.add(value === 7 ? 0 : value);

  return {
    ok: true,
    cron: {
      source,
      minutes: sets[0]!,
      hours: sets[1]!,
      daysOfMonth: sets[2]!,
      months: sets[3]!,
      daysOfWeek,
    },
  };
}

function parseCronField(raw: string, spec: CronFieldSpec): Set<number> | string {
  const values = new Set<number>();
  for (const item of raw.split(',')) {
    if (!item) return `Leerer Listeneintrag im Feld ${spec.label}`;
    const match = /^(\*|[A-Za-z0-9]+(?:-[A-Za-z0-9]+)?)(?:\/([0-9]+))?$/.exec(item);
    if (!match) return `Ungültiger Eintrag „${item}“ im Feld ${spec.label}`;
    const base = match[1]!;
    let low: number;
    let high: number;
    if (base === '*') {
      low = spec.min;
      high = spec.starMax;
    } else if (base.includes('-')) {
      const [rawLow, rawHigh] = base.split('-') as [string, string];
      const parsedLow = parseCronValue(rawLow, spec);
      if (typeof parsedLow === 'string') return parsedLow;
      const parsedHigh = parseCronValue(rawHigh, spec);
      if (typeof parsedHigh === 'string') return parsedHigh;
      if (parsedLow > parsedHigh) {
        return `Bereich „${base}“ im Feld ${spec.label} ist absteigend`;
      }
      low = parsedLow;
      high = parsedHigh;
    } else {
      const value = parseCronValue(base, spec);
      if (typeof value === 'string') return value;
      low = value;
      // `5/20` = ab 5 in Zwanzigerschritten bis zum Feldende.
      high = match[2] === undefined ? value : spec.starMax;
      if (high < low) high = low;
    }

    let step = 1;
    if (match[2] !== undefined) {
      step = Number.parseInt(match[2], 10);
      if (!Number.isSafeInteger(step) || step < 1 || step > spec.max) {
        return `Schrittweite „${match[2]}“ im Feld ${spec.label} ist ungültig (1–${spec.max})`;
      }
    }
    for (let value = low; value <= high; value += step) values.add(value);
  }
  return values;
}

function parseCronValue(raw: string, spec: CronFieldSpec): number | string {
  let value: number | undefined;
  if (/^[0-9]+$/.test(raw)) {
    value = Number.parseInt(raw, 10);
  } else if (spec.names) {
    value = spec.names[raw.toUpperCase()];
  }
  if (value === undefined || !Number.isSafeInteger(value) || value < spec.min || value > spec.max) {
    return `Ungültiger Wert „${raw}“ im Feld ${spec.label} (erlaubt ${spec.min}–${spec.max})`;
  }
  return value;
}

/**
 * Pruefung eines Zeitplans fuer die Server-Edition (Speichern und Editor im
 * Server-Modus): gueltige 5 Felder, Mindestabstand von
 * WORKFLOW_CRON_MIN_INTERVAL_MINUTES Minuten und mindestens ein moeglicher
 * Termin. Gibt null oder eine deutsche Fehlermeldung zurueck.
 *
 * Der Abstand ergibt sich aus dem Minutenfeld: innerhalb einer Stunde die
 * Luecken zwischen den Minutenwerten; die Luecke vom letzten zum ersten
 * Minutenwert nur dann, wenn zwei aufeinanderfolgende Stunden aktiv sind.
 * `0,50 0 * * *` laeuft um 00:00 und 00:50 und ist damit erlaubt. 23 → 0
 * zaehlt nur, wenn auch zwei aufeinanderfolgende Kalendertage passen
 * (`0,50 0,23 * * MON` laeuft montags 23:50 und erst eine Woche spaeter
 * wieder um 00:00).
 */
export function validateWorkflowScheduleCron(expression: string): string | null {
  const parsed = parseCronExpression(expression);
  if (!parsed.ok) return parsed.error;
  const minInterval = WORKFLOW_CRON_MIN_INTERVAL_MINUTES;
  const minutes = [...parsed.cron.minutes].sort((a, b) => a - b);
  if (minutes.length === 60) {
    return `Minütliche Ausführung ist nicht erlaubt (Minimum: ${minInterval} Minuten)`;
  }
  if (minutes.length > 1) {
    for (let index = 1; index < minutes.length; index += 1) {
      if (minutes[index]! - minutes[index - 1]! < minInterval) {
        return `Intervall zu kurz — mindestens alle ${minInterval} Minuten`;
      }
    }
    const hours = parsed.cron.hours;
    const consecutiveHours = [...hours].some((hour) => hour < 23 && hours.has(hour + 1))
      || (hours.has(23) && hours.has(0) && cronMatchesConsecutiveDays(parsed.cron));
    if (consecutiveHours && minutes[0]! + 60 - minutes[minutes.length - 1]! < minInterval) {
      return `Intervall zu kurz — mindestens alle ${minInterval} Minuten (auch über die volle Stunde)`;
    }
  }
  if (!cronCanEverMatch(parsed.cron)) {
    return 'Dieser Zeitplan trifft nie zu (z. B. 31. Februar)';
  }
  return null;
}

const DAYS_IN_MONTH_MAX = [0, 31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

/**
 * Passen zwei aufeinanderfolgende Kalendertage beide (Tag des Monats UND
 * Wochentag, wie node-cron)? Jeder Tageswechsel — auch 28.2. → 29.2. und
 * 28.2. → 1.3. — kommt im 400-Jahre-Zyklus mit jedem Wochentag vor; Datum
 * und Wochentag lassen sich deshalb getrennt pruefen.
 */
function cronMatchesConsecutiveDays(cron: ParsedCronExpression): boolean {
  const weekdays = cron.daysOfWeek;
  if (![...weekdays].some((day) => weekdays.has((day + 1) % 7))) return false;
  const matches = (month: number, day: number) => cron.months.has(month) && cron.daysOfMonth.has(day);
  for (let month = 1; month <= 12; month += 1) {
    const lastDay = DAYS_IN_MONTH_MAX[month]!;
    for (let day = 1; day <= lastDay; day += 1) {
      if (!matches(month, day)) continue;
      if (day < lastDay && matches(month, day + 1)) return true;
      if (day === lastDay && matches((month % 12) + 1, 1)) return true;
      // Februar ohne Schalttag.
      if (month === 2 && day === 28 && matches(3, 1)) return true;
    }
  }
  return false;
}

function cronCanEverMatch(cron: ParsedCronExpression): boolean {
  // Jedes Datum faellt irgendwann auf jeden Wochentag (auch der 29. Februar im
  // 400-Jahre-Zyklus); entscheidend ist nur, ob der Tag des Monats in einem
  // der Monate vorkommt.
  for (const month of cron.months) {
    for (const day of cron.daysOfMonth) {
      if (day <= DAYS_IN_MONTH_MAX[month]!) return true;
    }
  }
  return false;
}

/** true, wenn der Wert eine gueltige IANA-Zeitzone ist; liefert die kanonische Schreibweise. */
export function normalizeWorkflowScheduleTimeZone(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  // Nur benannte Zonen: Intl nimmt auch feste Versaetze wie „+01:00“ an, die
  // aber keine Sommerzeit kennen und im Workspace nur verwirren.
  if (!trimmed || trimmed.length > 64 || !/^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+){0,3}$/.test(trimmed)) {
    return null;
  }
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: trimmed }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

/** Gespeicherte Workspace-Zeitzone oder der Standard, wenn nichts (Gueltiges) gesetzt ist. */
export function resolveWorkflowScheduleTimeZone(value: unknown): string {
  return normalizeWorkflowScheduleTimeZone(value) ?? WORKFLOW_SCHEDULE_DEFAULT_TIME_ZONE;
}

/**
 * Trifft der Zeitplan die Minute, in der `date` liegt? Die zweite Haelfte
 * einer doppelten Stunde (Zurueckstellen der Uhr) zaehlt nicht.
 * Ein ungueltiger Ausdruck als Text wirft einen Fehler.
 */
export function cronMatches(
  spec: string | ParsedCronExpression,
  date: Date,
  timeZone: string,
): boolean {
  return cronMatchesAt(resolveCron(spec), floorToMinute(date.getTime()), timeZone);
}

/**
 * Letzter faelliger Zeitpunkt <= `now`, der hoechstens `lookbackMinutes`
 * zurueckliegt — oder null. Der Server-Taktgeber loest genau diesen einen
 * Zeitpunkt aus; aeltere verfallen.
 */
export function latestCronSlotAtOrBefore(
  spec: string | ParsedCronExpression,
  now: Date,
  timeZone: string,
  lookbackMinutes: number,
): Date | null {
  const cron = resolveCron(spec);
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) return null;
  const lookback = Number.isFinite(lookbackMinutes) ? Math.max(0, Math.floor(lookbackMinutes)) : 0;
  const earliest = nowMs - lookback * MINUTE_MS;
  for (let instant = floorToMinute(nowMs); instant >= earliest; instant -= MINUTE_MS) {
    if (cronMatchesAt(cron, instant, timeZone)) return new Date(instant);
  }
  return null;
}

/** Naechster faelliger Zeitpunkt strikt nach `after` — oder null, wenn keiner absehbar ist. */
export function nextCronSlotAfter(
  spec: string | ParsedCronExpression,
  after: Date,
  timeZone: string,
  horizonDays: number = DEFAULT_NEXT_SLOT_HORIZON_DAYS,
): Date | null {
  const cron = resolveCron(spec);
  const afterMs = after.getTime();
  if (!Number.isFinite(afterMs)) return null;
  const hours = [...cron.hours].sort((a, b) => a - b);
  const minutes = [...cron.minutes].sort((a, b) => a - b);
  const startWall = wallClockMs(zonedParts(floorToMinute(afterMs), timeZone));
  // Einen Tag frueher beginnen: nach einem Ruecksprung kann der naechste
  // Zeitpunkt auf einer Wanduhrzeit vor der aktuellen liegen.
  let dayStart = Math.floor(startWall / DAY_MS) * DAY_MS - DAY_MS;
  const days = Math.max(1, Math.floor(horizonDays)) + 2;
  for (let index = 0; index < days; index += 1, dayStart += DAY_MS) {
    const day = new Date(dayStart);
    if (!cron.months.has(day.getUTCMonth() + 1)) continue;
    if (!cronDayMatches(cron, day.getUTCDate(), day.getUTCDay())) continue;
    for (const hour of hours) {
      for (const minute of minutes) {
        const wall = dayStart + hour * HOUR_MS + minute * MINUTE_MS;
        // Wanduhrzeiten weit vor der aktuellen koennen nicht mehr kommen.
        if (wall < startWall - MAX_FOLD_MS) continue;
        const instants = instantsForWallClock(wall, timeZone);
        const first = instants[0];
        if (first !== undefined && first > afterMs) return new Date(first);
      }
    }
  }
  return null;
}

function resolveCron(spec: string | ParsedCronExpression): ParsedCronExpression {
  if (typeof spec !== 'string') return spec;
  const parsed = parseCronExpression(spec);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.cron;
}

/** Tag UND Wochentag — wie node-cron 4 (TimeMatcher.match), nicht wie Unix-crontab. */
function cronDayMatches(cron: ParsedCronExpression, dayOfMonth: number, dayOfWeek: number): boolean {
  return cron.daysOfMonth.has(dayOfMonth) && cron.daysOfWeek.has(dayOfWeek);
}

function cronMatchesAt(cron: ParsedCronExpression, instant: number, timeZone: string): boolean {
  const parts = zonedParts(instant, timeZone);
  if (!cron.minutes.has(parts.minute) || !cron.hours.has(parts.hour)) return false;
  if (!cron.months.has(parts.month)) return false;
  const wall = wallClockMs(parts);
  if (!cronDayMatches(cron, parts.day, new Date(wall).getUTCDay())) return false;
  // Doppelte Wanduhrzeit (Zurueckstellen): nur das erste Vorkommen zaehlt.
  return instantsForWallClock(wall, timeZone)[0] === instant;
}

type ZonedParts = Readonly<{
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}>;

const zoneFormatters = new Map<string, Intl.DateTimeFormat>();

function zoneFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = zoneFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
    });
    // Die Zahl der Zonen ist endlich, trotzdem nicht unbegrenzt cachen.
    if (zoneFormatters.size > 500) zoneFormatters.clear();
    zoneFormatters.set(timeZone, formatter);
  }
  return formatter;
}

function zonedParts(instant: number, timeZone: string): ZonedParts {
  let year = 0;
  let month = 0;
  let day = 0;
  let hour = 0;
  let minute = 0;
  for (const part of zoneFormatter(timeZone).formatToParts(new Date(instant))) {
    if (part.type === 'year') year = Number.parseInt(part.value, 10);
    else if (part.type === 'month') month = Number.parseInt(part.value, 10);
    else if (part.type === 'day') day = Number.parseInt(part.value, 10);
    else if (part.type === 'hour') hour = Number.parseInt(part.value, 10) % 24;
    else if (part.type === 'minute') minute = Number.parseInt(part.value, 10);
  }
  return { year, month, day, hour, minute };
}

/** Wanduhrzeit als Millisekunden „als waere sie UTC" — nur zum Rechnen und Vergleichen. */
function wallClockMs(parts: ZonedParts): number {
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
}

function zoneOffsetMs(instant: number, timeZone: string): number {
  const minuteInstant = floorToMinute(instant);
  return wallClockMs(zonedParts(minuteInstant, timeZone)) - minuteInstant;
}

/**
 * Alle Zeitpunkte, zu denen die Uhr in der Zone `wall` zeigt, aufsteigend:
 * leer in der Luecke beim Vorstellen, zwei beim Zurueckstellen, sonst einer.
 * Der wahre Zeitpunkt liegt hoechstens 14 h neben der Wanduhrzeit; innerhalb
 * dieses Fensters gibt es hoechstens einen Zonenwechsel, also hoechstens zwei
 * Versaetze als Kandidaten.
 */
function instantsForWallClock(wall: number, timeZone: string): number[] {
  const offsetBefore = zoneOffsetMs(wall - MAX_ZONE_OFFSET_MS, timeZone);
  const offsetAfter = zoneOffsetMs(wall + MAX_ZONE_OFFSET_MS, timeZone);
  if (offsetBefore === offsetAfter) return [wall - offsetBefore];
  const instants: number[] = [];
  for (const offset of [offsetBefore, offsetAfter]) {
    const candidate = wall - offset;
    if (wallClockMs(zonedParts(candidate, timeZone)) === wall && !instants.includes(candidate)) {
      instants.push(candidate);
    }
  }
  return instants.sort((a, b) => a - b);
}

function floorToMinute(ms: number): number {
  return Math.floor(ms / MINUTE_MS) * MINUTE_MS;
}
