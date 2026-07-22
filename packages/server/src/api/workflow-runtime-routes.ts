import type {
  ApiRequest,
  ApiResponse,
  ApiErrorBody,
  AuthenticatedPrincipal,
  ServerApiPorts,
  WorkflowDelayedJobListResult,
  WorkflowDelayedJobMutationInput,
  WorkflowDelayedJobRecord,
  WorkflowForwardDedupListResult,
  WorkflowForwardDedupRecord,
  WorkflowKnowledgeBaseListResult,
  WorkflowKnowledgeBaseMutationInput,
  WorkflowKnowledgeBaseRecord,
  WorkflowKnowledgeChunkListResult,
  WorkflowKnowledgeChunkMutationInput,
  WorkflowKnowledgeChunkRecord,
  WorkflowMessageAppliedListResult,
  WorkflowMessageAppliedRecord,
  WorkflowRunListResult,
  WorkflowRunRecord,
  WorkflowRunStepListResult,
  WorkflowRunStepRecord,
  WorkflowRecord,
  WorkflowVersionListResult,
  WorkflowVersionMutationInput,
  WorkflowVersionRecord,
} from './types';
import { workflowGraphHasSideEffectNode } from '@simplecrm/core';
import {
  data,
  error,
  positiveIntFromPath,
  requireAdmin,
  requireCapability,
  requirePrincipal,
} from './http';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

type ParseResult<TFilters extends object> =
  | { ok: true; filters: TFilters }
  | { ok: false; response: ApiResponse };

type WorkflowVersionMutationParseResult =
  | { ok: true; values: WorkflowVersionMutationInput }
  | { ok: false; response: ApiResponse<ApiErrorBody> };

type WorkflowKnowledgeBaseMutationParseResult =
  | { ok: true; values: WorkflowKnowledgeBaseMutationInput }
  | { ok: false; response: ApiResponse<ApiErrorBody> };

type WorkflowKnowledgeChunkMutationParseResult =
  | { ok: true; values: WorkflowKnowledgeChunkMutationInput }
  | { ok: false; response: ApiResponse<ApiErrorBody> };

type WorkflowDelayedJobMutationParseResult =
  | { ok: true; values: WorkflowDelayedJobMutationInput }
  | { ok: false; response: ApiResponse<ApiErrorBody> };

export async function handleWorkflowRuntimeReadRoute(
  req: ApiRequest,
  ports: ServerApiPorts,
): Promise<ApiResponse | null> {
  const workflowSourceVersionSnapshotMatch = /^\/api\/v1\/workflows\/by-source\/([^/]+)\/versions\/snapshot$/.exec(req.path);
  if (workflowSourceVersionSnapshotMatch) {
    return handleWorkflowSourceVersionSnapshot(req, ports, workflowSourceVersionSnapshotMatch[1]);
  }

  const workflowSourceVersionsMatch = /^\/api\/v1\/workflows\/by-source\/([^/]+)\/versions$/.exec(req.path);
  if (workflowSourceVersionsMatch) {
    return handleWorkflowSourceScopedVersions(req, ports, workflowSourceVersionsMatch[1]);
  }

  const workflowSourceRunsMatch = /^\/api\/v1\/workflows\/by-source\/([^/]+)\/runs$/.exec(req.path);
  if (workflowSourceRunsMatch) {
    return handleWorkflowSourceScopedRuns(req, ports, workflowSourceRunsMatch[1]);
  }

  const workflowVersionsMatch = /^\/api\/v1\/workflows\/([^/]+)\/versions$/.exec(req.path);
  if (workflowVersionsMatch) return handleWorkflowScopedVersions(req, ports, workflowVersionsMatch[1]);

  const workflowRunsMatch = /^\/api\/v1\/workflows\/([^/]+)\/runs$/.exec(req.path);
  if (workflowRunsMatch) return handleWorkflowScopedRuns(req, ports, workflowRunsMatch[1]);

  const messageRunsMatch = /^\/api\/v1\/email\/messages\/([^/]+)\/workflow-runs$/.exec(req.path);
  if (messageRunsMatch) return handleMessageScopedRuns(req, ports, messageRunsMatch[1]);

  const runSourceGetMatch = /^\/api\/v1\/workflow-runs\/by-source\/([^/]+)$/.exec(req.path);
  if (runSourceGetMatch) {
    return handleWorkflowRunSourceGet(req, ports, runSourceGetMatch[1]);
  }

  const runStepsMatch = /^\/api\/v1\/workflow-runs\/([^/]+)\/steps$/.exec(req.path);
  if (runStepsMatch) return handleRunScopedSteps(req, ports, runStepsMatch[1]);

  const runSourceStepsMatch = /^\/api\/v1\/workflow-runs\/by-source\/([^/]+)\/steps$/.exec(req.path);
  if (runSourceStepsMatch) {
    return handleWorkflowRunSourceScopedSteps(req, ports, runSourceStepsMatch[1]);
  }

  const workflowVersionSourceRestoreMatch = /^\/api\/v1\/workflow-versions\/by-source\/([^/]+)\/restore$/.exec(req.path);
  if (workflowVersionSourceRestoreMatch) {
    return handleWorkflowVersionSourceRestore(req, ports, workflowVersionSourceRestoreMatch[1]);
  }

  const workflowVersionMatch = /^\/api\/v1\/workflow-versions(?:\/([^/]+))?$/.exec(req.path);
  if (workflowVersionMatch) {
    return workflowVersionMatch[1] === undefined
      ? handleWorkflowVersionList(req, ports)
      : handleWorkflowVersionGet(req, ports, workflowVersionMatch[1]);
  }

  const workflowRunMatch = /^\/api\/v1\/workflow-runs(?:\/([^/]+))?$/.exec(req.path);
  if (workflowRunMatch) {
    return workflowRunMatch[1] === undefined
      ? handleWorkflowRunList(req, ports)
      : handleWorkflowRunGet(req, ports, workflowRunMatch[1]);
  }

  const workflowRunStepMatch = /^\/api\/v1\/workflow-run-steps(?:\/([^/]+))?$/.exec(req.path);
  if (workflowRunStepMatch) {
    return workflowRunStepMatch[1] === undefined
      ? handleWorkflowRunStepList(req, ports)
      : handleWorkflowRunStepGet(req, ports, workflowRunStepMatch[1]);
  }

  const messageAppliedMatch = /^\/api\/v1\/workflow-message-applied(?:\/([^/]+))?$/.exec(req.path);
  if (messageAppliedMatch) {
    return messageAppliedMatch[1] === undefined
      ? handleWorkflowMessageAppliedList(req, ports)
      : handleWorkflowMessageAppliedGet(req, ports, messageAppliedMatch[1]);
  }

  const forwardDedupMatch = /^\/api\/v1\/workflow-forward-dedup(?:\/([^/]+))?$/.exec(req.path);
  if (forwardDedupMatch) {
    return forwardDedupMatch[1] === undefined
      ? handleWorkflowForwardDedupList(req, ports)
      : handleWorkflowForwardDedupGet(req, ports, forwardDedupMatch[1]);
  }

  const knowledgeBaseMatch = /^\/api\/v1\/workflow-knowledge-bases(?:\/([^/]+))?$/.exec(req.path);
  if (knowledgeBaseMatch) {
    return knowledgeBaseMatch[1] === undefined
      ? handleKnowledgeBaseList(req, ports)
      : handleKnowledgeBaseGet(req, ports, knowledgeBaseMatch[1]);
  }

  const knowledgeChunkMatch = /^\/api\/v1\/workflow-knowledge-chunks(?:\/([^/]+))?$/.exec(req.path);
  if (knowledgeChunkMatch) {
    return knowledgeChunkMatch[1] === undefined
      ? handleKnowledgeChunkList(req, ports)
      : handleKnowledgeChunkGet(req, ports, knowledgeChunkMatch[1]);
  }

  const delayedJobMatch = /^\/api\/v1\/workflow-delayed-jobs(?:\/([^/]+))?$/.exec(req.path);
  if (delayedJobMatch) {
    return delayedJobMatch[1] === undefined
      ? handleDelayedJobList(req, ports)
      : handleDelayedJobGet(req, ports, delayedJobMatch[1]);
  }

  return null;
}

async function handleWorkflowScopedVersions(
  req: ApiRequest,
  ports: ServerApiPorts,
  rawWorkflowId: string | undefined,
): Promise<ApiResponse> {
  const workflowId = positiveIntFromPath(rawWorkflowId);
  if (workflowId === null) return error(400, 'invalid_workflow_id', 'workflow id muss eine positive Ganzzahl sein');
  if (req.method === 'POST') return handleWorkflowVersionCreate(req, ports, workflowId);
  return handleWorkflowVersionList(req, ports, { workflowId });
}

async function handleWorkflowSourceScopedVersions(
  req: ApiRequest,
  ports: ServerApiPorts,
  rawWorkflowSourceSqliteId: string | undefined,
): Promise<ApiResponse> {
  if (req.method !== 'GET') return methodNotAllowed();
  const route = await resolveWorkflowSourceRoute(req, ports, rawWorkflowSourceSqliteId);
  if ('status' in route) return route;
  return handleWorkflowVersionList(req, ports, { workflowId: route.workflow.id });
}

async function handleWorkflowSourceVersionSnapshot(
  req: ApiRequest,
  ports: ServerApiPorts,
  rawWorkflowSourceSqliteId: string | undefined,
): Promise<ApiResponse> {
  if (req.method !== 'POST') return methodNotAllowed();
  const route = await resolveWorkflowSourceRoute(req, ports, rawWorkflowSourceSqliteId);
  if ('status' in route) return route;
  if (!ports.workflowVersions?.create) return unavailable('workflow_versions_unavailable', 'Workflow version API nicht konfiguriert');

  const label = parseOptionalLabel(req.body);
  if (label === null) {
    return error(400, 'validation_error', 'Workflow version snapshot payload ist ungueltig', {
      fields: [{ field: 'label', message: 'label muss ein String sein' }],
    });
  }
  const result = await ports.workflowVersions.create({
    workspaceId: route.principal.workspaceId,
    actorUserId: route.principal.userId,
    values: {
      workflowId: route.workflow.id,
      label: label ?? defaultWorkflowVersionLabel(),
      graph: route.workflow.graph ?? {},
      definition: route.workflow.definition ?? {},
    },
  });
  if (!result.ok) return workflowVersionMutationError(result.code);

  const version = result.version;
  await auditWorkflowVersion(ports, route.principal, 'workflow_version.created', version, { label: version.label });
  await publishWorkflowVersion(ports, route.principal.workspaceId, 'workflow_version.created', version, route.principal.userId);
  return data(201, sanitizeWorkflowVersion(version));
}

