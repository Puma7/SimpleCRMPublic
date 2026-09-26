import {
  hostMatchesHttpAllowlist,
  isBlockedHttpHostname,
  isHttpMethodAllowed,
  isPrivateOrReservedIp,
  isValidHttpAllowlistEntry,
  validateHttpRequestUrl,
} from '../../shared/workflow-http-allowlist';

describe('workflow-http-allowlist', () => {
  test('rejects bare com allowlist entry', () => {
    expect(isValidHttpAllowlistEntry('com')).toBe(false);
    expect(hostMatchesHttpAllowlist('evil.com', ['com'])).toBe(false);
  });

  test('allows subdomain of dotted entry', () => {
    expect(hostMatchesHttpAllowlist('api.example.com', ['example.com'])).toBe(true);
  });

  test('blocks localhost and metadata IPs', () => {
    expect(isBlockedHttpHostname('localhost')).toBe(true);
    expect(isPrivateOrReservedIp('127.0.0.1')).toBe(true);
    expect(isPrivateOrReservedIp('169.254.169.254')).toBe(true);
    expect(isPrivateOrReservedIp('fe80::1')).toBe(true);
    expect(isPrivateOrReservedIp('fe90::1')).toBe(true);
    expect(isPrivateOrReservedIp('febf::1')).toBe(true);
  });

  test('validateHttpRequestUrl requires allowlist', () => {
    const r = validateHttpRequestUrl('https://api.example.com/x', 'example.com');
    expect(r.ok).toBe(true);
    const blocked = validateHttpRequestUrl('http://127.0.0.1/', 'example.com');
    expect(blocked.ok).toBe(false);
  });

  test('http method whitelist', () => {
    expect(isHttpMethodAllowed('GET')).toBe(true);
    expect(isHttpMethodAllowed('DELETE')).toBe(false);
  });

  // N-cx-05: the desktop blocklist missed IPv6 forms that translate to internal
  // IPv4 (NAT64, 6to4, IPv4-compatible, Teredo) and several reserved ranges the
  // server already blocks (F-A4-07); the check runs on every HTTP-node hop.
  test.each([
    ['NAT64 to link-local metadata', '64:ff9b::a9fe:a9fe'],
    ['NAT64 to RFC1918 (dotted)', '64:ff9b::10.0.0.5'],
    ['local-use NAT64', '64:ff9b:1::5db8:d822'],
    ['6to4 to loopback', '2002:7f00:1::1'],
    ['6to4 to RFC1918', '2002:c0a8:0101::1'],
    ['IPv4-mapped loopback (hex)', '::ffff:7f00:1'],
    ['IPv4-mapped metadata (dotted)', '::ffff:169.254.169.254'],
    ['IPv4-compatible loopback', '::7f00:1'],
    ['IPv4-compatible dotted', '::10.0.0.5'],
    ['Teredo', '2001:0:4136:e378:8000:63bf:3fff:fdd2'],
    ['IPv6 documentation', '2001:db8::1'],
    ['IPv6 discard-only', '100::1'],
    ['site-local fec0::/10', 'fec0::1'],
    ['site-local upper bound', 'feff::1'],
    ['IPv6 multicast', 'ff02::1'],
    ['ULA written short', 'fc00::1'],
    ['IPv6 literal in brackets', '[64:ff9b::7f00:1]'],
    ['IPv4 benchmarking 198.18.0.0/15', '198.19.255.1'],
    ['IPv4 IETF protocol assignments', '192.0.0.170'],
    ['IPv4 documentation TEST-NET-1', '192.0.2.10'],
    ['IPv4 documentation TEST-NET-2', '198.51.100.10'],
    ['IPv4 documentation TEST-NET-3', '203.0.113.10'],
    ['IPv4 6to4 relay anycast', '192.88.99.1'],
    ['IPv4 multicast', '224.0.0.1'],
    ['IPv4 class E', '240.0.0.1'],
    ['IPv4 broadcast', '255.255.255.255'],
  ])('blocks %s (%s)', (_label, address) => {
    expect(isPrivateOrReservedIp(address)).toBe(true);
  });

  test.each([
    ['public IPv4', '93.184.216.34'],
    ['public IPv6', '2606:2800:220:1:248:1893:25c8:1946'],
    ['NAT64 to public IPv4', '64:ff9b::5db8:d822'],
    ['6to4 to public IPv4', '2002:5db8:d822::1'],
    ['IPv4-mapped public IPv4', '::ffff:93.184.216.34'],
    ['IPv4 next to benchmarking range', '198.20.0.1'],
    ['hostname', 'api.example.com'],
  ])('keeps allowing %s (%s)', (_label, address) => {
    expect(isPrivateOrReservedIp(address)).toBe(false);
  });
});
