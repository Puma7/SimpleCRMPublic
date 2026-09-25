import {
  authservIdOfAuthenticationResults,
  defaultTrustedAuthservId,
  incomingMailHost,
  isTrustedAuthservId,
  normalizeTrustedAuthservIdSetting,
  resolveTrustedAuthservId,
  selectTrustedAuthenticationResults,
} from '../../packages/core/src/email/authentication-results';

// F-A5-12 (E6): RFC 8601 §5 trust rules shared by the server and the desktop.
describe('Authentication-Results trust (authserv-id)', () => {
  test('default authserv-id is the incoming server domain', () => {
    expect(defaultTrustedAuthservId('imap.example.com')).toBe('example.com');
    expect(defaultTrustedAuthservId(' IMAP.Mail.Example.COM. ')).toBe('mail.example.com');
    expect(defaultTrustedAuthservId('example.com')).toBe('example.com');
    expect(defaultTrustedAuthservId('mailserver')).toBe('mailserver');
    expect(defaultTrustedAuthservId('imap.example.co.uk')).toBe('example.co.uk');
    expect(defaultTrustedAuthservId('example.co.uk')).toBe('example.co.uk');
    expect(defaultTrustedAuthservId('mail.firma.com.au')).toBe('firma.com.au');
    expect(defaultTrustedAuthservId('192.0.2.10')).toBe('192.0.2.10');
    expect(defaultTrustedAuthservId('[2001:db8::1]')).toBe('2001:db8::1');
    expect(defaultTrustedAuthservId('')).toBeNull();
    expect(defaultTrustedAuthservId(null)).toBeNull();
  });

  test('POP3 accounts use the POP3 host, falling back to the IMAP host', () => {
    expect(incomingMailHost({ protocol: 'imap', imapHost: 'imap.a.example', pop3Host: 'pop.b.example' })).toBe('imap.a.example');
    expect(incomingMailHost({ protocol: 'pop3', imapHost: 'imap.a.example', pop3Host: 'pop.b.example' })).toBe('pop.b.example');
    expect(incomingMailHost({ protocol: 'pop3', imapHost: 'imap.a.example', pop3Host: ' ' })).toBe('imap.a.example');
  });

  test('a configured value replaces the default and is validated', () => {
    expect(resolveTrustedAuthservId({ configured: 'MX.Google.com', incomingHost: 'imap.gmail.com' })).toBe('mx.google.com');
    expect(resolveTrustedAuthservId({ configured: '  ', incomingHost: 'imap.gmail.com' })).toBe('gmail.com');
    expect(resolveTrustedAuthservId({ configured: null, incomingHost: null })).toBeNull();
    expect(normalizeTrustedAuthservIdSetting(' mx.example.com. ')).toEqual({ ok: true, value: 'mx.example.com' });
    expect(normalizeTrustedAuthservIdSetting('')).toEqual({ ok: true, value: null });
    expect(normalizeTrustedAuthservIdSetting('evil.example; spf=pass').ok).toBe(false);
    expect(normalizeTrustedAuthservIdSetting('a b').ok).toBe(false);
  });

  test('authserv-id parsing follows RFC 8601', () => {
    expect(authservIdOfAuthenticationResults('mx.google.com; spf=pass')).toBe('mx.google.com');
    expect(authservIdOfAuthenticationResults('MX.Example.com 1; dkim=pass')).toBe('mx.example.com');
    expect(authservIdOfAuthenticationResults('"mx.example.com"; dkim=pass')).toBe('mx.example.com');
    expect(authservIdOfAuthenticationResults('(filter) mx.example.com; dkim=pass')).toBe('mx.example.com');
    expect(authservIdOfAuthenticationResults('spf=pass (sender IP is 192.0.2.1) smtp.mailfrom=x.example')).toBeNull();
    expect(authservIdOfAuthenticationResults('')).toBeNull();
  });

  test('an authserv-id matches the trusted value or a subdomain of it', () => {
    expect(isTrustedAuthservId('example.com', 'example.com')).toBe(true);
    expect(isTrustedAuthservId('mx01.example.com', 'example.com')).toBe(true);
    expect(isTrustedAuthservId('evilexample.com', 'example.com')).toBe(false);
    expect(isTrustedAuthservId('example.com.evil.test', 'example.com')).toBe(false);
    expect(isTrustedAuthservId(null, 'example.com')).toBe(false);
    expect(isTrustedAuthservId('example.com', null)).toBe(false);
  });

  test('selects the topmost trusted field and ignores ARC and untrusted fields', () => {
    const headers = [
      'ARC-Authentication-Results: i=1; mx.example.com; spf=pass',
      'Authentication-Results: filter.local; dkim=none',
      'Authentication-Results: mx.example.com;',
      '\tspf=fail smtp.mailfrom=x.example',
      'Authentication-Results: example.com; spf=pass',
      'Subject: x',
    ].join('\r\n');
    expect(selectTrustedAuthenticationResults(headers, 'example.com')).toBe('mx.example.com; spf=fail smtp.mailfrom=x.example');
    expect(selectTrustedAuthenticationResults(headers, 'other.example')).toBeNull();
    expect(selectTrustedAuthenticationResults(headers, null)).toBeNull();
    expect(selectTrustedAuthenticationResults(null, 'example.com')).toBeNull();
  });
});