async function handleWorkflowScopedRuns(
  req: ApiRequest,
  ports: ServerApiPorts,
  rawWorkflowId: string | undefined,
): Promise<ApiResponse> {
  const workflowId = positiveIntFromPath(rawWorkflowId);
  if (workflowId === null) return error(400, 'invalid_workflow_id', 'workflow id muss eine positive Ganzzahl sein');
  return handleWorkflowRunList(req, ports, { workflowId });
}

async function handleWorkflowSourceScopedRuns(
  req: ApiRequest,
  ports: ServerApiPorts,
  rawWorkflowSourceSqliteId: string | undefined,
): Promise<ApiResponse> {
  if (req.method !== 'GET') return methodNotAllowed();
  const route = await resolveWorkflowSourceRoute(req, ports, rawWorkflowSourceSqliteId);
  if ('status' in route) return route;
  return handleWorkflowRunList(req, ports, { workflowId: route.workflow.id });
}

async function handleMessageScopedRuns(
  req: ApiRequest,
  ports: ServerApiPorts,
  rawMessageId: string | undefined,
): Promise<ApiResponse> {
  const messageId = positiveIntFromPath(rawMessageId);
  if (messageId === null) return error(400, 'invalid_email_message_id', 'email message id muss eine positive Ganzzahl sein');
  return handleWorkflowRunList(req, ports, { messageId });
}

async function handleRunScopedSteps(
  req: ApiRequest,
  ports: ServerApiPorts,
  rawRunId: string | undefined,
): Promise<ApiResponse> {
  const runId = positiveIntFromPath(rawRunId);
  if (runId === null) return error(400, 'invalid_workflow_run_id', 'workflow run id muss eine positive Ganzzahl sein');
  return handleWorkflowRunStepList(req, ports, { runId });
}

async function handleWorkflowRunSourceGet(
  req: ApiRequest,
  ports: ServerApiPorts,
  rawRunSourceSqliteId: string | undefined,
): Promise<ApiResponse> {
  if (req.method !== 'GET') return methodNotAllowed();
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  const sourceSqliteId = parseNonZeroInt(rawRunSourceSqliteId);
  if (sourceSqliteId === null) {
    return error(400, 'invalid_workflow_run_source_sqlite_id', 'Workflow run sourceSqliteId muss eine Ganzzahl ungleich 0 sein');
  }
  if (!ports.workflowRuns) return unavailable('workflow_runs_unavailable', 'Workflow run API nicht konfiguriert');
  const run = await findWorkflowRunBySourceSqliteId(ports, principal.workspaceId, sourceSqliteId);
  if (!run) return error(404, 'workflow_run_not_found', 'Workflow run nicht gefunden');
  const detailed = await ports.workflowRuns.get({
    workspaceId: principal.workspaceId,
    id: run.id,
    includeLog: true,
  });
  if (!detailed) return error(404, 'workflow_run_not_found', 'Workflow run nicht gefunden');
  return data(200, sanitizeWorkflowRun(detailed, true));
}

async function handleWorkflowRunSourceScopedSteps(
  req: ApiRequest,
  ports: ServerApiPorts,
  rawRunSourceSqliteId: string | undefined,
): Promise<ApiResponse> {
  if (req.method !== 'GET') return methodNotAllowed();
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  const sourceSqliteId = parseNonZeroInt(rawRunSourceSqliteId);
  if (sourceSqliteId === null) {
    return error(400, 'invalid_workflow_run_source_sqlite_id', 'Workflow run sourceSqliteId muss eine Ganzzahl ungleich 0 sein');
  }
  if (!ports.workflowRuns) return unavailable('workflow_runs_unavailable', 'Workflow run API nicht konfiguriert');
  const run = await findWorkflowRunBySourceSqliteId(ports, principal.workspaceId, sourceSqliteId);
  if (!run) return error(404, 'workflow_run_not_found', 'Workflow run nicht gefunden');
  return handleWorkflowRunStepList(req, ports, { runId: run.id });
}

async function handleWorkflowVersionList(
  req: ApiRequest,
  ports: ServerApiPorts,
  forcedFilters: { workflowId?: number } = {},
): Promise<ApiResponse> {
  if (req.method === 'POST') return handleWorkflowVersionCreate(req, ports);
  if (req.method !== 'GET') return methodNotAllowed();
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  const base = parseNumericListBase(req);
  if (!base.ok) return base.response;
  const filters = parseVersionFilters(req);
  if (!filters.ok) return filters.response;
  if (!ports.workflowVersions) return unavailable('workflow_versions_unavailable', 'Workflow version API nicht konfiguriert');
  const result = await ports.workflowVersions.list({
    workspaceId: principal.workspaceId,
    ...base.filters,
    ...filters.filters,
    ...forcedFilters,
  });
  return data(200, sanitizeWorkflowVersionList(result));
}

async function handleWorkflowVersionGet(
  req: ApiRequest,
  ports: ServerApiPorts,
  rawId: string | undefined,
): Promise<ApiResponse> {
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  const id = positiveIntFromPath(rawId);
  if (id === null) return error(400, 'invalid_workflow_version_id', 'workflow version id muss eine positive Ganzzahl sein');
  if (req.method === 'PATCH') return handleWorkflowVersionUpdate(req, ports, principal, id);
  if (req.method === 'DELETE') return handleWorkflowVersionDelete(ports, principal, id);
  if (req.method !== 'GET') return methodNotAllowed();
  if (!ports.workflowVersions) return unavailable('workflow_versions_unavailable', 'Workflow version API nicht konfiguriert');
  const item = await ports.workflowVersions.get({ workspaceId: principal.workspaceId, id });
  return item ? data(200, sanitizeWorkflowVersion(item)) : error(404, 'workflow_version_not_found', 'Workflow version nicht gefunden');
}

async function handleWorkflowVersionSourceRestore(
  req: ApiRequest,
  ports: ServerApiPorts,
  rawVersionSourceSqliteId: string | undefined,
): Promise<ApiResponse> {
  if (req.method !== 'POST') return methodNotAllowed();
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  const sourceSqliteId = parseNonZeroInt(rawVersionSourceSqliteId);
  if (sourceSqliteId === null) {
    return error(400, 'invalid_workflow_version_source_sqlite_id', 'Workflow version sourceSqliteId muss eine Ganzzahl ungleich 0 sein');
  }
  if (!ports.workflowVersions) return unavailable('workflow_versions_unavailable', 'Workflow version API nicht konfiguriert');
  if (!ports.workflows?.update) return unavailable('workflows_unavailable', 'Workflow API nicht konfiguriert');

  const version = await findWorkflowVersionBySourceSqliteId(ports, principal.workspaceId, sourceSqliteId);
  if (!version) return error(404, 'workflow_version_not_found', 'Workflow version nicht gefunden');
  if (version.workflowId === null) return error(404, 'workflow_not_found', 'Workflow nicht gefunden');

  const expectedWorkflowSourceSqliteId = parseOptionalBodyNonZeroInt(req.body, 'workflowId');
  if (expectedWorkflowSourceSqliteId === null) {
    return error(400, 'validation_error', 'Workflow version restore payload ist ungueltig', {
      fields: [{ field: 'workflowId', message: 'workflowId muss eine Ganzzahl ungleich 0 sein' }],
    });
  }
  if (
    expectedWorkflowSourceSqliteId !== undefined
    && expectedWorkflowSourceSqliteId !== version.workflowSourceSqliteId
  ) {
    return error(400, 'workflow_id_mismatch', 'workflowId passt nicht zur Version');
  }

  const result = await ports.workflows.update({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    id: version.workflowId,
    values: {
      graph: version.graph ?? {},
      definition: version.definition ?? {},
    },
  });
  if (!result) return error(404, 'workflow_not_found', 'Workflow nicht gefunden');
  if (!result.ok) return error(404, 'email_account_not_found', 'Email account nicht gefunden');

  const workflow = result.workflow;
  await auditWorkflowRestore(ports, principal, workflow, version);
  await publishWorkflowRestore(ports, principal.workspaceId, workflow, principal.userId);
  return data(200, { success: true, workflowId: workflow.sourceSqliteId ?? workflow.id });
}

async function handleWorkflowVersionCreate(
  req: ApiRequest,
  ports: ServerApiPorts,
  forcedWorkflowId?: number,
): Promise<ApiResponse> {
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  if (!ports.workflowVersions?.create) return unavailable('workflow_versions_unavailable', 'Workflow version API nicht konfiguriert');

  const parsed = parseWorkflowVersionMutationBody(req.body, {
    requireAtLeastOneField: true,
    requireWorkflowId: forcedWorkflowId === undefined,
    requireLabel: true,
    requireGraph: true,
    requireDefinition: true,
  });
  if (!parsed.ok) return parsed.response;
  if (
    forcedWorkflowId !== undefined
    && parsed.values.workflowId !== undefined
    && parsed.values.workflowId !== forcedWorkflowId
  ) {
    return error(400, 'workflow_id_mismatch', 'workflowId passt nicht zur Route');
  }

  const result = await ports.workflowVersions.create({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    values: {
      ...parsed.values,
      ...(forcedWorkflowId === undefined ? {} : { workflowId: forcedWorkflowId }),
    },
  });
  if (!result.ok) return workflowVersionMutationError(result.code);

  const version = result.version;
  await auditWorkflowVersion(ports, principal, 'workflow_version.created', version, { label: version.label });
  await publishWorkflowVersion(ports, principal.workspaceId, 'workflow_version.created', version, principal.userId);
  return data(201, sanitizeWorkflowVersion(version));
}

