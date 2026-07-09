import { handleReturnsRoute } from '../../packages/server/src/api/returns-routes';
import type {
  ApiRequest,
  ReturnCreateInput,
  ReturnListInput,
  ReturnReasonRecord,
  ReturnRecord,
  ReturnUpdateInput,
  ReturnsAnalyticsInput,
  ReturnsApiPort,
  ReturnReasonsApiPort,
  ServerApiPorts,
} from '../../packages/server/src/api/types';

const PRINCIPAL = { userId: 'user-1', workspaceId: 'ws-1', role: 'user' as const };

function makeRecord(overrides: Partial<ReturnRecord> = {}): ReturnRecord {
  return {
    id: 1,
    returnNumber: 'R-AAAA0001',
    customerId: null,
    emailMessageId: null,
    jtlOrderNumber: null,
    jtlKauftrag: null,
    status: 'pending',
    outcome: null,
    customerEmail: null,
    customerName: null,
    notes: null,
    createdAt: '2026-06-08T05:00:00.000Z',
    updatedAt: '2026-06-08T05:00:00.000Z',
    items: [],
    ...overrides,
  };
}

type CapturedCall<T> = { input: T };

function makeReturnsPort(overrides: Partial<ReturnsApiPort> = {}): {
  port: ReturnsApiPort;
  listCalls: Array<CapturedCall<ReturnListInput>>;
  getCalls: Array<CapturedCall<{ workspaceId: string; id: number }>>;
  createCalls: Array<CapturedCall<{ workspaceId: string; actorUserId: string; input: ReturnCreateInput }>>;
  updateCalls: Array<CapturedCall<{ workspaceId: string; actorUserId: string; id: number; update: ReturnUpdateInput }>>;
  analyticsCalls: Array<CapturedCall<ReturnsAnalyticsInput>>;
} {
  const listCalls: Array<CapturedCall<ReturnListInput>> = [];
  const getCalls: Array<CapturedCall<{ workspaceId: string; id: number }>> = [];
  const createCalls: Array<CapturedCall<{ workspaceId: string; actorUserId: string; input: ReturnCreateInput }>> = [];
  const updateCalls: Array<CapturedCall<{ workspaceId: string; actorUserId: string; id: number; update: ReturnUpdateInput }>> = [];
  const analyticsCalls: Array<CapturedCall<ReturnsAnalyticsInput>> = [];
  const port: ReturnsApiPort = {
    async list(input) {
      listCalls.push({ input });
      return { items: [], totalCount: 0 };
    },
    async get(input) {
      getCalls.push({ input });
      return null;
    },
    async create(input) {
      createCalls.push({ input });
      return { ok: true, record: makeRecord({ returnNumber: 'R-FAKE0001' }) };
    },
    async update(input) {
      updateCalls.push({ input });
      return { ok: true, record: makeRecord({ id: input.id, status: input.update.status ?? 'pending' }) };
    },
    async analytics(input) {
      analyticsCalls.push({ input });
      return {
        totalCount: 0,
        byStatus: [],
        byOutcome: [],
        topReasons: [],
        generatedAt: '2026-06-09T00:00:00.000Z',
      };
    },
    async getPublicByReturnNumber() { return null; },
    async createPublic() { return { ok: false, error: 'unused' }; },
    ...overrides,
  };
  return { port, listCalls, getCalls, createCalls, updateCalls, analyticsCalls };
}

function makeReasonsPort(reasons: ReturnReasonRecord[]): ReturnReasonsApiPort {
  return {
    async list() {
      return reasons;
    },
  };
}

function makeBaseRequest(overrides: Partial<ApiRequest>): ApiRequest {
  return {
    method: 'GET',
    path: '/api/v1/returns',
    principal: PRINCIPAL,
    ...overrides,
  };
}

