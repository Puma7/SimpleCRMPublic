import {
  buildRfc822FromStored,
  extractEnvelopeSender,
} from '../../electron/email/mail-rfc822-build';

describe('buildRfc822FromStored', () => {
  it('joins headers and plain body', () => {
    const buf = buildRfc822FromStored({
      rawHeaders: 'From: a@b.com\nSubject: Hi',
      bodyText: 'Hello',
      bodyHtml: null,
    });
    expect(buf).not.toBeNull();
    const s = buf!.toString('utf8');
    expect(s).toContain('From: a@b.com');
    expect(s).toContain('\r\n\r\nHello');
  });

  it('returns null without headers', () => {
    expect(
      buildRfc822FromStored({ rawHeaders: null, bodyText: 'x', bodyHtml: null }),
    ).toBeNull();
  });

  it('prefers raw_rfc822_b64 over corrupt headers', () => {
    const original = 'From: x@y.z\r\n\r\nBody';
    const buf = buildRfc822FromStored({
      rawRfc822B64: Buffer.from(original).toString('base64'),
      rawHeaders: '[object Object]\n',
      bodyText: 'ignored',
      bodyHtml: null,
    });
    expect(buf!.toString('latin1')).toBe(original);
  });

  it('returns null for corrupt headers only', () => {
    expect(
      buildRfc822FromStored({
        rawHeaders: '[object Object]\n',
        bodyText: 'x',
        bodyHtml: null,
      }),
    ).toBeNull();
  });
});

describe('extractEnvelopeSender', () => {
  it('prefers Return-Path', () => {
    const from = extractEnvelopeSender(
      'Return-Path: <relay@simplelogin.co>\nFrom: user@shop.com',
    );
    expect(from).toBe('relay@simplelogin.co');
  });
});
