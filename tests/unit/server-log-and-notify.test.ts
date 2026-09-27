import { installConsoleLogCapture } from '../../packages/server/src/diagnostics/server-log-capture';
import { createServerLogStore } from '../../packages/server/src/diagnostics/server-log-store';
import { createPostgresServerEventNotificationChannel } from '../../packages/server/src/db/postgres-event-port';

// Die Server-Logs zeigten "[%s%s] %s: %s core  ERROR ...": graphile-worker loggt
// printf-artig, die Aufzeichnung speicherte nur die Vorlage.
describe('console log capture formats printf-style calls', () => {
  test('placeholders are filled, plain calls stay as before', () => {
    const store = createServerLogStore();
    const originalError = jest.fn();
    const target = { warn: jest.fn(), error: originalError };
    const uninstall = installConsoleLogCapture(store, target);
    try {
      target.error('[%s%s] %s: %s', 'core', '', 'ERROR', "Received 'SIGTERM'");
      target.warn('[%s%s] %s: %s', 'worker', '(worker-1)', 'WARNING', 'Failed task 5 with error %s');
      target.warn('workflow.forward_copy SMTP diagnostic', JSON.stringify({ smtpCode: 554 }));
      target.error('Job fehlgeschlagen', new Error('554 Reject'));
    } finally {
      uninstall();
    }
    expect(store.recent({ limit: 10 }).map((entry) => entry.message).reverse()).toEqual(expect.arrayContaining([
      "[core] ERROR: Received 'SIGTERM'",
      '[worker(worker-1)] WARNING: Failed task 5 with error %s',
      'workflow.forward_copy SMTP diagnostic {"smtpCode":554}',
      'Job fehlgeschlagen 554 Reject',
    ]));
    // The console itself still gets the unformatted call, as before.
    expect(originalError).toHaveBeenCalledWith('[%s%s] %s: %s', 'core', '', 'ERROR', "Received 'SIGTERM'");
  });
});

// Jede Anfrage und jeder Job veroeffentlicht Ereignisse ueber EINE Verbindung
// (die mit LISTEN). Ueberlappende client.query()-Aufrufe loesten die
// pg-Warnung "already executing a query" aus und fallen in pg@9 weg.
describe('event notifications share one connection one at a time', () => {
  test('concurrent notify calls never overlap on the client', async () => {
    let running = 0;
    let maxRunning = 0;
    const sent: string[] = [];
    const client = {
      async connect() { return undefined; },
      async query(sql: string, params?: readonly unknown[]) {
        if (!sql.startsWith('SELECT pg_notify')) return {};
        running += 1;
        maxRunning = Math.max(maxRunning, running);
        await new Promise((resolve) => setTimeout(resolve, 5));
        running -= 1;
        const payload = JSON.parse(String(params?.[1])) as { sequence: number };
        if (payload.sequence === 3) throw new Error('connection hiccup');
        sent.push(String(payload.sequence));
        return {};
      },
      async end() { return undefined; },
      on() { return undefined; },
    };
    const channel = await createPostgresServerEventNotificationChannel({
      databaseUrl: 'postgres://simplecrm@postgres/simplecrm',
      createClient: () => client as never,
    });
    const results = await Promise.allSettled([1, 2, 3, 4, 5].map((sequence) => channel.notify({
      workspaceId: '11111111-1111-4111-8111-111111111111',
      sequence,
    })));

    expect(maxRunning).toBe(1);
    expect(sent).toEqual(['1', '2', '4', '5']);
    // A failed notification is reported to its caller and does not block later ones.
    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'fulfilled', 'rejected', 'fulfilled', 'fulfilled']);
  });
});
