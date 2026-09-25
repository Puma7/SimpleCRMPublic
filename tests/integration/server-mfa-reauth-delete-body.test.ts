import { createFastifyServer, type ServerApiPorts } from '../../packages/server/src/api';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const PASSWORD = 'richtiges-passwort-1';

// F-A1-06: the step-up credential for "2FA deaktivieren" travels in the body of a
// DELETE request, which Fastify must parse like any other JSON body.
describe('DELETE /api/v1/auth/users/:id/mfa over Fastify', () => {
  function makeApp() {
    const disableUserMfa = jest.fn(async () => undefined);
    const ports = {
      auth: {
        getUser: async () => ({ id: USER_ID, email: 'user@example.test', role: 'user', disabledAt: null }),
        findUserByEmail: async () => ({
          id: USER_ID,
          workspaceId: WORKSPACE_ID,
          email: 'user@example.test',
          displayName: 'User',
          role: 'user',
          passwordHash: 'hash',
          disabledAt: null,
        }),
        verifyPassword: async (password: string) => password === PASSWORD,
        recordFailedLogin: async () => 1,
        recordSuccessfulLogin: async () => undefined,
      },
      loginSecurity: { disableUserMfa },
    } as unknown as ServerApiPorts;
    const app = createFastifyServer({ ports, allowHeaderPrincipalFallback: true });
    return { app, disableUserMfa };
  }

  const principalHeaders = {
    'x-simplecrm-user-id': USER_ID,
    'x-simplecrm-workspace-id': WORKSPACE_ID,
    'x-simplecrm-role': 'user',
  };

  test('reads the current password from the JSON body', async () => {
    const { app, disableUserMfa } = makeApp();
    try {
      const response = await app.inject({
        method: 'DELETE',
        url: `/api/v1/auth/users/${USER_ID}/mfa`,
        headers: principalHeaders,
        payload: { currentPassword: PASSWORD },
      });

      expect(response.statusCode).toBe(200);
      expect(disableUserMfa).toHaveBeenCalledTimes(1);
    } finally {
      await app.close();
    }
  });

  test('refuses a DELETE without body', async () => {
    const { app, disableUserMfa } = makeApp();
    try {
      const response = await app.inject({
        method: 'DELETE',
        url: `/api/v1/auth/users/${USER_ID}/mfa`,
        headers: principalHeaders,
      });

      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({ error: { code: 'reauth_required' } });
      expect(disableUserMfa).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
});
