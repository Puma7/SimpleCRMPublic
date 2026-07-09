type RateLimitBucket = 'auth-strict' | 'auth-public' | 'api-global';

type Window = { count: number; windowStartMs: number };

const windows = new Map<string, Window>();

const LIMITS: Record<RateLimitBucket, number> = {
  'auth-strict': 20,
  'auth-public': 60,
  'api-global': 300,
};

const WINDOW_MS = 60_000;

function bucketForPath(path: string): RateLimitBucket {
  if (
    path === '/api/v1/auth/login'
    || path === '/api/v1/auth/refresh'
    || path === '/api/v1/auth/initial-setup'
    || path === '/api/v1/auth/captcha-verify'
    || path === '/api/v1/auth/mfa/verify'
    || path.startsWith('/api/v1/auth/invitations/')
  ) {
    return 'auth-strict';
  }
  if (path === '/api/v1/auth/setup-state' || path === '/api/v1/auth/login-config') {
    return 'auth-public';
  }
  return 'api-global';
}

export type ApiRateLimitResult =
  | { allowed: true }
  | { allowed: false; limit: number; bucket: RateLimitBucket };

export function checkApiRateLimit(input: {
  ip: string;
  path: string;
}): ApiRateLimitResult {
  const bucket = bucketForPath(input.path);
  const limit = LIMITS[bucket];
  const key = `${bucket}:${input.ip || 'unknown'}`;
  const now = Date.now();
  let window = windows.get(key);
  if (!window || now - window.windowStartMs >= WINDOW_MS) {
    window = { count: 0, windowStartMs: now };
    windows.set(key, window);
  }
  window.count += 1;
  if (window.count > limit) {
    return { allowed: false, limit, bucket };
  }
  return { allowed: true };
}

/** Test helper */
export function resetApiRateLimits(): void {
  windows.clear();
}
