import type {
  ActivityLogListSort,
  ActivityLogListResult,
  ActivityLogMutationInput,
  ActivityLogRecord,
  ApiErrorBody,
  ApiRequest,
  ApiResponse,
  AuthenticatedPrincipal,
  CalendarEventListResult,
  CalendarEventMutationInput,
  CalendarEventRecord,
  CustomerCustomFieldListResult,
  CustomerCustomFieldMutationInput,
  CustomerCustomFieldRecord,
  CustomerCustomFieldValueListResult,
  CustomerCustomFieldValueMutationInput,
  CustomerCustomFieldValueRecord,
  JtlReferenceListResult,
  JtlReferenceMutationInput,
  JtlReferenceRecord,
  JtlOrderInput,
  JtlOrderProductInput,
  SavedViewListResult,
  SavedViewMutationInput,
  SavedViewRecord,
  ServerApiPorts,
} from './types';
import {
  data,
  error,
  positiveIntFromPath,
  requirePrincipal,
} from './types';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

type ParseResult<TFilters extends object> =
  | { ok: true; filters: TFilters }
  | { ok: false; response: ApiResponse };

type CalendarEventMutationParseResult =
  | { ok: true; values: CalendarEventMutationInput }
  | { ok: false; response: ApiResponse<ApiErrorBody> };

type CustomerCustomFieldMutationParseResult =
  | { ok: true; values: CustomerCustomFieldMutationInput }
  | { ok: false; response: ApiResponse<ApiErrorBody> };

type CustomerCustomFieldValueMutationParseResult =
  | { ok: true; values: CustomerCustomFieldValueMutationInput }
  | { ok: false; response: ApiResponse<ApiErrorBody> };

type SavedViewMutationParseResult =
  | { ok: true; values: SavedViewMutationInput }
  | { ok: false; response: ApiResponse<ApiErrorBody> };

type ActivityLogMutationParseResult =
  | { ok: true; values: ActivityLogMutationInput }
  | { ok: false; response: ApiResponse<ApiErrorBody> };

type JtlReferenceMutationParseResult =
  | { ok: true; values: JtlReferenceMutationInput }
  | { ok: false; response: ApiResponse<ApiErrorBody> };

type JtlOrderParseResult =
  | { ok: true; values: JtlOrderInput }
  | { ok: false; response: ApiResponse<ApiErrorBody> };

type NumericResource =
  | 'activityLog'
  | 'calendarEvents'
  | 'customerCustomFields'
  | 'customerCustomFieldValues'
  | 'savedViews';

type JtlResource = 'firmen' | 'warenlager' | 'zahlungsarten' | 'versandarten';

export async function handleExtendedCrmReadRoute(
  req: ApiRequest,
  ports: ServerApiPorts,
): Promise<ApiResponse | null> {
  if (req.path === '/api/v1/jtl/sync/status') {
    return handleJtlSyncStatus(req, ports);
  }

  if (req.path === '/api/v1/jtl/sync/run') {
    return handleJtlSyncRun(req, ports);
  }

  if (req.path === '/api/v1/jtl/orders') {
    return handleCreateJtlOrder(req, ports);
  }

  const jtlMatch = /^\/api\/v1\/jtl\/(firmen|warenlager|zahlungsarten|versandarten)(?:\/([^/]+))?$/.exec(req.path);
  if (jtlMatch) {
    return jtlMatch[2] === undefined
      ? handleJtlList(req, ports, jtlMatch[1] as JtlResource)
      : handleJtlGet(req, ports, jtlMatch[1] as JtlResource, jtlMatch[2]);
  }

  const customerCustomFieldValueMatch = /^\/api\/v1\/customers\/([^/]+)\/custom-field-values\/([^/]+)$/.exec(req.path);
  if (customerCustomFieldValueMatch) {
    return handleDeleteCustomFieldValueByCustomerAndField(
      req,
      ports,
      customerCustomFieldValueMatch[1],
      customerCustomFieldValueMatch[2],
    );
  }

  const listMatch = /^\/api\/v1\/(activity-log|calendar-events|customer-custom-fields|customer-custom-field-values|saved-views)$/.exec(req.path);
  if (listMatch) {
    return handleNumericList(req, ports, routeResource(listMatch[1]));
  }

  const getMatch = /^\/api\/v1\/(activity-log|calendar-events|customer-custom-fields|customer-custom-field-values|saved-views)\/([^/]+)$/.exec(req.path);
  if (getMatch) {
    return handleNumericGet(req, ports, routeResource(getMatch[1]), getMatch[2]);
  }

  return null;
}

async function handleJtlSyncStatus(
  req: ApiRequest,
  ports: ServerApiPorts,
): Promise<ApiResponse> {
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  if (req.method !== 'GET') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
  if (!ports.jtlSync) return unavailable('jtl_sync_unavailable', 'JTL Sync API nicht konfiguriert');
  return data(200, await ports.jtlSync.getStatus({ workspaceId: principal.workspaceId }));
}

async function handleJtlSyncRun(
  req: ApiRequest,
  ports: ServerApiPorts,
): Promise<ApiResponse> {
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  if (req.method !== 'POST') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
  if (!ports.jtlSync) return unavailable('jtl_sync_unavailable', 'JTL Sync API nicht konfiguriert');
  const result = await ports.jtlSync.run({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
  });
  await ports.audit?.record({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    action: result.success ? 'jtl_sync.completed' : 'jtl_sync.failed',
    entityType: 'jtl_sync',
    entityId: principal.workspaceId,
    metadata: {
      success: result.success,
      ...(result.success ? { details: result.details } : {}),
    },
  });
  return data(200, result);
}

async function handleCreateJtlOrder(
  req: ApiRequest,
  ports: ServerApiPorts,
): Promise<ApiResponse> {
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  if (req.method !== 'POST') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
  if (!ports.jtlOrders) return unavailable('jtl_orders_unavailable', 'JTL Auftrag API nicht konfiguriert');

  const parsed = parseJtlOrderBody(req.body);
  if (!parsed.ok) return parsed.response;
  const result = await ports.jtlOrders.createOrder({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    order: parsed.values,
  });
  if (result.success) {
    await ports.audit?.record({
      workspaceId: principal.workspaceId,
      actorUserId: principal.userId,
      action: 'jtl_order.created',
      entityType: 'jtl_order',
      entityId: String(result.jtlOrderId),
      metadata: {
        jtlOrderId: result.jtlOrderId,
        jtlOrderNumber: result.jtlOrderNumber,
        simpleCrmCustomerId: parsed.values.simpleCrmCustomerId,
        productCount: parsed.values.products.length,
      },
    });
  }
  return data(200, result);
}

async function handleNumericList(
  req: ApiRequest,
  ports: ServerApiPorts,
  resource: NumericResource,
): Promise<ApiResponse> {
  if (resource === 'activityLog' && req.method === 'POST') {
    const principal = requirePrincipal(req);
    if ('status' in principal) return principal;
    return handleCreateActivityLog(req, ports, principal);
  }
  if (resource === 'calendarEvents' && req.method === 'POST') {
    const principal = requirePrincipal(req);
    if ('status' in principal) return principal;
    return handleCreateCalendarEvent(req, ports, principal);
  }
  if (resource === 'customerCustomFields' && req.method === 'POST') {
    const principal = requirePrincipal(req);
    if ('status' in principal) return principal;
    return handleCreateCustomField(req, ports, principal);
  }
  if (resource === 'customerCustomFieldValues' && req.method === 'POST') {
    const principal = requirePrincipal(req);
    if ('status' in principal) return principal;
    return handleCreateCustomFieldValue(req, ports, principal);
  }
  if (resource === 'savedViews' && req.method === 'POST') {
    const principal = requirePrincipal(req);
    if ('status' in principal) return principal;
    return handleCreateSavedView(req, ports, principal);
  }
  if (req.method !== 'GET') return methodNotAllowed();
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  const base = parseListBase(req);
  if (!base.ok) return base.response;

  switch (resource) {
    case 'activityLog': {
      const filters = parseActivityLogFilters(req);
      if (!filters.ok) return filters.response;
      if (base.filters.cursor !== undefined && filters.filters.sort === 'createdAtDesc') {
        return error(400, 'invalid_activity_log_cursor', 'cursor kann nicht mit createdAtDesc kombiniert werden');
      }
      if (!ports.activityLog) return unavailable('activity_log_unavailable', 'Activity log API nicht konfiguriert');
      const includeMetadata = filters.filters.includeMetadata;
      const result = await ports.activityLog.list({
        workspaceId: principal.workspaceId,
        ...base.filters,
        ...filters.filters,
      });
      return data(200, sanitizeActivityLogList(result, includeMetadata));
    }
    case 'calendarEvents': {
      const filters = parseCalendarEventFilters(req);
      if (!filters.ok) return filters.response;
      if (!ports.calendarEvents) return unavailable('calendar_events_unavailable', 'Calendar event API nicht konfiguriert');
      const result = await ports.calendarEvents.list({
        workspaceId: principal.workspaceId,
        ...base.filters,
        ...filters.filters,
      });
      return data(200, sanitizeCalendarEventList(result));
    }
    case 'customerCustomFields': {
      const filters = parseCustomFieldFilters(req);
      if (!filters.ok) return filters.response;
      if (!ports.customerCustomFields) return unavailable('customer_custom_fields_unavailable', 'Customer custom field API nicht konfiguriert');
      const result = await ports.customerCustomFields.list({
        workspaceId: principal.workspaceId,
        ...base.filters,
        ...filters.filters,
      });
      return data(200, sanitizeCustomFieldList(result));
    }
    case 'customerCustomFieldValues': {
      const filters = parseCustomFieldValueFilters(req);
      if (!filters.ok) return filters.response;
      if (!ports.customerCustomFieldValues) {
        return unavailable('customer_custom_field_values_unavailable', 'Customer custom field value API nicht konfiguriert');
      }
      const result = await ports.customerCustomFieldValues.list({
        workspaceId: principal.workspaceId,
        ...base.filters,
        ...filters.filters,
      });
      return data(200, sanitizeCustomFieldValueList(result));
    }
    case 'savedViews': {
      const search = normalizeTextFilter(req.query?.search, 200);
      if (search === null) return error(400, 'invalid_search', 'search darf maximal 200 Zeichen haben');
      if (!ports.savedViews) return unavailable('saved_views_unavailable', 'Saved view API nicht konfiguriert');
      const result = await ports.savedViews.list({
        workspaceId: principal.workspaceId,
        ...base.filters,
        ...(search === undefined ? {} : { search }),
      });
      return data(200, sanitizeSavedViewList(result));
    }
    default:
      return assertNever(resource);
  }
}

