import type { IncomingMessage, ServerResponse } from 'node:http';

import type { ServerApi } from './server-api';
import type { ApiErrorBody, ApiRequest } from './types';

const MAX_JSON_BODY_BYTES = 1024 * 1024;

export function createNodeHttpHandler(api: ServerApi) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    try {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      const method = req.method ?? 'GET';
      if (!isApiMethod(method)) {
        send(res, 405, { error: { code: 'method_not_allowed', message: 'Methode nicht erlaubt' } });
        return;
      }

      const body = method === 'POST' || method === 'PATCH' || method === 'DELETE'
        ? await readJsonBody(req)
        : undefined;
      const response = await api.handle({
        method,
        path: url.pathname,
        query: Object.fromEntries(url.searchParams.entries()),
        headers: normalizeHeaders(req.headers),
        ip: socketIp(req),
        body,
      });
      send(res, response.status, response.body, response.headers);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Interner Fehler';
      const status = message === 'payload_too_large' ? 413 : message === 'invalid_json' ? 400 : 500;
      const code = message === 'payload_too_large'
        ? 'payload_too_large'
        : message === 'invalid_json'
          ? 'invalid_json'
          : 'internal_error';
      send(res, status, { error: { code, message } });
    }
  };
}

function isApiMethod(method: string): method is ApiRequest['method'] {
  return method === 'GET' || method === 'POST' || method === 'PATCH' || method === 'DELETE';
}

function normalizeHeaders(headers: IncomingMessage['headers']): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(headers)) {
    out[key.toLowerCase()] = Array.isArray(value) ? value.join(',') : value;
  }
  return out;
}

function socketIp(req: IncomingMessage): string | undefined {
  return req.socket.remoteAddress ?? undefined;
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buf.length;
    if (size > MAX_JSON_BODY_BYTES) {
      throw new Error('payload_too_large');
    }
    chunks.push(buf);
  }
  if (chunks.length === 0) return {};
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error('invalid_json');
  }
}

function send(
  res: ServerResponse,
  status: number,
  body: unknown | ApiErrorBody,
  headers: Record<string, string> = {},
): void {
  if (body instanceof Uint8Array) {
    res.writeHead(status, {
      'Content-Type': 'application/octet-stream',
      ...headers,
    });
    res.end(body);
    return;
  }
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    ...headers,
  });
  res.end(JSON.stringify(body));
}
