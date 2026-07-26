import type { PostgresApiRateLimitPort } from './postgres-api-rate-limit';

export type RateLimitBucket = 'auth-strict' | 'auth-public' | 'email' | 'api-global';

type Window = { count: number; windowStartMs: number };

const windows = new Map<string, Window>();

export const RATE_LIMITS: Record<RateLimitBucket, number> = {
  'auth-strict': 20,
  'auth-public': 60,
  'email': 1200,
  'api-global': 300,
};

const WINDOW_MS = 60_000;

// Reads that must NOT ride the generous mail bucket even though they use GET —
// heavy, low-frequency admin/dashboard endpoints, not part of the chatty
// message-opening flow: a full-mailbox GDPR export; diagnostics (walks the whole
// attachments dir with readdir/stat plus aggregate queries); reporting (multiple
// aggregate queries over email_messages / email_workflow_runs).
const EMAIL_EXPENSIVE_GET_PATHS = new Set<string>([
  '/api/v1/email/gdpr-export',
  '/api/v1/email/diagnostics',
  '/api/v1/email/reporting',
]);

function isExpensiveEmailGet(path: string): boolean {
  if (EMAIL_EXPENSIVE_GET_PATHS.has(path)) return true;
  if (path.startsWith('/api/v1/email/attachments/') && path.endsWith('/content')) return true;
  if (path.startsWith('/api/v1/email/messages/') && path.endsWith('/raw-headers')) return true;
  return false;
}

const EMAIL_TRIAGE_MUTATION_SUFFIXES = [
  '/spam-decision',
  '/spam-status',
  '/seen',
  '/done',
  '/archive',
  '/move',
  '/snooze',
  '/soft-delete',
  '/restore',
  '/assignment',
  '/actions',
  '/remote-content-policy/consume',
];

export function bucketForApiPath(method: string, path: string): RateLimitBucket {
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
    const upper = method.toUpperCase();
    if (upper === 'GET' || upper === 'HEAD') {
      return isExpensiveEmailGet(path) ? 'api-global' : 'email';
    }
    if (EMAIL_TRIAGE_MUTATION_SUFFIXES.some((suffix) => path.endsWith(suffix))) {
      return 'email';
    }
    return 'api-global';
  }
  return 'api-global';
}

export type ApiRateLimitResult =
  | { allowed: true }
  | { allowed: false; limit: number; bucket: RateLimitBucket; retryAfterMs: number };

export function checkApiRateLimit(input: {
  ip: string;
  path: string;
  method: string;
}): ApiRateLimitResult {
  const bucket = bucketForApiPath(input.method, input.path);
  const limit = RATE_LIMITS[bucket];
  const key = `${bucket}:${input.ip || 'unknown'}`;
  const now = Date.now();
  let window = windows.get(key);
  if (!window || now - window.windowStartMs >= WINDOW_MS) {
    window = { count: 0, windowStartMs: now };
    windows.set(key, window);
  }
  window.count += 1;
  if (window.count > limit) {
    const retryAfterMs = Math.max(0, WINDOW_MS - (now - window.windowStartMs));
    return { allowed: false, limit, bucket, retryAfterMs };
  }
  return { allowed: true };
}

export async function checkApiRateLimitShared(
  input: {
    ip: string;
    path: string;
    method: string;
  },
  options: {
    shared?: PostgresApiRateLimitPort;
  } = {},
): Promise<ApiRateLimitResult> {
  const bucket = bucketForApiPath(input.method, input.path);
  const limit = RATE_LIMITS[bucket];
  const clientKey = input.ip || 'unknown';
  if (options.shared) {
    try {
      return await options.shared.check({ bucket, clientKey, limit });
    } catch {
      // Fall back to the in-process limiter when the shared store is unavailable.
    }
  }
  return checkApiRateLimit(input);
}

/** Test helper */
export function resetApiRateLimits(): void {
  windows.clear();
}
