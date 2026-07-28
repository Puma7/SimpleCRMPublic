import { createFastifyServer } from '../../packages/server/src/api/fastify-adapter';
import type { ServerApiPorts } from '../../packages/server/src/api/types';
import { createAccessToken } from '../../packages/server/src/security/access-token';
import type { AccessTokenSigner } from '../../packages/server/src/security/access-token';

/**
 * Die WebSocket-Route ist der blinde Fleck der schnellen Auth-Probe.
 *
 * tests/unit/api-auth-surface.test.ts schiesst alle Routen gegen den
 * Dispatcher. `/api/v1/events` laeuft da aber nicht durch: sie wird direkt am
 * Fastify-Adapter registriert und prueft den Principal in handleEventSocket.
 * Der Dispatcher antwortet darauf mit 404, und 404 wertet die Probe als "gibt
 * es nicht" — eine entfernte Anmeldepflicht bliebe dort also unsichtbar,
 * waehrend der gesamte Ereignisstrom des Workspace oeffentlich waere.
 *
 * Geprobt wird sie deshalb hier, wo sie tatsaechlich stattfindet: ueber den
 * Adapter, mit injectWS und ohne Principal. Die Liste der WebSocket-Routen
 * haelt der Unit-Test mit dem Adapter zusammen, damit eine neu hinzugefuegte
 * nicht still an beiden Proben vorbeilaeuft.
 */
const SIGNER: AccessTokenSigner = { keyId: 'test', secret: Buffer.alloc(32, 21) };

/**
 * Jeder Datenzugriff wirft erkennbar — sonst waere "Verbindung zu" nicht von
 * "Handler war schon an den Daten" zu unterscheiden.
 */
function throwingPorts(trail = ''): unknown {
  const target = function reached() { /* aufrufbar */ } as unknown as Record<string, unknown>;
  return new Proxy(target, {
    get(_t, prop) {
      if (typeof prop === 'symbol') return undefined;
      if (prop === 'then') return undefined;
      return throwingPorts(trail ? `${trail}.${String(prop)}` : String(prop));
    },
    apply() {
      throw new Error(`PORT_REACHED:${trail}`);
    },
    has() { return true; },
  });
}

type CloseInfo = { code: number; reason: string };

async function connectAndWaitForClose(
  app: Awaited<ReturnType<typeof createFastifyServer>>,
  headers: Record<string, string> = {},
): Promise<CloseInfo | 'stayed-open'> {
  const socket = await app.injectWS('/api/v1/events', { headers });
  try {
    return await new Promise<CloseInfo | 'stayed-open'>((resolve) => {
      const timer = setTimeout(() => resolve('stayed-open'), 1_000);
      socket.on('close', (code: number, reason: Buffer) => {
        clearTimeout(timer);
        resolve({ code, reason: reason.toString() });
      });
    });
  } finally {
    if (socket.readyState === socket.OPEN) socket.close();
  }
}

describe('Ereignis-WebSocket ohne Anmeldung', () => {
  test('ohne Token wird die Verbindung abgewiesen', async () => {
    const app = createFastifyServer({
      ports: throwingPorts() as ServerApiPorts,
      accessTokenSigner: SIGNER,
    });
    try {
      await app.ready();
      // 1008 = policy violation. Nicht "irgendwie geschlossen": der Grund muss
      // die Anmeldung sein, sonst koennte auch ein Fehler im Handler so aussehen.
      expect(await connectAndWaitForClose(app)).toEqual({ code: 1008, reason: 'unauthorized' });
    } finally {
      await app.close();
    }
  });

  test('mit einem Token fremder Herkunft ebenso', async () => {
    const fremd = createAccessToken({
      signer: { keyId: 'test', secret: Buffer.alloc(32, 99) },
      issuedAt: new Date(),
      expiresInSeconds: 60,
      principal: { userId: 'user-a', workspaceId: 'workspace-a', role: 'user' },
    });
    const app = createFastifyServer({
      ports: throwingPorts() as ServerApiPorts,
      accessTokenSigner: SIGNER,
    });
    try {
      await app.ready();
      expect(await connectAndWaitForClose(app, { authorization: `Bearer ${fremd}` }))
        .toEqual({ code: 1008, reason: 'unauthorized' });
    } finally {
      await app.close();
    }
  });
});
