import type {
  ApiErrorBody,
  ApiRequest,
  ApiResponse,
  AuthenticatedPrincipal,
  DealProductMutationInput,
  DealProductRecord,
  DealMutationInput,
  DealRecord,
  ProductMutationInput,
  ProductRecord,
  ServerApiPorts,
  TaskMutationInput,
  TaskRecord,
} from './types';
import {
  data,
  error,
  positiveIntFromPath,
  requirePrincipal,
} from './types';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

type CoreCrmResource = 'products' | 'deals' | 'tasks';

const PRODUCT_MUTATION_FIELDS = {
  name: { maxLength: 300, nullable: false },
  sku: { maxLength: 100, nullable: true },
  description: { maxLength: 10000, nullable: true },
  price: { maxLength: 32, nullable: false },
  isActive: { nullable: false },
} as const;

type ProductMutationField = keyof typeof PRODUCT_MUTATION_FIELDS;

type ProductMutationParseResult =
  | { ok: true; values: ProductMutationInput }
  | { ok: false; response: ApiResponse<ApiErrorBody> };

type DealMutationParseResult =
  | { ok: true; values: DealMutationInput }
  | { ok: false; response: ApiResponse<ApiErrorBody> };

type DealProductMutationParseResult =
  | { ok: true; values: DealProductMutationInput }
  | { ok: false; response: ApiResponse<ApiErrorBody> };

type TaskMutationParseResult =
  | { ok: true; values: TaskMutationInput }
  | { ok: false; response: ApiResponse<ApiErrorBody> };

export async function handleCoreCrmReadRoute(
  req: ApiRequest,
  ports: ServerApiPorts,
): Promise<ApiResponse | null> {
  const listMatch = /^\/api\/v1\/(products|deals|tasks)$/.exec(req.path);
  if (listMatch) {
    return handleListRoute(req, ports, listMatch[1] as CoreCrmResource);
  }

  const dealTasksMatch = /^\/api\/v1\/deals\/([^/]+)\/tasks$/.exec(req.path);
  if (dealTasksMatch) {
    return handleDealTasksRoute(req, ports, dealTasksMatch[1]);
  }

  const dealProductByProductMatch = /^\/api\/v1\/deals\/([^/]+)\/products\/by-product\/([^/]+)$/.exec(req.path);
  if (dealProductByProductMatch) {
    return handleDealProductRoute(req, ports, {
      rawDealId: dealProductByProductMatch[1],
      rawProductId: dealProductByProductMatch[2],
    });
  }

  const dealProductsMatch = /^\/api\/v1\/deals\/([^/]+)\/products(?:\/([^/]+))?$/.exec(req.path);
  if (dealProductsMatch) {
    return handleDealProductRoute(req, ports, {
      rawDealId: dealProductsMatch[1],
      rawDealProductId: dealProductsMatch[2],
    });
  }

  const dealStageMatch = /^\/api\/v1\/deals\/([^/]+)\/stage$/.exec(req.path);
  if (dealStageMatch) {
    return handleDealStageRoute(req, ports, dealStageMatch[1]);
  }

  const taskToggleMatch = /^\/api\/v1\/tasks\/([^/]+)\/toggle$/.exec(req.path);
  if (taskToggleMatch) {
    return handleTaskToggleRoute(req, ports, taskToggleMatch[1]);
  }

  const dealProductMatch = /^\/api\/v1\/deal-products\/([^/]+)$/.exec(req.path);
  if (dealProductMatch) {
    return handleDealProductRoute(req, ports, {
      rawDealProductId: dealProductMatch[1],
    });
  }

  const getMatch = /^\/api\/v1\/(products|deals|tasks)\/([^/]+)$/.exec(req.path);
  if (getMatch) {
    return handleGetRoute(req, ports, getMatch[1] as CoreCrmResource, getMatch[2]);
  }

  return null;
}

async function handleListRoute(
  req: ApiRequest,
  ports: ServerApiPorts,
  resource: CoreCrmResource,
): Promise<ApiResponse> {
  if (resource === 'products' && req.method === 'POST') {
    const principal = requirePrincipal(req);
    if ('status' in principal) return principal;
    return handleCreateProduct(req, ports, principal);
  }
  if (resource === 'deals' && req.method === 'POST') {
    const principal = requirePrincipal(req);
    if ('status' in principal) return principal;
    return handleCreateDeal(req, ports, principal);
  }
  if (resource === 'tasks' && req.method === 'POST') {
    const principal = requirePrincipal(req);
    if ('status' in principal) return principal;
    return handleCreateTask(req, ports, principal);
  }
  if (req.method !== 'GET') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;

  const limit = parseLimit(req.query?.limit);
  if (limit === null) return error(400, 'invalid_limit', `limit muss zwischen 1 und ${MAX_LIMIT} liegen`);

  const cursor = parseOptionalPositiveInt(req.query?.cursor);
  if (cursor === null) return error(400, 'invalid_cursor', 'cursor muss eine positive Ganzzahl sein');

  const search = normalizeTextFilter(req.query?.search, 'search', 200);
  if (search === null) return error(400, 'invalid_search', 'search darf maximal 200 Zeichen haben');

  switch (resource) {
    case 'products': {
      if (!ports.products) return error(503, 'products_unavailable', 'Product API nicht konfiguriert');
      return data(200, await ports.products.list({
        workspaceId: principal.workspaceId,
        limit,
        ...(cursor === undefined ? {} : { cursor }),
        ...(search === undefined ? {} : { search }),
      }));
    }
    case 'deals': {
      const stage = normalizeTextFilter(req.query?.stage, 'stage', 100);
      if (stage === null) return error(400, 'invalid_stage', 'stage darf maximal 100 Zeichen haben');
      const customerId = parseOptionalPositiveInt(req.query?.customerId);
      if (customerId === null) return error(400, 'invalid_customer_id', 'customerId muss eine positive Ganzzahl sein');
      if (!ports.deals) return error(503, 'deals_unavailable', 'Deal API nicht konfiguriert');
      return data(200, await ports.deals.list({
        workspaceId: principal.workspaceId,
        limit,
        ...(cursor === undefined ? {} : { cursor }),
        ...(search === undefined ? {} : { search }),
        ...(stage === undefined ? {} : { stage }),
        ...(customerId === undefined ? {} : { customerId }),
      }));
    }
    case 'tasks': {
      const customerId = parseOptionalPositiveInt(req.query?.customerId);
      if (customerId === null) return error(400, 'invalid_customer_id', 'customerId muss eine positive Ganzzahl sein');
      const completed = parseOptionalBoolean(req.query?.completed);
      if (completed === null) return error(400, 'invalid_completed', 'completed muss true oder false sein');
      if (!ports.tasks) return error(503, 'tasks_unavailable', 'Task API nicht konfiguriert');
      return data(200, await ports.tasks.list({
        workspaceId: principal.workspaceId,
        limit,
        ...(cursor === undefined ? {} : { cursor }),
        ...(search === undefined ? {} : { search }),
        ...(customerId === undefined ? {} : { customerId }),
        ...(completed === undefined ? {} : { completed }),
      }));
    }
    default:
      return assertNever(resource);
  }
}

