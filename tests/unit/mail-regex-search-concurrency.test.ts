import { createServerApi } from '../../packages/server/src/api/server-api';
import type { AuthenticatedPrincipal, ServerApiPorts } from '../../packages/server/src/api/types';

const USER_A: AuthenticatedPrincipal = { userId: 'user-a', workspaceId: 'workspace-1', role: 'owner' };
const USER_B: AuthenticatedPrincipal = { userId: 'user-b', workspaceId: 'workspace-1', role: 'owner' };

type ListInput = { search?: string };

function deferred(): { promise: Promise<void>; resolve: () => void; reject: (error: Error) => void } {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeApi() {
  const pending: Array<ReturnType<typeof deferred>> = [];
  const calls: string[] = [];
  const ports = {
    mailAccess: {
      async assertPermission() { return undefined; },
      async resolveScope() { return { kind: 'all' }; },
    },
    mailResourceLookup: {
      async resolve() { return []; },
    },
    emailMessages: {
      async list(input: ListInput) {
        calls.push(input.search ?? '');
        const gate = deferred();
        pending.push(gate);
        await gate.promise;
        return { items: [], nextCursor: null };
      },
    },
  } as unknown as ServerApiPorts;
  const api = createServerApi(ports);
  const search = (principal: AuthenticatedPrincipal, value: string) => api.handle({
    method: 'GET',
    path: '/api/v1/email/messages',
    principal,
    query: { search: value },
  });
  return { search, pending, calls };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

// F-A6-03: Ein Nutzer konnte beliebig viele Regex-Suchen parallel starten; jede hielt bis zum statement_timeout (10 s) eine der zehn Pool-Verbindungen.
describe('Regex-Suche im Postfach: hoechstens zwei gleichzeitig je Nutzer (F-A6-03, E5)', () => {
  test('die dritte gleichzeitige Regex-Suche eines Nutzers bekommt 429, andere Suchen laufen weiter', async () => {
    const { search, pending, calls } = makeApi();
    const first = search(USER_A, '/(a|b)+x/i');
    const second = search(USER_A, '/rechnung \\d+/');
    await flush();
    expect(calls).toHaveLength(2);

    const third = await search(USER_A, '/mahnung/');
    expect(third.status).toBe(429);
    expect(third.headers?.['Retry-After']).toBe('1');
    expect(JSON.stringify(third.body)).toContain('Regex-Suchen');
    expect(calls).toHaveLength(2);

    // Normale Suche und ein anderer Nutzer sind nicht betroffen.
    const plain = search(USER_A, 'mahnung');
    const otherUser = search(USER_B, '/mahnung/');
    await flush();
    expect(calls).toEqual(['/(a|b)+x/i', '/rechnung \\d+/', 'mahnung', '/mahnung/']);

    // Ein Schraegstrich ohne gueltiges Muster ist keine Regex-Suche.
    const notRegex = search(USER_A, '/(/');
    await flush();
    expect(calls).toHaveLength(5);

    for (const gate of pending) gate.resolve();
    for (const response of await Promise.all([first, second, plain, otherUser, notRegex])) {
      expect(response.status).toBe(200);
    }

    // Beendete Suchen geben ihren Platz frei — auch wenn sie scheitern.
    const again = search(USER_A, '/mahnung/');
    const failing = search(USER_A, '/rechnung/');
    await flush();
    pending[5]!.resolve();
    pending[6]!.reject(new Error('57014 statement timeout'));
    expect((await again).status).toBe(200);
    await expect(failing).rejects.toThrow('57014');

    const afterFailure = search(USER_A, '/a/');
    const afterFailure2 = search(USER_A, '/b/');
    await flush();
    expect(calls).toHaveLength(9);
    pending[7]!.resolve();
    pending[8]!.resolve();
    expect((await afterFailure).status).toBe(200);
    expect((await afterFailure2).status).toBe(200);
  });
});
