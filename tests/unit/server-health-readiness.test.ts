import {
  createServerApi,
  type AuthApiPort,
  type HealthCheckApiPort,
  type ServerApiPorts,
} from '../../packages/server/src';

// Readiness probe (`/health/ready`) must verify database connectivity so the
// container is only "healthy" when it can serve requests. Liveness (`/health`)
// must stay shallow and never touch the database.
describe('server health readiness probe', () => {
  test('returns 200 with database ok when the health port resolves', async () => {
    const pingDatabase = jest.fn(async () => {});
    const api = createServerApi(ports({ health: healthPort(pingDatabase) }));

    const res = await api.handle({ method: 'GET', path: '/health/ready' });

    expect(res.status).toBe(200);
    expect((res.body as any).data).toMatchObject({
      api: 'simplecrm-server',
      checks: { database: 'ok' },
    });
    expect(pingDatabase).toHaveBeenCalledTimes(1);
  });

  test('returns 503 when the database ping rejects', async () => {
    const pingDatabase = jest.fn(async () => {
      throw new Error('connection refused');
    });
    const api = createServerApi(ports({ health: healthPort(pingDatabase) }));

    const res = await api.handle({ method: 'GET', path: '/api/v1/health/ready' });

    expect(res.status).toBe(503);
    expect((res.body as any).error.code).toBe('database_unavailable');
  });

  test('degrades to a shallow ok when no health port is configured', async () => {
    const api = createServerApi(ports({ health: undefined }));

    const res = await api.handle({ method: 'GET', path: '/health/ready' });

    expect(res.status).toBe(200);
    expect((res.body as any).data).toMatchObject({ checks: { database: 'skipped' } });
  });

  test('rejects non-GET methods on the readiness route', async () => {
    const pingDatabase = jest.fn(async () => {});
    const api = createServerApi(ports({ health: healthPort(pingDatabase) }));

    const res = await api.handle({ method: 'POST', path: '/health/ready' });

    expect(res.status).toBe(405);
    expect(pingDatabase).not.toHaveBeenCalled();
  });

  test('liveness /health stays shallow and never calls the database', async () => {
    const pingDatabase = jest.fn(async () => {});
    const api = createServerApi(ports({ health: healthPort(pingDatabase) }));

    const res = await api.handle({ method: 'GET', path: '/health' });

    expect(res.status).toBe(200);
    expect((res.body as any).data).toMatchObject({ api: 'simplecrm-server' });
    expect(pingDatabase).not.toHaveBeenCalled();
  });
});

function healthPort(pingDatabase: () => Promise<void>): HealthCheckApiPort {
  return { pingDatabase };
}

function ports(overrides: Partial<ServerApiPorts>): ServerApiPorts {
  return {
    auth: {} as AuthApiPort,
    locks: {} as ServerApiPorts['locks'],
    ...overrides,
  };
}
