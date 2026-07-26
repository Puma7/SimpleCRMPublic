import type {
  ApiRequest,
  ApiResponse,
  ServerApiPorts,
} from './types';
import {
  data,
  error,
  positiveIntFromPath,
  requireAdmin,
  requirePrincipal,
} from './http';

const EXPLAIN_PATH = '/api/v1/email/access/explain';

/**
 * Admin diagnosis: why can user X see / not see message Y?
 * GET /api/v1/email/access/explain?userId=&messageId=
 */
export async function handleMailAccessExplainRoute(
  req: ApiRequest,
  ports: ServerApiPorts,
): Promise<ApiResponse | null> {
  const pathOnly = (req.path.split('?')[0] ?? req.path);
  if (pathOnly !== EXPLAIN_PATH) return null;
  if (req.method !== 'GET') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');

  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  if (!requireAdmin(principal)) {
    return error(403, 'forbidden', 'Adminrechte erforderlich');
  }
  if (!ports.mailAccess || !ports.mailResourceLookup) {
    return error(503, 'mail_access_unavailable', 'Mail-Zugriff ist nicht konfiguriert');
  }

  const query = queryParams(req);
  const userId = query.userId ?? '';
  const messageId = positiveIntFromPath(query.messageId);
  if (!userId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) {
    return error(400, 'invalid_user_id', 'userId muss eine UUID sein');
  }
  if (messageId === null) {
    return error(400, 'invalid_message_id', 'messageId muss eine positive Ganzzahl sein');
  }

  const targetRole = await resolveTargetUserRole(ports, principal.workspaceId, userId);
  if (!targetRole) {
    return data(200, {
      visible: false,
      reason: 'Benutzer nicht gefunden',
      messageId,
      userId,
    });
  }
  const resources = await ports.mailResourceLookup.resolve({
    workspaceId: principal.workspaceId,
    target: { kind: 'message', id: messageId },
  });
  const messageResource = resources.find((resource) => resource.type === 'message');
  if (!messageResource || messageResource.type !== 'message') {
    return data(200, {
      visible: false,
      reason: 'Nachricht nicht gefunden',
      messageId,
      userId,
      role: targetRole,
    });
  }

  if (targetRole === 'owner' || targetRole === 'admin') {
    return data(200, {
      visible: true,
      reason: targetRole === 'owner'
        ? 'Owner sieht alle Nachrichten im Workspace'
        : 'Admin sieht alle Nachrichten im Workspace',
      messageId,
      userId,
      role: targetRole,
      resource: messageResource,
    });
  }

  const explainFn = (ports.mailAccess as {
    explainMessageVisibility?: (input: {
      workspaceId: string;
      userId: string;
      resource: typeof messageResource;
    }) => Promise<Record<string, unknown>>;
  }).explainMessageVisibility;

  if (typeof explainFn !== 'function') {
    try {
      await ports.mailAccess.assertPermission({
        workspaceId: principal.workspaceId,
        actor: {
          workspaceId: principal.workspaceId,
          userId,
          isOwner: false,
          isAdmin: false,
        },
        permission: 'mail.metadata.read',
        resource: messageResource,
      });
      return data(200, {
        visible: true,
        reason: 'Nachricht ist fuer den Nutzer ueber Mail-ACL sichtbar',
        messageId,
        userId,
        role: targetRole,
        resource: messageResource,
      });
    } catch {
      return data(200, {
        visible: false,
        reason: 'Keine Berechtigung fuer diese E-Mail-Aktion',
        messageId,
        userId,
        role: targetRole,
        resource: messageResource,
      });
    }
  }

  const explanation = await explainFn.call(ports.mailAccess, {
    workspaceId: principal.workspaceId,
    userId,
    resource: messageResource,
  });

  return data(200, {
    messageId,
    userId,
    role: targetRole,
    resource: messageResource,
    ...explanation,
  });
}

async function resolveTargetUserRole(
  ports: ServerApiPorts,
  workspaceId: string,
  userId: string,
): Promise<'owner' | 'admin' | 'user' | null> {
  const auth = ports.auth as {
    getUser?: (input: { workspaceId: string; userId: string }) => Promise<{
      role: 'owner' | 'admin' | 'user';
    } | null>;
    listUsers?: (input: { workspaceId: string }) => Promise<readonly {
      id: string;
      role: 'owner' | 'admin' | 'user';
    }[]>;
  } | undefined;
  if (auth?.getUser) {
    const user = await auth.getUser({ workspaceId, userId });
    return user?.role ?? null;
  }
  if (auth?.listUsers) {
    const users = await auth.listUsers({ workspaceId });
    return users.find((user) => user.id === userId)?.role ?? null;
  }
  return null;
}

function queryParams(req: ApiRequest): Record<string, string> {
  const fromReq = (req as { query?: Record<string, string | string[] | undefined> }).query;
  if (fromReq && typeof fromReq === 'object') {
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(fromReq)) {
      if (typeof value === 'string') out[key] = value;
      else if (Array.isArray(value) && typeof value[0] === 'string') out[key] = value[0];
    }
    return out;
  }
  const qIndex = req.path.indexOf('?');
  if (qIndex < 0) return {};
  const params = new URLSearchParams(req.path.slice(qIndex + 1));
  const out: Record<string, string> = {};
  for (const [key, value] of params.entries()) out[key] = value;
  return out;
}
