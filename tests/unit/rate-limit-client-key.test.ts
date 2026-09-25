import { rateLimitClientKey } from '../../packages/server/src/security/rate-limit-client-key';

// F-A3a-05: in-process public limiters counted every IPv6 address separately, so one /64 yielded unlimited buckets.
describe('rateLimitClientKey', () => {
  test('keeps IPv4 per address and folds IPv4-mapped IPv6 onto it', () => {
    expect(rateLimitClientKey('203.0.113.5')).toBe('203.0.113.5');
    expect(rateLimitClientKey('::ffff:203.0.113.5')).toBe('203.0.113.5');
    expect(rateLimitClientKey('::FFFF:cb00:7105')).toBe('203.0.113.5');
  });

  test('groups IPv6 addresses per /64 regardless of notation', () => {
    const key = rateLimitClientKey('2001:db8:1:2::1');
    expect(key).toBe('2001:db8:1:2::/64');
    expect(rateLimitClientKey('2001:0db8:0001:0002:ffff:eeee:dddd:cccc')).toBe(key);
    expect(rateLimitClientKey('2001:DB8:1:2:0:0:0:9')).toBe(key);
    expect(rateLimitClientKey('fe80::1%eth0')).toBe('fe80:0:0:0::/64');
    expect(rateLimitClientKey('2001:db8:1:3::1')).not.toBe(key);
  });

  test('gives missing or unparseable addresses a stable key', () => {
    expect(rateLimitClientKey(undefined)).toBe('unknown');
    expect(rateLimitClientKey('  ')).toBe('unknown');
    expect(rateLimitClientKey('Not-An-IP')).toBe('not-an-ip');
  });
});
