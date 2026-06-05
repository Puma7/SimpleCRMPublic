import {
  dispositionNotificationMatchesSender,
  domainTrusted,
  extractDispositionNotificationEmail,
  parseDispositionNotificationTo,
  senderEmailFromAddressJson,
} from '../../packages/core/src/email';

describe('core email read receipt helpers', () => {
  test('parses simple and folded Disposition-Notification-To headers', () => {
    expect(parseDispositionNotificationTo(
      'From: a@b.de\r\nDisposition-Notification-To: reader@corp.de\r\nSubject: Hi\r\n',
    )).toBe('reader@corp.de');

    expect(parseDispositionNotificationTo(
      'From: a@b.de\r\nDisposition-Notification-To: Reader\r\n <reader@corp.de>\r\nSubject: Hi\r\n',
    )).toBe('Reader <reader@corp.de>');

    expect(parseDispositionNotificationTo('From: x@y.de\r\n')).toBeNull();
  });

  test('evaluates trusted sender domains case-insensitively', () => {
    expect(domainTrusted(' example.com, corp.de ', 'CORP.de')).toBe(true);
    expect(domainTrusted('example.com', 'other.example.com')).toBe(false);
    expect(domainTrusted('', 'example.com')).toBe(false);
  });

  test('extracts MDN recipient and sender addresses for the sender-match guard', () => {
    const fromJson = JSON.stringify({ value: [{ address: 'Sender@Example.com' }] });

    expect(extractDispositionNotificationEmail('Sender <sender@example.com>')).toBe('sender@example.com');
    expect(senderEmailFromAddressJson(fromJson)).toBe('sender@example.com');
    expect(dispositionNotificationMatchesSender('Sender <sender@example.com>', fromJson)).toBe(true);
    expect(dispositionNotificationMatchesSender('other@example.com', fromJson)).toBe(false);
    expect(dispositionNotificationMatchesSender('invalid', fromJson)).toBe(false);
  });
});
