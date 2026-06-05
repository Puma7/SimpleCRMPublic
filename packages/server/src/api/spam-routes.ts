import type {
  ApiErrorBody,
  ApiRequest,
  ApiResponse,
  AuthenticatedPrincipal,
  ServerApiPorts,
  SpamDecisionListResult,
  SpamDecisionMutationInput,
  SpamDecisionRecord,
  SpamFeatureStatListResult,
  SpamFeatureStatRecord,
  SpamLearningEventListResult,
  SpamLearningEventMutationInput,
  SpamLearningEventRecord,
  SpamListEntryListResult,
  SpamListEntryMutationInput,
  SpamListEntryRecord,
} from './types';
import {
  data,
  error,
  positiveIntFromPath,
  requirePrincipal,
} from './types';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

type SpamResource = 'listEntries' | 'learningEvents' | 'decisions' | 'featureStats';

type SpamListEntryMutationParseResult =
  | { ok: true; values: SpamListEntryMutationInput }
  | { ok: false; response: ApiResponse<ApiErrorBody> };

type SpamLearningEventMutationParseResult =
  | { ok: true; values: SpamLearningEventMutationInput }
  | { ok: false; response: ApiResponse<ApiErrorBody> };

type SpamDecisionMutationParseResult =
  | { ok: true; values: SpamDecisionMutationInput }
  | { ok: false; response: ApiResponse<ApiErrorBody> };

export async function handleSpamReadRoute(
  req: ApiRequest,
  ports: ServerApiPorts,
): Promise<ApiResponse | null> {
  if (req.path === '/api/v1/spam/list-entries/upsert') {
    return handleUpsertListEntry(req, ports);
  }

  const listEntryMatch = /^\/api\/v1\/spam\/list-entries(?:\/([^/]+))?$/.exec(req.path);
  if (listEntryMatch) {
    return listEntryMatch[1] === undefined
      ? handleListRoute(req, ports, 'listEntries')
      : handleGetByIdRoute(req, ports, 'listEntries', listEntryMatch[1]);
  }

  const learningEventMatch = /^\/api\/v1\/spam\/learning-events(?:\/([^/]+))?$/.exec(req.path);
  if (learningEventMatch) {
    return learningEventMatch[1] === undefined
      ? handleListRoute(req, ports, 'learningEvents')
      : handleGetByIdRoute(req, ports, 'learningEvents', learningEventMatch[1]);
  }

  const decisionMatch = /^\/api\/v1\/spam\/decisions(?:\/([^/]+))?$/.exec(req.path);
  if (decisionMatch) {
    return decisionMatch[1] === undefined
      ? handleListRoute(req, ports, 'decisions')
      : handleGetByIdRoute(req, ports, 'decisions', decisionMatch[1]);
  }

  const featureStatsMatch = /^\/api\/v1\/spam\/feature-stats(?:\/([^/]+))?$/.exec(req.path);
  if (featureStatsMatch) {
    return featureStatsMatch[1] === undefined
      ? handleListRoute(req, ports, 'featureStats')
      : handleFeatureStatGet(req, ports, featureStatsMatch[1]);
  }

  return null;
}

async function handleListRoute(
  req: ApiRequest,
  ports: ServerApiPorts,
  resource: SpamResource,
): Promise<ApiResponse> {
  if (resource === 'listEntries' && req.method === 'POST') return handleCreateListEntry(req, ports);
  if (resource === 'learningEvents' && req.method === 'POST') return handleCreateLearningEvent(req, ports);
  if (resource === 'decisions' && req.method === 'POST') return handleCreateDecision(req, ports);
  if (req.method !== 'GET') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;

  const limit = parseLimit(req.query?.limit);
  if (limit === null) return error(400, 'invalid_limit', `limit muss zwischen 1 und ${MAX_LIMIT} liegen`);

  switch (resource) {
    case 'listEntries':
      return handleListEntryList(req, ports, principal.workspaceId, limit);
    case 'learningEvents':
      return handleLearningEventList(req, ports, principal.workspaceId, limit);
    case 'decisions':
      return handleDecisionList(req, ports, principal.workspaceId, limit);
    case 'featureStats':
      return handleFeatureStatList(req, ports, principal.workspaceId, limit);
    default:
      return assertNever(resource);
  }
}

async function handleListEntryList(
  req: ApiRequest,
  ports: ServerApiPorts,
  workspaceId: string,
  limit: number,
): Promise<ApiResponse> {
  const cursor = parseOptionalPositiveInt(req.query?.cursor);
  if (cursor === null) return error(400, 'invalid_cursor', 'cursor muss eine positive Ganzzahl sein');
  const listType = parseListType(req.query?.listType);
  if (listType === null) return error(400, 'invalid_list_type', 'listType muss allow oder block sein');
  const patternType = parsePatternType(req.query?.patternType);
  if (patternType === null) return error(400, 'invalid_pattern_type', 'patternType muss email oder domain sein');
  const accountId = parseOptionalPositiveInt(req.query?.accountId);
  if (accountId === null) return error(400, 'invalid_account_id', 'accountId muss eine positive Ganzzahl sein');
  const search = normalizeTextFilter(req.query?.search, 200);
  if (search === null) return error(400, 'invalid_search', 'search darf maximal 200 Zeichen haben');
  if (!ports.spamListEntries) return error(503, 'spam_list_entries_unavailable', 'Spam list entry API nicht konfiguriert');

  const result = await ports.spamListEntries.list({
    workspaceId,
    limit,
    ...(cursor === undefined ? {} : { cursor }),
    ...(listType === undefined ? {} : { listType }),
    ...(patternType === undefined ? {} : { patternType }),
    ...(accountId === undefined ? {} : { accountId }),
    ...(search === undefined ? {} : { search }),
  });
  return data(200, sanitizeListEntryList(result));
}

