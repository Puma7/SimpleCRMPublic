import type {
  ApiRequest,
  ApiResponse,
  AuthenticatedPrincipal,
  PortalReturnCreateInput,
  ReturnCreateInput,
  ReturnItemCondition,
  ReturnItemMutationInput,
  ReturnOutcome,
  ReturnStatus,
  ReturnUpdateInput,
  ReturnsPortalResolveResult,
  ServerApiPorts,
} from './types';
import {
  data,
  error,
  positiveIntFromPath,
  requireAdmin,
  requirePrincipal,
} from './http';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const MAX_SEARCH_LEN = 200;
const MAX_NOTES_LEN = 10_000;
const MAX_TEXT_LEN = 200;

const STATUS_VALUES: readonly ReturnStatus[] = [
  'pending',
  'approved',
  'received',
  'refunded',
  'exchanged',
  'credited',
  'rejected',
  'cancelled',
];
const OUTCOME_VALUES: readonly ReturnOutcome[] = ['refund', 'exchange', 'credit', 'keep'];
const CONDITION_VALUES: readonly ReturnItemCondition[] = ['new', 'opened', 'used', 'damaged'];

/**
 * Handles GET/POST /api/v1/returns and PATCH /api/v1/returns/:id, plus the
 * shared read-only GET /api/v1/return-reasons endpoint the create flow uses
 * to populate the reason dropdown. All endpoints require authentication
 * (the customer-facing portal is a separate public route in a later phase).
 */
export async function handleReturnsRoute(
  req: ApiRequest,
  ports: ServerApiPorts,
): Promise<ApiResponse | null> {
  if (req.path === '/api/v1/return-reasons') {
    if (req.method !== 'GET') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
    return handleListReasons(req, ports);
  }

  if (req.path === '/api/v1/returns/portal-settings') {
    return handlePortalSettings(req, ports);
  }

  if (req.path === '/api/v1/returns/analytics') {
    if (req.method !== 'GET') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
    return handleReturnsAnalytics(req, ports);
  }

  if (req.path === '/api/v1/returns/jtl-order-lookup') {
    if (req.method !== 'GET') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
    return handleJtlOrderLookup(req, ports);
  }

  if (req.path === '/api/v1/returns') {
    if (req.method === 'GET') return handleListReturns(req, ports);
    if (req.method === 'POST') return handleCreateReturn(req, ports);
    return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
  }

  const detailMatch = /^\/api\/v1\/returns\/([^/]+)$/.exec(req.path);
  if (detailMatch) {
    const id = positiveIntFromPath(detailMatch[1]);
    if (id === null) return error(400, 'invalid_id', 'id muss eine positive Ganzzahl sein');
    if (req.method === 'GET') return handleGetReturn(req, ports, id);
    if (req.method === 'PATCH') return handleUpdateReturn(req, ports, id);
    return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
  }

  return null;
}

// ----------------------------------------------------------------------------
// Reasons
// ----------------------------------------------------------------------------

async function handleListReasons(req: ApiRequest, ports: ServerApiPorts): Promise<ApiResponse> {
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  if (!ports.returnReasons) return error(503, 'return_reasons_unavailable', 'Return-Reasons API nicht konfiguriert');
  const items = await ports.returnReasons.list({ workspaceId: principal.workspaceId });
  return data(200, { items });
}

// ----------------------------------------------------------------------------
// Analytics (Phase 4 — Retourengründe reporting)
// ----------------------------------------------------------------------------

const MAX_ANALYTICS_SINCE_DAYS = 3650;

async function handleReturnsAnalytics(req: ApiRequest, ports: ServerApiPorts): Promise<ApiResponse> {
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  if (!ports.returns) return error(503, 'returns_unavailable', 'Returns API nicht konfiguriert');

  const sinceDays = parseOptionalSinceDays(req.query?.sinceDays);
  if (sinceDays === null) {
    return error(400, 'invalid_since_days', `sinceDays muss zwischen 1 und ${MAX_ANALYTICS_SINCE_DAYS} liegen`);
  }

  const result = await ports.returns.analytics({
    workspaceId: principal.workspaceId,
    ...(sinceDays === undefined ? {} : { sinceDays }),
  });
  return data(200, result);
}