async function handleWorkflowVersionUpdate(
  req: ApiRequest,
  ports: ServerApiPorts,
  principal: AuthenticatedPrincipal,
  id: number,
): Promise<ApiResponse> {
  if (!ports.workflowVersions?.update) return unavailable('workflow_versions_unavailable', 'Workflow version API nicht konfiguriert');

  const parsed = parseWorkflowVersionMutationBody(req.body, {
    requireAtLeastOneField: true,
    requireWorkflowId: false,
    requireLabel: false,
    requireGraph: false,
    requireDefinition: false,
  });
  if (!parsed.ok) return parsed.response;

  const result = await ports.workflowVersions.update({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    id,
    values: parsed.values,
  });
  if (!result) return error(404, 'workflow_version_not_found', 'Workflow version nicht gefunden');
  if (!result.ok) return workflowVersionMutationError(result.code);

  const version = result.version;
  await auditWorkflowVersion(ports, principal, 'workflow_version.updated', version, {
    fields: Object.keys(parsed.values).sort(),
  });
  await publishWorkflowVersion(ports, principal.workspaceId, 'workflow_version.updated', version, principal.userId);
  return data(200, sanitizeWorkflowVersion(version));
}

async function handleWorkflowVersionDelete(
  ports: ServerApiPorts,
  principal: AuthenticatedPrincipal,
  id: number,
): Promise<ApiResponse> {
  if (!ports.workflowVersions?.delete) return unavailable('workflow_versions_unavailable', 'Workflow version API nicht konfiguriert');

  const version = await ports.workflowVersions.delete({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    id,
  });
  if (!version) return error(404, 'workflow_version_not_found', 'Workflow version nicht gefunden');

  await auditWorkflowVersion(ports, principal, 'workflow_version.deleted', version, { label: version.label });
  await publishWorkflowVersion(ports, principal.workspaceId, 'workflow_version.deleted', version, principal.userId);
  return data(200, { deleted: true, workflowVersion: sanitizeWorkflowVersion(version) });
}

function workflowVersionMutationError(code: 'workflow_not_found'): ApiResponse {
  return error(404, 'workflow_not_found', 'Workflow nicht gefunden');
}

async function handleWorkflowRunList(
  req: ApiRequest,
  ports: ServerApiPorts,
  forcedFilters: { workflowId?: number; messageId?: number } = {},
): Promise<ApiResponse> {
  if (req.method !== 'GET') return methodNotAllowed();
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  const base = parseNumericListBase(req);
  if (!base.ok) return base.response;
  const filters = parseRunFilters(req);
  if (!filters.ok) return filters.response;
  if (!ports.workflowRuns) return unavailable('workflow_runs_unavailable', 'Workflow run API nicht konfiguriert');
  const includeLog = filters.filters.includeLog;
  const result = await ports.workflowRuns.list({
    workspaceId: principal.workspaceId,
    ...base.filters,
    ...filters.filters,
    ...forcedFilters,
  });
  return data(200, sanitizeWorkflowRunList(result, includeLog));
}

async function handleWorkflowRunGet(
  req: ApiRequest,
  ports: ServerApiPorts,
  rawId: string | undefined,
): Promise<ApiResponse> {
  const includeLog = parseOptionalBoolean(req.query?.includeLog);
  if (includeLog === null) return error(400, 'invalid_include_log', 'includeLog muss true oder false sein');
  const route = prepareNumericGet(req, rawId, 'invalid_workflow_run_id', 'workflow run id muss eine positive Ganzzahl sein');
  if ('status' in route) return route;
  if (!ports.workflowRuns) return unavailable('workflow_runs_unavailable', 'Workflow run API nicht konfiguriert');
  const include = includeLog === true;
  const item = await ports.workflowRuns.get({ workspaceId: route.principal.workspaceId, id: route.id, includeLog: include });
  return item ? data(200, sanitizeWorkflowRun(item, include)) : error(404, 'workflow_run_not_found', 'Workflow run nicht gefunden');
}

async function handleWorkflowRunStepList(
  req: ApiRequest,
  ports: ServerApiPorts,
  forcedFilters: { runId?: number } = {},
): Promise<ApiResponse> {
  if (req.method !== 'GET') return methodNotAllowed();
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  const base = parseNumericListBase(req);
  if (!base.ok) return base.response;
  const filters = parseRunStepFilters(req);
  if (!filters.ok) return filters.response;
  if (!ports.workflowRunSteps) return unavailable('workflow_run_steps_unavailable', 'Workflow run step API nicht konfiguriert');
  const includeDetail = filters.filters.includeDetail;
  const result = await ports.workflowRunSteps.list({
    workspaceId: principal.workspaceId,
    ...base.filters,
    ...filters.filters,
    ...forcedFilters,
  });
  return data(200, sanitizeWorkflowRunStepList(result, includeDetail));
}

async function handleWorkflowRunStepGet(
  req: ApiRequest,
  ports: ServerApiPorts,
  rawId: string | undefined,
): Promise<ApiResponse> {
  const includeDetail = parseOptionalBoolean(req.query?.includeDetail);
  if (includeDetail === null) return error(400, 'invalid_include_detail', 'includeDetail muss true oder false sein');
  const route = prepareNumericGet(req, rawId, 'invalid_workflow_run_step_id', 'workflow run step id muss eine positive Ganzzahl sein');
  if ('status' in route) return route;
  if (!ports.workflowRunSteps) return unavailable('workflow_run_steps_unavailable', 'Workflow run step API nicht konfiguriert');
  const include = includeDetail === true;
  const item = await ports.workflowRunSteps.get({
    workspaceId: route.principal.workspaceId,
    id: route.id,
    includeDetail: include,
  });
  return item ? data(200, sanitizeWorkflowRunStep(item, include)) : error(404, 'workflow_run_step_not_found', 'Workflow run step nicht gefunden');
}

async function handleWorkflowMessageAppliedList(req: ApiRequest, ports: ServerApiPorts): Promise<ApiResponse> {
  if (req.method !== 'GET') return methodNotAllowed();
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  const base = parseNumericListBase(req);
  if (!base.ok) return base.response;
  const filters = parseMessageWorkflowFilters(req);
  if (!filters.ok) return filters.response;
  if (!ports.workflowMessageApplied) return unavailable('workflow_message_applied_unavailable', 'Workflow message-applied API nicht konfiguriert');
  const result = await ports.workflowMessageApplied.list({
    workspaceId: principal.workspaceId,
    ...base.filters,
    ...filters.filters,
  });
  return data(200, sanitizeWorkflowMessageAppliedList(result));
}

async function handleWorkflowMessageAppliedGet(
  req: ApiRequest,
  ports: ServerApiPorts,
  rawId: string | undefined,
): Promise<ApiResponse> {
  const route = prepareNumericGet(req, rawId, 'invalid_workflow_message_applied_id', 'workflow message-applied id muss eine positive Ganzzahl sein');
  if ('status' in route) return route;
  if (!ports.workflowMessageApplied) return unavailable('workflow_message_applied_unavailable', 'Workflow message-applied API nicht konfiguriert');
  const item = await ports.workflowMessageApplied.get({ workspaceId: route.principal.workspaceId, id: route.id });
  return item
    ? data(200, sanitizeWorkflowMessageApplied(item))
    : error(404, 'workflow_message_applied_not_found', 'Workflow message-applied entry nicht gefunden');
}

async function handleWorkflowForwardDedupList(req: ApiRequest, ports: ServerApiPorts): Promise<ApiResponse> {
  if (req.method !== 'GET') return methodNotAllowed();
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  const base = parseNumericListBase(req);
  if (!base.ok) return base.response;
  const filters = parseForwardDedupFilters(req);
  if (!filters.ok) return filters.response;
  if (!ports.workflowForwardDedup) return unavailable('workflow_forward_dedup_unavailable', 'Workflow forward-dedup API nicht konfiguriert');
  const result = await ports.workflowForwardDedup.list({
    workspaceId: principal.workspaceId,
    ...base.filters,
    ...filters.filters,
  });
  return data(200, sanitizeWorkflowForwardDedupList(result));
}

async function handleWorkflowForwardDedupGet(
  req: ApiRequest,
  ports: ServerApiPorts,
  rawId: string | undefined,
): Promise<ApiResponse> {
  const route = prepareNumericGet(req, rawId, 'invalid_workflow_forward_dedup_id', 'workflow forward-dedup id muss eine positive Ganzzahl sein');
  if ('status' in route) return route;
  if (!ports.workflowForwardDedup) return unavailable('workflow_forward_dedup_unavailable', 'Workflow forward-dedup API nicht konfiguriert');
  const item = await ports.workflowForwardDedup.get({ workspaceId: route.principal.workspaceId, id: route.id });
  return item
    ? data(200, sanitizeWorkflowForwardDedup(item))
    : error(404, 'workflow_forward_dedup_not_found', 'Workflow forward-dedup entry nicht gefunden');
}

async function handleKnowledgeBaseList(req: ApiRequest, ports: ServerApiPorts): Promise<ApiResponse> {
  if (req.method === 'POST') return handleKnowledgeBaseCreate(req, ports);
  if (req.method !== 'GET') return methodNotAllowed();
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  const base = parseNumericListBase(req);
  if (!base.ok) return base.response;
  const search = normalizeTextFilter(req.query?.search, 200);
  if (search === null) return error(400, 'invalid_search', 'search darf maximal 200 Zeichen haben');
  const accountId = parseOptionalPositiveInt(req.query?.accountId);
  if (accountId === null) return error(400, 'invalid_account_id', 'accountId muss eine positive Ganzzahl sein');
  if (!ports.workflowKnowledgeBases) return unavailable('workflow_knowledge_bases_unavailable', 'Workflow knowledge base API nicht konfiguriert');
  const result = await ports.workflowKnowledgeBases.list({
    workspaceId: principal.workspaceId,
    ...base.filters,
    ...(search === undefined ? {} : { search }),
    ...(accountId === undefined ? {} : { accountId }),
  });
  return data(200, sanitizeKnowledgeBaseList(result));
}

async function handleKnowledgeBaseGet(
  req: ApiRequest,
  ports: ServerApiPorts,
  rawId: string | undefined,
): Promise<ApiResponse> {
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  const id = positiveIntFromPath(rawId);
  if (id === null) return error(400, 'invalid_workflow_knowledge_base_id', 'workflow knowledge base id muss eine positive Ganzzahl sein');
  if (req.method === 'PATCH') return handleKnowledgeBaseUpdate(req, ports, principal, id);
  if (req.method === 'DELETE') return handleKnowledgeBaseDelete(ports, principal, id);
  if (req.method !== 'GET') return methodNotAllowed();
  if (!ports.workflowKnowledgeBases) return unavailable('workflow_knowledge_bases_unavailable', 'Workflow knowledge base API nicht konfiguriert');
  const item = await ports.workflowKnowledgeBases.get({ workspaceId: principal.workspaceId, id });
  return item ? data(200, sanitizeKnowledgeBase(item)) : error(404, 'workflow_knowledge_base_not_found', 'Workflow knowledge base nicht gefunden');
}

