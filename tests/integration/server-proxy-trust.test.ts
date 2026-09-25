import { createFastifyServer } from '../../packages/server/src/api/fastify-adapter';
import { parseTrustProxyEnv } from '../../packages/server/src/config';
import { startServer } from '../../packages/server/src/server';
import { createSmokePorts } from '../../packages/server/src/server-smoke';

describe('server proxy trust', () => {
  test.each([
    [undefined, false], ['', false], ['  ', false], ['false', false], ['0', false],
    ['true', true], [' uniquelocal ', 'uniquelocal'],
    ['192.0.2.10,2001:db8::/32', '192.0.2.10,2001:db8::/32'],
  ])('parses %s', (raw, expected) => {
    expect(parseTrustProxyEnv(raw)).toBe(expected);
  });

  test.each(['1', '2', '01', '-1', '1.5', 'garbage', '192.0.2.1/33', '::1/129', '192.0.2.1,'])('rejects invalid trust policy %s before creating resources', async (raw) => {
    const createDatabase = jest.fn();
    await expect(startServer({
      env: { TRUST_PROXY: raw },
      createDatabase,
      logger: false,
      host: '127.0.0.1',
      port: 0,
    })).rejects.toThrow('TRUST_PROXY');
    expect(createDatabase).not.toHaveBeenCalled();
  });

  test.each([
    [false, '192.0.2.20', '198.51.100.42', '192.0.2.20', false],
    ['172.31.255.2', '172.31.255.2', '198.51.100.42', '198.51.100.42', true],
    ['172.31.255.2', '172.31.255.3', '198.51.100.42', '172.31.255.3', false],
    ['uniquelocal', '172.18.0.2', '198.51.100.42', '198.51.100.42', true],
    ['uniquelocal', '203.0.113.20', '198.51.100.42', '203.0.113.20', false],
    ['172.18.0.2', '172.18.0.3', '198.51.100.42', '172.18.0.3', false],
    ['172.18.0.2', '172.18.0.2', '198.51.100.99, 203.0.113.42', '203.0.113.42', true],
    ['172.18.0.2,192.0.2.5', '172.18.0.2', '198.51.100.42, 192.0.2.5', '198.51.100.42', true],
    ['uniquelocal', 'fd00::2', '2001:db8::42', '2001:db8::42', true],
  ] as const)('trust=%s peer=%s forwarded=%s', async (trustProxy, remoteAddress, forwarded, clientIp, trusted) => {
    const check = jest.fn().mockResolvedValue({ allowed: true });
    const app = createFastifyServer({ ports: createSmokePorts(), trustProxy, apiRateLimit: { check } });
    app.get('/api/v1/proxy-test', (request) => ({
      ip: request.ip, hostname: request.hostname, protocol: request.protocol,
    }));
    try {
      const response = await app.inject({
        url: '/api/v1/proxy-test', remoteAddress,
        headers: {
          host: 'api.example.test',
          'x-forwarded-for': forwarded,
          'x-forwarded-host': 'proxy.example.test',
          'x-forwarded-proto': 'https',
        },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        ip: clientIp,
        hostname: trusted ? 'proxy.example.test' : 'api.example.test',
        protocol: trusted ? 'https' : 'http',
      });
      expect(check).toHaveBeenCalledWith(expect.objectContaining({ clientKey: clientIp }));
    } finally {
      await app.close();
    }
  });
});
