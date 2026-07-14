import { createHash, timingSafeEqual } from 'node:crypto';

import type { ApiRequest, ApiResponse, TokenPair } from './types';
import { json } from './http';

export const AUTH_REFRESH_COOKIE_NAME = 'simplecrm_refresh';
const AUTH_REFRESH_COOKIE_PATH = '/api/v1/auth';
const AUTH_REFRESH_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
const CSRF_HEADER = 'x-csrf-token';
const LEGACY_MIGRATION_HEADER = 'x-simplecrm-session-migration';

export function authSessionData<T extends Record<string, unknown>>(
  req: ApiRequest,
  status: number,
  value: T,
  tokens: TokenPair,
): ApiResponse {
  const csrfToken = csrfTokenForRefreshToken(tokens.refreshToken);
  return json(status, {
    data: {
      ...value,
      tokens: {
        accessToken: tokens.accessToken,
        expiresInSeconds: tokens.expiresInSeconds,
      },
      csrfToken,
    },
  }, sessionHeaders(req, tokens.refreshToken));
}

export function csrfBootstrapData(req: ApiRequest): ApiResponse {
  const refreshToken = refreshTokenFromCookie(req);
  if (!refreshToken) {
    return json(401, {
      error: {
        code: 'refresh_cookie_required',
        message: 'Keine aktive Browser-Sitzung',
      },
    }, noStoreHeaders());
  }
  return json(200, {
    data: { csrfToken: csrfTokenForRefreshToken(refreshToken) },
  }, noStoreHeaders());
}

export function readRefreshCredential(req: ApiRequest): {
  refreshToken: string;
  legacyMigration: boolean;
} | null {
  const cookieToken = refreshTokenFromCookie(req);
  if (cookieToken) return { refreshToken: cookieToken, legacyMigration: false };

  if (headerValue(req, LEGACY_MIGRATION_HEADER) !== '1') return null;
  const bodyToken = stringBodyField(req.body, 'refreshToken')?.trim();
  if (!bodyToken || bodyToken.length > 1024) return null;
  return { refreshToken: bodyToken, legacyMigration: true };
}

export function hasValidRefreshCsrf(
  req: ApiRequest,
  credential: { refreshToken: string; legacyMigration: boolean },
): boolean {
  if (credential.legacyMigration) return true;
  const supplied = headerValue(req, CSRF_HEADER)?.trim();
  if (!supplied) return false;
  const expected = csrfTokenForRefreshToken(credential.refreshToken);
  const suppliedBytes = Buffer.from(supplied);
  const expectedBytes = Buffer.from(expected);
  return suppliedBytes.length === expectedBytes.length
    && timingSafeEqual(suppliedBytes, expectedBytes);
}

export function clearAuthSessionHeaders(req: ApiRequest): Record<string, string> {
  return {
    ...noStoreHeaders(),
    'Set-Cookie': serializeRefreshCookie(req, '', 0),
  };
}

export function csrfTokenForRefreshToken(refreshToken: string): string {
  return createHash('sha256')
    .update('simplecrm-csrf-v1\0')
    .update(refreshToken)
    .digest('base64url');
}

function sessionHeaders(req: ApiRequest, refreshToken: string): Record<string, string> {
  return {
    ...noStoreHeaders(),
    'Set-Cookie': serializeRefreshCookie(
      req,
      encodeURIComponent(refreshToken),
      AUTH_REFRESH_COOKIE_MAX_AGE_SECONDS,
    ),
  };
}

function noStoreHeaders(): Record<string, string> {
  return {
    'Cache-Control': 'no-store',
    Pragma: 'no-cache',
  };
}

function serializeRefreshCookie(
  req: ApiRequest,
  encodedValue: string,
  maxAgeSeconds: number,
): string {
  const secure = requestUsesHttps(req);
  return [
    `${AUTH_REFRESH_COOKIE_NAME}=${encodedValue}`,
    `Path=${AUTH_REFRESH_COOKIE_PATH}`,
    'HttpOnly',
    secure ? 'Secure' : null,
    secure ? 'SameSite=None' : 'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
  ].filter(Boolean).join('; ');
}

function refreshTokenFromCookie(req: ApiRequest): string | null {
  const rawCookie = headerValue(req, 'cookie');
  if (!rawCookie) return null;
  const matches: string[] = [];
  for (const part of rawCookie.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 1) continue;
    if (part.slice(0, separator).trim() !== AUTH_REFRESH_COOKIE_NAME) continue;
    try {
      const value = decodeURIComponent(part.slice(separator + 1).trim());
      if (value && value.length <= 1024) matches.push(value);
    } catch {
      return null;
    }
  }
  if (matches.length !== 1) return null;
  return matches[0] ?? null;
}

function requestUsesHttps(req: ApiRequest): boolean {
  const forwardedProto = headerValue(req, 'x-forwarded-proto')
    ?.split(',')[0]
    ?.trim()
    .toLowerCase();
  if (forwardedProto === 'https') return true;
  const origin = headerValue(req, 'origin');
  if (!origin) return false;
  try {
    return new URL(origin).protocol === 'https:';
  } catch {
    return false;
  }
}

function headerValue(req: ApiRequest, name: string): string | undefined {
  const direct = req.headers?.[name];
  if (direct !== undefined) return direct;
  const entry = Object.entries(req.headers ?? {})
    .find(([key]) => key.toLowerCase() === name.toLowerCase());
  return entry?.[1];
}

function stringBodyField(body: unknown, key: string): string | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const value = (body as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : null;
}