async function handleKnowledgeBaseCreate(req: ApiRequest, ports: ServerApiPorts): Promise<ApiResponse> {
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  if (!ports.workflowKnowledgeBases?.create) return unavailable('workflow_knowledge_bases_unavailable', 'Workflow knowledge base API nicht konfiguriert');

  const parsed = parseKnowledgeBaseMutationBody(req.body, {
    requireAtLeastOneField: true,
    requireName: true,
  });
  if (!parsed.ok) return parsed.response;

  const base = await ports.workflowKnowledgeBases.create({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    values: parsed.values,
  });
  await auditKnowledgeBase(ports, principal, 'workflow_knowledge_base.created', base, { name: base.name });
  await publishKnowledgeBase(ports, principal.workspaceId, 'workflow_knowledge_base.created', base, principal.userId);
  return data(201, sanitizeKnowledgeBase(base));
}

async function handleKnowledgeBaseUpdate(
  req: ApiRequest,
  ports: ServerApiPorts,
  principal: AuthenticatedPrincipal,
  id: number,
): Promise<ApiResponse> {
  if (!ports.workflowKnowledgeBases?.update) return unavailable('workflow_knowledge_bases_unavailable', 'Workflow knowledge base API nicht konfiguriert');

  const parsed = parseKnowledgeBaseMutationBody(req.body, {
    requireAtLeastOneField: true,
    requireName: false,
  });
  if (!parsed.ok) return parsed.response;

  const base = await ports.workflowKnowledgeBases.update({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    id,
    values: parsed.values,
  });
  if (!base) return error(404, 'workflow_knowledge_base_not_found', 'Workflow knowledge base nicht gefunden');

  await auditKnowledgeBase(ports, principal, 'workflow_knowledge_base.updated', base, {
    fields: Object.keys(parsed.values).sort(),
  });
  await publishKnowledgeBase(ports, principal.workspaceId, 'workflow_knowledge_base.updated', base, principal.userId);
  return data(200, sanitizeKnowledgeBase(base));
}

async function handleKnowledgeBaseDelete(
  ports: ServerApiPorts,
  principal: AuthenticatedPrincipal,
  id: number,
): Promise<ApiResponse> {
  if (!ports.workflowKnowledgeBases?.delete) return unavailable('workflow_knowledge_bases_unavailable', 'Workflow knowledge base API nicht konfiguriert');

  const base = await ports.workflowKnowledgeBases.delete({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    id,
  });
  if (!base) return error(404, 'workflow_knowledge_base_not_found', 'Workflow knowledge base nicht gefunden');

  await auditKnowledgeBase(ports, principal, 'workflow_knowledge_base.deleted', base, { name: base.name });
  await publishKnowledgeBase(ports, principal.workspaceId, 'workflow_knowledge_base.deleted', base, principal.userId);
  return data(200, { deleted: true, knowledgeBase: sanitizeKnowledgeBase(base) });
}

async function handleKnowledgeChunkList(req: ApiRequest, ports: ServerApiPorts): Promise<ApiResponse> {
  if (req.method === 'POST') return handleKnowledgeChunkCreate(req, ports);
  if (req.method !== 'GET') return methodNotAllowed();
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  const base = parseNumericListBase(req);
  if (!base.ok) return base.response;
  const filters = parseKnowledgeChunkFilters(req);
  if (!filters.ok) return filters.response;
  if (!ports.workflowKnowledgeChunks) return unavailable('workflow_knowledge_chunks_unavailable', 'Workflow knowledge chunk API nicht konfiguriert');
  const includeContent = filters.filters.includeContent;
  const result = await ports.workflowKnowledgeChunks.list({
    workspaceId: principal.workspaceId,
    ...base.filters,
    ...filters.filters,
  });
  return data(200, sanitizeKnowledgeChunkList(result, includeContent));
}

async function handleKnowledgeChunkGet(
  req: ApiRequest,
  ports: ServerApiPorts,
  rawId: string | undefined,
): Promise<ApiResponse> {
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  const id = positiveIntFromPath(rawId);
  if (id === null) return error(400, 'invalid_workflow_knowledge_chunk_id', 'workflow knowledge chunk id muss eine positive Ganzzahl sein');
  if (req.method === 'PATCH') return handleKnowledgeChunkUpdate(req, ports, principal, id);
  if (req.method === 'DELETE') return handleKnowledgeChunkDelete(ports, principal, id);
  if (req.method !== 'GET') return methodNotAllowed();
  const includeContent = parseOptionalBoolean(req.query?.includeContent);
  if (includeContent === null) return error(400, 'invalid_include_content', 'includeContent muss true oder false sein');
  if (!ports.workflowKnowledgeChunks) return unavailable('workflow_knowledge_chunks_unavailable', 'Workflow knowledge chunk API nicht konfiguriert');
  const include = includeContent === true;
  const item = await ports.workflowKnowledgeChunks.get({
    workspaceId: principal.workspaceId,
    id,
    includeContent: include,
  });
  return item ? data(200, sanitizeKnowledgeChunk(item, include)) : error(404, 'workflow_knowledge_chunk_not_found', 'Workflow knowledge chunk nicht gefunden');
}

async function handleKnowledgeChunkCreate(req: ApiRequest, ports: ServerApiPorts): Promise<ApiResponse> {
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  if (!ports.workflowKnowledgeChunks?.create) return unavailable('workflow_knowledge_chunks_unavailable', 'Workflow knowledge chunk API nicht konfiguriert');

  const parsed = parseKnowledgeChunkMutationBody(req.body, {
    requireAtLeastOneField: true,
    requireKnowledgeBaseId: true,
    requireContent: true,
  });
  if (!parsed.ok) return parsed.response;

  const result = await ports.workflowKnowledgeChunks.create({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    values: parsed.values,
  });
  if (!result.ok) return knowledgeChunkMutationError(result.code);

  await auditKnowledgeChunk(ports, principal, 'workflow_knowledge_chunk.created', result.chunk, {
    knowledgeBaseId: result.chunk.knowledgeBaseId,
    title: result.chunk.title,
    sourcePath: result.chunk.sourcePath,
    contentLength: parsed.values.content?.length ?? 0,
  });
  await publishKnowledgeChunk(ports, principal.workspaceId, 'workflow_knowledge_chunk.created', result.chunk, principal.userId);
  return data(201, sanitizeKnowledgeChunk(result.chunk, false));
}

async function handleKnowledgeChunkUpdate(
  req: ApiRequest,
  ports: ServerApiPorts,
  principal: AuthenticatedPrincipal,
  id: number,
): Promise<ApiResponse> {
  if (!ports.workflowKnowledgeChunks?.update) return unavailable('workflow_knowledge_chunks_unavailable', 'Workflow knowledge chunk API nicht konfiguriert');

  const parsed = parseKnowledgeChunkMutationBody(req.body, {
    requireAtLeastOneField: true,
    requireKnowledgeBaseId: false,
    requireContent: false,
  });
  if (!parsed.ok) return parsed.response;

  const result = await ports.workflowKnowledgeChunks.update({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    id,
    values: parsed.values,
  });
  if (!result) return error(404, 'workflow_knowledge_chunk_not_found', 'Workflow knowledge chunk nicht gefunden');
  if (!result.ok) return knowledgeChunkMutationError(result.code);

  await auditKnowledgeChunk(ports, principal, 'workflow_knowledge_chunk.updated', result.chunk, {
    fields: Object.keys(parsed.values).sort(),
  });
  await publishKnowledgeChunk(ports, principal.workspaceId, 'workflow_knowledge_chunk.updated', result.chunk, principal.userId);
  return data(200, sanitizeKnowledgeChunk(result.chunk, false));
}

async function handleKnowledgeChunkDelete(
  ports: ServerApiPorts,
  principal: AuthenticatedPrincipal,
  id: number,
): Promise<ApiResponse> {
  if (!ports.workflowKnowledgeChunks?.delete) return unavailable('workflow_knowledge_chunks_unavailable', 'Workflow knowledge chunk API nicht konfiguriert');

  const chunk = await ports.workflowKnowledgeChunks.delete({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    id,
  });
  if (!chunk) return error(404, 'workflow_knowledge_chunk_not_found', 'Workflow knowledge chunk nicht gefunden');

  await auditKnowledgeChunk(ports, principal, 'workflow_knowledge_chunk.deleted', chunk, { title: chunk.title });
  await publishKnowledgeChunk(ports, principal.workspaceId, 'workflow_knowledge_chunk.deleted', chunk, principal.userId);
  return data(200, { deleted: true, knowledgeChunk: sanitizeKnowledgeChunk(chunk, false) });
}

function knowledgeChunkMutationError(code: 'knowledge_base_not_found'): ApiResponse {
  return error(404, 'workflow_knowledge_base_not_found', 'Workflow knowledge base nicht gefunden');
}

async function handleDelayedJobList(req: ApiRequest, ports: ServerApiPorts): Promise<ApiResponse> {
  if (req.method === 'POST') return handleDelayedJobCreate(req, ports);
  if (req.method !== 'GET') return methodNotAllowed();
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  const base = parseNumericListBase(req);
  if (!base.ok) return base.response;
  const filters = parseDelayedJobFilters(req);
  if (!filters.ok) return filters.response;
  if (!ports.workflowDelayedJobs) return unavailable('workflow_delayed_jobs_unavailable', 'Workflow delayed job API nicht konfiguriert');
  const includeContext = filters.filters.includeContext;
  const result = await ports.workflowDelayedJobs.list({
    workspaceId: principal.workspaceId,
    ...base.filters,
    ...filters.filters,
  });
  return data(200, sanitizeDelayedJobList(result, includeContext));
}

async function handleDelayedJobGet(
  req: ApiRequest,
  ports: ServerApiPorts,
  rawId: string | undefined,
): Promise<ApiResponse> {
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  const id = positiveIntFromPath(rawId);
  if (id === null) return error(400, 'invalid_workflow_delayed_job_id', 'workflow delayed job id muss eine positive Ganzzahl sein');
  if (req.method === 'PATCH') return handleDelayedJobUpdate(req, ports, principal, id);
  if (req.method === 'DELETE') return handleDelayedJobDelete(ports, principal, id);
  if (req.method !== 'GET') return methodNotAllowed();
  const includeContext = parseOptionalBoolean(req.query?.includeContext);
  if (includeContext === null) return error(400, 'invalid_include_context', 'includeContext muss true oder false sein');
  if (!ports.workflowDelayedJobs) return unavailable('workflow_delayed_jobs_unavailable', 'Workflow delayed job API nicht konfiguriert');
  const include = includeContext === true;
  const item = await ports.workflowDelayedJobs.get({
    workspaceId: principal.workspaceId,
    id,
    includeContext: include,
  });
  return item ? data(200, sanitizeDelayedJob(item, include)) : error(404, 'workflow_delayed_job_not_found', 'Workflow delayed job nicht gefunden');
}

