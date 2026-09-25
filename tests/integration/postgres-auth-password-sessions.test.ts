import type { Kysely } from 'kysely';

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
});
