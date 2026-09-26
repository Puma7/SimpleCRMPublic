import {
  WORKFLOW_CRON_MIN_INTERVAL_MINUTES,
  WORKFLOW_SCHEDULE_CATCH_UP_MINUTES,
  WORKFLOW_SCHEDULE_DEFAULT_TIME_ZONE,
  cronMatches,
  latestCronSlotAtOrBefore,
  nextCronSlotAfter,
  normalizeWorkflowScheduleTimeZone,
  parseCronExpression,
  resolveWorkflowScheduleTimeZone,
  validateWorkflowScheduleCron,
} from '../../packages/core/src/workflow';

const BERLIN = 'Europe/Berlin';
const utc = (iso: string) => new Date(iso);
const iso = (date: Date | null) => (date ? date.toISOString() : null);

function parsed(expression: string) {
  const result = parseCronExpression(expression);
  if (!result.ok) throw new Error(result.error);
  return result.cron;
}

describe('parseCronExpression', () => {
  test('expands star, lists, ranges and steps', () => {
    const cron = parsed('0-30/15,50 */6 1,15 * 1-5');
    expect([...cron.minutes].sort((a, b) => a - b)).toEqual([0, 15, 30, 50]);
    expect([...cron.hours].sort((a, b) => a - b)).toEqual([0, 6, 12, 18]);
    expect([...cron.daysOfMonth].sort((a, b) => a - b)).toEqual([1, 15]);
    expect(cron.months.size).toBe(12);
    expect([...cron.daysOfWeek].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
  });

  test('a value with a step runs to the end of the field', () => {
    expect([...parsed('5/20 * * * *').minutes]).toEqual([5, 25, 45]);
  });

  test('accepts month and weekday names in any case, also in ranges', () => {
    const cron = parsed('0 6 * jan,Jul MON-fri');
    expect([...cron.months]).toEqual([1, 7]);
    expect([...cron.daysOfWeek].sort()).toEqual([1, 2, 3, 4, 5]);
  });

  test('weekday 7 and 0 are both Sunday', () => {
    expect([...parsed('0 6 * * 7').daysOfWeek]).toEqual([0]);
    expect([...parsed('0 6 * * 0,7').daysOfWeek]).toEqual([0]);
    expect([...parsed('0 6 * * 5-7').daysOfWeek].sort()).toEqual([0, 5, 6]);
    expect([...parsed('0 6 * * */2').daysOfWeek].sort()).toEqual([0, 2, 4, 6]);
  });

  test.each([
    ['', /leer/],
    ['   ', /leer/],
    ['0 6 * *', /genau 5 Felder/],
    ['0 0 6 * * *', /Sekunden-Feld/],
    ['60 * * * *', /Ungültiger Wert „60“ im Feld Minute/],
    ['0 24 * * *', /Feld Stunde/],
    ['0 6 0 * *', /Feld Tag/],
    ['0 6 32 * *', /Feld Tag/],
    ['0 6 * 13 *', /Feld Monat/],
    ['0 6 * * 8', /Feld Wochentag/],
    ['0 6 * * FOO', /Ungültiger Wert „FOO“/],
    ['0 6 * JAN-FOO *', /Ungültiger Wert „FOO“/],
    ['30-10 * * * *', /absteigend/],
    ['*/0 * * * *', /Schrittweite/],
    ['*/60 * * * *', /Schrittweite/],
    ['0,,30 * * * *', /Leerer Listeneintrag/],
    ['0 6 ? * *', /Ungültiger Eintrag/],
    ['0 6 L * *', /Ungültiger Wert/],
    ['0 6 * * 1#2', /Ungültiger Eintrag/],
    ['*/15-5 * * * *', /Ungültiger Eintrag/],
  ])('rejects %p', (expression, message) => {
    const result = parseCronExpression(expression);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(message);
  });

  test('rejects over-long expressions', () => {
    expect(parseCronExpression(`0 6 * * ${'1,'.repeat(120)}1`).ok).toBe(false);
  });
});

describe('validateWorkflowScheduleCron', () => {
  test('uses the shared minimum interval of 15 minutes', () => {
    expect(WORKFLOW_CRON_MIN_INTERVAL_MINUTES).toBe(15);
    expect(WORKFLOW_SCHEDULE_CATCH_UP_MINUTES).toBe(15);
  });

  test.each([
    '*/15 * * * *',
    '0 6 * * 1',
    '0,45 * * * *',
    '0-45/15 8-17 * * MON-FRI',
    '30 2 * * *',
    '0 0 29 2 *',
    '0 0 29 2 MON',
    '0 0 1 1 *',
    // Codex-Review PR #194: die Luecke ueber die volle Stunde zaehlt nur bei
    // aufeinanderfolgenden aktiven Stunden (00:00 und 00:50 liegen 50 Minuten auseinander).
    '0,50 0 * * *',
    '0,50 0,2 * * *',
  ])('accepts %p', (expression) => {
    expect(validateWorkflowScheduleCron(expression)).toBeNull();
  });

  test.each([
    ['* * * * *', /Minütliche Ausführung/],
    ['*/10 * * * *', /Intervall zu kurz/],
    ['0,10 * * * *', /Intervall zu kurz/],
    ['0,50 * * * *', /über die volle Stunde/],
    ['0,50 8,9 * * *', /über die volle Stunde/],
    ['0,50 23,0 * * *', /über die volle Stunde/],
    ['0-5 * * * *', /Intervall zu kurz/],
    ['0 0 31 2 *', /trifft nie zu/],
    ['0 0 30,31 2 *', /trifft nie zu/],
    ['0 0 31 4,6,9,11 *', /trifft nie zu/],
    // Tag UND Wochentag: der Wochentag rettet ein unmoegliches Datum nicht.
    ['0 0 31 2 1', /trifft nie zu/],
    ['0 0 0 6 * *', /Sekunden-Feld/],
    ['0 6 * *', /genau 5 Felder/],
  ])('rejects %p', (expression, message) => {
    expect(validateWorkflowScheduleCron(expression)).toMatch(message);
  });
});

describe('cronMatches', () => {
  test('matches the minute a date falls into, ignoring seconds', () => {
    expect(cronMatches('15 10 * * *', utc('2026-09-26T10:15:00Z'), 'UTC')).toBe(true);
    expect(cronMatches('15 10 * * *', utc('2026-09-26T10:15:59.999Z'), 'UTC')).toBe(true);
    expect(cronMatches('15 10 * * *', utc('2026-09-26T10:16:00Z'), 'UTC')).toBe(false);
  });

  test('reads the fields as wall-clock time of the time zone', () => {
    // 06:00 in Berlin (Sommerzeit) = 04:00 UTC.
    expect(cronMatches('0 6 * * *', utc('2026-09-26T04:00:00Z'), BERLIN)).toBe(true);
    expect(cronMatches('0 6 * * *', utc('2026-09-26T06:00:00Z'), BERLIN)).toBe(false);
    // Winterzeit: 06:00 = 05:00 UTC.
    expect(cronMatches('0 6 * * *', utc('2026-12-01T05:00:00Z'), BERLIN)).toBe(true);
    // Halbe Stunden Versatz (Indien, UTC+5:30).
    expect(cronMatches('0 9 * * *', utc('2026-09-26T03:30:00Z'), 'Asia/Kolkata')).toBe(true);
  });

  test('the weekday follows the local date, not UTC', () => {
    // Montag 00:30 in Berlin ist Sonntag 22:30 UTC.
    expect(cronMatches('30 0 * * MON', utc('2026-09-27T22:30:00Z'), BERLIN)).toBe(true);
    expect(cronMatches('30 0 * * SUN', utc('2026-09-27T22:30:00Z'), BERLIN)).toBe(false);
  });

  test('weekday 7 is Sunday', () => {
    // 2026-09-27 ist ein Sonntag.
    expect(cronMatches('0 12 * * 7', utc('2026-09-27T12:00:00Z'), 'UTC')).toBe(true);
    expect(cronMatches('0 12 * * 0', utc('2026-09-27T12:00:00Z'), 'UTC')).toBe(true);
    expect(cronMatches('0 12 * * 7', utc('2026-09-28T12:00:00Z'), 'UTC')).toBe(false);
  });

  test('day of month AND weekday when both are restricted (like node-cron, unlike crontab)', () => {
    // 2026-09-28 ist ein Montag, nicht der Erste; 2026-10-01 ein Donnerstag;
    // 2027-02-01 ist ein Montag UND der Erste.
    expect(cronMatches('0 6 1 * 1', utc('2026-09-28T06:00:00Z'), 'UTC')).toBe(false);
    expect(cronMatches('0 6 1 * 1', utc('2026-10-01T06:00:00Z'), 'UTC')).toBe(false);
    expect(cronMatches('0 6 1 * 1', utc('2027-02-01T06:00:00Z'), 'UTC')).toBe(true);
  });

  test('day of month AND weekday also when one of them starts with *', () => {
    // */2 = ungerade Tage; Montag 2026-09-28 (gerade) trifft nicht, Montag 2026-10-05 (ungerade) schon.
    expect(cronMatches('0 6 */2 * 1', utc('2026-09-28T06:00:00Z'), 'UTC')).toBe(false);
    expect(cronMatches('0 6 */2 * 1', utc('2026-10-05T06:00:00Z'), 'UTC')).toBe(true);
    expect(cronMatches('0 6 */2 * 1', utc('2026-10-07T06:00:00Z'), 'UTC')).toBe(false);
  });

  test('leap day', () => {
    expect(cronMatches('0 0 29 2 *', utc('2028-02-29T00:00:00Z'), 'UTC')).toBe(true);
    expect(cronMatches('0 0 29 2 *', utc('2027-03-01T00:00:00Z'), 'UTC')).toBe(false);
  });

  test('accepts a parsed expression and throws for an invalid text', () => {
    expect(cronMatches(parsed('0 6 * * *'), utc('2026-09-26T06:00:00Z'), 'UTC')).toBe(true);
    expect(() => cronMatches('* * *', utc('2026-09-26T06:00:00Z'), 'UTC')).toThrow(/5 Felder/);
  });
});

describe('Sommer- und Winterzeit (Europe/Berlin)', () => {
  // 2026-03-29: 02:00 MEZ springt auf 03:00 MESZ (01:00 UTC).
  // 2026-10-25: 03:00 MESZ springt auf 02:00 MEZ (01:00 UTC).

  test('a time skipped when clocks move forward does not fire that day', () => {
    // 02:30 gibt es am 29.03. nicht — der naechste Termin ist 02:30 MESZ am 30.03.
    expect(iso(nextCronSlotAfter('30 2 * * *', utc('2026-03-28T23:00:00Z'), BERLIN)))
      .toBe('2026-03-30T00:30:00.000Z');
    for (let minute = 0; minute < 180; minute += 1) {
      const instant = new Date(Date.UTC(2026, 2, 29, 0, minute));
      expect(cronMatches('30 2 * * *', instant, BERLIN)).toBe(false);
    }
  });

  test('hourly schedules skip the missing hour', () => {
    const slots: string[] = [];
    let cursor = utc('2026-03-28T23:30:00Z');
    for (let index = 0; index < 3; index += 1) {
      const next = nextCronSlotAfter('0 * * * *', cursor, BERLIN)!;
      slots.push(next.toISOString());
      cursor = next;
    }
    // 01:00 MEZ, 03:00 MESZ, 04:00 MESZ — 02:00 existiert nicht.
    expect(slots).toEqual(['2026-03-29T00:00:00.000Z', '2026-03-29T01:00:00.000Z', '2026-03-29T02:00:00.000Z']);
  });

  test('a time repeated when clocks move back fires only once', () => {
    // 02:30 kommt am 25.10. zweimal vor: 00:30 UTC (MESZ) und 01:30 UTC (MEZ).
    expect(cronMatches('30 2 * * *', utc('2026-10-25T00:30:00Z'), BERLIN)).toBe(true);
    expect(cronMatches('30 2 * * *', utc('2026-10-25T01:30:00Z'), BERLIN)).toBe(false);
    expect(iso(nextCronSlotAfter('30 2 * * *', utc('2026-10-25T00:00:00Z'), BERLIN)))
      .toBe('2026-10-25T00:30:00.000Z');
    expect(iso(nextCronSlotAfter('30 2 * * *', utc('2026-10-25T00:30:00Z'), BERLIN)))
      .toBe('2026-10-26T01:30:00.000Z');
    // Der Taktgeber sieht die Wiederholung nicht als neuen Zeitpunkt.
    expect(latestCronSlotAtOrBefore('30 2 * * *', utc('2026-10-25T01:35:00Z'), BERLIN, 15)).toBeNull();
    expect(iso(latestCronSlotAtOrBefore('30 2 * * *', utc('2026-10-25T01:35:00Z'), BERLIN, 120)))
      .toBe('2026-10-25T00:30:00.000Z');
  });

  test('frequent schedules pause during the repeated hour', () => {
    const slots: string[] = [];
    let cursor = utc('2026-10-25T00:30:00Z');
    for (let index = 0; index < 3; index += 1) {
      const next = nextCronSlotAfter('*/15 * * * *', cursor, BERLIN)!;
      slots.push(next.toISOString());
      cursor = next;
    }
    // 02:45 MESZ, dann erst 03:00 MEZ — die zweite Stunde 02:xx zaehlt nicht.
    expect(slots).toEqual(['2026-10-25T00:45:00.000Z', '2026-10-25T02:00:00.000Z', '2026-10-25T02:15:00.000Z']);
  });

  test('a schedule around the transition keeps its wall-clock time', () => {
    expect(iso(nextCronSlotAfter('0 6 * * *', utc('2026-10-24T12:00:00Z'), BERLIN)))
      .toBe('2026-10-25T05:00:00.000Z');
    expect(iso(nextCronSlotAfter('0 6 * * *', utc('2026-03-28T12:00:00Z'), BERLIN)))
      .toBe('2026-03-29T04:00:00.000Z');
  });
});

describe('latestCronSlotAtOrBefore', () => {
  test('returns the due minute itself', () => {
    expect(iso(latestCronSlotAtOrBefore('0 6 * * *', utc('2026-09-26T06:00:00Z'), 'UTC', 15)))
      .toBe('2026-09-26T06:00:00.000Z');
    expect(iso(latestCronSlotAtOrBefore('0 6 * * *', utc('2026-09-26T06:00:42Z'), 'UTC', 15)))
      .toBe('2026-09-26T06:00:00.000Z');
  });

  test('catches up a slot at most lookbackMinutes old', () => {
    expect(iso(latestCronSlotAtOrBefore('0 6 * * *', utc('2026-09-26T06:15:00Z'), 'UTC', 15)))
      .toBe('2026-09-26T06:00:00.000Z');
    expect(latestCronSlotAtOrBefore('0 6 * * *', utc('2026-09-26T06:15:01Z'), 'UTC', 15)).toBeNull();
    expect(latestCronSlotAtOrBefore('0 6 * * *', utc('2026-09-26T05:59:59Z'), 'UTC', 15)).toBeNull();
  });

  test('picks the most recent of several slots', () => {
    expect(iso(latestCronSlotAtOrBefore('*/15 * * * *', utc('2026-09-26T10:44:00Z'), 'UTC', 60)))
      .toBe('2026-09-26T10:30:00.000Z');
  });

  test('the age limit is exact: without lookback only a slot at exactly now counts', () => {
    expect(iso(latestCronSlotAtOrBefore('0 6 * * *', utc('2026-09-26T06:00:00Z'), 'UTC', 0)))
      .toBe('2026-09-26T06:00:00.000Z');
    expect(latestCronSlotAtOrBefore('0 6 * * *', utc('2026-09-26T06:00:30Z'), 'UTC', 0)).toBeNull();
    expect(latestCronSlotAtOrBefore('0 6 * * *', utc('2026-09-26T06:01:00Z'), 'UTC', 0)).toBeNull();
  });
});

describe('nextCronSlotAfter', () => {
  test('is strictly after the given instant', () => {
    expect(iso(nextCronSlotAfter('0 6 * * *', utc('2026-09-26T06:00:00Z'), 'UTC')))
      .toBe('2026-09-27T06:00:00.000Z');
    expect(iso(nextCronSlotAfter('0 6 * * *', utc('2026-09-26T05:59:59Z'), 'UTC')))
      .toBe('2026-09-26T06:00:00.000Z');
  });

  test('finds the next weekday and month', () => {
    // Samstag 2026-09-26 -> Montag 2026-09-28 06:00 Berlin (04:00 UTC).
    expect(iso(nextCronSlotAfter('0 6 * * 1', utc('2026-09-26T10:00:00Z'), BERLIN)))
      .toBe('2026-09-28T04:00:00.000Z');
    expect(iso(nextCronSlotAfter('0 0 1 JAN *', utc('2026-09-26T10:00:00Z'), 'UTC')))
      .toBe('2027-01-01T00:00:00.000Z');
    expect(iso(nextCronSlotAfter('0 12 * * 7', utc('2026-09-26T10:00:00Z'), 'UTC')))
      .toBe('2026-09-27T12:00:00.000Z');
  });

  test('walks to the next leap day', () => {
    expect(iso(nextCronSlotAfter('0 0 29 2 *', utc('2026-09-26T10:00:00Z'), 'UTC')))
      .toBe('2028-02-29T00:00:00.000Z');
    // 2100 ist kein Schaltjahr: nach 2096 kommt erst 2104.
    expect(iso(nextCronSlotAfter('0 0 29 2 *', utc('2096-03-01T00:00:00Z'), 'UTC')))
      .toBe('2104-02-29T00:00:00.000Z');
  });

  test('returns null for a schedule that never fires', () => {
    expect(nextCronSlotAfter('0 0 31 2 *', utc('2026-09-26T10:00:00Z'), 'UTC')).toBeNull();
  });

  test('needs day of month and weekday together', () => {
    // Nach Samstag 2026-09-26 ist der naechste Montag, der auf den Ersten faellt, der 01.02.2027.
    expect(iso(nextCronSlotAfter('0 6 1 * 1', utc('2026-09-26T10:00:00Z'), 'UTC')))
      .toBe('2027-02-01T06:00:00.000Z');
    // Der 29. Februar an einem Montag: erst 2044.
    expect(iso(nextCronSlotAfter('0 0 29 2 MON', utc('2026-09-26T10:00:00Z'), 'UTC')))
      .toBe('2044-02-29T00:00:00.000Z');
  });
});

describe('workflow schedule time zone', () => {
  test('defaults to Europe/Berlin', () => {
    expect(WORKFLOW_SCHEDULE_DEFAULT_TIME_ZONE).toBe('Europe/Berlin');
    expect(resolveWorkflowScheduleTimeZone(null)).toBe('Europe/Berlin');
    expect(resolveWorkflowScheduleTimeZone('Mars/Olympus')).toBe('Europe/Berlin');
    expect(resolveWorkflowScheduleTimeZone('America/New_York')).toBe('America/New_York');
  });

  test('accepts IANA names only and returns the canonical spelling', () => {
    expect(normalizeWorkflowScheduleTimeZone('Europe/Berlin')).toBe('Europe/Berlin');
    expect(normalizeWorkflowScheduleTimeZone(' europe/berlin ')).toBe('Europe/Berlin');
    expect(normalizeWorkflowScheduleTimeZone('UTC')).toBe('UTC');
    expect(normalizeWorkflowScheduleTimeZone('Mars/Olympus')).toBeNull();
    expect(normalizeWorkflowScheduleTimeZone('+01:00')).toBeNull();
    expect(normalizeWorkflowScheduleTimeZone('')).toBeNull();
    expect(normalizeWorkflowScheduleTimeZone(42)).toBeNull();
    expect(normalizeWorkflowScheduleTimeZone(`Europe/${'x'.repeat(80)}`)).toBeNull();
  });
});
