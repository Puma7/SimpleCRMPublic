import {
  MAIL_PERMISSION_PROFILES,
  MAIL_PERMISSIONS,
  type MailPermission,
} from '@simplecrm/core';

import type {
  ApiErrorBody,
  ApiRequest,
  ApiResponse,
  AuthenticatedPrincipal,
  MailDelegationApiPort,
  MailDelegationBinding,
  MailDelegationMutationCode,
  MailDelegationResource,
  MailDelegationSubject,
  ServerApiPorts,
} from './types';
import { data, error, positiveIntFromPath, requirePrincipal } from './http';

const BINDINGS_PATH = '/api/v1/email/access/bindings';
const RESOURCES_PATH = '/api/v1/email/access/resources';
const SUBJECTS_PATH = '/api/v1/email/access/subjects';
const KNOWN_PERMISSIONS = new Set<string>(MAIL_PERMISSIONS);
const KNOWN_PROFILES = new Set<string>(Object.keys(MAIL_PERMISSION_PROFILES));
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

export async function handleMailDelegationRoute(
  req: ApiRequest,
  ports: ServerApiPorts,
): Promise<ApiResponse | null> {
  const path = pathOnly(req.path);
  if (
    path !== RESOURCES_PATH
    && path !== SUBJECTS_PATH
    && path !== BINDINGS_PATH
    && !path.startsWith(`${BINDINGS_PATH}/`)
  ) return null;

  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  if (!ports.mailDelegation) {
    return error(503, 'mail_delegation_unavailable', 'Mail-Delegation ist nicht konfiguriert');
  }

  if (path === RESOURCES_PATH) {
    if (req.method === 'GET') return handleResourceOptions(req, ports.mailDelegation, principal);
    return methodNotAllowed();
  }
  if (path === SUBJECTS_PATH) {
    if (req.method === 'GET') return handleSubjectOptions(req, ports.mailDelegation, principal);
    return methodNotAllowed();
  }
  if (path === BINDINGS_PATH) {
    if (req.method === 'GET') return handleList(req, ports.mailDelegation, principal);
    if (req.method === 'POST') return handleCreate(req, ports, ports.mailDelegation, principal);
    return methodNotAllowed();
  }

  const match = /^\/api\/v1\/email\/access\/bindings\/([^/]+)$/.exec(path);
  if (!match) return null;
  const bindingId = positiveIntFromPath(match[1]);
  if (bindingId === null) return error(400, 'invalid_binding_id', 'bindingId muss eine positive Ganzzahl sein');
  if (req.method === 'PATCH') return handlePatch(req, ports, ports.mailDelegation, principal, bindingId);
  if (req.method === 'DELETE') return handleDelete(ports, ports.mailDelegation, principal, bindingId);
  return methodNotAllowed();
}

async function handleResourceOptions(
  req: ApiRequest,
  port: MailDelegationApiPort,
  principal: AuthenticatedPrincipal,
): Promise<ApiResponse> {
  const query = queryParams(req);
  if (query.resourceType !== 'account' && query.resourceType !== 'folder') {
    return invalid('resourceType muss account oder folder sein').response;
  }
  const pagination = parsePagination(req);
  if (!pagination.ok) return pagination.response;
  const result = await port.listResourceOptions({
    workspaceId: principal.workspaceId,
    actor: actor(principal),
    resourceType: query.resourceType,
    ...pagination.value,
  });
  return data(200, { items: result.resources, nextCursor: result.nextCursor });
}

