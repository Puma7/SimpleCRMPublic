import type { Kysely } from 'kysely';

import { handleAuthRoute } from '../../packages/server/src/api/auth-routes';
import type {
  ApiRequest,
  AuthApiPort,
  AuthenticatedPrincipal,
  LoginSecurityApiPort,
  ServerApiPorts,
} from '../../packages/server/src/api/types';
import { createPostgresAuthPort, hashPassword } from '../../packages/server/src/db/postgres-auth-port';
import type { ServerDatabase } from '../../packages/server/src/db/schema';
import type { AccessTokenSigner } from '../../packages/server/src/security/access-token';
import { startMigratedEmbeddedPostgres, type EmbeddedPostgres } from './helpers/embedded-postgres';

jest.mock('kysely', () => jest.requireActual('../../packages/server/node_modules/kysely'));

jest.setTimeout(120_000);

const WORKSPACE_ID = '10000000-0000-4000-8000-0000000000d6';
const OWNER_ID = '20000000-0000-4000-8000-0000000000d1';
const DELEGATE_ID = '20000000-0000-4000-8000-0000000000d2';
const PLAIN_ID = '20000000-0000-4000-8000-0000000000d3';
const PEER_ID = '20000000-0000-4000-8000-0000000000d4';
const SETTINGS_ID = '20000000-0000-4000-8000-0000000000d5';
const DIRECT_ACL_ID = '20000000-0000-4000-8000-0000000000d6';
const GROUP_ACL_ID = '20000000-0000-4000-8000-0000000000d7';
const HELPDESK_GROUP = 9101;
const SETTINGS_GROUP = 9102;
const MAILBOX_GROUP = 9103;
const ACCOUNT_ID = 9201;
const SIGNER: AccessTokenSigner = { keyId: 'test', secret: Buffer.alloc(32, 9) };

const USERS: ReadonlyArray<readonly [string, string]> = [
  [OWNER_ID, 'owner'],
  [DELEGATE_ID, 'delegate'],
  [PLAIN_ID, 'plain'],
  [PEER_ID, 'peer'],
  [SETTINGS_ID, 'settings'],
  [DIRECT_ACL_ID, 'direct-acl'],
  [GROUP_ACL_ID, 'group-acl'],
];

