import { DEFAULT_AUTH_SECURITY_WORKSPACE_SETTINGS } from '@simplecrm/core';

jest.mock('../../packages/server/src/mail-smtp-send', () => ({
  sendSmtpMessage: jest.fn().mockRejectedValue(new Error('smtp down')),
}));

import { createLoginSecurityService } from '../../packages/server/src/auth/login-security-service';
import type { AuthChallengeStore } from '../../packages/server/src/security/auth-challenge-store';
import {
  issueCaptchaChallenge,
  verifyCaptchaChallenge,
} from '../../packages/server/src/security/captcha-challenge';
import { issueMfaChallengeToken } from '../../packages/server/src/security/mfa-challenge';
import { hashLoginPin, verifyLoginPin } from '../../packages/server/src/security/login-pin-hash';
import { generateTotpSecret, verifyTotpCode } from '../../packages/server/src/security/totp';
import { generateSync } from 'otplib';

const signer = {
  keyId: 'test',
  secret: Buffer.from('test-secret-test-secret-test-secret!!'),
};

const TEST_USER_ID = '22222222-2222-4222-8222-222222222222';
const TEST_WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';

const mfaUser = {
  id: TEST_USER_ID,
  workspaceId: TEST_WORKSPACE_ID,
  email: 'user@example.com',
  displayName: 'User',
  role: 'user' as const,
  passwordHash: 'hash',
  disabledAt: null,
  loginPinEnabled: false,
  mfaEnabled: true,
  mfaMethod: 'email' as const,
};

describe('login security helpers', () => {
  test('captcha challenge roundtrip', () => {
    const issuedAt = new Date('2026-01-01T12:00:00.000Z');
    const challenge = issueCaptchaChallenge({
      signer,
      ip: '127.0.0.1',
      issuedAt,
    });
    expect(verifyCaptchaChallenge({
      token: challenge,
      signer,
      ip: '127.0.0.1',
      now: issuedAt,
    })).toBe(true);
    expect(verifyCaptchaChallenge({
      token: challenge,
      signer,
      ip: '9.9.9.9',
      now: issuedAt,
    })).toBe(false);
  });

  test('login pin hash roundtrip', async () => {
    const hash = await hashLoginPin('123456');
    expect(await verifyLoginPin('123456', hash)).toBe(true);
    expect(await verifyLoginPin('654321', hash)).toBe(false);
  });

  test('totp secret verifies generated code', () => {
    const secret = generateTotpSecret();
    const token = generateSync({ secret });
    expect(verifyTotpCode(secret, token)).toBe(true);
  });
});

describe('login security public configuration', () => {
  test('uses one aggregate settings read without loading each workspace separately', async () => {
    const listPublicWorkspaceSettings = jest.fn(async () => ([
      {
        ...DEFAULT_AUTH_SECURITY_WORKSPACE_SETTINGS,
        captchaEnabled: true,
        mfaEnabled: true,
      },
      {
        ...DEFAULT_AUTH_SECURITY_WORKSPACE_SETTINGS,
        pinKeypadEnabled: true,
        mfaEnabled: true,
        mfaEmailEnabled: true,
      },
    ]));
    const selectFrom = jest.fn(() => {
      throw new Error('getLoginConfig must not enumerate workspaces');
    });
    const getMany = jest.fn(async () => {
      throw new Error('getLoginConfig must not load workspace settings one by one');
    });
    const service = createLoginSecurityService({
      db: { selectFrom } as never,
      syncInfo: { getMany, setMany: async () => undefined },
      listPublicWorkspaceSettings,
      secrets: {
        readSecret: async () => null,
        writeSecret: async () => undefined,
        deleteSecret: async () => undefined,
      } as never,
      auth: { findUserByEmail: async () => null } as never,
      accessTokenSigner: signer,
      config: {
        turnstileSiteKey: 'site-key',
        turnstileSecretKey: 'secret-key',
      },
      authInvitationSmtp: {} as never,
      challengeStore: createSharedChallengeStore(),
    });

    await expect(service.getLoginConfig()).resolves.toEqual({
      captcha: { enabled: true, provider: 'turnstile', siteKey: 'site-key' },
      pinKeypad: { enabled: true },
      mfa: { enabled: true, methods: ['totp', 'email'] },
      user: null,
    });
    expect(listPublicWorkspaceSettings).toHaveBeenCalledTimes(1);
    expect(selectFrom).not.toHaveBeenCalled();
    expect(getMany).not.toHaveBeenCalled();
  });
});

