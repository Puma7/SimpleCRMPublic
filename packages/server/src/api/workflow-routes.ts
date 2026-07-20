import {
  compileGraphToDefinition,
  definitionToJson,
  findOutboundGraphTraps,
  formatOutboundGraphTraps,
  type WorkflowGraphDocument,
  type WorkflowNodeCatalogEntry,
  type WorkflowTemplate,
} from '@simplecrm/core';

import { createHash, timingSafeEqual } from 'node:crypto';

import type {
  AiProfileListResult,
  AiProfileMutationInput,
  AiProfileRecord,
  AiPromptListResult,
  AiPromptMutationInput,
  AiPromptRecord,
  AiPromptReorderItem,
  ApiErrorBody,
  ApiRequest,
  ApiResponse,
  AuthenticatedPrincipal,
  CanonicalApiRoute,
  CanonicalApiRouteRegistration,
  ServerApiPorts,
  WorkflowListResult,
  WorkflowMutationInput,
  WorkflowRecord,
} from './types';
import {
  data,
  error,
  positiveIntFromPath,
  requireCapability,
  requirePrincipal,
} from './http';
import { handleWorkflowRuntimeReadRoute } from './workflow-runtime-routes';
import { isServerWorkflowNodeTypeSupported } from '../workflow-node-catalog';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const WEBHOOK_BODY_JSON_MAX = 64 * 1024;
const WEBHOOK_DEDUP_MS = 5 * 60 * 1000;
const MAX_WEBHOOK_WORKFLOWS = 500;
const WEBHOOK_AUTOMATION_SCOPE = 'workflows';

type WorkflowMailRouteRegistration = Readonly<{
  registration: CanonicalApiRouteRegistration & { source: string };
}>;

function workflowMailRoute(
  path: string,
  methods: CanonicalApiRouteRegistration['methods'],
  pattern: RegExp,
): WorkflowMailRouteRegistration {
  return {
    registration: {
      source: 'workflow-mail-routes',
      path,
      methods,
      pattern,
    },
  };
}

export const WORKFLOW_MAIL_ROUTE_REGISTRATIONS: readonly WorkflowMailRouteRegistration[] = Object.freeze([
  workflowMailRoute('/api/v1/workflows/:id/execute', ['POST'], /^\/api\/v1\/workflows\/([^/]+)\/execute$/),
  workflowMailRoute('/api/v1/workflows/by-source/:sourceId/execute', ['POST'], /^\/api\/v1\/workflows\/by-source\/([^/]+)\/execute$/),
  workflowMailRoute('/api/v1/email/messages/:messageId/workflow-runs', ['GET'], /^\/api\/v1\/email\/messages\/([^/]+)\/workflow-runs$/),
  workflowMailRoute('/api/v1/workflows/:id/runs', ['GET'], /^\/api\/v1\/workflows\/([^/]+)\/runs$/),
  workflowMailRoute('/api/v1/workflows/by-source/:sourceId/runs', ['GET'], /^\/api\/v1\/workflows\/by-source\/([^/]+)\/runs$/),
  workflowMailRoute('/api/v1/workflow-runs', ['GET'], /^\/api\/v1\/workflow-runs$/),
  workflowMailRoute('/api/v1/workflow-runs/:id', ['GET'], /^\/api\/v1\/workflow-runs\/([^/]+)$/),
  workflowMailRoute('/api/v1/workflow-runs/:id/steps', ['GET'], /^\/api\/v1\/workflow-runs\/([^/]+)\/steps$/),
  workflowMailRoute('/api/v1/workflow-runs/by-source/:sourceId', ['GET'], /^\/api\/v1\/workflow-runs\/by-source\/([^/]+)$/),
  workflowMailRoute('/api/v1/workflow-runs/by-source/:sourceId/steps', ['GET'], /^\/api\/v1\/workflow-runs\/by-source\/([^/]+)\/steps$/),
  workflowMailRoute('/api/v1/workflow-run-steps', ['GET'], /^\/api\/v1\/workflow-run-steps$/),
  workflowMailRoute('/api/v1/workflow-run-steps/:id', ['GET'], /^\/api\/v1\/workflow-run-steps\/([^/]+)$/),
  workflowMailRoute('/api/v1/workflow-message-applied', ['GET'], /^\/api\/v1\/workflow-message-applied$/),
  workflowMailRoute('/api/v1/workflow-message-applied/:id', ['GET'], /^\/api\/v1\/workflow-message-applied\/([^/]+)$/),
  workflowMailRoute('/api/v1/workflow-forward-dedup', ['GET'], /^\/api\/v1\/workflow-forward-dedup$/),
  workflowMailRoute('/api/v1/workflow-forward-dedup/:id', ['GET'], /^\/api\/v1\/workflow-forward-dedup\/([^/]+)$/),
  workflowMailRoute('/api/v1/workflow-delayed-jobs', ['GET', 'POST'], /^\/api\/v1\/workflow-delayed-jobs$/),
  workflowMailRoute('/api/v1/workflow-delayed-jobs/:id', ['GET', 'PATCH', 'DELETE'], /^\/api\/v1\/workflow-delayed-jobs\/([^/]+)$/),
]);

export const WORKFLOW_MAIL_ROUTE_INVENTORY: readonly CanonicalApiRoute[] = Object.freeze(
  WORKFLOW_MAIL_ROUTE_REGISTRATIONS.flatMap(({ registration }) => registration.methods.map((method) => ({
    source: registration.source,
    method,
    path: registration.path,
    pattern: registration.pattern,
  }))),
);

type WorkflowReadResource = 'aiProfiles' | 'aiPrompts' | 'workflows';

type AiProfileMutationParseResult =
  | { ok: true; values: AiProfileMutationInput }
  | { ok: false; response: ApiResponse<ApiErrorBody> };

type AiPromptMutationParseResult =
  | { ok: true; values: AiPromptMutationInput }
  | { ok: false; response: ApiResponse<ApiErrorBody> };

type AiPromptReorderParseResult =
  | { ok: true; updates: AiPromptReorderItem[] }
  | { ok: false; response: ApiResponse<ApiErrorBody> };

type AiTextTransformParseResult =
  | {
    ok: true;
    values: {
      promptId?: number;
      text: string;
      contextText?: string;
      targetLanguage?: string;
      customerId?: number | null;
    };
  }
  | { ok: false; response: ApiResponse<ApiErrorBody> };

type WorkflowMutationParseResult =
  | { ok: true; values: WorkflowMutationInput }
  | { ok: false; response: ApiResponse<ApiErrorBody> };

type WorkflowExecuteParseResult =
  | { ok: true; values: { messageId?: number; dryRun?: boolean } }
  | { ok: false; response: ApiResponse<ApiErrorBody> };

type WorkflowInboundBackfillParseResult =
  | { ok: true; values: { limit?: number; clearApplied?: boolean } }
  | { ok: false; response: ApiResponse<ApiErrorBody> };

type WebhookIncomingParseResult =
  | { ok: true; values: { secret?: string; body: Record<string, unknown> } }
  | { ok: false; response: ApiResponse<ApiErrorBody> };

export async function handleWorkflowReadRoute(
  req: ApiRequest,
  ports: ServerApiPorts,
): Promise<ApiResponse | null> {
  const runtime = await handleWorkflowRuntimeReadRoute(req, ports);
  if (runtime) return runtime;

  if (req.path === '/api/v1/workflow/node-catalog') {
    return handleWorkflowNodeCatalogList(req, ports);
  }

  if (req.path === '/api/v1/workflow/templates') {
    return handleWorkflowTemplateList(req, ports);
  }

  if (req.path === '/api/v1/workflow/plugins') {
    return handleWorkflowPluginList(req);
  }

  if (req.path === '/api/v1/workflows/compile-graph') {
    return handleWorkflowGraphCompileRoute(req);
  }

  const aiProfileMatch = /^\/api\/v1\/ai\/profiles(?:\/([^/]+))?$/.exec(req.path);
  if (aiProfileMatch) {
    return aiProfileMatch[1] === undefined
      ? handleListRoute(req, ports, 'aiProfiles')
      : handleGetRoute(req, ports, 'aiProfiles', aiProfileMatch[1]);
  }

  if (req.path === '/api/v1/ai/prompts/reorder') {
    return handleReorderAiPrompts(req, ports);
  }

  if (req.path === '/api/v1/ai/transform-text') {
    return handleAiTextTransform(req, ports);
  }

  const aiPromptMatch = /^\/api\/v1\/ai\/prompts(?:\/([^/]+))?$/.exec(req.path);
  if (aiPromptMatch) {
    return aiPromptMatch[1] === undefined
      ? handleListRoute(req, ports, 'aiPrompts')
      : handleGetRoute(req, ports, 'aiPrompts', aiPromptMatch[1]);
  }

  const workflowBySourceExecuteMatch = /^\/api\/v1\/workflows\/by-source\/([^/]+)\/execute$/.exec(req.path);
  if (workflowBySourceExecuteMatch) {
    return handleWorkflowExecuteBySourceRoute(req, ports, workflowBySourceExecuteMatch[1]);
  }

  if (req.path === '/api/v1/workflows/inbound/backfill') {
    return handleWorkflowInboundBackfillRoute(req, ports);
  }

  const workflowBySourceMatch = /^\/api\/v1\/workflows\/by-source\/([^/]+)$/.exec(req.path);
  if (workflowBySourceMatch) {
    return handleWorkflowBySourceRoute(req, ports, workflowBySourceMatch[1]);
  }

  if (req.path === '/api/v1/workflows/webhook/incoming' || req.path === '/api/v1/webhooks/incoming') {
    return handleWebhookIncomingRoute(req, ports);
  }

  const workflowExecuteMatch = /^\/api\/v1\/workflows\/([^/]+)\/execute$/.exec(req.path);
  if (workflowExecuteMatch) {
    return handleWorkflowExecuteByIdRoute(req, ports, workflowExecuteMatch[1]);
  }

  const workflowMatch = /^\/api\/v1\/workflows(?:\/([^/]+))?$/.exec(req.path);
  if (workflowMatch) {
    return workflowMatch[1] === undefined
      ? handleListRoute(req, ports, 'workflows')
      : handleGetRoute(req, ports, 'workflows', workflowMatch[1]);
  }

  return null;
}

async function handleWorkflowTemplateList(
  req: ApiRequest,
  ports: ServerApiPorts,
): Promise<ApiResponse> {
  if (req.method !== 'GET') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  if (!ports.workflowTemplates) {
    return error(503, 'workflow_templates_unavailable', 'Workflow template API nicht konfiguriert');
  }
  const templates = await ports.workflowTemplates.list({ workspaceId: principal.workspaceId });
  return data(200, templates.map(sanitizeWorkflowTemplate));
}

