import type { Kysely } from 'kysely';

import { handleAuthRoute } from '../../packages/server/src/api/auth-routes';
import type { ApiRequest, AuthApiPort, ServerApiPorts } from '../../packages/server/src/api/types';
import { createPostgresAuthPort, hashPassword } from '../../packages/server/src/db/postgres-auth-port';
import type { ServerDatabase } from '../../packages/server/src/db/schema';
import type { AccessTokenSigner } from '../../packages/server/src/security/access-token';
import { startMigratedEmbeddedPostgres, type EmbeddedPostgres } from './helpers/embedded-postgres';

jest.mock('kysely', () => jest.requireActual('../../packages/server/node_modules/kysely'));

jest.setTimeout(120_000);

const WORKSPACE_ID = '10000000-0000-4000-8000-0000000000c3';
const OWNER_ID = '20000000-0000-4000-8000-0000000000c1';
const MEMBER_ID = '20000000-0000-4000-8000-0000000000c2';
const DISABLED_AT = '2026-09-01T08:00:00.000Z';
const SIGNER: AccessTokenSigner = { keyId: 'test', secret: Buffer.alloc(32, 9) };

describe('user update keeps the active state unless isActive is sent', () => {
  let postgres: EmbeddedPostgres;
  let db: Kysely<ServerDatabase>;
  let auth: AuthApiPort;

  beforeAll(async () => {
    postgres = await startMigratedEmbeddedPostgres('auth-user-active');
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
    const hash = await hashPassword('passwort-fuer-tests-1');
    await postgres.admin.query(
      `INSERT INTO users (id, workspace_id, email, display_name, password_hash, role, disabled_at)
       VALUES ($1, $3, 'owner@example.test', 'Owner', $4, 'owner', NULL),
              ($2, $3, 'member@example.test', 'Member', $4, 'user', $5)`,
      [OWNER_ID, MEMBER_ID, WORKSPACE_ID, hash, DISABLED_AT],
    );
  });

  function patchMember(body: Record<string, unknown>): ApiRequest {
    return {
      method: 'PATCH',
      path: `/api/v1/auth/users/${MEMBER_ID}`,
      ip: '203.0.113.9',
      headers: {},
      principal: { userId: OWNER_ID, workspaceId: WORKSPACE_ID, role: 'owner' },
      body,
    };
  }

  async function memberDisabledAt(): Promise<string | null> {
    const result = await postgres.admin.query<{ disabled_at: Date | null }>(
      'SELECT disabled_at FROM users WHERE id = $1',
      [MEMBER_ID],
    );
    const value = result.rows[0]?.disabled_at;
    return value ? new Date(value).toISOString() : null;
  }

  // F-A1-11: an update without isActive (e.g. a rename by an API client) silently re-enabled a disabled user.
  test('a disabled user stays disabled when isActive is omitted', async () => {
    const response = await handleAuthRoute(patchMember({
      email: 'member@example.test',
      displayName: 'Member Renamed',
      role: 'user',
    }), { auth } as ServerApiPorts);

    expect(response?.status).toBe(200);
    expect((response?.body as { data: { displayName: string } }).data.displayName).toBe('Member Renamed');
    expect(await memberDisabledAt()).toBe(DISABLED_AT);
  });

  test('an explicit isActive still enables and disables the user', async () => {
    const enabled = await handleAuthRoute(patchMember({
      email: 'member@example.test',
      displayName: 'Member',
      role: 'user',
      isActive: true,
    }), { auth } as ServerApiPorts);
    expect(enabled?.status).toBe(200);
    expect(await memberDisabledAt()).toBeNull();

    const disabled = await handleAuthRoute(patchMember({
      email: 'member@example.test',
      displayName: 'Member',
      role: 'user',
      isActive: false,
    }), { auth } as ServerApiPorts);
    expect(disabled?.status).toBe(200);
    expect(await memberDisabledAt()).not.toBeNull();
  });
});
