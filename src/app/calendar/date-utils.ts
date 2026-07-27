import type { CalendarEvent, CalendarRBCEvent } from '@/types';

/** Default start/end for "Ereignis hinzufügen" — next full hour, capped at 23:00 local today. */
export function defaultQuickAddEventTimes(now: Date = new Date()): { start: Date; end: Date } {
  const startHour = Math.min(now.getHours() + 1, 23);
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), startHour, 0, 0);
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  return { start, end };
}

export function toLocalCalendarDate(value: Date): string {
  return [
    String(value.getFullYear()).padStart(4, '0'),
    String(value.getMonth() + 1).padStart(2, '0'),
    String(value.getDate()).padStart(2, '0'),
  ].join('-');
}

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
