import { AUTOMATION_RATE_LIMIT_PER_MINUTE } from '../../shared/automation-api';

type Window = { count: number; windowStartMs: number };

const windows = new Map<string, Window>();

export function checkRateLimit(keyId: string): { allowed: boolean; limit: number } {
  const limit = AUTOMATION_RATE_LIMIT_PER_MINUTE;
  const now = Date.now();
  let w = windows.get(keyId);
  if (!w || now - w.windowStartMs >= 60_000) {
    w = { count: 0, windowStartMs: now };
    windows.set(keyId, w);
  }
  w.count += 1;
  return { allowed: w.count <= limit, limit };
}

/** Test helper */
export function resetRateLimits(): void {
  windows.clear();
}
