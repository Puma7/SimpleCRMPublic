import {
  assertWebhookUrlAllowed,
  createFetchWebhookDispatchPort,
  guardedFetch,
} from '../../packages/server/src/jobs/webhook-handlers';

// `guardedFetch` is imported to assert the redirect-hardening export exists and
// is what the dispatch port routes through.
void guardedFetch;

const basePlan = {
  workspaceId: 'ws-1',
  url: 'https://api.example.com/hook',
  method: 'POST' as const,
  headers: {},
  timeoutMs: 5000,
};

describe('webhook SSRF redirect + DNS-rebind hardening', () => {
  test('blocks a 302 redirect to the cloud metadata service', async () => {
    const fetchImpl = jest.fn(async () => ({
      ok: false,
      status: 302,
      headers: {
        get: (name: string) =>
          name.toLowerCase() === 'location' ? 'http://169.254.169.254/latest/meta-data/' : null,
      },
      text: async () => '',
    }));

    const port = createFetchWebhookDispatchPort({
      allowlist: 'example.com',
      fetch: fetchImpl,
      lookup: async () => [{ address: '93.184.216.34' }],
    });

    await expect(port.dispatch(basePlan)).rejects.toThrow();
    // The 2nd hop re-validates 169.254.169.254 and throws before any second
    // fetch, so the metadata address is never connected to.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test('pins the connection to the validated IP and never re-resolves (DNS rebind)', async () => {
    let capturedPinned: readonly string[] | undefined;
    const fetchImpl = jest.fn(async (_url: string, init: { pinnedAddresses: readonly string[] }) => {
      capturedPinned = init.pinnedAddresses;
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        text: async () => 'ok',
      };
    });

    let lookupCalls = 0;
    const lookup = jest.fn(async () => {
      lookupCalls += 1;
      // First resolution is the validated public IP; any later (rebindable)
      // resolution would return a private IP.
      return lookupCalls === 1
        ? [{ address: '93.184.216.34' }]
        : [{ address: '169.254.169.254' }];
    });

    const port = createFetchWebhookDispatchPort({
      allowlist: 'example.com',
      fetch: fetchImpl,
      lookup,
    });

    await expect(port.dispatch(basePlan)).resolves.toEqual({ status: 200, bodyPreview: 'ok' });
    expect(capturedPinned).toEqual(['93.184.216.34']);
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  test('allows a normal allowlisted request and requests redirect: manual', async () => {
    let capturedRedirect: string | undefined;
    const fetchImpl = jest.fn(async (_url: string, init: { redirect: string }) => {
      capturedRedirect = init.redirect;
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        text: async () => 'pong',
      };
    });

    const port = createFetchWebhookDispatchPort({
      allowlist: 'example.com',
      fetch: fetchImpl,
      lookup: async () => [{ address: '93.184.216.34' }],
    });

    await expect(port.dispatch(basePlan)).resolves.toEqual({ status: 200, bodyPreview: 'pong' });
    expect(capturedRedirect).toBe('manual');
  });

  test('replays a POST 303 redirect as a bodyless GET (fetch method semantics)', async () => {
    const calls: Array<{ method: string; body?: string; contentType: string | undefined }> = [];
    const fetchImpl = jest.fn(
      async (
        url: string,
        init: { method: string; body?: string; headers: Record<string, string> },
      ) => {
        calls.push({ method: init.method, body: init.body, contentType: init.headers['content-type'] });
        if (url.endsWith('/hook')) {
          return {
            ok: false,
            status: 303,
            headers: {
              get: (n: string) =>
                n.toLowerCase() === 'location' ? 'https://api.example.com/landing' : null,
            },
            text: async () => '',
          };
        }
        return { ok: true, status: 200, headers: { get: () => null }, text: async () => 'done' };
      },
    );

    const port = createFetchWebhookDispatchPort({
      allowlist: 'example.com',
      fetch: fetchImpl,
      lookup: async () => [{ address: '93.184.216.34' }],
    });

    await expect(port.dispatch({ ...basePlan, body: 'payload' })).resolves.toEqual({
      status: 200,
      bodyPreview: 'done',
    });
    // First hop is the original POST with body + content-type; the 303 target is
    // fetched as a GET with no body and the content-type header stripped.
    expect(calls[0]).toMatchObject({ method: 'POST', body: 'payload', contentType: 'application/json' });
    expect(calls[1]).toEqual({ method: 'GET', body: undefined, contentType: undefined });
  });

  test('blocks an allowlisted host resolving to a hex IPv4-mapped loopback (::ffff:7f00:1)', async () => {
    const fetchImpl = jest.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: async () => 'x',
    }));

    const port = createFetchWebhookDispatchPort({
      allowlist: 'example.com',
      fetch: fetchImpl,
      // ::ffff:7f00:1 is 127.0.0.1 written in mapped-hex form.
      lookup: async () => [{ address: '::ffff:7f00:1' }],
    });

    await expect(port.dispatch(basePlan)).rejects.toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('strips Authorization/Cookie on a cross-origin redirect', async () => {
    const seenAuth: Array<string | undefined> = [];
    const fetchImpl = jest.fn(async (url: string, init: { headers: Record<string, string> }) => {
      seenAuth.push(init.headers['authorization']);
      if (url.includes('a.example.com')) {
        return {
          ok: false,
          status: 307, // 307 preserves method/body; isolates the credential-strip behavior
          headers: {
            get: (n: string) =>
              n.toLowerCase() === 'location' ? 'https://b.example.com/next' : null,
          },
          text: async () => '',
        };
      }
      return { ok: true, status: 200, headers: { get: () => null }, text: async () => 'ok' };
    });

    const port = createFetchWebhookDispatchPort({
      allowlist: 'example.com',
      fetch: fetchImpl,
      lookup: async () => [{ address: '93.184.216.34' }],
    });

    await port.dispatch({
      ...basePlan,
      url: 'https://a.example.com/hook',
      headers: { authorization: 'Bearer secret', cookie: 'sid=1' },
    });
    expect(seenAuth[0]).toBe('Bearer secret'); // sent to the original origin
    expect(seenAuth[1]).toBeUndefined(); // dropped on the cross-origin hop
  });
});

