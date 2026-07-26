import { lookup as dnsLookup } from 'node:dns/promises';

import { createPinnedFetch, type GuardedFetch } from './jobs/pinned-fetch';
import { assertWebhookUrlAllowed, guardedFetch } from './jobs/webhook-handlers';

type AiLookup = (hostname: string) => Promise<readonly { address: string }[]>;

const DEFAULT_AI_TIMEOUT_MS = 60_000;

/**
 * Performs an outbound AI HTTP POST with the same SSRF controls as webhooks:
 * allowlist derived from the profile baseUrl host, DNS private-IP rejection,
 * and pinned-fetch (no DNS rebinding on connect).
 */
export async function guardedAiPost(input: {
  url: string;
  baseUrl: string;
  headers: Record<string, string>;
  body: string;
  signal?: AbortSignal;
  fetchImpl?: GuardedFetch;
  lookup?: AiLookup;
  timeoutMs?: number;
}): Promise<{ ok: boolean; status: number; text(): Promise<string> }> {
  let allowHost: string;
  try {
    allowHost = new URL(input.baseUrl).hostname.toLowerCase().replace(/\.$/, '');
  } catch {
    throw new Error('KI API baseUrl is invalid');
  }
  if (!allowHost) throw new Error('KI API baseUrl host is required');

  const fetchImpl = input.fetchImpl ?? createPinnedFetch();
  const lookup = input.lookup ?? ((hostname: string) => dnsLookup(hostname, { all: true, verbatim: true }));
  const timeoutMs = input.timeoutMs ?? DEFAULT_AI_TIMEOUT_MS;

  // Pre-validate the exact request URL host matches the profile base host
  // (path may differ: /chat/completions vs /v1/messages).
  let requestHost: string;
  try {
    requestHost = new URL(input.url).hostname.toLowerCase().replace(/\.$/, '');
  } catch {
    throw new Error('KI API URL is invalid');
  }
  if (requestHost !== allowHost) {
    throw new Error('KI API request host must match the profile baseUrl host');
  }

  // assertWebhookUrlAllowed is reused for private-IP / DNS checks; allowlist is
  // the single configured profile host.
  await assertWebhookUrlAllowed(input.url, [allowHost], lookup);

  const response = await guardedFetch({
    url: input.url,
    allowlist: [allowHost],
    lookup,
    fetchImpl,
    init: {
      method: 'POST',
      headers: input.headers,
      body: input.body,
      timeoutMs,
    },
    maxRedirects: 0,
  });

  if (input.signal?.aborted) {
    throw new Error('KI API request was aborted');
  }

  return response;
}