describe('handleReturnsRoute', () => {
  test('returns null for unrelated paths so the dispatcher can fall through', async () => {
    const ports: ServerApiPorts = { auth: {} as never };
    const result = await handleReturnsRoute(
      makeBaseRequest({ path: '/api/v1/customers' }),
      ports,
    );
    expect(result).toBeNull();
  });

  test('GET /api/v1/return-reasons returns the workspace vocabulary', async () => {
    const reasons: ReturnReasonRecord[] = [
      { id: 1, code: 'size_wrong', label: 'Falsche Größe', isActive: true, sortOrder: 10 },
      { id: 2, code: 'defective', label: 'Defekt / Beschädigt', isActive: true, sortOrder: 30 },
    ];
    const ports: ServerApiPorts = { auth: {} as never, returnReasons: makeReasonsPort(reasons) };
    const result = await handleReturnsRoute(
      makeBaseRequest({ path: '/api/v1/return-reasons' }),
      ports,
    );
    expect(result?.status).toBe(200);
    expect((result?.body as { data: { items: ReturnReasonRecord[] } }).data.items).toEqual(reasons);
  });

  test('GET /api/v1/returns/analytics forwards an optional sinceDays window', async () => {
    const harness = makeReturnsPort();
    const ports: ServerApiPorts = { auth: {} as never, returns: harness.port };

    const noWindow = await handleReturnsRoute(
      makeBaseRequest({ path: '/api/v1/returns/analytics' }),
      ports,
    );
    expect(noWindow?.status).toBe(200);
    expect(harness.analyticsCalls).toEqual([{ input: { workspaceId: 'ws-1' } }]);

    const windowed = await handleReturnsRoute(
      makeBaseRequest({ path: '/api/v1/returns/analytics', query: { sinceDays: 90 } }),
      ports,
    );
    expect(windowed?.status).toBe(200);
    expect(harness.analyticsCalls[1]).toEqual({ input: { workspaceId: 'ws-1', sinceDays: 90 } });
  });

  test('GET /api/v1/returns/analytics rejects an out-of-range sinceDays', async () => {
    const ports: ServerApiPorts = { auth: {} as never, returns: makeReturnsPort().port };
    const bad = await handleReturnsRoute(
      makeBaseRequest({ path: '/api/v1/returns/analytics', query: { sinceDays: 0 } }),
      ports,
    );
    expect(bad?.status).toBe(400);
    expect((bad?.body as { error: { code: string } }).error.code).toBe('invalid_since_days');
  });

  test('the analytics path is matched before the :id detail route', async () => {
    const harness = makeReturnsPort();
    const ports: ServerApiPorts = { auth: {} as never, returns: harness.port };
    await handleReturnsRoute(makeBaseRequest({ path: '/api/v1/returns/analytics' }), ports);
    // It must hit analytics(), never get() with id parsed from "analytics".
    expect(harness.analyticsCalls).toHaveLength(1);
    expect(harness.getCalls).toHaveLength(0);
  });

  test('requires auth for every returns endpoint', async () => {
    const ports: ServerApiPorts = { auth: {} as never, returns: makeReturnsPort().port };
    for (const path of ['/api/v1/return-reasons', '/api/v1/returns', '/api/v1/returns/42']) {
      const result = await handleReturnsRoute(
        makeBaseRequest({ path, principal: undefined }),
        ports,
      );
      expect(result?.status).toBe(401);
    }
  });

  test('GET /api/v1/returns parses limit/offset/status/customerId/search and rejects bad values', async () => {
    const harness = makeReturnsPort();
    const ports: ServerApiPorts = { auth: {} as never, returns: harness.port };

    // happy path
    const ok = await handleReturnsRoute(
      makeBaseRequest({ query: { limit: 25, offset: 50, status: 'approved', customerId: 7, search: '  abc  ' } }),
      ports,
    );
    expect(ok?.status).toBe(200);
    expect(harness.listCalls).toEqual([{
      input: { workspaceId: 'ws-1', limit: 25, offset: 50, status: 'approved', customerId: 7, search: 'abc' },
    }]);

    // bad status
    const badStatus = await handleReturnsRoute(
      makeBaseRequest({ query: { status: 'whatever' } }),
      ports,
    );
    expect(badStatus?.status).toBe(400);
    expect((badStatus?.body as { error: { code: string } }).error.code).toBe('invalid_status');

    // limit out of range
    const badLimit = await handleReturnsRoute(
      makeBaseRequest({ query: { limit: 0 } }),
      ports,
    );
    expect((badLimit?.body as { error: { code: string } }).error.code).toBe('invalid_limit');

    const overLimit = await handleReturnsRoute(
      makeBaseRequest({ query: { limit: 999 } }),
      ports,
    );
    expect((overLimit?.body as { error: { code: string } }).error.code).toBe('invalid_limit');

    // negative offset
    const badOffset = await handleReturnsRoute(
      makeBaseRequest({ query: { offset: -1 } }),
      ports,
    );
    expect((badOffset?.body as { error: { code: string } }).error.code).toBe('invalid_offset');
  });

  test('GET /api/v1/returns/:id returns 404 when the port returns null', async () => {
    const harness = makeReturnsPort();
    const ports: ServerApiPorts = { auth: {} as never, returns: harness.port };
    const result = await handleReturnsRoute(
      makeBaseRequest({ path: '/api/v1/returns/42' }),
      ports,
    );
    expect(result?.status).toBe(404);
    expect(harness.getCalls).toEqual([{ input: { workspaceId: 'ws-1', id: 42 } }]);
  });

  test('GET /api/v1/returns/abc rejects non-numeric ids', async () => {
    const ports: ServerApiPorts = { auth: {} as never, returns: makeReturnsPort().port };
    const result = await handleReturnsRoute(
      makeBaseRequest({ path: '/api/v1/returns/abc' }),
      ports,
    );
    expect(result?.status).toBe(400);
    expect((result?.body as { error: { code: string } }).error.code).toBe('invalid_id');
  });

  test('POST /api/v1/returns rejects empty items and invalid quantities', async () => {
    const ports: ServerApiPorts = { auth: {} as never, returns: makeReturnsPort().port };

    const noItems = await handleReturnsRoute(
      makeBaseRequest({ method: 'POST', body: { items: [] } }),
      ports,
    );
    expect((noItems?.body as { error: { code: string } }).error.code).toBe('invalid_items');

    const zeroQty = await handleReturnsRoute(
      makeBaseRequest({ method: 'POST', body: { items: [{ quantity: 0 }] } }),
      ports,
    );
    expect((zeroQty?.body as { error: { code: string } }).error.code).toBe('invalid_quantity');

    const badCondition = await handleReturnsRoute(
      makeBaseRequest({
        method: 'POST',
        body: { items: [{ quantity: 1, condition: 'pristine' }] },
      }),
      ports,
    );
    expect((badCondition?.body as { error: { code: string } }).error.code).toBe('invalid_condition');
  });

  test('POST /api/v1/returns forwards a normalized payload and audits the create', async () => {
    const harness = makeReturnsPort();
    const auditCalls: Array<{ action: string; entityType: string; entityId: string; metadata: unknown }> = [];
    const ports: ServerApiPorts = {
      auth: {} as never,
      returns: harness.port,
      audit: {
        async record(input: { action: string; entityType: string; entityId: string; metadata: unknown }) {
          auditCalls.push({ action: input.action, entityType: input.entityType, entityId: input.entityId, metadata: input.metadata });
        },
      } as never,
    };
    const result = await handleReturnsRoute(
      makeBaseRequest({
        method: 'POST',
        body: {
          customerId: 7,
          jtlOrderNumber: '  EXT-1001  ',
          customerEmail: '  customer@example.com ',
          notes: 'Schicken Sie bitte...',
          items: [
            { sku: 'SKU-A', productName: 'Artikel A', quantity: 2.7, reasonId: 3, condition: 'opened' },
            { quantity: 1 },
          ],
        },
      }),
      ports,
    );
    expect(result?.status).toBe(201);
    expect(harness.createCalls).toHaveLength(1);
    const fwd = harness.createCalls[0]!.input;
    expect(fwd.workspaceId).toBe('ws-1');
    expect(fwd.actorUserId).toBe('user-1');
    expect(fwd.input.customerId).toBe(7);
    expect(fwd.input.jtlOrderNumber).toBe('EXT-1001');
    expect(fwd.input.customerEmail).toBe('customer@example.com');
    expect(fwd.input.notes).toBe('Schicken Sie bitte...');
    // Quantities floored, conditions normalized, defaults applied.
    expect(fwd.input.items).toEqual([
      { productId: undefined, reasonId: 3, sku: 'SKU-A', productName: 'Artikel A', quantity: 2, condition: 'opened', notes: null },
      { productId: undefined, reasonId: undefined, sku: null, productName: null, quantity: 1, condition: null, notes: null },
    ]);
    expect(auditCalls).toEqual([{
      action: 'returns.create',
      entityType: 'returns',
      entityId: '1',
      metadata: { returnNumber: 'R-FAKE0001' },
    }]);
  });

  test('POST /api/v1/returns surfaces a port-level error as 400 create_failed', async () => {
    const port: ReturnsApiPort = {
      async list() { return { items: [], totalCount: 0 }; },
      async get() { return null; },
      async create() { return { ok: false, error: 'something broke' }; },
      async update() { return { ok: true, record: makeRecord() }; },
      async analytics() { return { totalCount: 0, byStatus: [], byOutcome: [], topReasons: [], generatedAt: '' }; },
      async getPublicByReturnNumber() { return null; },
      async createPublic() { return { ok: false, error: 'unused' }; },
    };
    const ports: ServerApiPorts = { auth: {} as never, returns: port };
    const result = await handleReturnsRoute(
      makeBaseRequest({ method: 'POST', body: { items: [{ quantity: 1 }] } }),
      ports,
    );
    expect(result?.status).toBe(400);
    expect((result?.body as { error: { code: string; message: string } }).error)
      .toEqual({ code: 'create_failed', message: 'something broke' });
  });

  test('PATCH /api/v1/returns/:id validates status/outcome and requires at least one field', async () => {
    const harness = makeReturnsPort();
    const ports: ServerApiPorts = { auth: {} as never, returns: harness.port };

    const empty = await handleReturnsRoute(
      makeBaseRequest({ method: 'PATCH', path: '/api/v1/returns/1', body: {} }),
      ports,
    );
    expect((empty?.body as { error: { code: string } }).error.code).toBe('empty_update');

    const badStatus = await handleReturnsRoute(
      makeBaseRequest({ method: 'PATCH', path: '/api/v1/returns/1', body: { status: 'archived' } }),
      ports,
    );
    expect((badStatus?.body as { error: { code: string } }).error.code).toBe('invalid_status');

    const badOutcome = await handleReturnsRoute(
      makeBaseRequest({ method: 'PATCH', path: '/api/v1/returns/1', body: { outcome: 'cashback' } }),
      ports,
    );
    expect((badOutcome?.body as { error: { code: string } }).error.code).toBe('invalid_outcome');
  });

  test('PATCH /api/v1/returns/:id forwards a valid update and returns 200 with the updated record', async () => {
    const harness = makeReturnsPort();
    const ports: ServerApiPorts = { auth: {} as never, returns: harness.port };
    const result = await handleReturnsRoute(
      makeBaseRequest({
        method: 'PATCH',
        path: '/api/v1/returns/77',
        body: { status: 'received', outcome: 'exchange', notes: 'Pakete eingetroffen' },
      }),
      ports,
    );
    expect(result?.status).toBe(200);
    expect(harness.updateCalls).toEqual([{
      input: {
        workspaceId: 'ws-1',
        actorUserId: 'user-1',
        id: 77,
        update: { status: 'received', outcome: 'exchange', notes: 'Pakete eingetroffen' },
      },
    }]);
    const body = (result?.body as { data: ReturnRecord }).data;
    expect(body.status).toBe('received');
  });

  test('PATCH /api/v1/returns/:id maps the port-level not-found error to a 404', async () => {
    const port: ReturnsApiPort = {
      async list() { return { items: [], totalCount: 0 }; },
      async get() { return null; },
      async create() { return { ok: false, error: 'x' }; },
      async update() { return { ok: false, error: 'Retoure nicht gefunden' }; },
      async analytics() { return { totalCount: 0, byStatus: [], byOutcome: [], topReasons: [], generatedAt: '' }; },
      async getPublicByReturnNumber() { return null; },
      async createPublic() { return { ok: false, error: 'unused' }; },
    };
    const ports: ServerApiPorts = { auth: {} as never, returns: port };
    const result = await handleReturnsRoute(
      makeBaseRequest({ method: 'PATCH', path: '/api/v1/returns/999', body: { status: 'cancelled' } }),
      ports,
    );
    expect(result?.status).toBe(404);
    expect((result?.body as { error: { code: string } }).error.code).toBe('return_not_found');
  });

  test('endpoints respond with 405 for unsupported methods', async () => {
    const ports: ServerApiPorts = { auth: {} as never, returns: makeReturnsPort().port };
    const reasonsBad = await handleReturnsRoute(
      makeBaseRequest({ method: 'POST', path: '/api/v1/return-reasons', body: {} }),
      ports,
    );
    expect(reasonsBad?.status).toBe(405);
    const listBad = await handleReturnsRoute(
      makeBaseRequest({ method: 'DELETE', path: '/api/v1/returns' }),
      ports,
    );
    expect(listBad?.status).toBe(405);
    const detailBad = await handleReturnsRoute(
      makeBaseRequest({ method: 'POST', path: '/api/v1/returns/1' }),
      ports,
    );
    expect(detailBad?.status).toBe(405);
  });

  test('returns 503 when the corresponding port is not configured (graceful degradation)', async () => {
    const ports: ServerApiPorts = { auth: {} as never };
    const list = await handleReturnsRoute(makeBaseRequest({ path: '/api/v1/returns' }), ports);
    expect(list?.status).toBe(503);
    const reasons = await handleReturnsRoute(makeBaseRequest({ path: '/api/v1/return-reasons' }), ports);
    expect(reasons?.status).toBe(503);
  });
});
