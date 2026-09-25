import { lookup as dnsLookup } from 'node:dns/promises';

import { fetchWithGuardedRedirects, isPrivateOrReservedIp, type GuardedRedirectMessages } from '@simplecrm/core';

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

const WEBHOOK_REDIRECT_MESSAGES: GuardedRedirectMessages = {
  aborted: 'request was aborted',
  timeout: 'webhook request exceeded its total timeout',
  tooManyRedirects: (maxRedirects) => `webhook exceeded ${maxRedirects} redirects`,
  missingLocation: 'webhook redirect response is missing a Location header',
};

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
  // The redirect loop is shared with the desktop workflow HTTP node; every hop
  // re-runs assertWebhookUrlAllowed → blocks private/off-allowlist hops.
  return fetchWithGuardedRedirects({
    url: args.url,
    resolveHop: (url, budget) => assertWebhookUrlAllowed(url, args.allowlist, args.lookup, budget),
    fetchImpl: args.fetchImpl,
    init: args.init,
    maxRedirects: args.maxRedirects ?? 3,
    messages: WEBHOOK_REDIRECT_MESSAGES,
  });
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
  if (isBlockedWebhookHostname(hostname) || isPrivateOrReservedIp(hostname)) {
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
    if (isPrivateOrReservedIp(record.address)) {
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
    .map(webhookAllowlistEntryHost)
    .filter((entry) => /^[a-z0-9.-]{4,253}$/.test(entry) && !entry.includes('..'));
}

// The allowlist is host-based, but admins paste URLs ("https://hooks.zapier.com/…")
// or host:port. Reduce such entries to their host instead of dropping them silently.
function webhookAllowlistEntryHost(entry: string): string {
  const value = entry.trim().toLowerCase();
  if (!value.includes('/') && !value.includes(':')) return value.replace(/\.$/, '');
  try {
    return new URL(value.includes('://') ? value : `http://${value}`).hostname.replace(/\.$/, '');
  } catch {
    return value;
  }
}

function hostMatchesWebhookAllowlist(hostname: string, allowlist: readonly string[]): boolean {
  // A bare label ("info", "shop") matches only that exact host; as a suffix it
  // would open a whole TLD. Same rule as the desktop allowlist.
  return allowlist.some((entry) => hostname === entry || (entry.includes('.') && hostname.endsWith(`.${entry}`)));
}

function isBlockedWebhookHostname(hostname: string): boolean {
  if (!hostname) return true;
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) return true;
  if (hostname.endsWith('.local') || hostname.endsWith('.internal')) return true;
  if (hostname === 'metadata' || hostname === 'metadata.google.internal') return true;
  return false;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