async function handleSubjectOptions(
  req: ApiRequest,
  port: MailDelegationApiPort,
  principal: AuthenticatedPrincipal,
): Promise<ApiResponse> {
  const query = queryParams(req);
  if (query.subjectType !== 'user' && query.subjectType !== 'group') {
    return invalid('subjectType muss user oder group sein').response;
  }
  const resource = parseRequiredQueryResource(req);
  if (!resource.ok) return resource.response;
  const pagination = parseSubjectPagination(req, query.subjectType);
  if (!pagination.ok) return pagination.response;
  const result = await port.listSubjectOptions({
    workspaceId: principal.workspaceId,
    actor: actor(principal),
    resource: resource.resource,
    subjectType: query.subjectType,
    ...pagination.value,
  });
  if (!result.ok) return mutationError(result.code);
  return data(200, { items: result.subjects, nextCursor: result.nextCursor });
}

async function handleList(
  req: ApiRequest,
  port: MailDelegationApiPort,
  principal: AuthenticatedPrincipal,
): Promise<ApiResponse> {
  const resource = parseQueryResource(req);
  if (!resource.ok) return resource.response;
  const pagination = parsePagination(req);
  if (!pagination.ok) return pagination.response;
  const result = await port.listBindings({
    workspaceId: principal.workspaceId,
    actor: actor(principal),
    ...(resource.resource ? { resource: resource.resource } : {}),
    ...pagination.value,
  });
  if (!result.ok) return mutationError(result.code);
  return data(200, { items: result.bindings, nextCursor: result.nextCursor });
}

async function handleCreate(
  req: ApiRequest,
  ports: ServerApiPorts,
  port: MailDelegationApiPort,
  principal: AuthenticatedPrincipal,
): Promise<ApiResponse> {
  const parsed = parseMutationBody(req.body, { requireSubjectResource: true });
  if (!parsed.ok) return parsed.response;
  const result = await port.replaceBinding({
    workspaceId: principal.workspaceId,
    actor: actor(principal),
    subject: parsed.subject,
    resource: parsed.resource,
    permissions: parsed.permissions,
  });
  if (!result.ok) return mutationError(result.code);
  await auditAndPublish(ports, principal, 'email_acl.binding_replaced', result.binding, {
    bindingId: result.binding?.id,
    subject: parsed.subject,
    resource: parsed.resource,
    permissions: parsed.permissions,
    affectedUserIds: result.affectedUserIds,
    deleted: result.deleted === true,
  });
  return data(201, {
    success: true,
    id: result.binding?.id,
    binding: result.binding,
    deleted: result.deleted === true,
  });
}

async function handlePatch(
  req: ApiRequest,
  ports: ServerApiPorts,
  port: MailDelegationApiPort,
  principal: AuthenticatedPrincipal,
  bindingId: number,
): Promise<ApiResponse> {
  const parsed = parseMutationBody(req.body, { requireSubjectResource: false });
  if (!parsed.ok) return parsed.response;
  const result = await port.replaceBindingById({
    workspaceId: principal.workspaceId,
    actor: actor(principal),
    bindingId,
    permissions: parsed.permissions,
  });
  if (!result.ok) return mutationError(result.code);
  await auditAndPublish(ports, principal, 'email_acl.binding_replaced', result.binding, {
    bindingId,
    subject: result.binding?.subject,
    resource: result.binding?.resource,
    permissions: parsed.permissions,
    affectedUserIds: result.affectedUserIds,
    deleted: result.deleted,
  });
  return data(200, {
    success: true,
    id: result.binding?.id ?? bindingId,
    binding: result.binding,
    deleted: result.deleted,
  });
}

async function handleDelete(
  ports: ServerApiPorts,
  port: MailDelegationApiPort,
  principal: AuthenticatedPrincipal,
  bindingId: number,
): Promise<ApiResponse> {
  const result = await port.deleteBinding({
    workspaceId: principal.workspaceId,
    actor: actor(principal),
    bindingId,
  });
  if (!result.ok) return mutationError(result.code);
  await auditAndPublish(ports, principal, 'email_acl.binding_deleted', null, {
    bindingId,
    permissions: [],
    affectedUserIds: result.affectedUserIds,
    deleted: true,
  });
  return data(200, { success: true, deleted: true, id: bindingId });
}

