import { createHash, randomInt } from 'node:crypto';

import type { Kysely } from 'kysely';
import {
  AUTH_SECURITY_SYNC_KEYS,
  DEFAULT_AUTH_SECURITY_WORKSPACE_SETTINGS,
  parseAuthSecuritySyncValues,
  serializeAuthSecuritySyncValues,
  type AuthMfaMethod,
  type AuthSecurityWorkspaceSettings,
} from '@simplecrm/core';
import type { AuthInvitationSmtpConfig } from '../auth-invitation-mailer';
import { sendMfaEmailCode } from './mfa-email';
import type {
  AuthApiPort,
  AuthUserRecord,
  SyncInfoApiPort,
  TokenPair,
} from '../api';
import type { PostgresSecretPort } from '../db/postgres-secret-port';
import type { ServerDatabase } from '../db/schema';
import {
  issueCaptchaChallenge,
  verifyCaptchaChallenge,
} from '../security/captcha-challenge';
import { consumeSingleUseToken } from '../security/consumed-token-store';
import { hashLoginPin, verifyLoginPin } from '../security/login-pin-hash';
import {
  issueMfaChallengeToken,
  parseMfaChallengeToken,
} from '../security/mfa-challenge';
import type { AccessTokenSigner } from '../security/access-token';
import {
  buildTotpOtpAuthUri,
  generateTotpSecret,
  verifyTotpCode,
} from '../security/totp';
import { verifyTurnstileToken } from '../security/turnstile-verify';

export type LoginSecurityConfig = Readonly<{
  turnstileSiteKey?: string;
  turnstileSecretKey?: string;
}>;

export type LoginConfigResponse = Readonly<{
  captcha: {
    enabled: boolean;
    provider: 'turnstile' | null;
    siteKey: string | null;
  };
  pinKeypad: {
    enabled: boolean;
  };
  mfa: {
    enabled: boolean;
    methods: readonly AuthMfaMethod[];
  };
  user: {
    pinRequired: boolean;
    mfaRequired: boolean;
    mfaMethod: AuthMfaMethod | null;
  } | null;
}>;

export type LoginSecurityService = Readonly<{
  getWorkspaceSettings(workspaceId: string): Promise<AuthSecurityWorkspaceSettings>;
  setWorkspaceSettings(
    workspaceId: string,
    settings: AuthSecurityWorkspaceSettings,
  ): Promise<AuthSecurityWorkspaceSettings>;
  getLoginConfig(email?: string): Promise<LoginConfigResponse>;
  verifyCaptcha(input: { token: string; ip: string }): Promise<
    | { ok: true; challenge: string }
    | { ok: false; code: string }
  >;
  assertCaptchaChallenge(input: { challenge: string | undefined; ip: string }): boolean;
  assertLoginPin(input: {
    user: AuthUserRecord;
    workspaceSettings: AuthSecurityWorkspaceSettings;
    pin: string | undefined;
  }): Promise<boolean>;
  beginMfaIfRequired(input: {
    user: AuthUserRecord;
    workspaceSettings: AuthSecurityWorkspaceSettings;
    device?: string;
  }): Promise<
    | { kind: 'complete' }
    | { kind: 'mfa_required'; mfaChallengeToken: string; mfaMethod: AuthMfaMethod }
    | { kind: 'mfa_delivery_failed' }
  >;
  completeMfaLogin(input: {
    mfaChallengeToken: string;
    code: string;
    device?: string;
    ip?: string;
  }): Promise<
    | { ok: true; user: AuthUserRecord; tokens: TokenPair }
    | { ok: false; code: string }
  >;
  setUserPin(input: {
    workspaceId: string;
    userId: string;
    pin: string | null;
  }): Promise<void>;
  beginTotpSetup(input: {
    workspaceId: string;
    userId: string;
    email: string;
  }): Promise<{ secret: string; otpauthUri: string }>;
  confirmTotpSetup(input: {
    workspaceId: string;
    userId: string;
    secret: string;
    code: string;
  }): Promise<boolean>;
  enableEmailMfa(input: { workspaceId: string; userId: string }): Promise<void>;
  disableUserMfa(input: { workspaceId: string; userId: string }): Promise<void>;
}>;

