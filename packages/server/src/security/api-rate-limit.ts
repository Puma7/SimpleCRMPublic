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

// Reads that must NOT ride the generous mail bucket even though they use GET: a
// full-mailbox GDPR export is heavy and low-frequency, so it stays capped.
const EMAIL_EXPENSIVE_GET_PATHS = new Set<string>([
  '/api/v1/email/gdpr-export',
]);

function isExpensiveEmailGet(path: string): boolean {
  if (EMAIL_EXPENSIVE_GET_PATHS.has(path)) return true;
  // Attachment content streams the whole attachment into a Buffer and returns it
  // with Content-Length — bandwidth/memory heavy, so it stays on the global
  // bucket instead of the chatty read allowance.
  if (path.startsWith('/api/v1/email/attachments/') && path.endsWith('/content')) return true;
  return false;
}

// Cheap, high-frequency inbox-triage mutations a human fires while working
// through the inbox (mark spam/seen/done, archive, move, snooze, delete,
// assign, apply actions, and consuming a remote-content prompt). These share
// the generous read bucket — marking many messages as spam in quick succession
// was the original "zu viele Anfragen" trigger. EVERY other mail mutation —
// sending, syncing, external connection/security tests, AI generation — is left
// on the global bucket by falling through, so a future side-effecting endpoint
// is capped by default rather than silently inheriting 1200/min.
const EMAIL_TRIAGE_MUTATION_SUFFIXES = [
  '/spam-decision',
  '/spam-status', // the viewer's spam/not-spam buttons — the original trigger
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

function bucketForPath(method: string, path: string): RateLimitBucket {
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
    // The mail UI is chatty on reads: opening one message fans out ~10+ GETs
    // (body, metadata, thread, security, remote-content, read-receipt), so all
    // reads get the generous bucket, save the heavy exports above.
    if (upper === 'GET' || upper === 'HEAD') {
      return isExpensiveEmailGet(path) ? 'api-global' : 'email';
    }
    // Cheap triage mutations are generous too; anything else that mutates stays
    // capped on the global bucket so outbound sends / tests / scans can't be
    // driven at the chatty mailbox-read rate.
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
  const bucket = bucketForPath(input.method, input.path);
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
