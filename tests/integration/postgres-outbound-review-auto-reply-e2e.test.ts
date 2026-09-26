import type { Kysely } from 'kysely';

import { createPostgresEmailMessageReadPort } from '../../packages/server/src/db/postgres-mail-read-ports';
import type { ServerDatabase } from '../../packages/server/src/db/schema';
import { buildWorkflowExecutionJobPlan } from '../../packages/server/src/jobs/production-handlers';
import { isTrustedServiceJobPayload } from '../../packages/server/src/jobs/policy';
import type { JobPayload } from '../../packages/server/src/jobs/types';
import { createPostgresEmailComposeSenderPort } from '../../packages/server/src/mail-compose-send';
import { createPostgresScheduledSendJobPort } from '../../packages/server/src/mail-scheduled-send';
import { createPostgresWorkflowExecutionJobPort } from '../../packages/server/src/workflow-execution';
import { startMigratedEmbeddedPostgres, type EmbeddedPostgres } from './helpers/embedded-postgres';

jest.mock('kysely', () => jest.requireActual('../../packages/server/node_modules/kysely'));

jest.setTimeout(120_000);

const WORKSPACE_ID = '10000000-0000-4000-8000-0000000000e2';
const ACCOUNT_ID = 601;
const FOLDER_ID = 611;
const INBOUND_WORKFLOW_ID = 631;
const OUTBOUND_WORKFLOW_ID = 632;

/**
 * Teilautomatisierung P2, Server Ende-zu-Ende: Eine automatische Antwort mit
 * „Zusätzlich durch Ausgangs-Workflows prüfen“ (send_draft runOutboundReview:true)
 * wird geplant; beim Versand laufen die Ausgangs-Workflows (Dry-Run wie in
 * Produktion, dann als Dienst-Job). Freigabe ⇒ Versand mit Auto-Submitted,
 * Block ⇒ Entwurf im Posteingang.
 */
