import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from 'fastify';
import websocketPlugin from '@fastify/websocket';
import type { LoggerOptions } from 'pino';

import { createServerApi, type ServerApi } from './server-api';
import {
  bearerTokenFromAuthorizationHeader,
  verifyAccessToken,
  type AccessTokenSigner,
} from '../security';
import { checkApiRateLimit } from '../security/api-rate-limit';
import type {
  ApiRequest,
  AuthenticatedPrincipal,
  HttpMethod,
  ServerEvent,
  ServerApiPorts,
} from './types';
import { filterMailEventForPrincipal } from '../mail-access/async-policy-enforcer';

export type FastifyPrincipalResolver = (
  request: FastifyRequest,
) => Promise<AuthenticatedPrincipal | undefined> | AuthenticatedPrincipal | undefined;

export type AccessTokenPrincipalValidator = (input: {
  principal: AuthenticatedPrincipal;
}) => Promise<AuthenticatedPrincipal | null> | AuthenticatedPrincipal | null;

export type BearerTokenPrincipalResolver = (input: {
  token: string;
  request: FastifyRequest;
}) => Promise<AuthenticatedPrincipal | null> | AuthenticatedPrincipal | null;

export type FastifyServerOptions = Readonly<{
  ports: ServerApiPorts;
  logger?: boolean | (LoggerOptions & { stream?: { write(chunk: string): void } });
  resolvePrincipal?: FastifyPrincipalResolver;
  accessTokenSigner?: AccessTokenSigner;
  /** Test/development-only compatibility for unsigned x-simplecrm-* headers. */
  allowHeaderPrincipalFallback?: boolean;
  corsAllowedOrigins?: readonly string[];
  /**
   * Which peers' `X-Forwarded-For` to trust so `request.ip` is the real client
   * instead of the proxy's container IP (without it every user behind the Caddy
   * proxy collapses to one per-IP rate-limit bucket). Passed straight to Fastify.
   *
   * Defaults to `false` (trust nobody) — the safe choice for a directly-exposed
   * API, where trusting any peer's XFF would let a client spoof it to escape the
   * per-IP buckets. The bundled Docker deployment sets `TRUST_PROXY=1` (trust
   * exactly the one Caddy hop) via its env; other values accepted are `true`
   * (trust all hops), a hop count, or a proxy-addr subnet/preset string.
   */
  trustProxy?: boolean | number | string;
}>;

/**
 * Read `request.ip` without letting it throw. With trustProxy enabled it runs
 * proxy-addr over the socket, which can throw on sockets that lack a remote
 * address (e.g. the websocket inject test harness). Fall back to a stable key.
 */
function safeRequestIp(request: FastifyRequest): string {
  try {
    return request.ip || '0.0.0.0';
  } catch {
    return '0.0.0.0';
  }
}

const SUPPORTED_METHODS: readonly HttpMethod[] = ['GET', 'POST', 'PATCH', 'DELETE'];
export const SERVER_EVENT_ACCESS_PROTOCOL_PREFIX = 'simplecrm.access-token.';
const SERVER_JSON_BODY_LIMIT_BYTES = 40 * 1024 * 1024;
const CORS_ALLOWED_METHODS = [...SUPPORTED_METHODS, 'OPTIONS'].join(', ');
const CORS_ALLOWED_HEADERS = [
  'Accept',
  'Authorization',
  'Content-Type',
  'Sec-WebSocket-Protocol',
  'X-CSRF-Token',
  'X-SimpleCRM-Session-Migration',
].join(', ');
const CORS_MAX_AGE_SECONDS = '600';
// Response headers a cross-origin renderer's Fetch may read. `Retry-After` on a
// 429 is non-safelisted, so without exposing it `response.headers.get()` returns
// null cross-origin and the transport's 429 backoff never triggers.
const CORS_EXPOSED_HEADERS = 'Retry-After';

type EventWebSocket = {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  on(event: 'close', listener: () => void): void;
  on(event: 'error', listener: () => void): void;
};