async function handleLearningEventList(
  req: ApiRequest,
  ports: ServerApiPorts,
  workspaceId: string,
  limit: number,
): Promise<ApiResponse> {
  const cursor = parseOptionalPositiveInt(req.query?.cursor);
  if (cursor === null) return error(400, 'invalid_cursor', 'cursor muss eine positive Ganzzahl sein');
  const label = parseLearningLabel(req.query?.label);
  if (label === null) return error(400, 'invalid_label', 'label muss spam oder ham sein');
  const accountId = parseOptionalPositiveInt(req.query?.accountId);
  if (accountId === null) return error(400, 'invalid_account_id', 'accountId muss eine positive Ganzzahl sein');
  const messageId = parseOptionalPositiveInt(req.query?.messageId);
  if (messageId === null) return error(400, 'invalid_message_id', 'messageId muss eine positive Ganzzahl sein');
  if (!ports.spamLearningEvents) return error(503, 'spam_learning_events_unavailable', 'Spam learning event API nicht konfiguriert');

  const result = await ports.spamLearningEvents.list({
    workspaceId,
    limit,
    ...(cursor === undefined ? {} : { cursor }),
    ...(label === undefined ? {} : { label }),
    ...(accountId === undefined ? {} : { accountId }),
    ...(messageId === undefined ? {} : { messageId }),
  });
  return data(200, sanitizeLearningEventList(result));
}

async function handleDecisionList(
  req: ApiRequest,
  ports: ServerApiPorts,
  workspaceId: string,
  limit: number,
): Promise<ApiResponse> {
  const cursor = parseOptionalPositiveInt(req.query?.cursor);
  if (cursor === null) return error(400, 'invalid_cursor', 'cursor muss eine positive Ganzzahl sein');
  const status = parseDecisionStatus(req.query?.status);
  if (status === null) return error(400, 'invalid_status', 'status muss clean, review oder spam sein');
  const accountId = parseOptionalPositiveInt(req.query?.accountId);
  if (accountId === null) return error(400, 'invalid_account_id', 'accountId muss eine positive Ganzzahl sein');
  const messageId = parseOptionalPositiveInt(req.query?.messageId);
  if (messageId === null) return error(400, 'invalid_message_id', 'messageId muss eine positive Ganzzahl sein');
  if (!ports.spamDecisions) return error(503, 'spam_decisions_unavailable', 'Spam decision API nicht konfiguriert');

  const result = await ports.spamDecisions.list({
    workspaceId,
    limit,
    ...(cursor === undefined ? {} : { cursor }),
    ...(status === undefined ? {} : { status }),
    ...(accountId === undefined ? {} : { accountId }),
    ...(messageId === undefined ? {} : { messageId }),
  });
  return data(200, sanitizeDecisionList(result));
}

async function handleFeatureStatList(
  req: ApiRequest,
  ports: ServerApiPorts,
  workspaceId: string,
  limit: number,
): Promise<ApiResponse> {
  const cursor = normalizeTextFilter(req.query?.cursor, 300);
  if (cursor === null) return error(400, 'invalid_cursor', 'cursor darf maximal 300 Zeichen haben');
  const search = normalizeTextFilter(req.query?.search, 200);
  if (search === null) return error(400, 'invalid_search', 'search darf maximal 200 Zeichen haben');
  if (!ports.spamFeatureStats) return error(503, 'spam_feature_stats_unavailable', 'Spam feature stats API nicht konfiguriert');

  const result = await ports.spamFeatureStats.list({
    workspaceId,
    limit,
    ...(cursor === undefined ? {} : { cursor }),
    ...(search === undefined ? {} : { search }),
  });
  return data(200, sanitizeFeatureStatList(result));
}

async function handleGetByIdRoute(
  req: ApiRequest,
  ports: ServerApiPorts,
  resource: Exclude<SpamResource, 'featureStats'>,
  rawId: string | undefined,
): Promise<ApiResponse> {
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  const id = positiveIntFromPath(rawId);
  if (id === null) return error(400, `invalid_${resourceErrorName(resource)}_id`, `${resourceLabel(resource)} id muss eine positive Ganzzahl sein`);
  if (resource === 'listEntries' && req.method === 'PATCH') return handleUpdateListEntry(req, ports, principal, id);
  if (resource === 'listEntries' && req.method === 'DELETE') return handleDeleteListEntry(ports, principal, id);
  if (resource === 'decisions' && req.method === 'PATCH') return handleUpdateDecision(req, ports, principal, id);
  if (resource === 'decisions' && req.method === 'DELETE') return handleDeleteDecision(ports, principal, id);
  if (req.method !== 'GET') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');

  switch (resource) {
    case 'listEntries': {
      if (!ports.spamListEntries) return error(503, 'spam_list_entries_unavailable', 'Spam list entry API nicht konfiguriert');
      const item = await ports.spamListEntries.get({ workspaceId: principal.workspaceId, id });
      return item ? data(200, sanitizeListEntry(item)) : error(404, 'spam_list_entry_not_found', 'Spam list entry nicht gefunden');
    }
    case 'learningEvents': {
      if (!ports.spamLearningEvents) return error(503, 'spam_learning_events_unavailable', 'Spam learning event API nicht konfiguriert');
      const item = await ports.spamLearningEvents.get({ workspaceId: principal.workspaceId, id });
      return item ? data(200, sanitizeLearningEvent(item)) : error(404, 'spam_learning_event_not_found', 'Spam learning event nicht gefunden');
    }
    case 'decisions': {
      if (!ports.spamDecisions) return error(503, 'spam_decisions_unavailable', 'Spam decision API nicht konfiguriert');
      const item = await ports.spamDecisions.get({ workspaceId: principal.workspaceId, id });
      return item ? data(200, sanitizeDecision(item)) : error(404, 'spam_decision_not_found', 'Spam decision nicht gefunden');
    }
    default:
      return assertNever(resource);
  }
}