async function handleDelayedJobCreate(req: ApiRequest, ports: ServerApiPorts): Promise<ApiResponse> {
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  // Creating a delayed job forges queued workflow.execute runtime state (a
  // workflow-management operation), just like the update/delete handlers below.
  // A delayed job may carry no messageId, so the route policy resolves non_mail
  // and the mail ACL cannot gate it — enforce the capability here.
  if (!requireCapability(principal, 'workflows.manage')) {
    return error(403, 'forbidden', 'Workflow-Berechtigung erforderlich');
  }
  if (!ports.workflowDelayedJobs?.create) return unavailable('workflow_delayed_jobs_unavailable', 'Workflow delayed job API nicht konfiguriert');

  const parsed = parseDelayedJobMutationBody(req.body, {
    requireAtLeastOneField: true,
    requireWorkflowId: true,
    requireExecuteAt: true,
    requireStatus: true,
  });
  if (!parsed.ok) return parsed.response;

  const result = await ports.workflowDelayedJobs.create({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    values: parsed.values,
  });
  if (!result.ok) return delayedJobMutationError(result.code);

  await auditDelayedJob(ports, principal, 'workflow_delayed_job.created', result.job, {
    workflowId: result.job.workflowId,
    messageId: result.job.messageId,
    status: result.job.status,
    executeAt: result.job.executeAt,
    hasContext: parsed.values.context !== undefined && parsed.values.context !== null,
  });
  await publishDelayedJob(ports, principal.workspaceId, 'workflow_delayed_job.created', result.job, principal.userId);
  return data(201, sanitizeDelayedJob(result.job, false));
}

async function handleDelayedJobUpdate(
  req: ApiRequest,
  ports: ServerApiPorts,
  principal: AuthenticatedPrincipal,
  id: number,
): Promise<ApiResponse> {
  // Mutating a delayed job can redirect or cancel a queued workflow.execute
  // (resume node, context, workflow, status) — a workflow-management operation,
  // not something mail.content.read alone should allow.
  if (!requireCapability(principal, 'workflows.manage')) {
    return error(403, 'forbidden', 'Workflow-Berechtigung erforderlich');
  }
  if (!ports.workflowDelayedJobs?.update) return unavailable('workflow_delayed_jobs_unavailable', 'Workflow delayed job API nicht konfiguriert');

  const parsed = parseDelayedJobMutationBody(req.body, {
    requireAtLeastOneField: true,
    requireWorkflowId: false,
    requireExecuteAt: false,
    requireStatus: false,
  });
  if (!parsed.ok) return parsed.response;

  // Redirecting a delayed job (resumeNodeId/context) does not re-enqueue the backing
  // workflow.execute — that job keeps the initiating admin's actorUserId, so at
  // resume the async side-effect gate (which only denies non-admin ACTORS) is
  // bypassed and the chosen node runs under the admin's authority. A non-admin
  // workflows.manage holder could thus jump an admin-originated run to a writing node
  // the live-execution route (workflow-routes.ts) forbids them from running. Mirror
  // that route's admin gate for redirect edits on a side-effecting workflow. Reschedule
  // (executeAt) and cancel (status) edits stay open to workflows.manage.
  if (
    (parsed.values.resumeNodeId !== undefined || parsed.values.context !== undefined)
    && !requireAdmin(principal)
  ) {
    if (!ports.workflows) return unavailable('workflows_unavailable', 'Workflow API nicht konfiguriert');
    const existing = await ports.workflowDelayedJobs.get({
      workspaceId: principal.workspaceId,
      id,
      includeContext: false,
    });
    if (!existing) return error(404, 'workflow_delayed_job_not_found', 'Workflow delayed job nicht gefunden');
    if (existing.workflowId !== null) {
      const workflow = await ports.workflows.get({ workspaceId: principal.workspaceId, id: existing.workflowId });
      if (workflow && workflowGraphHasSideEffectNode(workflow.graph)) {
        return error(403, 'forbidden', 'Umleiten von Workflows mit schreibenden Knoten erfordert Adminrechte');
      }
    }
  }

  const result = await ports.workflowDelayedJobs.update({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    id,
    values: parsed.values,
  });
  if (!result) return error(404, 'workflow_delayed_job_not_found', 'Workflow delayed job nicht gefunden');
  if (!result.ok) return delayedJobMutationError(result.code);

  await auditDelayedJob(ports, principal, 'workflow_delayed_job.updated', result.job, {
    fields: Object.keys(parsed.values).sort(),
  });
  await publishDelayedJob(ports, principal.workspaceId, 'workflow_delayed_job.updated', result.job, principal.userId);
  return data(200, sanitizeDelayedJob(result.job, false));
}

async function handleDelayedJobDelete(
  ports: ServerApiPorts,
  principal: AuthenticatedPrincipal,
  id: number,
): Promise<ApiResponse> {
  // Deleting a delayed job removes the row backing a queued workflow.execute —
  // a workflow-management operation, not something mail.content.read allows.
  if (!requireCapability(principal, 'workflows.manage')) {
    return error(403, 'forbidden', 'Workflow-Berechtigung erforderlich');
  }
  if (!ports.workflowDelayedJobs?.delete) return unavailable('workflow_delayed_jobs_unavailable', 'Workflow delayed job API nicht konfiguriert');

  const job = await ports.workflowDelayedJobs.delete({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    id,
  });
  if (!job) return error(404, 'workflow_delayed_job_not_found', 'Workflow delayed job nicht gefunden');

  await auditDelayedJob(ports, principal, 'workflow_delayed_job.deleted', job, {
    workflowId: job.workflowId,
    messageId: job.messageId,
    status: job.status,
  });
  await publishDelayedJob(ports, principal.workspaceId, 'workflow_delayed_job.deleted', job, principal.userId);
  return data(200, { deleted: true, delayedJob: sanitizeDelayedJob(job, false) });
}

function delayedJobMutationError(code: 'workflow_not_found' | 'message_not_found'): ApiResponse {
  if (code === 'workflow_not_found') return error(404, 'workflow_not_found', 'Workflow nicht gefunden');
  return error(404, 'email_message_not_found', 'E-Mail-Nachricht nicht gefunden');
}

async function resolveWorkflowSourceRoute(
  req: ApiRequest,
  ports: ServerApiPorts,
  rawWorkflowSourceSqliteId: string | undefined,
): Promise<
  | { principal: AuthenticatedPrincipal; workflow: WorkflowRecord }
  | ApiResponse
> {
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  const sourceSqliteId = parseNonZeroInt(rawWorkflowSourceSqliteId);
  if (sourceSqliteId === null) {
    return error(400, 'invalid_workflow_source_sqlite_id', 'Workflow sourceSqliteId muss eine Ganzzahl ungleich 0 sein');
  }
  if (!ports.workflows) return unavailable('workflows_unavailable', 'Workflow API nicht konfiguriert');

  const workflow = await findWorkflowBySourceSqliteId(ports, principal.workspaceId, sourceSqliteId);
  return workflow
    ? { principal, workflow }
    : error(404, 'workflow_not_found', 'Workflow nicht gefunden');
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

async function findWorkflowVersionBySourceSqliteId(
  ports: ServerApiPorts,
  workspaceId: string,
  sourceSqliteId: number,
): Promise<WorkflowVersionRecord | null> {
  let cursor: number | undefined;
  const seenCursors = new Set<number>();
  for (;;) {
    const page = await ports.workflowVersions!.list({
      workspaceId,
      limit: MAX_LIMIT,
      ...(cursor === undefined ? {} : { cursor }),
    });
    const found = page.items.find((version) => version.sourceSqliteId === sourceSqliteId);
    if (found) return found;
    if (page.nextCursor === null) return null;
    if (seenCursors.has(page.nextCursor)) return null;
    seenCursors.add(page.nextCursor);
    cursor = page.nextCursor;
  }
}

async function findWorkflowRunBySourceSqliteId(
  ports: ServerApiPorts,
  workspaceId: string,
  sourceSqliteId: number,
): Promise<WorkflowRunRecord | null> {
  let cursor: number | undefined;
  const seenCursors = new Set<number>();
  for (;;) {
    const page = await ports.workflowRuns!.list({
      workspaceId,
      limit: MAX_LIMIT,
      includeLog: false,
      ...(cursor === undefined ? {} : { cursor }),
    });
    const found = page.items.find((run) => run.sourceSqliteId === sourceSqliteId);
    if (found) return found;
    if (page.nextCursor === null) return null;
    if (seenCursors.has(page.nextCursor)) return null;
    seenCursors.add(page.nextCursor);
    cursor = page.nextCursor;
  }
}

function parseOptionalLabel(body: unknown): string | undefined | null {
  if (body === undefined || body === null) return undefined;
  if (!isPlainObject(body)) return null;
  for (const key of Object.keys(body)) {
    if (key !== 'label') return null;
  }
  if (!Object.prototype.hasOwnProperty.call(body, 'label')) return undefined;
  if (typeof body.label !== 'string') return null;
  const label = body.label.trim();
  return label || undefined;
}

function parseOptionalBodyNonZeroInt(body: unknown, field: string): number | undefined | null {
  if (body === undefined || body === null) return undefined;
  if (!isPlainObject(body)) return null;
  for (const key of Object.keys(body)) {
    if (key !== field) return null;
  }
  if (!Object.prototype.hasOwnProperty.call(body, field)) return undefined;
  const value = body[field];
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  return parseNonZeroInt(String(value));
}

function defaultWorkflowVersionLabel(): string {
  const timestamp = new Date().toISOString();
  return `v ${timestamp.slice(0, 16).replace('T', ' ')}`;
}

function parseWorkflowVersionMutationBody(
  body: unknown,
  options: {
    requireAtLeastOneField: boolean;
    requireWorkflowId: boolean;
    requireLabel: boolean;
    requireGraph: boolean;
    requireDefinition: boolean;
  },
): WorkflowVersionMutationParseResult {
  if (!isPlainObject(body)) {
    return {
      ok: false,
      response: error(400, 'invalid_workflow_version_payload', 'Workflow version payload muss ein JSON-Objekt sein'),
    };
  }

  const values: WorkflowVersionMutationInput = {};
  const errors: Array<{ field: string; message: string }> = [];
  const allowedFields = new Set(['workflowId', 'label', 'graph', 'definition']);

  for (const key of Object.keys(body)) {
    if (!allowedFields.has(key)) errors.push({ field: key, message: 'Feld ist nicht erlaubt' });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'workflowId')) {
    const workflowId = normalizePositiveBodyInt(body.workflowId, 'workflowId');
    if (workflowId.ok) values.workflowId = workflowId.value;
    else errors.push({ field: 'workflowId', message: workflowId.message });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'label')) {
    const label = normalizeRequiredBodyText(body.label, 'label', 200);
    if (label.ok) values.label = label.value;
    else errors.push({ field: 'label', message: label.message });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'graph')) {
    const graph = normalizeBodyJsonObject(body.graph, 'graph');
    if (graph.ok) values.graph = graph.value;
    else errors.push({ field: 'graph', message: graph.message });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'definition')) {
    const definition = normalizeBodyJsonObject(body.definition, 'definition');
    if (definition.ok) values.definition = definition.value;
    else errors.push({ field: 'definition', message: definition.message });
  }

  if (errors.length > 0) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'Workflow version payload ist ungueltig', { fields: errors }),
    };
  }
  if (options.requireAtLeastOneField && Object.keys(values).length === 0) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'Workflow version mutation braucht mindestens ein Feld'),
    };
  }
  if (options.requireWorkflowId && values.workflowId === undefined) {
    return { ok: false, response: error(400, 'validation_error', 'workflowId ist erforderlich') };
  }
  if (options.requireLabel && values.label === undefined) {
    return { ok: false, response: error(400, 'validation_error', 'label ist erforderlich') };
  }
  if (options.requireGraph && values.graph === undefined) {
    return { ok: false, response: error(400, 'validation_error', 'graph ist erforderlich') };
  }
  if (options.requireDefinition && values.definition === undefined) {
    return { ok: false, response: error(400, 'validation_error', 'definition ist erforderlich') };
  }

  return { ok: true, values };
}

