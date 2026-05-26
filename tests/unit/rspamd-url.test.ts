import { normalizeRspamdBaseUrl } from '../../shared/rspamd-url';

describe('normalizeRspamdBaseUrl', () => {
  test('accepts public http host', () => {
    const r = normalizeRspamdBaseUrl('https://rspamd.example.com');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.baseUrl).toBe('https://rspamd.example.com');
  });

  test('allows localhost rspamd', () => {
    const r = normalizeRspamdBaseUrl('http://127.0.0.1:11333');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.baseUrl).toBe('http://127.0.0.1:11333');
  });

  test('rejects ftp scheme', () => {
    const r = normalizeRspamdBaseUrl('ftp://rspamd.example.com');
    expect(r.ok).toBe(false);
  });
});