async function handleFeatureStatGet(
  req: ApiRequest,
  ports: ServerApiPorts,
  rawFeatureKey: string | undefined,
): Promise<ApiResponse> {
  if (req.method !== 'GET') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  const featureKey = decodePathSegment(rawFeatureKey);
  if (featureKey === null || !featureKey.trim() || featureKey.length > 300) {
    return error(400, 'invalid_feature_key', 'featureKey muss gesetzt sein und darf maximal 300 Zeichen haben');
  }
  if (!ports.spamFeatureStats) return error(503, 'spam_feature_stats_unavailable', 'Spam feature stats API nicht konfiguriert');
  const stat = await ports.spamFeatureStats.get({
    workspaceId: principal.workspaceId,
    featureKey,
  });
  return stat ? data(200, sanitizeFeatureStat(stat)) : error(404, 'spam_feature_stat_not_found', 'Spam feature stat nicht gefunden');
}

async function handleCreateListEntry(
  req: ApiRequest,
  ports: ServerApiPorts,
): Promise<ApiResponse> {
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  if (!ports.spamListEntries?.create) return error(503, 'spam_list_entries_unavailable', 'Spam list entry API nicht konfiguriert');

  const parsed = parseSpamListEntryMutationBody(req.body, {
    requireAtLeastOneField: true,
    requireListType: true,
    requirePatternType: true,
    requirePattern: true,
  });
  if (!parsed.ok) return parsed.response;

  const result = await ports.spamListEntries.create({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    values: parsed.values,
  });
  if (!result.ok) return spamListEntryMutationError(result.code);

  const entry = result.entry;
  await auditSpamListEntry(ports, principal, 'spam_list_entry.created', entry, { pattern: entry.pattern });
  await publishSpamListEntry(ports, principal.workspaceId, 'spam_list_entry.created', entry, principal.userId);
  return data(201, sanitizeListEntry(entry));
}

async function handleUpsertListEntry(
  req: ApiRequest,
  ports: ServerApiPorts,
): Promise<ApiResponse> {
  if (req.method !== 'POST') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  if (!ports.spamListEntries?.create || !ports.spamListEntries.update) {
    return error(503, 'spam_list_entries_unavailable', 'Spam list entry API nicht konfiguriert');
  }

  const parsed = parseSpamListEntryMutationBody(req.body, {
    requireAtLeastOneField: true,
    requireListType: true,
    requirePatternType: true,
    requirePattern: true,
  });
  if (!parsed.ok) return parsed.response;

  const created = await ports.spamListEntries.create({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    values: parsed.values,
  });
  if (created.ok) {
    const entry = created.entry;
    await auditSpamListEntry(ports, principal, 'spam_list_entry.created', entry, { pattern: entry.pattern });
    await publishSpamListEntry(ports, principal.workspaceId, 'spam_list_entry.created', entry, principal.userId);
    return data(201, sanitizeListEntry(entry));
  }
  if (created.code !== 'entry_conflict') return spamListEntryMutationError(created.code);

  const accountId = parsed.values.accountId ?? null;
  const candidates = await ports.spamListEntries.list({
    workspaceId: principal.workspaceId,
    limit: MAX_LIMIT,
    listType: parsed.values.listType,
    patternType: parsed.values.patternType,
    ...(accountId === null ? {} : { accountId }),
    search: parsed.values.pattern,
  });
  const existing = candidates.items.find((entry) => (
    entry.listType === parsed.values.listType
    && entry.patternType === parsed.values.patternType
    && entry.pattern === parsed.values.pattern
    && (entry.accountId ?? null) === accountId
  ));
  if (!existing) return spamListEntryMutationError('entry_conflict');

  const updated = await ports.spamListEntries.update({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    id: existing.id,
    values: parsed.values,
  });
  if (!updated) return error(409, 'spam_list_entry_conflict', 'Spam list entry existiert bereits');
  if (!updated.ok) return spamListEntryMutationError(updated.code);

  const entry = updated.entry;
  await auditSpamListEntry(ports, principal, 'spam_list_entry.updated', entry, {
    fields: Object.keys(parsed.values).sort(),
  });
  await publishSpamListEntry(ports, principal.workspaceId, 'spam_list_entry.updated', entry, principal.userId);
  return data(200, sanitizeListEntry(entry));
}

async function handleUpdateListEntry(
  req: ApiRequest,
  ports: ServerApiPorts,
  principal: AuthenticatedPrincipal,
  id: number,
): Promise<ApiResponse> {
  if (!ports.spamListEntries?.update) return error(503, 'spam_list_entries_unavailable', 'Spam list entry API nicht konfiguriert');

  const parsed = parseSpamListEntryMutationBody(req.body, {
    requireAtLeastOneField: true,
    requireListType: false,
    requirePatternType: false,
    requirePattern: false,
  });
  if (!parsed.ok) return parsed.response;

  const result = await ports.spamListEntries.update({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    id,
    values: parsed.values,
  });
  if (!result) return error(404, 'spam_list_entry_not_found', 'Spam list entry nicht gefunden');
  if (!result.ok) return spamListEntryMutationError(result.code);

  const entry = result.entry;
  await auditSpamListEntry(ports, principal, 'spam_list_entry.updated', entry, {
    fields: Object.keys(parsed.values).sort(),
  });
  await publishSpamListEntry(ports, principal.workspaceId, 'spam_list_entry.updated', entry, principal.userId);
  return data(200, sanitizeListEntry(entry));
}

