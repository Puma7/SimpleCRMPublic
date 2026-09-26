jest.mock('mailauth', () => ({
  authenticate: jest.fn(),
}));

import { authenticate } from 'mailauth';
import { simpleParser } from 'mailparser';
import { incomingMailHost, resolveTrustedAuthservId } from '@simplecrm/core';
import { rawHeadersFromParsed } from '../../electron/email/email-parse-utils';
import { rfc822SourceToStorageB64 } from '../../electron/email/mail-eml-build';
import {
  isAuthFailure,
  parseAuthenticationResultsAdvisory,
  parseAuthenticationResultsLabels,
  resolveHeaderTextForMailAuth,
  verifyMailAuthentication,
} from '../../electron/email/mail-auth-verify';

describe('mail-auth-verify', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns error when no message can be built', async () => {
    const r = await verifyMailAuthentication({
      rawHeaders: null,
      bodyText: null,
      bodyHtml: null,
    });
    expect(r.error).toContain('Keine RFC822-Header');
    expect(r.spf).toBe('none');
  });

  test('maps mailauth results', async () => {
    (authenticate as jest.Mock).mockResolvedValue({
      spf: { status: { result: 'pass' } },
      dkim: {
        results: [
          { status: { result: 'pass' }, signingDomain: 'example.com' },
          { status: { result: 'fail' }, signingDomain: 'other.com' },
        ],
      },
      dmarc: { status: { result: 'fail' } },
      arc: { status: { result: 'temperr' } },
    });
    const r = await verifyMailAuthentication({
      rawHeaders: 'Return-Path: <bounce@test.de>\r\nFrom: a@b.de',
      bodyText: 'hello',
      bodyHtml: null,
    });
    expect(r.spf).toBe('pass');
    expect(r.dkim).toBe('pass');
    expect(r.dmarc).toBe('fail');
    expect(r.arc).toBe('temperror');
    expect(r.dkimDomains).toContain('example.com');
  });

  test('aggregate dkim fail-only and missing results', async () => {
    (authenticate as jest.Mock).mockResolvedValueOnce({
      spf: 'none',
      dkim: { results: [{ status: { result: 'permerror' }, signingDomain: 'bad.com' }] },
      dmarc: null,
      arc: null,
    });
    expect((await verifyMailAuthentication({ rawHeaders: 'From: a@b.de', bodyText: 'x', bodyHtml: null })).dkim).toBe(
      'fail',
    );

    (authenticate as jest.Mock).mockResolvedValueOnce({ spf: null, dkim: undefined, dmarc: null, arc: null });
    const none = await verifyMailAuthentication({ rawHeaders: 'From: a@b.de', bodyText: 'x', bodyHtml: null });
    expect(none.dkim).toBe('none');
    expect(none.spf).toBe('none');
  });

  test('handles authenticate errors', async () => {
    (authenticate as jest.Mock).mockRejectedValue(new Error('dns fail'));
    const r = await verifyMailAuthentication({
      rawHeaders: 'From: a@b.de',
      bodyText: 'x',
      bodyHtml: null,
    });
    expect(r.error).toBe('dns fail');
    expect(r.spf).toBe('unknown');
  });

  test('returns a bounded error when mailauth never settles', async () => {
    (authenticate as jest.Mock).mockImplementation(() => new Promise(() => undefined));
    const r = await verifyMailAuthentication({
      rawHeaders: 'From: a@b.de',
      bodyText: 'x',
      bodyHtml: null,
      timeoutMs: 5,
    });
    expect(r.error).toBe('Mailauth Timeout');
    expect(r.spf).toBe('unknown');
  });

  test('isAuthFailure', () => {
    expect(isAuthFailure('fail')).toBe(true);
    expect(isAuthFailure('permerror')).toBe(true);
    expect(isAuthFailure('pass')).toBe(false);
  });

  // Seit F-A5-12 (E6) zaehlen nur Header mit vertrauenswuerdiger authserv-id; die
  // folgenden Tests nennen deshalb die des Gmail-Empfangsservers ausdruecklich.
  test('parseAuthenticationResultsAdvisory', () => {
    const hdr =
      'Authentication-Results: mx.google.com;\r\n spf=pass dkim=pass dmarc=pass';
    expect(parseAuthenticationResultsAdvisory(hdr, 'mx.google.com')).toContain('SPF=pass');
    expect(parseAuthenticationResultsAdvisory('From: a@b.de', 'mx.google.com')).toBeNull();
  });

  test('falls back to Authentication-Results when live DNS returns temperror', async () => {
    (authenticate as jest.Mock).mockResolvedValue({
      spf: { status: { result: 'temperror' } },
      dkim: { results: [{ status: { result: 'temperror' }, signingDomain: 'gmail.com' }] },
      dmarc: { status: { result: 'temperror' } },
      arc: { status: { result: 'fail' } },
    });
    const hdr =
      'Return-Path: <a@gmail.com>\r\n' +
      'Authentication-Results: mx.google.com;\r\n spf=pass smtp.mailfrom=gmail.com; dkim=pass header.d=gmail.com; dmarc=pass';
    const r = await verifyMailAuthentication({
      rawHeaders: hdr,
      bodyText: 'hi',
      bodyHtml: null,
      trustedAuthservId: 'google.com',
    });
    expect(r.spf).toBe('pass');
    expect(r.dkim).toBe('pass');
    expect(r.dmarc).toBe('pass');
    expect(r.arc).toBe('none');
    expect(r.error).toMatch(/Authentication-Results/);
  });

  test('parseAuthenticationResultsLabels', () => {
    const hdr =
      'Authentication-Results: mx.google.com;\r\n spf=pass dkim=pass dmarc=pass';
    expect(parseAuthenticationResultsLabels(hdr, 'mx.google.com')).toMatchObject({
      spf: 'pass',
      dkim: 'pass',
      dmarc: 'pass',
    });
  });

  test('uses Authentication-Results from raw_rfc822_b64 when raw_headers omit it', async () => {
    const authHdr =
      'Authentication-Results: mx.google.com;\r\n spf=pass dkim=pass dmarc=pass';
    const rfc822 =
      `From: sender@gmail.com\r\n${authHdr}\r\nSubject: Test\r\n\r\nBody`;
    const rawRfc822B64 = Buffer.from(rfc822, 'utf8').toString('base64');

    expect(
      resolveHeaderTextForMailAuth({
        rawHeaders: 'From: sender@gmail.com\r\nSubject: Test',
        rawRfc822B64,
      }, 'mx.google.com'),
    ).toContain('spf=pass');

    (authenticate as jest.Mock).mockResolvedValue({
      spf: { status: { result: 'temperror' } },
      dkim: { results: [{ status: { result: 'temperror' }, signingDomain: 'gmail.com' }] },
      dmarc: { status: { result: 'temperror' } },
      arc: { status: { result: 'fail' } },
    });
    const r = await verifyMailAuthentication({
      rawRfc822B64,
      rawHeaders: 'From: sender@gmail.com\r\nSubject: Test',
      bodyText: 'Body',
      bodyHtml: null,
      trustedAuthservId: 'mx.google.com',
    });
    expect(r.spf).toBe('pass');
    expect(r.dkim).toBe('pass');
    expect(r.dmarc).toBe('pass');
    expect(r.arc).toBe('none');
    expect(r.error).toMatch(/Authentication-Results des empfangenden Servers/);
  });

  // F-A5-12 (E6): Der Desktop uebernahm SPF/DKIM/DMARC aus jedem (ARC-)Authentication-Results-Header, auch aus einem vom Absender eingeschleusten.
  describe('authserv-id (RFC 8601 section 5)', () => {
    const liveUnavailable = () =>
      (authenticate as jest.Mock).mockRejectedValue(new Error('DNS nicht erreichbar'));

    test('ignores a sender-injected field when the trusted server added none', async () => {
      liveUnavailable();
      const r = await verifyMailAuthentication({
        rawHeaders:
          'Authentication-Results: evil.example; spf=pass; dkim=pass; dmarc=pass\r\nFrom: chef@kunde.de',
        bodyText: 'x',
        bodyHtml: null,
        trustedAuthservId: 'provider.example',
      });
      expect(r).toMatchObject({ spf: 'unknown', dkim: 'unknown', dmarc: 'unknown' });
    });

    test('ignores ARC-Authentication-Results and lower fields, keeps the topmost trusted one', async () => {
      liveUnavailable();
      const r = await verifyMailAuthentication({
        rawHeaders: [
          'ARC-Authentication-Results: i=1; mx.provider.example; spf=pass; dkim=pass; dmarc=pass',
          'Authentication-Results: mx.provider.example; spf=fail smtp.mailfrom=kunde.de',
          'Authentication-Results: provider.example; spf=pass; dkim=pass; dmarc=pass',
          'From: chef@kunde.de',
        ].join('\r\n'),
        bodyText: 'x',
        bodyHtml: null,
        trustedAuthservId: 'provider.example',
      });
      expect(r).toMatchObject({ spf: 'fail', dkim: 'unknown', dmarc: 'unknown' });
    });

    test('uses no header without a trusted authserv-id', () => {
      const hdr = 'Authentication-Results: mx.google.com;\r\n spf=pass dkim=pass dmarc=pass';
      expect(parseAuthenticationResultsLabels(hdr)).toBeNull();
      expect(parseAuthenticationResultsLabels(hdr, 'provider.example')).toBeNull();
      expect(parseAuthenticationResultsAdvisory(hdr, 'provider.example')).toBeNull();
    });
  });

  // C-A75: Setzte der Provider eine abweichende authserv-id (Gmail: mx.google.com statt gmail.com), wurde ein tieferes, vom Absender eingeschleustes Feld mit der Standard-id gewaehlt.
  describe('real mail parsed like the IMAP sync: only the topmost field counts (G8)', () => {
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

    async function verifyParsed(stored: 'rawHeaders' | 'rawRfc822', trustedAuthservId: string | null) {
      const source = Buffer.from(rawMail);
      const parsed = await simpleParser(source);
      (authenticate as jest.Mock).mockRejectedValue(new Error('Mailauth Timeout'));
      return verifyMailAuthentication({
        rawRfc822B64: stored === 'rawRfc822' ? rfc822SourceToStorageB64(source) : null,
        rawHeaders: stored === 'rawHeaders' ? rawHeadersFromParsed(parsed) : null,
        bodyText: parsed.text ?? null,
        bodyHtml: null,
        trustedAuthservId,
      });
    }

    test.each(['rawHeaders', 'rawRfc822'] as const)(
      'a spoofed lower field with the default authserv-id does not replace a failed live check (%s)',
      async (stored) => {
        const trusted = resolveTrustedAuthservId({
          incomingHost: incomingMailHost({ protocol: 'imap', imapHost: 'imap.gmail.com' }),
        });
        expect(trusted).toBe('gmail.com');

        const r = await verifyParsed(stored, trusted);

        expect(r).toMatchObject({ spf: 'unknown', dkim: 'unknown', dmarc: 'unknown' });
      },
    );

    test.each(['rawHeaders', 'rawRfc822'] as const)(
      'the topmost field is the one the receiving server prepended (%s)',
      async (stored) => {
        const r = await verifyParsed(stored, 'mx.google.com');

        expect(r).toMatchObject({ spf: 'fail', dkim: 'unknown', dmarc: 'fail' });
      },
    );
  });
});
