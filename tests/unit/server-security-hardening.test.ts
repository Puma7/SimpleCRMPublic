import { createServerApi } from '../../packages/server/src/api/server-api';
import type { ServerApiPorts } from '../../packages/server/src/api/types';
import { rejectUnlessCrmWrite } from '../../packages/server/src/api/http';
import { ilikeContainsPattern } from '../../packages/server/src/db/sql-ilike';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';

describe('server security hardening', () => {
  test('rejectUnlessCrmWrite blocks ordinary users without crm.write', () => {
    const denied = rejectUnlessCrmWrite({
      userId: USER_ID,
      workspaceId: WORKSPACE_ID,
      role: 'user',
      capabilities: [],
    });
    expect(denied?.status).toBe(403);
  });

  test('rejectUnlessCrmWrite allows delegated CRM writers', () => {
    expect(rejectUnlessCrmWrite({
      userId: USER_ID,
      workspaceId: WORKSPACE_ID,
      role: 'user',
      capabilities: ['crm.write'],
    })).toBeNull();
  });

  test('customer create requires crm.write capability', async () => {
    const ports = {
      customers: {
        create: jest.fn(),
      },
    } as unknown as ServerApiPorts;
    const api = createServerApi(ports);
    const response = await api.handle({
      method: 'POST',
      path: '/api/v1/customers',
      principal: {
        userId: USER_ID,
        workspaceId: WORKSPACE_ID,
        role: 'user',
        capabilities: [],
      },
      body: { name: 'Acme', status: 'active' },
    });
    expect(response.status).toBe(403);
    expect(ports.customers.create).not.toHaveBeenCalled();
  });

  test('ilikeContainsPattern escapes SQL wildcards', () => {
    expect(ilikeContainsPattern('100%_done')).toBe('%100\\%\\_done%');
  });

  test('workflow list requires workflows.manage capability', async () => {
    const ports = {
      workflows: {
        list: jest.fn(),
      },
    } as unknown as ServerApiPorts;
    const api = createServerApi(ports);
    const response = await api.handle({
      method: 'GET',
      path: '/api/v1/workflows',
      principal: {
        userId: USER_ID,
        workspaceId: WORKSPACE_ID,
        role: 'user',
        capabilities: [],
      },
    });
    expect(response.status).toBe(403);
    expect(ports.workflows.list).not.toHaveBeenCalled();
  });
});