describe('login security service MFA gate', () => {
  let challengeStore: AuthChallengeStore;

  beforeEach(() => {
    challengeStore = createSharedChallengeStore();
  });

  function createService(overrides: {
    smtp?: unknown;
    db?: { insertInto: () => unknown };
    challengeStore?: AuthChallengeStore;
  } = {}) {
    const db = overrides.db ?? {
      insertInto: () => ({
        values: () => ({
          returning: () => ({
            executeTakeFirst: async () => ({ id: 1 }),
          }),
          execute: async () => undefined,
        }),
      }),
      updateTable: () => {
        const chain: Record<string, unknown> = {};
        chain.set = () => chain;
        chain.where = () => chain;
        chain.execute = async () => undefined;
        return chain;
      },
      deleteFrom: () => ({
        where: () => ({
          execute: async () => undefined,
        }),
      }),
    };

    return createLoginSecurityService({
      db: db as never,
      syncInfo: {
        getMany: async () => ({}),
        setMany: async () => undefined,
      },
      listPublicWorkspaceSettings: async () => [DEFAULT_AUTH_SECURITY_WORKSPACE_SETTINGS],
      secrets: {
        readSecret: async () => null,
        writeSecret: async () => undefined,
        deleteSecret: async () => undefined,
      },
      auth: {
        findUserByEmail: async () => null,
      },
      accessTokenSigner: signer,
      config: {},
      challengeStore: overrides.challengeStore ?? challengeStore,
      authInvitationSmtp: overrides.smtp as never,
      now: () => new Date('2026-01-01T12:00:00.000Z'),
    });
  }

  test('skips MFA when workspace MFA is disabled', async () => {
    const service = createService();
    await expect(service.beginMfaIfRequired({
      user: mfaUser,
      workspaceSettings: {
        ...DEFAULT_AUTH_SECURITY_WORKSPACE_SETTINGS,
        mfaEnabled: false,
        mfaEmailEnabled: true,
      },
    })).resolves.toEqual({ kind: 'complete' });
  });

  test('accepts a CAPTCHA challenge only once across service instances', async () => {
    const firstReplica = createService();
    const secondReplica = createService();
    const challenge = issueCaptchaChallenge({
      signer,
      ip: '127.0.0.1',
      issuedAt: new Date('2026-01-01T12:00:00.000Z'),
    });
    await expect(firstReplica.assertCaptchaChallenge({ challenge, ip: '127.0.0.1' })).resolves.toBe(true);
    await expect(secondReplica.assertCaptchaChallenge({ challenge, ip: '127.0.0.1' })).resolves.toBe(false);
  });

  test('fails closed when an enrolled MFA method is no longer available', async () => {
    const service = createService();
    await expect(service.beginMfaIfRequired({
      user: mfaUser,
      workspaceSettings: {
        ...DEFAULT_AUTH_SECURITY_WORKSPACE_SETTINGS,
        mfaEnabled: true,
        mfaEmailEnabled: true,
      },
    })).resolves.toEqual({ kind: 'mfa_delivery_failed' });
  });

  test('limits MFA code guesses per challenge even when the IP changes', async () => {
    const secret = generateTotpSecret();
    const validCode = generateSync({ secret });
    const invalidCode = validCode === '000000' ? '000001' : '000000';
    const user = { ...mfaUser, mfaMethod: 'totp' as const };
    const recordSuccessfulLogin = jest.fn(async () => undefined);
    const issueTokenPair = jest.fn(async () => ({
      accessToken: 'access',
      refreshToken: 'refresh',
      expiresInSeconds: 3600,
    }));
    const workspaceDb = createWorkspaceLookupDb(user.email);
    const service = createLoginSecurityService({
      db: workspaceDb.db as never,
      syncInfo: { getMany: async () => [], setMany: async () => undefined },
      listPublicWorkspaceSettings: async () => [DEFAULT_AUTH_SECURITY_WORKSPACE_SETTINGS],
      secrets: {
        readSecret: async () => Buffer.from(secret),
        writeSecret: async () => ({ id: 'secret-id' }),
        deleteSecret: async () => undefined,
      } as never,
      auth: {
        findUserByEmail: async () => user,
        recordSuccessfulLogin,
        issueTokenPair,
      } as never,
      accessTokenSigner: signer,
      config: {},
      challengeStore,
      applyWorkspaceSession: workspaceDb.applyWorkspaceSession,
      now: () => new Date('2026-01-01T12:00:00.000Z'),
    });
    const challenge = issueMfaChallengeToken({
      signer,
      userId: user.id,
      workspaceId: user.workspaceId,
      method: 'totp',
      issuedAt: new Date('2026-01-01T12:00:00.000Z'),
    });

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(service.completeMfaLogin({
        mfaChallengeToken: challenge,
        code: invalidCode,
        ip: `192.0.2.${attempt + 1}`,
      })).resolves.toEqual({ ok: false, code: 'mfa_code_invalid' });
    }
    await expect(service.completeMfaLogin({
      mfaChallengeToken: challenge,
      code: validCode,
      ip: '198.51.100.1',
    })).resolves.toEqual({ ok: false, code: 'mfa_attempts_exceeded' });
    expect(issueTokenPair).not.toHaveBeenCalled();
  });

  test('feeds MFA failures into the login lockout without blocking the current challenge retry', async () => {
    const secret = generateTotpSecret();
    const validCode = generateSync({ secret });
    const invalidCode = validCode === '000000' ? '000001' : '000000';
    const user = { ...mfaUser, mfaMethod: 'totp' as const };
    let locked = false;
    const recordFailedLogin = jest.fn(async () => {
      locked = true;
      return 1;
    });
    const checkLoginLock = jest.fn(async () => (locked ? { kind: 'permanent' as const } : { kind: 'none' as const }));
    const recordSuccessfulLogin = jest.fn(async () => undefined);
    const issueTokenPair = jest.fn(async () => ({
      accessToken: 'access',
      refreshToken: 'refresh',
      expiresInSeconds: 3600,
    }));
    const workspaceDb = createWorkspaceLookupDb(user.email);
    const service = createLoginSecurityService({
      db: workspaceDb.db as never,
      syncInfo: { getMany: async () => [], setMany: async () => undefined },
      listPublicWorkspaceSettings: async () => [DEFAULT_AUTH_SECURITY_WORKSPACE_SETTINGS],
      secrets: {
        readSecret: async () => Buffer.from(secret),
        writeSecret: async () => ({ id: 'secret-id' }),
        deleteSecret: async () => undefined,
      } as never,
      auth: {
        findUserByEmail: async () => user,
        recordSuccessfulLogin,
        recordFailedLogin,
        checkLoginLock,
        issueTokenPair,
      } as never,
      accessTokenSigner: signer,
      config: {},
      challengeStore,
      applyWorkspaceSession: workspaceDb.applyWorkspaceSession,
      now: () => new Date('2026-01-01T12:00:00.000Z'),
    });
    const challenge = issueMfaChallengeToken({
      signer,
      userId: user.id,
      workspaceId: user.workspaceId,
      method: 'totp',
      issuedAt: new Date('2026-01-01T12:00:00.000Z'),
    });

    // A wrong code records a failed-login against the (email,ip) lockout —
    // this is what eventually locks the /login step and starves the attacker
    // of fresh challenge tokens.
    await expect(service.completeMfaLogin({
      mfaChallengeToken: challenge,
      code: invalidCode,
      ip: '203.0.113.7',
    })).resolves.toEqual({ ok: false, code: 'mfa_code_invalid' });
    expect(recordFailedLogin).toHaveBeenCalledWith(
      expect.objectContaining({ email: user.email, ip: '203.0.113.7' }),
    );

    // The login endpoint is now throttled and cannot mint fresh challenges,
    // but this challenge still owns its five-attempt budget. A corrected code
    // must succeed and clear the login failure.
    await expect(service.completeMfaLogin({
      mfaChallengeToken: challenge,
      code: validCode,
      ip: '203.0.113.7',
    })).resolves.toMatchObject({ ok: true });
    expect(checkLoginLock).not.toHaveBeenCalled();
    expect(recordSuccessfulLogin).toHaveBeenCalledWith({
      userId: user.id,
      email: user.email,
      ip: '203.0.113.7',
    });
  });

  test('accepts a valid MFA code after one failed attempt and rejects replay', async () => {
    const secret = generateTotpSecret();
    const validCode = generateSync({ secret });
    const invalidCode = validCode === '000000' ? '000001' : '000000';
    const user = { ...mfaUser, mfaMethod: 'totp' as const };
    const issueTokenPair = jest.fn(async () => ({
      accessToken: 'access',
      refreshToken: 'refresh',
      expiresInSeconds: 3600,
    }));
    const workspaceDb = createWorkspaceLookupDb(user.email);
    const service = createLoginSecurityService({
      db: workspaceDb.db as never,
      syncInfo: { getMany: async () => [], setMany: async () => undefined },
      listPublicWorkspaceSettings: async () => [DEFAULT_AUTH_SECURITY_WORKSPACE_SETTINGS],
      secrets: {
        readSecret: async () => Buffer.from(secret),
        writeSecret: async () => ({ id: 'secret-id' }),
        deleteSecret: async () => undefined,
      } as never,
      auth: {
        findUserByEmail: async () => user,
        recordSuccessfulLogin: async () => undefined,
        issueTokenPair,
      } as never,
      accessTokenSigner: signer,
      config: {},
      challengeStore,
      applyWorkspaceSession: workspaceDb.applyWorkspaceSession,
      now: () => new Date('2026-01-01T12:00:00.000Z'),
    });
    const challenge = issueMfaChallengeToken({
      signer,
      userId: user.id,
      workspaceId: user.workspaceId,
      method: 'totp',
      issuedAt: new Date('2026-01-01T12:00:00.000Z'),
    });

    await expect(service.completeMfaLogin({
      mfaChallengeToken: challenge,
      code: invalidCode,
    })).resolves.toEqual({ ok: false, code: 'mfa_code_invalid' });
    await expect(service.completeMfaLogin({
      mfaChallengeToken: challenge,
      code: validCode,
    })).resolves.toMatchObject({ ok: true });
    await expect(service.completeMfaLogin({
      mfaChallengeToken: challenge,
      code: validCode,
    })).resolves.toEqual({ ok: false, code: 'mfa_attempts_exceeded' });
    expect(issueTokenPair).toHaveBeenCalledTimes(1);
  });

  test('rolls back MFA email code row when SMTP delivery fails', async () => {
    const deletedIds: number[] = [];
    const db = {
      insertInto: () => ({
        values: () => ({
          returning: () => ({
            executeTakeFirst: async () => ({ id: 42 }),
          }),
        }),
      }),
      updateTable: () => {
        const chain: Record<string, unknown> = {};
        chain.set = () => chain;
        chain.where = () => chain;
        chain.execute = async () => undefined;
        return chain;
      },
      deleteFrom: () => ({
        where: () => ({
          execute: async () => {
            deletedIds.push(42);
          },
        }),
      }),
    };
    const service = createLoginSecurityService({
      db: db as never,
      syncInfo: {
        getMany: async () => ({}),
        setMany: async () => undefined,
      },
      listPublicWorkspaceSettings: async () => [DEFAULT_AUTH_SECURITY_WORKSPACE_SETTINGS],
      secrets: {
        readSecret: async () => null,
        writeSecret: async () => undefined,
        deleteSecret: async () => undefined,
      },
      auth: {
        findUserByEmail: async () => null,
      },
      accessTokenSigner: signer,
      config: {},
      challengeStore,
      authInvitationSmtp: {
        host: 'smtp.example.com',
        port: 587,
        tls: true,
        user: 'smtp-user',
        password: 'smtp-pass',
        from: 'noreply@example.com',
      },
      now: () => new Date('2026-01-01T12:00:00.000Z'),
    });

    await expect(service.beginMfaIfRequired({
      user: mfaUser,
      workspaceSettings: {
        ...DEFAULT_AUTH_SECURITY_WORKSPACE_SETTINGS,
        mfaEnabled: true,
        mfaEmailEnabled: true,
      },
    })).resolves.toEqual({ kind: 'mfa_delivery_failed' });
    expect(deletedIds).toEqual([42]);
  });

  test('fails closed when email MFA cannot be delivered', async () => {
    const service = createService({
      smtp: {
        host: 'smtp.example.com',
        port: 587,
        tls: true,
        user: 'smtp-user',
        password: 'smtp-pass',
        from: 'noreply@example.com',
      },
    });
    await expect(service.beginMfaIfRequired({
      user: mfaUser,
      workspaceSettings: {
        ...DEFAULT_AUTH_SECURITY_WORKSPACE_SETTINGS,
        mfaEnabled: true,
        mfaEmailEnabled: true,
      },
    })).resolves.toEqual({ kind: 'mfa_delivery_failed' });
  });
});

