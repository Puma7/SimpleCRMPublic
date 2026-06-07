import type {
  ApiRequest,
  ApiResponse,
  AuthenticatedPrincipal,
  ServerApiPorts,
} from './types';
import {
  data,
  error,
  getStringField,
  positiveIntFromPath,
  requireAdmin,
  requirePrincipal,
} from './types';

const MAX_GROUP_NAME = 120;
const MAX_GROUP_DESCRIPTION = 2000;

export async function handleUserGroupRoute(
  req: ApiRequest,
  ports: ServerApiPorts,
): Promise<ApiResponse | null> {
  if (!req.path.startsWith('/api/v1/user-groups')) return null;

  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  if (!ports.userGroups) return error(503, 'user_groups_unavailable', 'Benutzergruppen-API nicht konfiguriert');

  if (req.path === '/api/v1/user-groups') {
    if (req.method === 'GET') {
      const groups = await ports.userGroups.list({ workspaceId: principal.workspaceId });
      return data(200, { items: groups });
    }
    if (req.method === 'POST') return handleCreateGroup(req, ports, principal);
    return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
  }

  const memberMatch = /^\/api\/v1\/user-groups\/([^/]+)\/members(?:\/([^/]+))?$/.exec(req.path);
  if (memberMatch) {
    const groupId = positiveIntFromPath(memberMatch[1]);
    if (groupId === null) return error(400, 'invalid_group_id', 'group id muss eine positive Ganzzahl sein');
    return handleMemberRoute(req, ports, principal, groupId, memberMatch[2]);
  }

  const groupMatch = /^\/api\/v1\/user-groups\/([^/]+)$/.exec(req.path);
  if (groupMatch) {
    const groupId = positiveIntFromPath(groupMatch[1]);
    if (groupId === null) return error(400, 'invalid_group_id', 'group id muss eine positive Ganzzahl sein');
    if (req.method === 'PATCH') return handleUpdateGroup(req, ports, principal, groupId);
    if (req.method === 'DELETE') return handleDeleteGroup(ports, principal, groupId);
    return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
  }

  return null;
}

async function handleCreateGroup(
  req: ApiRequest,
  ports: ServerApiPorts,
  principal: AuthenticatedPrincipal,
): Promise<ApiResponse> {
  if (!requireAdmin(principal)) return error(403, 'forbidden', 'Adminrechte erforderlich');
  const name = normalizeName(getStringField(req.body, 'name'));
  if (!name.ok) return name.response;
  const description = normalizeDescription(getStringField(req.body, 'description'));
  if (!description.ok) return description.response;

  const result = await ports.userGroups!.create({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    name: name.value,
    ...(description.value === undefined ? {} : { description: description.value }),
  });
  if (!result.ok) return mutationError(result.code);

  await ports.audit?.record({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    action: 'user_group.created',
    entityType: 'user_group',
    entityId: String(result.group.id),
    metadata: { name: result.group.name },
  });
  return data(201, result.group);
}

async function handleUpdateGroup(
  req: ApiRequest,
  ports: ServerApiPorts,
  principal: AuthenticatedPrincipal,
  groupId: number,
): Promise<ApiResponse> {
  if (!requireAdmin(principal)) return error(403, 'forbidden', 'Adminrechte erforderlich');
  const hasName = isPlainObject(req.body) && Object.prototype.hasOwnProperty.call(req.body, 'name');
  const hasDescription = isPlainObject(req.body) && Object.prototype.hasOwnProperty.call(req.body, 'description');
  if (!hasName && !hasDescription) {
    return error(400, 'validation_error', 'Mindestens ein Feld (name, description) ist erforderlich');
  }
  const update: { name?: string; description?: string | null } = {};
  if (hasName) {
    const name = normalizeName(getStringField(req.body, 'name'));
    if (!name.ok) return name.response;
    update.name = name.value;
  }
  if (hasDescription) {
    const description = normalizeDescription(getStringField(req.body, 'description'));
    if (!description.ok) return description.response;
    update.description = description.value ?? null;
  }

  const result = await ports.userGroups!.update({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    id: groupId,
    ...update,
  });
  if (!result.ok) return mutationError(result.code);

  await ports.audit?.record({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    action: 'user_group.updated',
    entityType: 'user_group',
    entityId: String(result.group.id),
    metadata: { fields: Object.keys(update).sort() },
  });
  return data(200, result.group);
}

