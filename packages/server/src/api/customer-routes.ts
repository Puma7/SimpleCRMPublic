import type {
  ApiErrorBody,
  ApiRequest,
  ApiResponse,
  AuthenticatedPrincipal,
  CustomerMutationInput,
  CustomerRecord,
  ServerApiPorts,
} from './types';
import {
  data,
  error,
  positiveIntFromPath,
  requirePrincipal,
} from './types';

const DEFAULT_CUSTOMER_LIMIT = 50;
const MAX_CUSTOMER_LIMIT = 100;
const CUSTOMER_MUTATION_FIELDS = {
  customerNumber: { maxLength: 100, nullable: true },
  name: { maxLength: 200, nullable: true },
  firstName: { maxLength: 200, nullable: true },
  company: { maxLength: 200, nullable: true },
  email: { maxLength: 254, nullable: true },
  phone: { maxLength: 100, nullable: true },
  mobile: { maxLength: 100, nullable: true },
  street: { maxLength: 300, nullable: true },
  zipCode: { maxLength: 50, nullable: true },
  city: { maxLength: 100, nullable: true },
  country: { maxLength: 100, nullable: true },
  notes: { maxLength: 10000, nullable: true },
  status: { maxLength: 50, nullable: false },
} as const;

type CustomerMutationField = keyof typeof CUSTOMER_MUTATION_FIELDS;

type CustomerMutationParseResult =
  | { ok: true; values: CustomerMutationInput }
  | { ok: false; response: ApiResponse<ApiErrorBody> };

export async function handleCustomerRoute(
  req: ApiRequest,
  ports: ServerApiPorts,
): Promise<ApiResponse | null> {
  if (req.path === '/api/v1/customers') {
    const principal = requirePrincipal(req);
    if ('status' in principal) return principal;

    if (req.method === 'POST') {
      return handleCreateCustomer(req, ports, principal);
    }
    if (req.method !== 'GET') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');

    const limit = parseLimit(req.query?.limit);
    if (limit === null) return error(400, 'invalid_limit', `limit muss zwischen 1 und ${MAX_CUSTOMER_LIMIT} liegen`);

    const cursor = parseOptionalPositiveInt(req.query?.cursor);
    if (cursor === null) return error(400, 'invalid_cursor', 'cursor muss eine positive Ganzzahl sein');

    const offset = parseOptionalNonnegativeInt(req.query?.offset);
    if (offset === null) return error(400, 'invalid_offset', 'offset muss eine nicht-negative Ganzzahl sein');
    if (cursor !== undefined && offset !== undefined) {
      return error(400, 'ambiguous_pagination', 'cursor und offset duerfen nicht gemeinsam gesetzt werden');
    }

    const search = normalizeSearch(req.query?.search);
    if (search === null) return error(400, 'invalid_search', 'search darf maximal 200 Zeichen haben');

    const status = normalizeOptionalText(req.query?.status, 50);
    if (status === null) return error(400, 'invalid_status', 'status darf maximal 50 Zeichen haben');

    const sortBy = normalizeOptionalText(req.query?.sortBy, 50);
    if (sortBy === null) return error(400, 'invalid_sort_by', 'sortBy darf maximal 50 Zeichen haben');

    const sortDirection = parseSortDirection(req.query?.sortDirection);
    if (sortDirection === null) return error(400, 'invalid_sort_direction', 'sortDirection muss asc oder desc sein');

    if (!ports.customers) return error(503, 'customers_unavailable', 'Customer API nicht konfiguriert');

    const result = await ports.customers.list({
      workspaceId: principal.workspaceId,
      limit,
      ...(cursor === undefined ? {} : { cursor }),
      ...(offset === undefined ? {} : { offset }),
      ...(search === undefined ? {} : { search }),
      ...(status === undefined ? {} : { status }),
      ...(sortBy === undefined ? {} : { sortBy }),
      ...(sortDirection === undefined ? {} : { sortDirection }),
    });
    return data(200, result);
  }

  const match = /^\/api\/v1\/customers\/([^/]+)$/.exec(req.path);
  if (!match) return null;

  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;

  const id = positiveIntFromPath(match[1]);
  if (id === null) return error(400, 'invalid_customer_id', 'customer id muss eine positive Ganzzahl sein');
  if (!ports.customers) return error(503, 'customers_unavailable', 'Customer API nicht konfiguriert');

  if (req.method === 'PATCH') {
    return handleUpdateCustomer(req, ports, principal, id);
  }
  if (req.method === 'DELETE') {
    return handleDeleteCustomer(ports, principal, id);
  }
  if (req.method !== 'GET') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');

  const customer = await ports.customers.get({
    workspaceId: principal.workspaceId,
    id,
  });
  if (!customer) return error(404, 'customer_not_found', 'Customer nicht gefunden');
  return data(200, customer);
}

