import type { Kysely } from 'kysely';

import type { ServerDatabase } from '../../packages/server/src/db/schema';
import {
  buildWorkflowExecutionJobPlan,
  buildWorkflowForwardCopyJobPlan,
} from '../../packages/server/src/jobs/production-handlers';
import { isTrustedServiceJobPayload } from '../../packages/server/src/jobs/policy';
import type { JobPayload } from '../../packages/server/src/jobs/types';
import { createPostgresEmailComposeSenderPort } from '../../packages/server/src/mail-compose-send';
import { createPostgresScheduledSendJobPort } from '../../packages/server/src/mail-scheduled-send';
import { createPostgresWorkflowExecutionJobPort } from '../../packages/server/src/workflow-execution';
import { createPostgresWorkflowForwardCopyPort } from '../../packages/server/src/workflow-forward-copy';
import { startMigratedEmbeddedPostgres, type EmbeddedPostgres } from './helpers/embedded-postgres';

jest.mock('kysely', () => jest.requireActual('../../packages/server/node_modules/kysely'));

jest.setTimeout(120_000);

const WORKSPACE_ID = '10000000-0000-4000-8000-0000000000f2';
const USER_ID = '20000000-0000-4000-8000-0000000000f2';
const ACCOUNT_ID = 921;
const FOLDER_ID = 922;
const INBOUND_WORKFLOW_ID = 923;
const OUTBOUND_WORKFLOW_ID = 924;

/**
 * Teilautomatisierung P2 (Härtung): Die Weiterleitungskopie mit
 * „Durch Ausgangs-Workflows prüfen“ sendete mit dem Platzhalter 'system' als
 * Nutzer. Die Prüf-Jobs der Ausgangs-Workflows trugen ihn als actorUserId und
 * scheiterten im Job-Enforcer an der Nutzerauflösung — die Prüfung lief nie.
 * Ohne menschlichen Akteur laufen sie jetzt als Dienst (Trusted Service).
 */
