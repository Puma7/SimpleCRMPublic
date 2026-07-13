import type { IncomingMessage, ServerResponse } from 'http';
import type { AutomationScope } from '../../shared/automation-api';
import { AUTOMATION_API_PREFIX, AUTOMATION_MAX_BODY_BYTES } from '../../shared/automation-api';
import { isAutomationApiEnabled } from './settings';
import { authenticateRequest, hasScopes } from './auth';
import {
  sendJson,
  sendError,
  parsePositiveInt,
  coercePositiveInt,
  parseQueryPositiveInt,
  clampLimit,
  clampOffset,
} from './http-response';
import { CustomerService } from '../services/customer-service';
import { DealService } from '../services/deal-service';
import { TaskService } from '../services/task-service';
import { EmailApiService } from '../services/email-api-service';
import { WorkflowApiService } from '../services/workflow-api-service';
import { getOpenApiSpec } from './openapi';

type RouteContext = {
  method: string;
  path: string;
  query: URLSearchParams;
  body: unknown;
};

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > AUTOMATION_MAX_BODY_BYTES) {
        req.destroy();
        reject(new Error('body_too_large'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('invalid_json'));
      }
    });
    req.on('error', reject);
  });
}

function needScope(
  res: ServerResponse,
  scopes: AutomationScope[],
  have: AutomationScope[],
): boolean {
  if (hasScopes(have, scopes)) return true;
  sendError(res, 403, 'forbidden', `Fehlende Berechtigung: ${scopes.join(', ')}`);
  return false;
}

