import { createServerApi } from '../../packages/server/src/api/server-api';
import {
  CRM_API_ROOT_SEGMENTS,
  isCrmApiPath,
} from '../../packages/server/src/api/crm-route-inventory';
import type { ServerApiPorts } from '../../packages/server/src/api/types';

const WORKSPACE = '11111111-1111-4111-8111-111111111111';

/**
 * Regression: `crm.read` war zwar als Gruppenrecht waehlbar, wurde aber nirgends
 * durchgesetzt — nur die Schreibpfade pruefen `crm.write`. Ein gewoehnlicher
 * Server-Nutzer ohne jede CRM-Stufe konnte damit saemtliche Kunden, Deals,
 * Aufgaben, das Dashboard und die Retouren lesen; die im Gruppenpanel
 * angebotene Stufe „Keins" bewirkte keinen Lesenentzug.
 */
describe('crm.read gate', () => {
  const emptyPorts = {} as ServerApiPorts;

  const readPaths = [
    '/api/v1/customers',
    '/api/v1/customers/7',
    '/api/v1/deals',
    '/api/v1/deals/3/products',
    '/api/v1/tasks',
    '/api/v1/products',
    '/api/v1/deal-products/5',
    '/api/v1/activity-log',
    '/api/v1/calendar-events',
    '/api/v1/calendar-entries',
    '/api/v1/customer-custom-fields',
    '/api/v1/customer-custom-field-values',
    '/api/v1/saved-views',
    '/api/v1/jtl/orders',
    '/api/v1/dashboard/stats',
    '/api/v1/dashboard/recent-customers',
    '/api/v1/follow-up/items',
    '/api/v1/returns',
    '/api/v1/return-reasons',
  ] as const;

  test('every CRM read path is 403 without the grant', async () => {
    const api = createServerApi(emptyPorts);
    const statuses = await Promise.all(readPaths.map(async (path) => {
      const res = await api.handle({
        method: 'GET',
        path,
        principal: { userId: 'user-a', workspaceId: WORKSPACE, role: 'user' },
      });
      return { path, status: res.status };
    }));
    expect(statuses).toEqual(readPaths.map((path) => ({ path, status: 403 })));
  });

  test('an unauthenticated request still gets 401, not 403', async () => {
    const api = createServerApi(emptyPorts);
    const res = await api.handle({ method: 'GET', path: '/api/v1/customers' });
    expect(res.status).toBe(401);
  });

  test('crm.write implies crm.read — the gate must not block writers', async () => {
    // Die Capability-Liste im Principal ist bereits expandiert; zusaetzlich
    // faengt requireCapability den Fall defensiv ab.
    const api = createServerApi(emptyPorts);
    for (const capabilities of [['crm.read'], ['crm.write'], ['crm.read', 'crm.write']]) {
      const res = await api.handle({
        method: 'GET',
        path: '/api/v1/customers',
        principal: { userId: 'user-a', workspaceId: WORKSPACE, role: 'user', capabilities },
      });
      // 503 = Gate passiert, nur der Port fehlt in diesem Minimal-Setup.
      expect({ capabilities, status: res.status }).toEqual({ capabilities, status: 503 });
    }
  });

  test('admins and owners pass without an explicit grant', async () => {
    const api = createServerApi(emptyPorts);
    for (const role of ['admin', 'owner'] as const) {
      const res = await api.handle({
        method: 'GET',
        path: '/api/v1/customers',
        principal: { userId: 'user-a', workspaceId: WORKSPACE, role },
      });
      expect({ role, status: res.status }).toEqual({ role, status: 503 });
    }
  });

  test('the public returns portal stays reachable without a principal', () => {
    // Das Portal hat absichtlich keinen Principal — waere es vom Gate erfasst,
    // antwortete es ab sofort mit 401.
    expect(isCrmApiPath('/api/v1/portal/returns/abc')).toBe(false);
    expect(isCrmApiPath('/api/v1/portal/returns/abc/status')).toBe(false);
  });

  test('non-CRM paths are untouched', () => {
    for (const path of [
      '/api/v1/email/messages',
      '/api/v1/auth/capabilities',
      '/api/v1/workflows',
      '/api/v1/users',
      '/health',
      '/api/v1/customersomething',
    ]) {
      expect({ path, crm: isCrmApiPath(path) }).toEqual({ path, crm: false });
    }
  });

  test('the inventory matches the segments and ignores a query string', () => {
    for (const segment of CRM_API_ROOT_SEGMENTS) {
      expect({ segment, crm: isCrmApiPath(`/api/v1/${segment}`) }).toEqual({ segment, crm: true });
      expect({ segment, crm: isCrmApiPath(`/api/v1/${segment}?limit=10`) })
        .toEqual({ segment, crm: true });
    }
    expect(isCrmApiPath('')).toBe(false);
    expect(isCrmApiPath('/api/v1/')).toBe(false);
  });
});
