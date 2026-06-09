import type {
  ApiRequest,
  ApiResponse,
  AuthenticatedPrincipal,
  ReturnCreateInput,
  ReturnItemCondition,
  ReturnItemMutationInput,
  ReturnOutcome,
  ReturnStatus,
  ReturnUpdateInput,
  ServerApiPorts,
} from './types';
import {
  data,
  error,
  positiveIntFromPath,
  requirePrincipal,
} from './types';

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
    items.push({
      productId: parseOptionalPositiveIntField(raw.productId, 'productId') ?? undefined,
      reasonId: parseOptionalPositiveIntField(raw.reasonId, 'reasonId') ?? undefined,
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