function parseKnowledgeBaseMutationBody(
  body: unknown,
  options: {
    requireAtLeastOneField: boolean;
    requireName: boolean;
  },
): WorkflowKnowledgeBaseMutationParseResult {
  if (!isPlainObject(body)) {
    return {
      ok: false,
      response: error(400, 'invalid_workflow_knowledge_base_payload', 'Workflow knowledge base payload muss ein JSON-Objekt sein'),
    };
  }

  const values: WorkflowKnowledgeBaseMutationInput = {};
  const errors: Array<{ field: string; message: string }> = [];
  const allowedFields = new Set(['name', 'description', 'accountId', 'overrideKey', 'knowledgeContext']);

  for (const key of Object.keys(body)) {
    if (!allowedFields.has(key)) errors.push({ field: key, message: 'Feld ist nicht erlaubt' });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'name')) {
    const name = normalizeRequiredBodyText(body.name, 'name', 200);
    if (name.ok) values.name = name.value;
    else errors.push({ field: 'name', message: name.message });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'description')) {
    const description = normalizeNullableBodyText(body.description, 'description', 2000);
    if (description.ok) values.description = description.value;
    else errors.push({ field: 'description', message: description.message });
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
  if (Object.prototype.hasOwnProperty.call(body, 'knowledgeContext')) {
    const knowledgeContext = normalizeNullableBodyText(body.knowledgeContext, 'knowledgeContext', 32);
    if (knowledgeContext.ok) values.knowledgeContext = knowledgeContext.value;
    else errors.push({ field: 'knowledgeContext', message: knowledgeContext.message });
  }

  if (errors.length > 0) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'Workflow knowledge base payload ist ungueltig', { fields: errors }),
    };
  }
  if (options.requireAtLeastOneField && Object.keys(values).length === 0) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'Workflow knowledge base mutation braucht mindestens ein Feld'),
    };
  }
  if (options.requireName && values.name === undefined) {
    return { ok: false, response: error(400, 'validation_error', 'name ist erforderlich') };
  }

  return { ok: true, values };
}

function parseKnowledgeChunkMutationBody(
  body: unknown,
  options: {
    requireAtLeastOneField: boolean;
    requireKnowledgeBaseId: boolean;
    requireContent: boolean;
  },
): WorkflowKnowledgeChunkMutationParseResult {
  if (!isPlainObject(body)) {
    return {
      ok: false,
      response: error(400, 'invalid_workflow_knowledge_chunk_payload', 'Workflow knowledge chunk payload muss ein JSON-Objekt sein'),
    };
  }

  const values: WorkflowKnowledgeChunkMutationInput = {};
  const errors: Array<{ field: string; message: string }> = [];
  const allowedFields = new Set(['knowledgeBaseId', 'title', 'content', 'sourcePath']);

  for (const key of Object.keys(body)) {
    if (!allowedFields.has(key)) errors.push({ field: key, message: 'Feld ist nicht erlaubt' });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'knowledgeBaseId')) {
    const knowledgeBaseId = normalizePositiveBodyInt(body.knowledgeBaseId, 'knowledgeBaseId');
    if (knowledgeBaseId.ok) values.knowledgeBaseId = knowledgeBaseId.value;
    else errors.push({ field: 'knowledgeBaseId', message: knowledgeBaseId.message });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'title')) {
    const title = normalizeNullableBodyText(body.title, 'title', 500);
    if (title.ok) values.title = title.value;
    else errors.push({ field: 'title', message: title.message });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'content')) {
    const content = normalizeRequiredBodyText(body.content, 'content', 100000);
    if (content.ok) values.content = content.value;
    else errors.push({ field: 'content', message: content.message });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'sourcePath')) {
    const sourcePath = normalizeNullableBodyText(body.sourcePath, 'sourcePath', 1000);
    if (sourcePath.ok) values.sourcePath = sourcePath.value;
    else errors.push({ field: 'sourcePath', message: sourcePath.message });
  }

  if (errors.length > 0) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'Workflow knowledge chunk payload ist ungueltig', { fields: errors }),
    };
  }
  if (options.requireAtLeastOneField && Object.keys(values).length === 0) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'Workflow knowledge chunk mutation braucht mindestens ein Feld'),
    };
  }
  if (options.requireKnowledgeBaseId && values.knowledgeBaseId === undefined) {
    return { ok: false, response: error(400, 'validation_error', 'knowledgeBaseId ist erforderlich') };
  }
  if (options.requireContent && values.content === undefined) {
    return { ok: false, response: error(400, 'validation_error', 'content ist erforderlich') };
  }

  return { ok: true, values };
}

function parseNumericListBase(req: ApiRequest): ParseResult<{ cursor?: number; limit: number }> {
  const limit = parseLimit(req.query?.limit);
  if (limit === null) return parseError('invalid_limit', `limit muss zwischen 1 und ${MAX_LIMIT} liegen`);
  const cursor = parseOptionalPositiveInt(req.query?.cursor);
  if (cursor === null) return parseError('invalid_cursor', 'cursor muss eine positive Ganzzahl sein');
  return { ok: true, filters: { limit, ...(cursor === undefined ? {} : { cursor }) } };
}

function parseVersionFilters(req: ApiRequest): ParseResult<{ workflowId?: number; search?: string }> {
  const workflowId = parseOptionalPositiveInt(req.query?.workflowId);
  if (workflowId === null) return parseError('invalid_workflow_id', 'workflowId muss eine positive Ganzzahl sein');
  const search = normalizeTextFilter(req.query?.search, 200);
  if (search === null) return parseError('invalid_search', 'search darf maximal 200 Zeichen haben');
  return { ok: true, filters: omitUndefined({ workflowId, search }) };
}

function parseRunFilters(req: ApiRequest): ParseResult<{
  workflowId?: number;
  messageId?: number;
  direction?: string;
  status?: string;
  includeLog: boolean;
}> {
  const workflowId = parseOptionalPositiveInt(req.query?.workflowId);
  if (workflowId === null) return parseError('invalid_workflow_id', 'workflowId muss eine positive Ganzzahl sein');
  const messageId = parseOptionalPositiveInt(req.query?.messageId);
  if (messageId === null) return parseError('invalid_message_id', 'messageId muss eine positive Ganzzahl sein');
  const direction = normalizeTextFilter(req.query?.direction, 50);
  if (direction === null) return parseError('invalid_direction', 'direction darf maximal 50 Zeichen haben');
  const status = normalizeTextFilter(req.query?.status, 100);
  if (status === null) return parseError('invalid_status', 'status darf maximal 100 Zeichen haben');
  const includeLog = parseOptionalBoolean(req.query?.includeLog);
  if (includeLog === null) return parseError('invalid_include_log', 'includeLog muss true oder false sein');
  return { ok: true, filters: omitUndefined({ workflowId, messageId, direction, status, includeLog: includeLog === true }) };
}

function parseRunStepFilters(req: ApiRequest): ParseResult<{
  runId?: number;
  nodeId?: string;
  nodeType?: string;
  status?: string;
  includeDetail: boolean;
}> {
  const runId = parseOptionalPositiveInt(req.query?.runId);
  if (runId === null) return parseError('invalid_workflow_run_id', 'runId muss eine positive Ganzzahl sein');
  const nodeId = normalizeTextFilter(req.query?.nodeId, 200);
  if (nodeId === null) return parseError('invalid_node_id', 'nodeId darf maximal 200 Zeichen haben');
  const nodeType = normalizeTextFilter(req.query?.nodeType, 100);
  if (nodeType === null) return parseError('invalid_node_type', 'nodeType darf maximal 100 Zeichen haben');
  const status = normalizeTextFilter(req.query?.status, 100);
  if (status === null) return parseError('invalid_status', 'status darf maximal 100 Zeichen haben');
  const includeDetail = parseOptionalBoolean(req.query?.includeDetail);
  if (includeDetail === null) return parseError('invalid_include_detail', 'includeDetail muss true oder false sein');
  return { ok: true, filters: omitUndefined({ runId, nodeId, nodeType, status, includeDetail: includeDetail === true }) };
}

