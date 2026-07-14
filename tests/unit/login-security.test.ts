import { DEFAULT_AUTH_SECURITY_WORKSPACE_SETTINGS } from '@simplecrm/core';

jest.mock('../../packages/server/src/mail-smtp-send', () => ({
  sendSmtpMessage: jest.fn().mockRejectedValue(new Error('smtp down')),
}));

import { createLoginSecurityService } from '../../packages/server/src/auth/login-security-service';
import { consumeSingleUseToken, resetConsumedTokens } from '../../packages/server/src/security/consumed-token-store';
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

const mfaUser = {
  id: 'user-1',
  workspaceId: 'ws-1',
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

  test('single-use token store rejects replay', () => {
    resetConsumedTokens();
    expect(consumeSingleUseToken('challenge-token', 60_000, 1_000)).toBe(true);
    expect(consumeSingleUseToken('challenge-token', 60_000, 2_000)).toBe(false);
    expect(consumeSingleUseToken('challenge-token', 60_000, 62_000)).toBe(true);
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

describe('login security service MFA gate', () => {
  function createService(overrides: {
    smtp?: unknown;
    db?: { insertInto: () => unknown };
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

  test('accepts a CAPTCHA challenge only once', () => {
    resetConsumedTokens();
    const service = createService();
    const challenge = issueCaptchaChallenge({
      signer,
      ip: '127.0.0.1',
      issuedAt: new Date('2026-01-01T12:00:00.000Z'),
    });
    expect(service.assertCaptchaChallenge({ challenge, ip: '127.0.0.1' })).toBe(true);
    expect(service.assertCaptchaChallenge({ challenge, ip: '127.0.0.1' })).toBe(false);
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
    const service = createLoginSecurityService({
      db: {
        selectFrom: () => ({
          select: () => ({
            where: () => ({
              executeTakeFirst: async () => ({ email: user.email }),
            }),
          }),
        }),
      } as never,
      syncInfo: { getMany: async () => [], setMany: async () => undefined },
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
