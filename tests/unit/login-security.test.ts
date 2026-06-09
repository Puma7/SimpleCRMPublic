import { DEFAULT_AUTH_SECURITY_WORKSPACE_SETTINGS } from '@simplecrm/core';

jest.mock('../../packages/server/src/mail-smtp-send', () => ({
  sendSmtpMessage: jest.fn().mockRejectedValue(new Error('smtp down')),
}));

import { createLoginSecurityService } from '../../packages/server/src/auth/login-security-service';
import {
  issueCaptchaChallenge,
  verifyCaptchaChallenge,
} from '../../packages/server/src/security/captcha-challenge';
import { hashLoginPin, verifyLoginPin } from '../../packages/server/src/security/login-pin-hash';
import { generateTotpSecret, verifyTotpCode } from '../../packages/server/src/security/totp';
import { authenticator } from 'otplib';

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

  test('login pin hash roundtrip', async () => {
    const hash = await hashLoginPin('123456');
    expect(await verifyLoginPin('123456', hash)).toBe(true);
    expect(await verifyLoginPin('654321', hash)).toBe(false);
  });

  test('totp secret verifies generated code', () => {
    const secret = generateTotpSecret();
    const token = authenticator.generate(secret);
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