type ParsedMutation =
  | { ok: true; subject: MailDelegationSubject; resource: MailDelegationResource; permissions: readonly MailPermission[] }
  | { ok: false; response: ApiResponse<ApiErrorBody> };

function parseMutationBody(
  body: unknown,
  options: { requireSubjectResource: boolean },
): ParsedMutation {
  if (!isRecord(body)) return invalid('Payload muss ein JSON-Objekt sein');
  const permissions = parsePermissions(body);
  if (!permissions.ok) return permissions;

  const subject = parseSubject(body.subject);
  if (!subject.ok) {
    if (options.requireSubjectResource) return subject;
    return { ok: true, subject: { type: 'user', id: '' }, resource: { type: 'account', accountId: 1 }, permissions: permissions.permissions };
  }
  const resource = parseBodyResource(body.resource);
  if (!resource.ok) {
    if (options.requireSubjectResource) return resource;
    return { ok: true, subject: subject.subject, resource: { type: 'account', accountId: 1 }, permissions: permissions.permissions };
  }
  return { ok: true, subject: subject.subject, resource: resource.resource, permissions: permissions.permissions };
}

function parsePermissions(body: Record<string, unknown>):
  | { ok: true; permissions: readonly MailPermission[] }
  | { ok: false; response: ApiResponse<ApiErrorBody> } {
  const profile = typeof body.profile === 'string' ? body.profile.trim() : undefined;
  if (profile && profile !== 'custom') {
    if (!KNOWN_PROFILES.has(profile)) return invalid('Unbekanntes Berechtigungsprofil');
    return {
      ok: true,
      permissions: [...MAIL_PERMISSION_PROFILES[profile as keyof typeof MAIL_PERMISSION_PROFILES]],
    };
  }
  const raw = body.permissions;
  if (!Array.isArray(raw) || raw.some((entry) => typeof entry !== 'string')) {
    return invalid('permissions muss ein Array bekannter Mail-Rechte sein');
  }
  const permissions: MailPermission[] = [];
  for (const entry of raw) {
    if (!KNOWN_PERMISSIONS.has(entry)) {
      return errorResult(400, 'unknown_mail_permission', 'Unbekanntes Mail-Recht');
    }
    if (!permissions.includes(entry as MailPermission)) permissions.push(entry as MailPermission);
  }
  permissions.sort();
  return { ok: true, permissions };
}

function parseSubject(value: unknown):
  | { ok: true; subject: MailDelegationSubject }
  | { ok: false; response: ApiResponse<ApiErrorBody> } {
  if (!isRecord(value)) return invalid('subject ist erforderlich');
  if (value.type === 'user' && typeof value.id === 'string' && value.id.trim()) {
    return { ok: true, subject: { type: 'user', id: value.id.trim() } };
  }
  if (value.type === 'group' && isPositiveInteger(value.id)) {
    return { ok: true, subject: { type: 'group', id: value.id } };
  }
  return invalid('subject muss ein Benutzer- oder Gruppensubjekt sein');
}

function parseBodyResource(value: unknown):
  | { ok: true; resource: MailDelegationResource }
  | { ok: false; response: ApiResponse<ApiErrorBody> } {
  if (!isRecord(value)) return invalid('resource ist erforderlich');
  if (value.type === 'account' && isPositiveInteger(value.accountId)) {
    return { ok: true, resource: { type: 'account', accountId: value.accountId } };
  }
  if (
    value.type === 'folder'
    && isPositiveInteger(value.accountId)
    && isPositiveInteger(value.folderId)
  ) {
    return {
      ok: true,
      resource: { type: 'folder', accountId: value.accountId, folderId: value.folderId },
    };
  }
  return invalid('resource muss ein Konto oder Ordner sein');
}