async function handleDeleteListEntry(
  ports: ServerApiPorts,
  principal: AuthenticatedPrincipal,
  id: number,
): Promise<ApiResponse> {
  if (!ports.spamListEntries?.delete) return error(503, 'spam_list_entries_unavailable', 'Spam list entry API nicht konfiguriert');

  const entry = await ports.spamListEntries.delete({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    id,
  });
  if (!entry) return error(404, 'spam_list_entry_not_found', 'Spam list entry nicht gefunden');

  await auditSpamListEntry(ports, principal, 'spam_list_entry.deleted', entry, { pattern: entry.pattern });
  await publishSpamListEntry(ports, principal.workspaceId, 'spam_list_entry.deleted', entry, principal.userId);
  return data(200, { deleted: true, spamListEntry: sanitizeListEntry(entry) });
}

async function handleCreateLearningEvent(
  req: ApiRequest,
  ports: ServerApiPorts,
): Promise<ApiResponse> {
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  if (!ports.spamLearningEvents?.create) {
    return error(503, 'spam_learning_events_unavailable', 'Spam learning event API nicht konfiguriert');
  }

  const parsed = parseSpamLearningEventMutationBody(req.body);
  if (!parsed.ok) return parsed.response;

  const result = await ports.spamLearningEvents.create({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    values: parsed.values,
  });
  if (!result.ok) return spamLearningEventMutationError(result.code);

  const event = result.event;
  await auditSpamLearningEvent(ports, principal, 'spam_learning_event.created', event, {
    label: event.label,
    accountId: event.accountId,
    messageId: event.messageId,
  });
  await publishSpamLearningEvent(ports, principal.workspaceId, 'spam_learning_event.created', event, principal.userId);
  return data(201, sanitizeLearningEvent(event));
}

async function handleCreateDecision(
  req: ApiRequest,
  ports: ServerApiPorts,
): Promise<ApiResponse> {
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  if (!ports.spamDecisions?.create) {
    return error(503, 'spam_decisions_unavailable', 'Spam decision API nicht konfiguriert');
  }

  const parsed = parseSpamDecisionMutationBody(req.body, {
    requireAtLeastOneField: true,
    requireAccountId: true,
    requireScore: true,
    requireStatus: true,
    requireSource: true,
  });
  if (!parsed.ok) return parsed.response;

  const result = await ports.spamDecisions.create({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    values: parsed.values,
  });
  if (!result.ok) return spamDecisionMutationError(result.code);

  const decision = result.decision;
  await auditSpamDecision(ports, principal, 'spam_decision.created', decision, {
    accountId: decision.accountId,
    messageId: decision.messageId,
    score: decision.score,
    status: decision.status,
    source: decision.source,
    hasBreakdown: decision.breakdown !== null,
  });
  await publishSpamDecision(ports, principal.workspaceId, 'spam_decision.created', decision, principal.userId);
  return data(201, sanitizeDecision(decision));
}

async function handleUpdateDecision(
  req: ApiRequest,
  ports: ServerApiPorts,
  principal: AuthenticatedPrincipal,
  id: number,
): Promise<ApiResponse> {
  if (!ports.spamDecisions?.update) {
    return error(503, 'spam_decisions_unavailable', 'Spam decision API nicht konfiguriert');
  }

  const parsed = parseSpamDecisionMutationBody(req.body, {
    requireAtLeastOneField: true,
    requireAccountId: false,
    requireScore: false,
    requireStatus: false,
    requireSource: false,
  });
  if (!parsed.ok) return parsed.response;

  const result = await ports.spamDecisions.update({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    id,
    values: parsed.values,
  });
  if (!result) return error(404, 'spam_decision_not_found', 'Spam decision nicht gefunden');
  if (!result.ok) return spamDecisionMutationError(result.code);

  const decision = result.decision;
  await auditSpamDecision(ports, principal, 'spam_decision.updated', decision, {
    fields: Object.keys(parsed.values).sort(),
    hasBreakdown: decision.breakdown !== null,
  });
  await publishSpamDecision(ports, principal.workspaceId, 'spam_decision.updated', decision, principal.userId);
  return data(200, sanitizeDecision(decision));
}

async function handleDeleteDecision(
  ports: ServerApiPorts,
  principal: AuthenticatedPrincipal,
  id: number,
): Promise<ApiResponse> {
  if (!ports.spamDecisions?.delete) {
    return error(503, 'spam_decisions_unavailable', 'Spam decision API nicht konfiguriert');
  }

  const decision = await ports.spamDecisions.delete({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    id,
  });
  if (!decision) return error(404, 'spam_decision_not_found', 'Spam decision nicht gefunden');

  await auditSpamDecision(ports, principal, 'spam_decision.deleted', decision, {
    accountId: decision.accountId,
    messageId: decision.messageId,
    score: decision.score,
    status: decision.status,
    source: decision.source,
    hasBreakdown: decision.breakdown !== null,
  });
  await publishSpamDecision(ports, principal.workspaceId, 'spam_decision.deleted', decision, principal.userId);
  return data(200, { deleted: true, spamDecision: sanitizeDecision(decision) });
}

function spamListEntryMutationError(code: 'account_not_found' | 'entry_conflict'): ApiResponse {
  if (code === 'account_not_found') return error(404, 'email_account_not_found', 'Email account nicht gefunden');
  return error(409, 'spam_list_entry_conflict', 'Spam list entry existiert bereits');
}