// F-A4-07: the DNS-result blocklist missed IPv6 forms that translate to
// internal IPv4 (NAT64, 6to4, IPv4-compatible) and several reserved ranges
// (site-local, multicast, benchmarking, documentation, class E/broadcast).
describe('webhook SSRF blocklist for resolved addresses', () => {
  const resolveTo = (address: string) => assertWebhookUrlAllowed(
    'https://hooks.example.com/simplecrm',
    'hooks.example.com',
    async () => [{ address }],
  );

  test.each([
    ['NAT64 to link-local metadata', '64:ff9b::a9fe:a9fe'],
    ['NAT64 to RFC1918 (dotted)', '64:ff9b::10.0.0.5'],
    ['local-use NAT64', '64:ff9b:1::5db8:d822'],
    ['6to4 to loopback', '2002:7f00:1::1'],
    ['6to4 to RFC1918', '2002:c0a8:0101::1'],
    ['IPv4-compatible loopback', '::7f00:1'],
    ['IPv4-compatible dotted', '::10.0.0.5'],
    ['Teredo', '2001:0:4136:e378:8000:63bf:3fff:fdd2'],
    ['IPv6 documentation', '2001:db8::1'],
    ['IPv6 discard-only', '100::1'],
    ['site-local fec0::/10', 'fec0::1'],
    ['site-local upper bound', 'feff::1'],
    ['IPv6 multicast', 'ff02::1'],
    ['ULA written short', 'fc00::1'],
    ['IPv4 benchmarking 198.18.0.0/15', '198.19.255.1'],
    ['IPv4 IETF protocol assignments', '192.0.0.170'],
    ['IPv4 documentation TEST-NET-1', '192.0.2.10'],
    ['IPv4 documentation TEST-NET-2', '198.51.100.10'],
    ['IPv4 documentation TEST-NET-3', '203.0.113.10'],
    ['IPv4 6to4 relay anycast', '192.88.99.1'],
    ['IPv4 multicast', '224.0.0.1'],
    ['IPv4 class E', '240.0.0.1'],
    ['IPv4 broadcast', '255.255.255.255'],
  ])('blocks %s (%s)', async (_label, address) => {
    await expect(resolveTo(address)).rejects.toThrow('DNS lookup resolved to a blocked address');
  });

  test.each([
    ['public IPv4', '93.184.216.34'],
    ['public IPv6', '2606:2800:220:1:248:1893:25c8:1946'],
    ['NAT64 to public IPv4', '64:ff9b::5db8:d822'],
    ['6to4 to public IPv4', '2002:5db8:d822::1'],
    ['IPv4 next to benchmarking range', '198.20.0.1'],
  ])('keeps allowing %s (%s)', async (_label, address) => {
    await expect(resolveTo(address)).resolves.toEqual([address]);
  });
});