async function handleDealTasksRoute(
  req: ApiRequest,
  ports: ServerApiPorts,
  rawDealId: string | undefined,
): Promise<ApiResponse> {
  if (req.method !== 'GET') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;

  const dealId = positiveIntFromPath(rawDealId);
  if (dealId === null) return error(400, 'invalid_deal_id', 'deal id muss eine positive Ganzzahl sein');
  const limit = parseLimit(req.query?.limit);
  if (limit === null) return error(400, 'invalid_limit', `limit muss zwischen 1 und ${MAX_LIMIT} liegen`);
  const cursor = parseOptionalPositiveInt(req.query?.cursor);
  if (cursor === null) return error(400, 'invalid_cursor', 'cursor muss eine positive Ganzzahl sein');

  if (!ports.deals) return error(503, 'deals_unavailable', 'Deal API nicht konfiguriert');
  if (!ports.tasks) return error(503, 'tasks_unavailable', 'Task API nicht konfiguriert');

  const deal = await ports.deals.get({ workspaceId: principal.workspaceId, id: dealId });
  if (!deal) return error(404, 'deal_not_found', 'Deal nicht gefunden');
  if (deal.customerId === null) return data(200, { items: [], nextCursor: null });

  return data(200, await ports.tasks.list({
    workspaceId: principal.workspaceId,
    customerId: deal.customerId,
    limit,
    ...(cursor === undefined ? {} : { cursor }),
  }));
}

async function handleDealStageRoute(
  req: ApiRequest,
  ports: ServerApiPorts,
  rawDealId: string | undefined,
): Promise<ApiResponse> {
  if (req.method !== 'POST') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;

  const id = positiveIntFromPath(rawDealId);
  if (id === null) return error(400, 'invalid_deal_id', 'deal id muss eine positive Ganzzahl sein');

  if (!isPlainObject(req.body)) {
    return error(400, 'invalid_deal_stage_payload', 'Deal-Stage-Payload muss ein JSON-Objekt sein');
  }

  const errors: Array<{ field: string; message: string }> = [];
  for (const key of Object.keys(req.body)) {
    if (key !== 'stage') errors.push({ field: key, message: 'Feld ist nicht erlaubt' });
  }

  const stage = Object.prototype.hasOwnProperty.call(req.body, 'stage')
    ? normalizeRequiredTextBodyField(req.body.stage, 100)
    : { ok: false as const, message: 'stage ist erforderlich' };
  const normalizedStage = stage.ok ? stage.value : undefined;
  if (!stage.ok) errors.push({ field: 'stage', message: stage.message });
  if (errors.length > 0) {
    return error(400, 'validation_error', 'Deal-Stage-Payload ist ungueltig', { fields: errors });
  }

  return handleUpdateDeal({
    ...req,
    method: 'PATCH',
    path: `/api/v1/deals/${id}`,
    body: { stage: normalizedStage },
  }, ports, principal, id);
}

async function handleTaskToggleRoute(
  req: ApiRequest,
  ports: ServerApiPorts,
  rawTaskId: string | undefined,
): Promise<ApiResponse> {
  if (req.method !== 'POST') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;

  const id = positiveIntFromPath(rawTaskId);
  if (id === null) return error(400, 'invalid_task_id', 'task id muss eine positive Ganzzahl sein');

  if (!isPlainObject(req.body)) {
    return error(400, 'invalid_task_toggle_payload', 'Task-Toggle-Payload muss ein JSON-Objekt sein');
  }

  const errors: Array<{ field: string; message: string }> = [];
  for (const key of Object.keys(req.body)) {
    if (key !== 'completed') errors.push({ field: key, message: 'Feld ist nicht erlaubt' });
  }
  if (typeof req.body.completed !== 'boolean') {
    errors.push({ field: 'completed', message: 'completed (boolean) ist erforderlich' });
  }
  if (errors.length > 0) {
    return error(400, 'validation_error', 'Task-Toggle-Payload ist ungueltig', { fields: errors });
  }

  return handleUpdateTask({
    ...req,
    method: 'PATCH',
    path: `/api/v1/tasks/${id}`,
    body: { completed: req.body.completed },
  }, ports, principal, id);
}

