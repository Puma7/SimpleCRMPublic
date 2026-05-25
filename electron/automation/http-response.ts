import type { ServerResponse } from 'http';
import type { ApiErrorBody } from '../../shared/automation-api';

export function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  extraHeaders?: Record<string, string>,
): void {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...extraHeaders,
  });
  res.end(json);
}

export function sendError(
  res: ServerResponse,
  status: number,
  code: string,
  message: string,
  details?: unknown,
): void {
  const body: ApiErrorBody = { error: { code, message, ...(details !== undefined ? { details } : {}) } };
  sendJson(res, status, body);
}

export function parsePositiveInt(raw: string | undefined): number | null {
  if (!raw) return null;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return null;
  return n;
}

/** Coerce JSON/query values to a positive integer ID. */
export function coercePositiveInt(raw: unknown): number | null {
  if (raw == null) return null;
  if (typeof raw === 'number') {
    return Number.isInteger(raw) && raw >= 1 ? raw : null;
  }
  if (typeof raw === 'string' && raw.trim()) {
    return parsePositiveInt(raw.trim());
  }
  return null;
}

/** When query param is present but not a valid positive int, return null and caller should 400. */
export function parseQueryPositiveInt(
  query: URLSearchParams,
  key: string,
): { value?: number; invalid: boolean } {
  const raw = query.get(key);
  if (raw == null || raw === '') return { invalid: false };
  const value = parsePositiveInt(raw);
  if (value == null) return { invalid: true };
  return { value, invalid: false };
}

export function clampLimit(raw: string | null, max = 500, fallback = 100): number {
  const n = raw ? parseInt(raw, 10) : fallback;
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(n, max);
}

export function clampOffset(raw: string | null): number {
  const n = raw ? parseInt(raw, 10) : 0;
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}
