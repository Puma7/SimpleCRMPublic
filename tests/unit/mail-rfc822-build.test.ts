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
});

describe('extractEnvelopeSender', () => {
  it('prefers Return-Path', () => {
    const from = extractEnvelopeSender(
      'Return-Path: <relay@simplelogin.co>\nFrom: user@shop.com',
    );
    expect(from).toBe('relay@simplelogin.co');
  });
});
