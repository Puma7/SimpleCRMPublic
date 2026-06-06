import {
  createServerApi,
  type AuthApiPort,
  type ServerApiPorts,
  type ServerLogReadPort,
} from '../../packages/server/src';

describe('server diagnostics (server logs) API', () => {
  const admin = { userId: 'u1', workspaceId: 'ws-1', role: 'owner' as const };
  const member = { userId: 'u2', workspaceId: 'ws-1', role: 'user' as const };

  test('returns recent log entries to admins', async () => {
    const logs = logPort();
    const api = createServerApi(ports({ serverLogs: logs }));
    const res = await api.handle({ method: 'GET', path: '/api/v1/diagnostics/server-logs', principal: admin });
    expect(res.status).toBe(200);
    expect((res.body as any).data.items[0]).toMatchObject({ level: 'error', message: 'boom' });
    expect(logs.recent).toHaveBeenCalledWith({ limit: 1000 });
  });

  test('passes level and limit filters through', async () => {
    const logs = logPort();
    const api = createServerApi(ports({ serverLogs: logs }));
    await api.handle({ method: 'GET', path: '/api/v1/diagnostics/server-logs', query: { level: 'error', limit: '50' }, principal: admin });
    expect(logs.recent).toHaveBeenCalledWith({ level: 'error', limit: 50 });
  });

  test('rejects an invalid level', async () => {
    const api = createServerApi(ports({ serverLogs: logPort() }));
    const res = await api.handle({ method: 'GET', path: '/api/v1/diagnostics/server-logs', query: { level: 'info' }, principal: admin });
    expect(res.status).toBe(400);
  });

  test('requires admin', async () => {
    const logs = logPort();
    const api = createServerApi(ports({ serverLogs: logs }));
    const res = await api.handle({ method: 'GET', path: '/api/v1/diagnostics/server-logs', principal: member });
    expect(res.status).toBe(403);
    expect(logs.recent).not.toHaveBeenCalled();
  });

  test('clears the log on POST /clear (admin)', async () => {
    const logs = logPort();
    const api = createServerApi(ports({ serverLogs: logs }));
    const res = await api.handle({ method: 'POST', path: '/api/v1/diagnostics/server-logs/clear', principal: admin });
    expect(res.status).toBe(200);
    expect(logs.clear).toHaveBeenCalledTimes(1);
  });

  test('503 when the server log port is not configured', async () => {
    const api = createServerApi(ports({ serverLogs: undefined }));
    const res = await api.handle({ method: 'GET', path: '/api/v1/diagnostics/server-logs', principal: admin });
    expect(res.status).toBe(503);
  });
});

function logPort(): jest.Mocked<ServerLogReadPort> {
  return {
    recent: jest.fn(() => [
      { time: '2026-07-08T10:00:00.000Z', level: 'error', message: 'boom', source: 'console' },
    ]),
    clear: jest.fn(),
    count: jest.fn(() => 1),
  };
}

function ports(overrides: Partial<ServerApiPorts>): ServerApiPorts {
  return {
    auth: {} as AuthApiPort,
    locks: {} as ServerApiPorts['locks'],
    ...overrides,
  };
}
