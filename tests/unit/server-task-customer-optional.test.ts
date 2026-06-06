import {
  createServerApi,
  type AuthApiPort,
  type ServerApiPorts,
  type TaskApiPort,
  type TaskRecord,
} from '../../packages/server/src';

// A task can be created without a customer (customer is optional). A provided
// customer id that does not resolve still yields customer_not_found.
describe('task creation with optional customer', () => {
  const principal = { userId: 'user-1', workspaceId: 'workspace-1', role: 'owner' as const };

  test('creates a task without a customer (no customerId in the body)', async () => {
    const tasks = taskPort();
    const api = createServerApi(ports({ tasks }));

    const res = await api.handle({
      method: 'POST',
      path: '/api/v1/tasks',
      body: { title: 'Standalone task' },
      principal,
    });

    expect(res.status).toBe(201);
    expect(tasks.create).toHaveBeenCalledTimes(1);
    const createArg = tasks.create.mock.calls[0][0];
    expect(createArg.values.title).toBe('Standalone task');
    expect('customerId' in createArg.values).toBe(false);
    expect((res.body as any).data.customerId).toBeNull();
  });

  test('still creates a task with a customer when provided', async () => {
    const tasks = taskPort();
    const api = createServerApi(ports({ tasks }));

    const res = await api.handle({
      method: 'POST',
      path: '/api/v1/tasks',
      body: { title: 'Linked task', customerId: 2 },
      principal,
    });

    expect(res.status).toBe(201);
    expect(tasks.create.mock.calls[0][0].values.customerId).toBe(2);
  });

  test('returns customer_not_found when a provided customer id does not resolve', async () => {
    const tasks = taskPort();
    tasks.create.mockResolvedValueOnce({ ok: false, code: 'customer_not_found' });
    const api = createServerApi(ports({ tasks }));

    const res = await api.handle({
      method: 'POST',
      path: '/api/v1/tasks',
      body: { title: 'Linked task', customerId: 999 },
      principal,
    });

    expect(res.status).toBe(404);
    expect((res.body as any).error.code).toBe('customer_not_found');
  });

  test('rejects a non-positive customer id', async () => {
    const tasks = taskPort();
    const api = createServerApi(ports({ tasks }));

    const res = await api.handle({
      method: 'POST',
      path: '/api/v1/tasks',
      body: { title: 'Bad customer', customerId: 0 },
      principal,
    });

    expect(res.status).toBe(400);
    expect(tasks.create).not.toHaveBeenCalled();
  });
});

function taskRecord(customerId: number | null): TaskRecord {
  return {
    id: 9,
    sourceSqliteId: 90,
    customerSourceSqliteId: customerId ?? 0,
    customerId,
    title: 'Standalone task',
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

function taskPort(): jest.Mocked<Pick<TaskApiPort, 'create'>> & TaskApiPort {
  const create = jest.fn(async (input: { values: { customerId?: number } }) =>
    ({ ok: true as const, task: taskRecord(input.values.customerId ?? null) }),
  );
  return {
    list: jest.fn(async () => ({ items: [], nextCursor: null })),
    get: jest.fn(async () => null),
    create,
  } as unknown as jest.Mocked<Pick<TaskApiPort, 'create'>> & TaskApiPort;
}

function ports(overrides: Partial<ServerApiPorts>): ServerApiPorts {
  return {
    auth: authPort(),
    locks: {} as ServerApiPorts['locks'],
    ...overrides,
  };
}

function authPort(): AuthApiPort {
  return {
    findUserByEmail: async () => null,
    verifyPassword: async () => false,
    recordFailedLogin: async () => 1,
    recordSuccessfulLogin: async () => undefined,
    issueTokenPair: async () => ({ accessToken: 'a', refreshToken: 'r', expiresInSeconds: 900 }),
    rotateRefreshToken: async () => null,
    revokeRefreshToken: async () => false,
  };
}
