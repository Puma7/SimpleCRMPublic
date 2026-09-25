import { handleAuthRoute } from '../../packages/server/src/api/auth-routes';
import type { ApiRequest, ServerApiPorts } from '../../packages/server/src/api/types';
import { checkInitialSetupToken } from '../../packages/server/src/cli/doctor';

const ENV_EXAMPLE_PLACEHOLDER = 'CHANGE_ME_initial_setup_token';
const RANDOM_TOKEN = 'Yb3kJ9q2vX7mN4pR8sT1wZ6cF0hL5dGe';

function setupPorts(initialSetupToken: string) {
  const createInitialOwner = jest.fn(async () => ({ ok: false as const, code: 'already_configured' as const }));
  const ports = {
    auth: { createInitialOwner },
    initialSetupToken,
  } as unknown as ServerApiPorts;
  return { ports, createInitialOwner };
}

function setupRequest(token: string): ApiRequest {
  return {
    method: 'POST',
    path: '/api/v1/auth/initial-setup',
    ip: '198.51.100.20',
    headers: { 'x-initial-setup-token': token },
    body: { email: 'owner@example.test', password: 'owner-passwort-123' },
  };
}

describe('initial setup token strength', () => {
  // F-A1-05: the public placeholder from docker/.env.example unlocked the initial owner setup.
  test('the .env.example placeholder does not unlock the initial setup', async () => {
    const { ports, createInitialOwner } = setupPorts(ENV_EXAMPLE_PLACEHOLDER);

    const response = await handleAuthRoute(setupRequest(ENV_EXAMPLE_PLACEHOLDER), ports);

    expect(response?.status).toBe(503);
    expect((response?.body as { error: { code: string } }).error.code).toBe('initial_setup_token_required');
    expect(createInitialOwner).not.toHaveBeenCalled();
  });

  // F-A1-05: any short, guessable token was accepted as well.
  test('a short token does not unlock the initial setup', async () => {
    const { ports, createInitialOwner } = setupPorts('geheim123');

    const response = await handleAuthRoute(setupRequest('geheim123'), ports);

    expect(response?.status).toBe(503);
    expect(createInitialOwner).not.toHaveBeenCalled();
  });

  test('a random token still unlocks the initial setup', async () => {
    const { ports, createInitialOwner } = setupPorts(RANDOM_TOKEN);

    const response = await handleAuthRoute(setupRequest(RANDOM_TOKEN), ports);

    expect(response?.status).toBe(409);
    expect(createInitialOwner).toHaveBeenCalledTimes(1);
  });

  test('doctor reports a placeholder or short token and accepts a random one', () => {
    expect(checkInitialSetupToken({ INITIAL_SETUP_TOKEN: ENV_EXAMPLE_PLACEHOLDER }))
      .toMatchObject({ name: 'initial_setup_token', status: 'warn' });
    expect(checkInitialSetupToken({ INITIAL_SETUP_TOKEN: 'geheim123' }))
      .toMatchObject({ name: 'initial_setup_token', status: 'warn' });
    expect(checkInitialSetupToken({ INITIAL_SETUP_TOKEN: RANDOM_TOKEN }))
      .toMatchObject({ name: 'initial_setup_token', status: 'ok' });
    expect(JSON.stringify(checkInitialSetupToken({ INITIAL_SETUP_TOKEN: RANDOM_TOKEN }))).not.toContain(RANDOM_TOKEN);
    expect(checkInitialSetupToken({})).toBeNull();
  });
});
