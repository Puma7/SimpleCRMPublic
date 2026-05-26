jest.mock('mailauth', () => ({
  authenticate: jest.fn(),
}));

import { authenticate } from 'mailauth';
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

  test('isAuthFailure', () => {
    expect(isAuthFailure('fail')).toBe(true);
    expect(isAuthFailure('permerror')).toBe(true);
    expect(isAuthFailure('pass')).toBe(false);
  });

  test('parseAuthenticationResultsAdvisory', () => {
    const hdr =
      'Authentication-Results: mx.google.com;\r\n spf=pass dkim=pass dmarc=pass';
    expect(parseAuthenticationResultsAdvisory(hdr)).toContain('SPF=pass');
    expect(parseAuthenticationResultsAdvisory('From: a@b.de')).toBeNull();
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
    expect(parseAuthenticationResultsLabels(hdr)).toMatchObject({
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
      }),
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
    });
    expect(r.spf).toBe('pass');
    expect(r.dkim).toBe('pass');
    expect(r.dmarc).toBe('pass');
    expect(r.arc).toBe('none');
    expect(r.error).toMatch(/Authentication-Results des empfangenden Servers/);
  });
});
