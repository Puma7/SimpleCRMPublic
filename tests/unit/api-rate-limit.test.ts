import { checkApiRateLimit, resetApiRateLimits } from '../../packages/server/src/security/api-rate-limit';

describe('checkApiRateLimit', () => {
  beforeEach(() => {
    resetApiRateLimits();
  });

  test('allows requests under the auth-strict limit', () => {
    for (let i = 0; i < 20; i += 1) {
      expect(checkApiRateLimit({ ip: '1.2.3.4', path: '/api/v1/auth/login', method: 'POST' })).toEqual({ allowed: true });
    }
    expect(checkApiRateLimit({ ip: '1.2.3.4', path: '/api/v1/auth/login', method: 'POST' })).toEqual({
      allowed: false,
      limit: 20,
      bucket: 'auth-strict',
      retryAfterMs: expect.any(Number),
    });
  });

  test('uses separate buckets per path class', () => {
    for (let i = 0; i < 20; i += 1) {
      expect(checkApiRateLimit({ ip: '1.2.3.4', path: '/api/v1/auth/login', method: 'POST' })).toEqual({ allowed: true });
    }
    expect(checkApiRateLimit({ ip: '1.2.3.4', path: '/api/v1/customers', method: 'GET' })).toEqual({ allowed: true });
  });

  test('applies api-global limit to regular API routes', () => {
    for (let i = 0; i < 600; i += 1) {
      expect(checkApiRateLimit({ ip: '9.9.9.9', path: '/api/v1/tasks', method: 'GET' })).toEqual({ allowed: true });
    }
    expect(checkApiRateLimit({ ip: '9.9.9.9', path: '/api/v1/tasks', method: 'GET' })).toEqual({
      allowed: false,
      limit: 600,
      bucket: 'api-global',
      retryAfterMs: expect.any(Number),
    });
  });

  test('gives mail READS their own generous bucket', () => {
    // Opening one message fans out ~10+ GETs, so mail reads tolerate a chatty UI
    // (300 would be too low) and are isolated from the api-global bucket.
    for (let i = 0; i < 1200; i += 1) {
      expect(checkApiRateLimit({ ip: '7.7.7.7', path: '/api/v1/email/messages/42', method: 'GET' })).toEqual({ allowed: true });
    }
    expect(checkApiRateLimit({ ip: '7.7.7.7', path: '/api/v1/email/messages/42', method: 'GET' })).toEqual({
      allowed: false,
      limit: 1200,
      bucket: 'email',
      retryAfterMs: expect.any(Number),
    });
    // A different bucket (api-global) for the same IP is unaffected.
    expect(checkApiRateLimit({ ip: '7.7.7.7', path: '/api/v1/tasks', method: 'GET' })).toEqual({ allowed: true });
  });

  test('gives cheap inbox-triage mutations the generous bucket too', () => {
    // Marking many messages as spam in quick succession was the original trigger,
    // so the cheap triage mutations share the generous mail bucket.
    for (const { path, method } of [
      { path: '/api/v1/email/messages/42/spam-status', method: 'PATCH' }, // viewer spam buttons
      { path: '/api/v1/email/messages/bulk/spam-status', method: 'PATCH' }, // bulk spam triage
      { path: '/api/v1/email/messages/42/spam-decision', method: 'POST' },
      { path: '/api/v1/email/messages/42/seen', method: 'POST' },
      { path: '/api/v1/email/messages/42/archive', method: 'POST' },
      { path: '/api/v1/email/messages/42/move', method: 'POST' },
    ]) {
      resetApiRateLimits();
      for (let i = 0; i < 1200; i += 1) {
        expect(checkApiRateLimit({ ip: '6.6.6.6', path, method })).toEqual({ allowed: true });
      }
      expect(checkApiRateLimit({ ip: '6.6.6.6', path, method })).toEqual({
        allowed: false,
        limit: 1200,
        bucket: 'email',
        retryAfterMs: expect.any(Number),
      });
    }
  });

  test('keeps expensive / side-effecting mail actions on the strict api-global bucket', () => {
    // Sending, external connection tests, outbound test mails, security scans and
    // GDPR export must NOT inherit the generous 1200/min mail allowance — a
    // future side-effecting endpoint must stay capped by default, not fall into
    // the read bucket.
    for (const { path, method } of [
      { path: '/api/v1/email/compose/send', method: 'POST' },
      { path: '/api/v1/email/gdpr-export', method: 'GET' }, // expensive GET exception
      { path: '/api/v1/email/accounts/test-smtp', method: 'POST' },
      { path: '/api/v1/email/settings/security/test-rspamd', method: 'POST' },
      { path: '/api/v1/email/accounts/12/vacation-test', method: 'POST' }, // sends SMTP
      { path: '/api/v1/email/messages/42/security/check', method: 'POST' }, // rspamd/mailauth
      { path: '/api/v1/email/accounts/12/sync', method: 'POST' }, // external IMAP/POP3
      { path: '/api/v1/email/attachments/7/content', method: 'GET' }, // heavy binary download
    ]) {
      resetApiRateLimits();
      for (let i = 0; i < 600; i += 1) {
        expect(checkApiRateLimit({ ip: '5.5.5.5', path, method })).toEqual({ allowed: true });
      }
      expect(checkApiRateLimit({ ip: '5.5.5.5', path, method })).toEqual({
        allowed: false,
        limit: 600,
        bucket: 'api-global',
        retryAfterMs: expect.any(Number),
      });
    }
  });
});
