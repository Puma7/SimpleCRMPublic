import { createHash, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

import { sql as kyselySql, type Kysely, type Transaction } from 'kysely';

import { calculateLoginPenalty } from '../auth';
import {
  createAccessToken,
  hashRefreshToken,
  verifyRefreshTokenHash,
  type AccessTokenSigner,
} from '../security';
import type {
  AuthApiPort,
  AuthenticatedPrincipal,
  AuthInvitationLookupResult,
  AuthInvitationRecord,
  AuthUserRecord,
  TokenPair,
} from '../api';
import type { AuthInvitationRow, ServerDatabase, UserRow } from './schema';
import { withWorkspaceTransaction, type WorkspaceSessionApplier } from './workspace-context';

const scrypt = promisify(scryptCallback);

export const PASSWORD_HASH_PREFIX = 'scrypt:v1';
export const REFRESH_TOKEN_BYTES = 32;
export const INVITATION_TOKEN_BYTES = 32;
export const DEFAULT_INVITATION_TTL_DAYS = 7;
export const MAX_INVITATION_TTL_DAYS = 30;
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const REFRESH_TOKEN_TTL_DAYS = 30;
const INITIAL_OWNER_SETUP_LOCK_KEY = 'simplecrm.initial_owner_setup';
const AUTH_INVITATION_EMAIL_LOCK_PREFIX = 'simplecrm.auth_invitation.email';

export type PostgresAuthPortOptions = Readonly<{
  db: Kysely<ServerDatabase>;
  accessTokenSigner: AccessTokenSigner;
  now?: () => Date;
  applyWorkspaceSession?: WorkspaceSessionApplier;
}>;

export function createPostgresAuthPort(options: PostgresAuthPortOptions): AuthApiPort {
  const now = options.now ?? (() => new Date());

  return {
    async getInitialSetupState() {
      const existing = await selectAnyUserAcrossWorkspaces(options.db, options.applyWorkspaceSession);
      return {
        needsInitialSetup: !existing,
      };
    },

    async createInitialOwner(input) {
      const existing = await selectAnyUserAcrossWorkspaces(options.db, options.applyWorkspaceSession);
      if (existing) return { ok: false, code: 'already_configured' };

      const workspaceId = randomUUID();
      const passwordHash = await hashPassword(input.password);
      return withWorkspaceTransaction(
        options.db,
        { workspaceId, role: 'system', crossWorkspaceAccess: true },
        async (trx) => {
          await acquireInitialSetupLock(trx);
          const raced = await selectAnyUser(trx);
          if (raced) return { ok: false as const, code: 'already_configured' as const };

          await trx
            .insertInto('workspaces')
            .values({
              id: workspaceId,
              name: input.workspaceName,
            })
            .execute();

          const created = await trx
            .insertInto('users')
            .values({
              workspace_id: workspaceId,
              email: input.email,
              display_name: input.displayName,
              password_hash: passwordHash,
              role: 'owner',
            })
            .returning([
              'id',
              'workspace_id',
              'email',
              'display_name',
              'role',
              'password_hash',
              'disabled_at',
            ])
            .executeTakeFirst();

          if (!created) {
            throw new Error('Failed to create initial owner');
          }

          const user = mapUser(created);
          return {
            ok: true as const,
            user,
            tokens: await issueTokenPair(
              trx as unknown as Kysely<ServerDatabase>,
              options.accessTokenSigner,
              user,
              input.device,
              now(),
            ),
          };
        },
        { applySession: options.applyWorkspaceSession },
      );
    },

    async listUsers(input) {
      const rows = await withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'admin' },
        async (trx) => trx
          .selectFrom('users')
          .select([
            'id',
            'email',
            'display_name',
            'public_name',
            'role',
            'disabled_at',
            'login_pin_enabled',
            'mfa_enabled',
            'mfa_method',
            'created_at',
            'updated_at',
          ])
          .orderBy('email', 'asc')
          .execute(),
        { applySession: options.applyWorkspaceSession },
      );
      return rows.map(mapAdminUser);
    },

    async saveUser(input) {
      return withWorkspaceTransaction(
        options.db,
        {
          workspaceId: input.workspaceId,
          userId: input.actorUserId,
          role: 'admin',
        },
        async (trx) => {
          const duplicate = await selectUserByEmail(trx, input.workspaceId, input.email, input.id);
          if (duplicate) return { ok: false as const, code: 'duplicate_email' as const };

          if (!input.id) {
            if (!input.password) return { ok: false as const, code: 'password_required' as const };
            const created = await trx
              .insertInto('users')
              .values({
                workspace_id: input.workspaceId,
                email: input.email,
                display_name: input.displayName,
                public_name: input.publicName ?? null,
                password_hash: await hashPassword(input.password),
                role: input.role,
                disabled_at: input.isActive === false ? now() : null,
                updated_at: now(),
              })
              .returning([
                'id',
                'email',
                'display_name',
                'public_name',
                'role',
                'disabled_at',
                'created_at',
                'updated_at',
              ])
              .executeTakeFirst();
            if (!created) throw new Error('Failed to create auth user');
            return { ok: true as const, user: mapAdminUser(created) };
          }

          const existing = await selectUserById(trx, input.workspaceId, input.id);
          if (!existing) return { ok: false as const, code: 'not_found' as const };

          const nextActive = input.isActive !== false;
          if (existing.role === 'owner' && (input.role !== 'owner' || !nextActive)) {
            const otherOwnerCount = await countActiveOwners(trx, input.workspaceId, input.id);
            if (otherOwnerCount < 1) {
              return { ok: false as const, code: 'last_owner_required' as const };
            }
          }

          const updated = await trx
            .updateTable('users')
            .set({
              email: input.email,
              display_name: input.displayName,
              role: input.role,
              disabled_at: input.isActive === false ? now() : null,
              updated_at: now(),
              ...(input.publicName === undefined ? {} : { public_name: input.publicName }),
              ...(input.password ? { password_hash: await hashPassword(input.password) } : {}),
            })
            .where('id', '=', input.id)
            .where('workspace_id', '=', input.workspaceId)
            .returning([
              'id',
              'email',
              'display_name',
              'public_name',
              'role',
              'disabled_at',
              'created_at',
              'updated_at',
            ])
            .executeTakeFirst();
          if (!updated) return { ok: false as const, code: 'not_found' as const };
          return { ok: true as const, user: mapAdminUser(updated) };
        },
        { applySession: options.applyWorkspaceSession },
      );
    },

    async deleteUser(input) {
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'admin' },
        async (trx) => {
          const existing = await selectUserById(trx, input.workspaceId, input.id);
          if (!existing) return { ok: false as const, code: 'not_found' as const };
          if (existing.role === 'owner') {
            const otherOwnerCount = await countActiveOwners(trx, input.workspaceId, input.id);
            if (otherOwnerCount < 1) return { ok: false as const, code: 'last_owner_required' as const };
          }
          // refresh_tokens / user_account_access cascade on user delete; drop
          // tokens explicitly so any active session is invalidated immediately.
          await trx
            .deleteFrom('refresh_tokens')
            .where('workspace_id', '=', input.workspaceId)
            .where('user_id', '=', input.id)
            .execute();
          await trx
            .deleteFrom('users')
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.id)
            .execute();
          return { ok: true as const };
        },
        { applySession: options.applyWorkspaceSession },
      );
    },

    async changePassword(input) {
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, userId: input.userId, role: 'user' },
        async (trx) => {
          const row = await trx
            .selectFrom('users')
            .select(['id', 'password_hash'])
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.userId)
            .executeTakeFirst();
          if (!row) return { ok: false as const, code: 'not_found' as const };
          const valid = await verifyPasswordHash(input.currentPassword, row.password_hash);
          if (!valid) return { ok: false as const, code: 'invalid_current' as const };
          await trx
            .updateTable('users')
            .set({ password_hash: await hashPassword(input.newPassword), updated_at: now() })
            .where('id', '=', input.userId)
            .where('workspace_id', '=', input.workspaceId)
            .execute();
          return { ok: true as const };
        },
        { applySession: options.applyWorkspaceSession },
      );
    },

    async createInvitation(input) {
      const token = randomToken(INVITATION_TOKEN_BYTES);
      const tokenHash = hashInvitationToken(token);
      const expiresInDays = Math.min(
        Math.max(input.expiresInDays ?? DEFAULT_INVITATION_TTL_DAYS, 1),
        MAX_INVITATION_TTL_DAYS,
      );
      const expiresAt = new Date(now().getTime() + expiresInDays * 24 * 60 * 60 * 1000);

      return withWorkspaceTransaction(
        options.db,
        {
          workspaceId: input.workspaceId,
          userId: input.actorUserId,
          role: 'admin',
        },
        async (trx) => {
          await acquireInvitationEmailLock(trx, input.workspaceId, input.email);

          const existingUser = await selectUserByEmail(trx, input.workspaceId, input.email);
          if (existingUser) return { ok: false as const, code: 'duplicate_email' as const };

          const openInvite = await trx
            .selectFrom('auth_invitations')
            .select(['id'])
            .where('workspace_id', '=', input.workspaceId)
            .where(kyselySql<boolean>`lower(email) = ${normalizeAuthEmail(input.email)}`)
            .where('accepted_at', 'is', null)
            .where('revoked_at', 'is', null)
            .where('expires_at', '>', now())
            .executeTakeFirst();
          if (openInvite) return { ok: false as const, code: 'duplicate_invitation' as const };

          const created = await trx
            .insertInto('auth_invitations')
            .values({
              workspace_id: input.workspaceId,
              email: input.email,
              display_name: input.displayName,
              role: input.role,
              token_hash: tokenHash,
              invited_by_user_id: input.actorUserId,
              expires_at: expiresAt,
              updated_at: now(),
            })
            .returning([
              'id',
              'email',
              'display_name',
              'role',
              'invited_by_user_id',
              'accepted_user_id',
              'expires_at',
              'accepted_at',
              'revoked_at',
              'created_at',
            ])
            .executeTakeFirst();
          if (!created) throw new Error('Failed to create auth invitation');
          return {
            ok: true as const,
            invitation: mapInvitation(created),
            token,
          };
        },
        { applySession: options.applyWorkspaceSession },
      );
    },

    async getInvitationByToken(input) {
      return withCrossWorkspaceAuthTransaction(options.db, options.applyWorkspaceSession, async (trx) => {
        const invite = await selectInvitationByToken(trx, input.token);
        return invitationLookupResult(invite, now());
      });
    },

    async acceptInvitation(input) {
      return withCrossWorkspaceAuthTransaction(options.db, options.applyWorkspaceSession, async (trx) => {
        const invite = await selectInvitationByToken(trx, input.token);
        const lookup = invitationLookupResult(invite, now());
        if (!lookup.ok) return lookup;

        const existingUser = await selectUserByEmail(trx, invite!.workspace_id, invite!.email);
        if (existingUser) return { ok: false as const, code: 'duplicate_email' as const };

        const created = await trx
          .insertInto('users')
          .values({
            workspace_id: invite!.workspace_id,
            email: invite!.email,
            display_name: invite!.display_name,
            password_hash: await hashPassword(input.password),
            role: invite!.role,
            updated_at: now(),
          })
          .returning([
            'id',
            'workspace_id',
            'email',
            'display_name',
            'role',
            'password_hash',
            'disabled_at',
          ])
          .executeTakeFirst();
        if (!created) throw new Error('Failed to accept auth invitation');

        await trx
          .updateTable('auth_invitations')
          .set({
            accepted_at: now(),
            accepted_user_id: created.id,
            updated_at: now(),
          })
          .where('id', '=', invite!.id)
          .where('accepted_at', 'is', null)
          .execute();

        const user = mapUser(created);
        return {
          ok: true as const,
          user,
          tokens: await issueTokenPair(
            trx as unknown as Kysely<ServerDatabase>,
            options.accessTokenSigner,
            user,
            input.device,
            now(),
          ),
        };
      });
    },

    async resolveAccessTokenPrincipal(input) {
      return withCrossWorkspaceAuthTransaction(options.db, options.applyWorkspaceSession, async (trx) => (
        resolveAccessTokenPrincipal(trx as unknown as Kysely<ServerDatabase>, input.principal, now())
      ));
    },

    async findUserByEmail(email) {
      const user = await withCrossWorkspaceAuthTransaction(
        options.db,
        options.applyWorkspaceSession,
        async (trx) => trx
          .selectFrom('users')
          .selectAll()
          .where('email', '=', email)
          .executeTakeFirst(),
      );

      return user ? mapUser(user) : null;
    },

    async verifyPassword(password, passwordHash) {
      return verifyPasswordHash(password, passwordHash);
    },

    async checkLoginLock(input) {
      const row = await options.db
        .selectFrom('auth_login_failures')
        .select(['failed_attempts', 'lock_until', 'penalty_kind'])
        .where('email_normalized', '=', input.email.toLowerCase())
        .where('ip_address', '=', input.ip)
        .executeTakeFirst();

      if (!row) return null;
      if (row.penalty_kind === 'permanent') return { kind: 'permanent' };
      if (!row.lock_until) return null;

      const lockMs = toDate(row.lock_until).getTime() - now().getTime();
      if (lockMs <= 0) return null;

      return {
        kind: 'temporary',
        lockSeconds: Math.max(1, Math.ceil(lockMs / 1000)),
      };
    },

    async recordFailedLogin(input) {
      return withCrossWorkspaceAuthTransaction(
        options.db,
        options.applyWorkspaceSession,
        async (trx) => {
          const penalty = calculateLoginPenalty(1);
          const lockUntil = penalty.kind === 'temporary'
            ? new Date(now().getTime() + penalty.lockSeconds * 1000)
            : null;
          const row = await trx
            .insertInto('auth_login_failures')
            .values({
              workspace_id: null,
              user_id: input.userId ?? null,
              email_normalized: input.email.toLowerCase(),
              ip_address: input.ip,
              failed_at: now(),
              failed_attempts: 1,
              penalty_kind: penalty.kind,
              lock_until: lockUntil,
              user_agent: null,
            })
            .onConflict((oc) => oc.columns(['email_normalized', 'ip_address']).doUpdateSet((eb) => ({
              failed_attempts: eb('auth_login_failures.failed_attempts', '+', 1),
              failed_at: now(),
              user_id: input.userId ?? null,
            })))
            .returning(['failed_attempts'])
            .executeTakeFirst();

          const failedAttempts = row?.failed_attempts ?? 1;
          const updatedPenalty = calculateLoginPenalty(failedAttempts);
          await trx
            .updateTable('auth_login_failures')
            .set({
              penalty_kind: updatedPenalty.kind,
              lock_until: updatedPenalty.kind === 'temporary'
                ? new Date(now().getTime() + updatedPenalty.lockSeconds * 1000)
                : null,
            })
            .where('email_normalized', '=', input.email.toLowerCase())
            .where('ip_address', '=', input.ip)
            .execute();

          return failedAttempts;
        },
      );
    },

    async recordSuccessfulLogin(input) {
      await options.db
        .deleteFrom('auth_login_failures')
        .where('email_normalized', '=', input.email.toLowerCase())
        .where('ip_address', '=', input.ip)
        .execute();
    },

    async issueTokenPair(input) {
      return withWorkspaceTransaction(
        options.db,
        {
          workspaceId: input.user.workspaceId,
          userId: input.user.id,
          role: input.user.role,
        },
        async (trx) => issueTokenPair(
          trx as unknown as Kysely<ServerDatabase>,
          options.accessTokenSigner,
          input.user,
          input.device,
          now(),
        ),
        { applySession: options.applyWorkspaceSession },
      );
    },

    async rotateRefreshToken(input) {
      const tokenHash = hashRefreshToken(input.refreshToken);
      return withCrossWorkspaceAuthTransaction(options.db, options.applyWorkspaceSession, async (trx) => {
        const existing = await trx
          .selectFrom('refresh_tokens')
          .innerJoin('users', 'users.id', 'refresh_tokens.user_id')
          .select([
            'refresh_tokens.id as token_id',
            'refresh_tokens.token_hash as token_hash',
            'refresh_tokens.expires_at as expires_at',
            'refresh_tokens.revoked_at as revoked_at',
            'users.id as user_id',
            'users.workspace_id as workspace_id',
            'users.email as email',
            'users.display_name as display_name',
            'users.public_name as public_name',
            'users.password_hash as password_hash',
            'users.role as role',
            'users.disabled_at as disabled_at',
          ])
          .where('refresh_tokens.token_hash', '=', tokenHash)
          .executeTakeFirst();

        if (
          !existing
          || existing.revoked_at
          || existing.disabled_at
          || toDate(existing.expires_at).getTime() <= now().getTime()
        ) {
          return null;
        }
        if (!verifyRefreshTokenHash(input.refreshToken, existing.token_hash)) {
          return null;
        }

        const revokedAt = now();
        const revokeResult = await trx
          .updateTable('refresh_tokens')
          .set({ revoked_at: revokedAt })
          .where('id', '=', existing.token_id)
          .where('revoked_at', 'is', null)
          .executeTakeFirst();
        if (Number(revokeResult.numUpdatedRows) < 1) {
          return null;
        }

        const user: AuthUserRecord = {
          id: existing.user_id,
          workspaceId: existing.workspace_id,
          email: existing.email,
          displayName: existing.display_name,
          publicName: existing.public_name ?? null,
          role: existing.role,
          passwordHash: existing.password_hash,
          disabledAt: existing.disabled_at ? toDate(existing.disabled_at).toISOString() : null,
        };

        return {
          user,
          tokens: await issueTokenPair(
            trx as unknown as Kysely<ServerDatabase>,
            options.accessTokenSigner,
            user,
            undefined,
            now(),
          ),
        };
      });
    },

    async revokeRefreshToken(input) {
      const tokenHash = hashRefreshToken(input.refreshToken);
      const result = await withCrossWorkspaceAuthTransaction(
        options.db,
        options.applyWorkspaceSession,
        async (trx) => trx
          .updateTable('refresh_tokens')
          .set({ revoked_at: now() })
          .where('token_hash', '=', tokenHash)
          .where('revoked_at', 'is', null)
          .executeTakeFirst(),
      );

      return Number(result.numUpdatedRows) > 0;
    },
  };
}

