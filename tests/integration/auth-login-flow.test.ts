import {
  checkLoginAllowed,
  recordLoginFailure,
  clearLoginFailures,
  reloadLoginFailuresFromDb,
} from '../../electron/auth/login-guard';
import { hashPassword, verifyPassword } from '../../packages/core/src/auth';

describe('auth login flow (unit slice)', () => {
  it('password hash roundtrip', () => {
    const hash = hashPassword('test-passphrase-12');
    expect(verifyPassword(hash, 'test-passphrase-12')).toBe(true);
    expect(verifyPassword(hash, 'wrong')).toBe(false);
  });

  it('brute-force guard integrates with login policy', () => {
    clearLoginFailures('alice');
    reloadLoginFailuresFromDb();
    expect(checkLoginAllowed('alice').ok).toBe(true);
    for (let i = 0; i < 5; i++) recordLoginFailure('alice');
    expect(checkLoginAllowed('alice').ok).toBe(false);
    clearLoginFailures('alice');
    reloadLoginFailuresFromDb();
    expect(checkLoginAllowed('alice').ok).toBe(true);
  });
});
