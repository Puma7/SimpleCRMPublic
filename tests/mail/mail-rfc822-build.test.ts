import {
  buildRfc822FromStored,
  extractEnvelopeSender,
} from '../../electron/email/mail-rfc822-build';

describe('mail-rfc822-build', () => {
  test('buildRfc822FromStored prefers raw b64', () => {
    const raw = Buffer.from('From: a@b.de\r\n\r\nbody');
    const b64 = raw.toString('base64');
    expect(buildRfc822FromStored({ rawRfc822B64: b64, rawHeaders: null, bodyText: null, bodyHtml: null })?.toString()).toBe(
      raw.toString(),
    );
  });

  test('buildRfc822FromStored from headers and text or html', () => {
    expect(buildRfc822FromStored({ rawHeaders: null, bodyText: 'x', bodyHtml: null })).toBeNull();
    const fromText = buildRfc822FromStored({
      rawHeaders: 'Subject: Hi',
      bodyText: 'plain',
      bodyHtml: null,
    });
    expect(fromText?.toString('utf8')).toContain('plain');
    const fromHtml = buildRfc822FromStored({
      rawHeaders: 'Subject: Hi',
      bodyText: '',
      bodyHtml: '<p>html</p>',
    });
    expect(fromHtml?.toString('utf8')).toContain('<p>html</p>');
  });

  test('extractEnvelopeSender', () => {
    expect(extractEnvelopeSender(null)).toBeUndefined();
    expect(extractEnvelopeSender('Return-Path: <bounce@test.de>')).toBe('bounce@test.de');
    expect(extractEnvelopeSender('From: Name <from@test.de>')).toBe('from@test.de');
    expect(extractEnvelopeSender('From: plain@test.de')).toBe('plain@test.de');
    expect(extractEnvelopeSender('To: x@y.de')).toBeUndefined();
  });
});
