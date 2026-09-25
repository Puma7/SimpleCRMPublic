/**
 * @jest-environment node
 */
import { resolveTrustedAuthservId } from '../../packages/core/src/email/authentication-results';
import { parseMailSource } from '../../packages/server/src/mail-parse';
import {
  checkMessageWithRspamd,
  learnMessageWithRspamd,
  runStoredMailSecurityChecks,
  verifyMailAuthentication,
} from '../../packages/server/src/mail-security-check';

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

    // G8: the topmost field must itself be trusted; a local filter field above
    // it now hides it (see the next test), so this case starts with the MTA field.
    test('uses the topmost field when trusted, also for subdomains', async () => {
      const rawHeaders = [
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

    test('ignores a trusted field below an untrusted topmost one (G8)', async () => {
      const rawHeaders = [
        'Authentication-Results: spamfilter.local; dkim=none',
        'Authentication-Results: mx01.kunde.de; spf=pass; dkim=pass; dmarc=pass',
        'From: chef@kunde.de',
      ].join('\r\n');

      const result = await verifyMailAuthentication({
        rawHeaders,
        bodyText: 'x',
        bodyHtml: null,
        mailauthTimeoutMs: 5,
        mailauthAuthenticate: neverSettles as any,
        trustedAuthservId: 'kunde.de',
      });

      expect(result).toMatchObject({ spf: 'unknown', dkim: 'unknown', dmarc: 'unknown', error: 'Mailauth Timeout' });
    });
  });

  // C-A75: Setzte der Provider eine abweichende authserv-id (Gmail: mx.google.com statt gmail.com), wurde ein tieferes, vom Absender eingeschleustes Feld mit der Standard-id gewaehlt.
  describe('real mail parsed by mail-parse: only the topmost field counts (G8)', () => {
    const rawMail = [
      'Delivered-To: kunde@gmail.com',
      'Received: by 2002:a05:6a10:1234 with SMTP id abc;',
      '        Thu, 25 Sep 2026 08:00:00 -0700 (PDT)',
      'Authentication-Results: mx.google.com;',
      '       spf=fail (google.com: domain of chef@kunde.de does not designate 192.0.2.1 as permitted sender) smtp.mailfrom=chef@kunde.de;',
      '       dmarc=fail (p=REJECT sp=REJECT dis=NONE) header.from=kunde.de',
      'Received: from attacker.example (attacker.example [192.0.2.1]) by mx.google.com',
      'Authentication-Results: gmail.com; spf=pass smtp.mailfrom=kunde.de;',
      '\tdkim=pass header.d=kunde.de; dmarc=pass header.from=kunde.de',
      'From: Chef <chef@kunde.de>',
      'To: kunde@gmail.com',
      'Subject: Neue Bankverbindung',
      'Message-ID: <g8@attacker.example>',
      'Date: Thu, 25 Sep 2026 08:00:00 -0700',
      '',
      'Bitte ab sofort auf das neue Konto ueberweisen.',
      '',
    ].join('\r\n');

    async function verifyParsed(trustedAuthservId: string | null) {
      const parsed = await parseMailSource(Buffer.from(rawMail));
      return verifyMailAuthentication({
        rawRfc822B64: parsed.rawRfc822B64,
        rawHeaders: parsed.rawHeaders,
        bodyText: parsed.bodyText,
        bodyHtml: parsed.bodyHtml,
        mailauthTimeoutMs: 5,
        mailauthAuthenticate: neverSettles as any,
        trustedAuthservId,
      });
    }

    test('a spoofed lower field with the default authserv-id does not replace a failed live check', async () => {
      const trusted = resolveTrustedAuthservId({ incomingHost: 'imap.gmail.com' });
      expect(trusted).toBe('gmail.com');

      const result = await verifyParsed(trusted);

      expect(result).toMatchObject({ spf: 'unknown', dkim: 'unknown', dmarc: 'unknown', error: 'Mailauth Timeout' });
    });

    test('the topmost field is the one the receiving server prepended', async () => {
      const result = await verifyParsed('mx.google.com');

      expect(result).toMatchObject({ spf: 'fail', dkim: 'unknown', dmarc: 'fail' });
    });
  });
});