// F-A2b-06 (E3): a delegated user manager (users.manage, not admin) could reset
// the password, the login PIN or delete any `user` account, including one that
// holds more group capabilities or mailbox delegations than the manager, and
// then log in with its rights.
describe('delegated user management only reaches accounts that are not more privileged', () => {
  let postgres: EmbeddedPostgres;
  let db: Kysely<ServerDatabase>;
  let auth: AuthApiPort;
  let setUserPin: jest.Mock;

  beforeAll(async () => {
    postgres = await startMigratedEmbeddedPostgres('auth-user-target-privilege');
    await postgres.admin.query(`INSERT INTO workspaces (id, name) VALUES ($1, 'Target Privilege Test')`, [WORKSPACE_ID]);
    db = postgres.createApplicationDb();
    auth = createPostgresAuthPort({ db, accessTokenSigner: SIGNER });
  });

  afterAll(async () => {
    if (db) await db.destroy();
    if (postgres) await postgres.stop();
  });

  beforeEach(async () => {
    setUserPin = jest.fn(async () => undefined);
    await postgres.admin.query('DELETE FROM mail_acl_bindings WHERE workspace_id = $1', [WORKSPACE_ID]);
    await postgres.admin.query('DELETE FROM email_accounts WHERE workspace_id = $1', [WORKSPACE_ID]);
    await postgres.admin.query('DELETE FROM user_groups WHERE workspace_id = $1', [WORKSPACE_ID]);
    await postgres.admin.query('DELETE FROM refresh_tokens WHERE workspace_id = $1', [WORKSPACE_ID]);
    await postgres.admin.query('DELETE FROM users WHERE workspace_id = $1', [WORKSPACE_ID]);
    const hash = await hashPassword('passwort-fuer-tests-1');
    for (const [id, name] of USERS) {
      await postgres.admin.query(
        `INSERT INTO users (id, workspace_id, email, display_name, password_hash, role)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [id, WORKSPACE_ID, `${name}@example.test`, name, hash, id === OWNER_ID ? 'owner' : 'user'],
      );
    }
    await postgres.admin.query(
      `INSERT INTO user_groups (id, workspace_id, name) VALUES
         ($1, $4, 'Helpdesk'), ($2, $4, 'Einstellungen'), ($3, $4, 'Postfach info@')`,
      [HELPDESK_GROUP, SETTINGS_GROUP, MAILBOX_GROUP, WORKSPACE_ID],
    );
    await postgres.admin.query(
      `INSERT INTO user_group_permissions (workspace_id, group_id, permission) VALUES
         ($1, $2, 'users.manage'), ($1, $2, 'crm.write'), ($1, $3, 'settings.manage')`,
      [WORKSPACE_ID, HELPDESK_GROUP, SETTINGS_GROUP],
    );
    await postgres.admin.query(
      `INSERT INTO user_group_members (workspace_id, group_id, user_id) VALUES
         ($1, $2, $4), ($1, $2, $5), ($1, $3, $6), ($1, $7, $8)`,
      [WORKSPACE_ID, HELPDESK_GROUP, SETTINGS_GROUP, DELEGATE_ID, PEER_ID, SETTINGS_ID, MAILBOX_GROUP, GROUP_ACL_ID],
    );
    await postgres.admin.query(
      `INSERT INTO email_accounts (id, workspace_id, source_sqlite_id, display_name, email_address, imap_host, imap_username)
       VALUES ($1, $2, $1, 'Info', 'info@example.test', 'imap.example.test', 'info@example.test')`,
      [ACCOUNT_ID, WORKSPACE_ID],
    );
    await postgres.admin.query(
      `INSERT INTO mail_acl_bindings (workspace_id, subject_type, subject_id, resource_type, account_id) VALUES
         ($1, 'user', $2, 'account', $4), ($1, 'group', $3, 'account', $4)`,
      [WORKSPACE_ID, DIRECT_ACL_ID, String(MAILBOX_GROUP), ACCOUNT_ID],
    );
  });

  function delegate(): AuthenticatedPrincipal {
    // Mirrors resolvePrincipal: the expanded union of the Helpdesk group.
    return {
      userId: DELEGATE_ID,
      workspaceId: WORKSPACE_ID,
      role: 'user',
      capabilities: ['crm.read', 'crm.write', 'users.manage'],
    };
  }

  function owner(): AuthenticatedPrincipal {
    return { userId: OWNER_ID, workspaceId: WORKSPACE_ID, role: 'owner' };
  }

  function ports(): ServerApiPorts {
    return {
      auth,
      loginSecurity: { setUserPin } as unknown as LoginSecurityApiPort,
    } as unknown as ServerApiPorts;
  }

  function request(
    method: 'PATCH' | 'DELETE',
    targetId: string,
    principal: AuthenticatedPrincipal,
    body?: Record<string, unknown>,
  ): ApiRequest {
    return {
      method,
      path: `/api/v1/auth/users/${targetId}`,
      ip: '203.0.113.9',
      headers: {},
      principal,
      ...(body ? { body } : {}),
    };
  }

  function resetBody(targetId: string, extra: Record<string, unknown>): Record<string, unknown> {
    const name = USERS.find(([id]) => id === targetId)![1];
    return { email: `${name}@example.test`, displayName: name, role: 'user', ...extra };
  }

  async function passwordHash(userId: string): Promise<string | null> {
    const result = await postgres.admin.query<{ password_hash: string }>(
      'SELECT password_hash FROM users WHERE workspace_id = $1 AND id = $2',
      [WORKSPACE_ID, userId],
    );
    return result.rows[0]?.password_hash ?? null;
  }

  describe.each([
    ['more group capabilities', SETTINGS_ID],
    ['a direct mail ACL binding', DIRECT_ACL_ID],
    ['a mail ACL binding through a group', GROUP_ACL_ID],
  ])('target with %s', (_label, targetId) => {
    test('password reset is refused with 403 target_more_privileged', async () => {
      const before = await passwordHash(targetId);

      const response = await handleAuthRoute(
        request('PATCH', targetId, delegate(), resetBody(targetId, { password: 'uebernommen-12345' })),
        ports(),
      );

      expect(response).toMatchObject({ status: 403, body: { error: { code: 'target_more_privileged' } } });
      expect(await passwordHash(targetId)).toBe(before);
    });

    test('setting a login PIN is refused', async () => {
      const response = await handleAuthRoute(
        request('PATCH', targetId, delegate(), resetBody(targetId, { loginPin: '123456' })),
        ports(),
      );

      expect(response).toMatchObject({ status: 403, body: { error: { code: 'target_more_privileged' } } });
      expect(setUserPin).not.toHaveBeenCalled();
    });

    test('deleting is refused', async () => {
      const response = await handleAuthRoute(request('DELETE', targetId, delegate()), ports());

      expect(response).toMatchObject({ status: 403, body: { error: { code: 'target_more_privileged' } } });
      expect(await passwordHash(targetId)).not.toBeNull();
    });

    test('an admin may still reset and delete', async () => {
      const reset = await handleAuthRoute(
        request('PATCH', targetId, owner(), resetBody(targetId, { password: 'admin-reset-12345', loginPin: '654321' })),
        ports(),
      );
      expect(reset?.status).toBe(200);
      expect(setUserPin).toHaveBeenCalledWith(expect.objectContaining({ userId: targetId, pin: '654321' }));

      const deleted = await handleAuthRoute(request('DELETE', targetId, owner()), ports());
      expect(deleted?.status).toBe(200);
      expect(await passwordHash(targetId)).toBeNull();
    });
  });

  test.each([
    ['without groups', PLAIN_ID],
    ['with the same group capabilities', PEER_ID],
  ])('a target %s stays manageable for the delegate', async (_label, targetId) => {
    const before = await passwordHash(targetId);

    const reset = await handleAuthRoute(
      request('PATCH', targetId, delegate(), resetBody(targetId, { password: 'neu-gesetzt-12345', loginPin: '123456' })),
      ports(),
    );
    expect(reset?.status).toBe(200);
    expect(await passwordHash(targetId)).not.toBe(before);
    expect(setUserPin).toHaveBeenCalledWith(expect.objectContaining({ userId: targetId, pin: '123456' }));

    const deleted = await handleAuthRoute(request('DELETE', targetId, delegate()), ports());
    expect(deleted?.status).toBe(200);
    expect(await passwordHash(targetId)).toBeNull();
  });

  test('the delegate may still edit their own account while holding a mailbox delegation', async () => {
    await postgres.admin.query(
      `INSERT INTO mail_acl_bindings (workspace_id, subject_type, subject_id, resource_type, account_id)
       VALUES ($1, 'user', $2, 'account', $3)`,
      [WORKSPACE_ID, DELEGATE_ID, ACCOUNT_ID],
    );

    const response = await handleAuthRoute(
      request('PATCH', DELEGATE_ID, delegate(), resetBody(DELEGATE_ID, { displayName: 'Helpdesk Lead' })),
      ports(),
    );

    expect(response?.status).toBe(200);
  });
});
