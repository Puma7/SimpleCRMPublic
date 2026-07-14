import { createServerApi } from '../../packages/server/src/api/server-api';
import { resetEmailTrackingRateLimitersForTests } from '../../packages/server/src/api/email-tracking-routes';
import { EmailTrackingPolicyValidationError } from '../../packages/server/src/email-tracking';
import type {
  AuthenticatedPrincipal,
  EmailTrackingApiPort,
  EmailTrackingPolicyRecord,
  ServerApiPorts,
} from '../../packages/server/src/api/types';

const TOKEN = 'A'.repeat(43);
const principal: AuthenticatedPrincipal = {
  userId: 'user-1',
  workspaceId: 'workspace-1',
  role: 'admin',
};

const policy: EmailTrackingPolicyRecord = {
  enabled: false,
  trackOpens: false,
  trackLinks: false,
  collectDerivedMetadata: false,
  collectRawMetadata: false,
  rawMetadataRetentionDays: 7,
  eventRetentionDays: 365,
  tokenTtlDays: 730,
  legalBasis: null,
  privacyNoticeUrl: null,
  complianceAcknowledgedAt: null,
  publicBaseUrl: 'https://crm.example',
  updatedAt: null,
};

function makeTrackingPort(overrides: Partial<EmailTrackingApiPort> = {}): EmailTrackingApiPort {
  return {
    async getPolicy() { return policy; },
    async setPolicy() { return policy; },
    async getTimeline() { return null; },
    async recordPublicOpen() {},
    async resolvePublicClick() { return null; },
    async revokeMessage() { return false; },
    async eraseMessage() { return false; },
    ...overrides,
  };
}

function apiFor(port: EmailTrackingApiPort) {
  return createServerApi({ auth: {} as never, emailTracking: port } satisfies ServerApiPorts);
}