async function handleNumericGet(
  req: ApiRequest,
  ports: ServerApiPorts,
  resource: NumericResource,
  rawId: string | undefined,
): Promise<ApiResponse> {
  const id = positiveIntFromPath(rawId);
  if (id === null) return error(400, `invalid_${resourceErrorName(resource)}_id`, `${resourceLabel(resource)} id muss eine positive Ganzzahl sein`);

  if (resource === 'calendarEvents' && req.method === 'PATCH') {
    const principal = requirePrincipal(req);
    if ('status' in principal) return principal;
    return handleUpdateCalendarEvent(req, ports, principal, id);
  }
  if (resource === 'calendarEvents' && req.method === 'DELETE') {
    const principal = requirePrincipal(req);
    if ('status' in principal) return principal;
    return handleDeleteCalendarEvent(ports, principal, id);
  }
  if (resource === 'customerCustomFields' && req.method === 'PATCH') {
    const principal = requirePrincipal(req);
    if ('status' in principal) return principal;
    return handleUpdateCustomField(req, ports, principal, id);
  }
  if (resource === 'customerCustomFields' && req.method === 'DELETE') {
    const principal = requirePrincipal(req);
    if ('status' in principal) return principal;
    return handleDeleteCustomField(ports, principal, id);
  }
  if (resource === 'customerCustomFieldValues' && req.method === 'PATCH') {
    const principal = requirePrincipal(req);
    if ('status' in principal) return principal;
    return handleUpdateCustomFieldValue(req, ports, principal, id);
  }
  if (resource === 'customerCustomFieldValues' && req.method === 'DELETE') {
    const principal = requirePrincipal(req);
    if ('status' in principal) return principal;
    return handleDeleteCustomFieldValue(ports, principal, id);
  }
  if (resource === 'savedViews' && req.method === 'PATCH') {
    const principal = requirePrincipal(req);
    if ('status' in principal) return principal;
    return handleUpdateSavedView(req, ports, principal, id);
  }
  if (resource === 'savedViews' && req.method === 'DELETE') {
    const principal = requirePrincipal(req);
    if ('status' in principal) return principal;
    return handleDeleteSavedView(ports, principal, id);
  }
  if (req.method !== 'GET') return methodNotAllowed();
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;

  switch (resource) {
    case 'activityLog': {
      const includeMetadata = parseOptionalBoolean(req.query?.includeMetadata);
      if (includeMetadata === null) return error(400, 'invalid_include_metadata', 'includeMetadata muss true oder false sein');
      if (!ports.activityLog) return unavailable('activity_log_unavailable', 'Activity log API nicht konfiguriert');
      const item = await ports.activityLog.get({ workspaceId: principal.workspaceId, id, includeMetadata: includeMetadata === true });
      return item
        ? data(200, sanitizeActivityLog(item, includeMetadata === true))
        : error(404, 'activity_log_entry_not_found', 'Activity log entry nicht gefunden');
    }
    case 'calendarEvents': {
      if (!ports.calendarEvents) return unavailable('calendar_events_unavailable', 'Calendar event API nicht konfiguriert');
      const item = await ports.calendarEvents.get({ workspaceId: principal.workspaceId, id });
      return item ? data(200, sanitizeCalendarEvent(item)) : error(404, 'calendar_event_not_found', 'Calendar event nicht gefunden');
    }
    case 'customerCustomFields': {
      if (!ports.customerCustomFields) return unavailable('customer_custom_fields_unavailable', 'Customer custom field API nicht konfiguriert');
      const item = await ports.customerCustomFields.get({ workspaceId: principal.workspaceId, id });
      return item
        ? data(200, sanitizeCustomField(item))
        : error(404, 'customer_custom_field_not_found', 'Customer custom field nicht gefunden');
    }
    case 'customerCustomFieldValues': {
      if (!ports.customerCustomFieldValues) {
        return unavailable('customer_custom_field_values_unavailable', 'Customer custom field value API nicht konfiguriert');
      }
      const item = await ports.customerCustomFieldValues.get({ workspaceId: principal.workspaceId, id });
      return item
        ? data(200, sanitizeCustomFieldValue(item))
        : error(404, 'customer_custom_field_value_not_found', 'Customer custom field value nicht gefunden');
    }
    case 'savedViews': {
      if (!ports.savedViews) return unavailable('saved_views_unavailable', 'Saved view API nicht konfiguriert');
      const item = await ports.savedViews.get({ workspaceId: principal.workspaceId, id });
      return item ? data(200, sanitizeSavedView(item)) : error(404, 'saved_view_not_found', 'Saved view nicht gefunden');
    }
    default:
      return assertNever(resource);
  }
}

async function handleCreateActivityLog(
  req: ApiRequest,
  ports: ServerApiPorts,
  principal: AuthenticatedPrincipal,
): Promise<ApiResponse> {
  if (!ports.activityLog?.create) return unavailable('activity_log_unavailable', 'Activity log API nicht konfiguriert');

  const parsed = parseActivityLogMutationBody(req.body, {
    requireAtLeastOneField: true,
    requireActivityType: true,
  });
  if (!parsed.ok) return parsed.response;

  const result = await ports.activityLog.create({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    values: parsed.values,
  });
  if (!result.ok) return activityLogMutationError(result.code);

  const activityLog = result.activityLog;
  await ports.audit?.record({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    action: 'activity_log.created',
    entityType: 'activity_log',
    entityId: String(activityLog.id),
    metadata: {
      id: activityLog.id,
      sourceSqliteId: activityLog.sourceSqliteId,
      activityType: activityLog.activityType,
      customerId: activityLog.customerId,
      dealId: activityLog.dealId,
      taskId: activityLog.taskId,
    },
  });
  await publishActivityLog(ports, principal.workspaceId, activityLog, principal.userId);
  return data(201, sanitizeActivityLog(activityLog, true));
}

async function publishActivityLog(
  ports: ServerApiPorts,
  workspaceId: string,
  activityLog: ActivityLogRecord,
  actorUserId: string,
): Promise<void> {
  await ports.events?.publish({
    type: 'activity_log.created',
    workspaceId,
    entityType: 'activity_log',
    entityId: String(activityLog.id),
    actorUserId,
    occurredAt: new Date().toISOString(),
    payload: {
      id: activityLog.id,
      sourceSqliteId: activityLog.sourceSqliteId,
      activityType: activityLog.activityType,
      title: activityLog.title,
      customerId: activityLog.customerId,
      dealId: activityLog.dealId,
      taskId: activityLog.taskId,
      metadata: activityLog.metadata,
    },
  });
}

function activityLogMutationError(code: 'customer_not_found' | 'deal_not_found' | 'task_not_found'): ApiResponse {
  if (code === 'customer_not_found') return error(404, 'customer_not_found', 'Customer nicht gefunden');
  if (code === 'deal_not_found') return error(404, 'deal_not_found', 'Deal nicht gefunden');
  return error(404, 'task_not_found', 'Task nicht gefunden');
}

async function handleCreateCalendarEvent(
  req: ApiRequest,
  ports: ServerApiPorts,
  principal: AuthenticatedPrincipal,
): Promise<ApiResponse> {
  if (!ports.calendarEvents?.create) return unavailable('calendar_events_unavailable', 'Calendar event API nicht konfiguriert');

  const parsed = parseCalendarEventMutationBody(req.body, {
    requireAtLeastOneField: true,
    requireTitle: true,
    requireStartAndEnd: true,
  });
  if (!parsed.ok) return parsed.response;

  const result = await ports.calendarEvents.create({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    values: parsed.values,
  });
  if (!result.ok) {
    return result.code === 'task_not_found'
      ? error(404, 'task_not_found', 'Task nicht gefunden')
      : error(400, 'invalid_date_range', 'endDate darf nicht vor startDate liegen');
  }

  const event = result.event;
  await ports.audit?.record({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    action: 'calendar_event.created',
    entityType: 'calendar_event',
    entityId: String(event.id),
    metadata: {
      id: event.id,
      sourceSqliteId: event.sourceSqliteId,
      taskId: event.taskId,
      startDate: event.startDate,
      endDate: event.endDate,
    },
  });
  await publishCalendarEvent(ports, 'calendar_event.created', principal.workspaceId, event, principal.userId);
  return data(201, event);
}

async function handleUpdateCalendarEvent(
  req: ApiRequest,
  ports: ServerApiPorts,
  principal: AuthenticatedPrincipal,
  id: number,
): Promise<ApiResponse> {
  if (!ports.calendarEvents?.update) return unavailable('calendar_events_unavailable', 'Calendar event API nicht konfiguriert');

  const parsed = parseCalendarEventMutationBody(req.body, {
    requireAtLeastOneField: true,
    requireTitle: false,
    requireStartAndEnd: false,
  });
  if (!parsed.ok) return parsed.response;

  const result = await ports.calendarEvents.update({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    id,
    values: parsed.values,
  });
  if (!result) return error(404, 'calendar_event_not_found', 'Calendar event nicht gefunden');
  if (!result.ok) {
    return result.code === 'task_not_found'
      ? error(404, 'task_not_found', 'Task nicht gefunden')
      : error(400, 'invalid_date_range', 'endDate darf nicht vor startDate liegen');
  }

  const event = result.event;
  await ports.audit?.record({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    action: 'calendar_event.updated',
    entityType: 'calendar_event',
    entityId: String(event.id),
    metadata: {
      id: event.id,
      fields: Object.keys(parsed.values).sort(),
      taskId: event.taskId,
    },
  });
  await publishCalendarEvent(ports, 'calendar_event.updated', principal.workspaceId, event, principal.userId);
  return data(200, event);
}

