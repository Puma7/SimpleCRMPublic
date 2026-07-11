import type {
  ApiRequest,
  ApiResponse,
  ServerApiPorts,
} from './types';
import {
  data,
  error,
  requirePrincipal,
} from './http';

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 25;

export async function handleDashboardRoute(
  req: ApiRequest,
  ports: ServerApiPorts,
): Promise<ApiResponse | null> {
  if (!req.path.startsWith('/api/v1/dashboard')) return null;
  if (req.method !== 'GET') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');

  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  if (!ports.dashboard) return error(503, 'dashboard_unavailable', 'Dashboard API nicht konfiguriert');

  if (req.path === '/api/v1/dashboard/stats') {
    return data(200, await ports.dashboard.getStats({
      workspaceId: principal.workspaceId,
    }));
  }

  if (req.path === '/api/v1/dashboard/recent-customers') {
    const limit = parseLimit(req.query?.limit);
    if (limit === null) return invalidLimit();
    return data(200, await ports.dashboard.getRecentCustomers({
      workspaceId: principal.workspaceId,
      limit,
    }));
  }

  if (req.path === '/api/v1/dashboard/upcoming-tasks') {
    const limit = parseLimit(req.query?.limit);
    if (limit === null) return invalidLimit();
    return data(200, await ports.dashboard.getUpcomingTasks({
      workspaceId: principal.workspaceId,
      limit,
    }));
  }

  return error(404, 'not_found', 'Route nicht gefunden');
}

function parseLimit(value: string | undefined): number | null {
  if (value === undefined || value === '') return DEFAULT_LIMIT;
  if (!/^[1-9]\d*$/.test(value)) return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > MAX_LIMIT) return null;
  return parsed;
}

function invalidLimit(): ApiResponse {
  return error(400, 'invalid_limit', `limit muss zwischen 1 und ${MAX_LIMIT} liegen`);
}
