import type { ApiRequest, ApiResponse, ServerApiPorts } from './types';
import { data, error, requireAdmin, requirePrincipal } from './types';

const MAX_LOG_LIMIT = 5000;
const DEFAULT_LOG_LIMIT = 1000;

export async function handleDiagnosticsRoute(
  req: ApiRequest,
  ports: ServerApiPorts,
): Promise<ApiResponse | null> {
  if (
    req.path !== '/api/v1/diagnostics/server-logs'
    && req.path !== '/api/v1/diagnostics/server-logs/clear'
    && req.path !== '/api/v1/diagnostics/server-logs/self-test'
  ) {
    return null;
  }

  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  if (!requireAdmin(principal)) return error(403, 'forbidden', 'Adminrechte erforderlich');
  if (!ports.serverLogs) return error(503, 'server_logs_unavailable', 'Server-Log-Diagnose ist nicht konfiguriert');

  if (req.path === '/api/v1/diagnostics/server-logs/clear') {
    if (req.method !== 'POST') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
    ports.serverLogs.clear();
    return data(200, { cleared: true });
  }

  if (req.path === '/api/v1/diagnostics/server-logs/self-test') {
    if (req.method !== 'POST') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
    const written = ports.serverLogs.selfTest();
    return data(200, { written });
  }

  if (req.method !== 'GET') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');

  const level = parseLevel(req.query?.level);
  if (level === null) return error(400, 'invalid_level', 'level muss info, warn, error oder fatal sein');
  const limit = parseLimit(req.query?.limit);
  if (limit === null) return error(400, 'invalid_limit', `limit muss zwischen 1 und ${MAX_LOG_LIMIT} liegen`);

  const items = ports.serverLogs.recent({
    ...(level === undefined ? {} : { level }),
    ...(limit === undefined ? {} : { limit }),
  });
  return data(200, { items, total: items.length });
}

function parseLevel(value: string | undefined): 'info' | 'warn' | 'error' | 'fatal' | undefined | null {
  if (value === undefined || value === '') return undefined;
  if (value === 'info' || value === 'warn' || value === 'error' || value === 'fatal') return value;
  return null;
}

function parseLimit(value: string | undefined): number | undefined | null {
  if (value === undefined || value === '') return DEFAULT_LOG_LIMIT;
  if (!/^[1-9]\d*$/.test(value)) return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > MAX_LOG_LIMIT) return null;
  return parsed;
}
