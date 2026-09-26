import type { Kysely } from 'kysely';
import { Client } from 'pg';

import { handleAuthRoute } from '../../packages/server/src/api/auth-routes';
import type {
  ApiRequest,
  AuthApiPort,
  AuthenticatedPrincipal,
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

const WORKSPACE_ID = '10000000-0000-4000-8000-0000000000b2';
const OWNER_ID = '20000000-0000-4000-8000-0000000000b1';
const MEMBER_ID = '20000000-0000-4000-8000-0000000000b2';
const OLD_PASSWORD = 'altes-passwort-123';
const NEW_PASSWORD = 'neues-passwort-456';
const SIGNER: AccessTokenSigner = { keyId: 'test', secret: Buffer.alloc(32, 7) };

describe('password change revokes other sessions against PostgreSQL', () => {
  let postgres: EmbeddedPostgres;
  let db: Kysely<ServerDatabase>;
  let auth: AuthApiPort;

  beforeAll(async () => {
    postgres = await startMigratedEmbeddedPostgres('auth-password-sessions');
    await postgres.admin.query(`INSERT INTO workspaces (id, name) VALUES ($1, 'Auth Test')`, [WORKSPACE_ID]);
    db = postgres.createApplicationDb();
    auth = createPostgresAuthPort({ db, accessTokenSigner: SIGNER });
  });

  afterAll(async () => {
    if (db) await db.destroy();
    if (postgres) await postgres.stop();
  });

  beforeEach(async () => {
    await postgres.admin.query('DELETE FROM refresh_tokens');
    await postgres.admin.query('DELETE FROM users');
    const hash = await hashPassword(OLD_PASSWORD);
    await postgres.admin.query(
      `INSERT INTO users (id, workspace_id, email, display_name, password_hash, role)
       VALUES ($1, $3, 'owner@example.test', 'Owner', $4, 'owner'),
              ($2, $3, 'member@example.test', 'Member', $4, 'user')`,
      [OWNER_ID, MEMBER_ID, WORKSPACE_ID, hash],
    );
  });

  function userRecord(id: string, role: AuthUserRecord['role']): AuthUserRecord {
    return {
      id,
      workspaceId: WORKSPACE_ID,
      email: id === OWNER_ID ? 'owner@example.test' : 'member@example.test',
      displayName: id === OWNER_ID ? 'Owner' : 'Member',
      role,
      passwordHash: '',
      disabledAt: null,
    };
  }

  function principalOf(tokens: TokenPair): AuthenticatedPrincipal {
    const principal = verifyAccessToken({ token: tokens.accessToken, signer: SIGNER });
    if (!principal?.sessionId) throw new Error('access token without session id');
    return principal;
  }

  async function sessionStillValid(tokens: TokenPair): Promise<boolean> {
    return Boolean(await auth.resolveAccessTokenPrincipal!({ principal: principalOf(tokens) }));
  }

  function ports(): ServerApiPorts {
    return { auth } as ServerApiPorts;
  }

  function request(principal: AuthenticatedPrincipal, method: ApiRequest['method'], path: string, body: unknown): ApiRequest {
    return { method, path, body, principal, ip: '203.0.113.9', headers: {} };
  }

  async function openSessionIds(userId: string): Promise<string[]> {
    const result = await postgres.admin.query<{ id: string }>(
      'SELECT id::text AS id FROM refresh_tokens WHERE user_id = $1 AND revoked_at IS NULL ORDER BY id',
      [userId],
    );
    return result.rows.map((row) => row.id);
  }

  /** Second connection that holds row locks inside an open transaction. */
  async function lockHolder(): Promise<Client> {
    const client = new Client({
      host: '127.0.0.1',
      port: postgres.port,
      user: 'postgres',
      password: 'regression-test-superuser-password',
      database: 'postgres',
    });
    await client.connect();
    await client.query('BEGIN');
    return client;
  }

  /** Waits until at least `minimum` backends are blocked on a lock (no timing guesses). */
  async function waitForLockWaiters(minimum: number, description: string): Promise<void> {
    const startedAt = Date.now();
    while (Date.now() - startedAt <= 10_000) {
      const result = await postgres.admin.query<{ waiting: string }>(
        'SELECT count(DISTINCT pid)::text AS waiting FROM pg_locks WHERE NOT granted',
      );
      if (Number(result.rows[0]?.waiting ?? 0) >= minimum) return;
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    throw new Error(`Timed out waiting for ${description}`);
  }

  async function storedPasswordHash(userId: string): Promise<string> {
    const result = await postgres.admin.query<{ password_hash: string }>(
      'SELECT password_hash FROM users WHERE id = $1',
      [userId],
    );
    return result.rows[0]!.password_hash;
  }

  // F-A1-02: a password change left every other refresh-token session (e.g. a stolen one) valid.
  test('changing the own password revokes every other session but keeps the current one', async () => {
    const current = await auth.issueTokenPair({ user: userRecord(MEMBER_ID, 'user'), device: 'laptop' });
    const other = await auth.issueTokenPair({ user: userRecord(MEMBER_ID, 'user'), device: 'stolen' });
    const unrelated = await auth.issueTokenPair({ user: userRecord(OWNER_ID, 'owner'), device: 'owner' });

    const response = await handleAuthRoute(
      request(principalOf(current), 'POST', '/api/v1/auth/change-password', {
        currentPassword: OLD_PASSWORD,
        newPassword: NEW_PASSWORD,
      }),
      ports(),
    );

    expect(response?.status).toBe(200);
    expect(await sessionStillValid(other)).toBe(false);
    expect(await auth.rotateRefreshToken({ refreshToken: other.refreshToken })).toBeNull();
    expect(await sessionStillValid(current)).toBe(true);
    expect(await sessionStillValid(unrelated)).toBe(true);
    expect(await auth.rotateRefreshToken({ refreshToken: current.refreshToken })).not.toBeNull();
  });

  test('a wrong current password revokes nothing', async () => {
    const current = await auth.issueTokenPair({ user: userRecord(MEMBER_ID, 'user') });
    const other = await auth.issueTokenPair({ user: userRecord(MEMBER_ID, 'user') });

    const response = await handleAuthRoute(
      request(principalOf(current), 'POST', '/api/v1/auth/change-password', {
        currentPassword: 'falsches-passwort-1',
        newPassword: NEW_PASSWORD,
      }),
      ports(),
    );

    expect(response?.status).toBe(403);
    expect(await sessionStillValid(other)).toBe(true);
    expect(await sessionStillValid(current)).toBe(true);
  });

  // F-A1-02: an admin password reset left all sessions of the affected user valid.
  test('an admin password reset revokes all sessions of the target user', async () => {
    const owner = await auth.issueTokenPair({ user: userRecord(OWNER_ID, 'owner') });
    const memberA = await auth.issueTokenPair({ user: userRecord(MEMBER_ID, 'user') });
    const memberB = await auth.issueTokenPair({ user: userRecord(MEMBER_ID, 'user') });

    const response = await handleAuthRoute(
      request(principalOf(owner), 'PATCH', `/api/v1/auth/users/${MEMBER_ID}`, {
        email: 'member@example.test',
        displayName: 'Member',
        role: 'user',
        isActive: true,
        password: NEW_PASSWORD,
      }),
      ports(),
    );

    expect(response?.status).toBe(200);
    expect(await sessionStillValid(memberA)).toBe(false);
    expect(await sessionStillValid(memberB)).toBe(false);
    expect(await auth.rotateRefreshToken({ refreshToken: memberB.refreshToken })).toBeNull();
    expect(await sessionStillValid(owner)).toBe(true);
  });

  test('a user update without a new password keeps the sessions', async () => {
    const owner = await auth.issueTokenPair({ user: userRecord(OWNER_ID, 'owner') });
    const member = await auth.issueTokenPair({ user: userRecord(MEMBER_ID, 'user') });

    const response = await handleAuthRoute(
      request(principalOf(owner), 'PATCH', `/api/v1/auth/users/${MEMBER_ID}`, {
        email: 'member@example.test',
        displayName: 'Member Renamed',
        role: 'user',
        isActive: true,
      }),
      ports(),
    );

    expect(response?.status).toBe(200);
    expect(await sessionStillValid(member)).toBe(true);
  });

  // C-A15: Eine gleichzeitige Refresh-Rotation liess ihren Nachfolger den Passwortwechsel ueberleben.
  test('a concurrent refresh rotation does not outlive the password change', async () => {
    const current = await auth.issueTokenPair({ user: userRecord(MEMBER_ID, 'user'), device: 'laptop' });
    const stolen = await auth.issueTokenPair({ user: userRecord(MEMBER_ID, 'user'), device: 'stolen' });
    const currentSessionId = principalOf(current!).sessionId!;
    const holder = await lockHolder();
    try {
      // Holds the stolen token row, so the rotation stops right before revoking it.
      await holder.query('SELECT id FROM refresh_tokens WHERE id = $1 FOR UPDATE', [principalOf(stolen!).sessionId]);
      const rotation = auth.rotateRefreshToken({ refreshToken: stolen!.refreshToken });
      await waitForLockWaiters(1, 'the rotation to wait for the stolen token row');
      const change = auth.changePassword!({
        workspaceId: WORKSPACE_ID,
        userId: MEMBER_ID,
        currentPassword: OLD_PASSWORD,
        newPassword: NEW_PASSWORD,
        currentSessionId,
      });
      await waitForLockWaiters(2, 'the password change to wait for the rotation');
      await holder.query('COMMIT');

      const [rotated, changed] = await Promise.all([rotation, change]);
      expect(changed).toEqual({ ok: true });
      if (!rotated || !('tokens' in rotated)) throw new Error('rotation should have issued a successor');
      expect(await sessionStillValid(rotated.tokens)).toBe(false);
      expect(await openSessionIds(MEMBER_ID)).toEqual([currentSessionId]);
    } finally {
      await holder.query('ROLLBACK').catch(() => undefined);
      await holder.end();
    }
  });

  // C-A15: Ein mit dem alten Passwort geprueftes Login bekam nach einem zwischenzeitlichen Wechsel trotzdem eine Sitzung.
  test('a login verified against the old password gets no session once the password changed', async () => {
    const current = await auth.issueTokenPair({ user: userRecord(MEMBER_ID, 'user'), device: 'laptop' });
    const currentSessionId = principalOf(current!).sessionId!;
    const racingAuth: AuthApiPort = {
      ...auth,
      async verifyPassword(password, passwordHash) {
        const valid = await auth.verifyPassword(password, passwordHash);
        // The password change commits between verification and session issue.
        await auth.changePassword!({
          workspaceId: WORKSPACE_ID,
          userId: MEMBER_ID,
          currentPassword: OLD_PASSWORD,
          newPassword: NEW_PASSWORD,
          currentSessionId,
        });
        return valid;
      },
    };

    const response = await handleAuthRoute(
      {
        method: 'POST',
        path: '/api/v1/auth/login',
        body: { email: 'member@example.test', password: OLD_PASSWORD },
        ip: '203.0.113.10',
        headers: {},
      },
      { auth: racingAuth } as ServerApiPorts,
    );

    expect(response?.status).toBe(401);
    expect(await openSessionIds(MEMBER_ID)).toEqual([currentSessionId]);
  });

  // C-B3: Die Sitzungsausgabe wartete nicht auf einen laufenden Passwortwechsel und las noch den alten Hash.
  test('issuing a session waits for a running password change and then refuses the old hash', async () => {
    const oldHash = await storedPasswordHash(MEMBER_ID);
    const holder = await lockHolder();
    try {
      await holder.query('UPDATE users SET password_hash = $2 WHERE id = $1', [MEMBER_ID, await hashPassword(NEW_PASSWORD)]);
      const issued = auth.issueTokenPair({
        user: { ...userRecord(MEMBER_ID, 'user'), passwordHash: oldHash },
        expectedPasswordHash: oldHash,
      });
      await waitForLockWaiters(1, 'the session issue to wait for the password change');
      await holder.query('COMMIT');

      await expect(issued).resolves.toBeNull();
      expect(await openSessionIds(MEMBER_ID)).toEqual([]);
    } finally {
      await holder.query('ROLLBACK').catch(() => undefined);
      await holder.end();
    }
  });
});
