import type { Kysely } from 'kysely';

import { handleAuthRoute } from '../../packages/server/src/api/auth-routes';
import { csrfTokenForRefreshToken } from '../../packages/server/src/api/auth-session-cookie';
import type {
  ApiRequest,
  AuthApiPort,
  AuthUserRecord,
  ServerApiPorts,
  TokenPair,
} from '../../packages/server/src/api/types';
import { createPostgresAuthPort, hashPassword } from '../../packages/server/src/db/postgres-auth-port';
import type { ServerDatabase } from '../../packages/server/src/db/schema';
import { verifyAccessToken, type AccessTokenSigner } from '../../packages/server/src/security/access-token';
import { startMigratedEmbeddedPostgres, type EmbeddedPostgres } from './helpers/embedded-postgres';

jest.mock('kysely', () => jest.requireActual('../../packages/server/node_modules/kysely'));

jest.setTimeout(120_000);

const WORKSPACE_ID = '10000000-0000-4000-8000-0000000000d4';
const USER_ID = '20000000-0000-4000-8000-0000000000d1';
const OTHER_USER_ID = '20000000-0000-4000-8000-0000000000d2';
const PASSWORD = 'passwort-fuer-tests-1';
const SIGNER: AccessTokenSigner = { keyId: 'test', secret: Buffer.alloc(32, 13) };

