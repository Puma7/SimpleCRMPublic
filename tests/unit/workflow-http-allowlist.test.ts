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
});