function spamLearningEventMutationError(
  code: 'account_not_found' | 'message_not_found' | 'message_account_mismatch',
): ApiResponse {
  if (code === 'account_not_found') return error(404, 'email_account_not_found', 'Email account nicht gefunden');
  if (code === 'message_not_found') return error(404, 'email_message_not_found', 'Email message nicht gefunden');
  return error(400, 'spam_learning_event_account_mismatch', 'Email message gehoert nicht zum angegebenen Account');
}

function spamDecisionMutationError(
  code: 'account_not_found' | 'message_not_found' | 'message_account_mismatch',
): ApiResponse {
  if (code === 'account_not_found') return error(404, 'email_account_not_found', 'Email account nicht gefunden');
  if (code === 'message_not_found') return error(404, 'email_message_not_found', 'Email message nicht gefunden');
  return error(409, 'spam_decision_message_account_mismatch', 'Email message gehoert nicht zum angegebenen Account');
}

async function auditSpamListEntry(
  ports: ServerApiPorts,
  principal: AuthenticatedPrincipal,
  action: 'spam_list_entry.created' | 'spam_list_entry.updated' | 'spam_list_entry.deleted',
  entry: SpamListEntryRecord,
  metadata: Record<string, unknown>,
): Promise<void> {
  await ports.audit?.record({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    action,
    entityType: 'spam_list_entry',
    entityId: String(entry.id),
    metadata: {
      id: entry.id,
      sourceSqliteId: entry.sourceSqliteId,
      listType: entry.listType,
      patternType: entry.patternType,
      accountId: entry.accountId,
      ...metadata,
    },
  });
}

async function publishSpamListEntry(
  ports: ServerApiPorts,
  workspaceId: string,
  type: 'spam_list_entry.created' | 'spam_list_entry.updated' | 'spam_list_entry.deleted',
  entry: SpamListEntryRecord,
  actorUserId: string,
): Promise<void> {
  await ports.events?.publish({
    type,
    workspaceId,
    entityType: 'spam_list_entry',
    entityId: String(entry.id),
    actorUserId,
    occurredAt: new Date().toISOString(),
    payload: {
      id: entry.id,
      sourceSqliteId: entry.sourceSqliteId,
      listType: entry.listType,
      patternType: entry.patternType,
      pattern: entry.pattern,
      accountId: entry.accountId,
      accountSourceSqliteId: entry.accountSourceSqliteId,
      note: entry.note,
    },
  });
}

async function auditSpamLearningEvent(
  ports: ServerApiPorts,
  principal: AuthenticatedPrincipal,
  action: 'spam_learning_event.created',
  event: SpamLearningEventRecord,
  metadata: Record<string, unknown>,
): Promise<void> {
  await ports.audit?.record({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    action,
    entityType: 'spam_learning_event',
    entityId: String(event.id),
    metadata: {
      id: event.id,
      sourceSqliteId: event.sourceSqliteId,
      ...metadata,
    },
  });
}

async function publishSpamLearningEvent(
  ports: ServerApiPorts,
  workspaceId: string,
  type: 'spam_learning_event.created',
  event: SpamLearningEventRecord,
  actorUserId: string,
): Promise<void> {
  await ports.events?.publish({
    type,
    workspaceId,
    entityType: 'spam_learning_event',
    entityId: String(event.id),
    actorUserId,
    occurredAt: new Date().toISOString(),
    payload: {
      id: event.id,
      sourceSqliteId: event.sourceSqliteId,
      accountId: event.accountId,
      accountSourceSqliteId: event.accountSourceSqliteId,
      messageId: event.messageId,
      messageSourceSqliteId: event.messageSourceSqliteId,
      label: event.label,
      source: event.source,
      featureKeys: event.featureKeys,
    },
  });
}

async function auditSpamDecision(
  ports: ServerApiPorts,
  principal: AuthenticatedPrincipal,
  action: 'spam_decision.created' | 'spam_decision.updated' | 'spam_decision.deleted',
  decision: SpamDecisionRecord,
  metadata: Record<string, unknown>,
): Promise<void> {
  await ports.audit?.record({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    action,
    entityType: 'spam_decision',
    entityId: String(decision.id),
    metadata: {
      id: decision.id,
      sourceSqliteId: decision.sourceSqliteId,
      ...metadata,
    },
  });
}

async function publishSpamDecision(
  ports: ServerApiPorts,
  workspaceId: string,
  type: 'spam_decision.created' | 'spam_decision.updated' | 'spam_decision.deleted',
  decision: SpamDecisionRecord,
  actorUserId: string,
): Promise<void> {
  await ports.events?.publish({
    type,
    workspaceId,
    entityType: 'spam_decision',
    entityId: String(decision.id),
    actorUserId,
    occurredAt: new Date().toISOString(),
    payload: {
      id: decision.id,
      sourceSqliteId: decision.sourceSqliteId,
      accountId: decision.accountId,
      accountSourceSqliteId: decision.accountSourceSqliteId,
      messageId: decision.messageId,
      messageSourceSqliteId: decision.messageSourceSqliteId,
      score: decision.score,
      status: decision.status,
      source: decision.source,
      modelVersion: decision.modelVersion,
      hasBreakdown: decision.breakdown !== null,
    },
  });
}

function sanitizeListEntryList(result: SpamListEntryListResult): SpamListEntryListResult {
  return {
    items: result.items.map(sanitizeListEntry),
    nextCursor: result.nextCursor,
  };
}

function sanitizeListEntry(entry: SpamListEntryRecord): SpamListEntryRecord {
  return {
    id: entry.id,
    sourceSqliteId: entry.sourceSqliteId,
    listType: entry.listType,
    patternType: entry.patternType,
    pattern: entry.pattern,
    accountSourceSqliteId: entry.accountSourceSqliteId,
    accountId: entry.accountId,
    note: entry.note,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  };
}

