import { hashPassword, verifyPassword } from '../../packages/core/src/auth';

describe('password-hash', () => {
  test('verify accepts correct passphrase', () => {
    const h = hashPassword('test-secret');
    expect(verifyPassword(h, 'test-secret')).toBe(true);
    expect(verifyPassword(h, 'wrong')).toBe(false);
  });
});
