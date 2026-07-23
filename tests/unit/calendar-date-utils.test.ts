import { fromCalendarTimestamp, toCalendarRbcEvent, toLocalCalendarDate } from '@/app/calendar/date-utils';

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

  test('derives a task due date from the local calendar day east of UTC', () => {
    const previousTimezone = process.env.TZ;
    process.env.TZ = 'Europe/Berlin';

    try {
      expect(toLocalCalendarDate(new Date('2026-07-22T22:30:00.000Z'))).toBe('2026-07-23');
    } finally {
      process.env.TZ = previousTimezone;
    }
  });
});