async function handleDeleteGroup(
  ports: ServerApiPorts,
  principal: AuthenticatedPrincipal,
  groupId: number,
): Promise<ApiResponse> {
  if (!requireAdmin(principal)) return error(403, 'forbidden', 'Adminrechte erforderlich');
  const group = await ports.userGroups!.delete({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    id: groupId,
  });
  if (!group) return error(404, 'user_group_not_found', 'Benutzergruppe nicht gefunden');

  await ports.audit?.record({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    action: 'user_group.deleted',
    entityType: 'user_group',
    entityId: String(group.id),
    metadata: { name: group.name },
  });
  return data(200, { deleted: true, group });
}

async function handleMemberRoute(
  req: ApiRequest,
  ports: ServerApiPorts,
  principal: AuthenticatedPrincipal,
  groupId: number,
  rawUserId: string | undefined,
): Promise<ApiResponse> {
  if (req.method === 'GET' && rawUserId === undefined) {
    const members = await ports.userGroups!.listMembers({ workspaceId: principal.workspaceId, groupId });
    if (members === null) return error(404, 'user_group_not_found', 'Benutzergruppe nicht gefunden');
    return data(200, { items: members });
  }

  if (!requireAdmin(principal)) return error(403, 'forbidden', 'Adminrechte erforderlich');

  if (req.method === 'POST' && rawUserId === undefined) {
    const userId = (getStringField(req.body, 'userId') ?? '').trim();
    if (!userId) return error(400, 'validation_error', 'userId ist erforderlich');
    const result = await ports.userGroups!.addMember({
      workspaceId: principal.workspaceId,
      actorUserId: principal.userId,
      groupId,
      userId,
    });
    if (!result.ok) return memberMutationError(result.code);
    return data(201, { added: true });
  }

  if (req.method === 'DELETE' && rawUserId !== undefined) {
    const userId = decodeURIComponent(rawUserId).trim();
    if (!userId) return error(400, 'validation_error', 'userId ist erforderlich');
    const result = await ports.userGroups!.removeMember({
      workspaceId: principal.workspaceId,
      actorUserId: principal.userId,
      groupId,
      userId,
    });
    if (!result.ok) return memberMutationError(result.code);
    return data(200, { removed: true });
  }

  return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
}

function mutationError(code: 'duplicate_name' | 'not_found' | 'invalid_name'): ApiResponse {
  if (code === 'duplicate_name') return error(409, 'user_group_duplicate_name', 'Eine Gruppe mit diesem Namen existiert bereits');
  if (code === 'not_found') return error(404, 'user_group_not_found', 'Benutzergruppe nicht gefunden');
  return error(400, 'validation_error', 'name darf nicht leer sein');
}

function memberMutationError(code: 'group_not_found' | 'user_not_found'): ApiResponse {
  if (code === 'user_not_found') return error(404, 'user_not_found', 'Benutzer nicht gefunden');
  return error(404, 'user_group_not_found', 'Benutzergruppe nicht gefunden');
}

function normalizeName(value: string | null): { ok: true; value: string } | { ok: false; response: ApiResponse } {
  const name = (value ?? '').trim();
  if (!name) return { ok: false, response: error(400, 'validation_error', 'name ist erforderlich') };
  if (name.length > MAX_GROUP_NAME) {
    return { ok: false, response: error(400, 'validation_error', `name darf maximal ${MAX_GROUP_NAME} Zeichen haben`) };
  }
  return { ok: true, value: name };
}

function normalizeDescription(value: string | null): { ok: true; value: string | undefined } | { ok: false; response: ApiResponse } {
  if (value === null) return { ok: true, value: undefined };
  const description = value.trim();
  if (!description) return { ok: true, value: undefined };
  if (description.length > MAX_GROUP_DESCRIPTION) {
    return { ok: false, response: error(400, 'validation_error', `description darf maximal ${MAX_GROUP_DESCRIPTION} Zeichen haben`) };
  }
  return { ok: true, value: description };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
