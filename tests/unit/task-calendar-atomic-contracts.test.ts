import { IPCChannels } from '../../shared/ipc/channels';
import { getPayloadSchema, getResultSchema } from '../../shared/ipc/schemas';
import { serverMigrations } from '../../packages/server/src/migrations';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('atomic task and calendar contracts', () => {
  test('registers a workspace-safe one-calendar-entry-per-task migration', () => {
    const migration = serverMigrations.find((candidate) => candidate.id === '0043_atomic_task_calendar');

    expect(migration).toBeDefined();
    const sql = migration?.upSql.join('\n') ?? '';
    expect(sql).toContain('calendar_events_workspace_task_unique_idx');
    expect(sql).toContain('FOREIGN KEY (workspace_id, task_id)');
    expect(sql).toContain('ON DELETE CASCADE');
    expect(sql).toContain('row_number() OVER');
    expect(sql).toContain('event_type = NULL');
    expect(sql).toContain('recurrence_rule = NULL');
  });

  test('rejects malformed calendar scheduling payloads', () => {
    const schema = getPayloadSchema(IPCChannels.Calendar.AddCalendarEvent);

    expect(() => schema.parse({
      event: {
        title: 'Termin',
        start_date: '2026-07-23T08:00:00.000Z',
        end_date: '2026-07-23T09:00:00.000Z',
      },
      schedule: { mode: 'existing', taskId: 0 },
    })).toThrow();
  });

  test('accepts task field updates for an existing calendar link', () => {
    const schema = getPayloadSchema(IPCChannels.Calendar.UpdateCalendarEvent);

    expect(schema.parse({
      id: 12,
      event: { title: 'Termin' },
      schedule: {
        mode: 'existing',
        taskId: 7,
        dueDate: '2026-07-23',
        task: { priority: 'Low', completed: true },
      },
    })).toBeDefined();

    expect(() => schema.parse({
      id: 12,
      event: { title: 'Termin' },
      schedule: { mode: 'existing', taskId: 7, dueDate: '2026-02-30' },
    })).toThrow();
  });

  test('rejects malformed task mutations and calendar results', () => {
    expect(() => getPayloadSchema(IPCChannels.Tasks.Create).parse({
      title: '',
      priority: 'Medium',
    })).toThrow();

    expect(() => getResultSchema(IPCChannels.Calendar.AddCalendarEvent).parse({
      success: true,
      id: 'not-a-number',
    })).toThrow();

    expect(() => getResultSchema(IPCChannels.Calendar.AddCalendarEvent).parse({
      success: true,
      id: 4,
      task: null,
    })).toThrow();

    expect(() => getPayloadSchema(IPCChannels.Tasks.ToggleCompletion).parse(1)).toThrow();
  });

  test('does not coerce a missing task customer to id zero', () => {
    const source = readFileSync(join(process.cwd(), 'src', 'app', 'tasks', 'page.tsx'), 'utf8');

    expect(source).toContain('...(newTask.customer_id > 0 ? { customerId: Number(newTask.customer_id) } : {})');
    expect(source).not.toMatch(/createTask:\s*\{\s*customerId:/);
  });
});