describe('email tracking routes', () => {
  beforeEach(() => resetEmailTrackingRateLimitersForTests());

  test('returns the exact same non-cacheable GIF response for recorded and unknown open tokens', async () => {
    const calls: unknown[] = [];
    const api = apiFor(makeTrackingPort({
      async recordPublicOpen(input) { calls.push(input); },
    }));

    const valid = await api.handle({
      method: 'GET',
      path: `/t/o/${TOKEN}.gif`,
      headers: { 'user-agent': 'MailClient/1.0' },
      ip: '203.0.113.10',
    });
    const invalid = await api.handle({ method: 'GET', path: '/t/o/not-a-token.gif' });

    expect(valid.status).toBe(200);
    expect(valid.body).toBeInstanceOf(Uint8Array);
    expect(valid.headers).toMatchObject({
      'Content-Type': 'image/gif',
      'Cache-Control': 'no-store, no-cache, must-revalidate, private',
    });
    expect(invalid).toEqual(valid);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ token: TOKEN, ip: '203.0.113.10', userAgent: 'MailClient/1.0' });
  });

  test('redirects only to the immutable target returned by the tracking port', async () => {
    const api = apiFor(makeTrackingPort({
      async resolvePublicClick() { return { targetUrl: 'https://customer.example/invoice/7' }; },
    }));

    const response = await api.handle({ method: 'GET', path: `/t/c/${TOKEN}` });
    expect(response.status).toBe(302);
    expect(response.headers).toMatchObject({
      Location: 'https://customer.example/invoice/7',
      'Cache-Control': 'no-store, private',
      'Referrer-Policy': 'no-referrer',
    });
  });

  test('limits one leaked token without suppressing other messages behind the same mail proxy', async () => {
    let calls = 0;
    const api = apiFor(makeTrackingPort({
      async recordPublicOpen() { calls += 1; },
    }));
    for (let index = 0; index < 121; index += 1) {
      await api.handle({ method: 'GET', path: `/t/o/${TOKEN}.gif`, ip: '203.0.113.20' });
    }
    await api.handle({ method: 'GET', path: `/t/o/${'B'.repeat(43)}.gif`, ip: '203.0.113.20' });

    expect(calls).toBe(121);
  });

  test('rejects unknown click tokens and unsafe stored redirect schemes', async () => {
    const unknown = await apiFor(makeTrackingPort()).handle({ method: 'GET', path: `/t/c/${TOKEN}` });
    const unsafe = await apiFor(makeTrackingPort({
      async resolvePublicClick() { return { targetUrl: 'javascript:alert(1)' }; },
    })).handle({ method: 'GET', path: `/t/c/${TOKEN}` });

    expect(unknown.status).toBe(404);
    expect(unsafe.status).toBe(404);
  });

  test('allows workspace users to read policy/timeline but only admins to mutate evidence', async () => {
    const mutations: string[] = [];
    const timelineReads: unknown[] = [];
    const tracking = makeTrackingPort({
      async getTimeline(input) {
        timelineReads.push(input);
        return {
          messageId: 17,
          tracked: true,
          warning: null,
          eventsTruncated: false,
          summary: {
            transport: 'smtp_accepted', delivery: 'unknown', engagement: 'none', confidence: 'low',
            openCount: 0, clickCount: 0, firstOpenedAt: null, lastOpenedAt: null,
            firstClickedAt: null, lastClickedAt: null, repliedAt: null,
          },
          events: [],
        };
      },
      async setPolicy() { mutations.push('settings'); return policy; },
      async revokeMessage() { mutations.push('revoke'); return true; },
      async eraseMessage() { mutations.push('erase'); return true; },
    });
    const api = apiFor(tracking);
    const user = { ...principal, role: 'user' as const };

    expect((await api.handle({ method: 'GET', path: '/api/v1/email/tracking/settings', principal: user })).status).toBe(200);
    expect((await api.handle({ method: 'GET', path: '/api/v1/email/messages/17/tracking', principal: user })).status).toBe(200);
    expect((await api.handle({ method: 'GET', path: '/api/v1/email/messages/17/tracking', query: { includeSensitive: 'true' }, principal: user })).status).toBe(403);
    expect((await api.handle({ method: 'PATCH', path: '/api/v1/email/tracking/settings', body: {}, principal: user })).status).toBe(403);
    expect((await api.handle({ method: 'POST', path: '/api/v1/email/messages/17/tracking/revoke', principal: user })).status).toBe(403);
    expect((await api.handle({ method: 'DELETE', path: '/api/v1/email/messages/17/tracking', principal: user })).status).toBe(403);
    expect(mutations).toEqual([]);

    expect((await api.handle({ method: 'POST', path: '/api/v1/email/messages/17/tracking/revoke', principal })).status).toBe(200);
    expect((await api.handle({ method: 'GET', path: '/api/v1/email/messages/17/tracking', query: { includeSensitive: 'true' }, principal })).status).toBe(200);
    expect((await api.handle({ method: 'DELETE', path: '/api/v1/email/messages/17/tracking', principal })).status).toBe(204);
    expect(mutations).toEqual(['revoke', 'erase']);
    expect(timelineReads).toEqual([
      { workspaceId: 'workspace-1', messageId: 17 },
      { workspaceId: 'workspace-1', messageId: 17, includeSensitive: true },
    ]);
  });

  test('returns semantic policy errors as 400 without hiding infrastructure failures', async () => {
    const invalidApi = apiFor(makeTrackingPort({
      async setPolicy() {
        throw new EmailTrackingPolicyValidationError('Datenschutzhinweis-URL muss HTTPS verwenden');
      },
    }));
    await expect(invalidApi.handle({
      method: 'PATCH',
      path: '/api/v1/email/tracking/settings',
      body: { privacyNoticeUrl: 'http://crm.example/privacy' },
      principal,
    })).resolves.toMatchObject({
      status: 400,
      body: { error: { code: 'invalid_tracking_policy' } },
    });

    const brokenApi = apiFor(makeTrackingPort({
      async setPolicy() { throw new Error('database unavailable'); },
    }));
    await expect(brokenApi.handle({
      method: 'PATCH',
      path: '/api/v1/email/tracking/settings',
      body: {},
      principal,
    })).rejects.toThrow('database unavailable');
  });
});