// N-cx-06: the server Rspamd client read the answer and its error text with
// response.json()/text(), i.e. without a byte limit (the desktop stops at
// 1 MiB / 64 KiB since C-A23); a configured foreign Rspamd URL could fill the
// worker's memory until the timeout.
describe('server Rspamd client bounds what it reads', () => {
  const KIB = 1024;
  const CHUNK = 64 * KIB;
  // Safety net far above both limits, so an unbounded read fails the test
  // instead of filling the test process.
  const SAFETY_STOP_BYTES = 8 * KIB * KIB;

  /** A body that never ends, served in 64 KiB pulls; records how much was read. */
  function endlessResponse(status: number, prefix = '') {
    const stats = { pulled: 0, cancelled: false };
    const encoder = new TextEncoder();
    const filler = encoder.encode('x'.repeat(CHUNK));
    let pending = prefix ? encoder.encode(prefix) : null;
    const stream = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          if (stats.pulled >= SAFETY_STOP_BYTES) {
            controller.error(new Error('endloser Body ungebremst gelesen'));
            return;
          }
          const chunk = pending ?? filler;
          pending = null;
          stats.pulled += chunk.length;
          controller.enqueue(chunk);
        },
        cancel() {
          stats.cancelled = true;
        },
      },
      { highWaterMark: 0 },
    );
    return { response: new Response(stream, { status }), stats };
  }

  const message = {
    rawHeaders: 'From: sender@example.com\r\nSubject: Test',
    bodyText: 'body',
    bodyHtml: null,
    rspamdUrl: 'http://rspamd.example.com',
    rspamdTimeoutMs: 5_000,
  };

  test('stops reading an endless Rspamd answer at 1 MiB', async () => {
    const { response, stats } = endlessResponse(200, '{"score":1,"action":"no action","pad":"');

    const result = await checkMessageWithRspamd({ ...message, fetchImpl: async () => response });

    expect(result).toMatchObject({ score: null, action: null, error: expect.stringMatching(/zu gro/) });
    expect(stats.cancelled).toBe(true);
    expect(stats.pulled).toBeLessThanOrEqual(KIB * KIB + CHUNK);
  });

  test('reads at most 64 KiB of an endless Rspamd error text', async () => {
    const { response, stats } = endlessResponse(503);

    const result = await checkMessageWithRspamd({ ...message, fetchImpl: async () => response });

    expect(result.error).toBe(`Rspamd HTTP 503: ${'x'.repeat(200)}`);
    expect(stats.cancelled).toBe(true);
    expect(stats.pulled).toBeLessThanOrEqual(CHUNK + CHUNK);
  });

  test('reads at most 64 KiB of an endless Rspamd learn error text', async () => {
    const { response, stats } = endlessResponse(500);

    const result = await learnMessageWithRspamd({ ...message, label: 'spam', fetchImpl: async () => response });

    expect(result).toEqual({ success: false, label: 'spam', error: `Rspamd HTTP 500: ${'x'.repeat(200)}` });
    expect(stats.cancelled).toBe(true);
    expect(stats.pulled).toBeLessThanOrEqual(CHUNK + CHUNK);
  });

  test('still reads a normal Rspamd answer', async () => {
    const result = await checkMessageWithRspamd({
      ...message,
      fetchImpl: async () => new Response(JSON.stringify({
        score: 7.5,
        action: 'add header',
        required_score: 6,
        symbols: { BAYES_SPAM: { score: 5.1 } },
      })),
    });

    expect(result).toEqual({ score: 7.5, action: 'add header', requiredScore: 6, symbols: ['BAYES_SPAM(5.10)'] });
  });
});