export async function hashPassword(password: string, salt = randomToken(16)): Promise<string> {
  if (!password) throw new Error('password is required');
  const derived = await scrypt(password, salt, 64) as Buffer;
  return `${PASSWORD_HASH_PREFIX}:${salt}:${derived.toString('base64')}`;
}

export async function verifyPasswordHash(password: string, encoded: string): Promise<boolean> {
  const parts = encoded.split(':');
  if (parts.length !== 4 || `${parts[0]}:${parts[1]}` !== PASSWORD_HASH_PREFIX) {
    return false;
  }
  const [, , salt, hash] = parts;
  const actual = await scrypt(password, salt, 64) as Buffer;
  const expected = Buffer.from(hash, 'base64');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

async function issueTokenPair(
  db: Kysely<ServerDatabase>,
  signer: AccessTokenSigner,
  user: AuthUserRecord,
  device: string | undefined,
  now: Date,
): Promise<TokenPair> {
  const refreshToken = randomToken(REFRESH_TOKEN_BYTES);
  const expiresAt = new Date(now.getTime() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);

  const created = await db
    .insertInto('refresh_tokens')
    .values({
      user_id: user.id,
      workspace_id: user.workspaceId,
      token_hash: hashRefreshToken(refreshToken),
      device: device ?? null,
      expires_at: expiresAt,
    })
    .returning(['id'])
    .executeTakeFirst();
  if (!created) {
    throw new Error('Failed to create refresh-token session');
  }

  return {
    accessToken: createAccessToken({
      signer,
      principal: {
        userId: user.id,
        workspaceId: user.workspaceId,
        role: user.role,
        sessionId: created.id,
      },
      issuedAt: now,
      expiresInSeconds: ACCESS_TOKEN_TTL_SECONDS,
    }),
    refreshToken,
    expiresInSeconds: ACCESS_TOKEN_TTL_SECONDS,
  };
}

async function resolveAccessTokenPrincipal(
  db: Kysely<ServerDatabase>,
  principal: AuthenticatedPrincipal,
  now: Date,
): Promise<AuthenticatedPrincipal | null> {
  if (!principal.sessionId) return null;

  const existing = await db
    .selectFrom('refresh_tokens')
    .innerJoin('users', 'users.id', 'refresh_tokens.user_id')
    .select([
      'refresh_tokens.id as token_id',
      'refresh_tokens.expires_at as expires_at',
      'refresh_tokens.revoked_at as revoked_at',
      'users.id as user_id',
      'users.workspace_id as workspace_id',
      'users.role as role',
      'users.disabled_at as disabled_at',
    ])
    .where('refresh_tokens.id', '=', principal.sessionId)
    .where('refresh_tokens.user_id', '=', principal.userId)
    .where('refresh_tokens.workspace_id', '=', principal.workspaceId)
    .executeTakeFirst();

  if (
    !existing
    || existing.revoked_at
    || existing.disabled_at
    || toDate(existing.expires_at).getTime() <= now.getTime()
  ) {
    return null;
  }

  return {
    userId: existing.user_id,
    workspaceId: existing.workspace_id,
    role: existing.role,
    sessionId: existing.token_id,
  };
}

function mapUser(row: {
  id: string;
  workspace_id: string;
  email: string;
  display_name: string;
  public_name?: string | null;
  role: UserRow['role'];
  password_hash: string;
  disabled_at: UserRow['disabled_at'];
  login_pin_hash?: string | null;
  login_pin_enabled?: boolean;
  mfa_enabled?: boolean;
  mfa_method?: UserRow['mfa_method'];
  mfa_totp_secret_id?: string | null;
}): AuthUserRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    email: row.email,
    displayName: row.display_name,
    publicName: row.public_name ?? null,
    role: row.role,
    passwordHash: row.password_hash,
    disabledAt: row.disabled_at ? toDate(row.disabled_at).toISOString() : null,
    loginPinHash: row.login_pin_hash ?? null,
    loginPinEnabled: Boolean(row.login_pin_enabled),
    mfaEnabled: Boolean(row.mfa_enabled),
    mfaMethod: row.mfa_method ?? null,
    mfaTotpSecretId: row.mfa_totp_secret_id ?? null,
  };
}