describe('Server: automatische Antwort durch den Ausgang', () => {
  let postgres: EmbeddedPostgres;
  let db: Kysely<ServerDatabase>;

  beforeAll(async () => {
    postgres = await startMigratedEmbeddedPostgres('outbound-review-auto-reply');
    const { admin } = postgres;
    await admin.query(`INSERT INTO workspaces (id, name) VALUES ($1, 'Outbound Auto Reply Test')`, [WORKSPACE_ID]);
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
      INSERT INTO sync_info (workspace_id, key, value, last_updated)
      VALUES ($1, 'auto_reply_enabled', 'true', now())
    `, [WORKSPACE_ID]);
    const inboundGraph = {
      version: 1,
      nodes: [
        { id: 'trigger-1', type: 'trigger', data: { kind: 'inbound' } },
        { id: 'cond', type: 'condition', data: { field: 'subject', op: 'contains', value: 'Frage' } },
        {
          id: 'send',
          type: 'registry',
          data: {
            nodeType: 'email.send_draft',
            config: { draftIdVariable: 'draft.id', runOutboundReview: true, runOnEveryInbound: true },
          },
        },
      ],
      edges: [
        { id: 'edge-1', source: 'trigger-1', target: 'cond' },
        { id: 'edge-2', source: 'cond', target: 'send', label: 'ja' },
      ],
    };
    await admin.query(`
      INSERT INTO email_workflows (
        id, workspace_id, source_sqlite_id, name, trigger_name, enabled, priority,
        definition_json, graph_json, execution_mode, engine_version
      ) VALUES ($1, $2, $1, 'Auto-Antwort', 'inbound', true, 50, '{}'::jsonb, $3::jsonb, 'graph', 1)
    `, [INBOUND_WORKFLOW_ID, WORKSPACE_ID, JSON.stringify(inboundGraph)]);
    db = postgres.createApplicationDb();
  });

  afterAll(async () => {
    if (db) await db.destroy();
    if (postgres) await postgres.stop();
  });

  beforeEach(async () => {
    await postgres.admin.query(`DELETE FROM job_queue`);
  });

  async function setOutboundWorkflow(node: Record<string, unknown>): Promise<void> {
    await postgres.admin.query(`DELETE FROM email_workflows WHERE workspace_id = $1 AND id = $2`, [WORKSPACE_ID, OUTBOUND_WORKFLOW_ID]);
    const graph = {
      version: 1,
      nodes: [{ id: 'trigger-1', type: 'trigger', data: { kind: 'outbound' } }, { id: 'step', type: 'registry', data: node }],
      edges: [{ id: 'edge-1', source: 'trigger-1', target: 'step' }],
    };
    await postgres.admin.query(`
      INSERT INTO email_workflows (
        id, workspace_id, source_sqlite_id, name, trigger_name, enabled, priority,
        definition_json, graph_json, execution_mode, engine_version
      ) VALUES ($1, $2, $1, 'Ausgang', 'outbound', true, 50, '{}'::jsonb, $3::jsonb, 'graph', 1)
    `, [OUTBOUND_WORKFLOW_ID, WORKSPACE_ID, JSON.stringify(graph)]);
  }

  async function seedInboundWithDraft(messageId: number, draftId: number): Promise<void> {
    const customer = `kunde${messageId}@example.com`;
    await postgres.admin.query(`
      INSERT INTO email_messages (
        id, workspace_id, source_sqlite_id, account_source_sqlite_id, folder_source_sqlite_id,
        account_id, folder_id, uid, subject, from_json, body_text
      ) VALUES ($1, $2, $1, $3, $4, $3, $4, $1, 'Frage', $5::jsonb, 'Wann kommt meine Bestellung?')
    `, [messageId, WORKSPACE_ID, ACCOUNT_ID, FOLDER_ID, JSON.stringify({ value: [{ address: customer }] })]);
    await postgres.admin.query(`
      INSERT INTO email_messages (
        id, workspace_id, source_sqlite_id, account_source_sqlite_id, folder_source_sqlite_id,
        account_id, folder_id, uid, folder_kind, subject, to_json, body_text, body_html
      ) VALUES ($1, $2, $1, $3, $4, $3, $4, $6, 'draft', 'Re: Frage', $5::jsonb, 'Ihre Bestellung kommt morgen.', '<p>Ihre Bestellung kommt morgen.</p>')
    `, [draftId, WORKSPACE_ID, ACCOUNT_ID, FOLDER_ID, JSON.stringify({ value: [{ address: customer }] }), -draftId]);
  }

  function composeSender(smtpSend: jest.Mock) {
    const execution = createPostgresWorkflowExecutionJobPort({ db });
    return createPostgresEmailComposeSenderPort({
      db,
      secrets: { async readSecret() { return Buffer.from('smtp-secret'); } } as never,
      smtpSend,
      // Wie in Produktion: synchroner Dry-Run der Ausgangs-Workflows.
      workflowDryRun: (plan) => execution.dryRun!(plan),
    });
  }

  async function tick(smtpSend: jest.Mock): Promise<void> {
    await createPostgresScheduledSendJobPort({ db, composeSender: composeSender(smtpSend) }).processDue({
      workspaceId: WORKSPACE_ID,
      trustedService: true,
      dueBefore: new Date(Date.now() + 1000),
      limit: 10,
    });
  }

  async function runQueuedWorkflowJobs(): Promise<JobPayload[]> {
    const rows = await postgres.admin.query<{ payload: JobPayload }>(
      `SELECT payload FROM job_queue WHERE workspace_id = $1 AND type = 'workflow.execute' ORDER BY id`,
      [WORKSPACE_ID],
    );
    await postgres.admin.query(`DELETE FROM job_queue WHERE workspace_id = $1`, [WORKSPACE_ID]);
    for (const row of rows.rows) {
      await createPostgresWorkflowExecutionJobPort({ db }).execute(buildWorkflowExecutionJobPlan(row.payload, WORKSPACE_ID));
    }
    return rows.rows.map((row) => row.payload);
  }

  async function draft(draftId: number) {
    const rows = await postgres.admin.query<{
      folder_kind: string;
      outbound_hold: boolean;
      outbound_block_reason: string | null;
      scheduled_send_at: Date | null;
      scheduled_send_trusted_service_principal: string | null;
    }>(`
      SELECT folder_kind, outbound_hold, outbound_block_reason, scheduled_send_at, scheduled_send_trusted_service_principal
      FROM email_messages WHERE workspace_id = $1 AND id = $2
    `, [WORKSPACE_ID, draftId]);
    return rows.rows[0]!;
  }

  async function runInbound(messageId: number, draftId: number): Promise<void> {
    await createPostgresWorkflowExecutionJobPort({ db }).execute({
      workspaceId: WORKSPACE_ID,
      workflowId: INBOUND_WORKFLOW_ID,
      messageId,
      triggerName: 'inbound',
      trustedService: true,
      context: { eventVariables: { 'draft.id': draftId } },
    });
    const planned = await draft(draftId);
    expect(planned.scheduled_send_at).not.toBeNull();
    expect(planned.scheduled_send_trusted_service_principal).not.toBeNull();
  }

  test('Freigabe durch den Ausgangs-Workflow: Versand als automatische Antwort', async () => {
    await setOutboundWorkflow({ nodeType: 'email.release_outbound', config: { autoSend: true } });
    await seedInboundWithDraft(6101, 6102);
    await runInbound(6101, 6102);
    const smtpSend = jest.fn(async () => undefined);

    await tick(smtpSend);
    expect(smtpSend).not.toHaveBeenCalled();
    const jobs = await runQueuedWorkflowJobs();
    expect(jobs).toHaveLength(1);
    expect(isTrustedServiceJobPayload(jobs[0]!)).toBe(true);
    const released = await draft(6102);
    expect(released.outbound_hold).toBe(false);
    expect(released.scheduled_send_at).not.toBeNull();

    await tick(smtpSend);

    expect(smtpSend).toHaveBeenCalledTimes(1);
    const rfc822 = String((smtpSend.mock.calls[0] as unknown as [{ rfc822: string }])[0].rfc822);
    expect(rfc822).toContain('Auto-Submitted: auto-replied');
    expect(rfc822).not.toContain('AUSGANGSPR');
    expect((await draft(6102)).folder_kind).toBe('sent');
    // TA-P3: send_draft hat die Herkunft gesetzt, versendet hat der Workflow ohne Menschen.
    const provenance = await postgres.admin.query(
      `SELECT sent_by_kind, sent_by_workflow_id::int AS workflow_id, sent_by_label FROM email_messages WHERE workspace_id = $1 AND id = 6102`,
      [WORKSPACE_ID],
    );
    expect(provenance.rows[0]).toEqual({
      sent_by_kind: 'workflow',
      workflow_id: INBOUND_WORKFLOW_ID,
      sent_by_label: 'Workflow „Auto-Antwort“',
    });
  });

  test('Block durch den Ausgangs-Workflow: Entwurf angehalten im Posteingang, kein Versand', async () => {
    await setOutboundWorkflow({ nodeType: 'email.hold_outbound', config: { reason: 'Liefertermin prüfen' } });
    await seedInboundWithDraft(6201, 6202);
    await runInbound(6201, 6202);
    const smtpSend = jest.fn(async () => undefined);

    await tick(smtpSend);
    await runQueuedWorkflowJobs();
    await tick(smtpSend);

    expect(smtpSend).not.toHaveBeenCalled();
    const held = await draft(6202);
    expect(held.outbound_hold).toBe(true);
    expect(held.outbound_block_reason).toBe('Liefertermin prüfen');
    expect(held.scheduled_send_at).toBeNull();
    const inbox = await createPostgresEmailMessageReadPort({ db }).list({
      workspaceId: WORKSPACE_ID,
      view: 'inbox',
      limit: 100,
    });
    expect(inbox.items.find((item) => item.id === 6202)).toEqual(expect.objectContaining({
      outboundHold: true,
      outboundBlockReason: 'Liefertermin prüfen',
    }));
  });
});
