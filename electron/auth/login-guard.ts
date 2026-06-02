const failures = new Map<string, { count: number; lockedUntil: number }>();

const MAX_FAILURES = 5;
const LOCK_MS = 30_000;

export function checkLoginAllowed(username: string): { ok: true } | { ok: false; waitMs: number } {
  const key = username.trim().toLowerCase();
  const row = failures.get(key);
  if (!row) return { ok: true };
  const now = Date.now();
  if (row.lockedUntil > now) {
    return { ok: false, waitMs: row.lockedUntil - now };
  }
  if (row.lockedUntil <= now && row.count >= MAX_FAILURES) {
    failures.delete(key);
  }
  return { ok: true };
}

export function recordLoginFailure(username: string): void {
  const key = username.trim().toLowerCase();
  const row = failures.get(key) ?? { count: 0, lockedUntil: 0 };
  row.count += 1;
  if (row.count >= MAX_FAILURES) {
    row.lockedUntil = Date.now() + LOCK_MS;
    row.count = 0;
  }
  failures.set(key, row);
}

export function clearLoginFailures(username: string): void {
  failures.delete(username.trim().toLowerCase());
}