async function handleDealProductRoute(
  req: ApiRequest,
  ports: ServerApiPorts,
  ids: {
    rawDealId?: string;
    rawDealProductId?: string;
    rawProductId?: string;
  },
): Promise<ApiResponse> {
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;

  const dealId = ids.rawDealId === undefined ? undefined : positiveIntFromPath(ids.rawDealId);
  if (dealId === null) return error(400, 'invalid_deal_id', 'deal id muss eine positive Ganzzahl sein');
  const dealProductId = ids.rawDealProductId === undefined ? undefined : positiveIntFromPath(ids.rawDealProductId);
  if (dealProductId === null) {
    return error(400, 'invalid_deal_product_id', 'deal product id muss eine positive Ganzzahl sein');
  }
  const productId = ids.rawProductId === undefined ? undefined : positiveIntFromPath(ids.rawProductId);
  if (productId === null) return error(400, 'invalid_product_id', 'product id muss eine positive Ganzzahl sein');

  if (!ports.dealProducts) return error(503, 'deal_products_unavailable', 'Deal Product API nicht konfiguriert');

  if (req.method === 'GET') {
    if (dealId === undefined || dealProductId !== undefined || productId !== undefined) {
      return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
    }
    const items = await ports.dealProducts.list({
      workspaceId: principal.workspaceId,
      dealId,
    });
    return items === null
      ? error(404, 'deal_not_found', 'Deal nicht gefunden')
      : data(200, items);
  }

  if (req.method === 'POST') {
    if (dealId === undefined || dealProductId !== undefined || productId !== undefined) {
      return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
    }
    const parsed = parseDealProductMutationBody(req.body, {
      requireProduct: true,
      requireQuantity: true,
      requirePrice: true,
    });
    if (!parsed.ok) return parsed.response;
    const result = await ports.dealProducts.add({
      workspaceId: principal.workspaceId,
      actorUserId: principal.userId,
      values: {
        ...parsed.values,
        dealId,
      },
    });
    if (!result.ok) return dealProductMutationError(result.code);
    await auditDealProductMutation(ports, principal, 'deal_product.created', result.dealProduct, Object.keys(parsed.values));
    await publishDealProductEvent(ports, 'deal_product.created', principal.workspaceId, result.dealProduct, principal.userId);
    return data(201, result.dealProduct);
  }

  if (req.method === 'PATCH') {
    const parsed = parseDealProductMutationBody(req.body, {
      requireProduct: false,
      requireQuantity: true,
      requirePrice: false,
    });
    if (!parsed.ok) return parsed.response;
    const result = await ports.dealProducts.update({
      workspaceId: principal.workspaceId,
      actorUserId: principal.userId,
      values: {
        ...parsed.values,
        ...(dealId === undefined ? {} : { dealId }),
        ...(dealProductId === undefined ? {} : { dealProductId }),
        ...(productId === undefined ? {} : { productId }),
      },
    });
    if (!result.ok) return dealProductMutationError(result.code);
    await auditDealProductMutation(ports, principal, 'deal_product.updated', result.dealProduct, Object.keys(parsed.values));
    await publishDealProductEvent(ports, 'deal_product.updated', principal.workspaceId, result.dealProduct, principal.userId);
    return data(200, result.dealProduct);
  }

  if (req.method === 'DELETE') {
    const result = await ports.dealProducts.delete({
      workspaceId: principal.workspaceId,
      actorUserId: principal.userId,
      values: {
        ...(dealId === undefined ? {} : { dealId }),
        ...(dealProductId === undefined ? {} : { dealProductId }),
        ...(productId === undefined ? {} : { productId }),
      },
    });
    if (!result.ok) return dealProductMutationError(result.code);
    await auditDealProductMutation(ports, principal, 'deal_product.deleted', result.dealProduct, []);
    await publishDealProductEvent(ports, 'deal_product.deleted', principal.workspaceId, result.dealProduct, principal.userId);
    return data(200, { deleted: true, dealProduct: result.dealProduct });
  }

  return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
}

async function handleGetRoute(
  req: ApiRequest,
  ports: ServerApiPorts,
  resource: CoreCrmResource,
  rawId: string | undefined,
): Promise<ApiResponse> {
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;

  const id = positiveIntFromPath(rawId);
  if (id === null) return error(400, `invalid_${singular(resource)}_id`, `${singular(resource)} id muss eine positive Ganzzahl sein`);

  if (resource === 'products' && req.method === 'PATCH') {
    return handleUpdateProduct(req, ports, principal, id);
  }
  if (resource === 'products' && req.method === 'DELETE') {
    return handleDeleteProduct(ports, principal, id);
  }
  if (resource === 'deals' && req.method === 'PATCH') {
    return handleUpdateDeal(req, ports, principal, id);
  }
  if (resource === 'deals' && req.method === 'DELETE') {
    return handleDeleteDeal(ports, principal, id);
  }
  if (resource === 'tasks' && req.method === 'PATCH') {
    return handleUpdateTask(req, ports, principal, id);
  }
  if (resource === 'tasks' && req.method === 'DELETE') {
    return handleDeleteTask(ports, principal, id);
  }
  if (req.method !== 'GET') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');

  switch (resource) {
    case 'products': {
      if (!ports.products) return error(503, 'products_unavailable', 'Product API nicht konfiguriert');
      const product = await ports.products.get({ workspaceId: principal.workspaceId, id });
      return product ? data(200, product) : error(404, 'product_not_found', 'Product nicht gefunden');
    }
    case 'deals': {
      if (!ports.deals) return error(503, 'deals_unavailable', 'Deal API nicht konfiguriert');
      const deal = await ports.deals.get({ workspaceId: principal.workspaceId, id });
      return deal ? data(200, deal) : error(404, 'deal_not_found', 'Deal nicht gefunden');
    }
    case 'tasks': {
      if (!ports.tasks) return error(503, 'tasks_unavailable', 'Task API nicht konfiguriert');
      const task = await ports.tasks.get({ workspaceId: principal.workspaceId, id });
      return task ? data(200, task) : error(404, 'task_not_found', 'Task nicht gefunden');
    }
    default:
      return assertNever(resource);
  }
}

