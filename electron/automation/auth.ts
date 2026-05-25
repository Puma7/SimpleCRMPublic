import { timingSafeEqual } from 'crypto';
import type { AutomationScope } from '../../shared/automation-api';
import { loadApiCredentials, type StoredApiCredentials } from './automation-keytar';
import { checkRateLimit } from './rate-limit';

export type AuthResult =
  | { ok: true; credentials: StoredApiCredentials }
  | { ok: false; status: number; code: string; message: string };

function extractToken(authHeader: string | undefined, apiKeyHeader: string | undefined): string | null {
  if (apiKeyHeader?.trim()) return apiKeyHeader.trim();
  if (!authHeader) return null;
  const m = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
  return m?.[1]?.trim() ?? null;
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
  } catch {
    return false;
  }
}

export async function authenticateRequest(headers: {
  authorization?: string;
  'x-api-key'?: string;
}): Promise<AuthResult> {
  const token = extractToken(headers.authorization, headers['x-api-key']);
  if (!token) {
    return { ok: false, status: 401, code: 'unauthorized', message: 'API-Key fehlt (Authorization: Bearer oder X-API-Key)' };
  }
  const creds = await loadApiCredentials();
  if (!creds?.key) {
    return { ok: false, status: 401, code: 'unauthorized', message: 'Kein API-Key konfiguriert' };
  }
  if (!safeEqual(token, creds.key)) {
    return { ok: false, status: 401, code: 'unauthorized', message: 'Ungültiger API-Key' };
  }
  const rl = checkRateLimit(token);
  if (!rl.allowed) {
    return {
      ok: false,
      status: 429,
      code: 'rate_limited',
      message: `Rate-Limit überschritten (max. ${rl.limit}/Minute)`,
    };
  }
  return { ok: true, credentials: creds };
}

export function requireScopes(creds: StoredApiCredentials, needed: AutomationScope[]): boolean {
  return hasScopes(creds.scopes, needed);
}

export function hasScopes(have: AutomationScope[], needed: AutomationScope[]): boolean {
  const set = new Set(have);
  return needed.every((s) => set.has(s));
}
