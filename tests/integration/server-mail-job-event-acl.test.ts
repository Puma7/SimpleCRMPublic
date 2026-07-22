import { EventEmitter } from 'node:events';

import {
  createFastifyServer,
  createInMemoryServerEventBus,
  type ServerApiPorts,
  type ServerEvent,
} from '../../packages/server/src/api';
import type { MailAccessActor } from '../../packages/server/src/mail-access/types';

describe('server mail event ACL', () => {
  test('fastify websocket filters live and replayed mail events per principal and minimizes payload canaries', async () => {
    const events = createInMemoryServerEventBus();
    await events.publish(mailMessageEvent(40, {
      subject: 'CANARY_SUBJECT',
      body: 'CANARY_BODY',
      from: 'sender-canary@example.test',
      filename: 'secret-canary.pdf',
      ip: '203.0.113.77',
      userAgent: 'CanaryBrowser/1.0',
      token: 'tracking-token-canary',
      state: 'updated',
    }));
    await events.publish(nonMailEvent('customer-replay', 'customer.updated'));
    const app = createFastifyServer({
      ports: makeEventPorts(events),
      allowHeaderPrincipalFallback: true,
    });
    let userA: Awaited<ReturnType<typeof app.injectWS>> | null = null;
    let userB: Awaited<ReturnType<typeof app.injectWS>> | null = null;

    try {
      await app.ready();
      userA = await app.injectWS('/api/v1/events?since=0', {
        headers: {
          'x-simplecrm-user-id': 'user-a',
          'x-simplecrm-workspace-id': 'workspace-a',
          'x-simplecrm-role': 'user',
        },
      });
      userB = await app.injectWS('/api/v1/events?since=0', {
        headers: {
          'x-simplecrm-user-id': 'user-b',
          'x-simplecrm-workspace-id': 'workspace-a',
          'x-simplecrm-role': 'user',
        },
      });

      const userAMessages = collectWebSocketMessages(userA);
      const userBMessages = collectWebSocketMessages(userB);
      await waitFor(() => userAMessages.length === 2);

      await events.publish(nonMailEvent('customer-1'));
      await events.publish(mailMessageEvent(41, { state: 'updated', subject: 'HIDDEN_B' }));
      await events.publish(mailMessageEvent(42, { state: 'updated', subject: 'HIDDEN_A' }));

      await waitFor(() => userAMessages.length === 4 && userBMessages.length === 3);

      expect(userAMessages.map((event) => [event.type, event.entityId])).toEqual([
        ['email_message.updated', '40'],
        ['customer.updated', 'customer-replay'],
        ['customer.created', 'customer-1'],
        ['email_message.updated', '41'],
      ]);
      expect(userBMessages.map((event) => [event.type, event.entityId])).toEqual([
        ['customer.updated', 'customer-replay'],
        ['customer.created', 'customer-1'],
        ['email_message.updated', '42'],
      ]);

      const serialized = JSON.stringify([...userAMessages, ...userBMessages]);
      for (const canary of [
        'CANARY_SUBJECT',
        'CANARY_BODY',
        'sender-canary@example.test',
        'secret-canary.pdf',
        '203.0.113.77',
        'CanaryBrowser/1.0',
        'tracking-token-canary',
        'HIDDEN_A',
        'HIDDEN_B',
      ]) {
        expect(serialized).not.toContain(canary);
      }
      expect(userAMessages.find((event) => event.entityId === '40')?.payload)
        .toEqual({ messageId: 40, state: 'updated' });
    } finally {
      await closeWebSocket(userA);
      await closeWebSocket(userB);
      await app.close();
    }
  });
});

function makeEventPorts(events: ReturnType<typeof createInMemoryServerEventBus>): ServerApiPorts {
  return {
    auth: {
      async findUserByEmail() { return null; },
      async verifyPassword() { return false; },
      async recordFailedLogin() { return 1; },
      async recordSuccessfulLogin() { return undefined; },
      async issueTokenPair() {
        return { accessToken: 'a', refreshToken: 'r', expiresInSeconds: 900 };
      },
      async rotateRefreshToken() { return null; },
      async revokeRefreshToken() { return false; },
    },
    locks: {
      async list() { return []; },
      async acquire() { throw new Error('not used'); },
      async get() { return null; },
      async heartbeat() { return null; },
      async release() { return null; },
      async forceTakeover() { throw new Error('not used'); },
    },
    events,
    mailAccess: {
      async assertPermission(input) {
        const actor = input.actor as MailAccessActor;
        const resource = input.resource;
        if (resource.type === 'message') {
          if (actor.userId === 'user-a' && (resource.messageId === '40' || resource.messageId === '41')) return;
          if (actor.userId === 'user-b' && resource.messageId === '42') return;
        }
        throw new Error('mail_access_denied');
      },
      async resolveScope() {
        return { kind: 'none' };
      },
    },
    mailResourceLookup: {
      async resolve(input) {
        const target = input.target;
        if (target.kind === 'message') {
          return [{
            type: 'message',
            accountId: '7',
            folderId: '8',
            messageId: String(target.id),
          }];
        }
        if (target.kind === 'account') {
          return [{ type: 'account', accountId: String(target.id) }];
        }
        return [];
      },
    },
  } as ServerApiPorts;
}

function mailMessageEvent(messageId: number, payload: Record<string, unknown>): ServerEvent {
  return {
    type: 'email_message.updated',
    workspaceId: 'workspace-a',
    entityType: 'email_message',
    entityId: String(messageId),
    actorUserId: 'actor-a',
    occurredAt: '2026-07-19T10:00:00.000Z',
    payload: { messageId, ...payload },
  };
}

function nonMailEvent(
  entityId: string,
  type: Extract<ServerEvent['type'], 'customer.created' | 'customer.updated'> = 'customer.created',
): ServerEvent {
  return {
    type,
    workspaceId: 'workspace-a',
    entityType: 'customer',
    entityId,
    actorUserId: 'actor-a',
    occurredAt: '2026-07-19T10:00:01.000Z',
    payload: { id: entityId, name: 'Visible Customer' },
  };
}

function collectWebSocketMessages(
  socket: (EventEmitter & { readyState: number }) | null,
): ServerEvent[] {
  if (!socket) throw new Error('missing websocket');
  const messages: ServerEvent[] = [];
  socket.on('message', (data: { toString(): string }) => {
    messages.push(JSON.parse(data.toString()));
  });
  return messages;
}

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error('timed out waiting for websocket messages');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function closeWebSocket(socket: {
  readyState: number;
  close(): void;
  terminate?: () => void;
  once(event: 'close', listener: () => void): void;
} | null): Promise<void> {
  if (!socket || socket.readyState === 3) return Promise.resolve();
  if (socket.terminate) {
    socket.terminate();
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    socket.once('close', resolve);
    socket.close();
  });
}