function sanitizeLearningEventList(result: SpamLearningEventListResult): SpamLearningEventListResult {
  return {
    items: result.items.map(sanitizeLearningEvent),
    nextCursor: result.nextCursor,
  };
}

function sanitizeLearningEvent(event: SpamLearningEventRecord): SpamLearningEventRecord {
  return {
    id: event.id,
    sourceSqliteId: event.sourceSqliteId,
    messageSourceSqliteId: event.messageSourceSqliteId,
    accountSourceSqliteId: event.accountSourceSqliteId,
    messageId: event.messageId,
    accountId: event.accountId,
    label: event.label,
    source: event.source,
    featureKeys: event.featureKeys,
    createdAt: event.createdAt,
    updatedAt: event.updatedAt,
  };
}

function sanitizeDecisionList(result: SpamDecisionListResult): SpamDecisionListResult {
  return {
    items: result.items.map(sanitizeDecision),
    nextCursor: result.nextCursor,
  };
}

function sanitizeDecision(decision: SpamDecisionRecord): SpamDecisionRecord {
  return {
    id: decision.id,
    sourceSqliteId: decision.sourceSqliteId,
    messageSourceSqliteId: decision.messageSourceSqliteId,
    accountSourceSqliteId: decision.accountSourceSqliteId,
    messageId: decision.messageId,
    accountId: decision.accountId,
    score: decision.score,
    status: decision.status,
    source: decision.source,
    breakdown: decision.breakdown,
    modelVersion: decision.modelVersion,
    createdAt: decision.createdAt,
    updatedAt: decision.updatedAt,
  };
}

function sanitizeFeatureStatList(result: SpamFeatureStatListResult): SpamFeatureStatListResult {
  return {
    items: result.items.map(sanitizeFeatureStat),
    nextCursor: result.nextCursor,
  };
}

function sanitizeFeatureStat(stat: SpamFeatureStatRecord): SpamFeatureStatRecord {
  return {
    featureKey: stat.featureKey,
    spamCount: stat.spamCount,
    hamCount: stat.hamCount,
    updatedAt: stat.updatedAt,
  };
}

function parseSpamListEntryMutationBody(
  body: unknown,
  options: {
    requireAtLeastOneField: boolean;
    requireListType: boolean;
    requirePatternType: boolean;
    requirePattern: boolean;
  },
): SpamListEntryMutationParseResult {
  if (!isPlainObject(body)) {
    return {
      ok: false,
      response: error(400, 'invalid_spam_list_entry_payload', 'Spam list entry payload muss ein JSON-Objekt sein'),
    };
  }

  const values: SpamListEntryMutationInput = {};
  const errors: Array<{ field: string; message: string }> = [];
  const allowedFields = new Set(['listType', 'patternType', 'pattern', 'accountId', 'note']);

  for (const key of Object.keys(body)) {
    if (!allowedFields.has(key)) errors.push({ field: key, message: 'Feld ist nicht erlaubt' });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'listType')) {
    const listType = normalizeListTypeBody(body.listType);
    if (listType.ok) values.listType = listType.value;
    else errors.push({ field: 'listType', message: listType.message });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'patternType')) {
    const patternType = normalizePatternTypeBody(body.patternType);
    if (patternType.ok) values.patternType = patternType.value;
    else errors.push({ field: 'patternType', message: patternType.message });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'pattern')) {
    const pattern = normalizeRequiredBodyText(body.pattern, 'pattern', 300);
    if (pattern.ok) values.pattern = pattern.value;
    else errors.push({ field: 'pattern', message: pattern.message });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'accountId')) {
    const accountId = normalizeNullablePositiveBodyInt(body.accountId, 'accountId');
    if (accountId.ok) values.accountId = accountId.value;
    else errors.push({ field: 'accountId', message: accountId.message });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'note')) {
    const note = normalizeNullableBodyText(body.note, 'note', 1000);
    if (note.ok) values.note = note.value;
    else errors.push({ field: 'note', message: note.message });
  }

  if (errors.length > 0) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'Spam list entry payload ist ungueltig', { fields: errors }),
    };
  }
  if (options.requireAtLeastOneField && Object.keys(values).length === 0) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'Spam list entry mutation braucht mindestens ein Feld'),
    };
  }
  if (options.requireListType && values.listType === undefined) {
    return { ok: false, response: error(400, 'validation_error', 'listType ist erforderlich') };
  }
  if (options.requirePatternType && values.patternType === undefined) {
    return { ok: false, response: error(400, 'validation_error', 'patternType ist erforderlich') };
  }
  if (options.requirePattern && values.pattern === undefined) {
    return { ok: false, response: error(400, 'validation_error', 'pattern ist erforderlich') };
  }

  return { ok: true, values };
}