async function handleWorkflowNodeCatalogList(
  req: ApiRequest,
  ports: ServerApiPorts,
): Promise<ApiResponse> {
  if (req.method !== 'GET') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  if (!ports.workflowNodeCatalog) {
    return error(503, 'workflow_node_catalog_unavailable', 'Workflow node catalog API nicht konfiguriert');
  }
  const catalog = await ports.workflowNodeCatalog.list({ workspaceId: principal.workspaceId });
  return data(200, catalog
    .filter((entry) => entry.runtime !== 'desktop' && isServerWorkflowNodeTypeSupported(entry.type))
    .map(sanitizeWorkflowNodeCatalogEntry));
}

async function handleWorkflowPluginList(req: ApiRequest): Promise<ApiResponse> {
  if (req.method !== 'GET') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  return data(200, []);
}

async function handleWorkflowGraphCompileRoute(req: ApiRequest): Promise<ApiResponse> {
  if (req.method !== 'POST') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;

  try {
    const graph = parseWorkflowGraphCompilePayload(req.body);
    const definition = compileGraphToDefinition(graph);
    const registryOnly = graph.nodes.some(
      (node) =>
        node.type === 'registry'
        || (node.type === 'action' && !isPlainObject(node.data))
        || (node.type === 'action' && !Object.prototype.hasOwnProperty.call(node.data, 'actionType')),
    );
    // Non-fatal: surface outbound "mail trap" problems so the editor can warn
    // live, even though the hard reject happens at create/update time.
    const outboundTraps = findOutboundGraphTraps(graph);
    return data(200, {
      success: true,
      definitionJson: definitionToJson(definition),
      registryOnly,
      ...(outboundTraps.length > 0
        ? { outboundTrapWarning: formatOutboundGraphTraps(outboundTraps) }
        : {}),
    });
  } catch (compileError) {
    return data(200, {
      success: false,
      error: compileError instanceof Error ? compileError.message : String(compileError),
    });
  }
}

async function handleListRoute(
  req: ApiRequest,
  ports: ServerApiPorts,
  resource: WorkflowReadResource,
): Promise<ApiResponse> {
  if (resource === 'aiProfiles' && req.method === 'POST') return handleCreateAiProfile(req, ports);
  if (resource === 'aiPrompts' && req.method === 'POST') return handleCreateAiPrompt(req, ports);
  if (resource === 'workflows' && req.method === 'POST') return handleCreateWorkflow(req, ports);
  if (req.method !== 'GET') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;

  const limit = parseLimit(req.query?.limit);
  if (limit === null) return error(400, 'invalid_limit', `limit muss zwischen 1 und ${MAX_LIMIT} liegen`);

  const cursor = parseOptionalPositiveInt(req.query?.cursor);
  if (cursor === null) return error(400, 'invalid_cursor', 'cursor muss eine positive Ganzzahl sein');

  const search = normalizeTextFilter(req.query?.search, 200);
  if (search === null) return error(400, 'invalid_search', 'search darf maximal 200 Zeichen haben');

  switch (resource) {
    case 'aiProfiles': {
      if (!ports.aiProfiles) return error(503, 'ai_profiles_unavailable', 'AI profile API nicht konfiguriert');
      const result = await ports.aiProfiles.list({
        workspaceId: principal.workspaceId,
        limit,
        ...(cursor === undefined ? {} : { cursor }),
        ...(search === undefined ? {} : { search }),
      });
      return data(200, sanitizeAiProfileList(result));
    }
    case 'aiPrompts': {
      const target = normalizeTextFilter(req.query?.target, 100);
      if (target === null) return error(400, 'invalid_target', 'target darf maximal 100 Zeichen haben');
      const profileId = parseOptionalPositiveInt(req.query?.profileId);
      if (profileId === null) return error(400, 'invalid_profile_id', 'profileId muss eine positive Ganzzahl sein');
      const accountId = parseOptionalPositiveInt(req.query?.accountId);
      if (accountId === null) return error(400, 'invalid_account_id', 'accountId muss eine positive Ganzzahl sein');
      if (!ports.aiPrompts) return error(503, 'ai_prompts_unavailable', 'AI prompt API nicht konfiguriert');
      const result = await ports.aiPrompts.list({
        workspaceId: principal.workspaceId,
        limit,
        ...(cursor === undefined ? {} : { cursor }),
        ...(search === undefined ? {} : { search }),
        ...(target === undefined ? {} : { target }),
        ...(profileId === undefined ? {} : { profileId }),
        ...(accountId === undefined ? {} : { accountId }),
      });
      return data(200, sanitizeAiPromptList(result));
    }
    case 'workflows': {
      const triggerName = normalizeTextFilter(req.query?.triggerName, 100);
      if (triggerName === null) return error(400, 'invalid_trigger_name', 'triggerName darf maximal 100 Zeichen haben');
      const enabled = parseOptionalBoolean(req.query?.enabled);
      if (enabled === null) return error(400, 'invalid_enabled', 'enabled muss true oder false sein');
      const accountId = parseOptionalPositiveInt(req.query?.accountId);
      if (accountId === null) return error(400, 'invalid_account_id', 'accountId muss eine positive Ganzzahl sein');
      if (!ports.workflows) return error(503, 'workflows_unavailable', 'Workflow API nicht konfiguriert');
      const result = await ports.workflows.list({
        workspaceId: principal.workspaceId,
        limit,
        ...(cursor === undefined ? {} : { cursor }),
        ...(search === undefined ? {} : { search }),
        ...(triggerName === undefined ? {} : { triggerName }),
        ...(enabled === undefined ? {} : { enabled }),
        ...(accountId === undefined ? {} : { accountId }),
      });
      return data(200, sanitizeWorkflowList(result));
    }
    default:
      return assertNever(resource);
  }
}

async function handleGetRoute(
  req: ApiRequest,
  ports: ServerApiPorts,
  resource: WorkflowReadResource,
  rawId: string | undefined,
): Promise<ApiResponse> {
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  const id = positiveIntFromPath(rawId);
  if (id === null) return error(400, `invalid_${resourceErrorName(resource)}_id`, `${resourceLabel(resource)} id muss eine positive Ganzzahl sein`);
  if (resource === 'aiProfiles' && req.method === 'PATCH') return handleUpdateAiProfile(req, ports, principal, id);
  if (resource === 'aiProfiles' && req.method === 'DELETE') return handleDeleteAiProfile(ports, principal, id);
  if (resource === 'aiPrompts' && req.method === 'PATCH') return handleUpdateAiPrompt(req, ports, principal, id);
  if (resource === 'aiPrompts' && req.method === 'DELETE') return handleDeleteAiPrompt(ports, principal, id);
  if (resource === 'workflows' && req.method === 'PATCH') return handleUpdateWorkflow(req, ports, principal, id);
  if (resource === 'workflows' && req.method === 'DELETE') return handleDeleteWorkflow(ports, principal, id);
  if (req.method !== 'GET') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');

  switch (resource) {
    case 'aiProfiles': {
      if (!ports.aiProfiles) return error(503, 'ai_profiles_unavailable', 'AI profile API nicht konfiguriert');
      const profile = await ports.aiProfiles.get({ workspaceId: principal.workspaceId, id });
      return profile ? data(200, sanitizeAiProfile(profile)) : error(404, 'ai_profile_not_found', 'AI profile nicht gefunden');
    }
    case 'aiPrompts': {
      if (!ports.aiPrompts) return error(503, 'ai_prompts_unavailable', 'AI prompt API nicht konfiguriert');
      const prompt = await ports.aiPrompts.get({ workspaceId: principal.workspaceId, id });
      return prompt ? data(200, sanitizeAiPrompt(prompt)) : error(404, 'ai_prompt_not_found', 'AI prompt nicht gefunden');
    }
    case 'workflows': {
      if (!ports.workflows) return error(503, 'workflows_unavailable', 'Workflow API nicht konfiguriert');
      const workflow = await ports.workflows.get({ workspaceId: principal.workspaceId, id });
      return workflow ? data(200, sanitizeWorkflow(workflow)) : error(404, 'workflow_not_found', 'Workflow nicht gefunden');
    }
    default:
      return assertNever(resource);
  }
}

async function handleWorkflowBySourceRoute(
  req: ApiRequest,
  ports: ServerApiPorts,
  rawSourceSqliteId: string | undefined,
): Promise<ApiResponse> {
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  const sourceSqliteId = parseNonZeroInt(rawSourceSqliteId);
  if (sourceSqliteId === null) {
    return error(400, 'invalid_workflow_source_sqlite_id', 'Workflow sourceSqliteId muss eine Ganzzahl ungleich 0 sein');
  }
  if (!ports.workflows) return error(503, 'workflows_unavailable', 'Workflow API nicht konfiguriert');

  const workflow = await findWorkflowBySourceSqliteId(ports, principal.workspaceId, sourceSqliteId);
  if (req.method === 'PATCH') {
    return workflow
      ? handleUpdateWorkflow(req, ports, principal, workflow.id)
      : error(404, 'workflow_not_found', 'Workflow nicht gefunden');
  }
  if (req.method === 'DELETE') {
    return workflow
      ? handleDeleteWorkflow(ports, principal, workflow.id)
      : error(404, 'workflow_not_found', 'Workflow nicht gefunden');
  }
  if (req.method !== 'GET') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
  return data(200, workflow ? sanitizeWorkflow(workflow) : null);
}

async function handleWorkflowExecuteBySourceRoute(
  req: ApiRequest,
  ports: ServerApiPorts,
  rawSourceSqliteId: string | undefined,
): Promise<ApiResponse> {
  if (req.method !== 'POST') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  const sourceSqliteId = parseNonZeroInt(rawSourceSqliteId);
  if (sourceSqliteId === null) {
    return error(400, 'invalid_workflow_source_sqlite_id', 'Workflow sourceSqliteId muss eine Ganzzahl ungleich 0 sein');
  }
  if (!ports.workflows) return error(503, 'workflows_unavailable', 'Workflow API nicht konfiguriert');
  const workflow = await findWorkflowBySourceSqliteId(ports, principal.workspaceId, sourceSqliteId);
  return workflow
    ? handleWorkflowExecute(req, ports, principal, workflow)
    : error(404, 'workflow_not_found', 'Workflow nicht gefunden');
}

