import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';

import { createPinnedFetch, type GuardedFetch } from './pinned-fetch';
import type { JobPayload } from './types';
import type { JobHandlerRegistry } from './worker';

export type WebhookHttpMethod = 'GET' | 'POST';

export type WebhookFirePlan = Readonly<{
  workspaceId: string;
  url: string;
  method: WebhookHttpMethod;
  headers: Readonly<Record<string, string>>;
  body?: string;
  timeoutMs: number;
}>;

export type WebhookDispatchResult = Readonly<{
  status: number;
  bodyPreview?: string;
}>;

export type WebhookDispatchPort = Readonly<{
  dispatch(input: WebhookFirePlan): Promise<WebhookDispatchResult>;
}>;

export type FetchWebhookDispatchOptions = Readonly<{
  allowlist: string | readonly string[];
  fetch?: GuardedFetch;
  lookup?: WebhookLookup;
}>;

export type WebhookJobHandlersOptions = Readonly<{
  dispatcher?: WebhookDispatchPort;
}>;

type WebhookLookup = (hostname: string) => Promise<readonly { address: string }[]>;

const DEFAULT_WEBHOOK_TIMEOUT_MS = 30_000;
const MAX_WEBHOOK_TIMEOUT_MS = 60_000;
const MAX_WEBHOOK_URL_LENGTH = 2048;
const MAX_WEBHOOK_BODY_LENGTH = 128 * 1024;
const MAX_WEBHOOK_HEADER_COUNT = 32;
const MAX_WEBHOOK_HEADER_VALUE_LENGTH = 8 * 1024;

const DISALLOWED_WEBHOOK_HEADERS = new Set([
  'connection',
  'content-length',
  'host',
  'transfer-encoding',
]);

export function createWebhookJobHandlers(options: WebhookJobHandlersOptions): JobHandlerRegistry {
  return {
    'webhook.fire': async (job) => {
      if (!options.dispatcher) {
        throw new Error('webhook dispatch is not configured');
      }
      const plan = buildWebhookFirePlan(job.payload, job.workspaceId);
      await options.dispatcher.dispatch(plan);
    },
  };
}

export function createFetchWebhookDispatchPort(options: FetchWebhookDispatchOptions): WebhookDispatchPort {
  const fetchImpl = options.fetch ?? createPinnedFetch();
  const lookup = options.lookup ?? ((hostname: string) => dnsLookup(hostname, { all: true, verbatim: true }));

  return {
    async dispatch(input) {
      const response = await guardedFetch({
        url: input.url,
        allowlist: options.allowlist,
        lookup,
        fetchImpl,
        init: {
          method: input.method,
          headers: {
            ...(input.body !== undefined ? { 'content-type': 'application/json' } : {}),
            ...input.headers,
          },
          ...(input.body !== undefined ? { body: input.body } : {}),
          timeoutMs: input.timeoutMs,
        },
      });
      const bodyPreview = (await response.text()).slice(0, 1000);
      if (!response.ok) {
        throw new Error(`webhook request failed with status ${response.status}: ${bodyPreview.slice(0, 200)}`);
      }
      return {
        status: response.status,
        ...(bodyPreview ? { bodyPreview } : {}),
      };
    },
  };
}