function parseMessageWorkflowFilters(req: ApiRequest): ParseResult<{ messageId?: number; workflowId?: number }> {
  const messageId = parseOptionalPositiveInt(req.query?.messageId);
  if (messageId === null) return parseError('invalid_message_id', 'messageId muss eine positive Ganzzahl sein');
  const workflowId = parseOptionalPositiveInt(req.query?.workflowId);
  if (workflowId === null) return parseError('invalid_workflow_id', 'workflowId muss eine positive Ganzzahl sein');
  return { ok: true, filters: omitUndefined({ messageId, workflowId }) };
}

function parseForwardDedupFilters(req: ApiRequest): ParseResult<{ messageId?: number; workflowId?: number; dest?: string }> {
  const base = parseMessageWorkflowFilters(req);
  if (!base.ok) return base;
  const dest = normalizeTextFilter(req.query?.dest, 300);
  if (dest === null) return parseError('invalid_dest', 'dest darf maximal 300 Zeichen haben');
  return { ok: true, filters: omitUndefined({ ...base.filters, dest }) };
}

function parseKnowledgeChunkFilters(req: ApiRequest): ParseResult<{
  knowledgeBaseId?: number;
  search?: string;
  includeContent: boolean;
}> {
  const knowledgeBaseId = parseOptionalPositiveInt(req.query?.knowledgeBaseId);
  if (knowledgeBaseId === null) return parseError('invalid_knowledge_base_id', 'knowledgeBaseId muss eine positive Ganzzahl sein');
  const search = normalizeTextFilter(req.query?.search, 200);
  if (search === null) return parseError('invalid_search', 'search darf maximal 200 Zeichen haben');
  const includeContent = parseOptionalBoolean(req.query?.includeContent);
  if (includeContent === null) return parseError('invalid_include_content', 'includeContent muss true oder false sein');
  return { ok: true, filters: omitUndefined({ knowledgeBaseId, search, includeContent: includeContent === true }) };
}

function parseDelayedJobFilters(req: ApiRequest): ParseResult<{
  workflowId?: number;
  messageId?: number;
  status?: string;
  includeContext: boolean;
}> {
  const workflowId = parseOptionalPositiveInt(req.query?.workflowId);
  if (workflowId === null) return parseError('invalid_workflow_id', 'workflowId muss eine positive Ganzzahl sein');
  const messageId = parseOptionalPositiveInt(req.query?.messageId);
  if (messageId === null) return parseError('invalid_message_id', 'messageId muss eine positive Ganzzahl sein');
  const status = normalizeTextFilter(req.query?.status, 100);
  if (status === null) return parseError('invalid_status', 'status darf maximal 100 Zeichen haben');
  const includeContext = parseOptionalBoolean(req.query?.includeContext);
  if (includeContext === null) return parseError('invalid_include_context', 'includeContext muss true oder false sein');
  return { ok: true, filters: omitUndefined({ workflowId, messageId, status, includeContext: includeContext === true }) };
}

function parseDelayedJobMutationBody(
  body: unknown,
  options: {
    requireAtLeastOneField: boolean;
    requireWorkflowId: boolean;
    requireExecuteAt: boolean;
    requireStatus: boolean;
  },
): WorkflowDelayedJobMutationParseResult {
  if (!isPlainObject(body)) {
    return {
      ok: false,
      response: error(400, 'invalid_workflow_delayed_job_payload', 'Workflow delayed job payload muss ein JSON-Objekt sein'),
    };
  }

  const values: WorkflowDelayedJobMutationInput = {};
  const errors: Array<{ field: string; message: string }> = [];
  const allowedFields = new Set(['workflowId', 'messageId', 'resumeNodeId', 'executeAt', 'context', 'status']);

  for (const key of Object.keys(body)) {
    if (!allowedFields.has(key)) errors.push({ field: key, message: 'Feld ist nicht erlaubt' });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'workflowId')) {
    const workflowId = normalizePositiveBodyInt(body.workflowId, 'workflowId');
    if (workflowId.ok) values.workflowId = workflowId.value;
    else errors.push({ field: 'workflowId', message: workflowId.message });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'messageId')) {
    if (body.messageId === null) {
      values.messageId = null;
    } else {
      const messageId = normalizePositiveBodyInt(body.messageId, 'messageId');
      if (messageId.ok) values.messageId = messageId.value;
      else errors.push({ field: 'messageId', message: messageId.message });
    }
  }
  if (Object.prototype.hasOwnProperty.call(body, 'resumeNodeId')) {
    const resumeNodeId = normalizeNullableBodyText(body.resumeNodeId, 'resumeNodeId', 200);
    if (resumeNodeId.ok) values.resumeNodeId = resumeNodeId.value;
    else errors.push({ field: 'resumeNodeId', message: resumeNodeId.message });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'executeAt')) {
    const executeAt = normalizeRequiredBodyTimestamp(body.executeAt, 'executeAt');
    if (executeAt.ok) values.executeAt = executeAt.value;
    else errors.push({ field: 'executeAt', message: executeAt.message });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'context')) {
    if (body.context === null) {
      values.context = null;
    } else {
      const context = normalizeBodyJsonObject(body.context, 'context');
      if (context.ok) values.context = context.value;
      else errors.push({ field: 'context', message: context.message });
    }
  }
  if (Object.prototype.hasOwnProperty.call(body, 'status')) {
    const status = normalizeRequiredBodyText(body.status, 'status', 100);
    if (status.ok) values.status = status.value;
    else errors.push({ field: 'status', message: status.message });
  }

  if (errors.length > 0) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'Workflow delayed job payload ist ungueltig', { fields: errors }),
    };
  }
  if (options.requireAtLeastOneField && Object.keys(values).length === 0) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'Workflow delayed job mutation braucht mindestens ein Feld'),
    };
  }
  if (options.requireWorkflowId && values.workflowId === undefined) {
    return { ok: false, response: error(400, 'validation_error', 'workflowId ist erforderlich') };
  }
  if (options.requireExecuteAt && values.executeAt === undefined) {
    return { ok: false, response: error(400, 'validation_error', 'executeAt ist erforderlich') };
  }
  if (options.requireStatus && values.status === undefined) {
    return { ok: false, response: error(400, 'validation_error', 'status ist erforderlich') };
  }

  return { ok: true, values };
}

function sanitizeWorkflowVersionList(result: WorkflowVersionListResult): WorkflowVersionListResult {
  return { items: result.items.map(sanitizeWorkflowVersion), nextCursor: result.nextCursor };
}

function sanitizeWorkflowVersion(version: WorkflowVersionRecord): WorkflowVersionRecord {
  return {
    id: version.id,
    sourceSqliteId: version.sourceSqliteId,
    workflowSourceSqliteId: version.workflowSourceSqliteId,
    workflowId: version.workflowId,
    label: version.label,
    graph: version.graph,
    definition: version.definition,
    createdAt: version.createdAt,
    updatedAt: version.updatedAt,
  };
}

async function auditWorkflowRestore(
  ports: ServerApiPorts,
  principal: AuthenticatedPrincipal,
  workflow: WorkflowRecord,
  version: WorkflowVersionRecord,
): Promise<void> {
  await ports.audit?.record({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    action: 'workflow.updated',
    entityType: 'workflow',
    entityId: String(workflow.id),
    metadata: {
      id: workflow.id,
      sourceSqliteId: workflow.sourceSqliteId,
      triggerName: workflow.triggerName,
      enabled: workflow.enabled,
      priority: workflow.priority,
      restoredFromVersionId: version.id,
      restoredFromVersionSourceSqliteId: version.sourceSqliteId,
    },
  });
}