function parseOptionalSinceDays(value: unknown): number | undefined | null {
  if (value === undefined) return undefined;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1 || n > MAX_ANALYTICS_SINCE_DAYS) return null;
  return n;
}

// ----------------------------------------------------------------------------
// JTL order lookup (Phase 1 port surfaced for the create-return UI)
// ----------------------------------------------------------------------------

async function handleJtlOrderLookup(req: ApiRequest, ports: ServerApiPorts): Promise<ApiResponse> {
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  if (!ports.jtlOrderLookup) {
    // Graceful "JTL nicht konfiguriert" — the UI falls back to manual entry.
    return data(200, { configured: false, order: null });
  }
  const orderNumber = nullableTrimmedString(req.query?.orderNumber, MAX_TEXT_LEN);
  if (!orderNumber) {
    return error(400, 'invalid_order_number', 'orderNumber darf nicht leer sein');
  }
  const result = await ports.jtlOrderLookup.lookupOrderByNumber({
    workspaceId: principal.workspaceId,
    orderNumber,
  });
  if (!result.ok) return data(200, { configured: true, order: null, lookupError: result.error });
  return data(200, { configured: true, order: result.order });
}

// ----------------------------------------------------------------------------
// Returns: list / get
// ----------------------------------------------------------------------------

async function handleListReturns(req: ApiRequest, ports: ServerApiPorts): Promise<ApiResponse> {
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  if (!ports.returns) return error(503, 'returns_unavailable', 'Returns API nicht konfiguriert');

  const limit = parseLimit(req.query?.limit);
  if (limit === null) return error(400, 'invalid_limit', `limit muss zwischen 1 und ${MAX_LIMIT} liegen`);

  const offset = parseOptionalNonnegativeInt(req.query?.offset);
  if (offset === null) return error(400, 'invalid_offset', 'offset muss eine nicht-negative Ganzzahl sein');

  const status = parseOptionalStatus(req.query?.status);
  if (status === null) return error(400, 'invalid_status', `status muss einer der Werte ${STATUS_VALUES.join(', ')} sein`);

  const customerId = parseOptionalPositiveInt(req.query?.customerId);
  if (customerId === null) return error(400, 'invalid_customer_id', 'customerId muss eine positive Ganzzahl sein');

  const search = parseOptionalSearch(req.query?.search);
  if (search === null) return error(400, 'invalid_search', `search darf maximal ${MAX_SEARCH_LEN} Zeichen haben`);

  const result = await ports.returns.list({
    workspaceId: principal.workspaceId,
    limit,
    ...(offset === undefined ? {} : { offset }),
    ...(status === undefined ? {} : { status }),
    ...(customerId === undefined ? {} : { customerId }),
    ...(search === undefined ? {} : { search }),
  });
  return data(200, result);
}

async function handleGetReturn(req: ApiRequest, ports: ServerApiPorts, id: number): Promise<ApiResponse> {
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  if (!ports.returns) return error(503, 'returns_unavailable', 'Returns API nicht konfiguriert');

  const record = await ports.returns.get({ workspaceId: principal.workspaceId, id });
  if (!record) return error(404, 'return_not_found', 'Retoure nicht gefunden');
  return data(200, record);
}

// ----------------------------------------------------------------------------
// Returns: create
// ----------------------------------------------------------------------------

async function handleCreateReturn(req: ApiRequest, ports: ServerApiPorts): Promise<ApiResponse> {
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  if (!ports.returns) return error(503, 'returns_unavailable', 'Returns API nicht konfiguriert');

  const parsed = parseCreateBody(req.body);
  if (!parsed.ok) return error(400, parsed.code, parsed.message);

  const result = await ports.returns.create({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    input: parsed.input,
  });
  if (!result.ok) return error(400, 'create_failed', result.error);
  await recordAudit(ports, principal, 'create', result.record.id, { returnNumber: result.record.returnNumber });
  return data(201, result.record);
}

