import type { Kysely } from 'kysely';

import type { ServerDatabase } from '../../packages/server/src/db/schema';
import type { EnqueueJobInput } from '../../packages/server/src/jobs/types';
import { runMailSyncSchedule } from '../../packages/server/src/jobs/mail-sync-scheduler';
import { buildMailSyncJobPlan } from '../../packages/server/src/jobs/production-handlers';
import { startMigratedEmbeddedPostgres, type EmbeddedPostgres } from './helpers/embedded-postgres';

jest.mock('kysely', () => jest.requireActual('../../packages/server/node_modules/kysely'));

jest.setTimeout(120_000);

const WORKSPACE_ID = '10000000-0000-4000-8000-0000000000fe';

// Der periodische Sync reihte Jobs mit accountId "7" (bigint kommt aus
// node-postgres als String) ein; der Handler verlangt eine Zahl und lehnte jeden
// Job ab — alle fuenf Minuten, je Konto, fuenf Versuche. Der Unit-Test des
// Schedulers sah das nicht: sein Datenbank-Nachbau lieferte Zahlen.
describe('periodic mail sync against real PostgreSQL', () => {
  let postgres: EmbeddedPostgres;
  let db: Kysely<ServerDatabase>;

  beforeAll(async () => {
    postgres = await startMigratedEmbeddedPostgres('mail-sync-scheduler');
    await postgres.admin.query(`INSERT INTO workspaces (id, name) VALUES ($1, 'Scheduler')`, [WORKSPACE_ID]);
    await postgres.admin.query(`
      INSERT INTO email_accounts (id, workspace_id, source_sqlite_id, display_name, email_address, imap_host, imap_username)
      VALUES (7, $1, 7, 'Info', 'info@example.test', 'imap.example.test', 'info')
    `, [WORKSPACE_ID]);
    db = postgres.createApplicationDb();
  });

  afterAll(async () => {
    if (db) await db.destroy();
    if (postgres) await postgres.stop();
  });

  test('the enqueued job is accepted by the sync handler', async () => {
    const jobs: EnqueueJobInput[] = [];
    const result = await runMailSyncSchedule({
      db,
      workspaceId: WORKSPACE_ID,
      queue: { async enqueue(job) { jobs.push(job); return job; } },
    });

    expect(result).toMatchObject({ enqueued: 1, failed: [] });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.type).toBe('mail.sync.imap');
    expect(jobs[0]!.payload.accountId).toBe(7);
    expect(buildMailSyncJobPlan(jobs[0]!.payload, WORKSPACE_ID, 'imap')).toMatchObject({
      workspaceId: WORKSPACE_ID,
      accountId: 7,
      protocol: 'imap',
    });
  });
});
