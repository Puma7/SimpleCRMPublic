import Fastify from 'fastify';

import { checkTrustProxy } from '../../packages/server/src/cli/doctor';
import { parseTrustProxyEnv } from '../../packages/server/src/server';

// Fastify >= 5.12 ignores numeric trustProxy (hop counts cannot tell the proxy
// from a client that sends its own X-Forwarded-For). The bundled stack used
// TRUST_PROXY=1, which after the security update collapsed every client into
// Caddy's rate-limit bucket. It now trusts the private compose network instead.

async function resolvedIp(trustProxy: boolean | string | undefined, remoteAddress: string, forwardedFor: string) {
  const app = Fastify(trustProxy === undefined ? {} : { trustProxy });
  app.get('/ip', async (request) => ({ ip: request.ip }));
  try {
    const response = await app.inject({
      method: 'GET',
      url: '/ip',
      remoteAddress,
      headers: { 'x-forwarded-for': forwardedFor },
    });
    return (response.json() as { ip: string }).ip;
  } finally {
    await app.close();
  }
}

describe('TRUST_PROXY parsing', () => {
  test('passes proxy-addr presets and booleans through', () => {
    expect(parseTrustProxyEnv(undefined)).toBeUndefined();
    expect(parseTrustProxyEnv('  ')).toBeUndefined();
    expect(parseTrustProxyEnv('true')).toBe(true);
    expect(parseTrustProxyEnv('false')).toBe(false);
    expect(parseTrustProxyEnv('uniquelocal')).toBe('uniquelocal');
    expect(parseTrustProxyEnv('10.0.0.0/8, 172.16.0.0/12')).toBe('10.0.0.0/8, 172.16.0.0/12');
  });

  test('rejects hop counts with a warning instead of silently trusting nobody', () => {
    const warnings: string[] = [];
    expect(parseTrustProxyEnv('1', (message) => warnings.push(message))).toBe(false);
    expect(warnings).toEqual([expect.stringContaining('uniquelocal')]);
  });

  test('doctor fails on a hop count and accepts the compose default', () => {
    expect(checkTrustProxy({ TRUST_PROXY: '1' })).toMatchObject({ name: 'trust_proxy', status: 'fail' });
    expect(checkTrustProxy({ TRUST_PROXY: 'uniquelocal' })).toMatchObject({ name: 'trust_proxy', status: 'ok' });
  });
});

describe('client IP resolution behind the bundled Caddy proxy', () => {
  test('uses the forwarded client IP when the peer is Caddy on the private compose network', async () => {
    await expect(resolvedIp(parseTrustProxyEnv('uniquelocal'), '172.18.0.5', '198.51.100.7')).resolves.toBe('198.51.100.7');
  });

  test('keeps the socket address when a public client sends its own X-Forwarded-For', async () => {
    await expect(resolvedIp(parseTrustProxyEnv('uniquelocal'), '203.0.113.9', '198.51.100.7')).resolves.toBe('203.0.113.9');
  });

  test('documents why the old hop count no longer works: fastify keeps the proxy address', async () => {
    const app = Fastify({ trustProxy: 1 as never });
    app.get('/ip', async (request) => ({ ip: request.ip }));
    const response = await app.inject({
      method: 'GET',
      url: '/ip',
      remoteAddress: '172.18.0.5',
      headers: { 'x-forwarded-for': '198.51.100.7' },
    });
    await app.close();
    expect((response.json() as { ip: string }).ip).toBe('172.18.0.5');
  });
});
