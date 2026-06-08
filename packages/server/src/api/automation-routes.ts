import type {
  ApiErrorBody,
  ApiRequest,
  ApiResponse,
  AutomationApiKeyListResult,
  AutomationApiKeyMutationInput,
  AutomationApiKeyRecord,
  AuthenticatedPrincipal,
  ServerApiPorts,
} from './types';
import {
  data,
  error,
  requireAdmin,
  requirePrincipal,
} from './types';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type AutomationApiKeyMutationParseResult =
  | { ok: true; values: AutomationApiKeyMutationInput }
  | { ok: false; response: ApiResponse<ApiErrorBody> };

export async function handleAutomationReadRoute(
  req: ApiRequest,
  ports: ServerApiPorts,
): Promise<ApiResponse | null> {
  if (req.path === '/api/v1/automation/api-keys') {
    return handleApiKeyList(req, ports);
  }

  const match = /^\/api\/v1\/automation\/api-keys\/([^/]+)$/.exec(req.path);
  if (!match) return null;
  return handleApiKeyGet(req, ports, match[1]);
}

async function handleApiKeyList(req: ApiRequest, ports: ServerApiPorts): Promise<ApiResponse> {
  if (req.method === 'POST') return handleApiKeyCreate(req, ports);
  if (req.method !== 'GET') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;

  const limit = parseLimit(req.query?.limit);
  if (limit === null) return error(400, 'invalid_limit', `limit muss zwischen 1 und ${MAX_LIMIT} liegen`);
  const cursor = parseOptionalUuid(req.query?.cursor);
  if (cursor === null) return error(400, 'invalid_cursor', 'cursor muss eine UUID sein');
  const revoked = parseOptionalBoolean(req.query?.revoked);
  if (revoked === null) return error(400, 'invalid_revoked', 'revoked muss true oder false sein');
  const search = normalizeTextFilter(req.query?.search, 200);
  if (search === null) return error(400, 'invalid_search', 'search darf maximal 200 Zeichen haben');

  if (!ports.automationApiKeys) return error(503, 'automation_api_keys_unavailable', 'Automation API key API nicht konfiguriert');
  const result = await ports.automationApiKeys.list({
    workspaceId: principal.workspaceId,
    limit,
    ...(cursor === undefined ? {} : { cursor }),
    ...(revoked === undefined ? {} : { revoked }),
    ...(search === undefined ? {} : { search }),
  });
  return data(200, sanitizeApiKeyList(result));
}

async function handleApiKeyGet(
  req: ApiRequest,
  ports: ServerApiPorts,
  rawId: string | undefined,
): Promise<ApiResponse> {
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  const id = parseUuid(rawId);
  if (id === null) return error(400, 'invalid_automation_api_key_id', 'automation api key id muss eine UUID sein');
  if (req.method === 'DELETE') return handleApiKeyRevoke(ports, principal, id);
  if (req.method !== 'GET') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');

  if (!ports.automationApiKeys) return error(503, 'automation_api_keys_unavailable', 'Automation API key API nicht konfiguriert');
  const apiKey = await ports.automationApiKeys.get({
    workspaceId: principal.workspaceId,
    id,
  });
  return apiKey
    ? data(200, sanitizeApiKey(apiKey))
    : error(404, 'automation_api_key_not_found', 'Automation API key nicht gefunden');
}

async function handleApiKeyCreate(req: ApiRequest, ports: ServerApiPorts): Promise<ApiResponse> {
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  if (!requireAdmin(principal)) return error(403, 'forbidden', 'Adminrechte erforderlich');
  if (!ports.automationApiKeys?.create) return error(503, 'automation_api_keys_unavailable', 'Automation API key API nicht konfiguriert');

  const parsed = parseApiKeyMutationBody(req.body);
  if (!parsed.ok) return parsed.response;

  const result = await ports.automationApiKeys.create({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    values: parsed.values,
  });
  if (!result.ok) return automationMutationError(result.code);

  await auditApiKey(ports, principal, 'automation_api_key.created', result.apiKey, {
    label: result.apiKey.label,
    scopes: result.apiKey.scopes,
  });
  await publishApiKey(ports, principal.workspaceId, 'automation_api_key.created', result.apiKey, principal.userId);
  return data(201, { apiKey: sanitizeApiKey(result.apiKey), key: result.key });
}

async function handleApiKeyRevoke(
  ports: ServerApiPorts,
  principal: AuthenticatedPrincipal,
  id: string,
): Promise<ApiResponse> {
  if (!requireAdmin(principal)) return error(403, 'forbidden', 'Adminrechte erforderlich');
  if (!ports.automationApiKeys?.revoke) return error(503, 'automation_api_keys_unavailable', 'Automation API key API nicht konfiguriert');

  const result = await ports.automationApiKeys.revoke({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    id,
  });
  if (!result) return error(404, 'automation_api_key_not_found', 'Automation API key nicht gefunden');
  if (!result.ok) return automationMutationError(result.code);

  await auditApiKey(ports, principal, 'automation_api_key.revoked', result.apiKey, { label: result.apiKey.label });
  await publishApiKey(ports, principal.workspaceId, 'automation_api_key.revoked', result.apiKey, principal.userId);
  return data(200, { revoked: true, apiKey: sanitizeApiKey(result.apiKey) });
}

