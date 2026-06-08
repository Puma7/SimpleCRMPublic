import { handleMaintenanceRoute } from '../../packages/server/src/api/maintenance-routes';
import type { ServerApiPorts } from '../../packages/server/src/api/types';

const OWNER = {
  userId: 'user-1',
  workspaceId: 'ws-1',
  role: 'owner' as const,
};

const ADMIN = {
  userId: 'user-2',
  workspaceId: 'ws-1',
  role: 'admin' as const,
};

function makePorts(overrides: Partial<NonNullable<ServerApiPorts['maintenance']>> = {}): ServerApiPorts {
  return {
    auth: {} as ServerApiPorts['auth'],
    locks: {} as ServerApiPorts['locks'],
    maintenance: {
      async getStatus() {
        return { edition: 'server', appVersion: '1.0.0', needsInitialSetup: false };
      },
      async runDoctor() {
        return { status: 'ok', checks: [] };
      },
      async checkMigrations() {
        return { tableName: 'simplecrm_schema_migrations', appliedIds: [], pendingIds: [], items: [] };
      },
      async applyMigrations() {
        return { appliedIds: [], skippedIds: [] };
      },
      async previewHardReset() {
        return {
          tableCount: 3,
          tables: ['users', 'workspaces', 'email_messages'],
          attachmentsRoot: '/attachments',
          auditArchiveRoot: null,
          willRequireInitialSetup: true,
        };
      },
      async executeHardReset() {
        return { truncatedTables: 3 };
      },
      ...overrides,
    },
  };
}

describe('handleMaintenanceRoute', () => {
  test('requires authentication', async () => {
    const response = await handleMaintenanceRoute(
      { method: 'GET', path: '/api/v1/maintenance/status' },
      makePorts(),
    );
    expect(response?.status).toBe(401);
  });

  test('allows admin to read status', async () => {
    const response = await handleMaintenanceRoute(
      { method: 'GET', path: '/api/v1/maintenance/status', principal: ADMIN },
      makePorts(),
    );
    expect(response?.status).toBe(200);
    expect((response?.body as any).data.edition).toBe('server');
  });

  test('hard reset execute requires owner and confirm phrase', async () => {
    const executeHardReset = jest.fn(async () => ({ truncatedTables: 1 }));
    const ports = makePorts({ executeHardReset });

    const forbidden = await handleMaintenanceRoute(
      {
        method: 'POST',
        path: '/api/v1/maintenance/reset/execute',
        principal: ADMIN,
        body: { acknowledgeDataLoss: true, confirmPhrase: 'SYSTEM LÖSCHEN' },
      },
      ports,
    );
    expect(forbidden?.status).toBe(403);

    const invalidPhrase = await handleMaintenanceRoute(
      {
        method: 'POST',
        path: '/api/v1/maintenance/reset/execute',
        principal: OWNER,
        body: { acknowledgeDataLoss: true, confirmPhrase: 'WRONG' },
      },
      ports,
    );
    expect(invalidPhrase?.status).toBe(400);

    const ok = await handleMaintenanceRoute(
      {
        method: 'POST',
        path: '/api/v1/maintenance/reset/execute',
        principal: OWNER,
        body: { acknowledgeDataLoss: true, confirmPhrase: 'SYSTEM LÖSCHEN' },
      },
      ports,
    );
    expect(ok?.status).toBe(200);
    expect(executeHardReset).toHaveBeenCalledTimes(1);
  });
});