function parseSpamLearningEventMutationBody(body: unknown): SpamLearningEventMutationParseResult {
  if (!isPlainObject(body)) {
    return {
      ok: false,
      response: error(400, 'invalid_spam_learning_event_payload', 'Spam learning event payload muss ein JSON-Objekt sein'),
    };
  }

  const values: SpamLearningEventMutationInput = {};
  const errors: Array<{ field: string; message: string }> = [];
  const allowedFields = new Set(['accountId', 'messageId', 'label', 'source', 'featureKeys']);

  for (const key of Object.keys(body)) {
    if (!allowedFields.has(key)) errors.push({ field: key, message: 'Feld ist nicht erlaubt' });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'accountId')) {
    const accountId = normalizePositiveBodyInt(body.accountId, 'accountId');
    if (accountId.ok) values.accountId = accountId.value;
    else errors.push({ field: 'accountId', message: accountId.message });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'messageId')) {
    const messageId = normalizeNullablePositiveBodyInt(body.messageId, 'messageId');
    if (messageId.ok) values.messageId = messageId.value;
    else errors.push({ field: 'messageId', message: messageId.message });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'label')) {
    const label = normalizeLearningLabelBody(body.label);
    if (label.ok) values.label = label.value;
    else errors.push({ field: 'label', message: label.message });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'source')) {
    const source = normalizeRequiredBodyText(body.source, 'source', 100);
    if (source.ok) values.source = source.value;
    else errors.push({ field: 'source', message: source.message });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'featureKeys')) {
    const featureKeys = normalizeNullableJsonBody(body.featureKeys, 'featureKeys');
    if (featureKeys.ok) values.featureKeys = featureKeys.value;
    else errors.push({ field: 'featureKeys', message: featureKeys.message });
  }

  if (errors.length > 0) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'Spam learning event payload ist ungueltig', { fields: errors }),
    };
  }
  if (values.accountId === undefined) {
    return { ok: false, response: error(400, 'validation_error', 'accountId ist erforderlich') };
  }
  if (values.label === undefined) {
    return { ok: false, response: error(400, 'validation_error', 'label ist erforderlich') };
  }
  if (values.source === undefined) values.source = 'server_api';

  return { ok: true, values };
}

function parseSpamDecisionMutationBody(
  body: unknown,
  options: {
    requireAtLeastOneField: boolean;
    requireAccountId: boolean;
    requireScore: boolean;
    requireStatus: boolean;
    requireSource: boolean;
  },
): SpamDecisionMutationParseResult {
  if (!isPlainObject(body)) {
    return {
      ok: false,
      response: error(400, 'invalid_spam_decision_payload', 'Spam decision payload muss ein JSON-Objekt sein'),
    };
  }

  const values: SpamDecisionMutationInput = {};
  const errors: Array<{ field: string; message: string }> = [];
  const allowedFields = new Set(['accountId', 'messageId', 'score', 'status', 'source', 'breakdown', 'modelVersion']);

  for (const key of Object.keys(body)) {
    if (!allowedFields.has(key)) errors.push({ field: key, message: 'Feld ist nicht erlaubt' });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'accountId')) {
    const accountId = normalizePositiveBodyInt(body.accountId, 'accountId');
    if (accountId.ok) values.accountId = accountId.value;
    else errors.push({ field: 'accountId', message: accountId.message });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'messageId')) {
    const messageId = normalizeNullablePositiveBodyInt(body.messageId, 'messageId');
    if (messageId.ok) values.messageId = messageId.value;
    else errors.push({ field: 'messageId', message: messageId.message });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'score')) {
    const score = normalizeSpamScoreBody(body.score);
    if (score.ok) values.score = score.value;
    else errors.push({ field: 'score', message: score.message });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'status')) {
    const status = normalizeDecisionStatusBody(body.status);
    if (status.ok) values.status = status.value;
    else errors.push({ field: 'status', message: status.message });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'source')) {
    const source = normalizeRequiredBodyText(body.source, 'source', 100);
    if (source.ok) values.source = source.value;
    else errors.push({ field: 'source', message: source.message });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'breakdown')) {
    const breakdown = normalizeNullableJsonContainerBody(body.breakdown, 'breakdown');
    if (breakdown.ok) values.breakdown = breakdown.value;
    else errors.push({ field: 'breakdown', message: breakdown.message });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'modelVersion')) {
    const modelVersion = normalizePositiveBodyInt(body.modelVersion, 'modelVersion');
    if (modelVersion.ok) values.modelVersion = modelVersion.value;
    else errors.push({ field: 'modelVersion', message: modelVersion.message });
  }

  if (errors.length > 0) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'Spam decision payload ist ungueltig', { fields: errors }),
    };
  }
  if (options.requireAtLeastOneField && Object.keys(values).length === 0) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'Spam decision mutation braucht mindestens ein Feld'),
    };
  }
  if (options.requireAccountId && values.accountId === undefined) {
    return { ok: false, response: error(400, 'validation_error', 'accountId ist erforderlich') };
  }
  if (options.requireScore && values.score === undefined) {
    return { ok: false, response: error(400, 'validation_error', 'score ist erforderlich') };
  }
  if (options.requireStatus && values.status === undefined) {
    return { ok: false, response: error(400, 'validation_error', 'status ist erforderlich') };
  }
  if (options.requireSource && values.source === undefined) {
    return { ok: false, response: error(400, 'validation_error', 'source ist erforderlich') };
  }
  if (values.modelVersion === undefined && (options.requireScore || options.requireStatus || options.requireSource)) {
    values.modelVersion = 1;
  }

  return { ok: true, values };
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

function parseListType(value: string | undefined): 'allow' | 'block' | undefined | null {
  if (value === undefined || value === '') return undefined;
  return value === 'allow' || value === 'block' ? value : null;
}

function parsePatternType(value: string | undefined): 'email' | 'domain' | undefined | null {
  if (value === undefined || value === '') return undefined;
  return value === 'email' || value === 'domain' ? value : null;
}

function parseLearningLabel(value: string | undefined): 'spam' | 'ham' | undefined | null {
  if (value === undefined || value === '') return undefined;
  return value === 'spam' || value === 'ham' ? value : null;
}

function parseDecisionStatus(value: string | undefined): 'clean' | 'review' | 'spam' | undefined | null {
  if (value === undefined || value === '') return undefined;
  return value === 'clean' || value === 'review' || value === 'spam' ? value : null;
}

