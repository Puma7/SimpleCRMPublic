import {
  dispositionNotificationMatchesSender,
  extractDispositionNotificationEmail,
  senderEmailFromAddressJson,
} from '../../packages/core/src/email';
import { domainTrusted, parseDispositionNotificationTo } from '../../electron/email/email-read-receipt';

describe('parseDispositionNotificationTo', () => {
  test('parses simple header', () => {
    const raw = 'From: a@b.de\r\nDisposition-Notification-To: reader@corp.de\r\nSubject: Hi\r\n';
    expect(parseDispositionNotificationTo(raw)).toBe('reader@corp.de');
  });

  test('parses folded header values', () => {
    const raw = 'From: a@b.de\r\nDisposition-Notification-To: Reader\r\n <reader@corp.de>\r\nSubject: Hi\r\n';
    expect(parseDispositionNotificationTo(raw)).toBe('Reader <reader@corp.de>');
  });

  test('returns null when absent', () => {
    expect(parseDispositionNotificationTo('From: x@y.de\r\n')).toBeNull();
  });
});

describe('read receipt sender helpers', () => {
  test('matches trusted sender domains case-insensitively', () => {
    expect(domainTrusted(' example.com, corp.de ', 'CORP.de')).toBe(true);
    expect(domainTrusted('example.com', 'other.example.com')).toBe(false);
    expect(domainTrusted('', 'example.com')).toBe(false);
  });

  test('extracts MDN recipient and sender addresses for RFC 8098 guard', () => {
    const fromJson = JSON.stringify({ value: [{ address: 'Sender@Example.com' }] });

    expect(extractDispositionNotificationEmail('Sender <sender@example.com>')).toBe('sender@example.com');
    expect(senderEmailFromAddressJson(fromJson)).toBe('sender@example.com');
    expect(dispositionNotificationMatchesSender('Sender <sender@example.com>', fromJson)).toBe(true);
    expect(dispositionNotificationMatchesSender('other@example.com', fromJson)).toBe(false);
    expect(dispositionNotificationMatchesSender('invalid', fromJson)).toBe(false);
  });
});