async function handleDeleteCalendarEvent(
  ports: ServerApiPorts,
  principal: AuthenticatedPrincipal,
  id: number,
): Promise<ApiResponse> {
  if (!ports.calendarEvents?.delete) return unavailable('calendar_events_unavailable', 'Calendar event API nicht konfiguriert');

  const event = await ports.calendarEvents.delete({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    id,
  });
  if (!event) return error(404, 'calendar_event_not_found', 'Calendar event nicht gefunden');

  await ports.audit?.record({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    action: 'calendar_event.deleted',
    entityType: 'calendar_event',
    entityId: String(event.id),
    metadata: {
      id: event.id,
      sourceSqliteId: event.sourceSqliteId,
      taskId: event.taskId,
    },
  });
  await publishCalendarEvent(ports, 'calendar_event.deleted', principal.workspaceId, event, principal.userId);
  return data(200, { deleted: true, calendarEvent: event });
}

async function publishCalendarEvent(
  ports: ServerApiPorts,
  type: 'calendar_event.created' | 'calendar_event.updated' | 'calendar_event.deleted',
  workspaceId: string,
  event: CalendarEventRecord,
  actorUserId: string,
): Promise<void> {
  await ports.events?.publish({
    type,
    workspaceId,
    entityType: 'calendar_event',
    entityId: String(event.id),
    actorUserId,
    occurredAt: new Date().toISOString(),
    payload: {
      id: event.id,
      sourceSqliteId: event.sourceSqliteId,
      title: event.title,
      startDate: event.startDate,
      endDate: event.endDate,
      allDay: event.allDay,
      eventType: event.eventType,
      taskId: event.taskId,
      taskSourceSqliteId: event.taskSourceSqliteId,
    },
  });
}

async function handleCreateCustomField(
  req: ApiRequest,
  ports: ServerApiPorts,
  principal: AuthenticatedPrincipal,
): Promise<ApiResponse> {
  if (!ports.customerCustomFields?.create) {
    return unavailable('customer_custom_fields_unavailable', 'Customer custom field API nicht konfiguriert');
  }

  const parsed = parseCustomFieldMutationBody(req.body, {
    requireAtLeastOneField: true,
    requireName: true,
    requireLabel: true,
    requireType: true,
  });
  if (!parsed.ok) return parsed.response;

  const result = await ports.customerCustomFields.create({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    values: parsed.values,
  });
  if (!result.ok) return error(409, 'duplicate_custom_field_name', 'Custom field name ist bereits vergeben');

  const field = result.field;
  await ports.audit?.record({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    action: 'custom_field.created',
    entityType: 'custom_field',
    entityId: String(field.id),
    metadata: {
      id: field.id,
      sourceSqliteId: field.sourceSqliteId,
      name: field.name,
      type: field.type,
    },
  });
  await publishCustomField(ports, 'custom_field.created', principal.workspaceId, field, principal.userId);
  return data(201, field);
}

async function handleUpdateCustomField(
  req: ApiRequest,
  ports: ServerApiPorts,
  principal: AuthenticatedPrincipal,
  id: number,
): Promise<ApiResponse> {
  if (!ports.customerCustomFields?.update) {
    return unavailable('customer_custom_fields_unavailable', 'Customer custom field API nicht konfiguriert');
  }

  const parsed = parseCustomFieldMutationBody(req.body, {
    requireAtLeastOneField: true,
    requireName: false,
    requireLabel: false,
    requireType: false,
  });
  if (!parsed.ok) return parsed.response;

  const result = await ports.customerCustomFields.update({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    id,
    values: parsed.values,
  });
  if (!result) return error(404, 'customer_custom_field_not_found', 'Customer custom field nicht gefunden');
  if (!result.ok) return error(409, 'duplicate_custom_field_name', 'Custom field name ist bereits vergeben');

  const field = result.field;
  await ports.audit?.record({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    action: 'custom_field.updated',
    entityType: 'custom_field',
    entityId: String(field.id),
    metadata: {
      id: field.id,
      fields: Object.keys(parsed.values).sort(),
      name: field.name,
    },
  });
  await publishCustomField(ports, 'custom_field.updated', principal.workspaceId, field, principal.userId);
  return data(200, field);
}

async function handleDeleteCustomField(
  ports: ServerApiPorts,
  principal: AuthenticatedPrincipal,
  id: number,
): Promise<ApiResponse> {
  if (!ports.customerCustomFields?.delete) {
    return unavailable('customer_custom_fields_unavailable', 'Customer custom field API nicht konfiguriert');
  }

  const field = await ports.customerCustomFields.delete({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    id,
  });
  if (!field) return error(404, 'customer_custom_field_not_found', 'Customer custom field nicht gefunden');

  await ports.audit?.record({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    action: 'custom_field.deleted',
    entityType: 'custom_field',
    entityId: String(field.id),
    metadata: {
      id: field.id,
      sourceSqliteId: field.sourceSqliteId,
      name: field.name,
    },
  });
  await publishCustomField(ports, 'custom_field.deleted', principal.workspaceId, field, principal.userId);
  return data(200, { deleted: true, customField: field });
}

async function handleCreateCustomFieldValue(
  req: ApiRequest,
  ports: ServerApiPorts,
  principal: AuthenticatedPrincipal,
): Promise<ApiResponse> {
  if (!ports.customerCustomFieldValues?.create) {
    return unavailable('customer_custom_field_values_unavailable', 'Customer custom field value API nicht konfiguriert');
  }

  const parsed = parseCustomFieldValueMutationBody(req.body, {
    requireAtLeastOneField: true,
    requireCustomerAndField: true,
  });
  if (!parsed.ok) return parsed.response;

  const result = await ports.customerCustomFieldValues.create({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    values: parsed.values,
  });
  if (!result.ok) return customFieldValueMutationError(result.code);

  const value = result.value;
  await ports.audit?.record({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    action: 'custom_field_value.created',
    entityType: 'custom_field_value',
    entityId: String(value.id),
    metadata: {
      id: value.id,
      sourceSqliteId: value.sourceSqliteId,
      customerId: value.customerId,
      fieldId: value.fieldId,
    },
  });
  await publishCustomFieldValue(ports, 'custom_field_value.created', principal.workspaceId, value, principal.userId);
  return data(201, value);
}

async function handleUpdateCustomFieldValue(
  req: ApiRequest,
  ports: ServerApiPorts,
  principal: AuthenticatedPrincipal,
  id: number,
): Promise<ApiResponse> {
  if (!ports.customerCustomFieldValues?.update) {
    return unavailable('customer_custom_field_values_unavailable', 'Customer custom field value API nicht konfiguriert');
  }

  const parsed = parseCustomFieldValueMutationBody(req.body, {
    requireAtLeastOneField: true,
    requireCustomerAndField: false,
  });
  if (!parsed.ok) return parsed.response;

  const result = await ports.customerCustomFieldValues.update({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    id,
    values: parsed.values,
  });
  if (!result) return error(404, 'customer_custom_field_value_not_found', 'Customer custom field value nicht gefunden');
  if (!result.ok) return customFieldValueMutationError(result.code);

  const value = result.value;
  await ports.audit?.record({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    action: 'custom_field_value.updated',
    entityType: 'custom_field_value',
    entityId: String(value.id),
    metadata: {
      id: value.id,
      fields: Object.keys(parsed.values).sort(),
      customerId: value.customerId,
      fieldId: value.fieldId,
    },
  });
  await publishCustomFieldValue(ports, 'custom_field_value.updated', principal.workspaceId, value, principal.userId);
  return data(200, value);
}

async function handleDeleteCustomFieldValueByCustomerAndField(
  req: ApiRequest,
  ports: ServerApiPorts,
  rawCustomerId: string | undefined,
  rawFieldId: string | undefined,
): Promise<ApiResponse> {
  if (req.method !== 'DELETE') return methodNotAllowed();
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;

  const customerId = positiveIntFromPath(rawCustomerId);
  if (customerId === null) return error(400, 'invalid_customer_id', 'customer id muss eine positive Ganzzahl sein');
  const fieldId = positiveIntFromPath(rawFieldId);
  if (fieldId === null) return error(400, 'invalid_custom_field_id', 'custom field id muss eine positive Ganzzahl sein');

  if (!ports.customerCustomFieldValues?.list || !ports.customerCustomFieldValues?.delete) {
    return unavailable('customer_custom_field_values_unavailable', 'Customer custom field value API nicht konfiguriert');
  }

  const existing = await ports.customerCustomFieldValues.list({
    workspaceId: principal.workspaceId,
    customerId,
    fieldId,
    limit: 1,
  });
  const value = existing.items[0];
  if (!value) return error(404, 'customer_custom_field_value_not_found', 'Customer custom field value nicht gefunden');

  return handleDeleteCustomFieldValue(ports, principal, value.id);
}

async function handleDeleteCustomFieldValue(
  ports: ServerApiPorts,
  principal: AuthenticatedPrincipal,
  id: number,
): Promise<ApiResponse> {
  if (!ports.customerCustomFieldValues?.delete) {
    return unavailable('customer_custom_field_values_unavailable', 'Customer custom field value API nicht konfiguriert');
  }

  const value = await ports.customerCustomFieldValues.delete({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    id,
  });
  if (!value) return error(404, 'customer_custom_field_value_not_found', 'Customer custom field value nicht gefunden');

  await ports.audit?.record({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    action: 'custom_field_value.deleted',
    entityType: 'custom_field_value',
    entityId: String(value.id),
    metadata: {
      id: value.id,
      sourceSqliteId: value.sourceSqliteId,
      customerId: value.customerId,
      fieldId: value.fieldId,
    },
  });
  await publishCustomFieldValue(ports, 'custom_field_value.deleted', principal.workspaceId, value, principal.userId);
  return data(200, { deleted: true, customFieldValue: value });
}

async function publishCustomField(
  ports: ServerApiPorts,
  type: 'custom_field.created' | 'custom_field.updated' | 'custom_field.deleted',
  workspaceId: string,
  field: CustomerCustomFieldRecord,
  actorUserId: string,
): Promise<void> {
  await ports.events?.publish({
    type,
    workspaceId,
    entityType: 'custom_field',
    entityId: String(field.id),
    actorUserId,
    occurredAt: new Date().toISOString(),
    payload: {
      id: field.id,
      sourceSqliteId: field.sourceSqliteId,
      name: field.name,
      label: field.label,
      type: field.type,
      required: field.required,
      options: field.options,
      active: field.active,
    },
  });
}