export async function guardedFetch(args: {
  url: string;
  allowlist: string | readonly string[];
  lookup: WebhookLookup;
  fetchImpl: GuardedFetch;
  init: {
    method: WebhookHttpMethod;
    headers: Record<string, string>;
    body?: string;
    timeoutMs: number;
    /** Optional caller AbortSignal; combined with the per-hop timeout when available. */
    signal?: AbortSignal;
  };
  maxRedirects?: number;
}): Promise<{ ok: boolean; status: number; headers: { get(name: string): string | null }; text(): Promise<string> }> {
  const maxRedirects = args.maxRedirects ?? 3;
  // One shared deadline for the whole redirect chain: each hop gets only the
  // remaining budget, so a slow multi-hop chain can't multiply the timeout by
  // the number of hops. Date.now() is available in the server runtime.
  const deadline = Date.now() + args.init.timeoutMs;
  let currentUrl = args.url;
  // Method/body/headers can change across hops per fetch redirect semantics.
  let method = args.init.method;
  let body = args.init.body;
  let headers: Record<string, string> = { ...args.init.headers };
  for (let hop = 0; ; hop += 1) {
    if (args.init.signal?.aborted) {
      throw new Error('request was aborted');
    }
    const remainingMs = Math.max(0, deadline - Date.now());
    if (remainingMs <= 0) {
      throw new Error('webhook request exceeded its total timeout');
    }
    const addresses = await assertWebhookUrlAllowed(currentUrl, args.allowlist, args.lookup, {
      signal: args.init.signal,
      timeoutMs: remainingMs,
    });
    const hopRemainingMs = Math.max(0, deadline - Date.now());
    if (hopRemainingMs <= 0) {
      throw new Error('webhook request exceeded its total timeout');
    }
    const timeoutSignal =
      typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
        ? AbortSignal.timeout(hopRemainingMs)
        : undefined;
    const signal = combineAbortSignals(args.init.signal, timeoutSignal);
    const response = await args.fetchImpl(currentUrl, {
      method,
      headers,
      ...(body !== undefined ? { body } : {}),
      ...(signal ? { signal } : {}),
      redirect: 'manual',
      pinnedAddresses: addresses,
    });
    if (response.status >= 300 && response.status < 400) {
      if (hop >= maxRedirects) {
        throw new Error(`webhook exceeded ${maxRedirects} redirects`);
      }
      const location = response.headers.get('location');
      if (!location) {
        throw new Error('webhook redirect response is missing a Location header');
      }
      const previousOrigin = new URL(currentUrl).origin;
      const nextUrl = new URL(location, currentUrl);
      currentUrl = nextUrl.toString();
      // On a cross-origin redirect, drop credential headers so an allowlisted
      // endpoint can't bounce the webhook's Authorization/Cookie to a different
      // (also-allowlisted) host (matches fetch's cross-origin credential strip).
      if (nextUrl.origin !== previousOrigin) {
        headers = Object.fromEntries(
          Object.entries(headers).filter(([k]) => {
            const lower = k.toLowerCase();
            return lower !== 'authorization' && lower !== 'cookie' && lower !== 'proxy-authorization';
          }),
        );
      }
      // Match fetch redirect method handling: a 303 (and a POST on 301/302) is
      // replayed as a bodyless GET; 307/308 preserve method + body. Without this
      // the original POST payload would be re-submitted to the redirect target
      // (double-submit, or a 405 on a GET-only landing URL).
      if (
        response.status === 303 ||
        ((response.status === 301 || response.status === 302) && method === 'POST')
      ) {
        method = 'GET';
        body = undefined;
        headers = Object.fromEntries(
          Object.entries(headers).filter(([k]) => {
            const lower = k.toLowerCase();
            return lower !== 'content-type' && lower !== 'content-length';
          }),
        );
      }
      continue; // re-runs assertWebhookUrlAllowed on the new URL → blocks private/off-allowlist hops
    }
    return response;
  }
}

export function buildWebhookFirePlan(payload: JobPayload, jobWorkspaceId: string): WebhookFirePlan {
  const workspaceId = requiredString(payload, 'workspaceId');
  if (workspaceId !== jobWorkspaceId) {
    throw new Error('workspaceId must match the queued job workspace');
  }

  const method = optionalMethod(payload, 'method', 'POST');
  const body = optionalBody(payload, 'body');
  if (method === 'GET' && body !== undefined) {
    throw new Error('body is not allowed for GET webhooks');
  }

  return {
    workspaceId,
    url: requiredUrl(payload, 'url'),
    method,
    headers: optionalHeaders(payload, 'headers'),
    ...(body !== undefined ? { body } : {}),
    timeoutMs: optionalInteger(payload, 'timeoutMs', DEFAULT_WEBHOOK_TIMEOUT_MS, 1000, MAX_WEBHOOK_TIMEOUT_MS),
  };
}

export async function assertWebhookUrlAllowed(
  url: string,
  allowlist: string | readonly string[],
  lookup: WebhookLookup,
  options?: { signal?: AbortSignal; timeoutMs?: number },
): Promise<readonly string[]> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('webhook URL is invalid');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('webhook URL must use http or https');
  }

  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, '');
  if (isBlockedWebhookHostname(hostname) || isPrivateOrReservedWebhookIp(hostname)) {
    throw new Error('webhook URL targets a blocked host');
  }

  const allowed = normalizeWebhookAllowlist(allowlist);
  if (allowed.length === 0) {
    throw new Error('webhook allowlist is empty');
  }
  if (!hostMatchesWebhookAllowlist(hostname, allowed)) {
    throw new Error('webhook URL host is not in the allowlist');
  }

  const records = await runWebhookLookupWithBudget(lookup, hostname, options);
  if (records.length === 0) {
    throw new Error('webhook DNS lookup returned no addresses');
  }
  for (const record of records) {
    if (isPrivateOrReservedWebhookIp(record.address)) {
      throw new Error('webhook DNS lookup resolved to a blocked address');
    }
  }
  return records.map((record) => record.address);
}

