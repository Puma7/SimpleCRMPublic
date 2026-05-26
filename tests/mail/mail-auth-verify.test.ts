jest.mock('mailauth', () => ({
  authenticate: jest.fn(),
}));

import { authenticate } from 'mailauth';
import {
  isAuthFailure,
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
});