// ----------------------------------------------------------------------------
// Returns: update
// ----------------------------------------------------------------------------

async function handleUpdateReturn(
  req: ApiRequest,
  ports: ServerApiPorts,
  id: number,
): Promise<ApiResponse> {
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  if (!ports.returns) return error(503, 'returns_unavailable', 'Returns API nicht konfiguriert');

  const parsed = parseUpdateBody(req.body);
  if (!parsed.ok) return error(400, parsed.code, parsed.message);

  const result = await ports.returns.update({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    id,
    update: parsed.update,
  });
  if (!result.ok) {
    if (result.error === 'Retoure nicht gefunden') return error(404, 'return_not_found', result.error);
    return error(400, 'update_failed', result.error);
  }
  await recordAudit(ports, principal, 'update', id, parsed.update as Record<string, unknown>);
  return data(200, result.record);
}

// ----------------------------------------------------------------------------
// Parsing
// ----------------------------------------------------------------------------

type ParseFailure = { ok: false; code: string; message: string };
type ParseCreate = { ok: true; input: ReturnCreateInput };
type ParseUpdate = { ok: true; update: ReturnUpdateInput };

function parseCreateBody(body: unknown): ParseCreate | ParseFailure {
  if (!isRecord(body)) return { ok: false, code: 'invalid_body', message: 'Body muss ein JSON-Objekt sein' };

  const items = parseItems(body.items);
  if (!items.ok) return items;

  const customerId = parseOptionalPositiveIntField(body.customerId, 'customerId');
  if (customerId === undefined && body.customerId != null) {
    return { ok: false, code: 'invalid_customer_id', message: 'customerId muss eine positive Ganzzahl sein' };
  }
  const emailMessageId = parseOptionalPositiveIntField(body.emailMessageId, 'emailMessageId');
  if (emailMessageId === undefined && body.emailMessageId != null) {
    return { ok: false, code: 'invalid_email_message_id', message: 'emailMessageId muss eine positive Ganzzahl sein' };
  }
  const jtlKauftrag = parseOptionalPositiveIntField(body.jtlKauftrag, 'jtlKauftrag');
  if (jtlKauftrag === undefined && body.jtlKauftrag != null) {
    return { ok: false, code: 'invalid_jtl_kauftrag', message: 'jtlKauftrag muss eine positive Ganzzahl sein' };
  }

  return {
    ok: true,
    input: {
      ...(customerId === null ? {} : { customerId }),
      ...(emailMessageId === null ? {} : { emailMessageId }),
      jtlOrderNumber: nullableTrimmedString(body.jtlOrderNumber, MAX_TEXT_LEN),
      ...(jtlKauftrag === null ? {} : { jtlKauftrag }),
      customerEmail: nullableTrimmedString(body.customerEmail, MAX_TEXT_LEN),
      customerName: nullableTrimmedString(body.customerName, MAX_TEXT_LEN),
      notes: nullableTrimmedString(body.notes, MAX_NOTES_LEN),
      items: items.value,
    },
  };
}

function parseUpdateBody(body: unknown): ParseUpdate | ParseFailure {
  if (!isRecord(body)) return { ok: false, code: 'invalid_body', message: 'Body muss ein JSON-Objekt sein' };
  const update: ReturnUpdateInput = {};

  if (body.status !== undefined) {
    const status = parseOptionalStatus(body.status);
    if (status === null || status === undefined) {
      return {
        ok: false,
        code: 'invalid_status',
        message: `status muss einer der Werte ${STATUS_VALUES.join(', ')} sein`,
      };
    }
    update.status = status;
  }
  if (body.outcome !== undefined) {
    if (body.outcome === null) update.outcome = null;
    else if (typeof body.outcome === 'string' && (OUTCOME_VALUES as readonly string[]).includes(body.outcome)) {
      update.outcome = body.outcome as ReturnOutcome;
    } else {
      return {
        ok: false,
        code: 'invalid_outcome',
        message: `outcome muss einer der Werte ${OUTCOME_VALUES.join(', ')} oder null sein`,
      };
    }
  }
  if (body.notes !== undefined) {
    update.notes = nullableTrimmedString(body.notes, MAX_NOTES_LEN);
  }
  if (Object.keys(update).length === 0) {
    return { ok: false, code: 'empty_update', message: 'Mindestens ein Feld muss gesetzt sein (status, outcome, notes)' };
  }
  return { ok: true, update };
}