async function dispatch(ctx: RouteContext, res: ServerResponse, apiScopes: AutomationScope[]): Promise<void> {
  const { method, path, query, body } = ctx;

  if (path === '/health' && method === 'GET') {
    sendJson(res, 200, {
      status: 'ok',
      api: 'simplecrm-automation',
      version: 1,
      enabled: isAutomationApiEnabled(),
    });
    return;
  }

  if (path === '/openapi.json' && method === 'GET') {
    sendJson(res, 200, getOpenApiSpec());
    return;
  }

  // --- Customers ---
  if (path === '/customers' && method === 'GET') {
    if (!needScope(res, ['read'], apiScopes)) return;
    if (query.has('q')) {
      const q = query.get('q') ?? '';
      sendJson(res, 200, { data: CustomerService.search(q, clampLimit(query.get('limit'), 100, 20)) });
      return;
    }
    const includeCf = query.get('includeCustomFields') === 'true';
    sendJson(res, 200, { data: CustomerService.list(includeCf) });
    return;
  }

  if (path === '/customers' && method === 'POST') {
    if (!needScope(res, ['write'], apiScopes)) return;
    const result = CustomerService.create(body as Record<string, unknown>);
    if (!result.success) {
      sendError(res, 400, 'validation_error', result.error ?? 'Ungültige Daten');
      return;
    }
    sendJson(res, 201, { data: result.customer });
    return;
  }

  const customerMatch = /^\/customers\/(\d+)$/.exec(path);
  if (customerMatch) {
    const id = parsePositiveInt(customerMatch[1])!;
    if (method === 'GET') {
      if (!needScope(res, ['read'], apiScopes)) return;
      const row = CustomerService.getById(id);
      if (!row) {
        sendError(res, 404, 'not_found', 'Kunde nicht gefunden');
        return;
      }
      sendJson(res, 200, { data: row });
      return;
    }
    if (method === 'PATCH') {
      if (!needScope(res, ['write'], apiScopes)) return;
      const result = CustomerService.update(id, body as Record<string, unknown>);
      if (!result.success) {
        sendError(res, result.error === 'Kunde nicht gefunden' ? 404 : 400, 'update_failed', result.error!);
        return;
      }
      sendJson(res, 200, { data: result.customer });
      return;
    }
    if (method === 'DELETE') {
      if (!needScope(res, ['write'], apiScopes)) return;
      const result = CustomerService.delete(id);
      if (!result.success) {
        sendError(res, 404, 'not_found', result.error ?? 'Kunde nicht gefunden');
        return;
      }
      sendJson(res, 200, { success: true });
      return;
    }
  }

  // --- Deals ---
  if (path === '/deals' && method === 'GET') {
    if (!needScope(res, ['read'], apiScopes)) return;
    const customerIdQ = parseQueryPositiveInt(query, 'customerId');
    if (customerIdQ.invalid) {
      sendError(res, 400, 'validation_error', 'customerId muss eine positive Ganzzahl sein');
      return;
    }
    sendJson(res, 200, {
      data: DealService.list({
        limit: clampLimit(query.get('limit')),
        offset: clampOffset(query.get('offset')),
        customerId: customerIdQ.value,
      }),
    });
    return;
  }

  if (path === '/deals' && method === 'POST') {
    if (!needScope(res, ['write'], apiScopes)) return;
    const result = DealService.create(body as Record<string, unknown>);
    if (!result.success) {
      sendError(res, 400, 'validation_error', result.error ?? 'Ungültige Daten');
      return;
    }
    sendJson(res, 201, { data: { id: result.id } });
    return;
  }

  const dealMatch = /^\/deals\/(\d+)$/.exec(path);
  if (dealMatch) {
    const id = parsePositiveInt(dealMatch[1])!;
    if (method === 'GET') {
      if (!needScope(res, ['read'], apiScopes)) return;
      const row = DealService.getById(id);
      if (!row) {
        sendError(res, 404, 'not_found', 'Deal nicht gefunden');
        return;
      }
      sendJson(res, 200, { data: row });
      return;
    }
    if (method === 'PATCH') {
      if (!needScope(res, ['write'], apiScopes)) return;
      const result = DealService.update(id, body as Record<string, unknown>);
      if (!result.success) {
        sendError(res, 404, 'not_found', result.error ?? 'Deal nicht gefunden');
        return;
      }
      sendJson(res, 200, { success: true });
      return;
    }
    if (method === 'DELETE') {
      if (!needScope(res, ['write'], apiScopes)) return;
      const result = DealService.delete(id);
      if (!result.success) {
        sendError(res, 404, 'not_found', result.error ?? 'Deal nicht gefunden');
        return;
      }
      sendJson(res, 200, { success: true });
      return;
    }
  }

  const dealStageMatch = /^\/deals\/(\d+)\/stage$/.exec(path);
  if (dealStageMatch && method === 'POST') {
    if (!needScope(res, ['write'], apiScopes)) return;
    const id = parsePositiveInt(dealStageMatch[1])!;
    const stage = (body as { stage?: string })?.stage;
    const result = DealService.updateStage(id, stage ?? '');
    if (!result.success) {
      sendError(res, 400, 'update_failed', result.error ?? 'Stage-Update fehlgeschlagen');
      return;
    }
    sendJson(res, 200, { success: true });
    return;
  }

  // --- Tasks ---
  if (path === '/tasks' && method === 'GET') {
    if (!needScope(res, ['read'], apiScopes)) return;
    const completedRaw = query.get('completed');
    let completed: boolean | undefined;
    if (completedRaw === 'true') completed = true;
    if (completedRaw === 'false') completed = false;
    sendJson(res, 200, {
      data: TaskService.list({
        limit: clampLimit(query.get('limit')),
        offset: clampOffset(query.get('offset')),
        completed,
        query: query.get('q') ?? undefined,
      }),
    });
    return;
  }

  if (path === '/tasks' && method === 'POST') {
    if (!needScope(res, ['write'], apiScopes)) return;
    const result = TaskService.create(body as Record<string, unknown>);
    if (!result.success) {
      sendError(res, 400, 'validation_error', result.error ?? 'Ungültige Daten');
      return;
    }
    sendJson(res, 201, { data: { id: result.id } });
    return;
  }

  const taskMatch = /^\/tasks\/(\d+)$/.exec(path);
  if (taskMatch) {
    const id = parsePositiveInt(taskMatch[1])!;
    if (method === 'GET') {
      if (!needScope(res, ['read'], apiScopes)) return;
      const row = TaskService.getById(id);
      if (!row) {
        sendError(res, 404, 'not_found', 'Aufgabe nicht gefunden');
        return;
      }
      sendJson(res, 200, { data: row });
      return;
    }
    if (method === 'PATCH') {
      if (!needScope(res, ['write'], apiScopes)) return;
      const result = TaskService.update(id, body as Record<string, unknown>);
      if (!result.success) {
        sendError(res, 404, 'not_found', result.error ?? 'Aufgabe nicht gefunden');
        return;
      }
      sendJson(res, 200, { success: true });
      return;
    }
    if (method === 'DELETE') {
      if (!needScope(res, ['write'], apiScopes)) return;
      const result = TaskService.delete(id);
      if (!result.success) {
        sendError(res, 404, 'not_found', result.error ?? 'Aufgabe nicht gefunden');
        return;
      }
      sendJson(res, 200, { success: true });
      return;
    }
  }

  const taskToggleMatch = /^\/tasks\/(\d+)\/toggle$/.exec(path);
  if (taskToggleMatch && method === 'POST') {
    if (!needScope(res, ['write'], apiScopes)) return;
    const id = parsePositiveInt(taskToggleMatch[1])!;
    const completed = (body as { completed?: unknown })?.completed;
    if (typeof completed !== 'boolean') {
      sendError(res, 400, 'validation_error', 'completed (boolean) ist erforderlich');
      return;
    }
    const result = TaskService.toggleCompletion(id, completed);
    if (!result.success) {
      sendError(res, 404, 'not_found', result.error ?? 'Aufgabe nicht gefunden');
      return;
    }
    sendJson(res, 200, { success: true });
    return;
  }

  // --- Email (Phase B) ---
  if (path === '/email/accounts' && method === 'GET') {
    if (!needScope(res, ['email'], apiScopes)) return;
    sendJson(res, 200, { data: EmailApiService.listAccounts() });
    return;
  }

  if (path === '/email/messages' && method === 'GET') {
    if (!needScope(res, ['email'], apiScopes)) return;
    const accountId = parsePositiveInt(query.get('accountId') ?? undefined);
    if (!accountId) {
      sendError(res, 400, 'validation_error', 'accountId ist erforderlich');
      return;
    }
    sendJson(res, 200, {
      data: EmailApiService.listMessages({
        accountId,
        view: query.get('view') ?? 'inbox',
        since: query.get('since') ?? undefined,
        limit: clampLimit(query.get('limit')),
        offset: clampOffset(query.get('offset')),
        includeBody: query.get('includeBody') === 'true',
      }),
    });
    return;
  }

  const emailMsgMatch = /^\/email\/messages\/(\d+)$/.exec(path);
  if (emailMsgMatch && method === 'GET') {
    if (!needScope(res, ['email'], apiScopes)) return;
    const id = parsePositiveInt(emailMsgMatch[1])!;
    const row = EmailApiService.getMessage(id, query.get('includeBody') === 'true');
    if (!row) {
      sendError(res, 404, 'not_found', 'Nachricht nicht gefunden');
      return;
    }
    sendJson(res, 200, { data: row });
    return;
  }

  const emailActionMatch = /^\/email\/messages\/(\d+)\/actions$/.exec(path);
  if (emailActionMatch && method === 'POST') {
    if (!needScope(res, ['email'], apiScopes)) return;
    const id = parsePositiveInt(emailActionMatch[1])!;
    const b = body as { action?: string; payload?: Record<string, unknown> };
    const action = b?.action;
    if (!action) {
      sendError(res, 400, 'validation_error', 'action ist erforderlich');
      return;
    }
    const payload =
      b.payload ??
      Object.fromEntries(
        Object.entries(b).filter(([k]) => k !== 'action' && k !== 'payload'),
      );
    const result = EmailApiService.applyAction(id, action, payload);
    if (!result.success) {
      sendError(res, 400, 'action_failed', result.error ?? 'Aktion fehlgeschlagen');
      return;
    }
    sendJson(res, 200, { success: true });
    return;
  }

  // --- Workflows (Phase B) ---
  if (path === '/workflows' && method === 'GET') {
    if (!needScope(res, ['workflows'], apiScopes)) return;
    sendJson(res, 200, { data: WorkflowApiService.list() });
    return;
  }

  const wfMatch = /^\/workflows\/(\d+)$/.exec(path);
  if (wfMatch && method === 'GET') {
    if (!needScope(res, ['workflows'], apiScopes)) return;
    const id = parsePositiveInt(wfMatch[1])!;
    const row = WorkflowApiService.getById(id);
    if (!row) {
      sendError(res, 404, 'not_found', 'Workflow nicht gefunden');
      return;
    }
    sendJson(res, 200, { data: row });
    return;
  }

  const wfRunsMatch = /^\/workflows\/(\d+)\/runs$/.exec(path);
  if (wfRunsMatch && method === 'GET') {
    if (!needScope(res, ['workflows'], apiScopes)) return;
    const id = parsePositiveInt(wfRunsMatch[1])!;
    sendJson(res, 200, {
      data: WorkflowApiService.listRuns(id, clampLimit(query.get('limit'), 100, 20)),
    });
    return;
  }

  const wfExecMatch = /^\/workflows\/(\d+)\/execute$/.exec(path);
  if (path === '/webhooks/incoming' && method === 'POST') {
    if (!needScope(res, ['workflows'], apiScopes)) return;
    const b = body as {
      secret?: string;
      body?: Record<string, unknown>;
      payload?: Record<string, unknown>;
    };
    const secret = String(b.secret ?? '').trim();
    if (!secret) {
      sendError(res, 400, 'missing_secret', 'Webhook-Secret fehlt (Feld secret)');
      return;
    }
    const { fireWebhookWorkflows } = await import('../email/email-webhook.js');
    const result = await fireWebhookWorkflows({
      secret,
      body: (b.body ?? b.payload ?? {}) as Record<string, unknown>,
    });
    sendJson(res, 200, { data: result });
    return;
  }

  if (wfExecMatch && method === 'POST') {
    if (!needScope(res, ['workflows'], apiScopes)) return;
    const id = parsePositiveInt(wfExecMatch[1])!;
    const b = body as {
      dryRun?: boolean;
      messageId?: number;
      variables?: Record<string, string | number | boolean | null>;
    };
    let messageId: number | undefined;
    if (b?.messageId != null) {
      const mid = coercePositiveInt(b.messageId);
      if (mid == null) {
        sendError(res, 400, 'validation_error', 'messageId muss eine positive Ganzzahl sein');
        return;
      }
      messageId = mid;
    }
    const result = await WorkflowApiService.execute(id, {
      dryRun: b?.dryRun,
      messageId,
      variables: b?.variables,
    });
    if (!result.success) {
      sendError(res, 400, 'execute_failed', result.error ?? 'Ausführung fehlgeschlagen');
      return;
    }
    sendJson(res, 200, { data: result });
    return;
  }

  sendError(res, 404, 'not_found', 'Route nicht gefunden');
}