async function handleWorkflowExecuteByIdRoute(
  req: ApiRequest,
  ports: ServerApiPorts,
  rawId: string | undefined,
): Promise<ApiResponse> {
  if (req.method !== 'POST') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  const workflowId = positiveIntFromPath(rawId);
  if (workflowId === null) return error(400, 'invalid_workflow_id', 'Workflow id muss eine positive Ganzzahl sein');
  if (!ports.workflows) return error(503, 'workflows_unavailable', 'Workflow API nicht konfiguriert');
  const workflow = await ports.workflows.get({ workspaceId: principal.workspaceId, id: workflowId });
  return workflow
    ? handleWorkflowExecute(req, ports, principal, workflow)
    : error(404, 'workflow_not_found', 'Workflow nicht gefunden');
}

async function handleWorkflowExecute(
  req: ApiRequest,
  ports: ServerApiPorts,
  principal: AuthenticatedPrincipal,
  workflow: WorkflowRecord,
): Promise<ApiResponse> {
  const parsed = parseWorkflowExecuteBody(req.body);
  if (!parsed.ok) return parsed.response;

  const messageId = parsed.values.messageId;
  if (messageId !== undefined) {
    if (!ports.emailMessages) return error(503, 'email_messages_unavailable', 'Email message API nicht konfiguriert');
    const message = await ports.emailMessages.get({
      workspaceId: principal.workspaceId,
      id: messageId,
      includeBody: false,
    });
    if (!message) return error(404, 'email_message_not_found', 'Email message nicht gefunden');
  }

  const dryRun = parsed.values.dryRun !== false;
  if (!dryRun && !requireCapability(principal, 'workflows.manage')) {
    return error(403, 'forbidden', 'Live-Ausführung erfordert Adminrechte oder Workflow-Berechtigung');
  }

  if (dryRun) {
    if (!ports.workflowExecution?.dryRun) {
      return error(503, 'workflow_dry_run_unavailable', 'Workflow Dry-Run API nicht konfiguriert');
    }
    const result = await ports.workflowExecution.dryRun({
      workspaceId: principal.workspaceId,
      workflowId: workflow.id,
      ...(messageId === undefined ? {} : { messageId }),
      triggerName: 'manual',
      actorUserId: principal.userId,
      context: {},
    });
    return data(result.success ? 200 : 409, {
      ...result,
      workflowId: workflow.sourceSqliteId ?? workflow.id,
    });
  }

  if (!ports.jobQueue) return error(503, 'job_queue_unavailable', 'Job queue API nicht konfiguriert');
  await ports.jobQueue.enqueue({
    workspaceId: principal.workspaceId,
    type: 'workflow.execute',
    payload: {
      workspaceId: principal.workspaceId,
      workflowId: workflow.id,
      ...(messageId === undefined ? {} : { messageId }),
      triggerName: 'manual',
      actorUserId: principal.userId,
      context: {},
    },
  });

  return data(202, {
    success: true,
    queued: true,
    status: 'queued',
    workflowId: workflow.sourceSqliteId ?? workflow.id,
    ...(messageId === undefined ? {} : { messageId }),
  });
}

async function handleWorkflowInboundBackfillRoute(
  req: ApiRequest,
  ports: ServerApiPorts,
): Promise<ApiResponse> {
  if (req.method !== 'POST') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  if (!ports.workflowInboundBackfill) {
    return error(503, 'workflow_backfill_unavailable', 'Workflow Backfill API nicht konfiguriert');
  }

  const parsed = parseWorkflowInboundBackfillBody(req.body);
  if (!parsed.ok) return parsed.response;

  const result = await ports.workflowInboundBackfill.backfill({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    ...parsed.values,
  });
  return data(202, result);
}

async function handleWebhookIncomingRoute(
  req: ApiRequest,
  ports: ServerApiPorts,
): Promise<ApiResponse> {
  if (req.method !== 'POST') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  if (!ports.syncInfo) return error(503, 'sync_info_unavailable', 'Sync-info API nicht konfiguriert');
  if (!ports.workflows) return error(503, 'workflows_unavailable', 'Workflow API nicht konfiguriert');
  if (!ports.jobQueue) return error(503, 'job_queue_unavailable', 'Job queue API nicht konfiguriert');

  const parsed = parseWebhookIncomingBody(req.body);
  if (!parsed.ok) return parsed.response;

  const bodyJson = serializeWebhookBodyForWorkflow(parsed.values.body);
  const dedupeKey = `webhook_dedup:${webhookPayloadHash(bodyJson)}`;
  const automationKeyAuthenticated = isAutomationApiKeyPrincipal(principal);
  if (automationKeyAuthenticated && !automationPrincipalCanTriggerWebhook(principal)) {
    return error(403, 'automation_scope_required', 'Automation API key benoetigt den workflows-Scope');
  }
  const syncRows = await ports.syncInfo.getMany({
    workspaceId: principal.workspaceId,
    keys: automationKeyAuthenticated ? [dedupeKey] : ['email_webhook_secret', dedupeKey],
  });
  const syncValues = new Map(syncRows.map((row) => [row.key, row.value]));
  if (!automationKeyAuthenticated) {
    const expectedSecret = syncValues.get('email_webhook_secret')?.trim() ?? '';
    if (!parsed.values.secret || !expectedSecret || !webhookSecretMatches(parsed.values.secret, expectedSecret)) {
      return data(200, { success: false, error: 'Ungueltiges Webhook-Secret', fired: 0 });
    }
  }

  const nowMs = Date.now();
  const dedupeRaw = syncValues.get(dedupeKey);
  const dedupeAt = dedupeRaw == null ? NaN : Number(dedupeRaw);
  if (!Number.isNaN(dedupeAt) && nowMs - dedupeAt < WEBHOOK_DEDUP_MS) {
    return data(200, { success: true, fired: 0, deduplicated: true });
  }
  let fired = 0;
  let cursor: number | undefined;
  do {
    const result = await ports.workflows.list({
      workspaceId: principal.workspaceId,
      triggerName: 'webhook.incoming',
      enabled: true,
      limit: MAX_LIMIT,
      ...(cursor === undefined ? {} : { cursor }),
    });
    for (const workflow of result.items) {
      if (!workflow.enabled || workflow.triggerName !== 'webhook.incoming') continue;
      await ports.jobQueue.enqueue({
        workspaceId: principal.workspaceId,
        type: 'workflow.execute',
        payload: {
          workspaceId: principal.workspaceId,
          workflowId: workflow.id,
          triggerName: 'webhook.incoming',
          actorUserId: principal.userId,
          context: buildWebhookWorkflowContext(bodyJson),
        },
      });
      fired += 1;
      if (fired >= MAX_WEBHOOK_WORKFLOWS) break;
    }
    cursor = result.nextCursor ?? undefined;
  } while (cursor !== undefined && fired < MAX_WEBHOOK_WORKFLOWS);

  await ports.syncInfo.setMany({
    workspaceId: principal.workspaceId,
    values: { [dedupeKey]: String(Date.now()) },
  });

  return data(202, {
    success: true,
    queued: true,
    fired,
  });
}

async function handleCreateAiProfile(
  req: ApiRequest,
  ports: ServerApiPorts,
): Promise<ApiResponse> {
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  if (!ports.aiProfiles?.create) return error(503, 'ai_profiles_unavailable', 'AI profile API nicht konfiguriert');

  const parsed = parseAiProfileMutationBody(req.body, {
    requireAtLeastOneField: true,
    requireLabel: true,
    requireProvider: true,
    requireBaseUrl: true,
    requireModel: true,
  });
  if (!parsed.ok) return parsed.response;

  const result = await ports.aiProfiles.create({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    values: parsed.values,
  });
  if (!result.ok) return aiProfileMutationError(result.code);

  const profile = result.profile;
  await auditAiProfile(ports, principal, 'ai_profile.created', profile, { label: profile.label });
  await publishAiProfile(ports, principal.workspaceId, 'ai_profile.created', profile, principal.userId);
  return data(201, sanitizeAiProfile(profile));
}

async function handleUpdateAiProfile(
  req: ApiRequest,
  ports: ServerApiPorts,
  principal: AuthenticatedPrincipal,
  id: number,
): Promise<ApiResponse> {
  if (!ports.aiProfiles?.update) return error(503, 'ai_profiles_unavailable', 'AI profile API nicht konfiguriert');

  const parsed = parseAiProfileMutationBody(req.body, {
    requireAtLeastOneField: true,
    requireLabel: false,
    requireProvider: false,
    requireBaseUrl: false,
    requireModel: false,
  });
  if (!parsed.ok) return parsed.response;

  const result = await ports.aiProfiles.update({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    id,
    values: parsed.values,
  });
  if (!result) return error(404, 'ai_profile_not_found', 'AI profile nicht gefunden');
  if (!result.ok) return aiProfileMutationError(result.code);

  const profile = result.profile;
  await auditAiProfile(ports, principal, 'ai_profile.updated', profile, {
    fields: Object.keys(parsed.values).sort(),
  });
  await publishAiProfile(ports, principal.workspaceId, 'ai_profile.updated', profile, principal.userId);
  return data(200, sanitizeAiProfile(profile));
}

async function handleDeleteAiProfile(
  ports: ServerApiPorts,
  principal: AuthenticatedPrincipal,
  id: number,
): Promise<ApiResponse> {
  if (!ports.aiProfiles?.delete) return error(503, 'ai_profiles_unavailable', 'AI profile API nicht konfiguriert');

  const profile = await ports.aiProfiles.delete({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    id,
  });
  if (!profile) return error(404, 'ai_profile_not_found', 'AI profile nicht gefunden');
  if (!profile.ok) return aiProfileMutationError(profile.code);

  await auditAiProfile(ports, principal, 'ai_profile.deleted', profile.profile, { label: profile.profile.label });
  await publishAiProfile(ports, principal.workspaceId, 'ai_profile.deleted', profile.profile, principal.userId);
  return data(200, { deleted: true, aiProfile: sanitizeAiProfile(profile.profile) });
}

function aiProfileMutationError(code: 'secret_port_unavailable'): ApiResponse {
  switch (code) {
    case 'secret_port_unavailable':
      return error(503, 'ai_profile_secret_unavailable', 'AI profile secret storage ist nicht konfiguriert');
    default:
      return assertNever(code);
  }
}

async function handleCreateAiPrompt(
  req: ApiRequest,
  ports: ServerApiPorts,
): Promise<ApiResponse> {
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  if (!ports.aiPrompts?.create) return error(503, 'ai_prompts_unavailable', 'AI prompt API nicht konfiguriert');

  const parsed = parseAiPromptMutationBody(req.body, {
    requireAtLeastOneField: true,
    requireLabel: true,
    requireUserTemplate: true,
    requireTarget: true,
  });
  if (!parsed.ok) return parsed.response;

  const result = await ports.aiPrompts.create({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    values: parsed.values,
  });
  if (!result.ok) return aiPromptMutationError(result.code);

  const prompt = result.prompt;
  await auditAiPrompt(ports, principal, 'ai_prompt.created', prompt, { label: prompt.label });
  await publishAiPrompt(ports, principal.workspaceId, 'ai_prompt.created', prompt, principal.userId);
  return data(201, sanitizeAiPrompt(prompt));
}

