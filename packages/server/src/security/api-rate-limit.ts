type RateLimitBucket = 'auth-strict' | 'auth-public' | 'email' | 'api-global';

type Window = { count: number; windowStartMs: number };

const windows = new Map<string, Window>();

const LIMITS: Record<RateLimitBucket, number> = {
  'auth-strict': 20,
  'auth-public': 60,
  // The mail UI is chatty: opening one message fans out ~10+ GETs (body,
  // metadata, thread/remote/read-receipt checks) and marking spam auto-advances
  // to the next one. A human working through the inbox quickly exceeds 300/min,
  // so mail routes get a generous per-client bucket of their own.
  'email': 1200,
  'api-global': 600,
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
  if (path.startsWith('/api/v1/email/')) {
    return 'email';
  }
  return 'api-global';
}

export type ApiRateLimitResult =
  | { allowed: true }
  | { allowed: false; limit: number; bucket: RateLimitBucket; retryAfterMs: number };

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
    // How long until this window resets and the client may retry.
    const retryAfterMs = Math.max(0, WINDOW_MS - (now - window.windowStartMs));
    return { allowed: false, limit, bucket, retryAfterMs };
  }
  return { allowed: true };
}

/** Test helper */
export function resetApiRateLimits(): void {
  windows.clear();
}
