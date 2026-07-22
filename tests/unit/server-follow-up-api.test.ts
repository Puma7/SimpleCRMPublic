import {
  createServerApi,
  type AuthApiPort,
  type FollowUpApiPort,
  type ServerApiPorts,
} from '../../packages/server/src';

describe('server follow-up API', () => {
  const principal = {
    userId: 'user-1',
    workspaceId: 'workspace-1',
    role: 'owner' as const,
  };

  test('returns queue counts through the follow-up port', async () => {
    const followUp = followUpPort();
    const api = createServerApi(ports({ followUp }));

    const response = await api.handle({
      method: 'GET',
      path: '/api/v1/follow-up/queue-counts',
      principal,
    });

    expect(response.status).toBe(200);
    expect((response.body as any).data).toEqual({
      heute: 2,
      ueberfaellig: 1,
      dieseWoche: 4,
      zurueckgestellt: 3,
      stagnierend: 5,
      highValueRisk: 6,
    });
    expect(followUp.getQueueCounts).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
    });
  });

  test('validates item query params and forwards normalized filters', async () => {
    const followUp = followUpPort();
    const api = createServerApi(ports({ followUp }));

    const response = await api.handle({
      method: 'GET',
      path: '/api/v1/follow-up/items',
      query: {
        queue: 'high_value_risk',
        limit: '20',
        offset: '5',
        query: ' ACME ',
        priority: 'High',
      },
      principal,
    });
    const invalidLimit = await api.handle({
      method: 'GET',
      path: '/api/v1/follow-up/items',
      query: { queue: 'heute', limit: '101' },
      principal,
    });
    const invalidQueue = await api.handle({
      method: 'GET',
      path: '/api/v1/follow-up/items',
      principal,
    });

    expect(response.status).toBe(200);
    expect((response.body as any).data[0].title).toBe('Renewal');
    expect((response.body as any).data[0].customerCompany).toBe('ACME GmbH');
    expect(followUp.getItems).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      queue: 'high_value_risk',
      filters: {
        query: 'ACME',
        priority: 'High',
      },
      limit: 20,
      offset: 5,
    });
    expect(invalidLimit.status).toBe(400);
    expect((invalidLimit.body as any).error.code).toBe('invalid_limit');
    expect(invalidQueue.status).toBe(400);
    expect((invalidQueue.body as any).error.code).toBe('invalid_queue');
  });

  test('validates snooze payload and forwards actor context', async () => {
    const followUp = followUpPort();
    const api = createServerApi(ports({ followUp }));

    const response = await api.handle({
      method: 'PATCH',
      path: '/api/v1/follow-up/tasks/9/snooze',
      body: { snoozedUntil: '2026-06-04T12:30:00+02:00' },
      principal,
    });
    const invalidBody = await api.handle({
      method: 'PATCH',
      path: '/api/v1/follow-up/tasks/9/snooze',
      body: { snoozedUntil: 'not-a-date' },
      principal,
    });

    expect(response.status).toBe(200);
    expect((response.body as any).data).toEqual({ success: true });
    expect(followUp.snoozeTask).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      actorUserId: 'user-1',
      taskId: 9,
      snoozedUntil: '2026-06-04T10:30:00.000Z',
    });
    expect(invalidBody.status).toBe(400);
    expect((invalidBody.body as any).error.code).toBe('validation_error');
  });

  test('requires auth and configured follow-up port', async () => {
    const apiWithoutAuth = createServerApi(ports({ followUp: followUpPort() }));
    const apiWithoutFollowUp = createServerApi(ports({ followUp: undefined }));

    const unauthorized = await apiWithoutAuth.handle({
      method: 'GET',
      path: '/api/v1/follow-up/queue-counts',
    });
    const unavailable = await apiWithoutFollowUp.handle({
      method: 'GET',
      path: '/api/v1/follow-up/queue-counts',
      principal,
    });

    expect(unauthorized.status).toBe(401);
    expect(unavailable.status).toBe(503);
    expect((unavailable.body as any).error.code).toBe('follow_up_unavailable');
  });
});

function followUpPort(): jest.Mocked<FollowUpApiPort> {
  return {
    getQueueCounts: jest.fn(async () => ({
      heute: 2,
      ueberfaellig: 1,
      dieseWoche: 4,
      zurueckgestellt: 3,
      stagnierend: 5,
      highValueRisk: 6,
    })),
    getItems: jest.fn(async () => [
      {
        itemId: 7,
        sourceType: 'deal',
        customerId: 3,
        customerName: 'ACME',
        customerCompany: 'ACME GmbH',
        dealId: 7,
        dealName: 'Renewal',
        dealValue: 4200,
        dealStage: 'Negotiation',
        title: 'Renewal',
        reason: 'Hoher Wert, Abschluss gefaehrdet',
        priority: 'High',
        priorityScore: 43,
        completed: false,
      },
    ]),
    snoozeTask: jest.fn(async () => ({ success: true })),
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
