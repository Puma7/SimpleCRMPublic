import { getSyncInfo, setSyncInfo } from '../sqlite-service';

const SYNC_KEY = 'auth_login_failures_v1';
const MAX_FAILURES = 5;
const LOCK_MS = 30_000;

function loadFailures(): Map<string, { count: number; lockedUntil: number }> {
  try {
    const raw = getSyncInfo(SYNC_KEY);
    if (!raw) return new Map();
    const parsed = JSON.parse(raw) as Record<string, { count: number; lockedUntil: number }>;
    return new Map(Object.entries(parsed));
  } catch {
    return new Map();
  }
}

function persistFailures(map: Map<string, { count: number; lockedUntil: number }>): void {
  try {
    setSyncInfo(SYNC_KEY, JSON.stringify(Object.fromEntries(map.entries())));
  } catch {
    /* DB not ready (tests) */
  }
}

let failures = loadFailures();

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
    persistFailures(failures);
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
  persistFailures(failures);
}

export function clearLoginFailures(username: string): void {
  failures.delete(username.trim().toLowerCase());
  persistFailures(failures);
}
