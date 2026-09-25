import dns from 'node:dns/promises';
import {
  createPinnedFetch,
  fetchWithGuardedRedirects,
  type GuardedHttpResponse,
} from '../../packages/core/src/net';
import {
  isPrivateOrReservedIp,
  validateHttpRequestUrl,
} from '../../shared/workflow-http-allowlist';

const WORKFLOW_HTTP_MAX_REDIRECTS = 5;

export async function assertWorkflowHttpUrlAllowed(
  url: string,
  allowlistRaw: string,
): Promise<{ ok: true; addresses: string[] } | { ok: false; message: string }> {
  const base = validateHttpRequestUrl(url, allowlistRaw);
  if (!base.ok) return base;

  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return { ok: false, message: 'Ungültige URL' };
  }

  // The checked addresses are returned so the connection is pinned to them;
  // resolving again at connect time would reopen DNS rebinding.
  const addresses: string[] = [];
  try {
    const records = await dns.lookup(host, { all: true, verbatim: true });
    for (const rec of records) {
      const addr = String(rec.address).replace(/^\[|\]$/g, '');
      if (isPrivateOrReservedIp(addr)) {
        return { ok: false, message: 'DNS-Auflösung zeigt auf blockierte Adresse' };
      }
      addresses.push(addr);
    }
  } catch {
    return { ok: false, message: 'DNS-Auflösung fehlgeschlagen' };
  }
  if (addresses.length === 0) {
    return { ok: false, message: 'DNS-Auflösung fehlgeschlagen' };
  }

  return { ok: true, addresses };
}

/**
 * Sends a workflow HTTP request over the pinned transport shared with the server
 * edition: the socket connects to the validated addresses, redirects are
 * followed by hand and every further hop passes assertWorkflowHttpUrlAllowed
 * again (scheme, allowlist, DNS/private networks).
 */
export async function sendWorkflowHttpRequest(input: {
  url: string;
  allowlistRaw: string;
  /** From assertWorkflowHttpUrlAllowed(url); the first hop connects to exactly these. */
  addresses: readonly string[];
  method: 'GET' | 'POST';
  headers: Record<string, string>;
  body?: string;
  timeoutMs: number;
}): Promise<GuardedHttpResponse> {
  return fetchWithGuardedRedirects({
    url: input.url,
    initialAddresses: input.addresses,
    resolveHop: async (hopUrl) => {
      const check = await assertWorkflowHttpUrlAllowed(hopUrl, input.allowlistRaw);
      if (!check.ok) throw new Error(`Weiterleitung blockiert: ${check.message}`);
      return check.addresses;
    },
    fetchImpl: createPinnedFetch(),
    init: {
      method: input.method,
      headers: input.headers,
      ...(input.body !== undefined ? { body: input.body } : {}),
      timeoutMs: input.timeoutMs,
    },
    maxRedirects: WORKFLOW_HTTP_MAX_REDIRECTS,
    // A 307/308 must not hand the workflow's request body to another host.
    dropBodyOnCrossHostRedirect: true,
    messages: {
      aborted: 'HTTP-Anfrage abgebrochen',
      timeout: 'HTTP-Anfrage: Zeitlimit überschritten',
      tooManyRedirects: (max) => `Zu viele Weiterleitungen (max ${max})`,
      missingLocation: 'Weiterleitung ohne Location-Header',
    },
  });
}
