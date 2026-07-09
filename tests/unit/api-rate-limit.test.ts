import { checkApiRateLimit, resetApiRateLimits } from '../../packages/server/src/security/api-rate-limit';

describe('checkApiRateLimit', () => {
  beforeEach(() => {
    resetApiRateLimits();
  });

  test('allows requests under the auth-strict limit', () => {
    for (let i = 0; i < 20; i += 1) {
      expect(checkApiRateLimit({ ip: '1.2.3.4', path: '/api/v1/auth/login' })).toEqual({ allowed: true });
    }
    expect(checkApiRateLimit({ ip: '1.2.3.4', path: '/api/v1/auth/login' })).toEqual({
      allowed: false,
      limit: 20,
      bucket: 'auth-strict',
      retryAfterMs: expect.any(Number),
    });
  });

  test('uses separate buckets per path class', () => {
    for (let i = 0; i < 20; i += 1) {
      expect(checkApiRateLimit({ ip: '1.2.3.4', path: '/api/v1/auth/login' })).toEqual({ allowed: true });
    }
    expect(checkApiRateLimit({ ip: '1.2.3.4', path: '/api/v1/customers' })).toEqual({ allowed: true });
  });

  test('applies api-global limit to regular API routes', () => {
    for (let i = 0; i < 600; i += 1) {
      expect(checkApiRateLimit({ ip: '9.9.9.9', path: '/api/v1/tasks' })).toEqual({ allowed: true });
    }
    expect(checkApiRateLimit({ ip: '9.9.9.9', path: '/api/v1/tasks' })).toEqual({
      allowed: false,
      limit: 600,
      bucket: 'api-global',
      retryAfterMs: expect.any(Number),
    });
  });

  test('gives mail routes their own generous bucket', () => {
    // Email routes tolerate the chatty mailbox UI (300 would be too low), and
    // are isolated from the api-global bucket.
    for (let i = 0; i < 1200; i += 1) {
      expect(checkApiRateLimit({ ip: '7.7.7.7', path: '/api/v1/email/messages/42' })).toEqual({ allowed: true });
    }
    expect(checkApiRateLimit({ ip: '7.7.7.7', path: '/api/v1/email/messages/42' })).toEqual({
      allowed: false,
      limit: 1200,
      bucket: 'email',
      retryAfterMs: expect.any(Number),
    });
    // A different bucket (api-global) for the same IP is unaffected.
    expect(checkApiRateLimit({ ip: '7.7.7.7', path: '/api/v1/tasks' })).toEqual({ allowed: true });
  });

  test('keeps expensive mail actions on the strict api-global bucket', () => {
    // Sending, external connection tests, and GDPR export must NOT get the
    // generous 1200/min mail allowance.
    for (const path of [
      '/api/v1/email/compose/send',
      '/api/v1/email/gdpr-export',
      '/api/v1/email/accounts/test-smtp',
    ]) {
      resetApiRateLimits();
      for (let i = 0; i < 600; i += 1) {
        expect(checkApiRateLimit({ ip: '5.5.5.5', path })).toEqual({ allowed: true });
      }
      expect(checkApiRateLimit({ ip: '5.5.5.5', path })).toEqual({
        allowed: false,
        limit: 600,
        bucket: 'api-global',
        retryAfterMs: expect.any(Number),
      });
    }
  });
});
