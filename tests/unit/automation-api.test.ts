import http from 'http';
import { EventEmitter } from 'events';
import type { IncomingMessage, ServerResponse } from 'http';

jest.mock('../../electron/automation/settings', () => ({
  isAutomationApiEnabled: jest.fn(() => true),
  getAutomationBindHost: jest.fn(() => '127.0.0.1'),
  getAutomationPort: jest.fn(() => 38472),
}));

jest.mock('../../electron/automation/automation-keytar', () => ({
  loadApiCredentials: jest.fn(async () => ({
    key: 'scrm_test_key_12345678901234567890123456789012',
    scopes: ['read', 'write', 'email', 'workflows'],
    createdAt: '2026-01-01',
  })),
}));

jest.mock('../../electron/services/customer-service', () => ({
  CustomerService: {
    list: jest.fn(() => [{ id: 1, name: 'Test' }]),
    getById: jest.fn(() => null),
    search: jest.fn(() => []),
    create: jest.fn(() => ({ success: true, customer: { id: 2, name: 'Neu' } })),
    update: jest.fn(() => ({ success: true, customer: { id: 1 } })),
    delete: jest.fn(() => ({ success: true })),
  },
}));

jest.mock('../../electron/services/deal-service', () => ({
  DealService: {
    list: jest.fn(() => []),
    getById: jest.fn(() => null),
    create: jest.fn(() => ({ success: true, id: 1 })),
    update: jest.fn(() => ({ success: true })),
    updateStage: jest.fn(() => ({ success: true })),
    delete: jest.fn(() => ({ success: true })),
  },
}));

jest.mock('../../electron/services/task-service', () => ({
  TaskService: {
    list: jest.fn(() => []),
    getById: jest.fn(() => null),
    create: jest.fn(() => ({ success: true, id: 1 })),
    update: jest.fn(() => ({ success: true })),
    toggleCompletion: jest.fn(() => ({ success: true })),
    delete: jest.fn(() => ({ success: true })),
  },
}));

jest.mock('../../electron/services/email-api-service', () => ({
  EmailApiService: {
    listAccounts: jest.fn(() => []),
    listMessages: jest.fn(() => []),
    getMessage: jest.fn(() => null),
    applyAction: jest.fn(() => ({ success: true })),
  },
}));

jest.mock('../../electron/services/workflow-api-service', () => ({
  WorkflowApiService: {
    list: jest.fn(() => []),
    getById: jest.fn(() => null),
    listRuns: jest.fn(() => []),
    execute: jest.fn(async () => ({ success: true, runId: 1, status: 'ok', log: [], dryRun: true })),
  },
}));

jest.mock('../../electron/email/email-webhook', () => ({
  fireWebhookWorkflows: jest.fn(async () => ({ fired: 1 })),
}));

import { resetRateLimits, checkRateLimit } from '../../electron/automation/rate-limit';
import { hasScopes } from '../../electron/automation/auth';
import { handleAutomationRequest } from '../../electron/automation/handlers';

function mockReqRes(opts: {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: string;
}): { req: IncomingMessage; res: ServerResponse; done: Promise<{ status: number; body: string }> } {
  const req = new EventEmitter() as IncomingMessage;
  req.method = opts.method;
  req.url = opts.url;
  req.headers = Object.fromEntries(
    Object.entries(opts.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]),
  );

  let status = 0;
  let body = '';
  const res = {
    writeHead: (s: number) => {
      status = s;
    },
    end: (chunk?: string) => {
      if (chunk) body += chunk;
    },
  } as unknown as ServerResponse;

  const done = new Promise<{ status: number; body: string }>((resolve) => {
    (res as { end: (chunk?: string) => void }).end = (chunk?: string) => {
      if (chunk) body += chunk;
      resolve({ status, body });
    };
  });

  process.nextTick(() => {
    if (opts.body) req.emit('data', Buffer.from(opts.body));
    req.emit('end');
  });

  return { req, res, done };
}

describe('automation rate limit', () => {
  test('allows up to limit per minute', () => {
    resetRateLimits();
    const key = 'test-key';
    for (let i = 0; i < 60; i++) {
      expect(checkRateLimit(key).allowed).toBe(true);
    }
    expect(checkRateLimit(key).allowed).toBe(false);
  });
});

describe('automation scopes', () => {
  test('hasScopes requires all listed scopes', () => {
    expect(hasScopes(['read', 'write'], ['read'])).toBe(true);
    expect(hasScopes(['read'], ['write'])).toBe(false);
  });
});