export function createFastifyServer(options: FastifyServerOptions): FastifyInstance {
  const app = Fastify({
    logger: options.logger ?? false,
    bodyLimit: SERVER_JSON_BODY_LIMIT_BYTES,
    trustProxy: options.trustProxy ?? false,
  });
  const api = createServerApi(options.ports);
  const corsAllowedOrigins = new Set(options.corsAllowedOrigins ?? []);
  const resolvePrincipal = options.resolvePrincipal ?? (
    options.accessTokenSigner
      ? createBearerTokenPrincipalResolver(
        options.accessTokenSigner,
        () => undefined,
        options.ports.auth.resolveAccessTokenPrincipal,
        createAutomationApiKeyPrincipalResolver(options.ports),
      )
      : options.allowHeaderPrincipalFallback === true
        ? resolvePrincipalFromHeaders
        : () => undefined
  );
  const handler = createFastifyHandler(api, resolvePrincipal);

  void app.register(websocketPlugin);
  app.addHook('onRequest', (request, reply, done) => {
    if (request.method === 'OPTIONS') {
      done();
      return;
    }
    const path = request.url.split('?')[0] ?? request.url;
    if (path.startsWith('/t/')) {
      done();
      return;
    }
    if (path.startsWith('/api/v1/')) {
      const rate = checkApiRateLimit({
        ip: safeRequestIp(request),
        path,
        method: request.method,
      });
      if (!rate.allowed) {
        // Attach CORS headers BEFORE returning: on a cross-origin server-client
        // install the browser hides a header-less 429 as a CORS failure, so the
        // HTTP transport would never see the 429 / Retry-After and its backoff
        // path would be bypassed exactly when the limiter trips.
        applyCorsHeaders(request, reply, corsAllowedOrigins);
        // Retry-After (whole seconds, min 1) lets the client back off exactly
        // until the window resets instead of guessing.
        const retryAfterSec = Math.max(1, Math.ceil(rate.retryAfterMs / 1000));
        reply.header('Retry-After', String(retryAfterSec));
        reply.code(429).send({
          error: {
            code: 'rate_limited',
            message: 'Zu viele Anfragen',
            details: { limit: rate.limit, bucket: rate.bucket, retryAfterMs: rate.retryAfterMs },
          },
        });
        return;
      }
    }
    if (!applyCorsHeaders(request, reply, corsAllowedOrigins)) {
      reply.code(403).send({
        error: {
          code: 'cors_origin_not_allowed',
          message: 'Origin nicht erlaubt',
        },
      });
      return;
    }
    done();
  });
  app.after(() => {
    app.get('/api/v1/events', { websocket: true }, (socket, request) => {
      void handleEventSocket(options.ports, resolvePrincipal, socket, request).catch((error) => {
        request.log.error(error);
        socket.close(1011, 'event stream error');
      });
    });
  });

  app.route({
    method: [...SUPPORTED_METHODS],
    url: '/*',
    handler,
  });
  app.options('/*', (request, reply) => {
    if (!applyCorsHeaders(request, reply, corsAllowedOrigins)) {
      reply.code(403).send({
        error: {
          code: 'cors_origin_not_allowed',
          message: 'Origin nicht erlaubt',
        },
      });
      return;
    }
    reply.code(204).send();
  });

  return app;
}

function applyCorsHeaders(
  request: FastifyRequest,
  reply: FastifyReply,
  allowedOrigins: ReadonlySet<string>,
): boolean {
  const rawOrigin = singleHeader(request.headers.origin);
  if (!rawOrigin) return true;
  const origin = normalizeCorsOrigin(rawOrigin);
  if (!origin) return false;
  if (!allowedOrigins.has(origin)) return false;
  reply.header('Vary', 'Origin');
  reply.header('Access-Control-Allow-Origin', origin);
  reply.header('Access-Control-Allow-Credentials', 'true');
  reply.header('Access-Control-Allow-Methods', CORS_ALLOWED_METHODS);
  reply.header('Access-Control-Allow-Headers', CORS_ALLOWED_HEADERS);
  reply.header('Access-Control-Expose-Headers', CORS_EXPOSED_HEADERS);
  reply.header('Access-Control-Max-Age', CORS_MAX_AGE_SECONDS);
  return true;
}

function normalizeCorsOrigin(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (trimmed === 'null') return 'null';
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.origin;
  } catch {
    return null;
  }
}

