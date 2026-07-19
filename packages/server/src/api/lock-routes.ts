import type { ConversationLockReason } from '../locks';
import type { ApiRequest, ApiResponse, CanonicalApiRoute, ServerApiPorts } from './types';
import {
  data,
  error,
  getStringField,
  positiveIntFromPath,
  requireAdmin,
  requirePrincipal,
} from './http';

const LOCK_RE = /^\/api\/v1\/locks\/(\d+)(?:\/(heartbeat|takeover))?$/;
const LOCK_REASONS: readonly ConversationLockReason[] = ['reply', 'forward', 'edit'];

export const MAIL_LOCK_ROUTE_INVENTORY: readonly CanonicalApiRoute[] = Object.freeze([
  lockRoute('GET', '/api/v1/locks', /^\/api\/v1\/locks$/),
  lockRoute('GET', '/api/v1/locks/:messageId', /^\/api\/v1\/locks\/(\d+)$/),
  lockRoute('POST', '/api/v1/locks/:messageId', /^\/api\/v1\/locks\/(\d+)$/),
  lockRoute('DELETE', '/api/v1/locks/:messageId', /^\/api\/v1\/locks\/(\d+)$/),
  lockRoute('PATCH', '/api/v1/locks/:messageId/heartbeat', /^\/api\/v1\/locks\/(\d+)\/heartbeat$/),
  lockRoute('POST', '/api/v1/locks/:messageId/takeover', /^\/api\/v1\/locks\/(\d+)\/takeover$/),
]);

function lockRoute(method: ApiRequest['method'], path: string, pattern: RegExp): CanonicalApiRoute {
  return { source: 'lock-routes', method, path, pattern };
}

export async function handleLockRoute(
  req: ApiRequest,
  ports: ServerApiPorts,
): Promise<ApiResponse | null> {
  if (req.path === '/api/v1/locks') {
    const principal = requirePrincipal(req);
    if ('status' in principal) return principal;
    if (req.method !== 'GET') return error(405, 'method_not_allowed', 'Methode fuer Lock-Route nicht erlaubt');
    const messageIds = parseMessageIds(req.query?.messageIds);
    if (messageIds === null) {
      return error(400, 'validation_error', 'messageIds muss eine kommagetrennte Liste positiver Ganzzahlen sein');
    }
    const locks = await ports.locks.list({
      messageIds,
      workspaceId: principal.workspaceId,
    });
    return data(200, { locks });
  }

  const match = LOCK_RE.exec(req.path);
  if (!match) return null;

  const messageId = positiveIntFromPath(match[1]);
  if (messageId == null) {
    return error(400, 'validation_error', 'messageId muss eine positive Ganzzahl sein');
  }

  const suffix = match[2];
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;

  if (!suffix && req.method === 'GET') {
    const lock = await ports.locks.get({ messageId, workspaceId: principal.workspaceId });
    return data(200, { lock });
  }

  if (!suffix && req.method === 'POST') {
    const reason = parseReason(getStringField(req.body, 'reason')) ?? 'reply';
    const result = await ports.locks.acquire({
      messageId,
      userId: principal.userId,
      workspaceId: principal.workspaceId,
      reason,
    });
    if (!result.ok) {
      return error(409, 'conversation_locked', 'Nachricht ist bereits gesperrt', {
        lock: result.existing,
      });
    }
    await publishLockEvent(ports, 'conversation_lock.acquired', result.lock, principal.userId);
    return data(201, { lock: result.lock });
  }

  if (suffix === 'heartbeat' && req.method === 'PATCH') {
    const lock = await ports.locks.heartbeat({
      messageId,
      userId: principal.userId,
      workspaceId: principal.workspaceId,
    });
    if (!lock) {
      return error(404, 'lock_not_found', 'Sperre nicht gefunden');
    }
    await publishLockEvent(ports, 'conversation_lock.heartbeat', lock, principal.userId);
    return data(200, { lock });
  }

  if (!suffix && req.method === 'DELETE') {
    const lock = await ports.locks.release({
      messageId,
      userId: principal.userId,
      workspaceId: principal.workspaceId,
      allowAdminOverride: requireAdmin(principal),
    });
    if (!lock) {
      return error(404, 'lock_not_found', 'Sperre nicht gefunden');
    }
    await publishLockEvent(ports, 'conversation_lock.released', lock, principal.userId);
    return data(200, { released: true, lock });
  }

  if (suffix === 'takeover' && req.method === 'POST') {
    if (!requireAdmin(principal)) {
      return error(403, 'forbidden', 'Nur Admins dürfen Sperren übernehmen');
    }
    const reason = parseReason(getStringField(req.body, 'reason')) ?? 'reply';
    const lock = await ports.locks.forceTakeover({
      messageId,
      newUserId: principal.userId,
      workspaceId: principal.workspaceId,
      reason,
    });
    await ports.audit?.record({
      workspaceId: principal.workspaceId,
      actorUserId: principal.userId,
      action: 'conversation_lock.force_takeover',
      entityType: 'email_message',
      entityId: String(messageId),
      metadata: {
        messageId,
        reason,
        takeoverCount: lock.takeoverCount,
        newUserId: principal.userId,
      },
    });
    await publishLockEvent(ports, 'conversation_lock.force_takeover', lock, principal.userId);
    return data(200, { lock });
  }

  return error(405, 'method_not_allowed', 'Methode für Lock-Route nicht erlaubt');
}

function parseReason(value: string | null): ConversationLockReason | null {
  if (!value) return null;
  return LOCK_REASONS.includes(value as ConversationLockReason)
    ? (value as ConversationLockReason)
    : null;
}

function parseMessageIds(raw: string | undefined): number[] | null {
  if (!raw?.trim()) return [];
  const ids: number[] = [];
  for (const part of raw.split(',')) {
    const value = Number(part.trim());
    if (!Number.isSafeInteger(value) || value <= 0) return null;
    if (!ids.includes(value)) ids.push(value);
    if (ids.length > 500) return null;
  }
  return ids;
}

async function publishLockEvent(
  ports: ServerApiPorts,
  type: 'conversation_lock.acquired'
    | 'conversation_lock.heartbeat'
    | 'conversation_lock.released'
    | 'conversation_lock.force_takeover',
  lock: { messageId: number; workspaceId: string; userId: string; reason: ConversationLockReason; takeoverCount: number },
  actorUserId: string,
): Promise<void> {
  await ports.events?.publish({
    type,
    workspaceId: lock.workspaceId,
    entityType: 'email_message',
    entityId: String(lock.messageId),
    actorUserId,
    occurredAt: new Date().toISOString(),
    payload: {
      messageId: lock.messageId,
      lockUserId: lock.userId,
      reason: lock.reason,
      takeoverCount: lock.takeoverCount,
    },
  });
}
