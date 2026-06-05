import { createHash, timingSafeEqual } from 'node:crypto';

export const TOKEN_HASH_ALGORITHM = 'sha256';

export function hashRefreshToken(token: string): string {
  const trimmed = token.trim();
  if (!trimmed) {
    throw new Error('refresh token is required');
  }
  return createHash(TOKEN_HASH_ALGORITHM).update(trimmed, 'utf8').digest('hex');
}

export function verifyRefreshTokenHash(token: string, expectedHash: string): boolean {
  const actual = Buffer.from(hashRefreshToken(token), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}
