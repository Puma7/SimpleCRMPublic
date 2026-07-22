export type TaskAssignmentScope = 'global' | 'user' | 'group';

export type TaskScheduleValues = Readonly<{
  customerId?: number;
  title: string;
  description?: string | null;
  priority?: string;
  completed?: boolean;
  assignmentScope?: TaskAssignmentScope;
  assignedUserId?: string | null;
  assignedGroupId?: number | null;
}>;

export type TaskScheduleInput =
  | Readonly<{ mode: 'none' }>
  | Readonly<{ mode: 'existing'; taskId: number }>
  | Readonly<{ mode: 'create'; task: TaskScheduleValues }>;

export type CalendarEntryValues = Readonly<{
  title?: string;
  description?: string | null;
  startDate?: string;
  endDate?: string;
  allDay?: boolean;
  colorCode?: string | null;
  eventType?: string | null;
  recurrenceRule?: string | null;
}>;

export type CalendarEntryMutationInput = Readonly<{
  event: CalendarEntryValues;
  schedule?: TaskScheduleInput;
}>;

export type CalendarEntryMutationResult<CalendarEntry, Task> = Readonly<{
  event: CalendarEntry;
  task: Task | null;
  detachedTask?: Task | null;
}>;