async function publishCustomFieldValue(
  ports: ServerApiPorts,
  type: 'custom_field_value.created' | 'custom_field_value.updated' | 'custom_field_value.deleted',
  workspaceId: string,
  value: CustomerCustomFieldValueRecord,
  actorUserId: string,
): Promise<void> {
  await ports.events?.publish({
    type,
    workspaceId,
    entityType: 'custom_field_value',
    entityId: String(value.id),
    actorUserId,
    occurredAt: new Date().toISOString(),
    payload: {
      id: value.id,
      sourceSqliteId: value.sourceSqliteId,
      customerId: value.customerId,
      customerSourceSqliteId: value.customerSourceSqliteId,
      fieldId: value.fieldId,
      fieldSourceSqliteId: value.fieldSourceSqliteId,
      value: value.value,
    },
  });
}

function customFieldValueMutationError(code: 'customer_not_found' | 'custom_field_not_found' | 'value_conflict'): ApiResponse {
  if (code === 'customer_not_found') return error(404, 'customer_not_found', 'Customer nicht gefunden');
  if (code === 'custom_field_not_found') return error(404, 'customer_custom_field_not_found', 'Customer custom field nicht gefunden');
  return error(409, 'customer_custom_field_value_conflict', 'Custom field value fuer Customer und Field existiert bereits');
}

async function handleCreateSavedView(
  req: ApiRequest,
  ports: ServerApiPorts,
  principal: AuthenticatedPrincipal,
): Promise<ApiResponse> {
  if (!ports.savedViews?.create) return unavailable('saved_views_unavailable', 'Saved view API nicht konfiguriert');

  const parsed = parseSavedViewMutationBody(req.body, {
    requireAtLeastOneField: true,
    requireName: true,
    requireFilters: true,
  });
  if (!parsed.ok) return parsed.response;

  const view = await ports.savedViews.create({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    values: parsed.values,
  });

  await ports.audit?.record({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    action: 'saved_view.created',
    entityType: 'saved_view',
    entityId: String(view.id),
    metadata: {
      id: view.id,
      sourceSqliteId: view.sourceSqliteId,
      name: view.name,
    },
  });
  await publishSavedView(ports, 'saved_view.created', principal.workspaceId, view, principal.userId);
  return data(201, view);
}

async function handleUpdateSavedView(
  req: ApiRequest,
  ports: ServerApiPorts,
  principal: AuthenticatedPrincipal,
  id: number,
): Promise<ApiResponse> {
  if (!ports.savedViews?.update) return unavailable('saved_views_unavailable', 'Saved view API nicht konfiguriert');

  const parsed = parseSavedViewMutationBody(req.body, {
    requireAtLeastOneField: true,
    requireName: false,
    requireFilters: false,
  });
  if (!parsed.ok) return parsed.response;

  const view = await ports.savedViews.update({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    id,
    values: parsed.values,
  });
  if (!view) return error(404, 'saved_view_not_found', 'Saved view nicht gefunden');

  await ports.audit?.record({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    action: 'saved_view.updated',
    entityType: 'saved_view',
    entityId: String(view.id),
    metadata: {
      id: view.id,
      fields: Object.keys(parsed.values).sort(),
      name: view.name,
    },
  });
  await publishSavedView(ports, 'saved_view.updated', principal.workspaceId, view, principal.userId);
  return data(200, view);
}

async function handleDeleteSavedView(
  ports: ServerApiPorts,
  principal: AuthenticatedPrincipal,
  id: number,
): Promise<ApiResponse> {
  if (!ports.savedViews?.delete) return unavailable('saved_views_unavailable', 'Saved view API nicht konfiguriert');

  const view = await ports.savedViews.delete({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    id,
  });
  if (!view) return error(404, 'saved_view_not_found', 'Saved view nicht gefunden');

  await ports.audit?.record({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    action: 'saved_view.deleted',
    entityType: 'saved_view',
    entityId: String(view.id),
    metadata: {
      id: view.id,
      sourceSqliteId: view.sourceSqliteId,
      name: view.name,
    },
  });
  await publishSavedView(ports, 'saved_view.deleted', principal.workspaceId, view, principal.userId);
  return data(200, { deleted: true, savedView: view });
}

async function publishSavedView(
  ports: ServerApiPorts,
  type: 'saved_view.created' | 'saved_view.updated' | 'saved_view.deleted',
  workspaceId: string,
  view: SavedViewRecord,
  actorUserId: string,
): Promise<void> {
  await ports.events?.publish({
    type,
    workspaceId,
    entityType: 'saved_view',
    entityId: String(view.id),
    actorUserId,
    occurredAt: new Date().toISOString(),
    payload: {
      id: view.id,
      sourceSqliteId: view.sourceSqliteId,
      name: view.name,
      filters: view.filters,
      displayOrder: view.displayOrder,
    },
  });
}

async function handleJtlList(
  req: ApiRequest,
  ports: ServerApiPorts,
  resource: JtlResource,
): Promise<ApiResponse> {
  if (req.method === 'POST') return handleCreateJtlReference(req, ports, resource);
  if (req.method !== 'GET') return methodNotAllowed();
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  const base = parseSignedListBase(req);
  if (!base.ok) return base.response;
  const search = normalizeTextFilter(req.query?.search, 200);
  if (search === null) return error(400, 'invalid_search', 'search darf maximal 200 Zeichen haben');
  const port = jtlPort(ports, resource);
  if (!port) return unavailable(`jtl_${resource}_unavailable`, `JTL ${resource} API nicht konfiguriert`);
  const result = await port.list({
    workspaceId: principal.workspaceId,
    ...base.filters,
    ...(search === undefined ? {} : { search }),
  });
  return data(200, sanitizeJtlReferenceList(result));
}

async function handleJtlGet(
  req: ApiRequest,
  ports: ServerApiPorts,
  resource: JtlResource,
  rawId: string | undefined,
): Promise<ApiResponse> {
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  const sourceSqliteId = sourceSqliteIdFromPath(rawId);
  if (sourceSqliteId === null) return error(400, `invalid_jtl_${resource}_id`, `JTL ${resource} id muss eine Ganzzahl ungleich 0 sein`);
  if (req.method === 'PATCH') return handleUpdateJtlReference(req, ports, principal, resource, sourceSqliteId);
  if (req.method === 'DELETE') return handleDeleteJtlReference(ports, principal, resource, sourceSqliteId);
  if (req.method !== 'GET') return methodNotAllowed();
  const port = jtlPort(ports, resource);
  if (!port) return unavailable(`jtl_${resource}_unavailable`, `JTL ${resource} API nicht konfiguriert`);
  const item = await port.get({ workspaceId: principal.workspaceId, sourceSqliteId });
  return item
    ? data(200, sanitizeJtlReference(item))
    : error(404, `jtl_${resource}_not_found`, `JTL ${resource} nicht gefunden`);
}

async function handleCreateJtlReference(
  req: ApiRequest,
  ports: ServerApiPorts,
  resource: JtlResource,
): Promise<ApiResponse> {
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  const port = jtlPort(ports, resource);
  if (!port?.create) return unavailable(`jtl_${resource}_unavailable`, `JTL ${resource} API nicht konfiguriert`);

  const parsed = parseJtlReferenceMutationBody(req.body, resource, {
    requireName: true,
    requireAtLeastOneField: true,
  });
  if (!parsed.ok) return parsed.response;

  const item = await port.create({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    values: parsed.values,
  });
  await auditJtlReference(ports, principal, 'jtl_reference.created', resource, item, { name: item.name });
  await publishJtlReference(ports, principal.workspaceId, 'jtl_reference.created', resource, item, principal.userId);
  return data(201, sanitizeJtlReference(item));
}

async function handleUpdateJtlReference(
  req: ApiRequest,
  ports: ServerApiPorts,
  principal: AuthenticatedPrincipal,
  resource: JtlResource,
  sourceSqliteId: number,
): Promise<ApiResponse> {
  const port = jtlPort(ports, resource);
  if (!port?.update) return unavailable(`jtl_${resource}_unavailable`, `JTL ${resource} API nicht konfiguriert`);

  const parsed = parseJtlReferenceMutationBody(req.body, resource, {
    requireName: false,
    requireAtLeastOneField: true,
  });
  if (!parsed.ok) return parsed.response;

  const item = await port.update({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    sourceSqliteId,
    values: parsed.values,
  });
  if (!item) return error(404, `jtl_${resource}_not_found`, `JTL ${resource} nicht gefunden`);

  await auditJtlReference(ports, principal, 'jtl_reference.updated', resource, item, {
    fields: Object.keys(parsed.values).sort(),
  });
  await publishJtlReference(ports, principal.workspaceId, 'jtl_reference.updated', resource, item, principal.userId);
  return data(200, sanitizeJtlReference(item));
}

async function handleDeleteJtlReference(
  ports: ServerApiPorts,
  principal: AuthenticatedPrincipal,
  resource: JtlResource,
  sourceSqliteId: number,
): Promise<ApiResponse> {
  const port = jtlPort(ports, resource);
  if (!port?.delete) return unavailable(`jtl_${resource}_unavailable`, `JTL ${resource} API nicht konfiguriert`);

  const item = await port.delete({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    sourceSqliteId,
  });
  if (!item) return error(404, `jtl_${resource}_not_found`, `JTL ${resource} nicht gefunden`);

  await auditJtlReference(ports, principal, 'jtl_reference.deleted', resource, item, { name: item.name });
  await publishJtlReference(ports, principal.workspaceId, 'jtl_reference.deleted', resource, item, principal.userId);
  return data(200, { deleted: true, jtlReference: sanitizeJtlReference(item) });
}

async function auditJtlReference(
  ports: ServerApiPorts,
  principal: AuthenticatedPrincipal,
  action: 'jtl_reference.created' | 'jtl_reference.updated' | 'jtl_reference.deleted',
  resource: JtlResource,
  item: JtlReferenceRecord,
  metadata: Record<string, unknown>,
): Promise<void> {
  await ports.audit?.record({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    action,
    entityType: 'jtl_reference',
    entityId: jtlReferenceEntityId(resource, item),
    metadata: {
      resource,
      sourceSqliteId: item.sourceSqliteId,
      ...metadata,
    },
  });
}