function mapAdminUser(row: {
  id: string;
  email: string;
  display_name: string;
  public_name?: string | null;
  role: UserRow['role'];
  disabled_at: UserRow['disabled_at'];
  login_pin_enabled?: boolean;
  mfa_enabled?: boolean;
  mfa_method?: UserRow['mfa_method'];
  created_at?: UserRow['created_at'];
  updated_at?: UserRow['updated_at'];
}) {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    publicName: row.public_name ?? null,
    role: row.role,
    disabledAt: row.disabled_at ? toDate(row.disabled_at).toISOString() : null,
    loginPinEnabled: Boolean(row.login_pin_enabled),
    mfaEnabled: Boolean(row.mfa_enabled),
    mfaMethod: row.mfa_method ?? null,
    createdAt: row.created_at ? toDate(row.created_at).toISOString() : null,
    updatedAt: row.updated_at ? toDate(row.updated_at).toISOString() : null,
  };
}

function mapInvitation(row: Pick<
  AuthInvitationRow,
  | 'id'
  | 'email'
  | 'display_name'
  | 'role'
  | 'invited_by_user_id'
  | 'accepted_user_id'
  | 'expires_at'
  | 'accepted_at'
  | 'revoked_at'
  | 'created_at'
>): AuthInvitationRecord {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    invitedByUserId: row.invited_by_user_id,
    acceptedUserId: row.accepted_user_id,
    expiresAt: toDate(row.expires_at).toISOString(),
    acceptedAt: row.accepted_at ? toDate(row.accepted_at).toISOString() : null,
    revokedAt: row.revoked_at ? toDate(row.revoked_at).toISOString() : null,
    createdAt: row.created_at ? toDate(row.created_at).toISOString() : null,
  };
}

