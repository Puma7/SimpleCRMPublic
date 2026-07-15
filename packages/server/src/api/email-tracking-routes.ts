import type {
  ApiErrorBody,
  ApiRequest,
  ApiResponse,
  EmailTrackingPolicyMutationInput,
  ServerApiPorts,
} from './types';
import {
  EmailTrackingIpInsightForbiddenError,
  EmailTrackingIpInsightNotFoundError,
  EmailTrackingIpInsightRawDataUnavailableError,
  EmailTrackingIpInsightUnavailableError,
  EmailTrackingMessageNotFoundError,
  EmailTrackingPolicyValidationError,
} from '../email-tracking';
import { data, error, positiveIntFromPath, requireAdmin, requirePrincipal } from './http';

const PUBLIC_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const PUBLIC_OPERATION_TIMEOUT_MS = 1_500;
const MAX_REDIRECT_URL_LENGTH = 8_192;
const PIXEL_BYTES = Uint8Array.from([
  71, 73, 70, 56, 57, 97, 1, 0, 1, 0, 128, 0, 0, 0, 0, 0,
  255, 255, 255, 33, 249, 4, 1, 0, 0, 0, 0, 44, 0, 0, 0, 0, 1, 0,
  1, 0, 0, 2, 2, 68, 1, 0, 59,
]);
const PIXEL_HEADERS = {
  'Content-Type': 'image/gif',
  'Content-Length': String(PIXEL_BYTES.byteLength),
  'Cache-Control': 'no-store, no-cache, must-revalidate, private',
  Pragma: 'no-cache',
  Expires: '0',
  'Content-Security-Policy': "default-src 'none'",
  'Cross-Origin-Resource-Policy': 'cross-origin',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
} as const;

type RateEntry = { startedAt: number; count: number };

export function createEmailTrackingRateLimiter(options: {
  limit: number;
  windowMs: number;
  maxKeys?: number;
}) {
  const entries = new Map<string, RateEntry>();
  const maxKeys = options.maxKeys ?? 10_000;
  return {
    check(key: string, now = Date.now()): boolean {
      const current = entries.get(key);
      if (!current || now - current.startedAt >= options.windowMs) {
        if (!current && entries.size >= maxKeys) {
          const oldest = entries.keys().next().value as string | undefined;
          if (oldest) entries.delete(oldest);
        }
        entries.set(key, { startedAt: now, count: 1 });
        return true;
      }
      if (current.count >= options.limit) return false;
      current.count += 1;
      entries.delete(key);
      entries.set(key, current);
      return true;
    },
    reset(): void {
      entries.clear();
    },
  };
}

const openIpRateLimiter = createEmailTrackingRateLimiter({ limit: 1_200, windowMs: 60_000 });
const openTokenRateLimiter = createEmailTrackingRateLimiter({ limit: 120, windowMs: 60_000 });
const clickIpRateLimiter = createEmailTrackingRateLimiter({ limit: 600, windowMs: 60_000 });
const clickTokenRateLimiter = createEmailTrackingRateLimiter({ limit: 60, windowMs: 60_000 });

export function resetEmailTrackingRateLimitersForTests(): void {
  openIpRateLimiter.reset();
  openTokenRateLimiter.reset();
  clickIpRateLimiter.reset();
  clickTokenRateLimiter.reset();
}