describe('automation handlers', () => {
  beforeEach(() => resetRateLimits());

  test('GET /health without auth', async () => {
    const { req, res, done } = mockReqRes({ method: 'GET', url: '/api/v1/health' });
    await handleAutomationRequest(req, res);
    const r = await done;
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body).status).toBe('ok');
  });

  test('GET /customers requires auth', async () => {
    const { req, res, done } = mockReqRes({ method: 'GET', url: '/api/v1/customers' });
    await handleAutomationRequest(req, res);
    const r = await done;
    expect(r.status).toBe(401);
  });

  test('GET /customers with bearer', async () => {
    const { req, res, done } = mockReqRes({
      method: 'GET',
      url: '/api/v1/customers',
      headers: { Authorization: 'Bearer scrm_test_key_12345678901234567890123456789012' },
    });
    await handleAutomationRequest(req, res);
    const r = await done;
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body).data).toHaveLength(1);
  });

  test('returns 503 when API disabled', async () => {
    const settings = require('../../electron/automation/settings');
    settings.isAutomationApiEnabled.mockReturnValueOnce(false);
    const { req, res, done } = mockReqRes({ method: 'GET', url: '/api/v1/customers' });
    await handleAutomationRequest(req, res);
    const r = await done;
    expect(r.status).toBe(503);
  });

  test('returns 401 for invalid API key', async () => {
    const { req, res, done } = mockReqRes({
      method: 'GET',
      url: '/api/v1/customers',
      headers: { authorization: 'Bearer wrong_key' },
    });
    await handleAutomationRequest(req, res);
    const r = await done;
    expect(r.status).toBe(401);
  });

  test('returns 403 when read scope missing', async () => {
    const keytar = require('../../electron/automation/automation-keytar');
    keytar.loadApiCredentials.mockResolvedValueOnce({
      key: 'scrm_test_key_12345678901234567890123456789012',
      scopes: ['email'],
      createdAt: '2026-01-01',
    });
    const { req, res, done } = mockReqRes({
      method: 'GET',
      url: '/api/v1/customers',
      headers: { authorization: 'Bearer scrm_test_key_12345678901234567890123456789012' },
    });
    await handleAutomationRequest(req, res);
    const r = await done;
    expect(r.status).toBe(403);
    expect(JSON.parse(r.body).error.code).toBe('forbidden');
  });

  test('POST /webhooks/incoming fires workflows with secret', async () => {
    const { fireWebhookWorkflows } = await import('../../electron/email/email-webhook');
    const key = 'scrm_test_key_12345678901234567890123456789012';
    const { req, res, done } = mockReqRes({
      method: 'POST',
      url: '/api/v1/webhooks/incoming',
      headers: {
        authorization: `Bearer ${key}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ secret: 'hook-secret', body: { event: 'test' } }),
    });
    await handleAutomationRequest(req, res);
    const r = await done;
    expect(r.status).toBe(200);
    expect(fireWebhookWorkflows).toHaveBeenCalledWith({
      secret: 'hook-secret',
      body: { event: 'test' },
    });
  });

  test('returns 404 without /api/v1 prefix', async () => {
    const { req, res, done } = mockReqRes({ method: 'GET', url: '/customers' });
    await handleAutomationRequest(req, res);
    const r = await done;
    expect(r.status).toBe(404);
  });

  test('returns 400 for invalid customerId query on deals', async () => {
    const { req, res, done } = mockReqRes({
      method: 'GET',
      url: '/api/v1/deals?customerId=abc',
      headers: { authorization: 'Bearer scrm_test_key_12345678901234567890123456789012' },
    });
    await handleAutomationRequest(req, res);
    const r = await done;
    expect(r.status).toBe(400);
  });

  test('task toggle requires completed boolean', async () => {
    const { req, res, done } = mockReqRes({
      method: 'POST',
      url: '/api/v1/tasks/1/toggle',
      headers: { authorization: 'Bearer scrm_test_key_12345678901234567890123456789012' },
      body: '{}',
    });
    await handleAutomationRequest(req, res);
    const r = await done;
    expect(r.status).toBe(400);
  });

  test('returns 429 when rate limit exceeded', async () => {
    const key = 'scrm_test_key_12345678901234567890123456789012';
    for (let i = 0; i < 60; i++) {
      checkRateLimit(key);
    }
    const { req, res, done } = mockReqRes({
      method: 'GET',
      url: '/api/v1/customers',
      headers: { authorization: `Bearer ${key}` },
    });
    await handleAutomationRequest(req, res);
    const r = await done;
    expect(r.status).toBe(429);
  });
});

describe('automation server', () => {
  test('starts and responds on health', async () => {
    const { startAutomationApiServer, stopAutomationApiServer } = await import(
      '../../electron/automation/server'
    );
    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    await startAutomationApiServer(logger);
    const status = await new Promise<number>((resolve, reject) => {
      http
        .get('http://127.0.0.1:38472/api/v1/health', (res) => resolve(res.statusCode ?? 0))
        .on('error', reject);
    });
    expect(status).toBe(200);
    await stopAutomationApiServer();
  });
});
