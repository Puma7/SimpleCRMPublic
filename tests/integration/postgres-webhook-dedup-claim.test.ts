import type { Kysely } from 'kysely';

import { createServerApi } from '../../packages/server/src/api/server-api';
import type { ApiRequest, ServerApiPorts } from '../../packages/server/src/api/types';
import { createPostgresSyncInfoPort } from '../../packages/server/src/db/postgres-sync-info-port';
import type { ServerDatabase } from '../../packages/server/src/db/schema';
import { startMigratedEmbeddedPostgres, type EmbeddedPostgres } from './helpers/embedded-postgres';

jest.mock('kysely', () => jest.requireActual('../../packages/server/node_modules/kysely'));

jest.setTimeout(120_000);

const WORKSPACE_ID = '10000000-0000-4000-8000-0000000000d7';
const USER_ID = '20000000-0000-4000-8000-0000000000d7';
const WEBHOOK_WORKFLOW = {
  id: 71,
  sourceSqliteId: 71,
  name: 'Webhook',
  triggerName: 'webhook.incoming',
  enabled: true,
};

function webhookRequest(body: Record<string, unknown>): ApiRequest {
  return {
    method: 'POST',
    path: '/api/v1/webhooks/incoming',
    body: { secret: 'secret-1', body },
    principal: { userId: USER_ID, workspaceId: WORKSPACE_ID, role: 'user' },
  };
}

// F-A3b-07: the incoming-webhook dedup was a non-atomic check-then-set written only after the
// enqueue loop, so two identical concurrent deliveries both enqueued every workflow.
describe('incoming webhook dedup claims atomically before enqueueing', () => {
  let postgres: EmbeddedPostgres;
  let db: Kysely<ServerDatabase>;

  beforeAll(async () => {
    postgres = await startMigratedEmbeddedPostgres('webhook-dedup-claim');
    await postgres.admin.query(`INSERT INTO workspaces (id, name) VALUES ($1, 'Webhook Dedup Claim')`, [WORKSPACE_ID]);
    db = postgres.createApplicationDb();
  });

  afterAll(async () => {
    if (db) await db.destroy();
    if (postgres) await postgres.stop();
  });

  beforeEach(async () => {
    await postgres.admin.query('DELETE FROM sync_info WHERE workspace_id = $1', [WORKSPACE_ID]);
    await postgres.admin.query(
      `INSERT INTO sync_info (workspace_id, key, value) VALUES ($1, 'email_webhook_secret', 'secret-1')`,
      [WORKSPACE_ID],
    );
  });

  function apiWith(jobQueue: NonNullable<ServerApiPorts['jobQueue']>) {
    return createServerApi({
      auth: {} as never,
      syncInfo: createPostgresSyncInfoPort({ db }),
      workflows: {
        async list() { return { items: [WEBHOOK_WORKFLOW], nextCursor: null }; },
        async get() { return null; },
      } as never,
      jobQueue,
    });
  }

  test('two identical concurrent deliveries enqueue the workflow exactly once', async () => {
    const enqueued: unknown[] = [];
    const api = apiWith({
      async enqueue(input) {
        enqueued.push(input);
        // Keep the first delivery inside its enqueue loop while the second one arrives.
        await new Promise((resolve) => setTimeout(resolve, 200));
      },
    } as never);

    const [first, second] = await Promise.all([
      api.handle(webhookRequest({ orderId: 4711 })),
      api.handle(webhookRequest({ orderId: 4711 })),
    ]);

    expect(enqueued).toHaveLength(1);
    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([200, 202]);
    const deduped = [first, second].find((response) => response.status === 200);
    expect((deduped?.body as { data: unknown }).data).toEqual({ success: true, fired: 0, deduplicated: true });
  });

  test('a failed enqueue releases the claim so the caller can retry', async () => {
    let failNext = true;
    const enqueued: unknown[] = [];
    const api = apiWith({
      async enqueue(input) {
        if (failNext) {
          failNext = false;
          throw new Error('queue unavailable');
        }
        enqueued.push(input);
      },
    } as never);

    await expect(api.handle(webhookRequest({ orderId: 4712 }))).rejects.toThrow('queue unavailable');
    const retry = await api.handle(webhookRequest({ orderId: 4712 }));

    expect(retry.status).toBe(202);
    expect(enqueued).toHaveLength(1);
  });

  test('the claim expires after the dedup window', async () => {
    const port = createPostgresSyncInfoPort({ db });
    const claim = (nowMs: number) => port.claimIfExpired({
      workspaceId: WORKSPACE_ID,
      key: 'webhook_dedup:window',
      nowMs,
      ttlMs: 5 * 60 * 1000,
    });

    const start = Date.UTC(2026, 8, 25, 12, 0, 0);
    await expect(claim(start)).resolves.toBe(true);
    await expect(claim(start + 60_000)).resolves.toBe(false);
    await expect(claim(start + 5 * 60 * 1000)).resolves.toBe(true);
    await expect(claim(start + 5 * 60 * 1000 + 1)).resolves.toBe(false);
  });
});