export function createLoginSecurityService(input: {
  db: Kysely<ServerDatabase>;
  syncInfo: SyncInfoApiPort;
  secrets: PostgresSecretPort;
  auth: AuthApiPort;
  accessTokenSigner: AccessTokenSigner;
  config: LoginSecurityConfig;
  authInvitationSmtp?: AuthInvitationSmtpConfig;
  now?: () => Date;
}): LoginSecurityService {
  const now = input.now ?? (() => new Date());

  return {
    async getWorkspaceSettings(workspaceId) {
      return loadWorkspaceSettings(input.syncInfo, workspaceId);
    },

    async setWorkspaceSettings(workspaceId, settings) {
      await input.syncInfo.setMany({
        workspaceId,
        values: serializeAuthSecuritySyncValues(settings),
      });
      return settings;
    },

    async getLoginConfig(email) {
      const workspaceId = await resolveWorkspaceId(input.db, input.auth, email);
      const workspaceSettings = workspaceId
        ? await loadWorkspaceSettings(input.syncInfo, workspaceId)
        : DEFAULT_AUTH_SECURITY_WORKSPACE_SETTINGS;
      const turnstileConfigured = Boolean(
        input.config.turnstileSiteKey?.trim()
        && input.config.turnstileSecretKey?.trim(),
      );
      const user = email ? await input.auth.findUserByEmail(email.trim().toLowerCase()) : null;
      const mfaMethods = resolveMfaMethods(workspaceSettings, Boolean(input.authInvitationSmtp));

      return {
        captcha: {
          enabled: turnstileConfigured && workspaceSettings.captchaEnabled,
          provider: turnstileConfigured ? 'turnstile' : null,
          siteKey: turnstileConfigured ? input.config.turnstileSiteKey ?? null : null,
        },
        pinKeypad: {
          enabled: workspaceSettings.pinKeypadEnabled,
        },
        mfa: {
          enabled: workspaceSettings.mfaEnabled && mfaMethods.length > 0,
          methods: mfaMethods,
        },
        user: user ? {
          pinRequired: workspaceSettings.pinKeypadEnabled && Boolean(user.loginPinEnabled),
          mfaRequired: workspaceSettings.mfaEnabled && Boolean(user.mfaEnabled),
          mfaMethod: user.mfaEnabled ? user.mfaMethod ?? null : null,
        } : null,
      };
    },

    async verifyCaptcha({ token, ip }) {
      const secretKey = input.config.turnstileSecretKey?.trim();
      if (!secretKey) return { ok: false, code: 'captcha_not_configured' };
      const verified = await verifyTurnstileToken({ secretKey, token, ip });
      if (!verified.ok) return { ok: false, code: verified.error };
      const challenge = issueCaptchaChallenge({
        signer: input.accessTokenSigner,
        ip,
        issuedAt: now(),
      });
      return { ok: true, challenge };
    },

    assertCaptchaChallenge({ challenge, ip }) {
      if (!challenge?.trim()) return false;
      return verifyCaptchaChallenge({
        token: challenge.trim(),
        signer: input.accessTokenSigner,
        ip,
        now: now(),
      });
    },

    async assertLoginPin({ user, workspaceSettings, pin }) {
      if (!workspaceSettings.pinKeypadEnabled || !user.loginPinEnabled) return true;
      if (!pin?.trim()) return false;
      return verifyLoginPin(pin.trim(), user.loginPinHash ?? null);
    },

    async beginMfaIfRequired({ user, workspaceSettings }) {
      if (!workspaceSettings.mfaEnabled) {
        return { kind: 'complete' };
      }
      if (!user.mfaEnabled || !user.mfaMethod) {
        return { kind: 'complete' };
      }
      const allowedMethods = resolveMfaMethods(
        workspaceSettings,
        Boolean(input.authInvitationSmtp),
      );
      if (!allowedMethods.includes(user.mfaMethod)) {
        return { kind: 'complete' };
      }
      if (user.mfaMethod === 'email') {
        const sent = await sendEmailMfaCode({
          db: input.db,
          smtp: input.authInvitationSmtp,
          user,
          now: now(),
        });
        if (!sent) return { kind: 'mfa_delivery_failed' };
      }
      return {
        kind: 'mfa_required',
        mfaMethod: user.mfaMethod,
        mfaChallengeToken: issueMfaChallengeToken({
          signer: input.accessTokenSigner,
          userId: user.id,
          workspaceId: user.workspaceId,
          method: user.mfaMethod,
          issuedAt: now(),
        }),
      };
    },

    async completeMfaLogin({ mfaChallengeToken, code, device, ip }) {
      const claims = parseMfaChallengeToken({
        token: mfaChallengeToken,
        signer: input.accessTokenSigner,
        now: now(),
      });
      if (!claims) return { ok: false, code: 'mfa_challenge_invalid' };

      const email = await lookupUserEmail(input.db, claims.userId);
      if (!email) return { ok: false, code: 'mfa_challenge_invalid' };
      const user = await input.auth.findUserByEmail(email);
      if (!user || user.id !== claims.userId) {
        return { ok: false, code: 'mfa_challenge_invalid' };
      }
      if (user.disabledAt) {
        return { ok: false, code: 'user_disabled' };
      }

      const verified = claims.method === 'totp'
        ? await verifyUserTotp({
          db: input.db,
          secrets: input.secrets,
          user,
          code,
        })
        : await verifyEmailMfaCode({
          db: input.db,
          userId: user.id,
          code,
          now: now(),
        });
      if (!verified) return { ok: false, code: 'mfa_code_invalid' };

      const challengeTtlMs = 5 * 60 * 1000;
      if (!consumeSingleUseToken(mfaChallengeToken, challengeTtlMs, now().getTime())) {
        return { ok: false, code: 'mfa_challenge_invalid' };
      }

      await input.auth.recordSuccessfulLogin({
        userId: user.id,
        email: user.email,
        ip: ip ?? '0.0.0.0',
      });
      const tokens = await input.auth.issueTokenPair({ user, device });
      return { ok: true, user, tokens };
    },

    async setUserPin({ workspaceId, userId, pin }) {
      const pinHash = pin ? await hashLoginPin(pin) : null;
      await input.db
        .updateTable('users')
        .set({
          login_pin_hash: pinHash,
          login_pin_enabled: Boolean(pinHash),
          updated_at: now(),
        })
        .where('id', '=', userId)
        .where('workspace_id', '=', workspaceId)
        .execute();
    },

    async beginTotpSetup({ workspaceId, userId, email }) {
      const secret = generateTotpSecret();
      await input.secrets.writeSecret({
        workspaceId,
        kind: 'auth_mfa_totp_pending',
        name: userId,
        value: secret,
      });
      return {
        secret,
        otpauthUri: buildTotpOtpAuthUri({ secret, email }),
      };
    },

    async confirmTotpSetup({ workspaceId, userId, secret, code }) {
      if (!verifyTotpCode(secret, code)) return false;
      const pending = await input.secrets.readSecret({
        workspaceId,
        kind: 'auth_mfa_totp_pending',
        name: userId,
      });
      if (!pending || pending.toString('utf8') !== secret) return false;

      const stored = await input.secrets.writeSecret({
        workspaceId,
        kind: 'auth_mfa_totp',
        name: userId,
        value: secret,
      });
      await input.secrets.deleteSecret({
        workspaceId,
        kind: 'auth_mfa_totp_pending',
        name: userId,
      });
      await input.db
        .updateTable('users')
        .set({
          mfa_enabled: true,
          mfa_method: 'totp',
          mfa_totp_secret_id: stored.id,
          updated_at: now(),
        })
        .where('id', '=', userId)
        .where('workspace_id', '=', workspaceId)
        .execute();
      return true;
    },

    async enableEmailMfa({ workspaceId, userId }) {
      await input.db
        .updateTable('users')
        .set({
          mfa_enabled: true,
          mfa_method: 'email',
          mfa_totp_secret_id: null,
          updated_at: now(),
        })
        .where('id', '=', userId)
        .where('workspace_id', '=', workspaceId)
        .execute();
    },

    async disableUserMfa({ workspaceId, userId }) {
      await input.secrets.deleteSecret({ workspaceId, kind: 'auth_mfa_totp', name: userId });
      await input.secrets.deleteSecret({ workspaceId, kind: 'auth_mfa_totp_pending', name: userId });
      await input.db
        .updateTable('users')
        .set({
          mfa_enabled: false,
          mfa_method: null,
          mfa_totp_secret_id: null,
          updated_at: now(),
        })
        .where('id', '=', userId)
        .where('workspace_id', '=', workspaceId)
        .execute();
    },
  };
}