async function selectAnyUser(db: Kysely<ServerDatabase> | Transaction<ServerDatabase>): Promise<{ id: string } | undefined> {
  return db
    .selectFrom('users')
    .select(['id'])
    .limit(1)
    .executeTakeFirst();
}

async function acquireInitialSetupLock(db: Transaction<ServerDatabase>): Promise<void> {
  await kyselySql`SELECT pg_advisory_xact_lock(hashtext(${INITIAL_OWNER_SETUP_LOCK_KEY}))`.execute(db);
}

async function acquireInvitationEmailLock(
  db: Transaction<ServerDatabase>,
  workspaceId: string,
  email: string,
): Promise<void> {
  await kyselySql`SELECT pg_advisory_xact_lock(hashtext(${invitationEmailLockKey(workspaceId, email)}))`.execute(db);
}

function invitationEmailLockKey(workspaceId: string, email: string): string {
  return `${AUTH_INVITATION_EMAIL_LOCK_PREFIX}:${workspaceId}:${normalizeAuthEmail(email)}`;
}

async function selectAnyUserAcrossWorkspaces(
  db: Kysely<ServerDatabase>,
  applyWorkspaceSession?: WorkspaceSessionApplier,
): Promise<{ id: string } | undefined> {
  return withWorkspaceTransaction(
    db,
    { workspaceId: randomUUID(), role: 'system', crossWorkspaceAccess: true },
    selectAnyUser,
    { applySession: applyWorkspaceSession },
  );
}