async function publishJtlReference(
  ports: ServerApiPorts,
  workspaceId: string,
  type: 'jtl_reference.created' | 'jtl_reference.updated' | 'jtl_reference.deleted',
  resource: JtlResource,
  item: JtlReferenceRecord,
  actorUserId: string,
): Promise<void> {
  await ports.events?.publish({
    type,
    workspaceId,
    entityType: 'jtl_reference',
    entityId: jtlReferenceEntityId(resource, item),
    actorUserId,
    occurredAt: new Date().toISOString(),
    payload: {
      resource,
      sourceSqliteId: item.sourceSqliteId,
      name: item.name,
    },
  });
}

function parseListBase(req: ApiRequest): ParseResult<{ cursor?: number; limit: number }> {
  const limit = parseLimit(req.query?.limit);
  if (limit === null) return parseError('invalid_limit', `limit muss zwischen 1 und ${MAX_LIMIT} liegen`);
  const cursor = parseOptionalPositiveInt(req.query?.cursor);
  if (cursor === null) return parseError('invalid_cursor', 'cursor muss eine positive Ganzzahl sein');
  return { ok: true, filters: { limit, ...(cursor === undefined ? {} : { cursor }) } };
}

function parseSignedListBase(req: ApiRequest): ParseResult<{ cursor?: number; limit: number }> {
  const limit = parseLimit(req.query?.limit);
  if (limit === null) return parseError('invalid_limit', `limit muss zwischen 1 und ${MAX_LIMIT} liegen`);
  const cursor = parseOptionalNonZeroInt(req.query?.cursor);
  if (cursor === null) return parseError('invalid_cursor', 'cursor muss eine Ganzzahl ungleich 0 sein');
  return { ok: true, filters: { limit, ...(cursor === undefined ? {} : { cursor }) } };
}

function parseJtlReferenceMutationBody(
  body: unknown,
  resource: JtlResource,
  options: {
    requireName: boolean;
    requireAtLeastOneField: boolean;
  },
): JtlReferenceMutationParseResult {
  if (!isPlainObject(body)) {
    return {
      ok: false,
      response: error(400, `invalid_jtl_${resource}_payload`, `JTL ${resource} payload muss ein JSON-Objekt sein`),
    };
  }

  const values: JtlReferenceMutationInput = {};
  const errors: Array<{ field: string; message: string }> = [];
  const allowedFields = new Set(['name']);

  for (const key of Object.keys(body)) {
    if (!allowedFields.has(key)) errors.push({ field: key, message: 'Feld ist nicht erlaubt' });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'name')) {
    const name = normalizeNullableBodyText(body.name, 300);
    if (name.ok) values.name = name.value;
    else errors.push({ field: 'name', message: name.message });
  }

  if (errors.length > 0) {
    return {
      ok: false,
      response: error(400, 'validation_error', `JTL ${resource} payload ist ungueltig`, { fields: errors }),
    };
  }
  if (options.requireName && !Object.prototype.hasOwnProperty.call(values, 'name')) {
    return {
      ok: false,
      response: error(400, 'validation_error', `name ist fuer neue JTL ${resource} erforderlich`),
    };
  }
  if (options.requireAtLeastOneField && Object.keys(values).length === 0) {
    return {
      ok: false,
      response: error(400, 'validation_error', `JTL ${resource} update braucht mindestens ein Feld`),
    };
  }

  return { ok: true, values };
}

function parseJtlOrderBody(body: unknown): JtlOrderParseResult {
  if (!isPlainObject(body)) {
    return {
      ok: false,
      response: error(400, 'invalid_jtl_order_payload', 'JTL Auftrag payload muss ein JSON-Objekt sein'),
    };
  }

  const allowedFields = new Set(['simpleCrmCustomerId', 'kFirma', 'kWarenlager', 'kZahlungsart', 'kVersandart', 'products']);
  const errors: Array<{ field: string; message: string }> = [];
  for (const key of Object.keys(body)) {
    if (!allowedFields.has(key)) errors.push({ field: key, message: 'Feld ist nicht erlaubt' });
  }

  const simpleCrmCustomerId = parseBodyPositiveInt(body.simpleCrmCustomerId);
  if (simpleCrmCustomerId === null) errors.push({ field: 'simpleCrmCustomerId', message: 'muss eine positive Ganzzahl sein' });

  const kFirma = parseBodyPositiveInt(body.kFirma);
  if (kFirma === null) errors.push({ field: 'kFirma', message: 'muss eine positive Ganzzahl sein' });

  const kWarenlager = parseBodyPositiveInt(body.kWarenlager);
  if (kWarenlager === null) errors.push({ field: 'kWarenlager', message: 'muss eine positive Ganzzahl sein' });

  const kZahlungsart = parseBodyPositiveInt(body.kZahlungsart);
  if (kZahlungsart === null) errors.push({ field: 'kZahlungsart', message: 'muss eine positive Ganzzahl sein' });

  const kVersandart = parseBodyPositiveInt(body.kVersandart);
  if (kVersandart === null) errors.push({ field: 'kVersandart', message: 'muss eine positive Ganzzahl sein' });

  const products = parseJtlOrderProducts(body.products, errors);

  if (errors.length > 0 || products === null) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'JTL Auftrag payload ist ungueltig', { fields: errors }),
    };
  }

  return {
    ok: true,
    values: {
      simpleCrmCustomerId: simpleCrmCustomerId!,
      kFirma: kFirma!,
      kWarenlager: kWarenlager!,
      kZahlungsart: kZahlungsart!,
      kVersandart: kVersandart!,
      products,
    },
  };
}

function parseJtlOrderProducts(
  value: unknown,
  errors: Array<{ field: string; message: string }>,
): JtlOrderProductInput[] | null {
  if (!Array.isArray(value) || value.length === 0) {
    errors.push({ field: 'products', message: 'muss eine nicht-leere Liste sein' });
    return null;
  }
  if (value.length > 200) {
    errors.push({ field: 'products', message: 'darf maximal 200 Eintraege enthalten' });
    return null;
  }

  const products: JtlOrderProductInput[] = [];
  for (const [index, item] of value.entries()) {
    const prefix = `products.${index}`;
    if (!isPlainObject(item)) {
      errors.push({ field: prefix, message: 'muss ein Objekt sein' });
      continue;
    }
    const allowedFields = new Set(['kArtikel', 'cName', 'cArtNr', 'nAnzahl', 'fPreis']);
    for (const key of Object.keys(item)) {
      if (!allowedFields.has(key)) errors.push({ field: `${prefix}.${key}`, message: 'Feld ist nicht erlaubt' });
    }
    const kArtikel = parseBodyPositiveInt(item.kArtikel);
    if (kArtikel === null) errors.push({ field: `${prefix}.kArtikel`, message: 'muss eine positive Ganzzahl sein' });
    const nAnzahl = parseBodyPositiveNumber(item.nAnzahl);
    if (nAnzahl === null) errors.push({ field: `${prefix}.nAnzahl`, message: 'muss eine positive Zahl sein' });
    const fPreis = parseBodyNonNegativeNumber(item.fPreis);
    if (fPreis === null) errors.push({ field: `${prefix}.fPreis`, message: 'muss eine nicht-negative Zahl sein' });
    if (kArtikel !== null && nAnzahl !== null && fPreis !== null) {
      products.push({
        kArtikel,
        nAnzahl,
        fPreis,
        ...(typeof item.cName === 'string' ? { cName: item.cName.slice(0, 510) } : {}),
        ...(typeof item.cArtNr === 'string' ? { cArtNr: item.cArtNr.slice(0, 200) } : {}),
      });
    }
  }
  return products.length > 0 ? products : null;
}

function parseActivityLogFilters(req: ApiRequest): ParseResult<{
  activityType?: string;
  activityTypes?: readonly string[];
  customerId?: number;
  dealId?: number;
  taskId?: number;
  search?: string;
  includeMetadata: boolean;
  sort?: ActivityLogListSort;
}> {
  const activityType = normalizeTextFilter(req.query?.activityType, 100);
  if (activityType === null) return parseError('invalid_activity_type', 'activityType darf maximal 100 Zeichen haben');
  const timelineFilter = normalizeTextFilter(req.query?.timelineFilter, 100);
  if (timelineFilter === null) return parseError('invalid_timeline_filter', 'timelineFilter darf maximal 100 Zeichen haben');
  const activityTypes = timelineFilter === undefined ? undefined : activityTypesForTimelineFilter(timelineFilter);
  if (activityTypes === null) return parseError('invalid_timeline_filter', 'timelineFilter ist ungueltig');
  if (activityType !== undefined && activityTypes !== undefined) {
    return parseError('invalid_activity_filter', 'activityType und timelineFilter duerfen nicht kombiniert werden');
  }
  const customerId = parseOptionalPositiveInt(req.query?.customerId);
  if (customerId === null) return parseError('invalid_customer_id', 'customerId muss eine positive Ganzzahl sein');
  const dealId = parseOptionalPositiveInt(req.query?.dealId);
  if (dealId === null) return parseError('invalid_deal_id', 'dealId muss eine positive Ganzzahl sein');
  const taskId = parseOptionalPositiveInt(req.query?.taskId);
  if (taskId === null) return parseError('invalid_task_id', 'taskId muss eine positive Ganzzahl sein');
  const search = normalizeTextFilter(req.query?.search, 200);
  if (search === null) return parseError('invalid_search', 'search darf maximal 200 Zeichen haben');
  const includeMetadata = parseOptionalBoolean(req.query?.includeMetadata);
  if (includeMetadata === null) return parseError('invalid_include_metadata', 'includeMetadata muss true oder false sein');
  const sort = parseActivityLogSort(req.query?.sort);
  if (sort === null) return parseError('invalid_activity_log_sort', 'sort ist ungueltig');
  return {
    ok: true,
    filters: omitUndefined({
      activityType,
      activityTypes,
      customerId,
      dealId,
      taskId,
      search,
      includeMetadata: includeMetadata === true,
      sort,
    }),
  };
}

function parseActivityLogSort(value: string | undefined): ActivityLogListSort | undefined | null {
  if (value === undefined || value === '') return undefined;
  if (value === 'idAsc' || value === 'createdAtDesc') return value;
  return null;
}