export async function handleAutomationRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': 'null',
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-API-Key',
      'Access-Control-Max-Age': '86400',
    });
    res.end();
    return;
  }

  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  const rawPath = url.pathname;
  if (!rawPath.startsWith(AUTOMATION_API_PREFIX)) {
    sendError(res, 404, 'not_found', `API nur unter ${AUTOMATION_API_PREFIX}`);
    return;
  }
  const pathname = rawPath.slice(AUTOMATION_API_PREFIX.length) || '/';

  const publicPaths = new Set(['/health', '/openapi.json']);
  const isPublic = publicPaths.has(pathname) && req.method === 'GET';

  if (!isAutomationApiEnabled() && !isPublic) {
    sendError(res, 503, 'api_disabled', 'Automation-API ist deaktiviert');
    return;
  }

  let apiScopes: AutomationScope[] = [];
  if (!isPublic) {
    const auth = await authenticateRequest({
      authorization: typeof req.headers.authorization === 'string' ? req.headers.authorization : undefined,
      'x-api-key': typeof req.headers['x-api-key'] === 'string' ? req.headers['x-api-key'] : undefined,
    });
    if (!auth.ok) {
      sendError(res, auth.status, auth.code, auth.message);
      return;
    }
    apiScopes = auth.credentials.scopes;
  }

  let body: unknown = {};
  if (req.method === 'POST' || req.method === 'PATCH') {
    try {
      body = await readJsonBody(req);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'invalid_body';
      if (msg === 'body_too_large') {
        sendError(res, 413, 'payload_too_large', 'Request-Body zu groß');
        return;
      }
      sendError(res, 400, 'invalid_json', 'Ungültiges JSON');
      return;
    }
  }

  const method = req.method ?? 'GET';
  if (!['GET', 'POST', 'PATCH', 'DELETE'].includes(method)) {
    sendError(res, 405, 'method_not_allowed', 'Methode nicht erlaubt');
    return;
  }

  await dispatch({ method, path: pathname, query: url.searchParams, body }, res, apiScopes);
}