function parseItems(
  value: unknown,
): { ok: true; value: ReturnItemMutationInput[] } | ParseFailure {
  if (!Array.isArray(value) || value.length === 0) {
    return { ok: false, code: 'invalid_items', message: 'items muss ein nicht-leeres Array sein' };
  }
  const items: ReturnItemMutationInput[] = [];
  for (const raw of value) {
    if (!isRecord(raw)) {
      return { ok: false, code: 'invalid_item', message: 'Jede Position muss ein Objekt sein' };
    }
    const quantity = typeof raw.quantity === 'number' ? raw.quantity : Number(raw.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return { ok: false, code: 'invalid_quantity', message: 'quantity muss > 0 sein' };
    }
    const condition = raw.condition === undefined || raw.condition === null
      ? null
      : (CONDITION_VALUES as readonly string[]).includes(raw.condition as string)
        ? (raw.condition as ReturnItemCondition)
        : 'INVALID';
    if (condition === 'INVALID') {
      return {
        ok: false,
        code: 'invalid_condition',
        message: `condition muss einer der Werte ${CONDITION_VALUES.join(', ')} oder null sein`,
      };
    }
    const productId = parseOptionalPositiveIntField(raw.productId, 'productId');
    if (productId === undefined && raw.productId != null) {
      return { ok: false, code: 'invalid_product_id', message: 'productId muss eine positive Ganzzahl sein' };
    }
    const reasonId = parseOptionalPositiveIntField(raw.reasonId, 'reasonId');
    if (reasonId === undefined && raw.reasonId != null) {
      return { ok: false, code: 'invalid_reason_id', message: 'reasonId muss eine positive Ganzzahl sein' };
    }
    items.push({
      productId: productId ?? undefined,
      reasonId: reasonId ?? undefined,
      sku: nullableTrimmedString(raw.sku, MAX_TEXT_LEN),
      productName: nullableTrimmedString(raw.productName, MAX_TEXT_LEN),
      quantity: Math.floor(quantity),
      condition,
      notes: nullableTrimmedString(raw.notes, MAX_NOTES_LEN),
    });
  }
  return { ok: true, value: items };
}

// ----------------------------------------------------------------------------
// Audit
// ----------------------------------------------------------------------------

async function recordAudit(
  ports: ServerApiPorts,
  principal: AuthenticatedPrincipal,
  action: 'create' | 'update',
  entityId: number,
  metadata: Record<string, unknown>,
): Promise<void> {
  await ports.audit?.record({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    action: `returns.${action}`,
    entityType: 'returns',
    entityId: String(entityId),
    metadata,
  });
}

// ----------------------------------------------------------------------------
// Tiny parsers shared with the validator helpers
// ----------------------------------------------------------------------------

function parseLimit(value: unknown): number | null {
  if (value === undefined) return DEFAULT_LIMIT;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1 || n > MAX_LIMIT) return null;
  return n;
}

function parseOptionalNonnegativeInt(value: unknown): number | undefined | null {
  if (value === undefined) return undefined;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) return null;
  return n;
}

function parseOptionalPositiveInt(value: unknown): number | undefined | null {
  if (value === undefined) return undefined;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) return null;
  return n;
}

function parseOptionalStatus(value: unknown): ReturnStatus | undefined | null {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !(STATUS_VALUES as readonly string[]).includes(value)) return null;
  return value as ReturnStatus;
}

function parseOptionalSearch(value: unknown): string | undefined | null {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  if (trimmed.length > MAX_SEARCH_LEN) return null;
  return trimmed;
}