async function withCrossWorkspaceAuthTransaction<T>(
  db: Kysely<ServerDatabase>,
  applyWorkspaceSession: WorkspaceSessionApplier | undefined,
  run: (trx: Transaction<ServerDatabase>) => Promise<T>,
): Promise<T> {
  return withWorkspaceTransaction(
    db,
    { workspaceId: randomUUID(), role: 'system', crossWorkspaceAccess: true },
    run,
    { applySession: applyWorkspaceSession },
  );
}

async function selectUserById(
  db: Kysely<ServerDatabase> | Transaction<ServerDatabase>,
  workspaceId: string,
  id: string,
): Promise<Pick<UserRow, 'id' | 'role' | 'disabled_at'> | undefined> {
  return db
    .selectFrom('users')
    .select(['id', 'role', 'disabled_at'])
    .where('workspace_id', '=', workspaceId)
    .where('id', '=', id)
    .executeTakeFirst();
}

type InvitationLookupRow = Pick<
  AuthInvitationRow,
  | 'id'
  | 'workspace_id'
  | 'email'
  | 'display_name'
  | 'role'
  | 'invited_by_user_id'
  | 'accepted_user_id'
  | 'expires_at'
  | 'accepted_at'
  | 'revoked_at'
  | 'created_at'
>;