async function handleUpdateAiPrompt(
  req: ApiRequest,
  ports: ServerApiPorts,
  principal: AuthenticatedPrincipal,
  id: number,
): Promise<ApiResponse> {
  if (!ports.aiPrompts?.update) return error(503, 'ai_prompts_unavailable', 'AI prompt API nicht konfiguriert');

  const parsed = parseAiPromptMutationBody(req.body, {
    requireAtLeastOneField: true,
    requireLabel: false,
    requireUserTemplate: false,
    requireTarget: false,
  });
  if (!parsed.ok) return parsed.response;

  const result = await ports.aiPrompts.update({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    id,
    values: parsed.values,
  });
  if (!result) return error(404, 'ai_prompt_not_found', 'AI prompt nicht gefunden');
  if (!result.ok) return aiPromptMutationError(result.code);

  const prompt = result.prompt;
  await auditAiPrompt(ports, principal, 'ai_prompt.updated', prompt, {
    fields: Object.keys(parsed.values).sort(),
  });
  await publishAiPrompt(ports, principal.workspaceId, 'ai_prompt.updated', prompt, principal.userId);
  return data(200, sanitizeAiPrompt(prompt));
}

async function handleAiTextTransform(
  req: ApiRequest,
  ports: ServerApiPorts,
): Promise<ApiResponse> {
  if (req.method !== 'POST') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  if (!ports.aiTextTransform) return error(503, 'ai_text_transform_unavailable', 'AI text transform API nicht konfiguriert');

  const parsed = parseAiTextTransformBody(req.body);
  if (!parsed.ok) return parsed.response;

  const result = await ports.aiTextTransform.transformText({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    ...parsed.values,
  });
  return data(200, result);
}

async function handleReorderAiPrompts(
  req: ApiRequest,
  ports: ServerApiPorts,
): Promise<ApiResponse> {
  if (req.method !== 'POST') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  if (!ports.aiPrompts?.reorder) return error(503, 'ai_prompts_unavailable', 'AI prompt API nicht konfiguriert');

  const parsed = parseAiPromptReorderBody(req.body);
  if (!parsed.ok) return parsed.response;

  const result = await ports.aiPrompts.reorder({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    updates: parsed.updates,
  });
  if (!result.ok) return error(404, 'ai_prompt_not_found', 'AI prompt nicht gefunden');

  for (const prompt of result.prompts) {
    await auditAiPrompt(ports, principal, 'ai_prompt.updated', prompt, {
      fields: ['sortOrder'],
      source: 'bulk_reorder',
    });
    await publishAiPrompt(ports, principal.workspaceId, 'ai_prompt.updated', prompt, principal.userId);
  }
  return data(200, { success: true, items: result.prompts.map(sanitizeAiPrompt) });
}

async function handleDeleteAiPrompt(
  ports: ServerApiPorts,
  principal: AuthenticatedPrincipal,
  id: number,
): Promise<ApiResponse> {
  if (!ports.aiPrompts?.delete) return error(503, 'ai_prompts_unavailable', 'AI prompt API nicht konfiguriert');

  const prompt = await ports.aiPrompts.delete({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    id,
  });
  if (!prompt) return error(404, 'ai_prompt_not_found', 'AI prompt nicht gefunden');

  await auditAiPrompt(ports, principal, 'ai_prompt.deleted', prompt, { label: prompt.label });
  await publishAiPrompt(ports, principal.workspaceId, 'ai_prompt.deleted', prompt, principal.userId);
  return data(200, { deleted: true, aiPrompt: sanitizeAiPrompt(prompt) });
}

/**
 * Reject an outbound workflow that, once ENABLED, would silently trap clean
 * mail. Outbound review selects workflows by the stored `trigger_name` and
 * holds every draft before executing them, so a workflow is only safe if — as
 * an enabled outbound workflow — it can actually release the draft:
 *  - a `compiled` execution mode is unsupported by the server runtime (it
 *    returns blocked before parsing the graph) → always traps;
 *  - no graph at all → the run never reaches a release/send node → always traps;
 *  - a graph whose reachable paths don't all release → traps (findOutboundGraphTraps).
 *
 * All inputs are the EFFECTIVE post-mutation values. A non-outbound or disabled
 * workflow can't be selected by review, so it is never rejected.
 */
function outboundWorkflowGuardError(input: {
  graph: unknown;
  triggerName: string | undefined;
  enabled: boolean | undefined;
  executionMode: string | null | undefined;
}): ApiResponse | null {
  if (input.triggerName !== 'outbound') return null;
  if (input.enabled === false) return null;
  if ((input.executionMode ?? 'graph') === 'compiled') {
    return error(
      422,
      'outbound_workflow_traps_mail',
      'Aktiver Ausgangs-Workflow im „compiled"-Modus wird serverseitig nicht ausgeführt und hält ' +
        'jede Mail dauerhaft. Bitte auf den Graph-Modus umstellen.',
    );
  }
  if (!input.graph || typeof input.graph !== 'object') {
    return error(
      422,
      'outbound_workflow_traps_mail',
      'Aktiver Ausgangs-Workflow ohne Graph hält jede Mail dauerhaft. Bitte einen Graph mit ' +
        'Freigabe-Knoten (email.release_outbound mit autoSend=true) hinterlegen.',
    );
  }
  const issues = findOutboundGraphTraps(input.graph as WorkflowGraphDocument, {
    effectiveTrigger: 'outbound',
  });
  if (issues.length === 0) return null;
  return error(422, 'outbound_workflow_traps_mail', formatOutboundGraphTraps(issues));
}

async function handleCreateWorkflow(
  req: ApiRequest,
  ports: ServerApiPorts,
): Promise<ApiResponse> {
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  if (!ports.workflows?.create) return error(503, 'workflows_unavailable', 'Workflow API nicht konfiguriert');

  const parsed = parseWorkflowMutationBody(req.body, {
    requireAtLeastOneField: true,
    requireName: true,
    requireTriggerName: true,
    requireDefinition: true,
  });
  if (!parsed.ok) return parsed.response;

  // New workflows default to enabled=true (postgres-workflow-read-ports), so an
  // outbound workflow is live immediately — validate its effective state.
  const trap = outboundWorkflowGuardError({
    graph: parsed.values.graph,
    triggerName: parsed.values.triggerName,
    enabled: parsed.values.enabled ?? true,
    executionMode: parsed.values.executionMode,
  });
  if (trap) return trap;

  const result = await ports.workflows.create({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    values: parsed.values,
  });
  if (!result.ok) return workflowMutationError(result.code);

  const workflow = result.workflow;
  await auditWorkflow(ports, principal, 'workflow.created', workflow, { name: workflow.name });
  await publishWorkflow(ports, principal.workspaceId, 'workflow.created', workflow, principal.userId);
  return data(201, sanitizeWorkflow(workflow));
}

async function handleUpdateWorkflow(
  req: ApiRequest,
  ports: ServerApiPorts,
  principal: AuthenticatedPrincipal,
  id: number,
): Promise<ApiResponse> {
  if (!ports.workflows?.update) return error(503, 'workflows_unavailable', 'Workflow API nicht konfiguriert');

  const parsed = parseWorkflowMutationBody(req.body, {
    requireAtLeastOneField: true,
    requireName: false,
    requireTriggerName: false,
    requireDefinition: false,
  });
  if (!parsed.ok) return parsed.response;

  // Validate the EFFECTIVE post-patch state. Any patch that touches trigger,
  // enabled, graph, or execution mode can turn the workflow into (or keep it as)
  // a live outbound workflow, so resolve the fields the patch omits from the
  // stored row and guard the merged result. This catches re-enabling, switching
  // the trigger to outbound, and compiled/no-graph outbound workflows.
  const patchTouchesOutbound =
    parsed.values.triggerName !== undefined ||
    parsed.values.enabled !== undefined ||
    parsed.values.graph !== undefined ||
    parsed.values.executionMode !== undefined;
  if (patchTouchesOutbound) {
    const existing = ports.workflows.get
      ? await ports.workflows.get({ workspaceId: principal.workspaceId, id })
      : null;
    const trap = outboundWorkflowGuardError({
      graph: parsed.values.graph !== undefined ? parsed.values.graph : existing?.graph ?? null,
      triggerName: parsed.values.triggerName ?? existing?.triggerName,
      enabled: parsed.values.enabled ?? existing?.enabled,
      executionMode: parsed.values.executionMode ?? existing?.executionMode,
    });
    if (trap) return trap;
  }

  const result = await ports.workflows.update({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    id,
    values: parsed.values,
  });
  if (!result) return error(404, 'workflow_not_found', 'Workflow nicht gefunden');
  if (!result.ok) return workflowMutationError(result.code);

  const workflow = result.workflow;
  await auditWorkflow(ports, principal, 'workflow.updated', workflow, {
    fields: Object.keys(parsed.values).sort(),
  });
  await publishWorkflow(ports, principal.workspaceId, 'workflow.updated', workflow, principal.userId);
  return data(200, sanitizeWorkflow(workflow));
}

async function handleDeleteWorkflow(
  ports: ServerApiPorts,
  principal: AuthenticatedPrincipal,
  id: number,
): Promise<ApiResponse> {
  if (!ports.workflows?.delete) return error(503, 'workflows_unavailable', 'Workflow API nicht konfiguriert');

  const workflow = await ports.workflows.delete({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    id,
  });
  if (!workflow) return error(404, 'workflow_not_found', 'Workflow nicht gefunden');

  await auditWorkflow(ports, principal, 'workflow.deleted', workflow, { name: workflow.name });
  await publishWorkflow(ports, principal.workspaceId, 'workflow.deleted', workflow, principal.userId);
  return data(200, { deleted: true, workflow: sanitizeWorkflow(workflow) });
}

function workflowMutationError(code: 'schedule_account_not_found'): ApiResponse {
  return error(404, 'email_account_not_found', 'Email account nicht gefunden');
}