async function handleCreateProduct(
  req: ApiRequest,
  ports: ServerApiPorts,
  principal: AuthenticatedPrincipal,
): Promise<ApiResponse> {
  if (!ports.products?.create) {
    return error(503, 'products_unavailable', 'Product API nicht konfiguriert');
  }

  const parsed = parseProductMutationBody(req.body, {
    requireAtLeastOneField: true,
    requireName: true,
  });
  if (!parsed.ok) return parsed.response;

  const product = await ports.products.create({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    values: parsed.values,
  });
  await ports.audit?.record({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    action: 'product.created',
    entityType: 'product',
    entityId: String(product.id),
    metadata: {
      id: product.id,
      sourceSqliteId: product.sourceSqliteId,
    },
  });
  await publishProductEvent(ports, 'product.created', principal.workspaceId, product, principal.userId);
  return data(201, product);
}

async function handleUpdateProduct(
  req: ApiRequest,
  ports: ServerApiPorts,
  principal: AuthenticatedPrincipal,
  id: number,
): Promise<ApiResponse> {
  if (!ports.products?.update) {
    return error(503, 'products_unavailable', 'Product API nicht konfiguriert');
  }

  const parsed = parseProductMutationBody(req.body, {
    requireAtLeastOneField: true,
    requireName: false,
  });
  if (!parsed.ok) return parsed.response;

  const product = await ports.products.update({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    id,
    values: parsed.values,
  });
  if (!product) return error(404, 'product_not_found', 'Product nicht gefunden');

  await ports.audit?.record({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    action: 'product.updated',
    entityType: 'product',
    entityId: String(product.id),
    metadata: {
      id: product.id,
      fields: Object.keys(parsed.values).sort(),
    },
  });
  await publishProductEvent(ports, 'product.updated', principal.workspaceId, product, principal.userId);
  return data(200, product);
}

async function handleDeleteProduct(
  ports: ServerApiPorts,
  principal: AuthenticatedPrincipal,
  id: number,
): Promise<ApiResponse> {
  if (!ports.products?.delete) {
    return error(503, 'products_unavailable', 'Product API nicht konfiguriert');
  }

  const product = await ports.products.delete({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    id,
  });
  if (!product) return error(404, 'product_not_found', 'Product nicht gefunden');

  await ports.audit?.record({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    action: 'product.deleted',
    entityType: 'product',
    entityId: String(product.id),
    metadata: {
      id: product.id,
      sourceSqliteId: product.sourceSqliteId,
    },
  });
  await publishProductEvent(ports, 'product.deleted', principal.workspaceId, product, principal.userId);
  return data(200, { deleted: true, product });
}

async function publishProductEvent(
  ports: ServerApiPorts,
  type: 'product.created' | 'product.updated' | 'product.deleted',
  workspaceId: string,
  product: ProductRecord,
  actorUserId: string,
): Promise<void> {
  await ports.events?.publish({
    type,
    workspaceId,
    entityType: 'product',
    entityId: String(product.id),
    actorUserId,
    occurredAt: new Date().toISOString(),
    payload: {
      id: product.id,
      sourceSqliteId: product.sourceSqliteId,
      sku: product.sku,
      name: product.name,
      price: product.price,
      isActive: product.isActive,
    },
  });
}

async function handleCreateDeal(
  req: ApiRequest,
  ports: ServerApiPorts,
  principal: AuthenticatedPrincipal,
): Promise<ApiResponse> {
  if (!ports.deals?.create) {
    return error(503, 'deals_unavailable', 'Deal API nicht konfiguriert');
  }

  const parsed = parseDealMutationBody(req.body, {
    requireAtLeastOneField: true,
    requireName: true,
    requireCustomer: true,
  });
  if (!parsed.ok) return parsed.response;

  const result = await ports.deals.create({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    values: parsed.values,
  });
  if (!result.ok) return error(404, 'customer_not_found', 'Customer nicht gefunden');

  const deal = result.deal;
  await ports.audit?.record({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    action: 'deal.created',
    entityType: 'deal',
    entityId: String(deal.id),
    metadata: {
      id: deal.id,
      sourceSqliteId: deal.sourceSqliteId,
      customerId: deal.customerId,
      stage: deal.stage,
    },
  });
  await publishDealEvent(ports, 'deal.created', principal.workspaceId, deal, principal.userId);
  return data(201, deal);
}

async function handleUpdateDeal(
  req: ApiRequest,
  ports: ServerApiPorts,
  principal: AuthenticatedPrincipal,
  id: number,
): Promise<ApiResponse> {
  if (!ports.deals?.update) {
    return error(503, 'deals_unavailable', 'Deal API nicht konfiguriert');
  }

  const parsed = parseDealMutationBody(req.body, {
    requireAtLeastOneField: true,
    requireName: false,
    requireCustomer: false,
  });
  if (!parsed.ok) return parsed.response;

  const result = await ports.deals.update({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    id,
    values: parsed.values,
  });
  if (!result) return error(404, 'deal_not_found', 'Deal nicht gefunden');
  if (!result.ok) return error(404, 'customer_not_found', 'Customer nicht gefunden');

  const deal = result.deal;
  await ports.audit?.record({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    action: 'deal.updated',
    entityType: 'deal',
    entityId: String(deal.id),
    metadata: {
      id: deal.id,
      fields: Object.keys(parsed.values).sort(),
      stage: deal.stage,
    },
  });
  await publishDealEvent(ports, 'deal.updated', principal.workspaceId, deal, principal.userId);
  return data(200, deal);
}

async function handleDeleteDeal(
  ports: ServerApiPorts,
  principal: AuthenticatedPrincipal,
  id: number,
): Promise<ApiResponse> {
  if (!ports.deals?.delete) {
    return error(503, 'deals_unavailable', 'Deal API nicht konfiguriert');
  }

  const deal = await ports.deals.delete({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    id,
  });
  if (!deal) return error(404, 'deal_not_found', 'Deal nicht gefunden');

  await ports.audit?.record({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    action: 'deal.deleted',
    entityType: 'deal',
    entityId: String(deal.id),
    metadata: {
      id: deal.id,
      sourceSqliteId: deal.sourceSqliteId,
      customerId: deal.customerId,
    },
  });
  await publishDealEvent(ports, 'deal.deleted', principal.workspaceId, deal, principal.userId);
  return data(200, { deleted: true, deal });
}