function activityTypesForTimelineFilter(value: string): readonly string[] | null {
  switch (value) {
    case 'tasks':
      return ['task_created', 'task_completed'];
    case 'deals':
      return ['stage_change', 'deal_created'];
    case 'communication':
      return ['call', 'email', 'note'];
    default:
      return null;
  }
}

function parseActivityLogMutationBody(
  body: unknown,
  options: {
    requireAtLeastOneField: boolean;
    requireActivityType: boolean;
  },
): ActivityLogMutationParseResult {
  if (!isPlainObject(body)) {
    return {
      ok: false,
      response: error(400, 'invalid_activity_log_payload', 'Activity log payload muss ein JSON-Objekt sein'),
    };
  }

  const values: ActivityLogMutationInput = {};
  const errors: Array<{ field: string; message: string }> = [];
  const allowedFields = new Set([
    'customerId',
    'dealId',
    'taskId',
    'activityType',
    'title',
    'description',
    'metadata',
    'createdAt',
  ]);

  for (const key of Object.keys(body)) {
    if (!allowedFields.has(key)) errors.push({ field: key, message: 'Feld ist nicht erlaubt' });
  }

  if (Object.prototype.hasOwnProperty.call(body, 'customerId')) {
    const customerId = normalizeNullablePositiveBodyInt(body.customerId, 'customerId');
    if (customerId.ok) values.customerId = customerId.value;
    else errors.push({ field: 'customerId', message: customerId.message });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'dealId')) {
    const dealId = normalizeNullablePositiveBodyInt(body.dealId, 'dealId');
    if (dealId.ok) values.dealId = dealId.value;
    else errors.push({ field: 'dealId', message: dealId.message });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'taskId')) {
    const taskId = normalizeNullablePositiveBodyInt(body.taskId, 'taskId');
    if (taskId.ok) values.taskId = taskId.value;
    else errors.push({ field: 'taskId', message: taskId.message });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'activityType')) {
    const activityType = normalizeRequiredBodyText(body.activityType, 100);
    if (activityType.ok) values.activityType = activityType.value;
    else errors.push({ field: 'activityType', message: activityType.message });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'title')) {
    const title = normalizeNullableBodyText(body.title, 500);
    if (title.ok) values.title = title.value;
    else errors.push({ field: 'title', message: title.message });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'description')) {
    const description = normalizeNullableBodyText(body.description, 10000);
    if (description.ok) values.description = description.value;
    else errors.push({ field: 'description', message: description.message });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'metadata')) {
    const metadata = normalizeActivityLogMetadata(body.metadata);
    if (metadata.ok) values.metadata = metadata.value;
    else errors.push({ field: 'metadata', message: metadata.message });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'createdAt')) {
    if (body.createdAt === null) {
      values.createdAt = null;
    } else {
      const createdAt = normalizeRequiredBodyTimestamp(body.createdAt, 'createdAt');
      if (createdAt.ok) values.createdAt = createdAt.value;
      else errors.push({ field: 'createdAt', message: createdAt.message });
    }
  }

  if (errors.length > 0) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'Activity log payload ist ungueltig', { fields: errors }),
    };
  }
  if (options.requireAtLeastOneField && Object.keys(values).length === 0) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'Mindestens ein Activity-Log-Feld ist erforderlich'),
    };
  }
  if (options.requireActivityType && !values.activityType) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'activityType ist fuer neue Activity Logs erforderlich'),
    };
  }

  return { ok: true, values };
}

function parseCalendarEventFilters(req: ApiRequest): ParseResult<{
  search?: string;
  eventType?: string;
  taskId?: number;
  startFrom?: string;
  startTo?: string;
}> {
  const search = normalizeTextFilter(req.query?.search, 200);
  if (search === null) return parseError('invalid_search', 'search darf maximal 200 Zeichen haben');
  const eventType = normalizeTextFilter(req.query?.eventType, 100);
  if (eventType === null) return parseError('invalid_event_type', 'eventType darf maximal 100 Zeichen haben');
  const taskId = parseOptionalPositiveInt(req.query?.taskId);
  if (taskId === null) return parseError('invalid_task_id', 'taskId muss eine positive Ganzzahl sein');
  const startFrom = parseOptionalIsoDate(req.query?.startFrom);
  if (startFrom === null) return parseError('invalid_start_from', 'startFrom muss ein valides Datum sein');
  const startTo = parseOptionalIsoDate(req.query?.startTo);
  if (startTo === null) return parseError('invalid_start_to', 'startTo muss ein valides Datum sein');
  return { ok: true, filters: omitUndefined({ search, eventType, taskId, startFrom, startTo }) };
}

function parseCalendarEventMutationBody(
  body: unknown,
  options: {
    requireAtLeastOneField: boolean;
    requireTitle: boolean;
    requireStartAndEnd: boolean;
  },
): CalendarEventMutationParseResult {
  if (!isPlainObject(body)) {
    return {
      ok: false,
      response: error(400, 'invalid_calendar_event_payload', 'Calendar event payload muss ein JSON-Objekt sein'),
    };
  }

  const values: CalendarEventMutationInput = {};
  const errors: Array<{ field: string; message: string }> = [];
  const allowedFields = new Set([
    'title',
    'description',
    'startDate',
    'endDate',
    'allDay',
    'colorCode',
    'eventType',
    'recurrenceRule',
    'taskId',
  ]);

  for (const key of Object.keys(body)) {
    if (!allowedFields.has(key)) errors.push({ field: key, message: 'Feld ist nicht erlaubt' });
  }

  if (Object.prototype.hasOwnProperty.call(body, 'title')) {
    const title = normalizeRequiredBodyText(body.title, 300);
    if (title.ok) values.title = title.value;
    else errors.push({ field: 'title', message: title.message });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'description')) {
    const description = normalizeNullableBodyText(body.description, 10000);
    if (description.ok) values.description = description.value;
    else errors.push({ field: 'description', message: description.message });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'startDate')) {
    const startDate = normalizeRequiredBodyTimestamp(body.startDate, 'startDate');
    if (startDate.ok) values.startDate = startDate.value;
    else errors.push({ field: 'startDate', message: startDate.message });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'endDate')) {
    const endDate = normalizeRequiredBodyTimestamp(body.endDate, 'endDate');
    if (endDate.ok) values.endDate = endDate.value;
    else errors.push({ field: 'endDate', message: endDate.message });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'allDay')) {
    if (typeof body.allDay === 'boolean') values.allDay = body.allDay;
    else errors.push({ field: 'allDay', message: 'Feld muss ein Boolean sein' });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'colorCode')) {
    const colorCode = normalizeNullableBodyText(body.colorCode, 50);
    if (colorCode.ok) values.colorCode = colorCode.value;
    else errors.push({ field: 'colorCode', message: colorCode.message });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'eventType')) {
    const eventType = normalizeNullableBodyText(body.eventType, 100);
    if (eventType.ok) values.eventType = eventType.value;
    else errors.push({ field: 'eventType', message: eventType.message });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'recurrenceRule')) {
    const recurrenceRule = normalizeNullableBodyText(body.recurrenceRule, 1000);
    if (recurrenceRule.ok) values.recurrenceRule = recurrenceRule.value;
    else errors.push({ field: 'recurrenceRule', message: recurrenceRule.message });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'taskId')) {
    const taskId = normalizeNullablePositiveBodyInt(body.taskId, 'taskId');
    if (taskId.ok) values.taskId = taskId.value;
    else errors.push({ field: 'taskId', message: taskId.message });
  }

  if (
    values.startDate !== undefined
    && values.endDate !== undefined
    && new Date(values.endDate).getTime() < new Date(values.startDate).getTime()
  ) {
    errors.push({ field: 'endDate', message: 'endDate darf nicht vor startDate liegen' });
  }

  if (errors.length > 0) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'Calendar event payload ist ungueltig', { fields: errors }),
    };
  }
  if (options.requireAtLeastOneField && Object.keys(values).length === 0) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'Mindestens ein Calendar-Event-Feld ist erforderlich'),
    };
  }
  if (options.requireTitle && !values.title) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'title ist fuer neue Calendar Events erforderlich'),
    };
  }
  if (options.requireStartAndEnd && (!values.startDate || !values.endDate)) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'startDate und endDate sind fuer neue Calendar Events erforderlich'),
    };
  }

  return { ok: true, values };
}

function parseCustomFieldFilters(req: ApiRequest): ParseResult<{ search?: string; type?: string; active?: boolean }> {
  const search = normalizeTextFilter(req.query?.search, 200);
  if (search === null) return parseError('invalid_search', 'search darf maximal 200 Zeichen haben');
  const type = normalizeTextFilter(req.query?.type, 100);
  if (type === null) return parseError('invalid_type', 'type darf maximal 100 Zeichen haben');
  const active = parseOptionalBoolean(req.query?.active);
  if (active === null) return parseError('invalid_active', 'active muss true oder false sein');
  return { ok: true, filters: omitUndefined({ search, type, active }) };
}

function parseCustomFieldValueFilters(req: ApiRequest): ParseResult<{ customerId?: number; fieldId?: number; search?: string }> {
  const customerId = parseOptionalPositiveInt(req.query?.customerId);
  if (customerId === null) return parseError('invalid_customer_id', 'customerId muss eine positive Ganzzahl sein');
  const fieldId = parseOptionalPositiveInt(req.query?.fieldId);
  if (fieldId === null) return parseError('invalid_field_id', 'fieldId muss eine positive Ganzzahl sein');
  const search = normalizeTextFilter(req.query?.search, 200);
  if (search === null) return parseError('invalid_search', 'search darf maximal 200 Zeichen haben');
  return { ok: true, filters: omitUndefined({ customerId, fieldId, search }) };
}