function parseQueryResource(req: ApiRequest):
  | { ok: true; resource?: MailDelegationResource }
  | { ok: false; response: ApiResponse<ApiErrorBody> } {
  const query = queryParams(req);
  const accountId = parsePositiveInteger(query.accountId);
  const folderId = parsePositiveInteger(query.folderId);
  if (query.accountId !== undefined && accountId === null) {
    return errorResult(400, 'invalid_account_id', 'accountId muss eine positive Ganzzahl sein');
  }
  if (query.folderId !== undefined && folderId === null) {
    return errorResult(400, 'invalid_folder_id', 'folderId muss eine positive Ganzzahl sein');
  }
  if (folderId !== null && accountId === null) {
    return invalid('folderId erfordert accountId');
  }
  if (accountId === null) return { ok: true };
  if (folderId === null) return { ok: true, resource: { type: 'account', accountId } };
  return { ok: true, resource: { type: 'folder', accountId, folderId } };
}

function parseRequiredQueryResource(req: ApiRequest):
  | { ok: true; resource: MailDelegationResource }
  | { ok: false; response: ApiResponse<ApiErrorBody> } {
  const query = queryParams(req);
  const accountId = parsePositiveInteger(query.accountId);
  const folderId = parsePositiveInteger(query.folderId);
  if (accountId === null) return errorResult(400, 'invalid_account_id', 'accountId muss eine positive Ganzzahl sein');
  if (query.resourceType === 'account' && query.folderId === undefined) {
    return { ok: true, resource: { type: 'account', accountId } };
  }
  if (query.resourceType === 'folder' && folderId !== null) {
    return { ok: true, resource: { type: 'folder', accountId, folderId } };
  }
  return invalid('resourceType und Ressourcen-IDs sind inkonsistent');
}

function parsePagination(req: ApiRequest):
  | { ok: true; value: { cursor?: number; limit: number } }
  | { ok: false; response: ApiResponse<ApiErrorBody> } {
  const query = queryParams(req);
  const cursor = parsePositiveInteger(query.cursor);
  if (query.cursor !== undefined && cursor === null) {
    return errorResult(400, 'invalid_cursor', 'cursor muss eine positive Ganzzahl sein');
  }
  const parsedLimit = query.limit === undefined ? DEFAULT_PAGE_SIZE : parsePositiveInteger(query.limit);
  if (parsedLimit === null || parsedLimit > MAX_PAGE_SIZE) {
    return errorResult(400, 'invalid_limit', `limit muss zwischen 1 und ${MAX_PAGE_SIZE} liegen`);
  }
  return {
    ok: true,
    value: {
      ...(cursor === null ? {} : { cursor }),
      limit: parsedLimit,
    },
  };
}

function parseSubjectPagination(
  req: ApiRequest,
  subjectType: MailDelegationSubject['type'],
):
  | { ok: true; value: { cursor?: string; limit: number } }
  | { ok: false; response: ApiResponse<ApiErrorBody> } {
  const query = queryParams(req);
  let cursor: string | undefined;
  if (query.cursor !== undefined) {
    const valid = subjectType === 'user'
      ? UUID_RE.test(query.cursor)
      : parsePositiveInteger(query.cursor) !== null;
    if (!valid) return errorResult(400, 'invalid_cursor', 'cursor ist fuer den Subjekttyp ungueltig');
    cursor = query.cursor.toLowerCase();
  }
  const parsedLimit = query.limit === undefined ? DEFAULT_PAGE_SIZE : parsePositiveInteger(query.limit);
  if (parsedLimit === null || parsedLimit > MAX_PAGE_SIZE) {
    return errorResult(400, 'invalid_limit', `limit muss zwischen 1 und ${MAX_PAGE_SIZE} liegen`);
  }
  return { ok: true, value: { ...(cursor === undefined ? {} : { cursor }), limit: parsedLimit } };
}