export async function handlePublicEmailTrackingRoute(
  req: ApiRequest,
  ports: ServerApiPorts,
): Promise<ApiResponse | null> {
  const openMatch = /^\/t\/o\/([^/]+)\.gif$/.exec(req.path);
  if (openMatch) {
    if (req.method !== 'GET') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
    const token = openMatch[1] ?? '';
    const rateKey = `open:${req.ip ?? 'unknown'}`;
    if (
      ports.emailTracking
      && PUBLIC_TOKEN_PATTERN.test(token)
      && openTokenRateLimiter.check(`open-token:${token}`)
      && openIpRateLimiter.check(rateKey)
    ) {
      await withPublicTimeout(ports.emailTracking.recordPublicOpen({
        token,
        ip: req.ip ?? null,
        userAgent: header(req, 'user-agent'),
        headers: req.headers ?? {},
      })).catch(() => undefined);
    }
    return { status: 200, body: Uint8Array.from(PIXEL_BYTES), headers: { ...PIXEL_HEADERS } };
  }

  const clickMatch = /^\/t\/c\/([^/]+)$/.exec(req.path);
  if (!clickMatch) return null;
  if (req.method !== 'GET') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
  const token = clickMatch[1] ?? '';
  if (!ports.emailTracking || !PUBLIC_TOKEN_PATTERN.test(token)) return trackingNotFound();
  if (
    !clickTokenRateLimiter.check(`click-token:${token}`)
    || !clickIpRateLimiter.check(`click:${req.ip ?? 'unknown'}`)
  ) {
    return error(429, 'rate_limited', 'Zu viele Anfragen');
  }

  const result = await withPublicTimeout(ports.emailTracking.resolvePublicClick({
    token,
    ip: req.ip ?? null,
    userAgent: header(req, 'user-agent'),
    headers: req.headers ?? {},
  })).catch(() => null);
  const targetUrl = safeRedirectUrl(result?.targetUrl ?? null);
  if (!targetUrl) return trackingNotFound();
  return {
    status: 302,
    body: undefined,
    headers: {
      Location: targetUrl,
      'Cache-Control': 'no-store, private',
      'Content-Security-Policy': "default-src 'none'",
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    },
  };
}

