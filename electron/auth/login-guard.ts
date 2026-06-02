import { getSyncInfo, setSyncInfo } from '../sqlite-service';

const SYNC_KEY = 'auth_login_failures_v1';
const MAX_FAILURES = 5;
const BASE_LOCK_MS = 30_000;
const MAX_LOCK_MS = 24 * 60 * 60 * 1000;

type FailureRow = { count: number; lockedUntil: number; lockLevel: number };

function lockDurationMs(lockLevel: number): number {
  const level = Math.max(0, Math.min(lockLevel, 12));
  return Math.min(BASE_LOCK_MS * 2 ** level, MAX_LOCK_MS);
}

function loadFailures(): Map<string, FailureRow> {
  try {
    const raw = getSyncInfo(SYNC_KEY);
    if (!raw) return new Map();
    const parsed = JSON.parse(raw) as Record<
      string,
      { count: number; lockedUntil: number; lockLevel?: number }
    >;
    const map = new Map<string, FailureRow>();
    for (const [key, row] of Object.entries(parsed)) {
      map.set(key, {
        count: row.count ?? 0,
        lockedUntil: row.lockedUntil ?? 0,
        lockLevel: row.lockLevel ?? 0,
      });
    }
    return map;
  } catch {
    return new Map();
  }
}

function persistFailures(map: Map<string, FailureRow>): void {
  try {
    setSyncInfo(SYNC_KEY, JSON.stringify(Object.fromEntries(map.entries())));
  } catch {
    /* DB not ready (tests) */
  }
}

let failures: Map<string, FailureRow> | null = null;

function ensureFailuresLoaded(): Map<string, FailureRow> {
  if (!failures) failures = loadFailures();
  return failures;
}

export function checkLoginAllowed(username: string): { ok: true } | { ok: false; waitMs: number } {
  const key = username.trim().toLowerCase();
  const map = ensureFailuresLoaded();
  const row = map.get(key);
  if (!row) return { ok: true };
  const now = Date.now();
  if (row.lockedUntil > now) {
    return { ok: false, waitMs: row.lockedUntil - now };
  }
  return { ok: true };
}

export function recordLoginFailure(username: string): void {
  const key = username.trim().toLowerCase();
  const map = ensureFailuresLoaded();
  const row = map.get(key) ?? { count: 0, lockedUntil: 0, lockLevel: 0 };
  row.count += 1;
  if (row.count >= MAX_FAILURES) {
    row.lockedUntil = Date.now() + lockDurationMs(row.lockLevel);
    row.lockLevel += 1;
    row.count = 0;
  }
  map.set(key, row);
  persistFailures(map);
}

export function clearLoginFailures(username: string): void {
  const map = ensureFailuresLoaded();
  map.delete(username.trim().toLowerCase());
  persistFailures(map);
}

/** Test hook: reset in-memory cache after DB swap. */
export function reloadLoginFailuresFromDb(): void {
  failures = loadFailures();
}