async function handleCreateTask(
  req: ApiRequest,
  ports: ServerApiPorts,
  principal: AuthenticatedPrincipal,
): Promise<ApiResponse> {
  if (!ports.tasks?.create) {
    return error(503, 'tasks_unavailable', 'Task API nicht konfiguriert');
  }

  const parsed = parseTaskMutationBody(req.body, {
    requireAtLeastOneField: true,
    requireTitle: true,
    requireCustomer: true,
  });
  if (!parsed.ok) return parsed.response;

  const result = await ports.tasks.create({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    values: parsed.values,
  });
  if (!result.ok) return error(404, 'customer_not_found', 'Customer nicht gefunden');

  const task = result.task;
  await ports.audit?.record({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    action: 'task.created',
    entityType: 'task',
    entityId: String(task.id),
    metadata: {
      id: task.id,
      sourceSqliteId: task.sourceSqliteId,
      customerId: task.customerId,
      completed: task.completed,
    },
  });
  await publishTaskEvent(ports, 'task.created', principal.workspaceId, task, principal.userId);
  return data(201, task);
}

async function handleUpdateTask(
  req: ApiRequest,
  ports: ServerApiPorts,
  principal: AuthenticatedPrincipal,
  id: number,
): Promise<ApiResponse> {
  if (!ports.tasks?.update) {
    return error(503, 'tasks_unavailable', 'Task API nicht konfiguriert');
  }

  const parsed = parseTaskMutationBody(req.body, {
    requireAtLeastOneField: true,
    requireTitle: false,
    requireCustomer: false,
  });
  if (!parsed.ok) return parsed.response;

  const result = await ports.tasks.update({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    id,
    values: parsed.values,
  });
  if (!result) return error(404, 'task_not_found', 'Task nicht gefunden');
  if (!result.ok) return error(404, 'customer_not_found', 'Customer nicht gefunden');

  const task = result.task;
  await ports.audit?.record({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    action: 'task.updated',
    entityType: 'task',
    entityId: String(task.id),
    metadata: {
      id: task.id,
      fields: Object.keys(parsed.values).sort(),
      completed: task.completed,
    },
  });
  await publishTaskEvent(ports, 'task.updated', principal.workspaceId, task, principal.userId);
  return data(200, task);
}

async function handleDeleteTask(
  ports: ServerApiPorts,
  principal: AuthenticatedPrincipal,
  id: number,
): Promise<ApiResponse> {
  if (!ports.tasks?.delete) {
    return error(503, 'tasks_unavailable', 'Task API nicht konfiguriert');
  }

  const task = await ports.tasks.delete({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    id,
  });
  if (!task) return error(404, 'task_not_found', 'Task nicht gefunden');

  await ports.audit?.record({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    action: 'task.deleted',
    entityType: 'task',
    entityId: String(task.id),
    metadata: {
      id: task.id,
      sourceSqliteId: task.sourceSqliteId,
      customerId: task.customerId,
    },
  });
  await publishTaskEvent(ports, 'task.deleted', principal.workspaceId, task, principal.userId);
  return data(200, { deleted: true, task });
}

async function publishDealEvent(
  ports: ServerApiPorts,
  type: 'deal.created' | 'deal.updated' | 'deal.deleted',
  workspaceId: string,
  deal: DealRecord,
  actorUserId: string,
): Promise<void> {
  await ports.events?.publish({
    type,
    workspaceId,
    entityType: 'deal',
    entityId: String(deal.id),
    actorUserId,
    occurredAt: new Date().toISOString(),
    payload: {
      id: deal.id,
      sourceSqliteId: deal.sourceSqliteId,
      customerId: deal.customerId,
      customerSourceSqliteId: deal.customerSourceSqliteId,
      name: deal.name,
      value: deal.value,
      stage: deal.stage,
    },
  });
}

async function auditDealProductMutation(
  ports: ServerApiPorts,
  principal: AuthenticatedPrincipal,
  action: 'deal_product.created' | 'deal_product.updated' | 'deal_product.deleted',
  dealProduct: DealProductRecord,
  fields: readonly string[],
): Promise<void> {
  await ports.audit?.record({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    action,
    entityType: 'deal_product',
    entityId: String(dealProduct.id),
    metadata: {
      id: dealProduct.id,
      dealId: dealProduct.dealId,
      productId: dealProduct.productId,
      quantity: dealProduct.quantity,
      priceAtTimeOfAdding: dealProduct.priceAtTimeOfAdding,
      ...(fields.length === 0 ? {} : { fields: [...fields].sort() }),
    },
  });
}

async function publishDealProductEvent(
  ports: ServerApiPorts,
  type: 'deal_product.created' | 'deal_product.updated' | 'deal_product.deleted',
  workspaceId: string,
  dealProduct: DealProductRecord,
  actorUserId: string,
): Promise<void> {
  await ports.events?.publish({
    type,
    workspaceId,
    entityType: 'deal_product',
    entityId: String(dealProduct.id),
    actorUserId,
    occurredAt: new Date().toISOString(),
    payload: {
      id: dealProduct.id,
      sourceSqliteId: dealProduct.sourceSqliteId,
      dealId: dealProduct.dealId,
      productId: dealProduct.productId,
      productSourceSqliteId: dealProduct.productSourceSqliteId,
      quantity: dealProduct.quantity,
      priceAtTimeOfAdding: dealProduct.priceAtTimeOfAdding,
    },
  });
}