export async function handleEmailTrackingRoute(
  req: ApiRequest,
  ports: ServerApiPorts,
): Promise<ApiResponse | null> {
  const isSettings = req.path === '/api/v1/email/tracking/settings';
  const timelineMatch = /^\/api\/v1\/email\/messages\/([^/]+)\/tracking$/.exec(req.path);
  const revokeMatch = /^\/api\/v1\/email\/messages\/([^/]+)\/tracking\/revoke$/.exec(req.path);
  const reclassifyMatch = /^\/api\/v1\/email\/messages\/([^/]+)\/tracking\/reclassify$/.exec(req.path);
  const ipInsightMatch = /^\/api\/v1\/email\/messages\/([^/]+)\/tracking\/events\/([^/]+)\/ip-insight$/.exec(req.path);
  if (!isSettings && !timelineMatch && !revokeMatch && !reclassifyMatch && !ipInsightMatch) return null;

  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  if (!ports.emailTracking) {
    if (!ipInsightMatch) {
      return error(503, 'email_tracking_unavailable', 'E-Mail-Nachverfolgung ist nicht konfiguriert');
    }
    if (req.method !== 'GET') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
    const unavailableMessageId = positiveIntFromPath(ipInsightMatch[1]);
    if (unavailableMessageId === null) {
      return error(400, 'invalid_message_id', 'messageId muss eine positive Ganzzahl sein');
    }
    const unavailableEventId = canonicalPositiveDecimalEventId(ipInsightMatch[2]);
    if (!unavailableEventId) {
      await auditIpInsightRouteDenial(ports, principal, 'invalid_event_id');
      return error(400, 'invalid_event_id', 'eventId muss eine positive dezimale Ganzzahl sein');
    }
    if (!requireAdmin(principal)) {
      await auditIpInsightRouteDenial(ports, principal, 'forbidden', unavailableEventId);
      return error(403, 'forbidden', 'Adminrechte erforderlich');
    }
    await auditIpInsightRouteDenial(ports, principal, 'unavailable', unavailableEventId);
    return error(503, 'email_tracking_unavailable', 'E-Mail-Nachverfolgung ist nicht konfiguriert');
  }

  if (isSettings) {
    if (req.method === 'GET') {
      return data(200, await ports.emailTracking.getPolicy({ workspaceId: principal.workspaceId }));
    }
    if (req.method !== 'PATCH') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
    if (!requireAdmin(principal)) return error(403, 'forbidden', 'Adminrechte erforderlich');
    const parsed = parsePolicyMutation(req.body);
    if (!parsed.ok) return parsed.response;
    try {
      return data(200, await ports.emailTracking.setPolicy({
        workspaceId: principal.workspaceId,
        actorUserId: principal.userId,
        values: parsed.values,
      }));
    } catch (caught) {
      if (caught instanceof EmailTrackingPolicyValidationError) {
        return error(400, 'invalid_tracking_policy', caught.message);
      }
      throw caught;
    }
  }

  const rawMessageId = timelineMatch?.[1] ?? revokeMatch?.[1] ?? reclassifyMatch?.[1] ?? ipInsightMatch?.[1];
  const messageId = positiveIntFromPath(rawMessageId);
  if (messageId === null) return error(400, 'invalid_message_id', 'messageId muss eine positive Ganzzahl sein');

  if (ipInsightMatch) {
    if (req.method !== 'GET') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
    const eventId = canonicalPositiveDecimalEventId(ipInsightMatch[2]);
    if (!eventId) {
      await auditIpInsightRouteDenial(ports, principal, 'invalid_event_id');
      return error(400, 'invalid_event_id', 'eventId muss eine positive dezimale Ganzzahl sein');
    }
    if (!requireAdmin(principal)) {
      await auditIpInsightRouteDenial(ports, principal, 'forbidden', eventId);
      return error(403, 'forbidden', 'Adminrechte erforderlich');
    }
    if (!ports.emailTracking.getIpInsight) {
      await auditIpInsightRouteDenial(ports, principal, 'unavailable', eventId);
      return error(503, 'email_tracking_unavailable', 'E-Mail-Nachverfolgung ist nicht konfiguriert');
    }
    try {
      return data(200, await ports.emailTracking.getIpInsight({
        workspaceId: principal.workspaceId,
        actorUserId: principal.userId,
        messageId,
        eventId,
      }));
    } catch (caught) {
      if (caught instanceof EmailTrackingIpInsightNotFoundError) return trackingNotFound();
      if (caught instanceof EmailTrackingIpInsightForbiddenError) {
        return error(403, 'ip_insights_forbidden', 'IP-Insights sind nicht aktiviert');
      }
      if (caught instanceof EmailTrackingIpInsightRawDataUnavailableError) {
        return error(410, 'ip_insight_raw_data_unavailable', 'Rohdaten fuer den IP-Insight sind nicht mehr verfuegbar');
      }
      if (caught instanceof EmailTrackingIpInsightUnavailableError) {
        return error(503, 'ip_insights_unavailable', 'Lokale IP-Insight-Datenbank ist nicht verfuegbar');
      }
      throw caught;
    }
  }

  if (reclassifyMatch) {
    if (req.method !== 'POST') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
    if (!requireAdmin(principal)) return error(403, 'forbidden', 'Adminrechte erforderlich');
    if (!ports.emailTracking.reclassifyMessage) {
      return error(503, 'email_tracking_unavailable', 'E-Mail-Nachverfolgung ist nicht konfiguriert');
    }
    try {
      return data(200, await ports.emailTracking.reclassifyMessage({
        workspaceId: principal.workspaceId,
        actorUserId: principal.userId,
        messageId,
      }));
    } catch (caught) {
      if (caught instanceof EmailTrackingMessageNotFoundError) return trackingNotFound();
      throw caught;
    }
  }

  if (revokeMatch) {
    if (req.method !== 'POST') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
    if (!requireAdmin(principal)) return error(403, 'forbidden', 'Adminrechte erforderlich');
    const revoked = await ports.emailTracking.revokeMessage({
      workspaceId: principal.workspaceId,
      actorUserId: principal.userId,
      messageId,
    });
    return revoked ? data(200, { revoked: true }) : trackingNotFound();
  }

  if (req.method === 'GET') {
    const includeSensitive = req.query?.includeSensitive === 'true';
    if (includeSensitive && !requireAdmin(principal)) {
      return error(403, 'forbidden', 'Adminrechte fuer sensible Metadaten erforderlich');
    }
    const timeline = await ports.emailTracking.getTimeline({
      workspaceId: principal.workspaceId,
      messageId,
      ...(includeSensitive ? { includeSensitive: true } : {}),
    });
    return timeline ? data(200, timeline) : trackingNotFound();
  }
  if (req.method === 'DELETE') {
    if (!requireAdmin(principal)) return error(403, 'forbidden', 'Adminrechte erforderlich');
    const erased = await ports.emailTracking.eraseMessage({
      workspaceId: principal.workspaceId,
      actorUserId: principal.userId,
      messageId,
    });
    return erased ? { status: 204, body: undefined } : trackingNotFound();
  }
  return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
}