async function handleEventSocket(
  ports: ServerApiPorts,
  resolvePrincipal: FastifyPrincipalResolver,
  socket: EventWebSocket,
  request: FastifyRequest,
): Promise<void> {
  const principal = await resolvePrincipal(request);
  if (!principal) {
    socket.close(1008, 'unauthorized');
    return;
  }
  if (!ports.events?.subscribe) {
    socket.close(1011, 'events unavailable');
    return;
  }

  const afterSequence = parseReplayCursor(request.url);
  if (afterSequence === null) {
    socket.close(1008, 'invalid event replay cursor');
    return;
  }
  if (afterSequence !== undefined && !ports.events.replay) {
    socket.close(1011, 'event replay unavailable');
    return;
  }

  const deliveredSequences = new Set<number>();
  let closed = false;
  let replaying = true;
  let liveQueue: ServerEvent[] = [];
  let liveChain = Promise.resolve();
  const context = {
    principal,
    ports: {
      mailAccess: ports.mailAccess,
      mailResourceLookup: ports.mailResourceLookup,
    },
  };
  const enqueueLive = (event: ServerEvent) => {
    if (event.workspaceId !== principal.workspaceId) return;
    if (replaying) {
      liveQueue.push(event);
      return;
    }
    liveChain = liveChain
      .then(async () => sendFilteredEvent(socket, event, deliveredSequences, context, () => closed))
      .catch(() => {
        if (!closed) socket.close(1011, 'event stream error');
      });
  };
  const subscription = ports.events.subscribe(enqueueLive);
  const cleanup = () => {
    closed = true;
    liveQueue = [];
    subscription.unsubscribe();
  };
  socket.on('close', cleanup);
  socket.on('error', cleanup);
  if (afterSequence !== undefined) {
    await waitForWebSocketClient();
    const replayEvents = await ports.events.replay?.({
      workspaceId: principal.workspaceId,
      afterSequence,
    }) ?? [];
    for (const event of replayEvents) {
      await sendFilteredEvent(socket, event, deliveredSequences, context, () => closed);
    }
  }
  replaying = false;
  const queued = liveQueue;
  liveQueue = [];
  for (const event of queued) enqueueLive(event);
}

async function sendFilteredEvent(
  socket: EventWebSocket,
  event: ServerEvent,
  deliveredSequences: Set<number>,
  context: Parameters<typeof filterMailEventForPrincipal>[1],
  isClosed: () => boolean,
): Promise<void> {
  if (isClosed() || wasDelivered(deliveredSequences, event)) return;
  const filtered = await filterMailEventForPrincipal(event, context);
  if (!filtered || isClosed() || wasDelivered(deliveredSequences, filtered)) return;
  markDelivered(deliveredSequences, filtered);
  sendWebSocketJson(socket, filtered);
}

function sendWebSocketJson(socket: EventWebSocket, event: ServerEvent): void {
  if (socket.readyState !== 1) return;
  socket.send(JSON.stringify(event));
}

function markDelivered(deliveredSequences: Set<number>, event: ServerEvent): void {
  if (typeof event.sequence === 'number') {
    deliveredSequences.add(event.sequence);
  }
}

function wasDelivered(deliveredSequences: Set<number>, event: ServerEvent): boolean {
  return typeof event.sequence === 'number' && deliveredSequences.has(event.sequence);
}