function dealProductMutationError(code: 'deal_not_found' | 'product_not_found' | 'deal_product_not_found'): ApiResponse<ApiErrorBody> {
  if (code === 'deal_not_found') return error(404, 'deal_not_found', 'Deal nicht gefunden');
  if (code === 'product_not_found') return error(404, 'product_not_found', 'Product nicht gefunden');
  return error(404, 'deal_product_not_found', 'Deal Product nicht gefunden');
}

async function publishTaskEvent(
  ports: ServerApiPorts,
  type: 'task.created' | 'task.updated' | 'task.deleted',
  workspaceId: string,
  task: TaskRecord,
  actorUserId: string,
): Promise<void> {
  await ports.events?.publish({
    type,
    workspaceId,
    entityType: 'task',
    entityId: String(task.id),
    actorUserId,
    occurredAt: new Date().toISOString(),
    payload: {
      id: task.id,
      sourceSqliteId: task.sourceSqliteId,
      customerId: task.customerId,
      customerSourceSqliteId: task.customerSourceSqliteId,
      title: task.title,
      priority: task.priority,
      completed: task.completed,
      dueDate: task.dueDate,
    },
  });
}

function parseLimit(value: string | undefined): number | null {
  if (value === undefined || value === '') return DEFAULT_LIMIT;
  const limit = parsePositiveInt(value);
  if (limit === null || limit > MAX_LIMIT) return null;
  return limit;
}

function parseOptionalPositiveInt(value: string | undefined): number | undefined | null {
  if (value === undefined || value === '') return undefined;
  return parsePositiveInt(value);
}

function parsePositiveInt(value: string): number | null {
  if (!/^[1-9]\d*$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function parseOptionalBoolean(value: string | undefined): boolean | undefined | null {
  if (value === undefined || value === '') return undefined;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return null;
}

function normalizeTextFilter(value: string | undefined, key: string, maxLength: number): string | undefined | null {
  if (value === undefined) return undefined;
  const normalized = value.trim();
  if (!normalized) return undefined;
  if (normalized.length > maxLength) return null;
  if (key === 'stage') return normalized;
  return normalized;
}

function parseProductMutationBody(
  body: unknown,
  options: {
    requireAtLeastOneField: boolean;
    requireName: boolean;
  },
): ProductMutationParseResult {
  if (!isPlainObject(body)) {
    return {
      ok: false,
      response: error(400, 'invalid_product_payload', 'Product-Payload muss ein JSON-Objekt sein'),
    };
  }

  const values: ProductMutationInput = {};
  const errors: Array<{ field: string; message: string }> = [];
  const allowedFields = new Set(Object.keys(PRODUCT_MUTATION_FIELDS));

  for (const key of Object.keys(body)) {
    if (!allowedFields.has(key)) {
      errors.push({ field: key, message: 'Feld ist nicht erlaubt' });
    }
  }

  for (const field of Object.keys(PRODUCT_MUTATION_FIELDS) as ProductMutationField[]) {
    if (!Object.prototype.hasOwnProperty.call(body, field)) continue;
    const value = normalizeProductMutationField(field, body[field]);
    if (value.ok) {
      assignProductMutationField(values, field, value.value);
    } else {
      errors.push({ field, message: value.message });
    }
  }

  if (errors.length > 0) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'Product-Payload ist ungueltig', { fields: errors }),
    };
  }
  if (options.requireAtLeastOneField && Object.keys(values).length === 0) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'Mindestens ein Product-Feld ist erforderlich'),
    };
  }
  if (options.requireName && !values.name) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'name ist fuer neue Produkte erforderlich'),
    };
  }

  return { ok: true, values };
}

