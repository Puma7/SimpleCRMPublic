import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import type { AccessTokenSigner } from './access-token';

const CAPTCHA_CHALLENGE_TYPE = 'simplecrm-captcha-challenge-v1';
const DEFAULT_TTL_SECONDS = 10 * 60;
export const CAPTCHA_CHALLENGE_TTL_MS = DEFAULT_TTL_SECONDS * 1000;

export type CaptchaChallengeClaims = Readonly<{
  typ: typeof CAPTCHA_CHALLENGE_TYPE;
  ip: string;
  iat: number;
  exp: number;
  nonce: string;
}>;

export function issueCaptchaChallenge(input: {
  signer: AccessTokenSigner;
  ip: string;
  issuedAt: Date;
  ttlSeconds?: number;
}): string {
  const ttlSeconds = input.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  const issuedAtSeconds = Math.floor(input.issuedAt.getTime() / 1000);
  const payload = encodeJson({
    typ: CAPTCHA_CHALLENGE_TYPE,
    ip: input.ip,
    iat: issuedAtSeconds,
    exp: issuedAtSeconds + ttlSeconds,
    nonce: randomBytes(16).toString('base64url'),
  } satisfies CaptchaChallengeClaims);
  const signature = sign(payload, input.signer.secret);
  return `${payload}.${signature}`;
}

export function verifyCaptchaChallenge(input: {
  token: string;
  signer: AccessTokenSigner;
  ip: string;
  now?: Date;
}): boolean {
  const parts = input.token.split('.');
  if (parts.length !== 2) return false;
  const [payloadPart, signaturePart] = parts;
  const expectedSignature = sign(payloadPart, input.signer.secret);
  if (!safeEqualBase64Url(signaturePart, expectedSignature)) return false;

  const claims = decodeJson<CaptchaChallengeClaims>(payloadPart);
  if (!claims || claims.typ !== CAPTCHA_CHALLENGE_TYPE) return false;
  if (claims.ip !== input.ip) return false;

  const nowSeconds = Math.floor((input.now ?? new Date()).getTime() / 1000);
  if (!Number.isInteger(claims.exp) || claims.exp <= nowSeconds) return false;
  if (!Number.isInteger(claims.iat) || claims.iat > nowSeconds) return false;
  return true;
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
