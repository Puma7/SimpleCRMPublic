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
  withWorkspaceTransaction,
  type WorkspaceSessionApplier,
} from '../db/workspace-context';
import {
  CAPTCHA_CHALLENGE_TTL_MS,
  issueCaptchaChallenge,
  verifyCaptchaChallenge,
} from '../security/captcha-challenge';
import {
  createPostgresAuthChallengeStore,
  type AuthChallengeStore,
} from '../security/auth-challenge-store';
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
  getLoginConfig(): Promise<LoginConfigResponse>;
  verifyCaptcha(input: { token: string; ip: string }): Promise<
    | { ok: true; challenge: string }
    | { ok: false; code: string }
  >;
  assertCaptchaChallenge(input: { challenge: string | undefined; ip: string }): Promise<boolean>;
  issueCaptchaContinuation(input: { ip: string }): string;
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
  listPublicWorkspaceSettings: () => Promise<readonly AuthSecurityWorkspaceSettings[]>;
  secrets: PostgresSecretPort;
  auth: AuthApiPort;
  accessTokenSigner: AccessTokenSigner;
  config: LoginSecurityConfig;
  authInvitationSmtp?: AuthInvitationSmtpConfig;
  challengeStore?: AuthChallengeStore;
  applyWorkspaceSession?: WorkspaceSessionApplier;
  now?: () => Date;
}): LoginSecurityService {
  const now = input.now ?? (() => new Date());
  const challengeStore = input.challengeStore ?? createPostgresAuthChallengeStore(input.db);
  const maxMfaCodeAttempts = 5;
  const mfaChallengeTtlMs = 5 * 60 * 1000;

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

    async getLoginConfig() {
      const settingsRows = await input.listPublicWorkspaceSettings();
      const turnstileConfigured = Boolean(
        input.config.turnstileSiteKey?.trim()
        && input.config.turnstileSecretKey?.trim(),
      );
      const mfaMethods = [...new Set(settingsRows.flatMap((settings) => (
        resolveMfaMethods(settings, Boolean(input.authInvitationSmtp))
      )))];

      return {
        captcha: {
          enabled: turnstileConfigured && settingsRows.some((settings) => settings.captchaEnabled),
          provider: turnstileConfigured ? 'turnstile' : null,
          siteKey: turnstileConfigured ? input.config.turnstileSiteKey ?? null : null,
        },
        pinKeypad: {
          enabled: settingsRows.some((settings) => settings.pinKeypadEnabled),
        },
        mfa: {
          enabled: settingsRows.some((settings) => settings.mfaEnabled) && mfaMethods.length > 0,
          methods: mfaMethods,
        },
        user: null,
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

    async assertCaptchaChallenge({ challenge, ip }) {
      if (!challenge?.trim()) return false;
      const token = challenge.trim();
      const valid = verifyCaptchaChallenge({
        token,
        signer: input.accessTokenSigner,
        ip,
        now: now(),
      });
      return valid && await challengeStore.consume({
        token,
        purpose: 'captcha',
        ttlMs: CAPTCHA_CHALLENGE_TTL_MS,
        now: now(),
      });
    },

    issueCaptchaContinuation({ ip }) {
      return issueCaptchaChallenge({
        signer: input.accessTokenSigner,
        ip,
        issuedAt: now(),
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
        return { kind: 'mfa_delivery_failed' };
      }
      if (user.mfaMethod === 'email') {
        const sent = await sendEmailMfaCode({
          db: input.db,
          smtp: input.authInvitationSmtp,
          user,
          now: now(),
          applyWorkspaceSession: input.applyWorkspaceSession,
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

      const email = await lookupUserEmail(
        input.db,
        claims.workspaceId,
        claims.userId,
        input.applyWorkspaceSession,
      );
      if (!email) return { ok: false, code: 'mfa_challenge_invalid' };
      const user = await input.auth.findUserByEmail(email);
      if (!user || user.id !== claims.userId) {
        return { ok: false, code: 'mfa_challenge_invalid' };
      }
      if (user.disabledAt) {
        return { ok: false, code: 'user_disabled' };
      }

      // Feed MFA failures into the same (email,ip) lockout used by /login. The
      // login route enforces that lock before it can mint another challenge.
      // Do not enforce it again here: an already-issued challenge has its own
      // attempt cap, and a legitimate user must be able to correct one typo.
      const failIp = ip ?? '0.0.0.0';
      const recordMfaFailure = async () => {
        await input.auth.recordFailedLogin?.({ email, ip: failIp, userId: user.id });
      };

      if (!(await challengeStore.registerAttempt({
        token: mfaChallengeToken,
        purpose: 'mfa',
        maxAttempts: maxMfaCodeAttempts,
        ttlMs: mfaChallengeTtlMs,
        now: now(),
      }))) {
        await recordMfaFailure();
        return { ok: false, code: 'mfa_attempts_exceeded' };
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
          workspaceId: claims.workspaceId,
          userId: user.id,
          code,
          now: now(),
          applyWorkspaceSession: input.applyWorkspaceSession,
        });
      if (!verified) {
        await recordMfaFailure();
        return { ok: false, code: 'mfa_code_invalid' };
      }

      const challengeTtlMs = 5 * 60 * 1000;
      if (!(await challengeStore.consume({
        token: mfaChallengeToken,
        purpose: 'mfa',
        ttlMs: challengeTtlMs,
        now: now(),
      }))) {
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
      await withWorkspaceTransaction(
        input.db,
        { workspaceId, role: 'system' },
        async (trx) => {
          await trx
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
        { applySession: input.applyWorkspaceSession },
      );
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
      const updated = await withWorkspaceTransaction(
        input.db,
        { workspaceId, role: 'system' },
        (trx) => trx
          .updateTable('users')
          .set({
            mfa_enabled: true,
            mfa_method: 'totp',
            mfa_totp_secret_id: stored.id,
            updated_at: now(),
          })
          .where('id', '=', userId)
          .where('workspace_id', '=', workspaceId)
          .returning('id')
          .executeTakeFirst(),
        { applySession: input.applyWorkspaceSession },
      );
      if (!updated) {
        await input.secrets.deleteSecret({
          workspaceId,
          kind: 'auth_mfa_totp',
          name: userId,
        });
        return false;
      }
      await input.secrets.deleteSecret({
        workspaceId,
        kind: 'auth_mfa_totp_pending',
        name: userId,
      });
      return true;
    },

    async enableEmailMfa({ workspaceId, userId }) {
      await withWorkspaceTransaction(
        input.db,
        { workspaceId, role: 'system' },
        async (trx) => {
          await trx
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
        { applySession: input.applyWorkspaceSession },
      );
    },

    async disableUserMfa({ workspaceId, userId }) {
      await input.secrets.deleteSecret({ workspaceId, kind: 'auth_mfa_totp', name: userId });
      await input.secrets.deleteSecret({ workspaceId, kind: 'auth_mfa_totp_pending', name: userId });
      await withWorkspaceTransaction(
        input.db,
        { workspaceId, role: 'system' },
        async (trx) => {
          await trx
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
        { applySession: input.applyWorkspaceSession },
      );
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

async function lookupUserEmail(
  db: Kysely<ServerDatabase>,
  workspaceId: string,
  userId: string,
  applyWorkspaceSession?: WorkspaceSessionApplier,
): Promise<string | null> {
  const row = await withWorkspaceTransaction(
    db,
    { workspaceId, role: 'system' },
    (trx) => trx
      .selectFrom('users')
      .select(['email'])
      .where('workspace_id', '=', workspaceId)
      .where('id', '=', userId)
      .executeTakeFirst(),
    { applySession: applyWorkspaceSession },
  );
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
  applyWorkspaceSession?: WorkspaceSessionApplier;
}): Promise<boolean> {
  const smtp = input.smtp;
  if (!smtp || input.user.mfaMethod !== 'email') return false;
  let reservation:
    | { kind: 'existing' }
    | { kind: 'new'; id: string; code: string; supersededIds: string[] };
  try {
    reservation = await withWorkspaceTransaction(
      input.db,
      { workspaceId: input.user.workspaceId, role: 'system' },
      async (trx) => {
        const lockedUser = await trx
          .selectFrom('users')
          .select('id')
          .where('id', '=', input.user.id)
          .forUpdate()
          .executeTakeFirst();
        if (!lockedUser) throw new Error('MFA-Benutzer wurde nicht gefunden');

        const pending = await trx
          .selectFrom('auth_mfa_email_codes')
          .select('id')
          .where('workspace_id', '=', input.user.workspaceId)
          .where('user_id', '=', input.user.id)
          .where('delivery_status', '=', 'pending')
          .where('consumed_at', 'is', null)
          .where('expires_at', '>', input.now)
          .orderBy('created_at', 'desc')
          .executeTakeFirst();
        if (pending) return { kind: 'existing' } as const;

        // A process crash can leave an expired pending reservation and its
        // formerly-active codes held. Retire those holds before issuing again.
        await trx
          .updateTable('auth_mfa_email_codes')
          .set({ consumed_at: input.now })
          .where('workspace_id', '=', input.user.workspaceId)
          .where('user_id', '=', input.user.id)
          .where('delivery_status', '=', 'superseded')
          .where('consumed_at', 'is', null)
          .execute();

        const previousCodes = await trx
          .selectFrom('auth_mfa_email_codes')
          .select('id')
          .where('workspace_id', '=', input.user.workspaceId)
          .where('user_id', '=', input.user.id)
          .where('delivery_status', '=', 'sent')
          .where('consumed_at', 'is', null)
          .execute();
        const supersededIds = previousCodes.map((row) => row.id);
        if (supersededIds.length > 0) {
          await trx
            .updateTable('auth_mfa_email_codes')
            .set({ delivery_status: 'superseded' })
            .where('workspace_id', '=', input.user.workspaceId)
            .where('user_id', '=', input.user.id)
            .where('id', 'in', supersededIds)
            .where('delivery_status', '=', 'sent')
            .where('consumed_at', 'is', null)
            .execute();
        }

        const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
        const expiresAt = new Date(input.now.getTime() + 10 * 60 * 1000);
        const inserted = await trx
          .insertInto('auth_mfa_email_codes')
          .values({
            workspace_id: input.user.workspaceId,
            user_id: input.user.id,
            code_hash: hashEmailCode(code),
            delivery_status: 'pending',
            expires_at: expiresAt,
          })
          .returning('id')
          .executeTakeFirst();
        if (!inserted) throw new Error('MFA-Code konnte nicht reserviert werden');
        return { kind: 'new', id: inserted.id, code, supersededIds } as const;
      },
      { applySession: input.applyWorkspaceSession },
    );
  } catch {
    return false;
  }

  // A concurrent request already owns delivery of this still-valid code. Its
  // challenge can safely share the code once that owner marks it as sent.
  if (reservation.kind === 'existing') return true;

  try {
    await sendMfaEmailCode({
      smtp,
      email: input.user.email,
      displayName: input.user.displayName,
      code: reservation.code,
      now: input.now,
    });
  } catch {
    try {
      await withWorkspaceTransaction(
        input.db,
        { workspaceId: input.user.workspaceId, role: 'system' },
        async (trx) => {
          await trx
            .updateTable('auth_mfa_email_codes')
            .set({ delivery_status: 'failed', consumed_at: input.now })
            .where('workspace_id', '=', input.user.workspaceId)
            .where('user_id', '=', input.user.id)
            .where('id', '=', reservation.id)
            .where('delivery_status', '=', 'pending')
            .execute();
          if (reservation.supersededIds.length > 0) {
            await trx
              .updateTable('auth_mfa_email_codes')
              .set({ delivery_status: 'sent', consumed_at: null })
              .where('workspace_id', '=', input.user.workspaceId)
              .where('user_id', '=', input.user.id)
              .where('id', 'in', reservation.supersededIds)
              .where('delivery_status', '=', 'superseded')
              .execute();
          }
        },
        { applySession: input.applyWorkspaceSession },
      );
    } catch {
      // The login still fails closed; an expired pending reservation is ignored.
    }
    return false;
  }

  try {
    await withWorkspaceTransaction(
      input.db,
      { workspaceId: input.user.workspaceId, role: 'system' },
      async (trx) => {
        const lockedUser = await trx
          .selectFrom('users')
          .select('id')
          .where('id', '=', input.user.id)
          .forUpdate()
          .executeTakeFirst();
        if (!lockedUser) throw new Error('MFA-Benutzer wurde nicht gefunden');

        if (reservation.supersededIds.length > 0) {
          await trx
            .updateTable('auth_mfa_email_codes')
            .set({ consumed_at: input.now })
            .where('workspace_id', '=', input.user.workspaceId)
            .where('user_id', '=', input.user.id)
            .where('id', 'in', reservation.supersededIds)
            .where('delivery_status', '=', 'superseded')
            .where('consumed_at', 'is', null)
            .execute();
        }
        await trx
          .updateTable('auth_mfa_email_codes')
          .set({ delivery_status: 'sent' })
          .where('workspace_id', '=', input.user.workspaceId)
          .where('user_id', '=', input.user.id)
          .where('id', '=', reservation.id)
          .where('delivery_status', '=', 'pending')
          .where('consumed_at', 'is', null)
          .execute();
      },
      { applySession: input.applyWorkspaceSession },
    );
  } catch {
    return false;
  }
  return true;
}

async function verifyEmailMfaCode(input: {
  db: Kysely<ServerDatabase>;
  workspaceId: string;
  userId: string;
  code: string;
  now: Date;
  applyWorkspaceSession?: WorkspaceSessionApplier;
}): Promise<boolean> {
  const normalized = input.code.trim();
  if (!/^\d{6}$/.test(normalized)) return false;
  const codeHash = hashEmailCode(normalized);
  const row = await withWorkspaceTransaction(
    input.db,
    { workspaceId: input.workspaceId, role: 'system' },
    async (trx) => trx
      .updateTable('auth_mfa_email_codes')
      .set({ consumed_at: input.now })
      .where('workspace_id', '=', input.workspaceId)
      .where('user_id', '=', input.userId)
      .where('code_hash', '=', codeHash)
      .where('delivery_status', '=', 'sent')
      .where('consumed_at', 'is', null)
      .where('expires_at', '>', input.now)
      .returning(['id'])
      .executeTakeFirst(),
    { applySession: input.applyWorkspaceSession },
  );
  return Boolean(row);
}

function hashEmailCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}
