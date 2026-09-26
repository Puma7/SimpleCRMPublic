import { createHash } from 'crypto';
import type { Kysely } from 'kysely';

import { handleAuthRoute } from '../../packages/server/src/api/auth-routes';
import { handleAuthSecurityRoute } from '../../packages/server/src/api/auth-security-routes';
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

const WORKSPACE_ID = '10000000-0000-4000-8000-0000000000e3';
const OWNER_ID = '20000000-0000-4000-8000-0000000000e1';
const OWNER2_ID = '20000000-0000-4000-8000-0000000000e2';
const ADMIN_ID = '20000000-0000-4000-8000-0000000000e3';
const ADMIN2_ID = '20000000-0000-4000-8000-0000000000e4';
const USER_ID = '20000000-0000-4000-8000-0000000000e5';
const SIGNER: AccessTokenSigner = { keyId: 'test', secret: Buffer.alloc(32, 7) };

type Role = 'owner' | 'admin' | 'user';

const USERS: ReadonlyArray<readonly [string, string, Role]> = [
  [OWNER_ID, 'owner', 'owner'],
  [OWNER2_ID, 'owner2', 'owner'],
  [ADMIN_ID, 'admin', 'admin'],
  [ADMIN2_ID, 'admin2', 'admin'],
  [USER_ID, 'user', 'user'],
];

