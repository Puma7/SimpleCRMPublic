import {
  checkLoginAllowed,
  recordLoginFailure,
  clearLoginFailures,
} from '../../electron/auth/login-guard';

describe('login-guard', () => {
  beforeEach(() => {
    clearLoginFailures('testuser');
  });

  it('locks after repeated failures', () => {
    for (let i = 0; i < 5; i++) recordLoginFailure('testuser');
    const r = checkLoginAllowed('testuser');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.waitMs).toBeGreaterThan(0);
  });

  it('clears lock after success path', () => {
    recordLoginFailure('testuser');
    clearLoginFailures('testuser');
    expect(checkLoginAllowed('testuser').ok).toBe(true);
  });
});