function normalizeProductMutationField(
  field: ProductMutationField,
  rawValue: unknown,
): { ok: true; value: string | boolean | null } | { ok: false; message: string } {
  if (field === 'isActive') {
    return typeof rawValue === 'boolean'
      ? { ok: true, value: rawValue }
      : { ok: false, message: 'Feld muss ein Boolean sein' };
  }

  const definition = PRODUCT_MUTATION_FIELDS[field];
  if (rawValue === null) {
    return definition.nullable
      ? { ok: true, value: null }
      : { ok: false, message: 'Feld darf nicht null sein' };
  }
  if (field === 'price') {
    return normalizeProductPrice(rawValue);
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
  return { ok: true, value };
}

function normalizeProductPrice(rawValue: unknown): { ok: true; value: string } | { ok: false; message: string } {
  const value = typeof rawValue === 'number'
    ? rawValue.toFixed(2)
    : typeof rawValue === 'string'
      ? rawValue.trim()
      : null;
  if (value === null || !value) {
    return { ok: false, message: 'price muss ein Dezimalwert sein' };
  }
  if (!/^\d{1,12}(?:\.\d{1,2})?$/.test(value)) {
    return { ok: false, message: 'price muss ein Dezimalwert mit maximal zwei Nachkommastellen sein' };
  }
  return { ok: true, value };
}

function assignProductMutationField(
  values: ProductMutationInput,
  field: ProductMutationField,
  value: string | boolean | null,
): void {
  switch (field) {
    case 'name':
      if (typeof value === 'string') values.name = value;
      return;
    case 'sku':
      if (value === null || typeof value === 'string') values.sku = value;
      return;
    case 'description':
      if (value === null || typeof value === 'string') values.description = value;
      return;
    case 'price':
      if (typeof value === 'string') values.price = value;
      return;
    case 'isActive':
      if (typeof value === 'boolean') values.isActive = value;
      return;
    default:
      return assertNever(field);
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseDealMutationBody(
  body: unknown,
  options: {
    requireAtLeastOneField: boolean;
    requireName: boolean;
    requireCustomer: boolean;
  },
): DealMutationParseResult {
  if (!isPlainObject(body)) {
    return {
      ok: false,
      response: error(400, 'invalid_deal_payload', 'Deal-Payload muss ein JSON-Objekt sein'),
    };
  }

  const values: DealMutationInput = {};
  const errors: Array<{ field: string; message: string }> = [];
  const allowedFields = new Set([
    'customerId',
    'name',
    'value',
    'valueCalculationMethod',
    'stage',
    'notes',
    'createdDate',
    'expectedCloseDate',
  ]);

  for (const key of Object.keys(body)) {
    if (!allowedFields.has(key)) errors.push({ field: key, message: 'Feld ist nicht erlaubt' });
  }

  if (Object.prototype.hasOwnProperty.call(body, 'customerId')) {
    const customerId = normalizePositiveBodyInt(body.customerId, 'customerId');
    if (customerId.ok) values.customerId = customerId.value;
    else errors.push({ field: 'customerId', message: customerId.message });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'name')) {
    const name = normalizeRequiredTextBodyField(body.name, 300);
    if (name.ok) values.name = name.value;
    else errors.push({ field: 'name', message: name.message });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'value')) {
    const value = normalizeDecimalBodyField(body.value, 'value');
    if (value.ok) values.value = value.value;
    else errors.push({ field: 'value', message: value.message });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'valueCalculationMethod')) {
    const method = normalizeDealCalculationMethod(body.valueCalculationMethod);
    if (method.ok) values.valueCalculationMethod = method.value;
    else errors.push({ field: 'valueCalculationMethod', message: method.message });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'stage')) {
    const stage = normalizeRequiredTextBodyField(body.stage, 100);
    if (stage.ok) values.stage = stage.value;
    else errors.push({ field: 'stage', message: stage.message });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'notes')) {
    const notes = normalizeNullableTextBodyField(body.notes, 10000);
    if (notes.ok) values.notes = notes.value;
    else errors.push({ field: 'notes', message: notes.message });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'createdDate')) {
    const createdDate = normalizeNullableTimestampBodyField(body.createdDate, 'createdDate');
    if (createdDate.ok) values.createdDate = createdDate.value;
    else errors.push({ field: 'createdDate', message: createdDate.message });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'expectedCloseDate')) {
    const expectedCloseDate = normalizeNullableTimestampBodyField(body.expectedCloseDate, 'expectedCloseDate');
    if (expectedCloseDate.ok) values.expectedCloseDate = expectedCloseDate.value;
    else errors.push({ field: 'expectedCloseDate', message: expectedCloseDate.message });
  }

  if (errors.length > 0) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'Deal-Payload ist ungueltig', { fields: errors }),
    };
  }
  if (options.requireAtLeastOneField && Object.keys(values).length === 0) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'Mindestens ein Deal-Feld ist erforderlich'),
    };
  }
  if (options.requireName && !values.name) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'name ist fuer neue Deals erforderlich'),
    };
  }
  if (options.requireCustomer && values.customerId === undefined) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'customerId ist fuer neue Deals erforderlich'),
    };
  }

  return { ok: true, values };
}

function parseDealProductMutationBody(
  body: unknown,
  options: {
    requireProduct: boolean;
    requireQuantity: boolean;
    requirePrice: boolean;
  },
): DealProductMutationParseResult {
  if (!isPlainObject(body)) {
    return {
      ok: false,
      response: error(400, 'invalid_deal_product_payload', 'Deal-Product-Payload muss ein JSON-Objekt sein'),
    };
  }

  const values: DealProductMutationInput = {};
  const errors: Array<{ field: string; message: string }> = [];
  const allowedFields = new Set([
    'dealProductId',
    'dealId',
    'productId',
    'quantity',
    'price',
    'priceAtTime',
  ]);

  for (const key of Object.keys(body)) {
    if (!allowedFields.has(key)) errors.push({ field: key, message: 'Feld ist nicht erlaubt' });
  }

  if (Object.prototype.hasOwnProperty.call(body, 'dealProductId')) {
    const dealProductId = normalizePositiveBodyInt(body.dealProductId, 'dealProductId');
    if (dealProductId.ok) values.dealProductId = dealProductId.value;
    else errors.push({ field: 'dealProductId', message: dealProductId.message });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'dealId')) {
    const dealId = normalizePositiveBodyInt(body.dealId, 'dealId');
    if (dealId.ok) values.dealId = dealId.value;
    else errors.push({ field: 'dealId', message: dealId.message });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'productId')) {
    const productId = normalizePositiveBodyInt(body.productId, 'productId');
    if (productId.ok) values.productId = productId.value;
    else errors.push({ field: 'productId', message: productId.message });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'quantity')) {
    const quantity = normalizePositiveBodyInt(body.quantity, 'quantity');
    if (quantity.ok) values.quantity = quantity.value;
    else errors.push({ field: 'quantity', message: quantity.message });
  }

  const priceField = Object.prototype.hasOwnProperty.call(body, 'price') ? 'price' : 'priceAtTime';
  if (Object.prototype.hasOwnProperty.call(body, priceField)) {
    const price = normalizeDecimalBodyField(body[priceField], priceField);
    if (price.ok) values.price = price.value;
    else errors.push({ field: priceField, message: price.message });
  }

  if (errors.length > 0) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'Deal-Product-Payload ist ungueltig', { fields: errors }),
    };
  }
  if (options.requireProduct && values.productId === undefined) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'productId ist erforderlich'),
    };
  }
  if (options.requireQuantity && values.quantity === undefined) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'quantity ist erforderlich'),
    };
  }
  if (options.requirePrice && values.price === undefined) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'price ist erforderlich'),
    };
  }

  return { ok: true, values };
}

