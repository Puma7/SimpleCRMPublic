import { runStoredMailSecurityChecks } from '../../packages/server/src/mail-security-check';

describe('server mail security provider timeouts', () => {
  test('returns from a mailauth provider that never settles', async () => {
    const result = await runStoredMailSecurityChecks({
      rawHeaders: 'From: sender@example.com',
      bodyText: 'body',
      bodyHtml: null,
      mailauthEnabled: true,
      mailauthTimeoutMs: 5,
      mailauthAuthenticate: async () => new Promise(() => undefined),
      rspamdEnabled: false,
      rspamdUrl: 'http://127.0.0.1:11333',
      rspamdTimeoutMs: 1000,
    });

    expect(result.authChecked).toBe(true);
    expect(result.auth).toMatchObject({
      spf: 'unknown',
      dkim: 'unknown',
      dmarc: 'unknown',
      arc: 'unknown',
      error: 'Mailauth Timeout',
    });
  });
});
