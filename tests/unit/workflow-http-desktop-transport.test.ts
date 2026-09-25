/**
 * @jest-environment node
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';

import type { RegisteredWorkflowNode, WorkflowContext } from '../../electron/workflow/types';

// Fake public addresses the DNS mock hands out. The transport wrapper below
// connects them to the loopback test server, so the real pinned transport and
// the real redirect loop run end to end without touching the network.
const API_IP = '93.184.216.34';
const OTHER_IP = '93.184.216.35';
const FAKE_PUBLIC_IPS = new Set([API_IP, OTHER_IP]);

const mockLookup = jest.fn();
jest.mock('node:dns/promises', () => ({
  __esModule: true,
  default: { lookup: (...args: unknown[]) => mockLookup(...args) },
  lookup: (...args: unknown[]) => mockLookup(...args),
}));

jest.mock('../../electron/sqlite-service', () => ({
  getSyncInfo: jest.fn((key: string) => (key === 'workflow_http_allowlist' ? 'example.com' : null)),
}));

type PinnedCall = { url: string; method: string; body?: string; pinnedAddresses: readonly string[] };
const pinnedCalls: PinnedCall[] = [];
jest.mock('../../packages/core/src/net/pinned-fetch', () => {
  const actual = jest.requireActual('../../packages/core/src/net/pinned-fetch');
  return {
    ...actual,
    createPinnedFetch: () => {
      const real = actual.createPinnedFetch();
      return (url: string, init: PinnedCall & Record<string, unknown>) => {
        pinnedCalls.push({ url, method: init.method, body: init.body, pinnedAddresses: init.pinnedAddresses });
        const toLoopback = init.pinnedAddresses.map((a: string) => (FAKE_PUBLIC_IPS.has(a) ? '127.0.0.1' : a));
        return real(url, { ...init, pinnedAddresses: toLoopback });
      };
    },
  };
});

import { registerIntegrationNodes } from '../../electron/workflow/nodes/integration-nodes';

function httpNode(): RegisteredWorkflowNode {
  let node: RegisteredWorkflowNode | undefined;
  registerIntegrationNodes((def) => {
    if (def.type === 'http.request') node = def;
  });
  return node!;
}

function ctx(dryRun: boolean): WorkflowContext {
  return {
    trigger: 'manual',
    direction: 'manual',
    messageId: null,
    message: null,
    outbound: null,
    workflowId: 1,
    runId: 1,
    dryRun,
    variables: {},
    strings: {},
    ai: {},
  };
}

type Hit = { path: string; host: string; method: string; body: string; contentType?: string };

describe('desktop workflow http.request transport', () => {
  let server: http.Server;
  let port = 0;
  let hits: Hit[] = [];
  const realFetch = globalThis.fetch;
  // Stand-in for the old transport: global fetch pointed at the test server.
  // The hardened node must never use it.
  const globalFetch = jest.fn((input: string | URL, init?: RequestInit) =>
    realFetch(String(input).replace(/\/\/[^/]+\//, `//127.0.0.1:${port}/`), init),
  );

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c: Buffer) => {
        body += c.toString('utf8');
      });
      req.on('end', () => {
        const path = req.url ?? '/';
        hits.push({
          path,
          host: String(req.headers.host ?? ''),
          method: req.method ?? '',
          body,
          contentType: req.headers['content-type'],
        });
        const redirect = (status: number, location: string) => {
          res.writeHead(status, { location });
          res.end();
        };
        if (path === '/to-loopback') return redirect(302, `http://127.0.0.1:${port}/secret`);
        if (path === '/to-intranet') return redirect(302, `http://intranet.example.com:${port}/secret`);
        if (path === '/to-other') return redirect(302, `http://other.example.com:${port}/echo`);
        if (path === '/see-other') return redirect(303, '/echo');
        if (path === '/temp-cross-host') return redirect(307, `http://other.example.com:${port}/echo`);
        if (path === '/temp-same-host') return redirect(307, '/echo');
        if (path === '/loop') return redirect(302, '/loop');
        if (path === '/secret') {
          res.writeHead(200, { 'content-type': 'text/plain' });
          res.end('internal-secret');
          return;
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ method: req.method, body }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    globalThis.fetch = realFetch;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(() => {
    hits = [];
    pinnedCalls.length = 0;
    globalFetch.mockClear();
    globalThis.fetch = globalFetch as unknown as typeof fetch;
    mockLookup.mockReset();
    mockLookup.mockImplementation(async (host: string) => {
      if (host === 'api.example.com') return [{ address: API_IP, family: 4 }];
      if (host === 'other.example.com') return [{ address: OTHER_IP, family: 4 }];
      if (host === 'intranet.example.com') return [{ address: '192.168.1.10', family: 4 }];
      throw new Error(`unexpected lookup ${host}`);
    });
  });

  const api = (path: string) => `http://api.example.com:${port}${path}`;

  // C-A3: a 302 from an allowlisted host to 127.0.0.1 was followed by global fetch.
  test('rejects a 302 redirect to 127.0.0.1 before connecting to it', async () => {
    await expect(
      httpNode().execute(ctx(false), { method: 'GET', url: api('/to-loopback') }, 'http'),
    ).rejects.toThrow('Private/lokale IP-Adressen sind blockiert');

    expect(hits.map((h) => h.path)).toEqual(['/to-loopback']);
    expect(globalFetch).not.toHaveBeenCalled();
  });

  // C-B6: a redirect to an allowlisted name that resolves into the LAN was followed.
  test('rejects a redirect to an allowlisted host that resolves to a private address', async () => {
    await expect(
      httpNode().execute(ctx(false), { method: 'GET', url: api('/to-intranet') }, 'http'),
    ).rejects.toThrow('DNS-Auflösung zeigt auf blockierte Adresse');

    expect(hits.map((h) => h.path)).toEqual(['/to-intranet']);
    expect(mockLookup).toHaveBeenCalledWith('intranet.example.com', expect.anything());
  });

  // C-C4: the connection re-resolved DNS after the check (rebinding to loopback).
  test('connects to the address the guard validated instead of resolving again', async () => {
    mockLookup.mockReset();
    mockLookup
      .mockResolvedValueOnce([{ address: API_IP, family: 4 }])
      .mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);

    const result = await httpNode().execute(ctx(false), { method: 'GET', url: api('/echo') }, 'http');

    expect(result).toMatchObject({ status: 'ok', variables: { 'http.status': 200 } });
    expect(mockLookup).toHaveBeenCalledTimes(1);
    expect(pinnedCalls).toEqual([
      expect.objectContaining({ url: api('/echo'), pinnedAddresses: [API_IP] }),
    ]);
    expect(globalFetch).not.toHaveBeenCalled();
  });

  test('follows a redirect to another allowlisted public host and re-checks that hop', async () => {
    const result = await httpNode().execute(ctx(false), { method: 'GET', url: api('/to-other') }, 'http');

    expect(result).toMatchObject({ status: 'ok', variables: { 'http.status': 200 } });
    expect(pinnedCalls.map((c) => c.pinnedAddresses)).toEqual([[API_IP], [OTHER_IP]]);
    expect(hits.map((h) => h.host)).toEqual([`api.example.com:${port}`, `other.example.com:${port}`]);
  });

  test('replays a 303 as a bodyless GET', async () => {
    const result = await httpNode().execute(
      ctx(false),
      { method: 'POST', url: api('/see-other'), body: '{"a":1}' },
      'http',
    );

    expect(result).toMatchObject({ status: 'ok' });
    expect(hits[1]).toMatchObject({ path: '/echo', method: 'GET', body: '', contentType: undefined });
  });

  test('does not carry the body across hosts on a 307, but keeps it on the same host', async () => {
    await httpNode().execute(
      ctx(false),
      { method: 'POST', url: api('/temp-cross-host'), body: '{"secret":1}' },
      'http',
    );
    expect(hits[1]).toMatchObject({
      host: `other.example.com:${port}`,
      method: 'POST',
      body: '',
      contentType: undefined,
    });

    hits = [];
    await httpNode().execute(
      ctx(false),
      { method: 'POST', url: api('/temp-same-host'), body: '{"keep":1}' },
      'http',
    );
    expect(hits[1]).toMatchObject({ path: '/echo', method: 'POST', body: '{"keep":1}' });
  });

  test('stops after five redirects', async () => {
    await expect(
      httpNode().execute(ctx(false), { method: 'GET', url: api('/loop') }, 'http'),
    ).rejects.toThrow('Zu viele Weiterleitungen (max 5)');
    expect(hits).toHaveLength(6);
  });

  test('dry-run validates the URL but never sends the request', async () => {
    await expect(
      httpNode().execute(ctx(true), { method: 'POST', url: api('/echo'), body: '{}' }, 'http'),
    ).resolves.toMatchObject({ status: 'ok', message: `dry-run ${api('/echo')}` });
    expect(hits).toEqual([]);
    expect(pinnedCalls).toEqual([]);
    expect(globalFetch).not.toHaveBeenCalled();
  });
});