async function findWorkflowBySourceSqliteId(
  ports: ServerApiPorts,
  workspaceId: string,
  sourceSqliteId: number,
): Promise<WorkflowRecord | null> {
  let cursor: number | undefined;
  const seenCursors = new Set<number>();
  for (;;) {
    const page = await ports.workflows!.list({
      workspaceId,
      limit: MAX_LIMIT,
      ...(cursor === undefined ? {} : { cursor }),
    });
    const found = page.items.find((workflow) => workflow.sourceSqliteId === sourceSqliteId);
    if (found) return found;
    if (page.nextCursor === null) return null;
    if (seenCursors.has(page.nextCursor)) return null;
    seenCursors.add(page.nextCursor);
    cursor = page.nextCursor;
  }
}

async function auditAiProfile(
  ports: ServerApiPorts,
  principal: AuthenticatedPrincipal,
  action: 'ai_profile.created' | 'ai_profile.updated' | 'ai_profile.deleted',
  profile: AiProfileRecord,
  metadata: Record<string, unknown>,
): Promise<void> {
  await ports.audit?.record({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    action,
    entityType: 'ai_profile',
    entityId: String(profile.id),
    metadata: {
      id: profile.id,
      sourceSqliteId: profile.sourceSqliteId,
      provider: profile.provider,
      model: profile.model,
      isDefault: profile.isDefault,
      apiKeyConfigured: profile.apiKeyConfigured,
      ...metadata,
    },
  });
}

async function publishAiProfile(
  ports: ServerApiPorts,
  workspaceId: string,
  type: 'ai_profile.created' | 'ai_profile.updated' | 'ai_profile.deleted',
  profile: AiProfileRecord,
  actorUserId: string,
): Promise<void> {
  await ports.events?.publish({
    type,
    workspaceId,
    entityType: 'ai_profile',
    entityId: String(profile.id),
    actorUserId,
    occurredAt: new Date().toISOString(),
    payload: {
      id: profile.id,
      sourceSqliteId: profile.sourceSqliteId,
      label: profile.label,
      provider: profile.provider,
      baseUrl: profile.baseUrl,
      model: profile.model,
      embeddingModel: profile.embeddingModel,
      isDefault: profile.isDefault,
      sortOrder: profile.sortOrder,
      apiKeyConfigured: profile.apiKeyConfigured,
    },
  });
}

async function auditWorkflow(
  ports: ServerApiPorts,
  principal: AuthenticatedPrincipal,
  action: 'workflow.created' | 'workflow.updated' | 'workflow.deleted',
  workflow: WorkflowRecord,
  metadata: Record<string, unknown>,
): Promise<void> {
  await ports.audit?.record({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    action,
    entityType: 'workflow',
    entityId: String(workflow.id),
    metadata: {
      id: workflow.id,
      sourceSqliteId: workflow.sourceSqliteId,
      triggerName: workflow.triggerName,
      enabled: workflow.enabled,
      priority: workflow.priority,
      ...metadata,
    },
  });
}

async function publishWorkflow(
  ports: ServerApiPorts,
  workspaceId: string,
  type: 'workflow.created' | 'workflow.updated' | 'workflow.deleted',
  workflow: WorkflowRecord,
  actorUserId: string,
): Promise<void> {
  await ports.events?.publish({
    type,
    workspaceId,
    entityType: 'workflow',
    entityId: String(workflow.id),
    actorUserId,
    occurredAt: new Date().toISOString(),
    payload: {
      id: workflow.id,
      sourceSqliteId: workflow.sourceSqliteId,
      name: workflow.name,
      triggerName: workflow.triggerName,
      enabled: workflow.enabled,
      priority: workflow.priority,
      scheduleAccountId: workflow.scheduleAccountId,
      executionMode: workflow.executionMode,
      engineVersion: workflow.engineVersion,
    },
  });
}

function aiPromptMutationError(code: 'profile_not_found'): ApiResponse {
  return error(404, 'ai_profile_not_found', 'AI profile nicht gefunden');
}

async function auditAiPrompt(
  ports: ServerApiPorts,
  principal: AuthenticatedPrincipal,
  action: 'ai_prompt.created' | 'ai_prompt.updated' | 'ai_prompt.deleted',
  prompt: AiPromptRecord,
  metadata: Record<string, unknown>,
): Promise<void> {
  await ports.audit?.record({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    action,
    entityType: 'ai_prompt',
    entityId: String(prompt.id),
    metadata: {
      id: prompt.id,
      sourceSqliteId: prompt.sourceSqliteId,
      target: prompt.target,
      profileId: prompt.profileId,
      ...metadata,
    },
  });
}

async function publishAiPrompt(
  ports: ServerApiPorts,
  workspaceId: string,
  type: 'ai_prompt.created' | 'ai_prompt.updated' | 'ai_prompt.deleted',
  prompt: AiPromptRecord,
  actorUserId: string,
): Promise<void> {
  await ports.events?.publish({
    type,
    workspaceId,
    entityType: 'ai_prompt',
    entityId: String(prompt.id),
    actorUserId,
    occurredAt: new Date().toISOString(),
    payload: {
      id: prompt.id,
      sourceSqliteId: prompt.sourceSqliteId,
      label: prompt.label,
      target: prompt.target,
      profileId: prompt.profileId,
      profileSourceSqliteId: prompt.profileSourceSqliteId,
      sortOrder: prompt.sortOrder,
    },
  });
}

function sanitizeAiProfileList(result: AiProfileListResult): AiProfileListResult {
  return {
    items: result.items.map(sanitizeAiProfile),
    nextCursor: result.nextCursor,
  };
}

function sanitizeAiProfile(profile: AiProfileRecord): AiProfileRecord {
  return {
    id: profile.id,
    sourceSqliteId: profile.sourceSqliteId,
    label: profile.label,
    provider: profile.provider,
    baseUrl: profile.baseUrl,
    model: profile.model,
    embeddingModel: profile.embeddingModel,
    isDefault: profile.isDefault,
    sortOrder: profile.sortOrder,
    apiKeyConfigured: profile.apiKeyConfigured,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
  };
}

function sanitizeAiPromptList(result: AiPromptListResult): AiPromptListResult {
  return {
    items: result.items.map(sanitizeAiPrompt),
    nextCursor: result.nextCursor,
  };
}

function sanitizeAiPrompt(prompt: AiPromptRecord): AiPromptRecord {
  return {
    id: prompt.id,
    sourceSqliteId: prompt.sourceSqliteId,
    label: prompt.label,
    userTemplate: prompt.userTemplate,
    target: prompt.target,
    profileSourceSqliteId: prompt.profileSourceSqliteId,
    profileId: prompt.profileId,
    accountSourceSqliteId: prompt.accountSourceSqliteId,
    accountId: prompt.accountId,
    overrideKey: prompt.overrideKey,
    sortOrder: prompt.sortOrder,
    createdAt: prompt.createdAt,
    updatedAt: prompt.updatedAt,
  };
}

function sanitizeWorkflowList(result: WorkflowListResult): WorkflowListResult {
  return {
    items: result.items.map(sanitizeWorkflow),
    nextCursor: result.nextCursor,
  };
}

function sanitizeWorkflow(workflow: WorkflowRecord): WorkflowRecord {
  return {
    id: workflow.id,
    sourceSqliteId: workflow.sourceSqliteId,
    name: workflow.name,
    triggerName: workflow.triggerName,
    enabled: workflow.enabled,
    priority: workflow.priority,
    definition: workflow.definition,
    graph: workflow.graph,
    cronExpr: workflow.cronExpr,
    scheduleAccountSourceSqliteId: workflow.scheduleAccountSourceSqliteId,
    scheduleAccountId: workflow.scheduleAccountId,
    accountSourceSqliteId: workflow.accountSourceSqliteId,
    accountId: workflow.accountId,
    overrideKey: workflow.overrideKey,
    executionMode: workflow.executionMode,
    engineVersion: workflow.engineVersion,
    legacyCreatedByUserId: workflow.legacyCreatedByUserId,
    createdByUserId: workflow.createdByUserId,
    createdAt: workflow.createdAt,
    updatedAt: workflow.updatedAt,
  };
}

function sanitizeWorkflowTemplate(template: WorkflowTemplate): WorkflowTemplate {
  return {
    id: template.id,
    name: template.name,
    description: template.description,
    trigger: template.trigger,
    graph: template.graph,
  };
}

type WorkflowNodeFieldSchema = NonNullable<WorkflowNodeCatalogEntry['fields']>[number];
type WorkflowNodePortSchema = NonNullable<WorkflowNodeCatalogEntry['ports']>[number];
type WorkflowNodeOutputSchema = NonNullable<WorkflowNodeCatalogEntry['outputs']>[number];
type WorkflowNodeDocsSchema = NonNullable<WorkflowNodeCatalogEntry['docs']>;

/**
 * Whitelist-Klon eines Katalogeintrags fuer die API-Antwort: nur bekannte
 * Keys, nur plain data (keine Funktionen wie execute-Handler). Die
 * Schema-Erweiterungen (fields/ports/outputs/docs/customWidget) und der
 * runtime-Flag MUESSEN durchgereicht werden — der Renderer baut daraus das
 * Eigenschaften-Formular (SchemaFields), die Canvas-Ports und die Referenz.
 */
function sanitizeWorkflowNodeCatalogEntry(entry: WorkflowNodeCatalogEntry): WorkflowNodeCatalogEntry {
  return {
    type: entry.type,
    label: entry.label,
    category: entry.category,
    ...(entry.description === undefined ? {} : { description: entry.description }),
    canvasType: entry.canvasType,
    ...(entry.defaultConfig === undefined ? {} : { defaultConfig: { ...entry.defaultConfig } }),
    ...(entry.runtime === undefined ? {} : { runtime: entry.runtime }),
    ...(entry.fields === undefined ? {} : { fields: entry.fields.map(sanitizeWorkflowNodeFieldSchema) }),
    ...(entry.ports === undefined ? {} : { ports: entry.ports.map(sanitizeWorkflowNodePortSchema) }),
    ...(entry.outputs === undefined ? {} : { outputs: entry.outputs.map(sanitizeWorkflowNodeOutputSchema) }),
    ...(entry.docs === undefined ? {} : { docs: sanitizeWorkflowNodeDocsSchema(entry.docs) }),
    ...(entry.customWidget === undefined ? {} : { customWidget: entry.customWidget }),
  };
}