function parseCustomFieldMutationBody(
  body: unknown,
  options: {
    requireAtLeastOneField: boolean;
    requireName: boolean;
    requireLabel: boolean;
    requireType: boolean;
  },
): CustomerCustomFieldMutationParseResult {
  if (!isPlainObject(body)) {
    return {
      ok: false,
      response: error(400, 'invalid_customer_custom_field_payload', 'Customer custom field payload muss ein JSON-Objekt sein'),
    };
  }

  const values: CustomerCustomFieldMutationInput = {};
  const errors: Array<{ field: string; message: string }> = [];
  const allowedFields = new Set([
    'name',
    'label',
    'type',
    'required',
    'options',
    'defaultValue',
    'placeholder',
    'description',
    'displayOrder',
    'active',
  ]);

  for (const key of Object.keys(body)) {
    if (!allowedFields.has(key)) errors.push({ field: key, message: 'Feld ist nicht erlaubt' });
  }

  if (Object.prototype.hasOwnProperty.call(body, 'name')) {
    const name = normalizeRequiredBodyText(body.name, 100);
    if (name.ok) values.name = name.value;
    else errors.push({ field: 'name', message: name.message });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'label')) {
    const label = normalizeRequiredBodyText(body.label, 200);
    if (label.ok) values.label = label.value;
    else errors.push({ field: 'label', message: label.message });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'type')) {
    const type = normalizeRequiredBodyText(body.type, 50);
    if (type.ok) values.type = type.value;
    else errors.push({ field: 'type', message: type.message });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'required')) {
    if (typeof body.required === 'boolean') values.required = body.required;
    else errors.push({ field: 'required', message: 'Feld muss ein Boolean sein' });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'options')) {
    const fieldOptions = normalizeNullableJsonBody(body.options);
    if (fieldOptions.ok) values.options = fieldOptions.value;
    else errors.push({ field: 'options', message: fieldOptions.message });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'defaultValue')) {
    const defaultValue = normalizeNullableBodyText(body.defaultValue, 1000);
    if (defaultValue.ok) values.defaultValue = defaultValue.value;
    else errors.push({ field: 'defaultValue', message: defaultValue.message });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'placeholder')) {
    const placeholder = normalizeNullableBodyText(body.placeholder, 1000);
    if (placeholder.ok) values.placeholder = placeholder.value;
    else errors.push({ field: 'placeholder', message: placeholder.message });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'description')) {
    const description = normalizeNullableBodyText(body.description, 10000);
    if (description.ok) values.description = description.value;
    else errors.push({ field: 'description', message: description.message });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'displayOrder')) {
    const displayOrder = normalizeNonNegativeBodyInt(body.displayOrder, 'displayOrder');
    if (displayOrder.ok) values.displayOrder = displayOrder.value;
    else errors.push({ field: 'displayOrder', message: displayOrder.message });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'active')) {
    if (typeof body.active === 'boolean') values.active = body.active;
    else errors.push({ field: 'active', message: 'Feld muss ein Boolean sein' });
  }

  if (errors.length > 0) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'Customer custom field payload ist ungueltig', { fields: errors }),
    };
  }
  if (options.requireAtLeastOneField && Object.keys(values).length === 0) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'Mindestens ein Custom-Field-Feld ist erforderlich'),
    };
  }
  if (options.requireName && !values.name) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'name ist fuer neue Custom Fields erforderlich'),
    };
  }
  if (options.requireLabel && !values.label) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'label ist fuer neue Custom Fields erforderlich'),
    };
  }
  if (options.requireType && !values.type) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'type ist fuer neue Custom Fields erforderlich'),
    };
  }

  return { ok: true, values };
}

function parseCustomFieldValueMutationBody(
  body: unknown,
  options: {
    requireAtLeastOneField: boolean;
    requireCustomerAndField: boolean;
  },
): CustomerCustomFieldValueMutationParseResult {
  if (!isPlainObject(body)) {
    return {
      ok: false,
      response: error(400, 'invalid_customer_custom_field_value_payload', 'Customer custom field value payload muss ein JSON-Objekt sein'),
    };
  }

  const values: CustomerCustomFieldValueMutationInput = {};
  const errors: Array<{ field: string; message: string }> = [];
  const allowedFields = new Set(['customerId', 'fieldId', 'value']);

  for (const key of Object.keys(body)) {
    if (!allowedFields.has(key)) errors.push({ field: key, message: 'Feld ist nicht erlaubt' });
  }

  if (Object.prototype.hasOwnProperty.call(body, 'customerId')) {
    const customerId = normalizePositiveBodyInt(body.customerId, 'customerId');
    if (customerId.ok) values.customerId = customerId.value;
    else errors.push({ field: 'customerId', message: customerId.message });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'fieldId')) {
    const fieldId = normalizePositiveBodyInt(body.fieldId, 'fieldId');
    if (fieldId.ok) values.fieldId = fieldId.value;
    else errors.push({ field: 'fieldId', message: fieldId.message });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'value')) {
    const value = normalizeNullableCustomFieldValue(body.value);
    if (value.ok) values.value = value.value;
    else errors.push({ field: 'value', message: value.message });
  }

  if (errors.length > 0) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'Customer custom field value payload ist ungueltig', { fields: errors }),
    };
  }
  if (options.requireAtLeastOneField && Object.keys(values).length === 0) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'Mindestens ein Custom-Field-Value-Feld ist erforderlich'),
    };
  }
  if (options.requireCustomerAndField && (values.customerId === undefined || values.fieldId === undefined)) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'customerId und fieldId sind fuer neue Custom Field Values erforderlich'),
    };
  }

  return { ok: true, values };
}

function parseSavedViewMutationBody(
  body: unknown,
  options: {
    requireAtLeastOneField: boolean;
    requireName: boolean;
    requireFilters: boolean;
  },
): SavedViewMutationParseResult {
  if (!isPlainObject(body)) {
    return {
      ok: false,
      response: error(400, 'invalid_saved_view_payload', 'Saved view payload muss ein JSON-Objekt sein'),
    };
  }

  const values: SavedViewMutationInput = {};
  const errors: Array<{ field: string; message: string }> = [];
  const allowedFields = new Set(['name', 'filters', 'displayOrder']);

  for (const key of Object.keys(body)) {
    if (!allowedFields.has(key)) errors.push({ field: key, message: 'Feld ist nicht erlaubt' });
  }

  if (Object.prototype.hasOwnProperty.call(body, 'name')) {
    const name = normalizeRequiredBodyText(body.name, 200);
    if (name.ok) values.name = name.value;
    else errors.push({ field: 'name', message: name.message });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'filters')) {
    const filters = normalizeSavedViewFilters(body.filters);
    if (filters.ok) values.filters = filters.value;
    else errors.push({ field: 'filters', message: filters.message });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'displayOrder')) {
    const displayOrder = normalizeNonNegativeBodyInt(body.displayOrder, 'displayOrder');
    if (displayOrder.ok) values.displayOrder = displayOrder.value;
    else errors.push({ field: 'displayOrder', message: displayOrder.message });
  }

  if (errors.length > 0) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'Saved view payload ist ungueltig', { fields: errors }),
    };
  }
  if (options.requireAtLeastOneField && Object.keys(values).length === 0) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'Mindestens ein Saved-View-Feld ist erforderlich'),
    };
  }
  if (options.requireName && !values.name) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'name ist fuer neue Saved Views erforderlich'),
    };
  }
  if (options.requireFilters && values.filters === undefined) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'filters ist fuer neue Saved Views erforderlich'),
    };
  }

  return { ok: true, values };
}

function sanitizeActivityLogList(result: ActivityLogListResult, includeMetadata: boolean): ActivityLogListResult {
  return { items: result.items.map((item) => sanitizeActivityLog(item, includeMetadata)), nextCursor: result.nextCursor };
}