async function loadWorkspaceSettings(
  syncInfo: SyncInfoApiPort,
  workspaceId: string,
): Promise<AuthSecurityWorkspaceSettings> {
  const rows = await syncInfo.getMany({
    workspaceId,
    keys: Object.values(AUTH_SECURITY_SYNC_KEYS),
  });
  const values = Object.fromEntries(rows.map((row) => [row.key, row.value]));
  return parseAuthSecuritySyncValues(values);
}

async function resolveWorkspaceId(
  db: Kysely<ServerDatabase>,
  auth: AuthApiPort,
  email?: string,
): Promise<string | null> {
  if (email?.trim()) {
    const user = await auth.findUserByEmail(email.trim().toLowerCase());
    if (user) return user.workspaceId;
  }
  const only = await db.selectFrom('workspaces').select(['id']).execute();
  if (only.length === 1) return only[0]?.id ?? null;
  return null;
}

function resolveMfaMethods(
  settings: AuthSecurityWorkspaceSettings,
  smtpConfigured: boolean,
): AuthMfaMethod[] {
  if (!settings.mfaEnabled) return [];
  const methods: AuthMfaMethod[] = [];
  if (settings.mfaTotpEnabled) methods.push('totp');
  if (settings.mfaEmailEnabled && smtpConfigured) methods.push('email');
  return methods;
}

