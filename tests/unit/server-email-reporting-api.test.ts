import {
  createServerApi,
  type AuthApiPort,
  type EmailReportingApiPort,
  type ServerApiPorts,
} from '../../packages/server/src';

describe('server email reporting API', () => {
  const principal = {
    userId: 'user-1',
    workspaceId: 'workspace-1',
    role: 'owner' as const,
  };

  test('returns reporting snapshot through the reporting port', async () => {
    const emailReporting = reportingPort();
    const api = createServerApi(ports({ emailReporting }));

    const response = await api.handle({
      method: 'GET',
      path: '/api/v1/email/reporting',
      query: { accountId: '7' },
      principal,
    });

    expect(response.status).toBe(200);
    expect((response.body as any).data).toEqual({
      accounts: [{
        id: 7,
        displayName: 'Support',
        emailAddress: 'support@example.com',
        protocol: 'imap',
      }],
      totals: {
        messages: 12,
        unread: 3,
        archived: 2,
        withCustomer: 5,
        withAssignment: 4,
        withAttachments: 6,
      },
      perAccount: [{ accountId: 7, messages: 12, unread: 3, archived: 2 }],
      workflowRuns24h: [{ workflowId: 9, workflowName: 'Spamfilter', count: 5, errors: 1 }],
      automation: {
        sentByKindWeekly: [
          { weekStart: '2026-09-21', human: 4, aiAuto: 2, aiApproved: 1, workflow: 0, relay: 0, unknown: 0 },
        ],
        pendingApproval: 2,
        outboundBlocked: 0,
        aiDecideByWorkflow30d: [
          { workflowId: 9, workflowName: 'Spamfilter', ja: 3, nein: 1, unsicher: 0, error: 0, total: 4 },
        ],
        aiCost30d: { costMicroUsd: 4200, events: 4 },
      },
    });
    expect(emailReporting.collect).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      accountId: 7,
    });
  });

  test('validates accountId', async () => {
    const api = createServerApi(ports({ emailReporting: reportingPort() }));

    const response = await api.handle({
      method: 'GET',
      path: '/api/v1/email/reporting',
      query: { accountId: '0' },
      principal,
    });

    expect(response.status).toBe(400);
    expect((response.body as any).error.code).toBe('invalid_account_id');
  });

  test('requires auth and configured reporting port', async () => {
    const apiWithoutAuth = createServerApi(ports({ emailReporting: reportingPort() }));
    const apiWithoutReporting = createServerApi(ports({ emailReporting: undefined }));

    const unauthorized = await apiWithoutAuth.handle({
      method: 'GET',
      path: '/api/v1/email/reporting',
    });
    const unavailable = await apiWithoutReporting.handle({
      method: 'GET',
      path: '/api/v1/email/reporting',
      principal,
    });

    expect(unauthorized.status).toBe(401);
    expect(unavailable.status).toBe(503);
    expect((unavailable.body as any).error.code).toBe('email_reporting_unavailable');
  });
});

// Plan 049: das Cockpit passiert den Sanitizer begrenzt und ohne Fremdfelder.
test('sanitizer klemmt das Automatik-Cockpit', async () => {
  const long = 'W'.repeat(500);
  const emailReporting: jest.Mocked<EmailReportingApiPort> = {
    collect: jest.fn(async () => ({
      accounts: [],
      totals: { messages: 0, unread: 0, archived: 0, withCustomer: 0, withAssignment: 0, withAttachments: 0 },
      perAccount: [],
      workflowRuns24h: [{ workflowId: -23, workflowName: long, count: 1, errors: 0 }],
      automation: {
        sentByKindWeekly: Array.from({ length: 20 }, (_, i) => ({
          weekStart: `2026-01-${String(i + 1).padStart(2, '0')}`, human: -1, aiAuto: 1.7, aiApproved: Number.NaN, workflow: 2, relay: 0, unknown: 0,
          secret: 'x',
        })),
        pendingApproval: -5,
        outboundBlocked: 3,
        aiDecideByWorkflow30d: Array.from({ length: 40 }, (_, i) => ({
          workflowId: i + 1, workflowName: long, ja: 1, nein: 0, unsicher: 0, error: 0, total: 1,
        })),
        aiCost30d: null,
      } as any,
    })),
  };
  const api = createServerApi(ports({ emailReporting }));
  const response = await api.handle({ method: 'GET', path: '/api/v1/email/reporting', principal: {
    userId: 'user-1', workspaceId: 'workspace-1', role: 'owner' as const,
  } });
  const data = (response.body as any).data;
  expect(data.workflowRuns24h[0].workflowName).toHaveLength(200);
  // Server-Workflows haben negative Quell-Ids; vorher wurden sie zu 0.
  expect(data.workflowRuns24h[0].workflowId).toBe(-23);
  expect(data.automation.sentByKindWeekly).toHaveLength(12);
  expect(data.automation.sentByKindWeekly[0]).toEqual({
    weekStart: '2026-01-09', human: 0, aiAuto: 1, aiApproved: 0, workflow: 2, relay: 0, unknown: 0,
  });
  expect(data.automation.pendingApproval).toBe(0);
  expect(data.automation.outboundBlocked).toBe(3);
  expect(data.automation.aiDecideByWorkflow30d).toHaveLength(30);
  expect(data.automation.aiDecideByWorkflow30d[0].workflowName).toHaveLength(200);
  expect(data.automation.aiCost30d).toBeNull();
});

function reportingPort(): jest.Mocked<EmailReportingApiPort> {
  return {
    collect: jest.fn(async () => ({
      accounts: [{
        id: 7,
        displayName: 'Support',
        emailAddress: 'support@example.com',
        protocol: 'imap',
      }],
      totals: {
        messages: 12,
        unread: 3,
        archived: 2,
        withCustomer: 5,
        withAssignment: 4,
        withAttachments: 6,
      },
      perAccount: [{ accountId: 7, messages: 12, unread: 3, archived: 2 }],
      workflowRuns24h: [{ workflowId: 9, workflowName: 'Spamfilter', count: 5, errors: 1 }],
      automation: {
        sentByKindWeekly: [
          { weekStart: '2026-09-21', human: 4, aiAuto: 2, aiApproved: 1, workflow: 0, relay: 0, unknown: 0 },
        ],
        pendingApproval: 2,
        outboundBlocked: 0,
        aiDecideByWorkflow30d: [
          { workflowId: 9, workflowName: 'Spamfilter', ja: 3, nein: 1, unsicher: 0, error: 0, total: 4 },
        ],
        aiCost30d: { costMicroUsd: 4200, events: 4 },
      },
    })),
  };
}

function ports(overrides: Partial<ServerApiPorts>): ServerApiPorts {
  return {
    auth: authPort(),
    locks: {} as ServerApiPorts['locks'],
    mailAccess: {
      async assertPermission() {},
      async resolveScope() {
        return { kind: 'all' };
      },
    },
    mailResourceLookup: {
      async resolve() {
        return [];
      },
    },
    ...overrides,
  };
}

function authPort(): AuthApiPort {
  return {
    findUserByEmail: async () => null,
    verifyPassword: async () => false,
    recordFailedLogin: async () => 1,
    recordSuccessfulLogin: async () => undefined,
    issueTokenPair: async () => ({
      accessToken: 'access',
      refreshToken: 'refresh',
      expiresInSeconds: 900,
    }),
    rotateRefreshToken: async () => null,
    revokeRefreshToken: async () => false,
  };
}
