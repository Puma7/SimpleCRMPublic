import { runStoredMailSecurityChecks, verifyMailAuthentication } from '../../packages/server/src/mail-security-check';

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

describe('server mail auth header fallback', () => {
  const neverSettles = async () => new Promise<never>(() => undefined);

  // F-A5-12: Der Fallback uebernahm SPF/DKIM/DMARC aus jedem (ARC-)Authentication-Results-Header, auch aus einem vom Absender eingeschleusten unterhalb des Provider-Headers.
  test('ignores sender-injected Authentication-Results below the receiving server header', async () => {
    const rawHeaders = [
      'Return-Path: <x@attacker.example>',
      'Authentication-Results: mx.provider.example; spf=none smtp.mailfrom=attacker.example',
      'Received: from attacker.example (attacker.example [192.0.2.1]) by mx.provider.example',
      'Authentication-Results: evil.example; spf=pass; dkim=pass; dmarc=pass',
      'From: chef@kunde.de',
      'Subject: Neue Bankverbindung',
    ].join('\r\n');

    const result = await verifyMailAuthentication({
      rawHeaders,
      bodyText: 'x',
      bodyHtml: null,
      mailauthTimeoutMs: 5,
      mailauthAuthenticate: neverSettles as any,
      trustedAuthservId: 'provider.example',
    });

    expect(result.spf).toBe('none');
    expect(result.dkim).not.toBe('pass');
    expect(result.dmarc).not.toBe('pass');
  });

  test('ignores unvalidated ARC-Authentication-Results', async () => {
    const rawHeaders = [
      'ARC-Authentication-Results: i=1; evil.example; spf=pass; dkim=pass; dmarc=pass',
      'From: chef@kunde.de',
      'Subject: Neue Bankverbindung',
    ].join('\r\n');

    const result = await verifyMailAuthentication({
      rawHeaders,
      bodyText: 'x',
      bodyHtml: null,
      mailauthTimeoutMs: 5,
      mailauthAuthenticate: neverSettles as any,
    });

    expect(result.spf).not.toBe('pass');
    expect(result.dkim).not.toBe('pass');
    expect(result.dmarc).not.toBe('pass');
  });

  // The fallback now requires a trusted authserv-id (F-A5-12, E6); the header
  // below is the receiving server's own one, so it is configured as trusted.
  test('still uses the topmost Authentication-Results of the receiving server', async () => {
    const rawHeaders = [
      'Authentication-Results: mx.google.com;',
      ' spf=pass smtp.mailfrom=gmail.com; dkim=pass header.d=gmail.com; dmarc=pass',
      'From: friend@gmail.com',
    ].join('\r\n');

    const result = await verifyMailAuthentication({
      rawHeaders,
      bodyText: 'x',
      bodyHtml: null,
      mailauthTimeoutMs: 5,
      mailauthAuthenticate: neverSettles as any,
      trustedAuthservId: 'mx.google.com',
    });

    expect(result).toMatchObject({ spf: 'pass', dkim: 'pass', dmarc: 'pass' });
    expect(result.error).toMatch(/Authentication-Results/);
  });

  // F-A5-12 (E6): Ohne eigenen A-R-Header des empfangenden MTA zaehlte der vom Absender eingeschleuste oberste Header, egal welche authserv-id er trug.
  describe('authserv-id (RFC 8601 section 5)', () => {
    const injectedOnly = [
      'Authentication-Results: evil.example; spf=pass; dkim=pass; dmarc=pass',
      'Received: from attacker.example (attacker.example [192.0.2.1]) by mail.kunde.de',
      'From: chef@kunde.de',
      'Subject: Neue Bankverbindung',
    ].join('\r\n');

    test('ignores a topmost field whose authserv-id is not the trusted one', async () => {
      const result = await verifyMailAuthentication({
        rawHeaders: injectedOnly,
        bodyText: 'x',
        bodyHtml: null,
        mailauthTimeoutMs: 5,
        mailauthAuthenticate: neverSettles as any,
        trustedAuthservId: 'kunde.de',
      });

      expect(result).toMatchObject({ spf: 'unknown', dkim: 'unknown', dmarc: 'unknown', error: 'Mailauth Timeout' });
    });

    test('uses no header at all without a trusted authserv-id', async () => {
      const result = await verifyMailAuthentication({
        rawHeaders: injectedOnly,
        bodyText: 'x',
        bodyHtml: null,
        mailauthTimeoutMs: 5,
        mailauthAuthenticate: neverSettles as any,
      });

      expect(result).toMatchObject({ spf: 'unknown', dkim: 'unknown', dmarc: 'unknown' });
    });

    test('uses the topmost trusted field, also below a local filter field and for subdomains', async () => {
      const rawHeaders = [
        'Authentication-Results: spamfilter.local; dkim=none',
        'Authentication-Results: mx01.kunde.de 1;',
        ' spf=fail smtp.mailfrom=attacker.example; dkim=fail; dmarc=fail',
        'Authentication-Results: kunde.de; spf=pass; dkim=pass; dmarc=pass',
        'From: chef@kunde.de',
      ].join('\r\n');

      const result = await runStoredMailSecurityChecks({
        rawHeaders,
        bodyText: 'x',
        bodyHtml: null,
        mailauthEnabled: true,
        mailauthTimeoutMs: 5,
        mailauthAuthenticate: neverSettles as any,
        trustedAuthservId: 'kunde.de',
        rspamdEnabled: false,
        rspamdUrl: 'http://127.0.0.1:11333',
        rspamdTimeoutMs: 1000,
      });

      expect(result.auth).toMatchObject({ spf: 'fail', dkim: 'fail', dmarc: 'fail' });
    });
  });
});
