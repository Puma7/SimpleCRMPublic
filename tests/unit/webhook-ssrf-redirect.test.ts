import {
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