async function selectInvitationByToken(
  db: Kysely<ServerDatabase> | Transaction<ServerDatabase>,
  token: string,
): Promise<InvitationLookupRow | undefined> {
  if (!token.trim()) return undefined;
  return db
    .selectFrom('auth_invitations')
    .select([
      'id',
      'workspace_id',
      'email',
      'display_name',
      'role',
      'invited_by_user_id',
      'accepted_user_id',
      'expires_at',
      'accepted_at',
      'revoked_at',
      'created_at',
    ])
    .where('token_hash', '=', hashInvitationToken(token))
    .executeTakeFirst();
}

function invitationLookupResult(
  invite: InvitationLookupRow | undefined,
  now: Date,
): AuthInvitationLookupResult {
  if (!invite) return { ok: false, code: 'invalid_token' };
  if (invite.revoked_at) return { ok: false, code: 'revoked' };
  if (invite.accepted_at) return { ok: false, code: 'accepted' };
  if (toDate(invite.expires_at).getTime() <= now.getTime()) return { ok: false, code: 'expired' };
  return { ok: true, invitation: mapInvitation(invite) };
}

async function selectUserByEmail(
  db: Kysely<ServerDatabase> | Transaction<ServerDatabase>,
  workspaceId: string,
  email: string,
  exceptId?: string,
): Promise<{ id: string } | undefined> {
  let query = db
    .selectFrom('users')
    .select(['id'])
    .where('workspace_id', '=', workspaceId)
    .where(kyselySql<boolean>`lower(email) = ${normalizeAuthEmail(email)}`);
  if (exceptId) {
    query = query.where('id', '!=', exceptId);
  }
  return query.executeTakeFirst();
}

function normalizeAuthEmail(email: string): string {
  return email.trim().toLowerCase();
}

async function countActiveOwners(
  db: Kysely<ServerDatabase> | Transaction<ServerDatabase>,
  workspaceId: string,
  exceptId: string,
): Promise<number> {
  const row = await db
    .selectFrom('users')
    .select((eb) => eb.fn.countAll<number>().as('count'))
    .where('workspace_id', '=', workspaceId)
    .where('role', '=', 'owner')
    .where('disabled_at', 'is', null)
    .where('id', '!=', exceptId)
    .executeTakeFirst();
  return Number(row?.count ?? 0);
}

function randomToken(bytes: number): string {
  return randomBytes(bytes).toString('base64url');
}

function hashInvitationToken(token: string): string {
  const trimmed = token.trim();
  if (!trimmed) throw new Error('invitation token is required');
  return createHash('sha256').update(trimmed, 'utf8').digest('hex');
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}