function waitForWebSocketClient(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

function createFastifyHandler(
  api: ServerApi,
  resolvePrincipal: FastifyPrincipalResolver,
): (request: FastifyRequest, reply: FastifyReply) => void {
  return (request, reply) => {
    void dispatchFastifyRequest(api, resolvePrincipal, request, reply).catch((error) => {
      // Log the real error server-side, but never echo it to the client:
      // Fastify's default handler would serialize err.message into the 500 body,
      // leaking Postgres constraint/column text, secret-decryption detail, etc.
      // (CWE-209). Return a generic, structured error instead.
      console.error(
        'unhandled API error:',
        error instanceof Error ? (error.stack ?? error.message) : String(error),
      );
      if (!reply.sent) {
        reply.code(500).send({ error: { code: 'internal_error', message: 'Interner Serverfehler' } });
      }
    });
  };
}

async function dispatchFastifyRequest(
  api: ServerApi,
  resolvePrincipal: FastifyPrincipalResolver,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const method = toHttpMethod(request.method);
  if (!method) {
    reply.code(405).send({
      error: {
        code: 'method_not_allowed',
        message: 'Methode nicht erlaubt',
      },
    });
    return;
  }

  const apiResponse = await api.handle({
    method,
    path: extractPath(request.url),
    query: extractQuery(request.url),
    body: request.body,
    headers: normalizeHeaders(request.headers),
    ip: safeRequestIp(request),
    principal: await resolvePrincipal(request),
  } satisfies ApiRequest);

  reply.code(apiResponse.status);
  for (const [key, value] of Object.entries(apiResponse.headers ?? {})) {
    reply.header(key, value);
  }
  reply.send(apiResponse.body);
}

function extractPath(url: string): string {
  return url.split('?')[0] || '/';
}

function extractQuery(url: string): Record<string, string | undefined> {
  const rawQuery = url.split('?')[1];
  if (!rawQuery) return {};
  const params = new URLSearchParams(rawQuery);
  return Object.fromEntries([...params.entries()]);
}

function parseReplayCursor(url: string): number | undefined | null {
  const rawQuery = url.split('?')[1];
  if (!rawQuery) return undefined;
  const value = new URLSearchParams(rawQuery).get('since');
  if (value === null || value === '') return undefined;
  if (!/^\d+$/.test(value)) return null;
  const sequence = Number(value);
  return Number.isSafeInteger(sequence) ? sequence : null;
}

function normalizeHeaders(headers: FastifyRequest['headers']): Record<string, string | undefined> {
  return Object.fromEntries(Object.entries(headers).map(([key, value]) => {
    if (Array.isArray(value)) return [key, value.join(',')];
    return [key, value === undefined ? undefined : String(value)];
  }));
}

function toHttpMethod(method: string): HttpMethod | null {
  return SUPPORTED_METHODS.includes(method as HttpMethod) ? method as HttpMethod : null;
}

function resolvePrincipalFromHeaders(request: FastifyRequest): AuthenticatedPrincipal | undefined {
  const userId = singleHeader(request.headers['x-simplecrm-user-id']);
  const workspaceId = singleHeader(request.headers['x-simplecrm-workspace-id']);
  const role = singleHeader(request.headers['x-simplecrm-role']);
  if (!userId || !workspaceId || !isPrincipalRole(role)) return undefined;
  return { userId, workspaceId, role };
}

export function createBearerTokenPrincipalResolver(
  signer: AccessTokenSigner,
  fallback: FastifyPrincipalResolver = resolvePrincipalFromHeaders,
  validatePrincipal?: AccessTokenPrincipalValidator,
  resolveBearerTokenPrincipal?: BearerTokenPrincipalResolver,
): FastifyPrincipalResolver {
  return async (request) => {
    const authorization = singleHeader(request.headers.authorization);
    const bearerToken = bearerTokenFromAuthorizationHeader(authorization);
    const protocolToken = accessTokenFromWebSocketProtocol(singleHeader(request.headers['sec-websocket-protocol']));
    const token = bearerToken ?? protocolToken;
    if (authorization || protocolToken) {
      const principal = token ? verifyAccessToken({ token, signer }) : null;
      if (!principal) {
        if (!bearerToken || !resolveBearerTokenPrincipal) return undefined;
        return await resolveBearerTokenPrincipal({ token: bearerToken, request }) ?? undefined;
      }
      if (!validatePrincipal) return principal;
      return await validatePrincipal({ principal }) ?? undefined;
    }
    return fallback(request);
  };
}

function createAutomationApiKeyPrincipalResolver(
  ports: ServerApiPorts,
): BearerTokenPrincipalResolver | undefined {
  const verify = ports.automationApiKeys?.verify;
  if (!verify) return undefined;
  return async ({ token, request }) => {
    if (!isAutomationWebhookPath(requestPathname(request))) return null;
    return await verify({ key: token, requiredScope: 'workflows' });
  };
}

function requestPathname(request: FastifyRequest): string {
  return request.url.split('?')[0] ?? request.url;
}

function isAutomationWebhookPath(pathname: string): boolean {
  return pathname === '/api/v1/workflows/webhook/incoming' || pathname === '/api/v1/webhooks/incoming';
}

function singleHeader(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

export function accessTokenFromWebSocketProtocol(value: string | undefined): string | null {
  if (!value) return null;
  for (const protocol of value.split(',')) {
    const trimmed = protocol.trim();
    if (trimmed.startsWith(SERVER_EVENT_ACCESS_PROTOCOL_PREFIX)) {
      const token = trimmed.slice(SERVER_EVENT_ACCESS_PROTOCOL_PREFIX.length).trim();
      return token || null;
    }
  }
  return null;
}

function isPrincipalRole(value: string | undefined): value is AuthenticatedPrincipal['role'] {
  return value === 'owner' || value === 'admin' || value === 'user';
}
