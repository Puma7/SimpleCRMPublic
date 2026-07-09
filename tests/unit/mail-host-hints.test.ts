import { guessSmtpHostFromImapHost } from '../../shared/mail-host-hints';
import {
  resolveConfiguredSmtpHost,
} from '../../packages/core/src/email/mail-host-hints';

describe('mail-host-hints', () => {
  test('guessSmtpHostFromImapHost maps common IMAP hosts to SMTP', () => {
    expect(guessSmtpHostFromImapHost('imap.ionos.de')).toBe('smtp.ionos.de');
    expect(guessSmtpHostFromImapHost('imap.example.com')).toBe('smtp.example.com');
    expect(guessSmtpHostFromImapHost('mail.example.com')).toBeNull();
    expect(guessSmtpHostFromImapHost('')).toBeNull();
  });

  test('resolveConfiguredSmtpHost returns trimmed host or null', () => {
    expect(resolveConfiguredSmtpHost(' smtp.ionos.de ')).toBe('smtp.ionos.de');
    expect(resolveConfiguredSmtpHost(null)).toBeNull();
    expect(resolveConfiguredSmtpHost('   ')).toBeNull();
  });
});