function parseTaskMutationBody(
  body: unknown,
  options: {
    requireAtLeastOneField: boolean;
    requireTitle: boolean;
    requireCustomer: boolean;
  },
): TaskMutationParseResult {
  if (!isPlainObject(body)) {
    return {
      ok: false,
      response: error(400, 'invalid_task_payload', 'Task-Payload muss ein JSON-Objekt sein'),
    };
  }

  const values: TaskMutationInput = {};
  const errors: Array<{ field: string; message: string }> = [];
  const allowedFields = new Set([
    'customerId',
    'title',
    'description',
    'dueDate',
    'priority',
    'completed',
    'snoozedUntil',
  ]);

  for (const key of Object.keys(body)) {
    if (!allowedFields.has(key)) errors.push({ field: key, message: 'Feld ist nicht erlaubt' });
  }

  if (Object.prototype.hasOwnProperty.call(body, 'customerId')) {
    const customerId = normalizePositiveBodyInt(body.customerId, 'customerId');
    if (customerId.ok) values.customerId = customerId.value;
    else errors.push({ field: 'customerId', message: customerId.message });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'title')) {
    const title = normalizeRequiredTextBodyField(body.title, 300);
    if (title.ok) values.title = title.value;
    else errors.push({ field: 'title', message: title.message });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'description')) {
    const description = normalizeNullableTextBodyField(body.description, 10000);
    if (description.ok) values.description = description.value;
    else errors.push({ field: 'description', message: description.message });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'dueDate')) {
    const dueDate = normalizeNullableTimestampBodyField(body.dueDate, 'dueDate');
    if (dueDate.ok) values.dueDate = dueDate.value;
    else errors.push({ field: 'dueDate', message: dueDate.message });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'priority')) {
    const priority = normalizeRequiredTextBodyField(body.priority, 50);
    if (priority.ok) values.priority = priority.value;
    else errors.push({ field: 'priority', message: priority.message });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'completed')) {
    if (typeof body.completed === 'boolean') values.completed = body.completed;
    else errors.push({ field: 'completed', message: 'Feld muss ein Boolean sein' });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'snoozedUntil')) {
    const snoozedUntil = normalizeNullableTimestampBodyField(body.snoozedUntil, 'snoozedUntil');
    if (snoozedUntil.ok) values.snoozedUntil = snoozedUntil.value;
    else errors.push({ field: 'snoozedUntil', message: snoozedUntil.message });
  }

  if (errors.length > 0) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'Task-Payload ist ungueltig', { fields: errors }),
    };
  }
  if (options.requireAtLeastOneField && Object.keys(values).length === 0) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'Mindestens ein Task-Feld ist erforderlich'),
    };
  }
  if (options.requireTitle && !values.title) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'title ist fuer neue Tasks erforderlich'),
    };
  }
  if (options.requireCustomer && values.customerId === undefined) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'customerId ist fuer neue Tasks erforderlich'),
    };
  }

  return { ok: true, values };
}

function normalizePositiveBodyInt(
  rawValue: unknown,
  field: string,
): { ok: true; value: number } | { ok: false; message: string } {
  const value = typeof rawValue === 'number'
    ? rawValue
    : typeof rawValue === 'string'
      ? Number(rawValue.trim())
      : NaN;
  if (!Number.isSafeInteger(value) || value <= 0) {
    return { ok: false, message: `${field} muss eine positive Ganzzahl sein` };
  }
  return { ok: true, value };
}

function normalizeRequiredTextBodyField(
  rawValue: unknown,
  maxLength: number,
): { ok: true; value: string } | { ok: false; message: string } {
  if (typeof rawValue !== 'string') return { ok: false, message: 'Feld muss ein String sein' };
  const value = rawValue.trim();
  if (!value) return { ok: false, message: 'Feld darf nicht leer sein' };
  if (value.length > maxLength) {
    return { ok: false, message: `Feld darf maximal ${maxLength} Zeichen haben` };
  }
  return { ok: true, value };
}

function normalizeNullableTextBodyField(
  rawValue: unknown,
  maxLength: number,
): { ok: true; value: string | null } | { ok: false; message: string } {
  if (rawValue === null) return { ok: true, value: null };
  if (typeof rawValue !== 'string') return { ok: false, message: 'Feld muss ein String sein' };
  const value = rawValue.trim();
  if (!value) return { ok: true, value: null };
  if (value.length > maxLength) {
    return { ok: false, message: `Feld darf maximal ${maxLength} Zeichen haben` };
  }
  return { ok: true, value };
}

function normalizeDecimalBodyField(
  rawValue: unknown,
  field: string,
): { ok: true; value: string } | { ok: false; message: string } {
  const value = typeof rawValue === 'number'
    ? rawValue.toFixed(2)
    : typeof rawValue === 'string'
      ? rawValue.trim()
      : null;
  if (value === null || !/^\d{1,12}(?:\.\d{1,2})?$/.test(value)) {
    return { ok: false, message: `${field} muss ein Dezimalwert mit maximal zwei Nachkommastellen sein` };
  }
  return { ok: true, value };
}

function normalizeDealCalculationMethod(
  rawValue: unknown,
): { ok: true; value: 'static' | 'dynamic' } | { ok: false; message: string } {
  if (rawValue === 'static' || rawValue === 'dynamic') return { ok: true, value: rawValue };
  return { ok: false, message: 'valueCalculationMethod muss static oder dynamic sein' };
}

function normalizeNullableTimestampBodyField(
  rawValue: unknown,
  field: string,
): { ok: true; value: string | null } | { ok: false; message: string } {
  if (rawValue === null) return { ok: true, value: null };
  if (typeof rawValue !== 'string') return { ok: false, message: 'Feld muss ein String sein' };
  const value = rawValue.trim();
  if (!value) return { ok: true, value: null };
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return { ok: false, message: `${field} muss ein gueltiger ISO-Zeitpunkt oder ein Datum sein` };
  }
  return { ok: true, value: parsed.toISOString() };
}

function singular(resource: CoreCrmResource): 'product' | 'deal' | 'task' {
  switch (resource) {
    case 'products':
      return 'product';
    case 'deals':
      return 'deal';
    case 'tasks':
      return 'task';
    default:
      return assertNever(resource);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unexpected core CRM resource: ${value}`);
}
