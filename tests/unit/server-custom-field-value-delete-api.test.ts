import {
  createServerApi,
  type AuthApiPort,
  type CustomerCustomFieldValueApiPort,
  type CustomerCustomFieldValueRecord,
  type ServerApiPorts,
} from '../../packages/server/src';

describe('server custom field value delete by customer and field API', () => {
  const principal = {
    userId: 'user-1',
    workspaceId: 'workspace-1',
    role: 'owner' as const,
  };

  test('resolves the value by customer/field pair and deletes through the existing port', async () => {
    const customerCustomFieldValues = valuePort();
    const api = createServerApi(ports({ customerCustomFieldValues }));

    const response = await api.handle({
      method: 'DELETE',
      path: '/api/v1/customers/7/custom-field-values/3',
      principal,
    });

    expect(response.status).toBe(200);
    expect((response.body as any).data.deleted).toBe(true);
    expect(customerCustomFieldValues.list).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      customerId: 7,
      fieldId: 3,
      limit: 1,
    });
    expect(customerCustomFieldValues.delete).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      actorUserId: 'user-1',
      id: 62,
    });
  });

  test('returns 404 when no value exists for the pair', async () => {
    const customerCustomFieldValues = valuePort({ items: [] });
    const api = createServerApi(ports({ customerCustomFieldValues }));

    const response = await api.handle({
      method: 'DELETE',
      path: '/api/v1/customers/7/custom-field-values/3',
      principal,
    });

    expect(response.status).toBe(404);
    expect(customerCustomFieldValues.delete).not.toHaveBeenCalled();
  });
});

function valueRecord(overrides: Partial<CustomerCustomFieldValueRecord> = {}): CustomerCustomFieldValueRecord {
  return {
    id: 62,
    sourceSqliteId: -62,
    customerSourceSqliteId: -7,
    fieldSourceSqliteId: -3,
    customerId: 7,
    fieldId: 3,
    value: 'Gold',
    createdAt: '2026-06-03T08:00:00.000Z',
    updatedAt: '2026-06-03T09:00:00.000Z',
    ...overrides,
  };
}

function valuePort(options: { items?: CustomerCustomFieldValueRecord[] } = {}): jest.Mocked<CustomerCustomFieldValueApiPort> {
  const items = options.items ?? [valueRecord()];
  return {
    list: jest.fn(async () => ({ items, nextCursor: null })),
    get: jest.fn(async () => null),
    create: jest.fn(async () => ({ ok: true, value: valueRecord() })),
    update: jest.fn(async () => ({ ok: true, value: valueRecord() })),
    delete: jest.fn(async () => valueRecord()),
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