async function lookupUserEmail(db: Kysely<ServerDatabase>, userId: string): Promise<string | null> {
  const row = await db
    .selectFrom('users')
    .select(['email'])
    .where('id', '=', userId)
    .executeTakeFirst();
  return row?.email ?? null;
}

async function verifyUserTotp(input: {
  db: Kysely<ServerDatabase>;
  secrets: PostgresSecretPort;
  user: AuthUserRecord;
  code: string;
}): Promise<boolean> {
  if (input.user.mfaMethod !== 'totp' || !input.user.mfaEnabled) return false;
  const secretBuffer = await input.secrets.readSecret({
    workspaceId: input.user.workspaceId,
    kind: 'auth_mfa_totp',
    name: input.user.id,
  });
  if (!secretBuffer) return false;
  return verifyTotpCode(secretBuffer.toString('utf8'), input.code);
}

async function sendEmailMfaCode(input: {
  db: Kysely<ServerDatabase>;
  smtp?: AuthInvitationSmtpConfig;
  user: AuthUserRecord;
  now: Date;
}): Promise<boolean> {
  if (!input.smtp || input.user.mfaMethod !== 'email') return false;
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const codeHash = hashEmailCode(code);
  const expiresAt = new Date(input.now.getTime() + 10 * 60 * 1000);
  const inserted = await input.db.insertInto('auth_mfa_email_codes').values({
    user_id: input.user.id,
    code_hash: codeHash,
    expires_at: expiresAt,
  }).returning('id').executeTakeFirst();

  try {
    await sendMfaEmailCode({
      smtp: input.smtp,
      email: input.user.email,
      displayName: input.user.displayName,
      code,
      now: input.now,
    });
  } catch {
    if (inserted?.id !== undefined) {
      await input.db
        .deleteFrom('auth_mfa_email_codes')
        .where('id', '=', inserted.id)
        .execute();
    }
    return false;
  }
  return true;
}

async function verifyEmailMfaCode(input: {
  db: Kysely<ServerDatabase>;
  userId: string;
  code: string;
  now: Date;
}): Promise<boolean> {
  const normalized = input.code.trim();
  if (!/^\d{6}$/.test(normalized)) return false;
  const codeHash = hashEmailCode(normalized);
  const row = await input.db
    .updateTable('auth_mfa_email_codes')
    .set({ consumed_at: input.now })
    .where('user_id', '=', input.userId)
    .where('code_hash', '=', codeHash)
    .where('consumed_at', 'is', null)
    .where('expires_at', '>', input.now)
    .returning(['id'])
    .executeTakeFirst();
  return Boolean(row);
}

function hashEmailCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}
