import { DEFAULT_AUTH_SECURITY_WORKSPACE_SETTINGS } from '@simplecrm/core';

jest.mock('../../packages/server/src/mail-smtp-send', () => ({
  sendSmtpMessage: jest.fn().mockRejectedValue(new Error('smtp down')),
}));

import { sendSmtpMessage } from '../../packages/server/src/mail-smtp-send';
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

type EmailMfaTestRow = {
  id: number;
  userId: string;
  deliveryStatus: 'pending' | 'sent' | 'failed' | 'superseded';
  active: boolean;
};

function makeEmailMfaDb(rows: EmailMfaTestRow[], nextId: () => number) {
  return {
    selectFrom(table: string) {
      const wheres: Array<[string, string, unknown]> = [];
      const chain: Record<string, jest.Mock> = {};
      chain.select = jest.fn(() => chain);
      chain.where = jest.fn((column: string, operator: string, value: unknown) => {
        wheres.push([column, operator, value]);
        return chain;
      });
      chain.orderBy = jest.fn(() => chain);
      chain.forUpdate = jest.fn(() => chain);
      const selectedRows = () => rows.filter((row) => (
          row.active
          && wheres.every(([column, operator, value]) => {
            if (column === 'delivery_status') return operator === '=' && row.deliveryStatus === value;
            if (column === 'user_id') return operator === '=' && row.userId === value;
            if (column === 'consumed_at') return operator === 'is' && value === null && row.active;
            return true;
          })
        ));
      chain.executeTakeFirst = jest.fn(async () => {
        if (table === 'users') return { id: mfaUser.id };
        return selectedRows()[0];
      });
      chain.execute = jest.fn(async () => selectedRows().map((row) => ({ id: row.id })));
      return chain;
    },
    updateTable() {
      const wheres: Array<[string, string, unknown]> = [];
      let values: Record<string, unknown> = {};
      const chain: Record<string, jest.Mock> = {};
      chain.set = jest.fn((input: Record<string, unknown>) => {
        values = input;
        return chain;
      });
      chain.where = jest.fn((column: string, operator: string, value: unknown) => {
        wheres.push([column, operator, value]);
        return chain;
      });
      chain.execute = jest.fn(async () => {
        for (const row of rows) {
          const matches = wheres.every(([column, operator, value]) => {
            if (column === 'id' && operator === 'in') return (value as unknown[]).includes(row.id);
            if (column === 'id') return operator === '=' ? row.id === value : row.id !== value;
            if (column === 'user_id') return row.userId === value;
            if (column === 'delivery_status') return row.deliveryStatus === value;
            if (column === 'consumed_at') return operator === 'is' && value === null && row.active;
            return true;
          });
          if (!matches) continue;
          if (values.delivery_status) {
            row.deliveryStatus = values.delivery_status as EmailMfaTestRow['deliveryStatus'];
          }
          if (values.consumed_at instanceof Date) row.active = false;
          if (values.consumed_at === null) row.active = true;
        }
      });
      return chain;
    },
    insertInto() {
      return {
        values(value: { user_id: string; delivery_status: EmailMfaTestRow['deliveryStatus'] }) {
          const executeTakeFirst = async () => {
            const row = {
              id: nextId(),
              userId: value.user_id,
              deliveryStatus: value.delivery_status,
              active: true,
            };
            rows.push(row);
            return { id: row.id };
          };
          return {
            returning: () => ({ executeTakeFirst }),
            executeTakeFirst,
          };
        },
      };
    },
  };
}

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
      applyWorkspaceSession: async () => undefined,
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

  test('releases the MFA transaction before SMTP and shares a concurrent delivery', async () => {
    const rows: Array<{
      id: number;
      userId: string;
      deliveryStatus: 'pending' | 'sent' | 'failed' | 'superseded';
      active: boolean;
    }> = [
      { id: 0, userId: mfaUser.id, deliveryStatus: 'superseded', active: true },
      { id: 1, userId: mfaUser.id, deliveryStatus: 'sent', active: true },
    ];
    let nextId = 2;
    let activeTransactions = 0;
    let transactionTail = Promise.resolve();
    let releaseSmtp: () => void = () => undefined;
    let notifySmtpStarted: () => void = () => undefined;
    const smtpStarted = new Promise<void>((resolve) => { notifySmtpStarted = resolve; });
    const smtpReleased = new Promise<void>((resolve) => { releaseSmtp = resolve; });
    jest.mocked(sendSmtpMessage).mockImplementationOnce(async () => {
      expect(activeTransactions).toBe(0);
      notifySmtpStarted();
      await smtpReleased;
    });

    const transaction = jest.fn(() => ({
      execute: async (operation: (trx: unknown) => Promise<unknown>) => {
        const previous = transactionTail;
        let releaseTransaction: () => void = () => undefined;
        transactionTail = new Promise<void>((resolve) => { releaseTransaction = resolve; });
        await previous;
        activeTransactions += 1;
        const trx = makeEmailMfaDb(rows, () => nextId++);
        try {
          return await operation(trx);
        } finally {
          activeTransactions -= 1;
          releaseTransaction();
        }
      },
    }));
    const db = { transaction };
    const service = createService({
      db: db as never,
      smtp: {
        host: 'smtp.example.com',
        port: 587,
        tls: true,
        user: 'smtp-user',
        password: 'smtp-pass',
        from: 'noreply@example.com',
      },
    });
    const settings = {
      ...DEFAULT_AUTH_SECURITY_WORKSPACE_SETTINGS,
      mfaEnabled: true,
      mfaEmailEnabled: true,
    };

    const first = service.beginMfaIfRequired({ user: mfaUser, workspaceSettings: settings });
    await smtpStarted;
    expect(rows[0]?.active).toBe(false);
    expect(rows[1]?.deliveryStatus).toBe('superseded');
    const second = service.beginMfaIfRequired({ user: mfaUser, workspaceSettings: settings });
    await expect(second).resolves.toEqual(
      expect.objectContaining({ kind: 'mfa_required', mfaMethod: 'email' }),
    );
    releaseSmtp();
    const results = await Promise.all([first, second]);

    expect(results).toEqual([
      expect.objectContaining({ kind: 'mfa_required', mfaMethod: 'email' }),
      expect.objectContaining({ kind: 'mfa_required', mfaMethod: 'email' }),
    ]);
    expect(rows.filter((row) => row.active)).toHaveLength(1);
    expect(rows.filter((row) => row.active && row.deliveryStatus === 'sent')).toHaveLength(1);
    expect(sendSmtpMessage).toHaveBeenCalledTimes(1);
    expect(transaction).toHaveBeenCalledTimes(3);
  });

  test('fails the pending MFA code and preserves the previous code when SMTP fails', async () => {
    const rows: Array<{
      id: number;
      userId: string;
      deliveryStatus: 'pending' | 'sent' | 'failed' | 'superseded';
      active: boolean;
    }> = [{ id: 41, userId: mfaUser.id, deliveryStatus: 'sent', active: true }];
    let nextId = 42;
    let activeTransactions = 0;
    jest.mocked(sendSmtpMessage).mockImplementationOnce(async () => {
      expect(activeTransactions).toBe(0);
      throw new Error('smtp down');
    });
    const db = {
      transaction: jest.fn(() => ({
        execute: async (operation: (transaction: unknown) => Promise<unknown>) => {
          activeTransactions += 1;
          try {
            return await operation(makeEmailMfaDb(rows, () => nextId++));
          } finally {
            activeTransactions -= 1;
          }
        },
      })),
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
      applyWorkspaceSession: async () => undefined,
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
    expect(rows).toEqual([
      { id: 41, userId: mfaUser.id, deliveryStatus: 'sent', active: true },
      { id: 42, userId: mfaUser.id, deliveryStatus: 'failed', active: false },
    ]);
    expect(db.transaction).toHaveBeenCalledTimes(2);
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