function parseOptionalPositiveIntField(value: unknown, _fieldName: string): number | undefined | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) return value;
  return undefined;
}

function nullableTrimmedString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLength);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// ============================================================================
// Portal-Settings admin (Phase 5/6 — auth-gated)
// ============================================================================

async function handlePortalSettings(req: ApiRequest, ports: ServerApiPorts): Promise<ApiResponse> {
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  // Admin-only: GET returns the public portal token (a secret) and POST can
  // rotate/enable/revoke it. Every sibling settings mutation requires admin;
  // without this gate any workspace user could read or hijack the portal token.
  if (!requireAdmin(principal)) return error(403, 'forbidden', 'Adminrechte erforderlich');
  if (!ports.returnsPortalSettings) {
    return error(503, 'portal_settings_unavailable', 'Portal-Einstellungen nicht konfiguriert');
  }

  if (req.method === 'GET') {
    const settings = await ports.returnsPortalSettings.get({ workspaceId: principal.workspaceId });
    return data(200, settings);
  }
  if (req.method !== 'POST') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');

  if (!isRecord(req.body)) return error(400, 'invalid_body', 'Body muss ein JSON-Objekt sein');
  const action = typeof req.body.action === 'string' ? req.body.action : '';
  if (action !== 'rotate' && action !== 'set_enabled' && action !== 'revoke') {
    return error(400, 'invalid_action', 'action muss rotate, set_enabled oder revoke sein');
  }

  let result;
  if (action === 'rotate') {
    const enable = typeof req.body.enable === 'boolean' ? req.body.enable : undefined;
    result = await ports.returnsPortalSettings.rotate({
      workspaceId: principal.workspaceId,
      ...(enable === undefined ? {} : { enable }),
    });
  } else if (action === 'set_enabled') {
    if (typeof req.body.enabled !== 'boolean') {
      return error(400, 'invalid_enabled', 'enabled muss boolean sein');
    }
    result = await ports.returnsPortalSettings.setEnabled({
      workspaceId: principal.workspaceId,
      enabled: req.body.enabled,
    });
  } else {
    result = await ports.returnsPortalSettings.revoke({ workspaceId: principal.workspaceId });
  }

  await ports.audit?.record({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    action: `returns.portal_settings.${action}`,
    entityType: 'returns_portal_settings',
    entityId: principal.workspaceId,
    metadata: { enabled: result.enabled, hasToken: result.hasToken },
  });
  return data(200, result);
}

// ============================================================================
// Public portal (Phase 5/6 — UNAUTHENTICATED)
//
// Two endpoints, both behind the per-workspace portal token:
//   POST /api/v1/portal/returns/:token            — create a return (CAPTCHA)
//   GET  /api/v1/portal/returns/:token/:returnNo  — public status lookup
//
// Token-in-path keeps the workspace resolution close to the URL the customer
// pastes in (and makes it impossible to forget the token: an empty path
// segment fails the path matcher before any port is called).
// ============================================================================

const MAX_PORTAL_TOKEN_LEN = 200;
const MAX_PORTAL_ITEMS = 50;
const PORTAL_RETURN_NUMBER_RE = /^[A-Za-z0-9_-]{1,64}$/;

// In-process sliding-window rate limiter for the public endpoints. Applied at
// dispatcher entry (before token resolution) so it also throttles token
// probing. Keyed per client IP; the API runs as a single process in this
// deployment, so process-local state is the right scope. Limits are generous
// for a legitimate customer and hostile to enumeration.
const PORTAL_CREATE_RATE = { limit: 10, windowMs: 60 * 60 * 1000 };
const PORTAL_LOOKUP_RATE = { limit: 30, windowMs: 60 * 1000 };

export type PortalRateLimiter = {
  /** Records a hit for the key and reports whether it is within the window limit. */
  check(key: string, now?: number): { ok: true } | { ok: false; retryAfterSeconds: number };
};

