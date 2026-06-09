import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import type { AccessTokenSigner } from './access-token';

const MFA_CHALLENGE_TYPE = 'simplecrm-mfa-challenge-v1';
const DEFAULT_TTL_SECONDS = 5 * 60;

export type MfaChallengeClaims = Readonly<{
  typ: typeof MFA_CHALLENGE_TYPE;
  userId: string;
  workspaceId: string;
  method: 'totp' | 'email';
  iat: number;
  exp: number;
  nonce: string;
}>;

export function issueMfaChallengeToken(input: {
  signer: AccessTokenSigner;
  userId: string;
  workspaceId: string;
  method: 'totp' | 'email';
  issuedAt: Date;
  ttlSeconds?: number;
}): string {
  const ttlSeconds = input.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  const issuedAtSeconds = Math.floor(input.issuedAt.getTime() / 1000);
  const payload = encodeJson({
    typ: MFA_CHALLENGE_TYPE,
    userId: input.userId,
    workspaceId: input.workspaceId,
    method: input.method,
    iat: issuedAtSeconds,
    exp: issuedAtSeconds + ttlSeconds,
    nonce: randomBytes(16).toString('base64url'),
  } satisfies MfaChallengeClaims);
  const signature = sign(payload, input.signer.secret);
  return `${payload}.${signature}`;
}

export function parseMfaChallengeToken(input: {
  token: string;
  signer: AccessTokenSigner;
  now?: Date;
}): MfaChallengeClaims | null {
  const parts = input.token.split('.');
  if (parts.length !== 2) return null;
  const [payloadPart, signaturePart] = parts;
  const expectedSignature = sign(payloadPart, input.signer.secret);
  if (!safeEqualBase64Url(signaturePart, expectedSignature)) return null;

  const claims = decodeJson<MfaChallengeClaims>(payloadPart);
  if (!claims || claims.typ !== MFA_CHALLENGE_TYPE) return null;
  const nowSeconds = Math.floor((input.now ?? new Date()).getTime() / 1000);
  if (!Number.isInteger(claims.exp) || claims.exp <= nowSeconds) return null;
  if (!Number.isInteger(claims.iat) || claims.iat > nowSeconds) return null;
  if (!claims.userId || !claims.workspaceId) return null;
  if (claims.method !== 'totp' && claims.method !== 'email') return null;
  return claims;
}

function sign(payload: string, secret: Buffer): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

function encodeJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function decodeJson<T>(encoded: string): T | null {
  try {
    return JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as T;
  } catch {
    return null;
  }
}

function safeEqualBase64Url(left: string, right: string): boolean {
  const leftBuf = Buffer.from(left);
  const rightBuf = Buffer.from(right);
  if (leftBuf.length !== rightBuf.length) return false;
  return timingSafeEqual(leftBuf, rightBuf);
}
