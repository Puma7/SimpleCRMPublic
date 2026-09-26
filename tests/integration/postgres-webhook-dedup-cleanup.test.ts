import type { Kysely } from 'kysely';

import type { ServerDatabase } from '../../packages/server/src/db/schema';
import { createMaintenanceJobHandlers } from '../../packages/server/src/jobs/maintenance-handlers';
import type { QueuedJob } from '../../packages/server/src/jobs/types';
import { startMigratedEmbeddedPostgres, type EmbeddedPostgres } from './helpers/embedded-postgres';

jest.mock('kysely', () => jest.requireActual('../../packages/server/node_modules/kysely'));

jest.setTimeout(120_000);

const WORKSPACE_ID = '10000000-0000-4000-8000-0000000000d6';
const NOW = new Date('2026-09-25T12:00:00.000Z');

function cleanupJob(payload: Record<string, unknown> = {}): QueuedJob {
  return {
    id: 1,
    type: 'lock.cleanup',
    payload: { workspaceId: WORKSPACE_ID, ...payload },
    runAfter: NOW.toISOString(),
    attempts: 0,
    maxAttempts: 5,
    lockedAt: null,
    lockedBy: null,
    lastError: null,
    workspaceId: WORKSPACE_ID,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
  } as QueuedJob;
}

// F-A3b-06: the incoming-webhook dedup markers `webhook_dedup:*` were never deleted,
// so sync_info grew by one row per distinct webhook body forever.
describe('lock.cleanup removes expired incoming-webhook dedup markers', () => {
  let postgres: EmbeddedPostgres;
  let db: Kysely<ServerDatabase>;

  beforeAll(async () => {
    postgres = await startMigratedEmbeddedPostgres('webhook-dedup-cleanup');
    await postgres.admin.query(`INSERT INTO workspaces (id, name) VALUES ($1, 'Webhook Dedup Cleanup')`, [WORKSPACE_ID]);
    db = postgres.createApplicationDb();
  });

  afterAll(async () => {
    if (db) await db.destroy();
    if (postgres) await postgres.stop();
  });

  beforeEach(async () => {
    await postgres.admin.query('DELETE FROM sync_info WHERE workspace_id = $1', [WORKSPACE_ID]);
  });

  async function insertMarker(key: string, ageMs: number): Promise<void> {
    await postgres.admin.query(
      `INSERT INTO sync_info (workspace_id, key, value, last_updated) VALUES ($1, $2, $3, $4)`,
      [WORKSPACE_ID, key, String(NOW.getTime() - ageMs), new Date(NOW.getTime() - ageMs)],
    );
  }

  async function remainingKeys(): Promise<string[]> {
    const result = await postgres.admin.query<{ key: string }>(
      'SELECT key FROM sync_info WHERE workspace_id = $1',
      [WORKSPACE_ID],
    );
    return result.rows.map((row) => row.key).sort();
  }

  test('deletes markers past the dedup window and keeps fresh or unrelated keys', async () => {
    await insertMarker('webhook_dedup:old-1', 2 * 60 * 60 * 1000);
    await insertMarker('webhook_dedup:old-2', 3 * 24 * 60 * 60 * 1000);
    await insertMarker('webhook_dedup:fresh', 60 * 1000);
    // LIKE must treat "_" literally: this key is no dedup marker.
    await insertMarker('webhookXdedup:unrelated', 3 * 24 * 60 * 60 * 1000);
    await insertMarker('inbound_terminal_child_done:1:2:n#e:1', 2 * 60 * 60 * 1000);

    const handlers = createMaintenanceJobHandlers({ db, now: () => NOW });
    await handlers['lock.cleanup']?.(cleanupJob());

    expect(await remainingKeys()).toEqual([
      'inbound_terminal_child_done:1:2:n#e:1',
      'webhookXdedup:unrelated',
      'webhook_dedup:fresh',
    ]);
  });

  test('works through a backlog in bounded batches and requeues while batches are full', async () => {
    for (let index = 0; index < 5; index += 1) {
      await insertMarker(`webhook_dedup:backlog-${index}`, 2 * 60 * 60 * 1000);
    }
    const requeued: string[] = [];
    const handlers = createMaintenanceJobHandlers({
      db,
      now: () => NOW,
      requeue: {
        async enqueue(input) {
          requeued.push(input.type);
          return undefined;
        },
      },
    });

    await handlers['lock.cleanup']?.(cleanupJob({ limit: 2 }));

    expect(await remainingKeys()).toHaveLength(3);
    expect(requeued).toEqual(['lock.cleanup']);
  });
});