// C-A72 (G3): Ein Admin konnte sich selbst zum Owner machen und Owner-Konten aendern
// (Passwort, Aktiv, Rolle, E-Mail, PIN, 2FA, Loeschen) und so den Owner-only-Hard-Reset erreichen.
describe('only owners assign the owner role and change owner accounts', () => {
  let postgres: EmbeddedPostgres;
  let db: Kysely<ServerDatabase>;
  let auth: AuthApiPort;
  let loginSecurity: {
    setUserPin: jest.Mock;
    beginTotpSetup: jest.Mock;
    confirmTotpSetup: jest.Mock;
    enableEmailMfa: jest.Mock;
    disableUserMfa: jest.Mock;
    verifyCurrentTotpCode: jest.Mock;
  };

  beforeAll(async () => {
    postgres = await startMigratedEmbeddedPostgres('auth-owner-management');
    await postgres.admin.query(`INSERT INTO workspaces (id, name) VALUES ($1, 'Owner Management Test')`, [WORKSPACE_ID]);
    db = postgres.createApplicationDb();
    auth = createPostgresAuthPort({ db, accessTokenSigner: SIGNER });
  });

  afterAll(async () => {
    if (db) await db.destroy();
    if (postgres) await postgres.stop();
  });

  beforeEach(async () => {
    loginSecurity = {
      setUserPin: jest.fn(async () => undefined),
      beginTotpSetup: jest.fn(async () => ({ secret: 'JBSWY3DPEHPK3PXP', otpauthUri: 'otpauth://totp/x' })),
      confirmTotpSetup: jest.fn(async () => true),
      enableEmailMfa: jest.fn(async () => true),
      disableUserMfa: jest.fn(async () => undefined),
      // Step-up per aktuellem Authenticator-Code des Handelnden.
      verifyCurrentTotpCode: jest.fn(async () => true),
    };
    await postgres.admin.query('DELETE FROM auth_invitations WHERE workspace_id = $1', [WORKSPACE_ID]);
    await postgres.admin.query('DELETE FROM refresh_tokens WHERE workspace_id = $1', [WORKSPACE_ID]);
    await postgres.admin.query('DELETE FROM users WHERE workspace_id = $1', [WORKSPACE_ID]);
    const hash = await hashPassword('passwort-fuer-tests-1');
    for (const [id, name, role] of USERS) {
      await postgres.admin.query(
        `INSERT INTO users (id, workspace_id, email, display_name, password_hash, role)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [id, WORKSPACE_ID, `${name}@example.test`, name, hash, role],
      );
    }
  });

  function principal(userId: string, role: Role): AuthenticatedPrincipal {
    return { userId, workspaceId: WORKSPACE_ID, role };
  }
  const owner = () => principal(OWNER_ID, 'owner');
  const admin = () => principal(ADMIN_ID, 'admin');

  function ports(): ServerApiPorts {
    return {
      auth,
      loginSecurity: loginSecurity as unknown as LoginSecurityApiPort,
    } as unknown as ServerApiPorts;
  }

  async function call(
    method: ApiRequest['method'],
    path: string,
    actor: AuthenticatedPrincipal,
    body?: Record<string, unknown>,
  ) {
    const req: ApiRequest = {
      method,
      path,
      ip: '203.0.113.33',
      headers: {},
      principal: actor,
      ...(body ? { body } : {}),
    };
    return (await handleAuthSecurityRoute(req, ports())) ?? handleAuthRoute(req, ports());
  }

  function saveBody(targetId: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
    const [, name, role] = USERS.find(([id]) => id === targetId)!;
    return { email: `${name}@example.test`, displayName: name, role, ...extra };
  }

  async function row(userId: string) {
    const result = await postgres.admin.query<{
      email: string;
      role: Role;
      password_hash: string;
      disabled_at: Date | null;
    }>(
      'SELECT email, role, password_hash, disabled_at FROM users WHERE workspace_id = $1 AND id = $2',
      [WORKSPACE_ID, userId],
    );
    return result.rows[0] ?? null;
  }

  const ownerOnly = { status: 403, body: { error: { code: 'owner_management_requires_owner' } } };

  describe('an admin', () => {
    test('cannot promote themselves to owner', async () => {
      const response = await call('PATCH', `/api/v1/auth/users/${ADMIN_ID}`, admin(), saveBody(ADMIN_ID, { role: 'owner' }));

      expect(response).toMatchObject(ownerOnly);
      expect((await row(ADMIN_ID))?.role).toBe('admin');
    });

    test('cannot promote another user to owner', async () => {
      const response = await call('PATCH', `/api/v1/auth/users/${USER_ID}`, admin(), saveBody(USER_ID, { role: 'owner' }));

      expect(response).toMatchObject(ownerOnly);
      expect((await row(USER_ID))?.role).toBe('user');
    });

    test('cannot create an owner account', async () => {
      const response = await call('POST', '/api/v1/auth/users', admin(), {
        email: 'neu@example.test',
        displayName: 'Neu',
        role: 'owner',
        password: 'neues-passwort-12345',
      });

      expect(response).toMatchObject(ownerOnly);
      const created = await postgres.admin.query(
        'SELECT id FROM users WHERE workspace_id = $1 AND email = $2',
        [WORKSPACE_ID, 'neu@example.test'],
      );
      expect(created.rows).toHaveLength(0);
    });

    test('cannot invite an owner', async () => {
      const response = await call('POST', '/api/v1/auth/invitations', admin(), {
        email: 'eingeladen@example.test',
        displayName: 'Eingeladen',
        role: 'owner',
      });

      expect(response).toMatchObject(ownerOnly);
      const invitations = await postgres.admin.query(
        'SELECT id FROM auth_invitations WHERE workspace_id = $1',
        [WORKSPACE_ID],
      );
      expect(invitations.rows).toHaveLength(0);
    });

    // Zwei aktive Owner: die Ablehnung kommt aus der Owner-Regel, nicht aus last_owner_required.
    test.each([
      ['password reset', { password: 'uebernommen-12345' }],
      ['deactivation', { isActive: false }],
      ['demotion', { role: 'admin' }],
      ['e-mail change', { email: 'owner2-neu@example.test' }],
      ['rename', { displayName: 'Umbenannt' }],
      ['login PIN', { loginPin: '123456' }],
    ])('cannot change an owner account: %s', async (_label, change) => {
      const before = await row(OWNER2_ID);

      const response = await call('PATCH', `/api/v1/auth/users/${OWNER2_ID}`, admin(), saveBody(OWNER2_ID, change));

      expect(response).toMatchObject(ownerOnly);
      expect(await row(OWNER2_ID)).toEqual(before);
      expect(loginSecurity.setUserPin).not.toHaveBeenCalled();
    });

    test('cannot delete an owner account', async () => {
      const response = await call('DELETE', `/api/v1/auth/users/${OWNER2_ID}`, admin());

      expect(response).toMatchObject(ownerOnly);
      expect(await row(OWNER2_ID)).not.toBeNull();
    });

    test.each([
      ['disable', 'DELETE', 'mfa', { currentMfaCode: '424242' }],
      ['authenticator setup', 'POST', 'mfa/totp/setup', undefined],
      ['authenticator confirm', 'POST', 'mfa/totp/confirm', { secret: 'JBSWY3DPEHPK3PXP', code: '123456', currentMfaCode: '424242' }],
      ['switch to e-mail', 'POST', 'mfa/email', { currentMfaCode: '424242' }],
    ] as const)('cannot change the 2FA of an owner account: %s', async (_label, method, suffix, body) => {
      const response = await call(method, `/api/v1/auth/users/${OWNER2_ID}/${suffix}`, admin(), body);

      expect(response).toMatchObject(ownerOnly);
      expect(loginSecurity.disableUserMfa).not.toHaveBeenCalled();
      expect(loginSecurity.beginTotpSetup).not.toHaveBeenCalled();
      expect(loginSecurity.confirmTotpSetup).not.toHaveBeenCalled();
      expect(loginSecurity.enableEmailMfa).not.toHaveBeenCalled();
    });

    test('still manages other admins and ordinary users', async () => {
      const adminHash = (await row(ADMIN2_ID))?.password_hash;
      const reset = await call(
        'PATCH',
        `/api/v1/auth/users/${ADMIN2_ID}`,
        admin(),
        saveBody(ADMIN2_ID, { password: 'admin2-neu-12345', loginPin: '654321', isActive: false }),
      );
      expect(reset?.status).toBe(200);
      expect(await row(ADMIN2_ID)).toMatchObject({ role: 'admin', disabled_at: expect.any(Date) });
      expect((await row(ADMIN2_ID))?.password_hash).not.toBe(adminHash);
      expect(loginSecurity.setUserPin).toHaveBeenCalledWith(expect.objectContaining({ userId: ADMIN2_ID, pin: '654321' }));

      const demote = await call('PATCH', `/api/v1/auth/users/${ADMIN2_ID}`, admin(), saveBody(ADMIN2_ID, { role: 'user' }));
      expect(demote?.status).toBe(200);
      expect((await row(ADMIN2_ID))?.role).toBe('user');

      const promote = await call('PATCH', `/api/v1/auth/users/${USER_ID}`, admin(), saveBody(USER_ID, { role: 'admin' }));
      expect(promote?.status).toBe(200);
      expect((await row(USER_ID))?.role).toBe('admin');

      const mfa = await call('DELETE', `/api/v1/auth/users/${USER_ID}/mfa`, admin(), { currentMfaCode: '424242' });
      expect(mfa?.status).toBe(200);
      expect(loginSecurity.disableUserMfa).toHaveBeenCalledWith({ workspaceId: WORKSPACE_ID, userId: USER_ID });

      const invite = await call('POST', '/api/v1/auth/invitations', admin(), {
        email: 'kollege@example.test',
        displayName: 'Kollege',
        role: 'admin',
      });
      expect(invite?.status).toBe(201);

      const deleted = await call('DELETE', `/api/v1/auth/users/${ADMIN2_ID}`, admin());
      expect(deleted?.status).toBe(200);
      expect(await row(ADMIN2_ID)).toBeNull();
    });
  });

  describe('an owner', () => {
    test('assigns the owner role and manages other owner accounts', async () => {
      const promote = await call('PATCH', `/api/v1/auth/users/${ADMIN_ID}`, owner(), saveBody(ADMIN_ID, { role: 'owner' }));
      expect(promote?.status).toBe(200);
      expect((await row(ADMIN_ID))?.role).toBe('owner');

      const ownerHash = (await row(OWNER2_ID))?.password_hash;
      const reset = await call(
        'PATCH',
        `/api/v1/auth/users/${OWNER2_ID}`,
        owner(),
        saveBody(OWNER2_ID, { password: 'owner2-neu-12345', loginPin: '111111' }),
      );
      expect(reset?.status).toBe(200);
      expect((await row(OWNER2_ID))?.password_hash).not.toBe(ownerHash);
      expect(loginSecurity.setUserPin).toHaveBeenCalledWith(expect.objectContaining({ userId: OWNER2_ID, pin: '111111' }));

      const mfa = await call('DELETE', `/api/v1/auth/users/${OWNER2_ID}/mfa`, owner(), { currentMfaCode: '424242' });
      expect(mfa?.status).toBe(200);
      expect(loginSecurity.disableUserMfa).toHaveBeenCalledWith({ workspaceId: WORKSPACE_ID, userId: OWNER2_ID });

      const created = await call('POST', '/api/v1/auth/users', owner(), {
        email: 'owner3@example.test',
        displayName: 'Owner 3',
        role: 'owner',
        password: 'owner3-passwort-12345',
      });
      expect(created?.status).toBe(201);

      const invite = await call('POST', '/api/v1/auth/invitations', owner(), {
        email: 'owner4@example.test',
        displayName: 'Owner 4',
        role: 'owner',
      });
      expect(invite?.status).toBe(201);

      const demote = await call('PATCH', `/api/v1/auth/users/${OWNER2_ID}`, owner(), saveBody(OWNER2_ID, { role: 'admin' }));
      expect(demote?.status).toBe(200);
      expect((await row(OWNER2_ID))?.role).toBe('admin');

      const deleted = await call('DELETE', `/api/v1/auth/users/${OWNER2_ID}`, owner());
      expect(deleted?.status).toBe(200);
    });

    test('may demote themselves while another owner stays active; the last active owner is kept', async () => {
      const selfDemote = await call('PATCH', `/api/v1/auth/users/${OWNER_ID}`, owner(), saveBody(OWNER_ID, { role: 'admin' }));
      expect(selfDemote?.status).toBe(200);
      expect((await row(OWNER_ID))?.role).toBe('admin');

      const lastOwner = await call(
        'PATCH',
        `/api/v1/auth/users/${OWNER2_ID}`,
        principal(OWNER2_ID, 'owner'),
        saveBody(OWNER2_ID, { role: 'admin' }),
      );
      expect(lastOwner).toMatchObject({ status: 409, body: { error: { code: 'last_owner_required' } } });
      expect((await row(OWNER2_ID))?.role).toBe('owner');
    });
  });

  // C-A72 (G3): Eine vor G3 von einem Admin erstellte Owner-Einladung (oder die eines inzwischen
  // herabgestuften oder deaktivierten Owners) liess sich weiter annehmen und vergab die Owner-Rolle.
  describe('accepting an owner invitation', () => {
    let tokenSequence = 0;

    async function insertInvitation(invitedBy: string, role: Role): Promise<{ token: string; email: string }> {
      tokenSequence += 1;
      const token = `einladung-${tokenSequence}-${'x'.repeat(32)}`;
      const email = `eingeladen-${tokenSequence}@example.test`;
      await postgres.admin.query(
        `INSERT INTO auth_invitations (workspace_id, email, display_name, role, token_hash, invited_by_user_id, expires_at)
         VALUES ($1, $2, 'Eingeladen', $3, $4, $5, now() + interval '7 days')`,
        [WORKSPACE_ID, email, role, createHash('sha256').update(token, 'utf8').digest('hex'), invitedBy],
      );
      return { token, email };
    }

    async function accept(token: string) {
      return handleAuthRoute({
        method: 'POST',
        path: `/api/v1/auth/invitations/${encodeURIComponent(token)}/accept`,
        ip: '203.0.113.34',
        headers: {},
        body: { password: 'angenommen-12345' },
      }, ports());
    }

    async function userByEmail(email: string) {
      const result = await postgres.admin.query<{ role: Role }>(
        'SELECT role FROM users WHERE workspace_id = $1 AND email = $2',
        [WORKSPACE_ID, email],
      );
      return result.rows[0] ?? null;
    }

    async function acceptedAt(email: string) {
      const result = await postgres.admin.query<{ accepted_at: Date | null }>(
        'SELECT accepted_at FROM auth_invitations WHERE workspace_id = $1 AND email = $2',
        [WORKSPACE_ID, email],
      );
      return result.rows[0]?.accepted_at ?? null;
    }

    test('is refused when an admin created it (before G3)', async () => {
      const { token, email } = await insertInvitation(ADMIN_ID, 'owner');

      expect(await accept(token)).toMatchObject(ownerOnly);
      expect(await userByEmail(email)).toBeNull();
      expect(await acceptedAt(email)).toBeNull();
    });

    test('is refused when the inviting owner was demoted meanwhile', async () => {
      const { token, email } = await insertInvitation(OWNER2_ID, 'owner');
      await postgres.admin.query(`UPDATE users SET role = 'admin' WHERE id = $1`, [OWNER2_ID]);

      expect(await accept(token)).toMatchObject(ownerOnly);
      expect(await userByEmail(email)).toBeNull();
    });

    test('is refused when the inviting owner was disabled meanwhile', async () => {
      const { token, email } = await insertInvitation(OWNER2_ID, 'owner');
      await postgres.admin.query('UPDATE users SET disabled_at = now() WHERE id = $1', [OWNER2_ID]);

      expect(await accept(token)).toMatchObject(ownerOnly);
      expect(await userByEmail(email)).toBeNull();
    });

    test('still grants the owner role while the inviter is an active owner', async () => {
      const { token, email } = await insertInvitation(OWNER2_ID, 'owner');

      expect((await accept(token))?.status).toBe(200);
      expect(await userByEmail(email)).toEqual({ role: 'owner' });
      expect(await acceptedAt(email)).not.toBeNull();
    });

    test('leaves invitations for other roles untouched', async () => {
      const { token, email } = await insertInvitation(ADMIN_ID, 'admin');

      expect((await accept(token))?.status).toBe(200);
      expect(await userByEmail(email)).toEqual({ role: 'admin' });
    });
  });
});
