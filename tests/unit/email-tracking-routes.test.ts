import { createServerApi } from '../../packages/server/src/api/server-api';
import {
  createEmailTrackingRateLimiter,
  resetEmailTrackingRateLimitersForTests,
} from '../../packages/server/src/api/email-tracking-routes';
import {
  EmailTrackingIpInsightForbiddenError,
  EmailTrackingIpInsightNotFoundError,
  EmailTrackingIpInsightRawDataUnavailableError,
  EmailTrackingIpInsightUnavailableError,
  EmailTrackingMessageNotFoundError,
  EmailTrackingPolicyValidationError,
} from '../../packages/server/src/email-tracking';
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
  ipInsightsEnabled: false,
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
    async reclassifyMessage() { return { classified: 0, unavailableRaw: 0 }; },
    async getIpInsight() {
      return {
        ipAddress: '8.8.8.8', ipFamily: 'ipv4', scope: 'public',
        countryCode: 'US', continentCode: 'NA', asn: 15169,
        networkName: 'Google LLC', networkCidr: '8.8.8.0/24',
        databaseBuildAt: '2026-07-15T00:00:00.000Z',
      };
    },
    ...overrides,
  };
}

function apiFor(port: EmailTrackingApiPort) {
  return createServerApi({
    auth: {} as never,
    emailTracking: port,
    mailAccess: {
      async assertPermission() {},
      async resolveScope() {
        return { kind: 'all' };
      },
    },
    mailResourceLookup: {
      async resolve(input) {
        if (input.target.kind === 'message') {
          return [{
            type: 'message',
            accountId: '7',
            folderId: '8',
            messageId: String(input.target.id),
          }];
        }
        return [];
      },
    },
  } satisfies ServerApiPorts);
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

  // F-A3a-05: a flood of throwaway tokens evicted a real token's counter (LRU), resetting its rate limit.
  test('keeps an exhausted token limited while throwaway tokens flood the limiter', async () => {
    const calls = new Map<string, number>();
    const api = apiFor(makeTrackingPort({
      async recordPublicOpen(input) { calls.set(input.token, (calls.get(input.token) ?? 0) + 1); },
    }));
    for (let index = 0; index < 120; index += 1) {
      await api.handle({ method: 'GET', path: `/t/o/${TOKEN}.gif`, ip: '203.0.113.30' });
    }
    for (let index = 0; index < 10_050; index += 1) {
      const randomToken = index.toString(36).padStart(43, 'x');
      await api.handle({
        method: 'GET',
        path: `/t/o/${randomToken}.gif`,
        ip: `2001:db8:${(index >> 8).toString(16)}:${(index & 0xff).toString(16)}::1`,
      });
    }
    await api.handle({ method: 'GET', path: `/t/o/${TOKEN}.gif`, ip: '203.0.113.30' });

    expect(calls.get(TOKEN)).toBe(120);
  });

  // F-A3a-05: the per-IP limits counted every IPv6 address separately, so rotating inside one /64 bypassed them.
  test('counts IPv6 clients per /64 and IPv4-mapped clients as their IPv4 address', async () => {
    let opens = 0;
    const api = apiFor(makeTrackingPort({
      async recordPublicOpen() { opens += 1; },
    }));
    for (let index = 0; index < 1_300; index += 1) {
      const token = `v6${index.toString(36)}`.padEnd(43, 'y');
      await api.handle({
        method: 'GET',
        path: `/t/o/${token}.gif`,
        ip: `2001:db8:1:2:${(index >> 8).toString(16)}:${(index & 0xff).toString(16)}:0:1`,
      });
    }
    expect(opens).toBe(1_200);

    let clicks = 0;
    const clickApi = apiFor(makeTrackingPort({
      async resolvePublicClick() { clicks += 1; return { targetUrl: 'https://customer.example/invoice/7' }; },
    }));
    for (let index = 0; index < 601; index += 1) {
      const token = `v4${index.toString(36)}`.padEnd(43, 'z');
      await clickApi.handle({
        method: 'GET',
        path: `/t/c/${token}`,
        ip: index % 2 === 0 ? '198.51.100.7' : '::ffff:198.51.100.7',
      });
    }
    expect(clicks).toBe(600);
  });

  // F-A3a-05: the limiter map evicted live counters when full, so a key could be reset by flooding other keys.
  test('never resets a live counter when the limiter map is full', () => {
    const limiter = createEmailTrackingRateLimiter({ limit: 2, windowMs: 1_000, maxKeys: 3 });
    expect(limiter.check('real', 0)).toBe(true);
    expect(limiter.check('real', 0)).toBe(true);
    expect(limiter.check('real', 0)).toBe(false);
    for (let index = 0; index < 50; index += 1) limiter.check(`throwaway-${index}`, 10);

    expect(limiter.check('real', 20)).toBe(false);
    expect(limiter.check('real', 1_000)).toBe(true);
  });

  test('does not charge the shared click IP bucket after a token is already exhausted', async () => {
    const api = apiFor(makeTrackingPort({
      async resolvePublicClick() { return { targetUrl: 'https://customer.example/invoice/7' }; },
    }));

    for (let index = 0; index < 600; index += 1) {
      await api.handle({ method: 'GET', path: `/t/c/${TOKEN}`, ip: '203.0.113.21' });
    }

    const unrelated = await api.handle({
      method: 'GET',
      path: `/t/c/${'B'.repeat(43)}`,
      ip: '203.0.113.21',
    });
    expect(unrelated.status).toBe(302);
  });

  test('rejects unknown click tokens and unsafe stored redirect schemes', async () => {
    const unknown = await apiFor(makeTrackingPort()).handle({ method: 'GET', path: `/t/c/${TOKEN}` });
    const unsafe = await apiFor(makeTrackingPort({
      async resolvePublicClick() { return { targetUrl: 'javascript:alert(1)' }; },
    })).handle({ method: 'GET', path: `/t/c/${TOKEN}` });

    expect(unknown.status).toBe(404);
    expect(unsafe.status).toBe(404);
  });

  // F-A3a-04: deleted or unknown click links answered customers with a raw JSON error instead of a readable page.
  test('answers unknown or deleted click links with a neutral German HTML page', async () => {
    const unknown = await apiFor(makeTrackingPort()).handle({ method: 'GET', path: `/t/c/${TOKEN}` });
    const malformed = await apiFor(makeTrackingPort()).handle({ method: 'GET', path: '/t/c/not-a-token' });

    expect(unknown.status).toBe(404);
    expect(unknown.headers).toMatchObject({
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store, private',
      'Content-Security-Policy': "default-src 'none'",
      'X-Content-Type-Options': 'nosniff',
    });
    expect(typeof unknown.body).toBe('string');
    expect(unknown.body).toContain('<html lang="de">');
    expect(unknown.body).toContain('Link nicht mehr verfügbar');
    expect(unknown.body).not.toContain('tracking_not_found');
    expect(malformed).toEqual(unknown);
  });

  test('never redirects to a target taken from the request URL', async () => {
    const api = apiFor(makeTrackingPort({
      async resolvePublicClick() { return { targetUrl: 'https://customer.example/invoice/7' }; },
    }));

    const response = await api.handle({
      method: 'GET',
      path: `/t/c/${TOKEN}`,
      query: { url: 'https://evil.example/', redirect: 'https://evil.example/' },
    });
    expect(response.status).toBe(302);
    expect(response.headers?.Location).toBe('https://customer.example/invoice/7');
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
            pixelFetchCount: 0, automatedPixelFetchCount: 0, unknownPixelFetchCount: 0,
            probableHumanPixelFetchCount: 0, probableHumanOpenSessionCount: 0,
            firstPixelFetchedAt: null, lastPixelFetchedAt: null,
            firstProbableHumanOpenAt: null, lastProbableHumanOpenAt: null,
            openCount: 0, clickCount: 0, firstOpenedAt: null, lastOpenedAt: null,
            automatedOpenCount: 0, probableOpenCount: 0,
            automatedClickCount: 0, probableClickCount: 0,
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

  test('reclassifies tracking evidence only for admins and keeps missing messages non-disclosing', async () => {
    const calls: unknown[] = [];
    const tracking = makeTrackingPort({
      async reclassifyMessage(input) {
        calls.push(input);
        if (input.messageId === 18) throw new EmailTrackingMessageNotFoundError();
        return { classified: 7, unavailableRaw: 2 };
      },
    });
    const api = apiFor(tracking);
    const user = { ...principal, role: 'user' as const };

    const forbidden = await api.handle({
      method: 'POST',
      path: '/api/v1/email/messages/17/tracking/reclassify',
      principal: user,
    });
    expect(forbidden.status).toBe(403);
    expect(calls).toEqual([]);

    const success = await api.handle({
      method: 'POST',
      path: '/api/v1/email/messages/17/tracking/reclassify',
      principal,
    });
    expect(success).toMatchObject({
      status: 200,
      body: { data: { classified: 7, unavailableRaw: 2 } },
    });
    expect(calls).toEqual([{
      workspaceId: 'workspace-1',
      actorUserId: 'user-1',
      messageId: 17,
    }]);

    const missing = await api.handle({
      method: 'POST',
      path: '/api/v1/email/messages/18/tracking/reclassify',
      principal,
    });
    const unknownTimeline = await api.handle({
      method: 'GET',
      path: '/api/v1/email/messages/18/tracking',
      principal,
    });
    expect(missing).toEqual(unknownTimeline);
    expect(missing.status).toBe(404);
  });

  test('protects tracking IP insight with authentication, admin rights, and a canonical bigint event id', async () => {
    const calls: unknown[] = [];
    const audit = { record: jest.fn(async () => undefined) };
    const tracking = makeTrackingPort({
      async getIpInsight(input) {
        calls.push(input);
        return {
          ipAddress: '8.8.8.8', ipFamily: 'ipv4', scope: 'public',
          countryCode: 'US', continentCode: 'NA', asn: 15169,
          networkName: 'Google LLC', networkCidr: '8.8.8.0/24',
          databaseBuildAt: '2026-07-15T00:00:00.000Z',
        };
      },
    });
    const api = createServerApi({ auth: {} as never, emailTracking: tracking, audit } satisfies ServerApiPorts);
    const path = '/api/v1/email/messages/17/tracking/events/9007199254740993/ip-insight';

    await expect(api.handle({ method: 'GET', path })).resolves.toMatchObject({
      status: 401,
      body: { error: { code: 'unauthorized' } },
    });
    await expect(api.handle({
      method: 'GET', path, principal: { ...principal, role: 'user' },
    })).resolves.toMatchObject({ status: 403, body: { error: { code: 'forbidden' } } });
    const unavailableApi = createServerApi({ auth: {} as never } satisfies ServerApiPorts);
    await expect(unavailableApi.handle({
      method: 'GET', path, principal: { ...principal, role: 'user' },
    })).resolves.toMatchObject({ status: 403, body: { error: { code: 'forbidden' } } });
    expect(calls).toEqual([]);

    await expect(api.handle({ method: 'GET', path, principal })).resolves.toMatchObject({
      status: 200,
      body: { data: {
        ipAddress: '8.8.8.8', ipFamily: 'ipv4', scope: 'public', countryCode: 'US', continentCode: 'NA',
        asn: 15169, networkName: 'Google LLC', networkCidr: '8.8.8.0/24',
        databaseBuildAt: '2026-07-15T00:00:00.000Z',
      } },
    });
    expect(calls).toEqual([{
      workspaceId: 'workspace-1', actorUserId: 'user-1', messageId: 17, eventId: '9007199254740993',
    }]);
    expect(JSON.stringify(audit.record.mock.calls)).not.toMatch(/8\.8\.8\.8|Google|Mozilla|CIDR/i);
  });

  test.each([
    ['missing or foreign workspace/message/event association', new EmailTrackingIpInsightNotFoundError(), 404, 'tracking_not_found'],
    ['disabled policy', new EmailTrackingIpInsightForbiddenError(), 403, 'ip_insights_forbidden'],
    ['cleared or expired raw request data', new EmailTrackingIpInsightRawDataUnavailableError(), 410, 'ip_insight_raw_data_unavailable'],
    ['unavailable local MMDB for public IP', new EmailTrackingIpInsightUnavailableError(), 503, 'ip_insights_unavailable'],
  ])('keeps IP insight %s non-disclosing', async (_label, failure, status, code) => {
    const audit = { record: jest.fn(async () => undefined) };
    const api = createServerApi({
      auth: {} as never,
      audit,
      emailTracking: makeTrackingPort({
        async getIpInsight() { throw failure; },
      }),
    } satisfies ServerApiPorts);

    const response = await api.handle({
      method: 'GET',
      path: '/api/v1/email/messages/17/tracking/events/9007199254740993/ip-insight',
      principal,
    });

    expect(response).toMatchObject({ status, body: { error: { code } } });
    expect(JSON.stringify(audit.record.mock.calls)).not.toMatch(/IP|UA|Geo|ASN|CIDR|secret/i);
  });

  test('rejects non-canonical tracking IP insight event ids without coercing them to numbers', async () => {
    const audit = { record: jest.fn(async () => undefined) };
    const api = createServerApi({
      auth: {} as never,
      audit,
      emailTracking: makeTrackingPort(),
    } satisfies ServerApiPorts);
    await expect(api.handle({
      method: 'GET',
      path: '/api/v1/email/messages/17/tracking/events/09007199254740993/ip-insight',
      principal,
    })).resolves.toMatchObject({ status: 400, body: { error: { code: 'invalid_event_id' } } });
    await expect(api.handle({
      method: 'GET',
      path: '/api/v1/email/messages/17/tracking/events/9223372036854775808/ip-insight',
      principal,
    })).resolves.toMatchObject({ status: 400, body: { error: { code: 'invalid_event_id' } } });
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      action: 'email_tracking.ip_insight_denied',
      entityId: null,
      metadata: { outcome: 'invalid_event_id' },
    }));
    expect(JSON.stringify(audit.record.mock.calls)).not.toContain('9223372036854775808');
  });

  test('accepts the PostgreSQL bigint maximum for an IP insight event id', async () => {
    const calls: unknown[] = [];
    const api = apiFor(makeTrackingPort({
      async getIpInsight(input) {
        calls.push(input);
        return {
          ipAddress: '127.0.0.1', ipFamily: 'ipv4', scope: 'loopback',
          countryCode: null, continentCode: null, asn: null,
          networkName: null, networkCidr: null, databaseBuildAt: null,
        };
      },
    }));

    await expect(api.handle({
      method: 'GET',
      path: '/api/v1/email/messages/17/tracking/events/9223372036854775807/ip-insight',
      principal,
    })).resolves.toMatchObject({ status: 200 });
    expect(calls).toEqual([expect.objectContaining({ eventId: '9223372036854775807' })]);
  });

  test('checks IP insight admin rights before method, identifiers, or service availability', async () => {
    const audit = { record: jest.fn(async () => undefined) };
    const api = createServerApi({ auth: {} as never, audit } satisfies ServerApiPorts);
    const nonAdmin = { ...principal, role: 'user' as const };

    for (const request of [
      { method: 'POST', path: '/api/v1/email/messages/not-a-number/tracking/events/9223372036854775808/ip-insight' },
      { method: 'GET', path: '/api/v1/email/messages/not-a-number/tracking/events/not-a-number/ip-insight' },
    ]) {
      await expect(api.handle({ ...request, principal: nonAdmin })).resolves.toMatchObject({
        status: 403,
        body: { error: { code: 'forbidden' } },
      });
    }
    expect(audit.record).toHaveBeenCalledTimes(2);
    expect(audit.record).toHaveBeenNthCalledWith(1, expect.objectContaining({
      entityId: null,
      metadata: { outcome: 'forbidden' },
    }));
    expect(JSON.stringify(audit.record.mock.calls)).not.toMatch(/not-a-number|9223372036854775808/);
  });

  test('rejects a malformed IP insight event identifier for an admin before the service', async () => {
    const audit = { record: jest.fn(async () => undefined) };
    const api = createServerApi({
      auth: {} as never,
      audit,
      emailTracking: makeTrackingPort(),
    } satisfies ServerApiPorts);

    await expect(api.handle({
      method: 'GET',
      path: '/api/v1/email/messages/17/tracking/events/9223372036854775808/ip-insight',
      principal,
    })).resolves.toMatchObject({
      status: 400,
      body: { error: { code: 'invalid_event_id' } },
    });
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      entityId: null,
      metadata: { outcome: 'invalid_event_id' },
    }));
  });

  test('audits an admin malformed IP insight identifier without retaining it', async () => {
    const audit = { record: jest.fn(async () => undefined) };
    const api = createServerApi({
      auth: {} as never,
      audit,
      emailTracking: makeTrackingPort(),
    } satisfies ServerApiPorts);

    await expect(api.handle({
      method: 'GET',
      path: '/api/v1/email/messages/not-a-number/tracking/events/9223372036854775808/ip-insight',
      principal,
    })).resolves.toMatchObject({
      status: 400,
      body: { error: { code: 'invalid_message_id' } },
    });
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      action: 'email_tracking.ip_insight_denied',
      entityId: null,
      metadata: { outcome: 'invalid_message_id' },
    }));
    expect(JSON.stringify(audit.record.mock.calls)).not.toMatch(/not-a-number|9223372036854775808/);
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

  test('accepts IP insight policy updates and passes the explicit field through', async () => {
    const calls: unknown[] = [];
    const api = apiFor(makeTrackingPort({
      async setPolicy(input) {
        calls.push(input.values);
        return { ...policy, ipInsightsEnabled: true };
      },
    }));

    await expect(api.handle({
      method: 'PATCH',
      path: '/api/v1/email/tracking/settings',
      body: { ipInsightsEnabled: true },
      principal,
    })).resolves.toMatchObject({
      status: 200,
      body: { data: { ipInsightsEnabled: true } },
    });
    expect(calls).toEqual([{ ipInsightsEnabled: true }]);
  });
});
