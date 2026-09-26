import type { Kysely } from 'kysely';

import type { ServerDatabase } from '../../packages/server/src/db/schema';
import { createPostgresReadReceiptOutboundReviewPort } from '../../packages/server/src/mail-read-receipt-responder';
import { startMigratedEmbeddedPostgres, type EmbeddedPostgres } from './helpers/embedded-postgres';

jest.mock('kysely', () => jest.requireActual('../../packages/server/node_modules/kysely'));

jest.setTimeout(120_000);

const WORKSPACE_ID = '10000000-0000-4000-8000-0000000000e1';
const ACCOUNT_ID = 801;
const FOLDER_ID = 811;
const MESSAGE_ID = 821;
const WORKFLOW_ID = 831;

// F-A5-11: every click on "Lesebestaetigung senden" queued a new round of
// outbound review runs and jobs, even while the previous review was still
// pending. A finished review now releases the MDN (E24, see
// postgres-read-receipt-review-release.test.ts).
describe('read receipt outbound review while a review is pending', () => {
  let postgres: EmbeddedPostgres;
  let db: Kysely<ServerDatabase>;

  beforeAll(async () => {
    postgres = await startMigratedEmbeddedPostgres('read-receipt-review-pending');
    const { admin } = postgres;
    await admin.query(`INSERT INTO workspaces (id, name) VALUES ($1, 'MDN Review Test')`, [WORKSPACE_ID]);
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
        account_id, folder_id, uid, subject, from_json
      ) VALUES ($1, $2, $1, $3, $4, $3, $4, $1, 'Angebot', $5::jsonb)
    `, [MESSAGE_ID, WORKSPACE_ID, ACCOUNT_ID, FOLDER_ID, JSON.stringify({ value: [{ address: 'kunde@example.com' }] })]);
    await admin.query(`
      INSERT INTO email_workflows (
        id, workspace_id, source_sqlite_id, name, trigger_name, enabled, priority,
        definition_json, graph_json, execution_mode, engine_version
      ) VALUES ($1, $2, $1, 'Ausgangspruefung', 'outbound', true, 1, '{}'::jsonb, NULL, 'graph', 1)
    `, [WORKFLOW_ID, WORKSPACE_ID]);
    db = postgres.createApplicationDb();
  });

  afterAll(async () => {
    if (db) await db.destroy();
    if (postgres) await postgres.stop();
  });

  async function countRowsForMessage(): Promise<{ runs: number; jobs: number }> {
    const runs = await postgres.admin.query(
      `SELECT count(*)::int AS n FROM email_workflow_runs WHERE workspace_id = $1 AND message_id = $2`,
      [WORKSPACE_ID, MESSAGE_ID],
    );
    const jobs = await postgres.admin.query(
      `SELECT count(*)::int AS n FROM job_queue WHERE workspace_id = $1 AND (payload->>'messageId')::int = $2`,
      [WORKSPACE_ID, MESSAGE_ID],
    );
    return { runs: runs.rows[0].n as number, jobs: jobs.rows[0].n as number };
  }

  test('repeated clicks reuse the pending review instead of queueing new runs', async () => {
    const guard = createPostgresReadReceiptOutboundReviewPort({ db });
    const input = {
      workspaceId: WORKSPACE_ID,
      actorUserId: 'user-a',
      messageId: MESSAGE_ID,
      subject: 'Gelesen: Angebot',
      bodyText: 'Lesebestaetigung',
      to: 'kunde@example.com',
    };

    const first = await guard.review(input);
    expect(first).toMatchObject({ allowed: false });
    const firstRunId = (first as { workflowRunId?: number | null }).workflowRunId;
    expect(typeof firstRunId).toBe('number');
    expect(await countRowsForMessage()).toEqual({ runs: 1, jobs: 1 });

    await expect(guard.review(input)).resolves.toEqual({
      allowed: false,
      error: expect.stringContaining('Ausgangspruefung fuer Lesebestaetigung'),
      workflowRunId: firstRunId,
    });
    await postgres.admin.query(
      `UPDATE email_workflow_runs SET status = 'running' WHERE id = $1`,
      [firstRunId],
    );
    await expect(guard.review(input)).resolves.toMatchObject({ allowed: false, workflowRunId: firstRunId });
    expect(await countRowsForMessage()).toEqual({ runs: 1, jobs: 1 });

    // Once the review finished without a block (run ok, its job done), the
    // MDN is released instead of queueing a fresh review (E24).
    await postgres.admin.query(
      `UPDATE email_workflow_runs SET status = 'ok', finished_at = now() WHERE id = $1`,
      [firstRunId],
    );
    await postgres.admin.query(`DELETE FROM job_queue WHERE workspace_id = $1`, [WORKSPACE_ID]);
    await expect(guard.review(input)).resolves.toEqual({ allowed: true });
    expect(await countRowsForMessage()).toEqual({ runs: 1, jobs: 0 });
  });
});
