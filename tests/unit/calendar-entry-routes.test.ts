import { createServerApi } from '../../packages/server/src/api';
import type { ServerApiPorts } from '../../packages/server/src/api/types';

const principal = {
  userId: 'user-a',
  workspaceId: 'workspace-a',
  role: 'user' as const,
};

const event = {
  id: 41,
  sourceSqliteId: -41,
  title: 'Angebot nachfassen',
  description: 'Kunde anrufen',
  startDate: '2026-07-23T00:00:00.000Z',
  endDate: '2026-07-24T00:00:00.000Z',
  allDay: true,
  colorCode: '#3174ad',
  eventType: 'task',
  recurrenceRule: null,
  taskSourceSqliteId: -51,
  taskId: 51,
  createdAt: '2026-07-22T12:00:00.000Z',
  updatedAt: '2026-07-22T12:00:00.000Z',
};

const task = {
  id: 51,
  sourceSqliteId: -51,
  customerSourceSqliteId: -7,
  customerId: 7,
  customerName: 'Ada',
  customerCompany: 'Analytical Engines',
  title: 'Angebot nachfassen',
  description: 'Kunde anrufen',
  dueDate: '2026-07-23',
  priority: 'High',
  completed: false,
  assignmentScope: 'global' as const,
  assignedUserId: null,
  assignedGroupId: null,
  snoozedUntil: null,
  createdAt: '2026-07-22T12:00:00.000Z',
  updatedAt: '2026-07-22T12:00:00.000Z',
  calendarEventId: 41,
};

function makeApi(calls: unknown[], eventCalls: unknown[] = [], auditCalls: unknown[] = []) {
  const ports = {
    auth: {},
    locks: {},
    calendarEntries: {
      async create(input: unknown) {
        calls.push(input);
        return { ok: true, event, task };
      },
      async update(input: unknown) {
        calls.push(input);
        if ((input as { schedule?: { mode?: string } }).schedule?.mode === 'none') {
          return {
            ok: true,
            event: { ...event, taskId: null, taskSourceSqliteId: null },
            task: null,
            detachedTask: { ...task, dueDate: null, calendarEventId: null },
          };
        }
        return { ok: true, event, task };
      },
      async delete(input: unknown) {
        calls.push(input);
        return { ok: true, event, task: { ...task, dueDate: null, calendarEventId: null } };
      },
    },
    events: {
      async publish(input: unknown) {
        eventCalls.push(input);
      },
    },
    audit: {
      async record(input: unknown) {
        auditCalls.push(input);
      },
    },
  } as unknown as ServerApiPorts;
  return createServerApi(ports);
}