async function auditAndPublish(
  ports: ServerApiPorts,
  principal: AuthenticatedPrincipal,
  action: 'email_acl.binding_replaced' | 'email_acl.binding_deleted',
  binding: MailDelegationBinding | null,
  details: {
    bindingId?: number;
    subject?: MailDelegationSubject;
    resource?: MailDelegationResource;
    permissions: readonly MailPermission[];
    affectedUserIds: readonly string[];
    deleted: boolean;
  },
): Promise<void> {
  const bindingId = details.bindingId ?? binding?.id;
  const subject = details.subject ?? binding?.subject;
  const resource = details.resource ?? binding?.resource;
  await ports.audit?.record({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    action,
    entityType: 'email_acl_binding',
    entityId: bindingId === undefined ? null : String(bindingId),
    metadata: {
      ...(bindingId === undefined ? {} : { bindingId }),
      ...(subject ? { subjectType: subject.type, subjectId: String(subject.id) } : {}),
      ...(resource ? {
        resourceType: resource.type,
        accountId: resource.accountId,
        ...(resource.type === 'folder' ? { folderId: resource.folderId } : {}),
      } : {}),
      permissionNames: [...details.permissions].sort(),
    },
  });

  if (bindingId === undefined) return;
  const uniqueTargets = [...new Set(details.affectedUserIds)].sort();
  for (const targetUserId of uniqueTargets) {
    await ports.events?.publish({
      type: 'email_acl.changed',
      workspaceId: principal.workspaceId,
      entityType: 'email_acl',
      entityId: String(bindingId),
      actorUserId: principal.userId,
      occurredAt: new Date().toISOString(),
      payload: {
        bindingId,
        targetUserId,
        state: details.deleted ? 'deleted' : 'changed',
      },
    });
  }
}

function actor(principal: AuthenticatedPrincipal) {
  return {
    userId: principal.userId,
    isOwner: principal.role === 'owner',
    isAdmin: principal.role === 'admin',
  };
}

function mutationError(code: MailDelegationMutationCode | 'permission_denied' | 'resource_not_found'): ApiResponse<ApiErrorBody> {
  if (code === 'permission_denied') return error(403, 'mail_delegation_denied', 'Keine Berechtigung zur Mail-Delegation');
  if (code === 'privilege_escalation') {
    return error(403, 'mail_delegation_privilege_escalation', 'Rechte duerfen nicht ueber eigene Rechte hinaus delegiert werden');
  }
  if (code === 'binding_not_found') return error(404, 'mail_delegation_binding_not_found', 'Delegation nicht gefunden');
  if (code === 'binding_conflict') return error(409, 'mail_delegation_conflict', 'Delegation wurde gleichzeitig geaendert');
  if (code === 'subject_not_found') return error(404, 'mail_delegation_subject_not_found', 'Subjekt nicht gefunden');
  if (code === 'resource_not_found') return error(404, 'mail_delegation_resource_not_found', 'Ressource nicht gefunden');
  return error(403, 'mail_delegation_owner_admin_subject_forbidden', 'Owner/Admins werden nicht als ACL-Subjekt gespeichert');
}

function methodNotAllowed(): ApiResponse<ApiErrorBody> {
  return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
}

function invalid(message: string): { ok: false; response: ApiResponse<ApiErrorBody> } {
  return errorResult(400, 'validation_error', message);
}

function errorResult(
  status: number,
  code: string,
  message: string,
): { ok: false; response: ApiResponse<ApiErrorBody> } {
  return { ok: false, response: error(status, code, message) };
}

function queryParams(req: ApiRequest): Record<string, string | undefined> {
  const merged: Record<string, string | undefined> = { ...(req.query ?? {}) };
  const marker = req.path.indexOf('?');
  if (marker >= 0) {
    const params = new URLSearchParams(req.path.slice(marker + 1));
    for (const [key, value] of params) merged[key] = value;
  }
  return merged;
}

function pathOnly(path: string): string {
  return path.split('?')[0] ?? path;
}

function parsePositiveInteger(value: string | undefined): number | null {
  if (value === undefined || value === '') return null;
  if (!/^[1-9]\d*$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
