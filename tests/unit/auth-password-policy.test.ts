import {
  getPasswordTooShortMessage,
  isPasswordLengthValid,
  MIN_PASSWORD_LENGTH,
} from '@shared/auth-password-policy';

describe('auth password policy', () => {
  test('requires at least 12 characters', () => {
    expect(MIN_PASSWORD_LENGTH).toBe(12);
    expect(isPasswordLengthValid('a'.repeat(11))).toBe(false);
    expect(isPasswordLengthValid('a'.repeat(12))).toBe(true);
  });

  test('exposes a German minimum-length message', () => {
    expect(getPasswordTooShortMessage()).toBe('Passwort muss mindestens 12 Zeichen haben');
  });
});
