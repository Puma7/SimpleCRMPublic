import type { GuardedFetch, GuardedHttpResponse } from './pinned-fetch';

export type GuardedRedirectMessages = Readonly<{
  aborted: string;
  timeout: string;
  tooManyRedirects: (maxRedirects: number) => string;
  missingLocation: string;
}>;

/**
 * Validates one hop (scheme, allowlist, DNS) and returns the addresses the
 * connection is pinned to. Throws to block the hop.
 */
export type GuardedHopResolver = (
  url: string,
  budget: { signal?: AbortSignal; timeoutMs: number },
) => Promise<readonly string[]>;

export type GuardedRedirectFetchArgs = Readonly<{
  url: string;
  resolveHop: GuardedHopResolver;
  /** Addresses the caller already validated for `url`; the first hop then skips resolveHop. */
  initialAddresses?: readonly string[];
  fetchImpl: GuardedFetch;
  init: {
    method: 'GET' | 'POST';
    headers: Record<string, string>;
    body?: string;
    timeoutMs: number;
    /** Optional caller AbortSignal; combined with the per-hop timeout when available. */
    signal?: AbortSignal;
  };
  maxRedirects: number;
  /**
   * 307/308 keep method and body. When true, a 307/308 to another host drops
   * the body instead of replaying it to that host.
   */
  dropBodyOnCrossHostRedirect?: boolean;
  messages: GuardedRedirectMessages;
}>;

/**
 * Follows redirects by hand (redirect: 'manual') so every hop is validated and
 * pinned before it is connected to.
 */
export async function fetchWithGuardedRedirects(args: GuardedRedirectFetchArgs): Promise<GuardedHttpResponse> {
  const { maxRedirects, messages } = args;
  // One shared deadline for the whole redirect chain: each hop gets only the
  // remaining budget, so a slow multi-hop chain can't multiply the timeout by
  // the number of hops.
  const deadline = Date.now() + args.init.timeoutMs;
  let currentUrl = args.url;
  // Method/body/headers can change across hops per fetch redirect semantics.
  let method = args.init.method;
  let body = args.init.body;
  let headers: Record<string, string> = { ...args.init.headers };
  for (let hop = 0; ; hop += 1) {
    if (args.init.signal?.aborted) {
      throw new Error(messages.aborted);
    }
    const remainingMs = Math.max(0, deadline - Date.now());
    if (remainingMs <= 0) {
      throw new Error(messages.timeout);
    }
    const addresses =
      hop === 0 && args.initialAddresses
        ? args.initialAddresses
        : await args.resolveHop(currentUrl, {
          signal: args.init.signal,
          timeoutMs: remainingMs,
        });
    const hopRemainingMs = Math.max(0, deadline - Date.now());
    if (hopRemainingMs <= 0) {
      throw new Error(messages.timeout);
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
        throw new Error(messages.tooManyRedirects(maxRedirects));
      }
      const location = response.headers.get('location');
      if (!location) {
        throw new Error(messages.missingLocation);
      }
      const previous = new URL(currentUrl);
      const nextUrl = new URL(location, currentUrl);
      currentUrl = nextUrl.toString();
      // On a cross-origin redirect, drop credential headers so an allowlisted
      // endpoint can't bounce Authorization/Cookie to a different (also
      // allowlisted) host (matches fetch's cross-origin credential strip).
      if (nextUrl.origin !== previous.origin) {
        headers = withoutHeaders(headers, ['authorization', 'cookie', 'proxy-authorization']);
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
        headers = withoutHeaders(headers, ['content-type', 'content-length']);
      } else if (args.dropBodyOnCrossHostRedirect && body !== undefined && nextUrl.host !== previous.host) {
        body = undefined;
        headers = withoutHeaders(headers, ['content-type', 'content-length']);
      }
      continue; // the next iteration validates the new URL → blocks private/off-allowlist hops
    }
    return response;
  }
}

function withoutHeaders(headers: Record<string, string>, names: readonly string[]): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).filter(([k]) => !names.includes(k.toLowerCase())));
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
