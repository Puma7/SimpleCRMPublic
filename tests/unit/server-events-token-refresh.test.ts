import type { RendererTransport } from '../../src/services/transport/renderer-transport';
import {
  buildServerAuthSession,
  clearServerAuthSession,
  saveServerAuthSession,
} from '../../src/services/transport/server-auth-session';
import { subscribeServerEvents, type ServerEvent } from '../../src/services/transport/server-events';

const SERVER_URL = 'https://crm.example.test';

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  onmessage: ((message: { data: string }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onclose: (() => void) | null = null;
  closed = false;

  constructor(public readonly url: string, public readonly protocols?: string[]) {
    FakeWebSocket.instances.push(this);
  }

  close(): void {
    this.closed = true;
  }

  emit(event: Partial<ServerEvent>): void {
    this.onmessage?.({ data: JSON.stringify(event) });
  }
}

function saveSession(accessToken: string): void {
  saveServerAuthSession(
    buildServerAuthSession({
      user: { id: 'user-a', workspaceId: 'workspace-a', email: 'a@example.test', displayName: 'A', role: 'user' },
      tokens: { accessToken, expiresInSeconds: 900 },
    }),
    'csrf-token',
    null,
    null,
    SERVER_URL,
  );
}

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

describe('server event subscription across an access-token refresh', () => {
  const transport = { kind: 'http', serverBaseUrl: SERVER_URL } as RendererTransport;

  beforeEach(() => {
    jest.useFakeTimers();
    FakeWebSocket.instances = [];
  });

  afterEach(() => {
    clearServerAuthSession(null, null, SERVER_URL);
    jest.useRealTimers();
  });

  // F-A1-01: the socket kept the access token it was opened with, so the server closed it after every refresh and the client never re-authenticated.
  test('reconnects with the refreshed token and the replay cursor', async () => {
    saveSession('token-1');
    const received: ServerEvent[] = [];
    const subscription = subscribeServerEvents({
      transport,
      WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
      onEvent: (event) => received.push(event),
    });
    await flushMicrotasks();
    expect(FakeWebSocket.instances).toHaveLength(1);
    const first = FakeWebSocket.instances[0];
    expect(first.protocols).toEqual(['simplecrm.access-token.token-1']);
    first.emit({ type: 'deal.updated', sequence: 7 });

    saveSession('token-2');
    await flushMicrotasks();

    expect(first.closed).toBe(true);
    expect(FakeWebSocket.instances).toHaveLength(2);
    const second = FakeWebSocket.instances[1];
    expect(second.protocols).toEqual(['simplecrm.access-token.token-2']);
    expect(new URL(second.url).searchParams.get('since')).toBe('7');

    // The replaced socket is detached: its late frames and close neither reach the
    // subscriber nor schedule a second reconnect.
    first.emit({ type: 'email_acl.changed', payload: { targetUserId: 'user-a' } });
    first.onclose?.();
    jest.advanceTimersByTime(60_000);
    await flushMicrotasks();
    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(received.map((event) => event.type)).toEqual(['deal.updated']);

    subscription.unsubscribe();
    expect(second.closed).toBe(true);
  });

  test('keeps the socket when the same token is saved again and stops listening after unsubscribe', async () => {
    saveSession('token-1');
    const subscription = subscribeServerEvents({
      transport,
      WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
      onEvent: () => undefined,
    });
    await flushMicrotasks();

    saveSession('token-1');
    await flushMicrotasks();
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(FakeWebSocket.instances[0].closed).toBe(false);

    subscription.unsubscribe();
    saveSession('token-2');
    await flushMicrotasks();
    expect(FakeWebSocket.instances).toHaveLength(1);
  });
});