async function runWebhookLookupWithBudget(
  lookup: WebhookLookup,
  hostname: string,
  options?: { signal?: AbortSignal; timeoutMs?: number },
): Promise<readonly { address: string }[]> {
  if (options?.signal?.aborted) {
    throw new Error('request was aborted');
  }
  const lookupPromise = lookup(hostname);
  if (options?.timeoutMs === undefined && !options?.signal) {
    return lookupPromise;
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cleanup = () => {
      if (timer !== undefined) clearTimeout(timer);
      options?.signal?.removeEventListener('abort', onAbort);
    };
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn();
    };
    const onAbort = () => {
      finish(() => reject(new Error('request was aborted')));
    };

    if (typeof options?.timeoutMs === 'number') {
      if (options.timeoutMs <= 0) {
        finish(() => reject(new Error('webhook DNS lookup timed out')));
        return;
      }
      timer = setTimeout(() => {
        finish(() => reject(new Error('webhook DNS lookup timed out')));
      }, options.timeoutMs);
    }
    options?.signal?.addEventListener('abort', onAbort, { once: true });
    lookupPromise.then(
      (records) => finish(() => resolve(records)),
      (error) => finish(() => reject(error)),
    );
  });
}

function requiredString(payload: JobPayload, key: string): string {
  const value = payload[key];
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${key} is required`);
  }
  return value.trim();
}

function requiredUrl(payload: JobPayload, key: string): string {
  const value = requiredString(payload, key);
  if (value.length > MAX_WEBHOOK_URL_LENGTH) {
    throw new Error(`${key} must not exceed ${MAX_WEBHOOK_URL_LENGTH} characters`);
  }
  return value;
}

function optionalMethod(payload: JobPayload, key: string, fallback: WebhookHttpMethod): WebhookHttpMethod {
  const value = payload[key];
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'string') throw new Error(`${key} must be GET or POST`);
  const normalized = value.trim().toUpperCase();
  if (normalized === 'GET' || normalized === 'POST') return normalized;
  throw new Error(`${key} must be GET or POST`);
}

function optionalHeaders(payload: JobPayload, key: string): Readonly<Record<string, string>> {
  const value = payload[key];
  if (value === undefined || value === null) return {};
  if (!isPlainRecord(value)) throw new Error(`${key} must be an object`);
  const entries = Object.entries(value);
  if (entries.length > MAX_WEBHOOK_HEADER_COUNT) {
    throw new Error(`${key} must not contain more than ${MAX_WEBHOOK_HEADER_COUNT} headers`);
  }
  const headers: Record<string, string> = {};
  for (const [rawName, rawValue] of entries) {
    const name = rawName.trim();
    const lowerName = name.toLowerCase();
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) || DISALLOWED_WEBHOOK_HEADERS.has(lowerName)) {
      throw new Error(`${key} contains a disallowed header: ${rawName}`);
    }
    if (typeof rawValue !== 'string') {
      throw new Error(`${key}.${rawName} must be a string`);
    }
    if (rawValue.length > MAX_WEBHOOK_HEADER_VALUE_LENGTH) {
      throw new Error(`${key}.${rawName} must not exceed ${MAX_WEBHOOK_HEADER_VALUE_LENGTH} characters`);
    }
    headers[name] = rawValue;
  }
  return headers;
}

function optionalBody(payload: JobPayload, key: string): string | undefined {
  const value = payload[key];
  if (value === undefined || value === null) return undefined;
  const body = typeof value === 'string' ? value : JSON.stringify(value);
  if (body.length > MAX_WEBHOOK_BODY_LENGTH) {
    throw new Error(`${key} must not exceed ${MAX_WEBHOOK_BODY_LENGTH} characters`);
  }
  return body;
}

function optionalInteger(
  payload: JobPayload,
  key: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const value = payload[key];
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${key} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function normalizeWebhookAllowlist(allowlist: string | readonly string[]): string[] {
  const entries: readonly string[] = typeof allowlist === 'string' ? allowlist.split(/[,;\s]+/) : allowlist;
  return entries
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => /^[a-z0-9.-]{4,253}$/.test(entry) && !entry.includes('..'));
}

function hostMatchesWebhookAllowlist(hostname: string, allowlist: readonly string[]): boolean {
  return allowlist.some((entry) => hostname === entry || hostname.endsWith(`.${entry}`));
}

function isBlockedWebhookHostname(hostname: string): boolean {
  if (!hostname) return true;
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) return true;
  if (hostname.endsWith('.local') || hostname.endsWith('.internal')) return true;
  if (hostname === 'metadata' || hostname === 'metadata.google.internal') return true;
  return false;
}

function isPrivateOrReservedWebhookIp(host: string): boolean {
  const value = host.replace(/^\[|\]$/g, '').toLowerCase();
  const kind = isIP(value);
  if (kind === 4) return isPrivateOrReservedIpv4(value);
  if (kind === 6) {
    const groups = expandIpv6(value);
    // isIP() accepted it but we can't read the groups → fail safe (block).
    return groups === null || isPrivateOrReservedIpv6(groups);
  }
  return false;
}

function isPrivateOrReservedIpv4(value: string): boolean {
  const [a, b, c] = value.split('.').map((part) => Number.parseInt(part, 10));
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  // IETF protocol assignments (incl. NAT64 discovery 192.0.0.170/171),
  // documentation (TEST-NET-1/2/3), 6to4 relay anycast, benchmarking
  // 198.18.0.0/15, multicast 224/4 and class E incl. broadcast 240/4.
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true;
  if (a === 192 && b === 88 && c === 99) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a === 198 && b === 51 && c === 100) return true;
  if (a === 203 && b === 0 && c === 113) return true;
  return a >= 224;
}

// Judges the 8 16-bit groups of an IPv6 address. Forms that carry an IPv4
// address the network may translate to (IPv4-mapped, NAT64, 6to4) are judged
// by that embedded IPv4, so e.g. 64:ff9b::a9fe:a9fe cannot reach the metadata
// service through a NAT64 gateway.
function isPrivateOrReservedIpv6(groups: readonly number[]): boolean {
  const [g0, g1, g2, g3, g4, g5, g6, g7] = groups;
  const embeddedIpv4 = (hi: number, lo: number): string => `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
  const zeroUpTo5 = g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0;
  // ::ffff:0:0/96 IPv4-mapped.
  if (zeroUpTo5 && g5 === 0xffff) return isPrivateOrReservedIpv4(embeddedIpv4(g6, g7));
  // 64:ff9b::/96 NAT64 well-known prefix.
  if (g0 === 0x64 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) {
    return isPrivateOrReservedIpv4(embeddedIpv4(g6, g7));
  }
  // Rest of 0000::/8: ::, ::1, IPv4-compatible (::a.b.c.d), local-use NAT64
  // 64:ff9b:1::/48 and other IETF-reserved space.
  if (g0 < 0x100) return true;
  // 100::/64 discard-only.
  if (g0 === 0x100 && g1 === 0 && g2 === 0 && g3 === 0) return true;
  // 2001::/32 Teredo (tunnels to arbitrary IPv4) and 2001:db8::/32 documentation.
  if (g0 === 0x2001 && (g1 === 0 || g1 === 0xdb8)) return true;
  // 2002::/16 6to4 embeds the IPv4 in groups 1-2.
  if (g0 === 0x2002) return isPrivateOrReservedIpv4(embeddedIpv4(g1, g2));
  // fc00::/7 unique-local.
  if ((g0 & 0xfe00) === 0xfc00) return true;
  // fe80::/10 link-local, fec0::/10 site-local, ff00::/8 multicast.
  return g0 >= 0xfe80;
}

function expandIpv6(value: string): number[] | null {
  let text = value.split('%', 1)[0] ?? '';
  const dotted = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(text);
  if (dotted) {
    if (isIP(dotted[1]) !== 4) return null;
    const [a, b, c, d] = dotted[1].split('.').map((part) => Number.parseInt(part, 10));
    text = `${text.slice(0, dotted.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 2 ? missing < 1 : missing !== 0) return null;
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill('0'), ...tail];
  if (groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return null;
  return groups.map((group) => Number.parseInt(group, 16));
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function combineAbortSignals(
  external: AbortSignal | undefined,
  timeout: AbortSignal | undefined,
): AbortSignal | undefined {
  if (!external) return timeout;
  if (!timeout) return external;
  const anyFn = (AbortSignal as typeof AbortSignal & {
    any?: (signals: AbortSignal[]) => AbortSignal;
  }).any;
  if (typeof anyFn === 'function') {
    return anyFn([external, timeout]);
  }
  // Fallback: prefer the external signal (caller timeout) when AbortSignal.any
  // is unavailable; the guarded hop still uses Date.now() deadline checks.
  return external;
}
