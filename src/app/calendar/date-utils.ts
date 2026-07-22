import type { CalendarEvent, CalendarRBCEvent } from '@/types';

export function fromCalendarTimestamp(value: string, allDay: boolean | undefined): Date {
  if (!allDay) return new Date(value);

  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return new Date(value);

  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

export function toCalendarRbcEvent(event: CalendarEvent): CalendarRBCEvent {
  let recurrenceRule = event.recurrence_rule;
  if (typeof recurrenceRule === 'string' && recurrenceRule !== '') {
    try {
      recurrenceRule = JSON.parse(recurrenceRule);
    } catch (error) {
      console.error('Error parsing recurrence rule for event:', event.id, error);
      recurrenceRule = null;
    }
  }
  const allDay = Boolean(event.all_day);

  return {
    ...event,
    start: fromCalendarTimestamp(event.start_date, allDay),
    end: fromCalendarTimestamp(event.end_date, allDay),
    allDay,
    recurrence_rule: recurrenceRule,
    task_id: event.task_id ?? null,
  };
}