function sanitizeWorkflowNodeFieldSchema(field: WorkflowNodeFieldSchema): WorkflowNodeFieldSchema {
  return {
    key: field.key,
    type: field.type,
    label: field.label,
    ...(field.help === undefined ? {} : { help: field.help }),
    ...(field.example === undefined ? {} : { example: field.example }),
    ...(field.placeholder === undefined ? {} : { placeholder: field.placeholder }),
    ...(field.required === undefined ? {} : { required: field.required }),
    ...(field.options === undefined ? {} : {
      options: field.options.map((option) => ({
        value: option.value,
        label: option.label,
        ...(option.description === undefined ? {} : { description: option.description }),
      })),
    }),
    ...(field.validation === undefined ? {} : {
      validation: {
        ...(field.validation.min === undefined ? {} : { min: field.validation.min }),
        ...(field.validation.max === undefined ? {} : { max: field.validation.max }),
        ...(field.validation.integer === undefined ? {} : { integer: field.validation.integer }),
        ...(field.validation.pattern === undefined ? {} : { pattern: field.validation.pattern }),
        ...(field.validation.patternHint === undefined ? {} : { patternHint: field.validation.patternHint }),
        ...(field.validation.maxLength === undefined ? {} : { maxLength: field.validation.maxLength }),
      },
    }),
    ...(field.interpolate === undefined ? {} : { interpolate: field.interpolate }),
    ...(field.advanced === undefined ? {} : { advanced: field.advanced }),
    ...(field.language === undefined ? {} : { language: field.language }),
    ...(field.showIf === undefined ? {} : {
      showIf: { field: field.showIf.field, equals: plainJsonValue(field.showIf.equals) },
    }),
  };
}

function sanitizeWorkflowNodePortSchema(port: WorkflowNodePortSchema): WorkflowNodePortSchema {
  return {
    id: port.id,
    label: port.label,
    ...(port.description === undefined ? {} : { description: port.description }),
    kind: port.kind,
    ...(port.color === undefined ? {} : { color: port.color }),
    ...(port.synonyms === undefined ? {} : { synonyms: [...port.synonyms] }),
  };
}

function sanitizeWorkflowNodeOutputSchema(output: WorkflowNodeOutputSchema): WorkflowNodeOutputSchema {
  return {
    name: output.name,
    label: output.label,
    ...(output.description === undefined ? {} : { description: output.description }),
    ...(output.example === undefined ? {} : { example: output.example }),
    type: output.type,
    ...(output.dynamicFromField === undefined ? {} : { dynamicFromField: output.dynamicFromField }),
  };
}

function sanitizeWorkflowNodeDocsSchema(docs: WorkflowNodeDocsSchema): WorkflowNodeDocsSchema {
  return {
    ...(docs.longHelp === undefined ? {} : { longHelp: docs.longHelp }),
    ...(docs.prerequisites === undefined ? {} : { prerequisites: [...docs.prerequisites] }),
    ...(docs.seeAlso === undefined ? {} : { seeAlso: [...docs.seeAlso] }),
  };
}

/** showIf.equals ist typisiert `unknown` — nur JSON-taugliche Werte durchlassen. */
function plainJsonValue(value: unknown): unknown {
  if (value === null
    || typeof value === 'string'
    || typeof value === 'number'
    || typeof value === 'boolean') {
    return value;
  }
  try {
    const json = JSON.stringify(value);
    return json === undefined ? undefined : JSON.parse(json);
  } catch {
    return undefined;
  }
}

function parseWorkflowGraphCompilePayload(body: unknown): WorkflowGraphDocument {
  let candidate = body;
  if (isPlainObject(body) && typeof body.graphJson === 'string') {
    try {
      candidate = JSON.parse(body.graphJson);
    } catch {
      throw new Error('Workflow graph JSON ist ungueltig');
    }
  }

  if (!isWorkflowGraphDocument(candidate)) {
    throw new Error('Workflow graph payload ist ungueltig');
  }
  return candidate;
}

function isWorkflowGraphDocument(value: unknown): value is WorkflowGraphDocument {
  return isPlainObject(value)
    && value.version === 1
    && Array.isArray(value.nodes)
    && Array.isArray(value.edges);
}

function parseAiProfileMutationBody(
  body: unknown,
  options: {
    requireAtLeastOneField: boolean;
    requireLabel: boolean;
    requireProvider: boolean;
    requireBaseUrl: boolean;
    requireModel: boolean;
  },
): AiProfileMutationParseResult {
  if (!isPlainObject(body)) {
    return {
      ok: false,
      response: error(400, 'invalid_ai_profile_payload', 'AI profile payload muss ein JSON-Objekt sein'),
    };
  }

  const values: AiProfileMutationInput = {};
  const errors: Array<{ field: string; message: string }> = [];
  const allowedFields = new Set([
    'label',
    'provider',
    'baseUrl',
    'model',
    'embeddingModel',
    'isDefault',
    'sortOrder',
    'apiKey',
  ]);

  for (const key of Object.keys(body)) {
    if (!allowedFields.has(key)) errors.push({ field: key, message: 'Feld ist nicht erlaubt' });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'label')) {
    const label = normalizeRequiredBodyText(body.label, 'label', 200);
    if (label.ok) values.label = label.value;
    else errors.push({ field: 'label', message: label.message });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'provider')) {
    const provider = normalizeRequiredBodyText(body.provider, 'provider', 100);
    if (provider.ok) values.provider = provider.value;
    else errors.push({ field: 'provider', message: provider.message });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'baseUrl')) {
    const baseUrl = normalizeBodyHttpUrl(body.baseUrl, 'baseUrl', 2048);
    if (baseUrl.ok) values.baseUrl = baseUrl.value;
    else errors.push({ field: 'baseUrl', message: baseUrl.message });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'model')) {
    const model = normalizeRequiredBodyText(body.model, 'model', 200);
    if (model.ok) values.model = model.value;
    else errors.push({ field: 'model', message: model.message });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'embeddingModel')) {
    const embeddingModel = normalizeNullableBodyText(body.embeddingModel, 'embeddingModel', 200);
    if (embeddingModel.ok) values.embeddingModel = embeddingModel.value;
    else errors.push({ field: 'embeddingModel', message: embeddingModel.message });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'isDefault')) {
    const isDefault = normalizeBodyBoolean(body.isDefault, 'isDefault');
    if (isDefault.ok) values.isDefault = isDefault.value;
    else errors.push({ field: 'isDefault', message: isDefault.message });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'sortOrder')) {
    const sortOrder = normalizeNonNegativeBodyInt(body.sortOrder, 'sortOrder');
    if (sortOrder.ok) values.sortOrder = sortOrder.value;
    else errors.push({ field: 'sortOrder', message: sortOrder.message });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'apiKey')) {
    const apiKey = normalizeNullableBodyText(body.apiKey, 'apiKey', 20000);
    if (apiKey.ok) values.apiKey = apiKey.value;
    else errors.push({ field: 'apiKey', message: apiKey.message });
  }

  if (errors.length > 0) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'AI profile payload ist ungueltig', { fields: errors }),
    };
  }
  if (options.requireAtLeastOneField && Object.keys(values).length === 0) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'AI profile mutation braucht mindestens ein Feld'),
    };
  }
  if (options.requireLabel && values.label === undefined) {
    return { ok: false, response: error(400, 'validation_error', 'label ist erforderlich') };
  }
  if (options.requireProvider && values.provider === undefined) {
    return { ok: false, response: error(400, 'validation_error', 'provider ist erforderlich') };
  }
  if (options.requireBaseUrl && values.baseUrl === undefined) {
    return { ok: false, response: error(400, 'validation_error', 'baseUrl ist erforderlich') };
  }
  if (options.requireModel && values.model === undefined) {
    return { ok: false, response: error(400, 'validation_error', 'model ist erforderlich') };
  }

  return { ok: true, values };
}

function parseWorkflowMutationBody(
  body: unknown,
  options: {
    requireAtLeastOneField: boolean;
    requireName: boolean;
    requireTriggerName: boolean;
    requireDefinition: boolean;
  },
): WorkflowMutationParseResult {
  if (!isPlainObject(body)) {
    return {
      ok: false,
      response: error(400, 'invalid_workflow_payload', 'Workflow payload muss ein JSON-Objekt sein'),
    };
  }

  const values: WorkflowMutationInput = {};
  const errors: Array<{ field: string; message: string }> = [];
  const allowedFields = new Set([
    'name',
    'triggerName',
    'enabled',
    'priority',
    'definition',
    'graph',
    'cronExpr',
    'scheduleAccountId',
    'accountId',
    'overrideKey',
    'executionMode',
    'engineVersion',
  ]);

  for (const key of Object.keys(body)) {
    if (!allowedFields.has(key)) errors.push({ field: key, message: 'Feld ist nicht erlaubt' });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'name')) {
    const name = normalizeRequiredBodyText(body.name, 'name', 200);
    if (name.ok) values.name = name.value;
    else errors.push({ field: 'name', message: name.message });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'triggerName')) {
    const triggerName = normalizeRequiredBodyText(body.triggerName, 'triggerName', 100);
    if (triggerName.ok) values.triggerName = triggerName.value;
    else errors.push({ field: 'triggerName', message: triggerName.message });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'enabled')) {
    const enabled = normalizeBodyBoolean(body.enabled, 'enabled');
    if (enabled.ok) values.enabled = enabled.value;
    else errors.push({ field: 'enabled', message: enabled.message });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'priority')) {
    const priority = normalizeNonNegativeBodyInt(body.priority, 'priority');
    if (priority.ok) values.priority = priority.value;
    else errors.push({ field: 'priority', message: priority.message });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'definition')) {
    const definition = normalizeBodyJsonObject(body.definition, 'definition');
    if (definition.ok) values.definition = definition.value;
    else errors.push({ field: 'definition', message: definition.message });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'graph')) {
    const graph = normalizeNullableBodyJsonObject(body.graph, 'graph');
    if (graph.ok) values.graph = graph.value;
    else errors.push({ field: 'graph', message: graph.message });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'cronExpr')) {
    const cronExpr = normalizeNullableBodyText(body.cronExpr, 'cronExpr', 200);
    if (cronExpr.ok) values.cronExpr = cronExpr.value;
    else errors.push({ field: 'cronExpr', message: cronExpr.message });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'scheduleAccountId')) {
    const scheduleAccountId = normalizeNullablePositiveBodyInt(body.scheduleAccountId, 'scheduleAccountId');
    if (scheduleAccountId.ok) values.scheduleAccountId = scheduleAccountId.value;
    else errors.push({ field: 'scheduleAccountId', message: scheduleAccountId.message });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'accountId')) {
    const accountId = normalizeNullablePositiveBodyInt(body.accountId, 'accountId');
    if (accountId.ok) values.accountId = accountId.value;
    else errors.push({ field: 'accountId', message: accountId.message });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'overrideKey')) {
    const overrideKey = normalizeNullableBodyText(body.overrideKey, 'overrideKey', 200);
    if (overrideKey.ok) values.overrideKey = overrideKey.value;
    else errors.push({ field: 'overrideKey', message: overrideKey.message });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'executionMode')) {
    const executionMode = normalizeRequiredBodyText(body.executionMode, 'executionMode', 50);
    if (executionMode.ok) values.executionMode = executionMode.value;
    else errors.push({ field: 'executionMode', message: executionMode.message });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'engineVersion')) {
    const engineVersion = normalizePositiveBodyInt(body.engineVersion, 'engineVersion');
    if (engineVersion.ok) values.engineVersion = engineVersion.value;
    else errors.push({ field: 'engineVersion', message: engineVersion.message });
  }

  if (errors.length > 0) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'Workflow payload ist ungueltig', { fields: errors }),
    };
  }
  if (options.requireAtLeastOneField && Object.keys(values).length === 0) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'Workflow mutation braucht mindestens ein Feld'),
    };
  }
  if (options.requireName && values.name === undefined) {
    return { ok: false, response: error(400, 'validation_error', 'name ist erforderlich') };
  }
  if (options.requireTriggerName && values.triggerName === undefined) {
    return { ok: false, response: error(400, 'validation_error', 'triggerName ist erforderlich') };
  }
  if (options.requireDefinition && values.definition === undefined) {
    return { ok: false, response: error(400, 'validation_error', 'definition ist erforderlich') };
  }

  return { ok: true, values };
}

