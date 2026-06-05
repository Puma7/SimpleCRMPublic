import {
  createServerApi,
  type AuthApiPort,
  type DealProductApiPort,
  type DealProductRecord,
  type ServerApiPorts,
} from '../../packages/server/src';

describe('server deal products API', () => {
  const principal = {
    userId: 'user-1',
    workspaceId: 'workspace-1',
    role: 'owner' as const,
  };

  test('lists products linked to a deal', async () => {
    const dealProducts = dealProductPort();
    const api = createServerApi(ports({ dealProducts }));

    const response = await api.handle({
      method: 'GET',
      path: '/api/v1/deals/4/products',
      principal,
    });

    expect(response.status).toBe(200);
    expect((response.body as any).data[0].product.name).toBe('Support Plan');
    expect(dealProducts.list).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      dealId: 4,
    });
  });

  test('adds a product to a deal and publishes audit/event metadata', async () => {
    const dealProducts = dealProductPort();
    const audit = { record: jest.fn(async () => undefined) };
    const events = { publish: jest.fn(async () => undefined) };
    const api = createServerApi(ports({ dealProducts, audit, events }));

    const response = await api.handle({
      method: 'POST',
      path: '/api/v1/deals/4/products',
      body: { productId: 9, quantity: 2, price: 19.5 },
      principal,
    });

    expect(response.status).toBe(201);
    expect((response.body as any).data.id).toBe(12);
    expect(dealProducts.add).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      actorUserId: 'user-1',
      values: {
        dealId: 4,
        productId: 9,
        quantity: 2,
        price: '19.50',
      },
    });
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      action: 'deal_product.created',
      entityType: 'deal_product',
      entityId: '12',
    }));
    expect(events.publish).toHaveBeenCalledWith(expect.objectContaining({
      type: 'deal_product.created',
      entityType: 'deal_product',
      entityId: '12',
    }));
  });

  test('updates a deal product by link id', async () => {
    const dealProducts = dealProductPort();
    const api = createServerApi(ports({ dealProducts }));

    const response = await api.handle({
      method: 'PATCH',
      path: '/api/v1/deal-products/12',
      body: { quantity: 3, priceAtTime: 21 },
      principal,
    });

    expect(response.status).toBe(200);
    expect(dealProducts.update).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      actorUserId: 'user-1',
      values: {
        dealProductId: 12,
        quantity: 3,
        price: '21.00',
      },
    });
  });

  test('deletes a deal product by deal/product pair', async () => {
    const dealProducts = dealProductPort();
    const api = createServerApi(ports({ dealProducts }));

    const response = await api.handle({
      method: 'DELETE',
      path: '/api/v1/deals/4/products/by-product/9',
      principal,
    });

    expect(response.status).toBe(200);
    expect((response.body as any).data.deleted).toBe(true);
    expect(dealProducts.delete).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      actorUserId: 'user-1',
      values: {
        dealId: 4,
        productId: 9,
      },
    });
  });

  test('requires auth and configured deal product port', async () => {
    const apiWithoutAuth = createServerApi(ports({ dealProducts: dealProductPort() }));
    const apiWithoutPort = createServerApi(ports({ dealProducts: undefined }));

    const unauthorized = await apiWithoutAuth.handle({
      method: 'GET',
      path: '/api/v1/deals/4/products',
    });
    const unavailable = await apiWithoutPort.handle({
      method: 'GET',
      path: '/api/v1/deals/4/products',
      principal,
    });

    expect(unauthorized.status).toBe(401);
    expect(unavailable.status).toBe(503);
    expect((unavailable.body as any).error.code).toBe('deal_products_unavailable');
  });
});

function dealProductRecord(overrides: Partial<DealProductRecord> = {}): DealProductRecord {
  return {
    id: 12,
    sourceSqliteId: -12,
    dealSourceSqliteId: -4,
    productSourceSqliteId: -9,
    dealId: 4,
    productId: 9,
    quantity: 2,
    priceAtTimeOfAdding: '19.50',
    dateAdded: '2026-06-03T10:00:00.000Z',
    product: {
      id: 9,
      sourceSqliteId: -9,
      jtlKartikel: null,
      name: 'Support Plan',
      sku: 'SUPPORT',
      description: null,
      price: '20.00',
      isActive: true,
      updatedAt: '2026-06-03T09:00:00.000Z',
    },
    ...overrides,
  };
}

function dealProductPort(): jest.Mocked<DealProductApiPort> {
  return {
    list: jest.fn(async () => [dealProductRecord()]),
    add: jest.fn(async () => ({ ok: true, dealProduct: dealProductRecord() })),
    update: jest.fn(async () => ({ ok: true, dealProduct: dealProductRecord({ quantity: 3, priceAtTimeOfAdding: '21.00' }) })),
    delete: jest.fn(async () => ({ ok: true, dealProduct: dealProductRecord() })),
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
