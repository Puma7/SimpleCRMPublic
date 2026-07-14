import { createHash } from 'node:crypto';

type AttemptState = { count: number; expiresAtMs: number };

const attempts = new Map<string, AttemptState>();

function tokenKey(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Returns false once the token has already used all allowed attempts. */
export function registerTokenAttempt(
  token: string,
  maxAttempts: number,
  ttlMs: number,
  nowMs = Date.now(),
): boolean {
  const normalized = token.trim();
  if (!normalized || maxAttempts < 1 || ttlMs < 1) return false;
  for (const [key, state] of attempts) {
    if (state.expiresAtMs <= nowMs) attempts.delete(key);
  }
  const key = tokenKey(normalized);
  const current = attempts.get(key);
  if (current && current.count >= maxAttempts) return false;
  attempts.set(key, {
    count: (current?.count ?? 0) + 1,
    expiresAtMs: current?.expiresAtMs ?? nowMs + ttlMs,
  });
  return true;
}
