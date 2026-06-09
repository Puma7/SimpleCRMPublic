import { createHash } from 'node:crypto';

const consumed = new Map<string, number>();

function tokenKey(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function pruneExpired(nowMs: number): void {
  for (const [key, expiresAtMs] of consumed) {
    if (expiresAtMs <= nowMs) consumed.delete(key);
  }
}

/** Returns true when the token is accepted for the first time within the TTL window. */
export function consumeSingleUseToken(token: string, ttlMs: number, nowMs = Date.now()): boolean {
  const normalized = token.trim();
  if (!normalized) return false;
  pruneExpired(nowMs);
  const key = tokenKey(normalized);
  if (consumed.has(key)) return false;
  consumed.set(key, nowMs + ttlMs);
  return true;
}

/** Test helper */
export function resetConsumedTokens(): void {
  consumed.clear();
}
