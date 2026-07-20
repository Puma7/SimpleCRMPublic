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
      workflowRuns24h: [{ workflowId: 9, count: 5, errors: 1 }],
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
      workflowRuns24h: [{ workflowId: 9, count: 5, errors: 1 }],
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