function parseWorkflowExecuteBody(body: unknown): WorkflowExecuteParseResult {
  const payload = body === undefined || body === null ? {} : body;
  if (!isPlainObject(payload)) {
    return {
      ok: false,
      response: error(400, 'invalid_workflow_execute_payload', 'Workflow execute payload muss ein JSON-Objekt sein'),
    };
  }

  const values: { messageId?: number; dryRun?: boolean } = {};
  const errors: Array<{ field: string; message: string }> = [];
  const allowedFields = new Set(['messageId', 'dryRun']);

  for (const key of Object.keys(payload)) {
    if (!allowedFields.has(key)) errors.push({ field: key, message: 'Feld ist nicht erlaubt' });
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'messageId')) {
    const messageId = normalizeNullablePositiveBodyInt(payload.messageId, 'messageId');
    if (messageId.ok) {
      if (messageId.value !== null) values.messageId = messageId.value;
    } else {
      errors.push({ field: 'messageId', message: messageId.message });
    }
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'dryRun')) {
    const dryRun = normalizeBodyBoolean(payload.dryRun, 'dryRun');
    if (dryRun.ok) values.dryRun = dryRun.value;
    else errors.push({ field: 'dryRun', message: dryRun.message });
  }

  if (errors.length > 0) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'Workflow execute payload ist ungueltig', { fields: errors }),
    };
  }
  return { ok: true, values };
}

function parseWorkflowInboundBackfillBody(body: unknown): WorkflowInboundBackfillParseResult {
  const payload = body === undefined || body === null ? {} : body;
  if (!isPlainObject(payload)) {
    return {
      ok: false,
      response: error(400, 'invalid_workflow_backfill_payload', 'Workflow backfill payload muss ein JSON-Objekt sein'),
    };
  }

  const values: { limit?: number; clearApplied?: boolean } = {};
  const errors: Array<{ field: string; message: string }> = [];
  const allowedFields = new Set(['limit', 'clearApplied']);

  for (const key of Object.keys(payload)) {
    if (!allowedFields.has(key)) errors.push({ field: key, message: 'Feld ist nicht erlaubt' });
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'limit')) {
    const limit = normalizeNullablePositiveBodyInt(payload.limit, 'limit');
    if (limit.ok) {
      if (limit.value !== null) values.limit = limit.value;
    } else {
      errors.push({ field: 'limit', message: limit.message });
    }
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'clearApplied')) {
    const clearApplied = normalizeBodyBoolean(payload.clearApplied, 'clearApplied');
    if (clearApplied.ok) values.clearApplied = clearApplied.value;
    else errors.push({ field: 'clearApplied', message: clearApplied.message });
  }

  if (errors.length > 0) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'Workflow backfill payload ist ungueltig', { fields: errors }),
    };
  }
  return { ok: true, values };
}

function parseWebhookIncomingBody(body: unknown): WebhookIncomingParseResult {
  if (!isPlainObject(body)) {
    return {
      ok: false,
      response: error(400, 'invalid_webhook_payload', 'Webhook payload muss ein JSON-Objekt sein'),
    };
  }

  const values: { secret?: string; body?: Record<string, unknown> } = {};
  const errors: Array<{ field: string; message: string }> = [];
  const allowedFields = new Set(['secret', 'body']);
  for (const key of Object.keys(body)) {
    if (!allowedFields.has(key)) errors.push({ field: key, message: 'Feld ist nicht erlaubt' });
  }

  if (Object.prototype.hasOwnProperty.call(body, 'secret')) {
    const secret = normalizeRequiredBodyText(body.secret, 'secret', 2000);
    if (secret.ok) values.secret = secret.value;
    else errors.push({ field: 'secret', message: secret.message });
  }

  if (Object.prototype.hasOwnProperty.call(body, 'body')) {
    if (body.body === undefined || body.body === null) {
      values.body = {};
    } else if (isPlainObject(body.body)) {
      values.body = body.body;
    } else {
      errors.push({ field: 'body', message: 'body muss ein JSON-Objekt sein' });
    }
  } else {
    values.body = {};
  }

  if (errors.length > 0 || values.body === undefined) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'Webhook payload ist ungueltig', { fields: errors }),
    };
  }
  return {
    ok: true,
    values: {
      ...(values.secret === undefined ? {} : { secret: values.secret }),
      body: values.body,
    },
  };
}

function parseAiPromptMutationBody(
  body: unknown,
  options: {
    requireAtLeastOneField: boolean;
    requireLabel: boolean;
    requireUserTemplate: boolean;
    requireTarget: boolean;
  },
): AiPromptMutationParseResult {
  if (!isPlainObject(body)) {
    return {
      ok: false,
      response: error(400, 'invalid_ai_prompt_payload', 'AI prompt payload muss ein JSON-Objekt sein'),
    };
  }

  const values: AiPromptMutationInput = {};
  const errors: Array<{ field: string; message: string }> = [];
  const allowedFields = new Set(['label', 'userTemplate', 'target', 'profileId', 'accountId', 'overrideKey', 'sortOrder']);

  for (const key of Object.keys(body)) {
    if (!allowedFields.has(key)) errors.push({ field: key, message: 'Feld ist nicht erlaubt' });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'label')) {
    const label = normalizeRequiredBodyText(body.label, 'label', 200);
    if (label.ok) values.label = label.value;
    else errors.push({ field: 'label', message: label.message });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'userTemplate')) {
    const userTemplate = normalizeRequiredBodyText(body.userTemplate, 'userTemplate', 50000);
    if (userTemplate.ok) values.userTemplate = userTemplate.value;
    else errors.push({ field: 'userTemplate', message: userTemplate.message });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'target')) {
    const target = normalizeRequiredBodyText(body.target, 'target', 100);
    if (target.ok) values.target = target.value;
    else errors.push({ field: 'target', message: target.message });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'profileId')) {
    const profileId = normalizeNullablePositiveBodyInt(body.profileId, 'profileId');
    if (profileId.ok) values.profileId = profileId.value;
    else errors.push({ field: 'profileId', message: profileId.message });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'accountId')) {
    const accountId = normalizeNullablePositiveBodyInt(body.accountId, 'accountId');
    if (accountId.ok) values.accountId = accountId.value;
    else errors.push({ field: 'accountId', message: accountId.message });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'overrideKey')) {
    const overrideKey = normalizeNullableBodyText(body.overrideKey, 'overrideKey', 200);
    if (overrideKey.ok) values.overrideKey = overrideKey.value;
    else errors.push({ field: 'overrideKey', message: overrideKey.message });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'sortOrder')) {
    const sortOrder = normalizeNonNegativeBodyInt(body.sortOrder, 'sortOrder');
    if (sortOrder.ok) values.sortOrder = sortOrder.value;
    else errors.push({ field: 'sortOrder', message: sortOrder.message });
  }

  if (errors.length > 0) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'AI prompt payload ist ungueltig', { fields: errors }),
    };
  }
  if (options.requireAtLeastOneField && Object.keys(values).length === 0) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'AI prompt mutation braucht mindestens ein Feld'),
    };
  }
  if (options.requireLabel && values.label === undefined) {
    return { ok: false, response: error(400, 'validation_error', 'label ist erforderlich') };
  }
  if (options.requireUserTemplate && values.userTemplate === undefined) {
    return { ok: false, response: error(400, 'validation_error', 'userTemplate ist erforderlich') };
  }
  if (options.requireTarget && values.target === undefined) {
    return { ok: false, response: error(400, 'validation_error', 'target ist erforderlich') };
  }

  return { ok: true, values };
}

function parseAiPromptReorderBody(body: unknown): AiPromptReorderParseResult {
  if (!isPlainObject(body)) {
    return {
      ok: false,
      response: error(400, 'invalid_ai_prompt_reorder_payload', 'AI prompt reorder payload muss ein JSON-Objekt sein'),
    };
  }

  const errors: Array<{ field: string; message: string }> = [];
  const allowedFields = new Set(['updates']);
  for (const key of Object.keys(body)) {
    if (!allowedFields.has(key)) errors.push({ field: key, message: 'Feld ist nicht erlaubt' });
  }
  if (!Array.isArray(body.updates) || body.updates.length < 1 || body.updates.length > 500) {
    errors.push({ field: 'updates', message: 'updates muss ein Array mit 1 bis 500 Eintraegen sein' });
  }

  const updates: AiPromptReorderItem[] = [];
  const seenIds = new Set<number>();
  if (Array.isArray(body.updates)) {
    body.updates.forEach((rawUpdate, index) => {
      const field = `updates.${index}`;
      if (!isPlainObject(rawUpdate)) {
        errors.push({ field, message: 'Eintrag muss ein JSON-Objekt sein' });
        return;
      }
      const updateAllowedFields = new Set(['id', 'sortOrder']);
      for (const key of Object.keys(rawUpdate)) {
        if (!updateAllowedFields.has(key)) errors.push({ field: `${field}.${key}`, message: 'Feld ist nicht erlaubt' });
      }
      const id = normalizePositiveBodyInt(rawUpdate.id, 'id');
      const sortOrder = normalizeNonNegativeBodyInt(rawUpdate.sortOrder, 'sortOrder');
      if (id.ok && seenIds.has(id.value)) errors.push({ field: `${field}.id`, message: 'id darf nicht doppelt vorkommen' });
      if (!id.ok) errors.push({ field: `${field}.id`, message: id.message });
      if (!sortOrder.ok) errors.push({ field: `${field}.sortOrder`, message: sortOrder.message });
      if (id.ok && sortOrder.ok && !seenIds.has(id.value)) {
        seenIds.add(id.value);
        updates.push({ id: id.value, sortOrder: sortOrder.value });
      }
    });
  }

  if (errors.length > 0) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'AI prompt reorder payload ist ungueltig', { fields: errors }),
    };
  }
  return { ok: true, updates };
}