describe('atomic calendar entry routes', () => {
  test('creates task and calendar entry through one server command', async () => {
    const calls: unknown[] = [];
    const eventCalls: unknown[] = [];
    const auditCalls: unknown[] = [];
    const api = makeApi(calls, eventCalls, auditCalls);

    const response = await api.handle({
      method: 'POST',
      path: '/api/v1/calendar-entries',
      principal,
      body: {
        event: {
          title: 'Angebot nachfassen',
          description: 'Kunde anrufen',
          startDate: '2026-07-23T00:00:00.000Z',
          endDate: '2026-07-24T00:00:00.000Z',
          allDay: true,
        },
        schedule: {
          mode: 'create',
          task: {
            customerId: 7,
            title: 'Angebot nachfassen',
            description: 'Kunde anrufen',
            priority: 'High',
            assignmentScope: 'global',
          },
        },
      },
    });

    expect(response.status).toBe(201);
    expect((response.body as any).data).toEqual({ event, task });
    expect(calls).toEqual([expect.objectContaining({
      workspaceId: principal.workspaceId,
      actorUserId: principal.userId,
      viewer: principal,
    })]);
    expect(eventCalls).toContainEqual(expect.objectContaining({
      type: 'calendar_event.created',
      payload: { id: 41 },
    }));
    expect(eventCalls).toContainEqual(expect.objectContaining({ type: 'task.created', entityId: '51' }));
    expect(auditCalls).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: 'calendar_entry.created', entityId: '41' }),
      expect.objectContaining({ action: 'task.created', entityId: '51' }),
    ]));
  });

  test('rejects an invalid task link before invoking the port', async () => {
    const calls: unknown[] = [];
    const api = makeApi(calls);
    const response = await api.handle({
      method: 'POST',
      path: '/api/v1/calendar-entries',
      principal,
      body: {
        event: {
          title: 'Termin',
          startDate: '2026-07-23T00:00:00.000Z',
          endDate: '2026-07-24T00:00:00.000Z',
        },
        schedule: { mode: 'existing', taskId: 0 },
      },
    });

    expect(response.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  test.each([
    { task: { title: 'Termin', description: 7 } },
    { task: { title: 'Termin', priority: false } },
    { task: { title: 'Termin', assignmentScope: 'user', assignedUserId: null } },
    { task: { title: 'Termin', assignmentScope: 'group', assignedGroupId: 0 } },
  ])('rejects malformed task schedule values before invoking the port', async ({ task: invalidTask }) => {
    const calls: unknown[] = [];
    const api = makeApi(calls);
    const response = await api.handle({
      method: 'POST',
      path: '/api/v1/calendar-entries',
      principal,
      body: {
        event: {
          title: 'Termin',
          startDate: '2026-07-23T00:00:00.000Z',
          endDate: '2026-07-24T00:00:00.000Z',
        },
        schedule: { mode: 'create', task: invalidTask },
      },
    });

    expect(response.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  test('publishes the detached task after unlinking a calendar entry', async () => {
    const calls: unknown[] = [];
    const eventCalls: unknown[] = [];
    const auditCalls: unknown[] = [];
    const api = makeApi(calls, eventCalls, auditCalls);

    const response = await api.handle({
      method: 'PATCH',
      path: '/api/v1/calendar-entries/41',
      principal,
      body: {
        event: { title: 'Angebot nachfassen' },
        schedule: { mode: 'none' },
      },
    });

    expect(response.status).toBe(200);
    expect(eventCalls).toContainEqual(expect.objectContaining({
      type: 'task.updated',
      entityId: '51',
      payload: { id: 51, calendarEventId: null },
    }));
    expect(auditCalls).toContainEqual(expect.objectContaining({ action: 'task.updated', entityId: '51' }));
  });

  test('accepts a schedule-only PATCH when unlinking a calendar entry', async () => {
    const calls: unknown[] = [];
    const api = makeApi(calls);

    const response = await api.handle({
      method: 'PATCH',
      path: '/api/v1/calendar-entries/41',
      principal,
      body: {
        event: {},
        schedule: { mode: 'none' },
      },
    });

    expect(response.status).toBe(200);
    expect(calls).toContainEqual(expect.objectContaining({
      id: 41,
      event: {},
      schedule: { mode: 'none' },
    }));
  });

  test('accepts a schedule-only PATCH when linking an existing task', async () => {
    const calls: unknown[] = [];
    const api = makeApi(calls);

    const response = await api.handle({
      method: 'PATCH',
      path: '/api/v1/calendar-entries/41',
      principal,
      body: {
        event: {},
        schedule: { mode: 'existing', taskId: 51 },
      },
    });

    expect(response.status).toBe(200);
    expect(calls).toContainEqual(expect.objectContaining({
      id: 41,
      event: {},
      schedule: { mode: 'existing', taskId: 51 },
    }));
  });

  test('still rejects an empty PATCH without a schedule change', async () => {
    const calls: unknown[] = [];
    const api = makeApi(calls);

    const response = await api.handle({
      method: 'PATCH',
      path: '/api/v1/calendar-entries/41',
      principal,
      body: { event: {} },
    });

    expect(response.status).toBe(400);
    expect(calls).toHaveLength(0);
  });
});