export function createPortalRateLimiter(options: { limit: number; windowMs: number }): PortalRateLimiter {
  const hits = new Map<string, number[]>();
  return {
    check(key, nowInput) {
      const now = nowInput ?? Date.now();
      const cutoff = now - options.windowMs;
      const recent = (hits.get(key) ?? []).filter((t) => t > cutoff);
      if (recent.length >= options.limit) {
        hits.set(key, recent);
        const oldest = recent[0] ?? now;
        return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((oldest + options.windowMs - now) / 1000)) };
      }
      recent.push(now);
      hits.set(key, recent);
      if (hits.size > 10_000) {
        for (const [k, v] of hits) {
          if (v.every((t) => t <= cutoff)) hits.delete(k);
        }
      }
      return { ok: true };
    },
  };
}

let portalCreateLimiter = createPortalRateLimiter(PORTAL_CREATE_RATE);
let portalLookupLimiter = createPortalRateLimiter(PORTAL_LOOKUP_RATE);

/** Test hook: module-level limiter state would otherwise leak between tests. */
export function resetPortalRateLimitersForTests(): void {
  portalCreateLimiter = createPortalRateLimiter(PORTAL_CREATE_RATE);
  portalLookupLimiter = createPortalRateLimiter(PORTAL_LOOKUP_RATE);
}

export async function handlePublicPortalRoute(
  req: ApiRequest,
  ports: ServerApiPorts,
): Promise<ApiResponse | null> {
  // Hot path matchers — same pattern as the authenticated dispatcher above.
  const createMatch = /^\/api\/v1\/portal\/returns\/([^/]+)$/.exec(req.path);
  if (createMatch && req.method === 'POST') {
    const limited = portalCreateLimiter.check(`create:${req.ip ?? 'unknown'}`);
    if (!limited.ok) {
      return error(429, 'rate_limited', 'Zu viele Anfragen — bitte später erneut versuchen', {
        retryAfterSeconds: limited.retryAfterSeconds,
      });
    }
    return handlePortalCreate(req, ports, createMatch[1] ?? '');
  }
  const detailMatch = /^\/api\/v1\/portal\/returns\/([^/]+)\/([^/]+)$/.exec(req.path);
  if (detailMatch && req.method === 'GET') {
    const limited = portalLookupLimiter.check(`lookup:${req.ip ?? 'unknown'}`);
    if (!limited.ok) {
      return error(429, 'rate_limited', 'Zu viele Anfragen — bitte später erneut versuchen', {
        retryAfterSeconds: limited.retryAfterSeconds,
      });
    }
    return handlePortalLookup(req, ports, detailMatch[1] ?? '', detailMatch[2] ?? '');
  }
  // 405 on a wrong-method match against a known path; null otherwise so the
  // outer dispatcher can fall through to its 404.
  if (createMatch || detailMatch) return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
  return null;
}

async function resolvePortal(
  ports: ServerApiPorts,
  token: string,
): Promise<{ workspaceId: string } | ApiResponse> {
  if (!ports.returnsPortalSettings) {
    return error(503, 'portal_unavailable', 'Portal nicht konfiguriert');
  }
  if (!token || token.length > MAX_PORTAL_TOKEN_LEN) {
    return error(404, 'portal_not_found', 'Portal nicht gefunden');
  }
  const resolved: ReturnsPortalResolveResult = await ports.returnsPortalSettings.resolveByToken({ token });
  if (!resolved.ok) {
    if (resolved.reason === 'portal_disabled') {
      return error(403, 'portal_disabled', 'Portal aktuell deaktiviert');
    }
    return error(404, 'portal_not_found', 'Portal nicht gefunden');
  }
  return { workspaceId: resolved.workspaceId };
}

