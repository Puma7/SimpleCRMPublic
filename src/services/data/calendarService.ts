import { IPCChannels } from '@shared/ipc/channels';
import { invokeRenderer } from '@/services/transport';

interface AddTaskEventOptions {
  title: string;
  description?: string;
  dueDate: string;
  customerName?: string;
  colorCode?: string;
  createTask?: {
    customerId: number;
    title: string;
    description?: string | null;
    priority?: string;
    completed?: boolean;
    assignmentScope?: 'global' | 'user' | 'group';
    assignedUserId?: string | null;
    assignedGroupId?: number | null;
  };
}

interface AddTaskEventResult {
  success: boolean;
  id: number;
  taskId?: number;
}

interface UpdateTaskEventOptions {
  title?: string;
  description?: string;
  dueDate?: string;
  customerName?: string;
  completed?: boolean;
  colorCode?: string | null;
}

const DEFAULT_TASK_EVENT_COLOR = '#3174ad';
const COMPLETED_TASK_EVENT_COLOR = '#94a3b8';

const parseDueDate = (dueDate: string): { start: Date; end: Date } => {
  const [yearString, monthString, dayString] = dueDate.split('-');
  const year = Number(yearString);
  const month = Number(monthString);
  const day = Number(dayString);

  if (!year || !month || !day) {
    throw new Error(`Ungültiges Fälligkeitsdatum: ${dueDate}`);
  }

  const start = new Date(Date.UTC(year, month - 1, day));
  if (
    start.getUTCFullYear() !== year
    || start.getUTCMonth() !== month - 1
    || start.getUTCDate() !== day
  ) {
    throw new Error(`Ungültiges Fälligkeitsdatum: ${dueDate}`);
  }
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);

  return { start, end };
};

const buildTaskDescription = (description?: string, customerName?: string) => {
  const lines = [
    description?.trim() ? description.trim() : null,
    customerName ? `Kunde: ${customerName}` : null,
  ].filter(Boolean);

  return lines.join('\n');
};

export const calendarService = {
  async addTaskEvent({
    title,
    description,
    dueDate,
    customerName,
    colorCode,
    createTask,
  }: AddTaskEventOptions): Promise<AddTaskEventResult> {
    const { start, end } = parseDueDate(dueDate);

    const sqliteCompatibleEvent = {
      title,
      description: buildTaskDescription(description, customerName),
      start_date: start.toISOString(),
      end_date: end.toISOString(),
      all_day: true,
      color_code: colorCode || DEFAULT_TASK_EVENT_COLOR,
      event_type: 'task',
      recurrence_rule: null,
    };

    const result = await invokeRenderer(
      IPCChannels.Calendar.AddCalendarEvent,
      createTask
        ? {
            event: sqliteCompatibleEvent,
            schedule: { mode: 'create' as const, task: createTask },
          }
        : sqliteCompatibleEvent,
    ) as {
      success?: boolean;
      id?: number;
      lastInsertRowid?: number;
      task?: { id?: number | string } | null;
    };

    const calendarEventId =
      typeof result?.id === 'number'
        ? result.id
        : typeof result?.lastInsertRowid === 'number'
          ? Number(result.lastInsertRowid)
          : undefined;

    if (typeof calendarEventId !== 'number' || Number.isNaN(calendarEventId)) {
      throw new Error('Kalenderereignis konnte nicht erstellt werden: Keine Ereignis-ID erhalten.');
    }

    return {
      success: Boolean(result?.success ?? true),
      id: calendarEventId,
      taskId: result.task?.id === undefined ? undefined : Number(result.task.id),
    };
  },

  async updateTaskEvent(
    eventId: number,
    {
      title,
      description,
      dueDate,
      customerName,
      completed,
      colorCode,
    }: UpdateTaskEventOptions
  ): Promise<void> {
    if (!eventId || Number.isNaN(Number(eventId))) {
      throw new Error('Ungültige Kalender-Ereignis-ID.');
    }

    const eventData: Record<string, unknown> = {};

    if (title !== undefined) {
      eventData.title = title;
    }

    if (description !== undefined || customerName !== undefined) {
      eventData.description = buildTaskDescription(description, customerName);
    }

    if (dueDate) {
      const { start, end } = parseDueDate(dueDate);
      eventData.start_date = start.toISOString();
      eventData.end_date = end.toISOString();
      eventData.all_day = true;
    }

    if (completed !== undefined || colorCode !== undefined) {
      const resolvedColor =
        colorCode ??
        (completed ? COMPLETED_TASK_EVENT_COLOR : DEFAULT_TASK_EVENT_COLOR);

      eventData.color_code = resolvedColor;
    }

    if (Object.keys(eventData).length === 0) {
      return;
    }

    await invokeRenderer(
      IPCChannels.Calendar.UpdateCalendarEvent,
      {
        id: eventId,
        eventData,
      }
    );
  },

  async deleteTaskEvent(eventId: number): Promise<void> {
    if (!eventId || Number.isNaN(Number(eventId))) {
      throw new Error('Ungültige Kalender-Ereignis-ID.');
    }

    await invokeRenderer(
      IPCChannels.Calendar.DeleteCalendarEvent,
      eventId
    );
  },
};

export const TASK_EVENT_DEFAULT_COLOR = DEFAULT_TASK_EVENT_COLOR;
export const TASK_EVENT_COMPLETED_COLOR = COMPLETED_TASK_EVENT_COLOR;

export type { AddTaskEventOptions, AddTaskEventResult, UpdateTaskEventOptions };