function sanitizeActivityLog(item: ActivityLogRecord, includeMetadata: boolean): ActivityLogRecord {
  return {
    id: item.id,
    sourceSqliteId: item.sourceSqliteId,
    customerSourceSqliteId: item.customerSourceSqliteId,
    dealSourceSqliteId: item.dealSourceSqliteId,
    taskSourceSqliteId: item.taskSourceSqliteId,
    customerId: item.customerId,
    dealId: item.dealId,
    taskId: item.taskId,
    activityType: item.activityType,
    title: item.title,
    description: item.description,
    ...(includeMetadata ? { metadata: item.metadata } : {}),
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

function sanitizeCalendarEventList(result: CalendarEventListResult): CalendarEventListResult {
  return { items: result.items.map(sanitizeCalendarEvent), nextCursor: result.nextCursor };
}

function sanitizeCalendarEvent(item: CalendarEventRecord): CalendarEventRecord {
  return {
    id: item.id,
    sourceSqliteId: item.sourceSqliteId,
    title: item.title,
    description: item.description,
    startDate: item.startDate,
    endDate: item.endDate,
    allDay: item.allDay,
    colorCode: item.colorCode,
    eventType: item.eventType,
    recurrenceRule: item.recurrenceRule,
    taskSourceSqliteId: item.taskSourceSqliteId,
    taskId: item.taskId,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

function sanitizeCustomFieldList(result: CustomerCustomFieldListResult): CustomerCustomFieldListResult {
  return { items: result.items.map(sanitizeCustomField), nextCursor: result.nextCursor };
}

function sanitizeCustomField(field: CustomerCustomFieldRecord): CustomerCustomFieldRecord {
  return {
    id: field.id,
    sourceSqliteId: field.sourceSqliteId,
    name: field.name,
    label: field.label,
    type: field.type,
    required: field.required,
    options: field.options,
    defaultValue: field.defaultValue,
    placeholder: field.placeholder,
    description: field.description,
    displayOrder: field.displayOrder,
    active: field.active,
    createdAt: field.createdAt,
    updatedAt: field.updatedAt,
  };
}

function sanitizeCustomFieldValueList(result: CustomerCustomFieldValueListResult): CustomerCustomFieldValueListResult {
  return { items: result.items.map(sanitizeCustomFieldValue), nextCursor: result.nextCursor };
}

function sanitizeCustomFieldValue(value: CustomerCustomFieldValueRecord): CustomerCustomFieldValueRecord {
  return {
    id: value.id,
    sourceSqliteId: value.sourceSqliteId,
    customerSourceSqliteId: value.customerSourceSqliteId,
    fieldSourceSqliteId: value.fieldSourceSqliteId,
    customerId: value.customerId,
    fieldId: value.fieldId,
    value: value.value,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

function sanitizeSavedViewList(result: SavedViewListResult): SavedViewListResult {
  return { items: result.items.map(sanitizeSavedView), nextCursor: result.nextCursor };
}

function sanitizeSavedView(view: SavedViewRecord): SavedViewRecord {
  return {
    id: view.id,
    sourceSqliteId: view.sourceSqliteId,
    name: view.name,
    filters: view.filters,
    displayOrder: view.displayOrder,
    createdAt: view.createdAt,
    updatedAt: view.updatedAt,
  };
}

function sanitizeJtlReferenceList(result: JtlReferenceListResult): JtlReferenceListResult {
  return { items: result.items.map(sanitizeJtlReference), nextCursor: result.nextCursor };
}

function sanitizeJtlReference(item: JtlReferenceRecord): JtlReferenceRecord {
  return {
    sourceSqliteId: item.sourceSqliteId,
    name: item.name,
    updatedAt: item.updatedAt,
  };
}

function jtlReferenceEntityId(resource: JtlResource, item: JtlReferenceRecord): string {
  return `${resource}:${item.sourceSqliteId}`;
}

function jtlPort(ports: ServerApiPorts, resource: JtlResource) {
  switch (resource) {
    case 'firmen':
      return ports.jtlFirmen;
    case 'warenlager':
      return ports.jtlWarenlager;
    case 'zahlungsarten':
      return ports.jtlZahlungsarten;
    case 'versandarten':
      return ports.jtlVersandarten;
    default:
      return assertNever(resource);
  }
}

function routeResource(value: string): NumericResource {
  switch (value) {
    case 'activity-log':
      return 'activityLog';
    case 'calendar-events':
      return 'calendarEvents';
    case 'customer-custom-fields':
      return 'customerCustomFields';
    case 'customer-custom-field-values':
      return 'customerCustomFieldValues';
    case 'saved-views':
      return 'savedViews';
    default:
      throw new Error(`Unexpected extended CRM route: ${value}`);
  }
}

function resourceErrorName(resource: NumericResource): string {
  switch (resource) {
    case 'activityLog':
      return 'activity_log_entry';
    case 'calendarEvents':
      return 'calendar_event';
    case 'customerCustomFields':
      return 'customer_custom_field';
    case 'customerCustomFieldValues':
      return 'customer_custom_field_value';
    case 'savedViews':
      return 'saved_view';
    default:
      return assertNever(resource);
  }
}

function resourceLabel(resource: NumericResource): string {
  switch (resource) {
    case 'activityLog':
      return 'activity log entry';
    case 'calendarEvents':
      return 'calendar event';
    case 'customerCustomFields':
      return 'customer custom field';
    case 'customerCustomFieldValues':
      return 'customer custom field value';
    case 'savedViews':
      return 'saved view';
    default:
      return assertNever(resource);
  }
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

function parseOptionalNonZeroInt(value: string | undefined): number | undefined | null {
  if (value === undefined || value === '') return undefined;
  return parseNonZeroInt(value);
}

function parsePositiveInt(value: string): number | null {
  if (!/^[1-9]\d*$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function parseBodyPositiveInt(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  }
  if (typeof value === 'string' && value.trim()) {
    return parsePositiveInt(value.trim());
  }
  return null;
}

function parseBodyPositiveNumber(value: unknown): number | null {
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim()
      ? Number(value)
      : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parseBodyNonNegativeNumber(value: unknown): number | null {
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim()
      ? Number(value)
      : NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function parseNonZeroInt(value: string): number | null {
  if (!/^-?[1-9]\d*$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function sourceSqliteIdFromPath(value: string | undefined): number | null {
  if (value === undefined) return null;
  return parseNonZeroInt(value);
}

function parseOptionalBoolean(value: string | undefined): boolean | undefined | null {
  if (value === undefined || value === '') return undefined;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return null;
}

function parseOptionalIsoDate(value: string | undefined): string | undefined | null {
  if (value === undefined || value.trim() === '') return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function normalizeRequiredBodyText(
  rawValue: unknown,
  maxLength: number,
): { ok: true; value: string } | { ok: false; message: string } {
  if (typeof rawValue !== 'string') return { ok: false, message: 'Feld muss ein String sein' };
  const value = rawValue.trim();
  if (!value) return { ok: false, message: 'Feld darf nicht leer sein' };
  if (value.length > maxLength) return { ok: false, message: `Feld darf maximal ${maxLength} Zeichen haben` };
  return { ok: true, value };
}

function normalizeNullableBodyText(
  rawValue: unknown,
  maxLength: number,
): { ok: true; value: string | null } | { ok: false; message: string } {
  if (rawValue === null) return { ok: true, value: null };
  if (typeof rawValue !== 'string') return { ok: false, message: 'Feld muss ein String sein' };
  const value = rawValue.trim();
  if (!value) return { ok: true, value: null };
  if (value.length > maxLength) return { ok: false, message: `Feld darf maximal ${maxLength} Zeichen haben` };
  return { ok: true, value };
}

function normalizeRequiredBodyTimestamp(
  rawValue: unknown,
  field: string,
): { ok: true; value: string } | { ok: false; message: string } {
  if (typeof rawValue !== 'string') return { ok: false, message: 'Feld muss ein String sein' };
  const value = rawValue.trim();
  if (!value) return { ok: false, message: 'Feld darf nicht leer sein' };
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { ok: false, message: `${field} muss ein valides Datum sein` };
  return { ok: true, value: date.toISOString() };
}

function normalizeNullablePositiveBodyInt(
  rawValue: unknown,
  field: string,
): { ok: true; value: number | null } | { ok: false; message: string } {
  if (rawValue === null) return { ok: true, value: null };
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

function normalizePositiveBodyInt(
  rawValue: unknown,
  field: string,
): { ok: true; value: number } | { ok: false; message: string } {
  const normalized = normalizeNullablePositiveBodyInt(rawValue, field);
  if (!normalized.ok) return normalized;
  if (normalized.value === null) return { ok: false, message: `${field} muss eine positive Ganzzahl sein` };
  return { ok: true, value: normalized.value };
}

function normalizeNonNegativeBodyInt(
  rawValue: unknown,
  field: string,
): { ok: true; value: number } | { ok: false; message: string } {
  const value = typeof rawValue === 'number'
    ? rawValue
    : typeof rawValue === 'string'
      ? Number(rawValue.trim())
      : NaN;
  if (!Number.isSafeInteger(value) || value < 0) {
    return { ok: false, message: `${field} muss eine nichtnegative Ganzzahl sein` };
  }
  return { ok: true, value };
}

function normalizeNullableJsonBody(
  rawValue: unknown,
): { ok: true; value: unknown | null } | { ok: false; message: string } {
  if (rawValue === null) return { ok: true, value: null };
  return isJsonCompatible(rawValue)
    ? { ok: true, value: rawValue }
    : { ok: false, message: 'Feld muss JSON-kompatibel sein' };
}

function normalizeSavedViewFilters(
  rawValue: unknown,
): { ok: true; value: unknown } | { ok: false; message: string } {
  if (rawValue === null) return { ok: false, message: 'filters muss JSON-kompatibel sein' };
  if (typeof rawValue === 'string') {
    try {
      const parsed = JSON.parse(rawValue);
      return parsed !== null && isJsonCompatible(parsed)
        ? { ok: true, value: parsed }
        : { ok: false, message: 'filters muss valides JSON enthalten' };
    } catch {
      return { ok: false, message: 'filters muss valides JSON enthalten' };
    }
  }
  return isJsonCompatible(rawValue)
    ? { ok: true, value: rawValue }
    : { ok: false, message: 'filters muss JSON-kompatibel sein' };
}

function normalizeActivityLogMetadata(
  rawValue: unknown,
): { ok: true; value: unknown | null } | { ok: false; message: string } {
  if (rawValue === null) return { ok: true, value: null };
  if (typeof rawValue === 'string') {
    const trimmed = rawValue.trim();
    if (!trimmed) return { ok: true, value: null };
    try {
      const parsed = JSON.parse(trimmed);
      return isJsonCompatible(parsed)
        ? { ok: true, value: parsed }
        : { ok: false, message: 'metadata muss valides JSON enthalten' };
    } catch {
      return { ok: false, message: 'metadata muss valides JSON enthalten' };
    }
  }
  return isJsonCompatible(rawValue)
    ? { ok: true, value: rawValue }
    : { ok: false, message: 'metadata muss JSON-kompatibel sein' };
}

function normalizeNullableCustomFieldValue(
  rawValue: unknown,
): { ok: true; value: string | null } | { ok: false; message: string } {
  if (rawValue === null) return { ok: true, value: null };
  if (typeof rawValue === 'string') {
    if (rawValue.length > 10000) return { ok: false, message: 'Feld darf maximal 10000 Zeichen haben' };
    return { ok: true, value: rawValue };
  }
  if (typeof rawValue === 'number') {
    return Number.isFinite(rawValue)
      ? { ok: true, value: String(rawValue) }
      : { ok: false, message: 'Feld muss JSON-kompatibel sein' };
  }
  if (typeof rawValue === 'boolean') return { ok: true, value: String(rawValue) };
  if (!isJsonCompatible(rawValue)) return { ok: false, message: 'Feld muss JSON-kompatibel sein' };
  const value = JSON.stringify(rawValue);
  if (value.length > 10000) return { ok: false, message: 'Feld darf maximal 10000 Zeichen haben' };
  return { ok: true, value };
}

function isJsonCompatible(value: unknown, seen: Set<object> = new Set()): boolean {
  if (value === null) return true;
  if (typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) {
    if (seen.has(value)) return false;
    seen.add(value);
    const result = value.every((item) => item !== undefined && isJsonCompatible(item, seen));
    seen.delete(value);
    return result;
  }
  if (isPlainObject(value)) {
    if (seen.has(value)) return false;
    seen.add(value);
    const result = Object.values(value).every((item) => item !== undefined && isJsonCompatible(item, seen));
    seen.delete(value);
    return result;
  }
  return false;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function normalizeTextFilter(value: string | undefined, maxLength: number): string | undefined | null {
  if (value === undefined) return undefined;
  const normalized = value.trim();
  if (!normalized) return undefined;
  return normalized.length > maxLength ? null : normalized;
}

function omitUndefined<T extends Record<string, unknown>>(input: T): T {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as T;
}

function parseError(code: string, message: string): ParseResult<never> {
  return { ok: false, response: error(400, code, message) };
}

function unavailable(code: string, message: string): ApiResponse {
  return error(503, code, message);
}

function methodNotAllowed(): ApiResponse {
  return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
}

function assertNever(value: never): never {
  throw new Error(`Unexpected extended CRM resource: ${value}`);
}
