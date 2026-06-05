import {
  createServerApi,
  type AuthApiPort,
  type DealApiPort,
  type DealRecord,
  type ServerApiPorts,
  type TaskApiPort,
} from '../../packages/server/src';

describe('server deal tasks API', () => {
  const principal = {
    userId: 'user-1',
    workspaceId: 'workspace-1',
    role: 'owner' as const,
  };

  test('lists tasks for the deal customer through existing deal and task ports', async () => {
    const deals = dealPort();
    const tasks = taskPort();
    const api = createServerApi(ports({ deals, tasks }));

    const response = await api.handle({
      method: 'GET',
      path: '/api/v1/deals/4/tasks',
      query: { limit: '25' },
      principal,
    });

    expect(response.status).toBe(200);
    expect((response.body as any).data.items[0].title).toBe('Follow up');
    expect(deals.get).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      id: 4,
    });
    expect(tasks.list).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      customerId: 2,
      limit: 25,
    });
  });

  test('returns an empty task list when the deal has no customer link', async () => {
    const deals = dealPort({ customerId: null });
    const tasks = taskPort();
    const api = createServerApi(ports({ deals, tasks }));

    const response = await api.handle({
      method: 'GET',
      path: '/api/v1/deals/4/tasks',
      principal,
    });

    expect(response.status).toBe(200);
    expect((response.body as any).data).toEqual({ items: [], nextCursor: null });
    expect(tasks.list).not.toHaveBeenCalled();
  });

  test('requires auth and configured ports', async () => {
    const apiWithoutAuth = createServerApi(ports({ deals: dealPort(), tasks: taskPort() }));
    const apiWithoutTasks = createServerApi(ports({ deals: dealPort(), tasks: undefined }));

    const unauthorized = await apiWithoutAuth.handle({
      method: 'GET',
      path: '/api/v1/deals/4/tasks',
    });
    const unavailable = await apiWithoutTasks.handle({
      method: 'GET',
      path: '/api/v1/deals/4/tasks',
      principal,
    });

    expect(unauthorized.status).toBe(401);
    expect(unavailable.status).toBe(503);
    expect((unavailable.body as any).error.code).toBe('tasks_unavailable');
  });
});

function dealPort(overrides: Partial<DealRecord> = {}): jest.Mocked<DealApiPort> {
  return {
    list: jest.fn(async () => ({ items: [], nextCursor: null })),
    get: jest.fn(async () => ({
      id: 4,
      sourceSqliteId: 40,
      customerSourceSqliteId: 20,
      customerId: 2,
      name: 'Renewal',
      value: '1200',
      valueCalculationMethod: 'static',
      stage: 'Angebot',
      notes: null,
      createdDate: null,
      expectedCloseDate: null,
      updatedAt: '2026-06-03T10:00:00.000Z',
      ...overrides,
    })),
  };
}

function taskPort(): jest.Mocked<TaskApiPort> {
  return {
    list: jest.fn(async () => ({
      items: [
        {
          id: 9,
          sourceSqliteId: 90,
          customerSourceSqliteId: 20,
          customerId: 2,
          title: 'Follow up',
          description: null,
          dueDate: '2026-06-04T00:00:00.000Z',
          priority: 'High',
          completed: false,
          snoozedUntil: null,
          updatedAt: '2026-06-03T10:00:00.000Z',
        },
      ],
      nextCursor: null,
    })),
    get: jest.fn(async () => null),
  };
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
    issueTokenPair: async () => ({
      accessToken: 'access',
      refreshToken: 'refresh',
      expiresInSeconds: 900,
    }),
    rotateRefreshToken: async () => null,
    revokeRefreshToken: async () => false,
  };
}