async function handlePortalCreate(
  req: ApiRequest,
  ports: ServerApiPorts,
  token: string,
): Promise<ApiResponse> {
  const resolved = await resolvePortal(ports, token);
  if ('status' in resolved) return resolved;
  if (!ports.returns) return error(503, 'returns_unavailable', 'Returns API nicht konfiguriert');

  // CAPTCHA: when the workspace has captcha enabled in its login security
  // settings, the public create endpoint also requires a fresh challenge.
  // assertCaptchaChallenge consumes the challenge so each one is single-use.
  // When loginSecurity is NOT wired at all the gate degrades open by design
  // (matching the login flow) — but the audit record below carries
  // captcha:'unavailable' so such deployments are visible, not silent.
  let captchaStatus: 'passed' | 'not_required' | 'unavailable' = 'unavailable';
  if (ports.loginSecurity) {
    const loginConfig = await ports.loginSecurity.getLoginConfig();
    if (loginConfig?.captcha.enabled) {
      const challenge = isRecord(req.body) && typeof req.body.captchaChallenge === 'string'
        ? req.body.captchaChallenge
        : undefined;
      const ip = req.ip ?? '0.0.0.0';
      if (!(await ports.loginSecurity.assertCaptchaChallenge({ challenge, ip }))) {
        return error(403, 'captcha_required', 'CAPTCHA-Bestaetigung erforderlich');
      }
      captchaStatus = 'passed';
    } else {
      captchaStatus = 'not_required';
    }
  }

  const parsed = parsePortalCreateBody(req.body);
  if (!parsed.ok) return error(400, parsed.code, parsed.message);

  const result = await ports.returns.createPublic({
    workspaceId: resolved.workspaceId,
    input: parsed.input,
  });
  if (!result.ok) return error(400, 'create_failed', result.error);
  await ports.audit?.record({
    workspaceId: resolved.workspaceId,
    actorUserId: 'portal',
    action: 'returns.portal.create',
    entityType: 'returns',
    entityId: result.record.returnNumber,
    metadata: { ip: req.ip ?? null, captcha: captchaStatus },
  });
  return data(201, result.record);
}

async function handlePortalLookup(
  req: ApiRequest,
  ports: ServerApiPorts,
  token: string,
  returnNumber: string,
): Promise<ApiResponse> {
  const resolved = await resolvePortal(ports, token);
  if ('status' in resolved) return resolved;
  if (!ports.returns) return error(503, 'returns_unavailable', 'Returns API nicht konfiguriert');
  // Strict shape allowlist on the unauthenticated input. Generated numbers are
  // R-<hex>; the allowlist gives headroom but excludes SQL-LIKE wildcards
  // (%, _ is allowed and harmless under exact equality), path tricks and
  // percent-encodings — defense in depth on top of the exact-match lookup.
  if (!returnNumber || !PORTAL_RETURN_NUMBER_RE.test(returnNumber)) {
    return error(400, 'invalid_return_number', 'returnNumber ungueltig');
  }
  const record = await ports.returns.getPublicByReturnNumber({
    workspaceId: resolved.workspaceId,
    returnNumber,
  });
  if (!record) {
    // 404 with the same body shape as a wrong-token-on-create so we don't
    // leak which workspace exists vs. which return exists.
    return error(404, 'return_not_found', 'Retoure nicht gefunden');
  }
  return data(200, record);
}

function parsePortalCreateBody(
  body: unknown,
): { ok: true; input: PortalReturnCreateInput } | ParseFailure {
  if (!isRecord(body)) return { ok: false, code: 'invalid_body', message: 'Body muss ein JSON-Objekt sein' };
  const items = parseItems(body.items);
  if (!items.ok) return items;
  if (items.value.length > MAX_PORTAL_ITEMS) {
    return { ok: false, code: 'too_many_items', message: `max. ${MAX_PORTAL_ITEMS} Positionen` };
  }
  return {
    ok: true,
    input: {
      jtlOrderNumber: nullableTrimmedString(body.jtlOrderNumber, MAX_TEXT_LEN),
      customerEmail: nullableTrimmedString(body.customerEmail, MAX_TEXT_LEN),
      customerName: nullableTrimmedString(body.customerName, MAX_TEXT_LEN),
      notes: nullableTrimmedString(body.notes, MAX_NOTES_LEN),
      items: items.value,
    },
  };
}
