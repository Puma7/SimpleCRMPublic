import {
  createServerApi,
  type AuthApiPort,
  type DashboardApiPort,
  type ServerApiPorts,
} from '../../packages/server/src';

describe('server dashboard API', () => {
  const principal = {
    userId: 'user-1',
    workspaceId: 'workspace-1',
    role: 'owner' as const,
  };

  test('returns dashboard stats through the dashboard port', async () => {
    const dashboard = dashboardPort();
    const api = createServerApi(ports({ dashboard }));

    const response = await api.handle({
      method: 'GET',
      path: '/api/v1/dashboard/stats',
      principal,
    });

    expect(response.status).toBe(200);
    expect((response.body as any).data).toEqual({
      totalCustomers: 12,
      newCustomersLastMonth: 3,
      activeDealsCount: 4,
      activeDealsValue: 12500,
      pendingTasksCount: 8,
      dueTodayTasksCount: 2,
      conversionRate: 40,
    });
    expect(dashboard.getStats).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
    });
  });

  test('validates dashboard list limits and forwards normalized limits', async () => {
    const dashboard = dashboardPort();
    const api = createServerApi(ports({ dashboard }));

    const recent = await api.handle({
      method: 'GET',
      path: '/api/v1/dashboard/recent-customers',
      query: { limit: '7' },
      principal,
    });
    const upcoming = await api.handle({
      method: 'GET',
      path: '/api/v1/dashboard/upcoming-tasks',
      query: { limit: '2' },
      principal,
    });
    const invalid = await api.handle({
      method: 'GET',
      path: '/api/v1/dashboard/recent-customers',
      query: { limit: '26' },
      principal,
    });

    expect(recent.status).toBe(200);
    expect((recent.body as any).data[0].name).toBe('ACME');
    expect(dashboard.getRecentCustomers).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      limit: 7,
    });
    expect(upcoming.status).toBe(200);
    expect((upcoming.body as any).data[0].title).toBe('Follow up');
    expect(dashboard.getUpcomingTasks).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      limit: 2,
    });
    expect(invalid.status).toBe(400);
    expect((invalid.body as any).error.code).toBe('invalid_limit');
  });

  test('requires auth and configured dashboard port', async () => {
    const apiWithoutAuth = createServerApi(ports({ dashboard: dashboardPort() }));
    const apiWithoutDashboard = createServerApi(ports({ dashboard: undefined }));

    const unauthorized = await apiWithoutAuth.handle({
      method: 'GET',
      path: '/api/v1/dashboard/stats',
    });
    const unavailable = await apiWithoutDashboard.handle({
      method: 'GET',
      path: '/api/v1/dashboard/stats',
      principal,
    });

    expect(unauthorized.status).toBe(401);
    expect(unavailable.status).toBe(503);
    expect((unavailable.body as any).error.code).toBe('dashboard_unavailable');
  });
});

function dashboardPort(): jest.Mocked<DashboardApiPort> {
  return {
    getStats: jest.fn(async () => ({
      totalCustomers: 12,
      newCustomersLastMonth: 3,
      activeDealsCount: 4,
      activeDealsValue: 12500,
      pendingTasksCount: 8,
      dueTodayTasksCount: 2,
      conversionRate: 40,
    })),
    getRecentCustomers: jest.fn(async () => [
      {
        id: 1,
        name: 'ACME',
        email: 'info@example.com',
        dateAdded: '2026-06-03T10:00:00.000Z',
      },
    ]),
    getUpcomingTasks: jest.fn(async () => [
      {
        id: 9,
        title: 'Follow up',
        priority: 'High',
        customerId: 1,
        dueDate: '2026-06-04T00:00:00.000Z',
        customerName: 'ACME',
      },
    ]),
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
    checkLoginLock: async () => null,
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