describe('login security PostgreSQL workspace context', () => {
  test('confirms TOTP enrollment inside a workspace-scoped RLS transaction', async () => {
    const workspaceId = '11111111-1111-4111-8111-111111111111';
    const userId = '22222222-2222-4222-8222-222222222222';
    const secret = generateTotpSecret();
    const code = generateSync({ secret });
    let insideTransaction = false;
    const updateChain: Record<string, jest.Mock> = {};
    updateChain.set = jest.fn(() => updateChain);
    updateChain.where = jest.fn(() => updateChain);
    updateChain.returning = jest.fn(() => updateChain);
    updateChain.executeTakeFirst = jest.fn(async () => ({ id: userId }));
    const trx = {
      updateTable: jest.fn(() => {
        if (!insideTransaction) throw new Error('workspace RLS context missing');
        return updateChain;
      }),
    };
    const applyWorkspaceSession = jest.fn(async () => undefined);
    const db = {
      updateTable: () => {
        throw new Error('direct pool update is blocked by RLS');
      },
      transaction: () => ({
        execute: async (operation: (transaction: typeof trx) => Promise<unknown>) => {
          insideTransaction = true;
          try {
            return await operation(trx);
          } finally {
            insideTransaction = false;
          }
        },
      }),
    };
    const service = createLoginSecurityService({
      db,
      syncInfo: { getMany: async () => [], setMany: async () => undefined },
      listPublicWorkspaceSettings: async () => [DEFAULT_AUTH_SECURITY_WORKSPACE_SETTINGS],
      secrets: {
        readSecret: async () => Buffer.from(secret),
        writeSecret: async () => ({ id: 'secret-id' }),
        deleteSecret: async () => true,
      },
      auth: { findUserByEmail: async () => null },
      accessTokenSigner: signer,
      config: {},
      challengeStore: createSharedChallengeStore(),
      applyWorkspaceSession,
    } as never);

    await expect(service.confirmTotpSetup({
      workspaceId,
      userId,
      secret,
      code,
    })).resolves.toBe(true);
    expect(applyWorkspaceSession).toHaveBeenCalledTimes(1);
    expect(trx.updateTable).toHaveBeenCalledWith('users');
  });
});

