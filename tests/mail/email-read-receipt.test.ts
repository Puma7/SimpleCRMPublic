import { parseDispositionNotificationTo } from '../../electron/email/email-read-receipt';

describe('parseDispositionNotificationTo', () => {
  test('parses simple header', () => {
    const raw = 'From: a@b.de\r\nDisposition-Notification-To: reader@corp.de\r\nSubject: Hi\r\n';
    expect(parseDispositionNotificationTo(raw)).toBe('reader@corp.de');
  });

  test('returns null when absent', () => {
    expect(parseDispositionNotificationTo('From: x@y.de\r\n')).toBeNull();
  });
});
