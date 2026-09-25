import { handleAuthSecurityRoute } from '../../packages/server/src/api/auth-security-routes';
import type { ApiRequest, ServerApiPorts } from '../../packages/server/src/api/types';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';

function enableEmailMfaRequest(): ApiRequest {
  return {
    method: 'POST',
    path: `/api/v1/auth/users/${USER_ID}/mfa/email`,
    ip: '203.0.113.8',
    headers: {},
    principal: { userId: USER_ID, workspaceId: WORKSPACE_ID, role: 'user' },
  };
}

describe('e-mail MFA enrollment route', () => {
  // F-A1-04: the route reported success although the workspace does not offer e-mail MFA.
  test('answers 409 with a clear error when the workspace does not offer e-mail MFA', async () => {
    const ports = {
      auth: {},
      loginSecurity: { enableEmailMfa: jest.fn(async () => false) },
    } as unknown as ServerApiPorts;

    const response = await handleAuthSecurityRoute(enableEmailMfaRequest(), ports);

    expect(response?.status).toBe(409);
    expect((response?.body as { error: { code: string; message: string } }).error).toMatchObject({
      code: 'mfa_method_not_allowed',
      message: expect.stringContaining('E-Mail-2FA'),
    });
  });

  test('still enables e-mail MFA when the workspace offers it', async () => {
    const ports = {
      auth: {},
      loginSecurity: { enableEmailMfa: jest.fn(async () => true) },
    } as unknown as ServerApiPorts;

    const response = await handleAuthSecurityRoute(enableEmailMfaRequest(), ports);

    expect(response?.status).toBe(200);
    expect((response?.body as { data: unknown }).data).toEqual({ enabled: true, method: 'email' });
  });
});
