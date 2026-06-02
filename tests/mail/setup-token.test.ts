const store: Record<string, string> = {};

jest.mock('../../electron/sqlite-service', () => ({
  getSyncInfo: (key: string) => store[key] ?? null,
  setSyncInfo: (key: string, value: string) => {
    store[key] = value;
  },
  deleteSyncInfo: (key: string) => {
    delete store[key];
  },
}));

import {
  SETUP_TOKEN_SYNC_KEY,
  consumeOneTimeSetupToken,
  hasActiveOneTimeSetupToken,
  setStoredOneTimeSetupToken,
  validateOneTimeSetupToken,
} from '../../electron/auth/setup-token';

describe('setup-token', () => {
  beforeEach(() => {
    for (const k of Object.keys(store)) delete store[k];
  });

  it('stores token with expiry and validates once', () => {
    setStoredOneTimeSetupToken('secret-token');
    expect(hasActiveOneTimeSetupToken()).toBe(true);
    expect(validateOneTimeSetupToken('secret-token')).toBe(true);
    expect(validateOneTimeSetupToken('wrong')).toBe(false);
  });

  it('consume removes token', () => {
    setStoredOneTimeSetupToken('once');
    expect(consumeOneTimeSetupToken()).toBe('once');
    expect(store[SETUP_TOKEN_SYNC_KEY]).toBeUndefined();
    expect(hasActiveOneTimeSetupToken()).toBe(false);
  });

  it('rejects expired token', () => {
    store[SETUP_TOKEN_SYNC_KEY] = JSON.stringify({
      v: 1,
      token: 'old',
      expiresAt: Date.now() - 1000,
    });
    expect(hasActiveOneTimeSetupToken()).toBe(false);
    expect(validateOneTimeSetupToken('old')).toBe(false);
  });
});
