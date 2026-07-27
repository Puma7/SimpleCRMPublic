import {
  defaultQuickAddEventTimes,
  fromCalendarTimestamp,
  toCalendarRbcEvent,
  toLocalCalendarDate,
} from '@/app/calendar/date-utils';

describe('defaultQuickAddEventTimes', () => {
  test('uses the next full hour on the same calendar day', () => {
    const now = new Date(2026, 6, 27, 10, 45, 30);
    const { start, end } = defaultQuickAddEventTimes(now);

    expect(start).toEqual(new Date(2026, 6, 27, 11, 0, 0));
    expect(end).toEqual(new Date(2026, 6, 27, 12, 0, 0));
  });

  test('caps at 23:00 local instead of rolling to the next day after 22:00', () => {
    const now = new Date(2026, 6, 27, 23, 6, 0);
    const { start, end } = defaultQuickAddEventTimes(now);

    expect(start).toEqual(new Date(2026, 6, 27, 23, 0, 0));
    expect(end).toEqual(new Date(2026, 6, 28, 0, 0, 0));
    expect(start.getDate()).toBe(now.getDate());
    expect(start.getMonth()).toBe(now.getMonth());
  });
});

describe('calendar date conversion', () => {
  test('keeps an all-day UTC date on the same local calendar day west of UTC', () => {
    const previousTimezone = process.env.TZ;
    process.env.TZ = 'America/Los_Angeles';

    try {
      const date = fromCalendarTimestamp('2026-07-22T00:00:00.000Z', true);

      expect([date.getFullYear(), date.getMonth() + 1, date.getDate()]).toEqual([2026, 7, 22]);
      expect([date.getHours(), date.getMinutes(), date.getSeconds()]).toEqual([0, 0, 0]);
    } finally {
      process.env.TZ = previousTimezone;
    }
  });

  test('maps the canonical mutation event and normalizes SQLite booleans', () => {
    const event = toCalendarRbcEvent({
      id: 17,
      title: 'Erledigte Aufgabe',
      start_date: '2026-07-22T00:00:00.000Z',
      end_date: '2026-07-23T00:00:00.000Z',
      all_day: 1 as unknown as boolean,
      color_code: '#94a3b8',
      event_type: 'task',
      task_id: 9,
    });

    expect(event).toMatchObject({
      id: 17,
      title: 'Erledigte Aufgabe',
      allDay: true,
      color_code: '#94a3b8',
      event_type: 'task',
      task_id: 9,
    });
  });

  test('derives a task due date from local components instead of the UTC ISO day', () => {
    const date = new Date('2026-07-22T22:30:00.000Z');
    jest.spyOn(date, 'getFullYear').mockReturnValue(2026);
    jest.spyOn(date, 'getMonth').mockReturnValue(6);
    jest.spyOn(date, 'getDate').mockReturnValue(23);

    expect(date.toISOString().slice(0, 10)).toBe('2026-07-22');
    expect(toLocalCalendarDate(date)).toBe('2026-07-23');
  });
});