describe('Server: Weiterleitungskopie durch den Ausgang', () => {
  let postgres: EmbeddedPostgres;
  let db: Kysely<ServerDatabase>;

  beforeAll(async () => {
    postgres = await startMigratedEmbeddedPostgres('forward-copy-outbound-review');
    const { admin } = postgres;
    await admin.query(`INSERT INTO workspaces (id, name) VALUES ($1, 'Forward Review Test')`, [WORKSPACE_ID]);
    await admin.query(`
      INSERT INTO users (id, workspace_id, email, display_name, password_hash, role)
      VALUES ($1, $2, 'anna@example.test', 'Anna Beispiel', 'x', 'owner')
    `, [USER_ID, WORKSPACE_ID]);
    await admin.query(`
      INSERT INTO email_accounts (
        id, workspace_id, source_sqlite_id, display_name, email_address, imap_host, imap_username,
        smtp_host, smtp_port, smtp_tls, smtp_username, smtp_use_imap_auth
      ) VALUES ($1, $2, $1, 'Support', 'support@example.test', 'imap.example.test', 'support',
        'smtp.example.test', 587, true, 'support', false)
    `, [ACCOUNT_ID, WORKSPACE_ID]);
    await admin.query(`
      INSERT INTO email_folders (id, workspace_id, source_sqlite_id, account_source_sqlite_id, account_id, path)
      VALUES ($1, $2, $1, $3, $3, 'INBOX')
    `, [FOLDER_ID, WORKSPACE_ID, ACCOUNT_ID]);
    await admin.query(`
      INSERT INTO email_workflows (
        id, workspace_id, source_sqlite_id, name, trigger_name, enabled, priority,
        definition_json, graph_json, execution_mode, engine_version
      ) VALUES ($1, $2, $1, 'Rechnungen weiterleiten', 'inbound', true, 50, '{}'::jsonb, NULL, 'graph', 1)
    `, [INBOUND_WORKFLOW_ID, WORKSPACE_ID]);
    const outboundGraph = {
      version: 1,
      nodes: [
        { id: 'trigger-1', type: 'trigger', data: { kind: 'outbound' } },
        { id: 'release', type: 'registry', data: { nodeType: 'email.release_outbound', config: { autoSend: true } } },
      ],
      edges: [{ id: 'edge-1', source: 'trigger-1', target: 'release' }],
    };
    await admin.query(`
      INSERT INTO email_workflows (
        id, workspace_id, source_sqlite_id, name, trigger_name, enabled, priority,
        definition_json, graph_json, execution_mode, engine_version
      ) VALUES ($1, $2, $1, 'Ausgang', 'outbound', true, 50, '{}'::jsonb, $3::jsonb, 'graph', 1)
    `, [OUTBOUND_WORKFLOW_ID, WORKSPACE_ID, JSON.stringify(outboundGraph)]);
    db = postgres.createApplicationDb();
  });

  afterAll(async () => {
    if (db) await db.destroy();
    if (postgres) await postgres.stop();
  });

  beforeEach(async () => {
    await postgres.admin.query(`DELETE FROM job_queue`);
  });

  async function seedInbound(id: number): Promise<void> {
    await postgres.admin.query(`
      INSERT INTO email_messages (
        id, workspace_id, source_sqlite_id, account_source_sqlite_id, folder_source_sqlite_id,
        account_id, folder_id, uid, subject, from_json, body_text
      ) VALUES ($1, $2, $1, $3, $4, $3, $4, $1, 'Rechnung 4711', $5::jsonb, 'Anbei die Rechnung.')
    `, [id, WORKSPACE_ID, ACCOUNT_ID, FOLDER_ID, JSON.stringify({ value: [{ address: 'lieferant@example.com' }] })]);
  }

  function composeSender(smtpSend: jest.Mock) {
    const execution = createPostgresWorkflowExecutionJobPort({ db });
    return createPostgresEmailComposeSenderPort({
      db,
      secrets: { async readSecret() { return Buffer.from('smtp-secret'); } } as never,
      smtpSend,
      workflowDryRun: (plan) => execution.dryRun!(plan),
    });
  }

  async function forward(messageId: number, payloadExtras: JobPayload, smtpSend: jest.Mock): Promise<void> {
    // Wie der Job-Worker: Plan aus dem Job-Payload (inkl. Akteur/Dienst-Marker).
    const plan = buildWorkflowForwardCopyJobPlan({
      workspaceId: WORKSPACE_ID,
      workflowId: INBOUND_WORKFLOW_ID,
      messageId,
      to: 'buchhaltung@example.com',
      runOutboundReview: true,
      ...payloadExtras,
    }, WORKSPACE_ID);
    await createPostgresWorkflowForwardCopyPort({
      db,
      secrets: { async readSecret() { return Buffer.from('smtp-secret'); } } as never,
      composeSender: composeSender(smtpSend),
      smtpSend: jest.fn(async () => { throw new Error('Direktversand ist mit Ausgangsprüfung ausgeschlossen'); }),
    }).forwardCopy(plan);
  }

  async function queuedReviewJobs(): Promise<JobPayload[]> {
    const rows = await postgres.admin.query<{ payload: JobPayload }>(
      `SELECT payload FROM job_queue WHERE workspace_id = $1 AND type = 'workflow.execute' ORDER BY id`,
      [WORKSPACE_ID],
    );
    return rows.rows.map((row) => row.payload);
  }

  /** Jüngster Weiterleitungs-Entwurf (die Tests laufen nacheinander). */
  async function forwardDraft() {
    const rows = await postgres.admin.query<{
      id: string;
      folder_kind: string;
      outbound_hold: boolean;
      scheduled_send_trusted_service_principal: string | null;
      scheduled_send_actor_user_id: string | null;
      sent_by_kind: string | null;
    }>(`
      SELECT id, folder_kind, outbound_hold, scheduled_send_trusted_service_principal,
        scheduled_send_actor_user_id, sent_by_kind
      FROM email_messages
      WHERE workspace_id = $1 AND uid < 0 AND subject LIKE '%Fwd: Rechnung 4711'
      ORDER BY id DESC LIMIT 1
    `, [WORKSPACE_ID]);
    return rows.rows[0]!;
  }

  test('ohne Menschen: Prüf-Jobs als Dienst, Freigabe, Versand als Workflow', async () => {
    await seedInbound(9201);
    const smtpSend = jest.fn(async () => undefined);

    await forward(9201, {}, smtpSend);

    expect(smtpSend).not.toHaveBeenCalled();
    const jobs = await queuedReviewJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).not.toHaveProperty('actorUserId');
    expect(isTrustedServiceJobPayload(jobs[0]!)).toBe(true);
    expect((await forwardDraft()).outbound_hold).toBe(true);

    // Der Ausgangs-Workflow gibt frei; der geplante Versand läuft als Dienst.
    await postgres.admin.query(`DELETE FROM job_queue WHERE workspace_id = $1`, [WORKSPACE_ID]);
    await createPostgresWorkflowExecutionJobPort({ db }).execute(buildWorkflowExecutionJobPlan(jobs[0]!, WORKSPACE_ID));
    const released = await forwardDraft();
    expect(released.outbound_hold).toBe(false);
    expect(released.scheduled_send_trusted_service_principal).not.toBeNull();
    expect(released.scheduled_send_actor_user_id).toBeNull();

    await createPostgresScheduledSendJobPort({ db, composeSender: composeSender(smtpSend) }).processDue({
      workspaceId: WORKSPACE_ID,
      trustedService: true,
      dueBefore: new Date(Date.now() + 1000),
      limit: 10,
    });
    expect(smtpSend).toHaveBeenCalledTimes(1);
    const sent = await forwardDraft();
    expect(sent.folder_kind).toBe('sent');
    expect(sent.sent_by_kind).toBe('workflow');
  });

  test('mit Menschen (Workflow von Hand gestartet): Prüf-Jobs laufen als dieser Nutzer', async () => {
    await seedInbound(9202);
    const smtpSend = jest.fn(async () => undefined);

    await forward(9202, { actorUserId: USER_ID }, smtpSend);

    const jobs = await queuedReviewJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toEqual(expect.objectContaining({ actorUserId: USER_ID }));
    expect(isTrustedServiceJobPayload(jobs[0]!)).toBe(false);
  });
});