function parseAiTextTransformBody(body: unknown): AiTextTransformParseResult {
  if (!isPlainObject(body)) {
    return {
      ok: false,
      response: error(400, 'invalid_ai_text_transform_payload', 'AI text transform payload muss ein JSON-Objekt sein'),
    };
  }

  const errors: Array<{ field: string; message: string }> = [];
  const allowedFields = new Set(['promptId', 'text', 'contextText', 'targetLanguage', 'inboundContextText', 'userContext', 'customerId', 'insertMode']);
  for (const key of Object.keys(body)) {
    if (!allowedFields.has(key)) errors.push({ field: key, message: 'Feld ist nicht erlaubt' });
  }

  const values: {
    promptId?: number;
    text?: string;
    contextText?: string;
    targetLanguage?: string;
    inboundContextText?: string;
    userContext?: string;
    customerId?: number | null;
    insertMode?: boolean;
  } = {};

  // promptId is required in prompt mode but omitted in translate mode.
  if (Object.prototype.hasOwnProperty.call(body, 'promptId')) {
    const promptId = normalizePositiveBodyInt(body.promptId, 'promptId');
    if (promptId.ok) values.promptId = promptId.value;
    else errors.push({ field: 'promptId', message: promptId.message });
  }

  if (Object.prototype.hasOwnProperty.call(body, 'insertMode')) {
    if (typeof body.insertMode === 'boolean') values.insertMode = body.insertMode;
    else errors.push({ field: 'insertMode', message: 'insertMode muss ein Boolean sein' });
  }

  const insertMode = values.insertMode === true;
  const text = insertMode
    ? normalizeOptionalBodyText(body.text, 'text', 20000)
    : normalizeRequiredBodyText(body.text, 'text', 20000);
  if (text.ok) values.text = text.value;
  else errors.push({ field: 'text', message: text.message });

  if (Object.prototype.hasOwnProperty.call(body, 'contextText')) {
    const contextText = normalizeRequiredBodyText(body.contextText, 'contextText', 40000);
    if (contextText.ok) values.contextText = contextText.value;
    else errors.push({ field: 'contextText', message: contextText.message });
  }

  if (Object.prototype.hasOwnProperty.call(body, 'targetLanguage')) {
    const targetLanguage = normalizeRequiredBodyText(body.targetLanguage, 'targetLanguage', 60);
    if (targetLanguage.ok) values.targetLanguage = targetLanguage.value;
    else errors.push({ field: 'targetLanguage', message: targetLanguage.message });
  }

  if (Object.prototype.hasOwnProperty.call(body, 'inboundContextText')) {
    const inboundContextText = normalizeRequiredBodyText(body.inboundContextText, 'inboundContextText', 40000);
    if (inboundContextText.ok) values.inboundContextText = inboundContextText.value;
    else errors.push({ field: 'inboundContextText', message: inboundContextText.message });
  }

  if (Object.prototype.hasOwnProperty.call(body, 'userContext')) {
    const userContext = normalizeRequiredBodyText(body.userContext, 'userContext', 4000);
    if (userContext.ok) values.userContext = userContext.value;
    else errors.push({ field: 'userContext', message: userContext.message });
  }

  if (Object.prototype.hasOwnProperty.call(body, 'customerId')) {
    const customerId = normalizeNullablePositiveBodyInt(body.customerId, 'customerId');
    if (customerId.ok) values.customerId = customerId.value;
    else errors.push({ field: 'customerId', message: customerId.message });
  }

  // Need either a prompt (prompt mode) or a target language (translate mode).
  if (values.promptId === undefined && values.targetLanguage === undefined) {
    errors.push({ field: 'promptId', message: 'promptId oder targetLanguage ist erforderlich' });
  }

  if (errors.length > 0 || (!insertMode && values.text === undefined)) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'AI text transform payload ist ungueltig', { fields: errors }),
    };
  }

  const resolvedText = values.text ?? '';

  return {
    ok: true,
    values: {
      ...(values.promptId === undefined ? {} : { promptId: values.promptId }),
      text: resolvedText,
      ...(values.contextText === undefined ? {} : { contextText: values.contextText }),
      ...(values.targetLanguage === undefined ? {} : { targetLanguage: values.targetLanguage }),
      ...(values.inboundContextText === undefined ? {} : { inboundContextText: values.inboundContextText }),
      ...(values.userContext === undefined ? {} : { userContext: values.userContext }),
      ...(values.customerId === undefined ? {} : { customerId: values.customerId }),
      ...(values.insertMode === undefined ? {} : { insertMode: values.insertMode }),
    },
  };
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

function parseNonZeroInt(value: string | undefined): number | null {
  if (value === undefined || !/^-?\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed !== 0 ? parsed : null;
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

function normalizeOptionalBodyText(
  rawValue: unknown,
  field: string,
  maxLength: number,
): { ok: true; value: string } | { ok: false; message: string } {
  if (rawValue === undefined || rawValue === null) return { ok: true, value: '' };
  if (typeof rawValue !== 'string') return { ok: false, message: `${field} muss ein String sein` };
  const value = rawValue.trim();
  if (value.length > maxLength) return { ok: false, message: `${field} darf maximal ${maxLength} Zeichen haben` };
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
  return normalizeRequiredBodyText(rawValue, field, maxLength);
}

function normalizeBodyHttpUrl(
  rawValue: unknown,
  field: string,
  maxLength: number,
): { ok: true; value: string } | { ok: false; message: string } {
  const normalized = normalizeRequiredBodyText(rawValue, field, maxLength);
  if (!normalized.ok) return normalized;
  try {
    const url = new URL(normalized.value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return { ok: false, message: `${field} muss eine http- oder https-URL sein` };
    }
    return { ok: true, value: url.toString().replace(/\/$/, '') };
  } catch {
    return { ok: false, message: `${field} muss eine gueltige URL sein` };
  }
}

function normalizeBodyBoolean(
  rawValue: unknown,
  field: string,
): { ok: true; value: boolean } | { ok: false; message: string } {
  if (typeof rawValue === 'boolean') return { ok: true, value: rawValue };
  if (typeof rawValue === 'string') {
    if (rawValue === 'true') return { ok: true, value: true };
    if (rawValue === 'false') return { ok: true, value: false };
  }
  return { ok: false, message: `${field} muss ein Boolean sein` };
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

function normalizeBodyJsonObject(
  rawValue: unknown,
  field: string,
): { ok: true; value: unknown } | { ok: false; message: string } {
  if (!isJsonObjectLike(rawValue) || !isJsonCompatible(rawValue)) {
    return { ok: false, message: `${field} muss ein JSON-Objekt oder Array sein` };
  }
  return { ok: true, value: rawValue };
}

function normalizeNullableBodyJsonObject(
  rawValue: unknown,
  field: string,
): { ok: true; value: unknown | null } | { ok: false; message: string } {
  if (rawValue === null) return { ok: true, value: null };
  return normalizeBodyJsonObject(rawValue, field);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isJsonObjectLike(value: unknown): value is Record<string, unknown> | unknown[] {
  return Array.isArray(value) || isPlainObject(value);
}

function isJsonCompatible(value: unknown): boolean {
  if (value === null) return true;
  if (typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonCompatible);
  if (isPlainObject(value)) {
    return Object.values(value).every((item) => item !== undefined && isJsonCompatible(item));
  }
  return false;
}

function webhookSecretMatches(provided: string, expected: string): boolean {
  const providedHash = createHash('sha256').update(provided, 'utf8').digest();
  const expectedHash = createHash('sha256').update(expected, 'utf8').digest();
  return timingSafeEqual(providedHash, expectedHash);
}

function isAutomationApiKeyPrincipal(principal: AuthenticatedPrincipal): boolean {
  return Boolean(principal.automationApiKeyId);
}

function automationPrincipalCanTriggerWebhook(principal: AuthenticatedPrincipal): boolean {
  const scopes = principal.automationScopes ?? [];
  return scopes.includes(WEBHOOK_AUTOMATION_SCOPE) || scopes.includes('write') || scopes.includes('*');
}

function webhookPayloadHash(bodyJson: string): string {
  return createHash('sha256').update(bodyJson, 'utf8').digest('hex').slice(0, 40);
}

function serializeWebhookBodyForWorkflow(body: Record<string, unknown>): string {
  let bodyJson = JSON.stringify(body ?? {});
  if (bodyJson.length <= WEBHOOK_BODY_JSON_MAX) return bodyJson;
  const wrapped = {
    __truncated: true,
    __originalLength: bodyJson.length,
    preview: bodyJson.slice(0, WEBHOOK_BODY_JSON_MAX - 512),
  };
  bodyJson = JSON.stringify(wrapped);
  if (bodyJson.length > WEBHOOK_BODY_JSON_MAX) {
    wrapped.preview = wrapped.preview.slice(0, WEBHOOK_BODY_JSON_MAX - 1024);
    bodyJson = JSON.stringify(wrapped);
  }
  return bodyJson;
}

function buildWebhookWorkflowContext(bodyJson: string): Record<string, unknown> {
  return {
    webhook_body: bodyJson,
    eventStrings: {
      subject: 'Webhook',
      body_text: bodyJson,
      snippet: bodyJson.slice(0, 200),
      combined_text: bodyJson,
      from_address: '',
      to_address: '',
      cc_address: '',
      has_attachments: 'false',
      attachment_names: '',
      attachment_types: '',
    },
    eventVariables: {
      webhook_body: bodyJson,
    },
  };
}

function resourceErrorName(resource: WorkflowReadResource): 'ai_profile' | 'ai_prompt' | 'workflow' {
  switch (resource) {
    case 'aiProfiles':
      return 'ai_profile';
    case 'aiPrompts':
      return 'ai_prompt';
    case 'workflows':
      return 'workflow';
    default:
      return assertNever(resource);
  }
}

function resourceLabel(resource: WorkflowReadResource): 'AI profile' | 'AI prompt' | 'Workflow' {
  switch (resource) {
    case 'aiProfiles':
      return 'AI profile';
    case 'aiPrompts':
      return 'AI prompt';
    case 'workflows':
      return 'Workflow';
    default:
      return assertNever(resource);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unexpected workflow read resource: ${value}`);
}