describe('refresh-token reuse detection against PostgreSQL', () => {
  let postgres: EmbeddedPostgres;
  let db: Kysely<ServerDatabase>;
  let auth: AuthApiPort;
  let clock: Date;

  beforeAll(async () => {
    postgres = await startMigratedEmbeddedPostgres('refresh-reuse');
    await postgres.admin.query(`INSERT INTO workspaces (id, name) VALUES ($1, 'Auth Test')`, [WORKSPACE_ID]);
    db = postgres.createApplicationDb();
    auth = createPostgresAuthPort({ db, accessTokenSigner: SIGNER, now: () => new Date(clock) });
  });

  afterAll(async () => {
    if (db) await db.destroy();
    if (postgres) await postgres.stop();
  });

  beforeEach(async () => {
    clock = new Date('2026-09-25T10:00:00.000Z');
    await postgres.admin.query('DELETE FROM refresh_tokens');
    await postgres.admin.query('DELETE FROM users');
    const hash = await hashPassword(PASSWORD);
    await postgres.admin.query(
      `INSERT INTO users (id, workspace_id, email, display_name, password_hash, role)
       VALUES ($1, $3, 'user@example.test', 'User', $4, 'user'),
              ($2, $3, 'other@example.test', 'Other', $4, 'user')`,
      [USER_ID, OTHER_USER_ID, WORKSPACE_ID, hash],
    );
  });

  function userRecord(id: string): AuthUserRecord {
    return {
      id,
      workspaceId: WORKSPACE_ID,
      email: id === USER_ID ? 'user@example.test' : 'other@example.test',
      displayName: 'User',
      role: 'user',
      passwordHash: '',
      disabledAt: null,
    };
  }

  function advance(ms: number) {
    clock = new Date(clock.getTime() + ms);
  }

  async function rotate(tokens: TokenPair): Promise<TokenPair> {
    const rotated = await auth.rotateRefreshToken({ refreshToken: tokens.refreshToken });
    if (!rotated || !('tokens' in rotated)) throw new Error('rotation failed');
    return rotated.tokens;
  }

  async function refreshViaRoute(refreshToken: string) {
    const record = jest.fn(async () => undefined);
    const request: ApiRequest = {
      method: 'POST',
      path: '/api/v1/auth/refresh',
      ip: '203.0.113.44',
      headers: {
        cookie: `simplecrm_refresh=${refreshToken}`,
        'x-csrf-token': csrfTokenForRefreshToken(refreshToken),
      },
    };
    const response = await handleAuthRoute(request, { auth, audit: { record } } as unknown as ServerApiPorts);
    return { response, record };
  }

  async function openSessions(userId: string): Promise<number> {
    const result = await postgres.admin.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM refresh_tokens WHERE user_id = $1 AND revoked_at IS NULL',
      [userId],
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  // F-A1-10: presenting an already rotated refresh token (the classic theft signal) was a plain 401; the thief's branch stayed valid.
  test('replaying a rotated token after the grace period revokes every session of the user and is audited', async () => {
    const stolen = await auth.issueTokenPair({ user: userRecord(USER_ID), device: 'laptop' });
    const otherDevice = await auth.issueTokenPair({ user: userRecord(USER_ID), device: 'phone' });
    const unrelated = await auth.issueTokenPair({ user: userRecord(OTHER_USER_ID) });
    const successor = await rotate(stolen);

    advance(61_000);
    const { response, record } = await refreshViaRoute(stolen.refreshToken);

    expect(response?.status).toBe(401);
    expect((response?.body as { error: { code: string } }).error.code).toBe('invalid_refresh_token');
    expect(record).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: WORKSPACE_ID,
      actorUserId: USER_ID,
      action: 'auth.refresh_token_reuse_detected',
      entityId: USER_ID,
    }));
    expect(await openSessions(USER_ID)).toBe(0);
    expect(await auth.rotateRefreshToken({ refreshToken: successor.refreshToken })).toBeNull();
    expect(await auth.rotateRefreshToken({ refreshToken: otherDevice.refreshToken })).toBeNull();
    const successorPrincipal = verifyAccessToken({ token: successor.accessToken, signer: SIGNER, now: clock });
    expect(await auth.resolveAccessTokenPrincipal!({ principal: successorPrincipal! })).toBeNull();
    expect(await openSessions(OTHER_USER_ID)).toBe(1);
    expect(await auth.rotateRefreshToken({ refreshToken: unrelated.refreshToken })).not.toBeNull();
  });

  test('within the grace period a replayed rotated token is only rejected', async () => {
    const original = await auth.issueTokenPair({ user: userRecord(USER_ID) });
    const successor = await rotate(original);

    advance(30_000);
    const { response, record } = await refreshViaRoute(original.refreshToken);

    expect(response?.status).toBe(401);
    expect(record).not.toHaveBeenCalled();
    expect(await openSessions(USER_ID)).toBe(1);
    expect(await auth.rotateRefreshToken({ refreshToken: successor.refreshToken })).not.toBeNull();
  });

  test('a logged-out token never triggers the mass revoke', async () => {
    const loggedOut = await auth.issueTokenPair({ user: userRecord(USER_ID), device: 'kiosk' });
    const otherDevice = await auth.issueTokenPair({ user: userRecord(USER_ID), device: 'phone' });
    await auth.revokeRefreshToken({ refreshToken: loggedOut.refreshToken });

    advance(61_000);
    const { response, record } = await refreshViaRoute(loggedOut.refreshToken);

    expect(response?.status).toBe(401);
    expect(record).not.toHaveBeenCalled();
    expect(await auth.rotateRefreshToken({ refreshToken: otherDevice.refreshToken })).not.toBeNull();
  });

  test('a token revoked by a password change never triggers the mass revoke', async () => {
    const current = await auth.issueTokenPair({ user: userRecord(USER_ID), device: 'laptop' });
    const revokedByChange = await auth.issueTokenPair({ user: userRecord(USER_ID), device: 'old-phone' });
    const currentSession = verifyAccessToken({ token: current.accessToken, signer: SIGNER, now: clock })!.sessionId;
    await auth.changePassword!({
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
      currentPassword: PASSWORD,
      newPassword: 'neues-passwort-fuer-tests-2',
      currentSessionId: currentSession,
    });

    advance(61_000);
    const { record } = await refreshViaRoute(revokedByChange.refreshToken);

    expect(record).not.toHaveBeenCalled();
    expect(await auth.rotateRefreshToken({ refreshToken: current.refreshToken })).not.toBeNull();
  });

  test('an expired token never triggers the mass revoke', async () => {
    const expiring = await auth.issueTokenPair({ user: userRecord(USER_ID) });
    await rotate(expiring);

    advance(31 * 24 * 60 * 60 * 1000);
    const { record } = await refreshViaRoute(expiring.refreshToken);

    expect(record).not.toHaveBeenCalled();
    // Only the rotation revoked a row; the (now expired) successor was left alone.
    expect(await openSessions(USER_ID)).toBe(1);
  });
});