function automationMutationError(code: 'secret_port_unavailable'): ApiResponse {
  return error(503, 'automation_api_key_secret_unavailable', 'Automation API key secret storage ist nicht konfiguriert');
}

function sanitizeApiKeyList(result: AutomationApiKeyListResult): AutomationApiKeyListResult {
  return {
    items: result.items.map(sanitizeApiKey),
    nextCursor: result.nextCursor,
  };
}

function sanitizeApiKey(apiKey: AutomationApiKeyRecord): AutomationApiKeyRecord {
  return {
    id: apiKey.id,
    label: apiKey.label,
    scopes: apiKey.scopes,
    lastUsedAt: apiKey.lastUsedAt,
    revokedAt: apiKey.revokedAt,
    createdByUserId: apiKey.createdByUserId,
    secretConfigured: apiKey.secretConfigured,
    createdAt: apiKey.createdAt,
    updatedAt: apiKey.updatedAt,
  };
}

async function auditApiKey(
  ports: ServerApiPorts,
  principal: AuthenticatedPrincipal,
  action: 'automation_api_key.created' | 'automation_api_key.revoked',
  apiKey: AutomationApiKeyRecord,
  metadata: Record<string, unknown>,
): Promise<void> {
  await ports.audit?.record({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    action,
    entityType: 'automation_api_key',
    entityId: apiKey.id,
    metadata: {
      id: apiKey.id,
      revokedAt: apiKey.revokedAt,
      ...metadata,
    },
  });
}

async function publishApiKey(
  ports: ServerApiPorts,
  workspaceId: string,
  type: 'automation_api_key.created' | 'automation_api_key.revoked',
  apiKey: AutomationApiKeyRecord,
  actorUserId: string,
): Promise<void> {
  await ports.events?.publish({
    type,
    workspaceId,
    entityType: 'automation_api_key',
    entityId: apiKey.id,
    actorUserId,
    occurredAt: new Date().toISOString(),
    payload: {
      id: apiKey.id,
      label: apiKey.label,
      scopes: apiKey.scopes,
      revokedAt: apiKey.revokedAt,
      secretConfigured: apiKey.secretConfigured,
    },
  });
}

function parseApiKeyMutationBody(body: unknown): AutomationApiKeyMutationParseResult {
  if (!isPlainObject(body)) {
    return {
      ok: false,
      response: error(400, 'invalid_automation_api_key_payload', 'Payload muss ein Objekt sein'),
    };
  }

  const label = normalizeRequiredBodyText(body.label, 200);
  if (label === null) {
    return {
      ok: false,
      response: error(400, 'invalid_automation_api_key_label', 'label muss ein nicht leerer String mit maximal 200 Zeichen sein'),
    };
  }

  const scopes = normalizeScopes(body.scopes);
  if (scopes === null) {
    return {
      ok: false,
      response: error(400, 'invalid_automation_api_key_scopes', 'scopes muss ein Array aus nicht leeren Strings sein'),
    };
  }

  return {
    ok: true,
    values: {
      label,
      scopes,
    },
  };
}

function normalizeRequiredBodyText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) return null;
  return normalized;
}

function normalizeScopes(value: unknown): readonly string[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  const scopes = value.map((scope) => (typeof scope === 'string' ? scope.trim() : null));
  if (scopes.some((scope) => scope === null || scope === '')) return null;
  return scopes as string[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseLimit(value: string | undefined): number | null {
  if (value === undefined || value === '') return DEFAULT_LIMIT;
  const limit = parsePositiveInt(value);
  if (limit === null || limit > MAX_LIMIT) return null;
  return limit;
}

function parsePositiveInt(value: string): number | null {
  if (!/^[1-9]\d*$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function parseOptionalUuid(value: string | undefined): string | undefined | null {
  if (value === undefined || value === '') return undefined;
  return parseUuid(value);
}

function parseUuid(value: string | undefined): string | null {
  if (!value || !UUID_PATTERN.test(value)) return null;
  return value.toLowerCase();
}

function parseOptionalBoolean(value: string | undefined): boolean | undefined | null {
  if (value === undefined || value === '') return undefined;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return null;
}

function normalizeTextFilter(value: string | undefined, maxLength: number): string | undefined | null {
  if (value === undefined) return undefined;
  const normalized = value.trim();
  if (!normalized) return undefined;
  return normalized.length > maxLength ? null : normalized;
}