function parsePolicyMutation(body: unknown):
  | { ok: true; values: EmailTrackingPolicyMutationInput }
  | { ok: false; response: ApiResponse<ApiErrorBody> } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, response: error(400, 'invalid_tracking_policy', 'Tracking-Einstellungen muessen ein JSON-Objekt sein') };
  }
  const source = body as Record<string, unknown>;
  const allowed = new Set([
    'enabled', 'trackOpens', 'trackLinks', 'collectDerivedMetadata', 'collectRawMetadata', 'ipInsightsEnabled',
    'rawMetadataRetentionDays', 'eventRetentionDays', 'tokenTtlDays', 'legalBasis',
    'privacyNoticeUrl', 'complianceAcknowledged',
  ]);
  const unknown = Object.keys(source).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    return { ok: false, response: error(400, 'invalid_tracking_policy', 'Unbekannte Tracking-Einstellung', { fields: unknown }) };
  }
  const values: EmailTrackingPolicyMutationInput = {};
  for (const key of ['enabled', 'trackOpens', 'trackLinks', 'collectDerivedMetadata', 'collectRawMetadata', 'ipInsightsEnabled', 'complianceAcknowledged'] as const) {
    if (source[key] === undefined) continue;
    if (typeof source[key] !== 'boolean') {
      return { ok: false, response: error(400, 'invalid_tracking_policy', `${key} muss boolesch sein`) };
    }
    values[key] = source[key];
  }
  for (const key of ['rawMetadataRetentionDays', 'eventRetentionDays', 'tokenTtlDays'] as const) {
    if (source[key] === undefined) continue;
    if (!Number.isSafeInteger(source[key])) {
      return { ok: false, response: error(400, 'invalid_tracking_policy', `${key} muss eine Ganzzahl sein`) };
    }
    values[key] = source[key] as number;
  }
  if (source.legalBasis !== undefined) {
    if (source.legalBasis !== null && !['consent', 'legitimate_interest', 'contract', 'other'].includes(String(source.legalBasis))) {
      return { ok: false, response: error(400, 'invalid_tracking_policy', 'legalBasis ist ungueltig') };
    }
    values.legalBasis = source.legalBasis as EmailTrackingPolicyMutationInput['legalBasis'];
  }
  if (source.privacyNoticeUrl !== undefined) {
    if (source.privacyNoticeUrl !== null && typeof source.privacyNoticeUrl !== 'string') {
      return { ok: false, response: error(400, 'invalid_tracking_policy', 'privacyNoticeUrl muss Text oder null sein') };
    }
    values.privacyNoticeUrl = source.privacyNoticeUrl as string | null;
  }
  return { ok: true, values };
}

function header(req: ApiRequest, name: string): string | null {
  const entry = Object.entries(req.headers ?? {}).find(([key]) => key.toLowerCase() === name);
  return entry?.[1]?.trim() || null;
}

function safeRedirectUrl(value: string | null): string | null {
  if (!value || value.length > MAX_REDIRECT_URL_LENGTH || /[\r\n]/.test(value)) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function trackingNotFound(): ApiResponse<ApiErrorBody> {
  return error(404, 'tracking_not_found', 'Tracking-Link nicht gefunden oder abgelaufen');
}

function canonicalPositiveDecimalEventId(value: string | undefined): string | null {
  return value && /^[1-9]\d*$/.test(value) ? value : null;
}

async function auditIpInsightRouteDenial(
  ports: ServerApiPorts,
  principal: { workspaceId: string; userId: string },
  outcome: 'invalid_event_id' | 'forbidden' | 'unavailable',
  eventId: string | null = null,
): Promise<void> {
  await ports.audit?.record({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    action: 'email_tracking.ip_insight_denied',
    entityType: 'email_tracking_event',
    entityId: eventId,
    metadata: { outcome },
  });
}

async function withPublicTimeout<T>(promise: Promise<T>): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error('tracking_timeout')), PUBLIC_OPERATION_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
