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
    });
  });

  test('uses separate buckets per path class', () => {
    for (let i = 0; i < 20; i += 1) {
      expect(checkApiRateLimit({ ip: '1.2.3.4', path: '/api/v1/auth/login' })).toEqual({ allowed: true });
    }
    expect(checkApiRateLimit({ ip: '1.2.3.4', path: '/api/v1/customers' })).toEqual({ allowed: true });
  });

  test('applies api-global limit to regular API routes', () => {
    for (let i = 0; i < 300; i += 1) {
      expect(checkApiRateLimit({ ip: '9.9.9.9', path: '/api/v1/tasks' })).toEqual({ allowed: true });
    }
    expect(checkApiRateLimit({ ip: '9.9.9.9', path: '/api/v1/tasks' })).toEqual({
      allowed: false,
      limit: 300,
      bucket: 'api-global',
    });
  });
});