function createSharedChallengeStore(): AuthChallengeStore {
  const states = new Map<string, { count: number; consumed: boolean; expiresAt: number }>();
  return {
    async consume(input) {
      const key = `${input.purpose}:${input.token}`;
      const nowMs = input.now.getTime();
      const current = states.get(key);
      if (current?.consumed && current.expiresAt > nowMs) return false;
      states.set(key, {
        count: 0,
        consumed: true,
        expiresAt: nowMs + input.ttlMs,
      });
      return true;
    },
    async registerAttempt(input) {
      const key = `${input.purpose}:${input.token}`;
      const nowMs = input.now.getTime();
      const current = states.get(key);
      if (current?.consumed && current.expiresAt > nowMs) return false;
      const count = !current || current.expiresAt <= nowMs ? 1 : current.count + 1;
      if (count > input.maxAttempts) return false;
      states.set(key, {
        count,
        consumed: false,
        expiresAt: current && current.expiresAt > nowMs
          ? current.expiresAt
          : nowMs + input.ttlMs,
      });
      return true;
    },
  };
}

function createWorkspaceLookupDb(email: string) {
  const selectChain: Record<string, jest.Mock> = {};
  selectChain.select = jest.fn(() => selectChain);
  selectChain.where = jest.fn(() => selectChain);
  selectChain.executeTakeFirst = jest.fn(async () => ({ email }));
  const trx = {
    selectFrom: jest.fn(() => selectChain),
  };
  return {
    db: {
      transaction: () => ({
        execute: async (operation: (transaction: typeof trx) => Promise<unknown>) => operation(trx),
      }),
    },
    applyWorkspaceSession: jest.fn(async () => undefined),
  };
}