async function handleCreateCustomer(
  req: ApiRequest,
  ports: ServerApiPorts,
  principal: AuthenticatedPrincipal,
): Promise<ApiResponse> {
  if (!ports.customers?.create) {
    return error(503, 'customers_unavailable', 'Customer API nicht konfiguriert');
  }

  const parsed = parseCustomerMutationBody(req.body, {
    requireAtLeastOneField: true,
    requireIdentity: true,
  });
  if (!parsed.ok) return parsed.response;

  const customer = await ports.customers.create({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    values: parsed.values,
  });
  await ports.audit?.record({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    action: 'customer.created',
    entityType: 'customer',
    entityId: String(customer.id),
    metadata: {
      id: customer.id,
      sourceSqliteId: customer.sourceSqliteId,
    },
  });
  await publishCustomerEvent(ports, 'customer.created', principal.workspaceId, customer, principal.userId);
  return data(201, customer);
}

async function handleUpdateCustomer(
  req: ApiRequest,
  ports: ServerApiPorts,
  principal: AuthenticatedPrincipal,
  id: number,
): Promise<ApiResponse> {
  if (!ports.customers?.update) {
    return error(503, 'customers_unavailable', 'Customer API nicht konfiguriert');
  }

  const parsed = parseCustomerMutationBody(req.body, {
    requireAtLeastOneField: true,
    requireIdentity: false,
  });
  if (!parsed.ok) return parsed.response;

  const customer = await ports.customers.update({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    id,
    values: parsed.values,
  });
  if (!customer) return error(404, 'customer_not_found', 'Customer nicht gefunden');

  await ports.audit?.record({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    action: 'customer.updated',
    entityType: 'customer',
    entityId: String(customer.id),
    metadata: {
      id: customer.id,
      fields: Object.keys(parsed.values).sort(),
    },
  });
  await publishCustomerEvent(ports, 'customer.updated', principal.workspaceId, customer, principal.userId);
  return data(200, customer);
}

async function handleDeleteCustomer(
  ports: ServerApiPorts,
  principal: AuthenticatedPrincipal,
  id: number,
): Promise<ApiResponse> {
  if (!ports.customers?.delete) {
    return error(503, 'customers_unavailable', 'Customer API nicht konfiguriert');
  }

  const customer = await ports.customers.delete({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    id,
  });
  if (!customer) return error(404, 'customer_not_found', 'Customer nicht gefunden');

  await ports.audit?.record({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    action: 'customer.deleted',
    entityType: 'customer',
    entityId: String(customer.id),
    metadata: {
      id: customer.id,
      sourceSqliteId: customer.sourceSqliteId,
    },
  });
  await publishCustomerEvent(ports, 'customer.deleted', principal.workspaceId, customer, principal.userId);
  return data(200, { deleted: true, customer });
}

async function publishCustomerEvent(
  ports: ServerApiPorts,
  type: 'customer.created' | 'customer.updated' | 'customer.deleted',
  workspaceId: string,
  customer: CustomerRecord,
  actorUserId: string,
): Promise<void> {
  await ports.events?.publish({
    type,
    workspaceId,
    entityType: 'customer',
    entityId: String(customer.id),
    actorUserId,
    occurredAt: new Date().toISOString(),
    payload: {
      id: customer.id,
      sourceSqliteId: customer.sourceSqliteId,
      customerNumber: customer.customerNumber,
      name: customer.name,
      email: customer.email,
    },
  });
}

function parseLimit(value: string | undefined): number | null {
  if (value === undefined || value === '') return DEFAULT_CUSTOMER_LIMIT;
  const limit = parsePositiveInt(value);
  if (limit === null || limit > MAX_CUSTOMER_LIMIT) return null;
  return limit;
}

