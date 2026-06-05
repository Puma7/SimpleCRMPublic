import { createHmac, timingSafeEqual } from 'node:crypto';

import type { AuthenticatedPrincipal } from '../api';

export const ACCESS_TOKEN_ALGORITHM = 'HS256';
export const ACCESS_TOKEN_TYPE = 'simplecrm-access-token-v1';

export type AccessTokenSigner = Readonly<{
  keyId: string;
  secret: Buffer;
}>;

export type AccessTokenClaims = AuthenticatedPrincipal & Readonly<{
  iat: number;
  exp: number;
}>;

export function createAccessToken(input: {
  signer: AccessTokenSigner;
  principal: AuthenticatedPrincipal;
  issuedAt: Date;
  expiresInSeconds: number;
}): string {
  if (input.expiresInSeconds <= 0 || !Number.isInteger(input.expiresInSeconds)) {
    throw new Error('expiresInSeconds must be a positive integer');
  }

  const issuedAtSeconds = Math.floor(input.issuedAt.getTime() / 1000);
  const header = encodeJson({
    alg: ACCESS_TOKEN_ALGORITHM,
    typ: ACCESS_TOKEN_TYPE,
    kid: input.signer.keyId,
  });
  const payload = encodeJson({
    userId: input.principal.userId,
    workspaceId: input.principal.workspaceId,
    role: input.principal.role,
    ...(input.principal.sessionId ? { sessionId: input.principal.sessionId } : {}),
    iat: issuedAtSeconds,
    exp: issuedAtSeconds + input.expiresInSeconds,
  } satisfies AccessTokenClaims);
  const signature = sign(`${header}.${payload}`, input.signer.secret);
  return `${header}.${payload}.${signature}`;
}

export function verifyAccessToken(input: {
  token: string;
  signer: AccessTokenSigner;
  now?: Date;
}): AuthenticatedPrincipal | null {
  const parts = input.token.split('.');
  if (parts.length !== 3) return null;
  const [headerPart, payloadPart, signaturePart] = parts;
  const header = decodeJson<Record<string, unknown>>(headerPart);
  if (!header || header.alg !== ACCESS_TOKEN_ALGORITHM || header.typ !== ACCESS_TOKEN_TYPE || header.kid !== input.signer.keyId) {
    return null;
  }

  const expectedSignature = sign(`${headerPart}.${payloadPart}`, input.signer.secret);
  if (!safeEqualBase64Url(signaturePart, expectedSignature)) return null;

  const claims = decodeJson<Partial<AccessTokenClaims>>(payloadPart);
  if (
    !claims
    || !isPrincipalRole(claims.role)
    || typeof claims.userId !== 'string'
    || claims.userId.length === 0
    || typeof claims.workspaceId !== 'string'
    || claims.workspaceId.length === 0
  ) {
    return null;
  }
  if (claims.sessionId !== undefined && (typeof claims.sessionId !== 'string' || claims.sessionId.length === 0)) {
    return null;
  }
  if (typeof claims.exp !== 'number' || typeof claims.iat !== 'number') {
    return null;
  }
  const nowSeconds = Math.floor((input.now ?? new Date()).getTime() / 1000);
  if (claims.exp <= nowSeconds || claims.iat > nowSeconds + 60) {
    return null;
  }

  return {
    userId: claims.userId,
    workspaceId: claims.workspaceId,
    role: claims.role,
    ...(claims.sessionId ? { sessionId: claims.sessionId } : {}),
  };
}

export function accessTokenSignerFromBase64(secret: string, keyId = 'default'): AccessTokenSigner {
  const bytes = Buffer.from(secret, 'base64');
  if (bytes.length < 32) {
    throw new Error('ACCESS_TOKEN_SECRET must decode to at least 32 bytes');
  }
  return { keyId, secret: bytes };
}

export function bearerTokenFromAuthorizationHeader(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : null;
}

function encodeJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function decodeJson<T>(value: string): T | null {
  try {
    return JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as T;
  } catch {
    return null;
  }
}

function sign(payload: string, secret: Buffer): string {
  return createHmac('sha256', secret).update(payload, 'utf8').digest('base64url');
}

function safeEqualBase64Url(actual: string, expected: string): boolean {
  const actualBytes = Buffer.from(actual, 'base64url');
  const expectedBytes = Buffer.from(expected, 'base64url');
  if (actualBytes.length !== expectedBytes.length) return false;
  return timingSafeEqual(actualBytes, expectedBytes);
}

function isPrincipalRole(value: unknown): value is AuthenticatedPrincipal['role'] {
  return value === 'owner' || value === 'admin' || value === 'user';
}
