import type { EventEmitter } from 'node:events';

import {
  createFastifyServer,
  createInMemoryServerEventBus,
  SERVER_EVENT_ACCESS_PROTOCOL_PREFIX,
  type AuthenticatedPrincipal,
  type ServerApiPorts,
  type ServerEvent,
} from '../../packages/server/src/api';
import { createAccessToken, type AccessTokenSigner } from '../../packages/server/src/security/access-token';

const SIGNER: AccessTokenSigner = { keyId: 'test', secret: Buffer.alloc(32, 21) };
const WORKSPACE_ID = 'workspace-a';
const USER_ID = 'user-a';

type TestSocket = EventEmitter & { readyState: number; terminate(): void };

describe('event websocket across an access-token refresh', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  function setup(user: { disabledAt: string | null; role: AuthenticatedPrincipal['role'] }) {
    const events = createInMemoryServerEventBus();
    const revokedSessions = new Set<string>();
    const ports = {
      auth: {
        async findUserByEmail() { return null; },
        async verifyPassword() { return false; },
        async recordFailedLogin() { return 1; },
        async recordSuccessfulLogin() { return undefined; },
        async issueTokenPair() { throw new Error('not used'); },
        async rotateRefreshToken() { return null; },
        async revokeRefreshToken() { return false; },
        async resolveAccessTokenPrincipal({ principal }: { principal: AuthenticatedPrincipal }) {
          if (!principal.sessionId || revokedSessions.has(principal.sessionId) || user.disabledAt) return null;
          return { ...principal, role: user.role };
        },
        async getUser() {
          return { id: USER_ID, role: user.role, disabledAt: user.disabledAt };
        },
      },
      events,
    } as unknown as ServerApiPorts;
    const app = createFastifyServer({ ports, accessTokenSigner: SIGNER });
    const token = createAccessToken({
      signer: SIGNER,
      issuedAt: new Date(),
      expiresInSeconds: 15 * 60,
      principal: { userId: USER_ID, workspaceId: WORKSPACE_ID, role: 'user', sessionId: 'session-1' },
    });
    return { app, events, revokedSessions, token };
  }

  async function openSocket(app: ReturnType<typeof createFastifyServer>, token: string) {
    const socket = await app.injectWS('/api/v1/events', {
      headers: { 'sec-websocket-protocol': `${SERVER_EVENT_ACCESS_PROTOCOL_PREFIX}${token}` },
    }) as unknown as TestSocket;
    const messages: ServerEvent[] = [];
    socket.on('message', (data: { toString(): string }) => messages.push(JSON.parse(data.toString())));
    const closed = new Promise<{ code: number; reason: string }>((resolve) => {
      socket.on('close', (code: number, reason: Buffer) => resolve({ code, reason: reason.toString() }));
    });
    return { socket, messages, closed };
  }

  function dealEvent(): ServerEvent {
    return {
      type: 'deal.updated',
      workspaceId: WORKSPACE_ID,
      entityType: 'deal',
      entityId: '7',
      actorUserId: 'user-b',
      occurredAt: new Date().toISOString(),
      payload: { id: 7 },
    } as ServerEvent;
  }

  function skipRevalidationWindow() {
    const realNow = Date.now.bind(Date);
    jest.spyOn(Date, 'now').mockImplementation(() => realNow() + 11_000);
  }

  // F-A1-01: after a routine token refresh the socket was closed as "session revoked" with a fake email_acl.changed that wiped the client's mail state.
  test('a rotated access token ends the socket without a fake ACL invalidation', async () => {
    const { app, events, revokedSessions, token } = setup({ disabledAt: null, role: 'user' });
    try {
      await app.ready();
      const { socket, messages, closed } = await openSocket(app, token);

      // A regular refresh revokes the refresh-token row the socket's token is bound to.
      revokedSessions.add('session-1');
      skipRevalidationWindow();
      await events.publish(dealEvent());

      await expect(closed).resolves.toEqual({ code: 1008, reason: 'session expired' });
      expect(messages).toEqual([]);
      socket.terminate();
    } finally {
      await app.close();
    }
  });

  test('a disabled user still receives the ACL invalidation before the socket closes', async () => {
    const user = { disabledAt: null as string | null, role: 'user' as const };
    const { app, events, token } = setup(user);
    try {
      await app.ready();
      const { socket, messages, closed } = await openSocket(app, token);

      user.disabledAt = new Date().toISOString();
      skipRevalidationWindow();
      await events.publish(dealEvent());

      await expect(closed).resolves.toEqual({ code: 1008, reason: 'session revoked' });
      expect(messages.map((event) => [event.type, event.payload])).toEqual([
        ['email_acl.changed', { targetUserId: USER_ID, state: 'changed' }],
      ]);
      socket.terminate();
    } finally {
      await app.close();
    }
  });

  test('a valid session keeps receiving events after the revalidation window', async () => {
    const { app, events, token } = setup({ disabledAt: null, role: 'user' });
    try {
      await app.ready();
      const { socket, messages } = await openSocket(app, token);

      skipRevalidationWindow();
      await events.publish(dealEvent());

      await waitFor(() => messages.length === 1);
      expect(messages[0]).toMatchObject({ type: 'deal.updated', entityId: '7' });
      expect(socket.readyState).toBe(1);
      socket.terminate();
    } finally {
      await app.close();
    }
  });
});

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error('timed out waiting for websocket messages');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
