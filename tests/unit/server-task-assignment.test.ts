import {
  createServerApi,
  type AuthApiPort,
  type ServerApiPorts,
  type TaskApiPort,
  type TaskRecord,
} from '../../packages/server/src';

describe('task assignment (global/user/group) and visibility', () => {
  const principal = { userId: 'user-1', workspaceId: 'ws-1', role: 'user' as const };

  test('creates a task assigned to a specific user', async () => {
    const tasks = taskPort();
    const api = createServerApi(ports({ tasks }));

    const res = await api.handle({
      method: 'POST',
      path: '/api/v1/tasks',
      body: { title: 'Call back', assignmentScope: 'user', assignedUserId: 'user-9' },
      principal,
    });

    expect(res.status).toBe(201);
    const values = tasks.create.mock.calls[0][0].values;
    expect(values.assignmentScope).toBe('user');
    expect(values.assignedUserId).toBe('user-9');
  });

  test('rejects assignmentScope=user without an assigned user', async () => {
    const tasks = taskPort();
    const api = createServerApi(ports({ tasks }));

    const res = await api.handle({
      method: 'POST',
      path: '/api/v1/tasks',
      body: { title: 'Call back', assignmentScope: 'user' },
      principal,
    });

    expect(res.status).toBe(400);
    expect(tasks.create).not.toHaveBeenCalled();
  });

  test('rejects an invalid assignmentScope value', async () => {
    const tasks = taskPort();
    const api = createServerApi(ports({ tasks }));

    const res = await api.handle({
      method: 'POST',
      path: '/api/v1/tasks',
      body: { title: 'x', assignmentScope: 'everyone' },
      principal,
    });

    expect(res.status).toBe(400);
  });

  test('surfaces a missing assigned group as 404', async () => {
    const tasks = taskPort();
    tasks.create.mockResolvedValueOnce({ ok: false, code: 'assigned_group_not_found' });
    const api = createServerApi(ports({ tasks }));

    const res = await api.handle({
      method: 'POST',
      path: '/api/v1/tasks',
      body: { title: 'x', assignmentScope: 'group', assignedGroupId: 42 },
      principal,
    });

    expect(res.status).toBe(404);
    expect((res.body as any).error.code).toBe('assigned_group_not_found');
  });

  test('passes the viewer (user + role) to the list port for visibility filtering', async () => {
    const tasks = taskPort();
    const api = createServerApi(ports({ tasks }));

    await api.handle({ method: 'GET', path: '/api/v1/tasks', principal });

    expect(tasks.list).toHaveBeenCalledWith(
      expect.objectContaining({ viewer: { userId: 'user-1', role: 'user' } }),
    );
  });
});

function taskRecord(): TaskRecord {
  return {
    id: 1,
    sourceSqliteId: 10,
    customerSourceSqliteId: 0,
    customerId: null,
    title: 'Call back',
    description: null,
    dueDate: null,
    priority: 'Medium',
    completed: false,
    snoozedUntil: null,
    assignmentScope: 'global',
    assignedUserId: null,
    assignedGroupId: null,
    updatedAt: '2026-06-06T10:00:00.000Z',
  };
}

function taskPort(): jest.Mocked<TaskApiPort> {
  return {
    list: jest.fn(async () => ({ items: [], nextCursor: null })),
    get: jest.fn(async () => null),
    create: jest.fn(async () => ({ ok: true as const, task: taskRecord() })),
    update: jest.fn(async () => ({ ok: true as const, task: taskRecord() })),
    delete: jest.fn(async () => taskRecord()),
  };
}

function ports(overrides: Partial<ServerApiPorts>): ServerApiPorts {
  return {
    auth: {} as AuthApiPort,
    locks: {} as ServerApiPorts['locks'],
    ...overrides,
  };
}