async function publishWorkflowRestore(
  ports: ServerApiPorts,
  workspaceId: string,
  workflow: WorkflowRecord,
  actorUserId: string,
): Promise<void> {
  await ports.events?.publish({
    type: 'workflow.updated',
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

async function auditWorkflowVersion(
  ports: ServerApiPorts,
  principal: AuthenticatedPrincipal,
  action: 'workflow_version.created' | 'workflow_version.updated' | 'workflow_version.deleted',
  version: WorkflowVersionRecord,
  metadata: Record<string, unknown>,
): Promise<void> {
  await ports.audit?.record({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    action,
    entityType: 'workflow_version',
    entityId: String(version.id),
    metadata: {
      id: version.id,
      sourceSqliteId: version.sourceSqliteId,
      workflowId: version.workflowId,
      workflowSourceSqliteId: version.workflowSourceSqliteId,
      ...metadata,
    },
  });
}

async function publishWorkflowVersion(
  ports: ServerApiPorts,
  workspaceId: string,
  type: 'workflow_version.created' | 'workflow_version.updated' | 'workflow_version.deleted',
  version: WorkflowVersionRecord,
  actorUserId: string,
): Promise<void> {
  await ports.events?.publish({
    type,
    workspaceId,
    entityType: 'workflow_version',
    entityId: String(version.id),
    actorUserId,
    occurredAt: new Date().toISOString(),
    payload: {
      id: version.id,
      sourceSqliteId: version.sourceSqliteId,
      workflowId: version.workflowId,
      workflowSourceSqliteId: version.workflowSourceSqliteId,
      label: version.label,
    },
  });
}

function sanitizeWorkflowRunList(result: WorkflowRunListResult, includeLog: boolean): WorkflowRunListResult {
  return { items: result.items.map((run) => sanitizeWorkflowRun(run, includeLog)), nextCursor: result.nextCursor };
}

function sanitizeWorkflowRun(run: WorkflowRunRecord, includeLog: boolean): WorkflowRunRecord {
  return {
    id: run.id,
    sourceSqliteId: run.sourceSqliteId,
    workflowSourceSqliteId: run.workflowSourceSqliteId,
    messageSourceSqliteId: run.messageSourceSqliteId,
    workflowId: run.workflowId,
    messageId: run.messageId,
    direction: run.direction,
    status: run.status,
    ...(includeLog ? { log: run.log } : {}),
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    updatedAt: run.updatedAt,
  };
}

function sanitizeWorkflowRunStepList(result: WorkflowRunStepListResult, includeDetail: boolean): WorkflowRunStepListResult {
  return { items: result.items.map((step) => sanitizeWorkflowRunStep(step, includeDetail)), nextCursor: result.nextCursor };
}

function sanitizeWorkflowRunStep(step: WorkflowRunStepRecord, includeDetail: boolean): WorkflowRunStepRecord {
  return {
    id: step.id,
    sourceSqliteId: step.sourceSqliteId,
    runSourceSqliteId: step.runSourceSqliteId,
    runId: step.runId,
    nodeId: step.nodeId,
    nodeType: step.nodeType,
    status: step.status,
    port: step.port,
    durationMs: step.durationMs,
    message: step.message,
    ...(includeDetail ? { detail: step.detail } : {}),
    createdAt: step.createdAt,
    updatedAt: step.updatedAt,
  };
}

function sanitizeWorkflowMessageAppliedList(result: WorkflowMessageAppliedListResult): WorkflowMessageAppliedListResult {
  return { items: result.items.map(sanitizeWorkflowMessageApplied), nextCursor: result.nextCursor };
}

function sanitizeWorkflowMessageApplied(item: WorkflowMessageAppliedRecord): WorkflowMessageAppliedRecord {
  return {
    id: item.id,
    sourceSqliteId: item.sourceSqliteId,
    messageSourceSqliteId: item.messageSourceSqliteId,
    workflowSourceSqliteId: item.workflowSourceSqliteId,
    messageId: item.messageId,
    workflowId: item.workflowId,
    appliedAt: item.appliedAt,
    updatedAt: item.updatedAt,
  };
}

function sanitizeWorkflowForwardDedupList(result: WorkflowForwardDedupListResult): WorkflowForwardDedupListResult {
  return { items: result.items.map(sanitizeWorkflowForwardDedup), nextCursor: result.nextCursor };
}

function sanitizeWorkflowForwardDedup(item: WorkflowForwardDedupRecord): WorkflowForwardDedupRecord {
  return {
    id: item.id,
    sourceSqliteId: item.sourceSqliteId,
    messageSourceSqliteId: item.messageSourceSqliteId,
    workflowSourceSqliteId: item.workflowSourceSqliteId,
    messageId: item.messageId,
    workflowId: item.workflowId,
    dest: item.dest,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

function sanitizeKnowledgeBaseList(result: WorkflowKnowledgeBaseListResult): WorkflowKnowledgeBaseListResult {
  return { items: result.items.map(sanitizeKnowledgeBase), nextCursor: result.nextCursor };
}

function sanitizeKnowledgeBase(base: WorkflowKnowledgeBaseRecord): WorkflowKnowledgeBaseRecord {
  return {
    id: base.id,
    sourceSqliteId: base.sourceSqliteId,
    name: base.name,
    description: base.description,
    accountSourceSqliteId: base.accountSourceSqliteId,
    accountId: base.accountId,
    overrideKey: base.overrideKey,
    knowledgeContext: base.knowledgeContext,
    createdAt: base.createdAt,
    updatedAt: base.updatedAt,
  };
}

async function auditKnowledgeBase(
  ports: ServerApiPorts,
  principal: AuthenticatedPrincipal,
  action: 'workflow_knowledge_base.created' | 'workflow_knowledge_base.updated' | 'workflow_knowledge_base.deleted',
  base: WorkflowKnowledgeBaseRecord,
  metadata: Record<string, unknown>,
): Promise<void> {
  await ports.audit?.record({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    action,
    entityType: 'workflow_knowledge_base',
    entityId: String(base.id),
    metadata: {
      id: base.id,
      sourceSqliteId: base.sourceSqliteId,
      ...metadata,
    },
  });
}

async function publishKnowledgeBase(
  ports: ServerApiPorts,
  workspaceId: string,
  type: 'workflow_knowledge_base.created' | 'workflow_knowledge_base.updated' | 'workflow_knowledge_base.deleted',
  base: WorkflowKnowledgeBaseRecord,
  actorUserId: string,
): Promise<void> {
  await ports.events?.publish({
    type,
    workspaceId,
    entityType: 'workflow_knowledge_base',
    entityId: String(base.id),
    actorUserId,
    occurredAt: new Date().toISOString(),
    payload: {
      id: base.id,
      sourceSqliteId: base.sourceSqliteId,
      name: base.name,
      description: base.description,
    },
  });
}

function sanitizeKnowledgeChunkList(result: WorkflowKnowledgeChunkListResult, includeContent: boolean): WorkflowKnowledgeChunkListResult {
  return { items: result.items.map((chunk) => sanitizeKnowledgeChunk(chunk, includeContent)), nextCursor: result.nextCursor };
}

function sanitizeKnowledgeChunk(chunk: WorkflowKnowledgeChunkRecord, includeContent: boolean): WorkflowKnowledgeChunkRecord {
  return {
    id: chunk.id,
    sourceSqliteId: chunk.sourceSqliteId,
    knowledgeBaseSourceSqliteId: chunk.knowledgeBaseSourceSqliteId,
    knowledgeBaseId: chunk.knowledgeBaseId,
    title: chunk.title,
    ...(includeContent ? { content: chunk.content } : {}),
    sourcePath: chunk.sourcePath,
    embeddingConfigured: chunk.embeddingConfigured,
    createdAt: chunk.createdAt,
    updatedAt: chunk.updatedAt,
  };
}

async function auditKnowledgeChunk(
  ports: ServerApiPorts,
  principal: AuthenticatedPrincipal,
  action: 'workflow_knowledge_chunk.created' | 'workflow_knowledge_chunk.updated' | 'workflow_knowledge_chunk.deleted',
  chunk: WorkflowKnowledgeChunkRecord,
  metadata: Record<string, unknown>,
): Promise<void> {
  await ports.audit?.record({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    action,
    entityType: 'workflow_knowledge_chunk',
    entityId: String(chunk.id),
    metadata: {
      id: chunk.id,
      sourceSqliteId: chunk.sourceSqliteId,
      knowledgeBaseId: chunk.knowledgeBaseId,
      knowledgeBaseSourceSqliteId: chunk.knowledgeBaseSourceSqliteId,
      ...metadata,
    },
  });
}

async function publishKnowledgeChunk(
  ports: ServerApiPorts,
  workspaceId: string,
  type: 'workflow_knowledge_chunk.created' | 'workflow_knowledge_chunk.updated' | 'workflow_knowledge_chunk.deleted',
  chunk: WorkflowKnowledgeChunkRecord,
  actorUserId: string,
): Promise<void> {
  await ports.events?.publish({
    type,
    workspaceId,
    entityType: 'workflow_knowledge_chunk',
    entityId: String(chunk.id),
    actorUserId,
    occurredAt: new Date().toISOString(),
    payload: {
      id: chunk.id,
      sourceSqliteId: chunk.sourceSqliteId,
      knowledgeBaseId: chunk.knowledgeBaseId,
      knowledgeBaseSourceSqliteId: chunk.knowledgeBaseSourceSqliteId,
      title: chunk.title,
      sourcePath: chunk.sourcePath,
      embeddingConfigured: chunk.embeddingConfigured,
    },
  });
}

function sanitizeDelayedJobList(result: WorkflowDelayedJobListResult, includeContext: boolean): WorkflowDelayedJobListResult {
  return { items: result.items.map((job) => sanitizeDelayedJob(job, includeContext)), nextCursor: result.nextCursor };
}

function sanitizeDelayedJob(job: WorkflowDelayedJobRecord, includeContext: boolean): WorkflowDelayedJobRecord {
  return {
    id: job.id,
    sourceSqliteId: job.sourceSqliteId,
    workflowSourceSqliteId: job.workflowSourceSqliteId,
    messageSourceSqliteId: job.messageSourceSqliteId,
    workflowId: job.workflowId,
    messageId: job.messageId,
    resumeNodeId: job.resumeNodeId,
    executeAt: job.executeAt,
    ...(includeContext ? { context: job.context } : {}),
    status: job.status,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}

async function auditDelayedJob(
  ports: ServerApiPorts,
  principal: AuthenticatedPrincipal,
  action: 'workflow_delayed_job.created' | 'workflow_delayed_job.updated' | 'workflow_delayed_job.deleted',
  job: WorkflowDelayedJobRecord,
  metadata: Record<string, unknown>,
): Promise<void> {
  await ports.audit?.record({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    action,
    entityType: 'workflow_delayed_job',
    entityId: String(job.id),
    metadata: {
      id: job.id,
      sourceSqliteId: job.sourceSqliteId,
      workflowId: job.workflowId,
      workflowSourceSqliteId: job.workflowSourceSqliteId,
      messageId: job.messageId,
      messageSourceSqliteId: job.messageSourceSqliteId,
      ...metadata,
    },
  });
}

async function publishDelayedJob(
  ports: ServerApiPorts,
  workspaceId: string,
  type: 'workflow_delayed_job.created' | 'workflow_delayed_job.updated' | 'workflow_delayed_job.deleted',
  job: WorkflowDelayedJobRecord,
  actorUserId: string,
): Promise<void> {
  await ports.events?.publish({
    type,
    workspaceId,
    entityType: 'workflow_delayed_job',
    entityId: String(job.id),
    actorUserId,
    occurredAt: new Date().toISOString(),
    payload: {
      id: job.id,
      sourceSqliteId: job.sourceSqliteId,
      workflowId: job.workflowId,
      workflowSourceSqliteId: job.workflowSourceSqliteId,
      messageId: job.messageId,
      messageSourceSqliteId: job.messageSourceSqliteId,
      resumeNodeId: job.resumeNodeId,
      executeAt: job.executeAt,
      status: job.status,
    },
  });
}

function prepareNumericGet(
  req: ApiRequest,
  rawId: string | undefined,
  invalidCode: string,
  invalidMessage: string,
): ApiResponse | { principal: NonNullable<ApiRequest['principal']>; id: number } {
  if (req.method !== 'GET') return methodNotAllowed();
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  const id = positiveIntFromPath(rawId);
  if (id === null) return error(400, invalidCode, invalidMessage);
  return { principal, id };
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

function normalizeNullablePositiveBodyInt(value: unknown, field: string): { ok: true; value: number | null } | { ok: false; message: string } {
  if (value === null) return { ok: true, value: null };
  const result = normalizePositiveBodyInt(value, field);
  return result.ok ? { ok: true, value: result.value } : result;
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

function normalizeRequiredBodyTimestamp(
  rawValue: unknown,
  field: string,
): { ok: true; value: string } | { ok: false; message: string } {
  if (typeof rawValue !== 'string') return { ok: false, message: `${field} muss ein String sein` };
  const value = rawValue.trim();
  if (!value) return { ok: false, message: `${field} darf nicht leer sein` };
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { ok: false, message: `${field} muss ein valides Datum sein` };
  return { ok: true, value: date.toISOString() };
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
