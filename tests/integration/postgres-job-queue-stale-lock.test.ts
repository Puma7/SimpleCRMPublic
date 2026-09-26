import type { Kysely } from 'kysely';

import { createPostgresJobQueuePort } from '../../packages/server/src/db/postgres-job-queue-port';
import type { ServerDatabase } from '../../packages/server/src/db/schema';
import { startMigratedEmbeddedPostgres, type EmbeddedPostgres } from './helpers/embedded-postgres';

jest.mock('kysely', () => jest.requireActual('../../packages/server/node_modules/kysely'));

jest.setTimeout(120_000);

const WORKSPACE_ID = '10000000-0000-4000-8000-0000000000e5';
const ACCOUNT_ID = 551;
const FOLDER_ID = 561;
const MESSAGE_ID = 571;

// F-A2c-05: a job that crashed its worker was released by releaseStaleLocks with
// attempts unchanged, so it was re-claimed forever and never reached max_attempts.
describe('legacy job_queue stale lock release', () => {
  let postgres: EmbeddedPostgres;
  let db: Kysely<ServerDatabase>;

  beforeAll(async () => {
    postgres = await startMigratedEmbeddedPostgres('job-queue-stale-lock');
    const { admin } = postgres;
    await admin.query(`INSERT INTO workspaces (id, name) VALUES ($1, 'Stale Lock Test')`, [WORKSPACE_ID]);
    await admin.query(`
      INSERT INTO email_accounts (id, workspace_id, source_sqlite_id, display_name, email_address, imap_host, imap_username)
      VALUES ($1, $2, $1, 'Support', 'support@example.test', 'imap.example.test', 'support')
    `, [ACCOUNT_ID, WORKSPACE_ID]);
    await admin.query(`
      INSERT INTO email_folders (id, workspace_id, source_sqlite_id, account_source_sqlite_id, account_id, path)
      VALUES ($1, $2, $1, $3, $3, 'INBOX')
    `, [FOLDER_ID, WORKSPACE_ID, ACCOUNT_ID]);
    await admin.query(`
      INSERT INTO email_messages (
        id, workspace_id, source_sqlite_id, account_source_sqlite_id, folder_source_sqlite_id,
        account_id, folder_id, uid, subject
      ) VALUES ($1, $2, $1, $3, $4, $3, $4, 1, 'Crash chain')
    `, [MESSAGE_ID, WORKSPACE_ID, ACCOUNT_ID, FOLDER_ID]);
    db = postgres.createApplicationDb();
  });

  afterAll(async () => {
    if (db) await db.destroy();
    if (postgres) await postgres.stop();
  });

  beforeEach(async () => {
    await postgres.admin.query(`DELETE FROM job_queue`);
    await postgres.admin.query(`DELETE FROM sync_info WHERE workspace_id = $1`, [WORKSPACE_ID]);
  });

  test('a job that keeps crashing its worker stops after max_attempts and advances the inbound chain', async () => {
    let clock = new Date('2026-09-01T10:00:00.000Z');
    const port = createPostgresJobQueuePort({ db, now: () => clock });
    const job = await port.enqueue({
      workspaceId: WORKSPACE_ID,
      type: 'workflow.execute',
      payload: {
        workspaceId: WORKSPACE_ID,
        workflowId: 501,
        messageId: MESSAGE_ID,
        triggerName: 'inbound',
        actorUserId: 'user-a',
        context: { inboundWorkflowChain: { workflowIds: [501, 502], index: 0 } },
      },
      maxAttempts: 2,
    });

    for (let round = 0; round < 2; round += 1) {
      const claimed = await port.claimNext({ workerId: `worker-${round}`, now: clock });
      expect(claimed?.id).toBe(job.id);
      // The worker dies mid-job: neither complete() nor fail() runs.
      clock = new Date(clock.getTime() + 20 * 60_000);
      await port.releaseStaleLocks({ staleBefore: new Date(clock.getTime() - 15 * 60_000) });
    }

    const row = await postgres.admin.query<{ attempts: number; last_error: string | null; locked_at: Date | null }>(
      `SELECT attempts, last_error, locked_at FROM job_queue WHERE id = $1`,
      [job.id],
    );
    expect(row.rows).toEqual([{ attempts: 2, last_error: expect.stringContaining('Sperre'), locked_at: null }]);
    expect(await port.claimNext({ workerId: 'worker-2', now: clock })).toMatchObject({ payload: { workflowId: 502 } });

    const next = await postgres.admin.query<{ payload: { workflowId: number; context: unknown } }>(
      `SELECT payload FROM job_queue WHERE workspace_id = $1 AND id <> $2`,
      [WORKSPACE_ID, job.id],
    );
    expect(next.rows.map((entry) => [entry.payload.workflowId, entry.payload.context])).toEqual([
      [502, { inboundWorkflowChain: { workflowIds: [501, 502], index: 1 } }],
    ]);
  });
});