function parseOptionalPositiveInt(value: string | undefined): number | undefined | null {
  if (value === undefined || value === '') return undefined;
  return parsePositiveInt(value);
}

function parseOptionalNonnegativeInt(value: string | undefined): number | undefined | null {
  if (value === undefined || value === '') return undefined;
  if (!/^(0|[1-9]\d*)$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function parsePositiveInt(value: string): number | null {
  if (!/^[1-9]\d*$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function normalizeSearch(value: string | undefined): string | undefined | null {
  if (value === undefined) return undefined;
  const normalized = value.trim();
  if (!normalized) return undefined;
  if (normalized.length > 200) return null;
  return normalized;
}

function normalizeOptionalText(value: string | undefined, maxLength: number): string | undefined | null {
  if (value === undefined) return undefined;
  const normalized = value.trim();
  if (!normalized) return undefined;
  if (normalized.length > maxLength) return null;
  return normalized;
}

function parseSortDirection(value: string | undefined): 'asc' | 'desc' | undefined | null {
  if (value === undefined || value === '') return undefined;
  if (value === 'asc' || value === 'desc') return value;
  return null;
}

function parseCustomerMutationBody(
  body: unknown,
  options: {
    requireAtLeastOneField: boolean;
    requireIdentity: boolean;
  },
): CustomerMutationParseResult {
  if (!isPlainObject(body)) {
    return {
      ok: false,
      response: error(400, 'invalid_customer_payload', 'Customer-Payload muss ein JSON-Objekt sein'),
    };
  }

  const values: CustomerMutationInput = {};
  const errors: Array<{ field: string; message: string }> = [];
  const allowedFields = new Set(Object.keys(CUSTOMER_MUTATION_FIELDS));

  for (const key of Object.keys(body)) {
    if (!allowedFields.has(key)) {
      errors.push({ field: key, message: 'Feld ist nicht erlaubt' });
    }
  }

  for (const field of Object.keys(CUSTOMER_MUTATION_FIELDS) as CustomerMutationField[]) {
    if (!Object.prototype.hasOwnProperty.call(body, field)) continue;
    const value = normalizeCustomerTextField(field, body[field]);
    if (value.ok) {
      assignCustomerMutationField(values, field, value.value);
    } else {
      errors.push({ field, message: value.message });
    }
  }

  if (errors.length > 0) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'Customer-Payload ist ungueltig', { fields: errors }),
    };
  }
  if (options.requireAtLeastOneField && Object.keys(values).length === 0) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'Mindestens ein Customer-Feld ist erforderlich'),
    };
  }
  if (options.requireIdentity && !hasCustomerIdentity(values)) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'name, company oder email ist fuer neue Kunden erforderlich'),
    };
  }

  return { ok: true, values };
}

function normalizeCustomerTextField(
  field: CustomerMutationField,
  rawValue: unknown,
): { ok: true; value: string | null } | { ok: false; message: string } {
  const definition = CUSTOMER_MUTATION_FIELDS[field];
  if (rawValue === null) {
    return definition.nullable
      ? { ok: true, value: null }
      : { ok: false, message: 'Feld darf nicht null sein' };
  }
  if (typeof rawValue !== 'string') {
    return { ok: false, message: 'Feld muss ein String sein' };
  }

  const value = rawValue.trim();
  if (!value) {
    return definition.nullable
      ? { ok: true, value: null }
      : { ok: false, message: 'Feld darf nicht leer sein' };
  }
  if (value.length > definition.maxLength) {
    return { ok: false, message: `Feld darf maximal ${definition.maxLength} Zeichen haben` };
  }
  if (field === 'email' && !isValidEmail(value)) {
    return { ok: false, message: 'email muss eine gueltige Adresse sein' };
  }
  return { ok: true, value };
}

function assignCustomerMutationField(
  values: CustomerMutationInput,
  field: CustomerMutationField,
  value: string | null,
): void {
  if (field === 'status') {
    if (value !== null) values.status = value;
    return;
  }
  values[field] = value;
}

function hasCustomerIdentity(values: CustomerMutationInput): boolean {
  return Boolean(values.name || values.company || values.email);
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+$/.test(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
