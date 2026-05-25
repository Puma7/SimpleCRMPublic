jest.mock('mailauth', () => ({
  authenticate: jest.fn(),
}));

import { authenticate } from 'mailauth';
import { verifyMailAuthentication, isAuthFailure } from '../../electron/email/mail-auth-verify';

const authenticateMock = authenticate as jest.MockedFunction<typeof authenticate>;

describe('verifyMailAuthentication', () => {
  beforeEach(() => {
    authenticateMock.mockReset();
  });

  it('maps mailauth results to labels', async () => {
    authenticateMock.mockResolvedValue({
      spf: { status: { result: 'pass' } },
      dkim: {
        headerFrom: ['shop.com'],
        results: [{ signingDomain: 'shop.com', status: { result: 'pass' }, info: '' }],
      },
      dmarc: { status: { result: 'pass' } },
      arc: { status: { result: 'pass' } },
    } as never);

    const r = await verifyMailAuthentication({
      rawHeaders: 'From: a@shop.com\nReturn-Path: <a@shop.com>',
      bodyText: 'body',
      bodyHtml: null,
    });
    expect(r.spf).toBe('pass');
    expect(r.dkim).toBe('pass');
    expect(r.dmarc).toBe('pass');
    expect(r.arc).toBe('pass');
    expect(authenticateMock).toHaveBeenCalled();
  });

  it('returns none without headers', async () => {
    const r = await verifyMailAuthentication({
      rawHeaders: null,
      bodyText: null,
      bodyHtml: null,
    });
    expect(r.spf).toBe('none');
    expect(authenticateMock).not.toHaveBeenCalled();
  });
});

describe('isAuthFailure', () => {
  it('treats fail and permerror as failure', () => {
    expect(isAuthFailure('fail')).toBe(true);
    expect(isAuthFailure('pass')).toBe(false);
  });
});