function normalizeListTypeBody(rawValue: unknown): { ok: true; value: 'allow' | 'block' } | { ok: false; message: string } {
  if (typeof rawValue !== 'string') return { ok: false, message: 'listType muss allow oder block sein' };
  const value = rawValue.trim();
  return value === 'allow' || value === 'block'
    ? { ok: true, value }
    : { ok: false, message: 'listType muss allow oder block sein' };
}

function normalizePatternTypeBody(rawValue: unknown): { ok: true; value: 'email' | 'domain' } | { ok: false; message: string } {
  if (typeof rawValue !== 'string') return { ok: false, message: 'patternType muss email oder domain sein' };
  const value = rawValue.trim();
  return value === 'email' || value === 'domain'
    ? { ok: true, value }
    : { ok: false, message: 'patternType muss email oder domain sein' };
}

function normalizeLearningLabelBody(rawValue: unknown): { ok: true; value: 'spam' | 'ham' } | { ok: false; message: string } {
  if (typeof rawValue !== 'string') return { ok: false, message: 'label muss spam oder ham sein' };
  const value = rawValue.trim();
  return value === 'spam' || value === 'ham'
    ? { ok: true, value }
    : { ok: false, message: 'label muss spam oder ham sein' };
}

function normalizeDecisionStatusBody(rawValue: unknown): { ok: true; value: 'clean' | 'review' | 'spam' } | { ok: false; message: string } {
  if (typeof rawValue !== 'string') return { ok: false, message: 'status muss clean, review oder spam sein' };
  const value = rawValue.trim();
  return value === 'clean' || value === 'review' || value === 'spam'
    ? { ok: true, value }
    : { ok: false, message: 'status muss clean, review oder spam sein' };
}

function normalizeSpamScoreBody(rawValue: unknown): { ok: true; value: number } | { ok: false; message: string } {
  const value = typeof rawValue === 'number'
    ? rawValue
    : typeof rawValue === 'string'
      ? Number(rawValue.trim())
      : NaN;
  if (!Number.isSafeInteger(value) || value < 0 || value > 100) {
    return { ok: false, message: 'score muss eine Ganzzahl zwischen 0 und 100 sein' };
  }
  return { ok: true, value };
}

function normalizeRequiredBodyText(
  rawValue: unknown,
  field: string,
  maxLength: number,
): { ok: true; value: string } | { ok: false; message: string } {
  if (typeof rawValue !== 'string') return { ok: false, message: `${field} muss ein String sein` };
  const value = rawValue.trim();
  if (!value) return { ok: false, message: `${field} darf nicht leer sein` };
  if (value.length > maxLength) return { ok: false, message: `${field} darf maximal ${maxLength} Zeichen haben` };
  return { ok: true, value };
}

function normalizeNullableBodyText(
  rawValue: unknown,
  field: string,
  maxLength: number,
): { ok: true; value: string | null } | { ok: false; message: string } {
  if (rawValue === null) return { ok: true, value: null };
  if (typeof rawValue !== 'string') return { ok: false, message: `${field} muss ein String oder null sein` };
  const value = rawValue.trim();
  if (!value) return { ok: true, value: null };
  if (value.length > maxLength) return { ok: false, message: `${field} darf maximal ${maxLength} Zeichen haben` };
  return { ok: true, value };
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

function normalizeNullableJsonBody(
  rawValue: unknown,
  field: string,
): { ok: true; value: unknown | null } | { ok: false; message: string } {
  if (rawValue === null) return { ok: true, value: null };
  return isJsonCompatible(rawValue)
    ? { ok: true, value: rawValue }
    : { ok: false, message: `${field} muss JSON-kompatibel sein` };
}

function normalizeNullableJsonContainerBody(
  rawValue: unknown,
  field: string,
): { ok: true; value: unknown | null } | { ok: false; message: string } {
  if (rawValue === null) return { ok: true, value: null };
  if ((Array.isArray(rawValue) || isPlainObject(rawValue)) && isJsonCompatible(rawValue)) {
    return { ok: true, value: rawValue };
  }
  return { ok: false, message: `${field} muss ein JSON-Objekt, JSON-Array oder null sein` };
}

function normalizeTextFilter(value: string | undefined, maxLength: number): string | undefined | null {
  if (value === undefined) return undefined;
  const normalized = value.trim();
  if (!normalized) return undefined;
  return normalized.length > maxLength ? null : normalized;
}

function decodePathSegment(value: string | undefined): string | null {
  if (value === undefined) return null;
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function resourceErrorName(resource: Exclude<SpamResource, 'featureStats'>): 'spam_list_entry' | 'spam_learning_event' | 'spam_decision' {
  switch (resource) {
    case 'listEntries':
      return 'spam_list_entry';
    case 'learningEvents':
      return 'spam_learning_event';
    case 'decisions':
      return 'spam_decision';
    default:
      return assertNever(resource);
  }
}

function resourceLabel(resource: Exclude<SpamResource, 'featureStats'>): 'Spam list entry' | 'Spam learning event' | 'Spam decision' {
  switch (resource) {
    case 'listEntries':
      return 'Spam list entry';
    case 'learningEvents':
      return 'Spam learning event';
    case 'decisions':
      return 'Spam decision';
    default:
      return assertNever(resource);
  }
}

function isJsonCompatible(value: unknown): boolean {
  if (value === null) return true;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return true;
  if (Array.isArray(value)) return value.every(isJsonCompatible);
  if (isPlainObject(value)) return Object.values(value).every(isJsonCompatible);
  return false;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertNever(value: never): never {
  throw new Error(`Unexpected spam resource: ${value}`);
}
