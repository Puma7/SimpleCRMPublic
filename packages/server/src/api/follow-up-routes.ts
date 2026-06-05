import type {
  ApiErrorBody,
  ApiRequest,
  ApiResponse,
  ServerApiPorts,
} from './types';
import {
  data,
  error,
  positiveIntFromPath,
  requirePrincipal,
} from './types';

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 100;

export async function handleFollowUpRoute(
  req: ApiRequest,
  ports: ServerApiPorts,
): Promise<ApiResponse | null> {
  if (!req.path.startsWith('/api/v1/follow-up')) return null;
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  if (!ports.followUp) return error(503, 'follow_up_unavailable', 'Follow-up API nicht konfiguriert');

  if (req.path === '/api/v1/follow-up/queue-counts') {
    if (req.method !== 'GET') return methodNotAllowed();
    return data(200, await ports.followUp.getQueueCounts({
      workspaceId: principal.workspaceId,
    }));
  }

  if (req.path === '/api/v1/follow-up/items') {
    if (req.method !== 'GET') return methodNotAllowed();
    const limit = parseLimit(req.query?.limit);
    if (limit === null) return invalidLimit();
    const offset = parseOffset(req.query?.offset);
    if (offset === null) return error(400, 'invalid_offset', 'offset muss eine nicht-negative Ganzzahl sein');
    const queue = normalizeQueue(req.query?.queue);
    if (queue === null) return error(400, 'invalid_queue', 'queue ist erforderlich');
    const query = normalizeOptionalText(req.query?.query, 200);
    if (query === null) return error(400, 'invalid_query', 'query darf maximal 200 Zeichen haben');
    const priority = normalizeOptionalText(req.query?.priority, 50);
    if (priority === null) return error(400, 'invalid_priority', 'priority darf maximal 50 Zeichen haben');
    return data(200, await ports.followUp.getItems({
      workspaceId: principal.workspaceId,
      queue,
      filters: {
        ...(query === undefined ? {} : { query }),
        ...(priority === undefined ? {} : { priority }),
      },
      limit,
      offset,
    }));
  }

  const snoozeMatch = /^\/api\/v1\/follow-up\/tasks\/([^/]+)\/snooze$/.exec(req.path);
  if (snoozeMatch) {
    if (req.method !== 'PATCH') return methodNotAllowed();
    const taskId = positiveIntFromPath(snoozeMatch[1]);
    if (taskId === null) return error(400, 'invalid_task_id', 'task id muss eine positive Ganzzahl sein');
    const parsed = parseSnoozeBody(req.body);
    if (!parsed.ok) return parsed.response;
    return data(200, await ports.followUp.snoozeTask({
      workspaceId: principal.workspaceId,
      actorUserId: principal.userId,
      taskId,
      snoozedUntil: parsed.snoozedUntil,
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

function parseOffset(value: string | undefined): number | null {
  if (value === undefined || value === '') return 0;
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function normalizeQueue(value: string | undefined): string | null {
  const queue = value?.trim();
  if (!queue) return null;
  return queue;
}

function normalizeOptionalText(value: string | undefined, maxLength: number): string | undefined | null {
  if (value === undefined) return undefined;
  const normalized = value.trim();
  if (!normalized) return undefined;
  return normalized.length <= maxLength ? normalized : null;
}

function parseSnoozeBody(body: unknown): { ok: true; snoozedUntil: string } | { ok: false; response: ApiResponse<ApiErrorBody> } {
  if (!body || typeof body !== 'object') {
    return { ok: false, response: error(400, 'invalid_snooze_payload', 'Snooze-Payload muss ein JSON-Objekt sein') };
  }
  const value = (body as Record<string, unknown>).snoozedUntil;
  if (typeof value !== 'string' || !value.trim()) {
    return { ok: false, response: error(400, 'validation_error', 'snoozedUntil ist erforderlich') };
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return { ok: false, response: error(400, 'validation_error', 'snoozedUntil muss ein gueltiger ISO-Zeitpunkt sein') };
  }
  return { ok: true, snoozedUntil: parsed.toISOString() };
}

function methodNotAllowed(): ApiResponse {
  return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
}

function invalidLimit(): ApiResponse {
  return error(400, 'invalid_limit', `limit muss zwischen 1 und ${MAX_LIMIT} liegen`);
}
