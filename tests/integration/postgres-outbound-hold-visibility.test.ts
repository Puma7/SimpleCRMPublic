import type { Kysely } from 'kysely';

import { createPostgresEmailMessageReadPort } from '../../packages/server/src/db/postgres-mail-read-ports';
import type { ServerDatabase } from '../../packages/server/src/db/schema';
import { buildWorkflowExecutionJobPlan } from '../../packages/server/src/jobs/production-handlers';
import { isTrustedServiceJobPayload, TRUSTED_SERVICE_JOB_MARKER_VALUE } from '../../packages/server/src/jobs/policy';
import type { JobPayload } from '../../packages/server/src/jobs/types';
import type { WorkflowExecutionDryRunResult } from '../../packages/server/src/jobs';
import { createPostgresEmailComposeSenderPort } from '../../packages/server/src/mail-compose-send';
import { createPostgresScheduledSendJobPort } from '../../packages/server/src/mail-scheduled-send';
import { createPostgresWorkflowExecutionJobPort } from '../../packages/server/src/workflow-execution';
import { createPostgresOutboundReviewSkipPort } from '../../packages/server/src/mail-outbound-review-skip';
import type { EmailComposeSenderApiPort } from '../../packages/server/src/api';
import {
  OUTBOUND_HOLD_FALLBACK_REASON,
  OUTBOUND_WARNING_MARKER,
} from '../../packages/core/src/email';
import { startMigratedEmbeddedPostgres, type EmbeddedPostgres } from './helpers/embedded-postgres';

jest.mock('kysely', () => jest.requireActual('../../packages/server/node_modules/kysely'));

jest.setTimeout(120_000);

const WORKSPACE_ID = '10000000-0000-4000-8000-0000000000e1';
const ACCOUNT_ID = 501;
const FOLDER_ID = 511;
const HOLD_WORKFLOW_ID = 531;
const PENDING_REVIEW_TEXT = 'serverseitig';

/**
 * Teilautomatisierung P2: Angehaltene Entwürfe müssen in der Server-Oberfläche
 * als angehalten erscheinen (Grund inklusive) und dürfen nicht unsichtbar
 * „geplant“ hängen bleiben.
 */
describe('Server: angehaltene Entwürfe im Posteingang', () => {
  let postgres: EmbeddedPostgres;
  let db: Kysely<ServerDatabase>;

  beforeAll(async () => {
    postgres = await startMigratedEmbeddedPostgres('outbound-hold-visibility');
    const { admin } = postgres;
    await admin.query(`INSERT INTO workspaces (id, name) VALUES ($1, 'Outbound Hold Test')`, [WORKSPACE_ID]);
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
    db = postgres.createApplicationDb();
  });

  afterAll(async () => {
    if (db) await db.destroy();
    if (postgres) await postgres.stop();
  });

  async function seedDraft(draftId: number, fields: { hold: boolean; reason: string | null }): Promise<void> {
    await postgres.admin.query(`
      INSERT INTO email_messages (
        id, workspace_id, source_sqlite_id, account_source_sqlite_id, folder_source_sqlite_id,
        account_id, folder_id, uid, folder_kind, subject, to_json, body_text, outbound_hold, outbound_block_reason
      ) VALUES ($1, $2, $1, $3, $4, $3, $4, $5, 'draft', 'Re: Frage', $6::jsonb, 'Antwort', $7, $8)
    `, [
      draftId,
      WORKSPACE_ID,
      ACCOUNT_ID,
      FOLDER_ID,
      -draftId,
      JSON.stringify({ value: [{ address: `kunde${draftId}@example.com` }] }),
      fields.hold,
      fields.reason,
    ]);
  }

  test('Posteingang und Einzelabruf liefern outboundHold und den Grund', async () => {
    await seedDraft(5101, { hold: true, reason: 'Preisangabe fehlt' });
    const port = createPostgresEmailMessageReadPort({ db });

    const inbox = await port.list({ workspaceId: WORKSPACE_ID, view: 'inbox', limit: 50 });
    const row = inbox.items.find((item) => item.id === 5101);
    expect(row).toEqual(expect.objectContaining({ outboundHold: true, outboundBlockReason: 'Preisangabe fehlt' }));

    const single = await port.get({ workspaceId: WORKSPACE_ID, id: 5101, includeBody: true });
    expect(single).toEqual(expect.objectContaining({ outboundHold: true, outboundBlockReason: 'Preisangabe fehlt' }));
  });

  async function seedHoldWorkflow(reason: string): Promise<void> {
    await postgres.admin.query(`DELETE FROM email_workflows WHERE workspace_id = $1`, [WORKSPACE_ID]);
    const graph = {
      version: 1,
      nodes: [
        { id: 'trigger-1', type: 'trigger', data: { kind: 'outbound' } },
        { id: 'hold', type: 'registry', data: { nodeType: 'email.hold_outbound', config: { reason } } },
      ],
      edges: [{ id: 'edge-1', source: 'trigger-1', target: 'hold' }],
    };
    await postgres.admin.query(`
      INSERT INTO email_workflows (
        id, workspace_id, source_sqlite_id, name, trigger_name, enabled, priority,
        definition_json, graph_json, execution_mode, engine_version
      ) VALUES ($1, $2, $1, 'Ausgang: Sperre', 'outbound', true, 10, '{}'::jsonb, $3::jsonb, 'graph', 1)
    `, [HOLD_WORKFLOW_ID, WORKSPACE_ID, JSON.stringify(graph)]);
  }

  /** Workflow-Versand: KI-Antwort per send_draft (runOutboundReview:true) eingeplant. */
  async function seedWorkflowScheduledDraft(draftId: number): Promise<void> {
    await postgres.admin.query(`
      INSERT INTO email_messages (
        id, workspace_id, source_sqlite_id, account_source_sqlite_id, folder_source_sqlite_id,
        account_id, folder_id, uid, folder_kind, subject, to_json, body_text, body_html,
        scheduled_send_at, scheduled_send_trusted_service_principal
      ) VALUES ($1, $2, $1, $3, $4, $3, $4, $5, 'draft', 'Re: Frage', $6::jsonb,
        'Antwort an den Kunden', '<p>Antwort an den Kunden</p>', now() - interval '1 minute', $7)
    `, [
      draftId,
      WORKSPACE_ID,
      ACCOUNT_ID,
      FOLDER_ID,
      -draftId,
      JSON.stringify({ value: [{ address: `kunde${draftId}@example.com` }] }),
      TRUSTED_SERVICE_JOB_MARKER_VALUE,
    ]);
  }

  async function draftRow(draftId: number) {
    const rows = await postgres.admin.query<{
      outbound_hold: boolean;
      outbound_block_reason: string | null;
      scheduled_send_at: Date | null;
      scheduled_send_actor_user_id: string | null;
      scheduled_send_trusted_service_principal: string | null;
      body_text: string | null;
      body_html: string | null;
    }>(`
      SELECT outbound_hold, outbound_block_reason, scheduled_send_at, scheduled_send_actor_user_id,
        scheduled_send_trusted_service_principal, body_text, body_html
      FROM email_messages WHERE workspace_id = $1 AND id = $2
    `, [WORKSPACE_ID, draftId]);
    return rows.rows[0]!;
  }

  async function syncInfoValue(key: string): Promise<string | null> {
    const rows = await postgres.admin.query<{ value: string | null }>(
      `SELECT value FROM sync_info WHERE workspace_id = $1 AND key = $2`,
      [WORKSPACE_ID, key],
    );
    return rows.rows[0]?.value ?? null;
  }

  async function takeWorkflowJobs(): Promise<JobPayload[]> {
    const rows = await postgres.admin.query<{ payload: JobPayload }>(
      `SELECT payload FROM job_queue WHERE workspace_id = $1 AND type = 'workflow.execute' ORDER BY id`,
      [WORKSPACE_ID],
    );
    await postgres.admin.query(`DELETE FROM job_queue WHERE workspace_id = $1`, [WORKSPACE_ID]);
    return rows.rows.map((row) => row.payload);
  }

  function composeSender(options: {
    smtpSend: jest.Mock;
    workflowDryRun?: () => Promise<WorkflowExecutionDryRunResult>;
  }): EmailComposeSenderApiPort {
    return createPostgresEmailComposeSenderPort({
      db,
      secrets: {
        async readSecret() {
          return Buffer.from('smtp-secret');
        },
      } as never,
      smtpSend: options.smtpSend,
      ...(options.workflowDryRun ? { workflowDryRun: options.workflowDryRun } : {}),
    });
  }

  async function runScheduledTick(sender: EmailComposeSenderApiPort): Promise<void> {
    await createPostgresScheduledSendJobPort({ db, composeSender: sender }).processDue({
      workspaceId: WORKSPACE_ID,
      trustedService: true,
      dueBefore: new Date(),
      limit: 10,
    });
  }

  async function inboxIds(): Promise<number[]> {
    const inbox = await createPostgresEmailMessageReadPort({ db }).list({
      workspaceId: WORKSPACE_ID,
      view: 'inbox',
      limit: 100,
    });
    return inbox.items.map((item) => item.id);
  }

  test('asynchroner Block eines Ausgangs-Workflows: Planung weg, echter Grund im Banner, Entwurf im Posteingang', async () => {
    await postgres.admin.query(`DELETE FROM job_queue`);
    await seedHoldWorkflow('Preisangabe fehlt');
    await seedWorkflowScheduledDraft(5201);
    const smtpSend = jest.fn();

    await runScheduledTick(composeSender({ smtpSend }));

    // Zwischenzustand „Prüfung läuft“: gehalten, Planung bleibt (Freigabe darf planen).
    const pending = await draftRow(5201);
    expect(pending.outbound_hold).toBe(true);
    expect(pending.outbound_block_reason).toContain(PENDING_REVIEW_TEXT);
    expect(pending.scheduled_send_at).not.toBeNull();
    const jobs = await takeWorkflowJobs();
    expect(jobs).toHaveLength(1);
    // Workflow-Versand (Trusted Service): der Ausgangs-Job läuft als Dienst. Ein
    // actorUserId 'system' würde der Job-Enforcer als unbekannten Nutzer abweisen —
    // die Prüfung liefe nie und der Entwurf bliebe bei „Prüfung läuft“ stehen.
    expect(jobs[0]!.actorUserId).toBeUndefined();
    expect(isTrustedServiceJobPayload(jobs[0]!)).toBe(true);
    expect(buildWorkflowExecutionJobPlan(jobs[0]!, WORKSPACE_ID)).toMatchObject({ trustedService: true });

    await createPostgresWorkflowExecutionJobPort({ db }).execute(
      buildWorkflowExecutionJobPlan(jobs[0]!, WORKSPACE_ID),
    );

    const held = await draftRow(5201);
    expect(held.outbound_hold).toBe(true);
    expect(held.outbound_block_reason).toBe('Preisangabe fehlt');
    expect(held.scheduled_send_at).toBeNull();
    expect(held.scheduled_send_trusted_service_principal).toBeNull();
    expect(held.scheduled_send_actor_user_id).toBeNull();
    expect(held.body_text?.startsWith(OUTBOUND_WARNING_MARKER)).toBe(true);
    expect(held.body_text).toContain('Preisangabe fehlt');
    expect(held.body_text).not.toContain(PENDING_REVIEW_TEXT);
    expect(held.body_html).toContain('Preisangabe fehlt');
    expect(held.body_html).not.toContain(PENDING_REVIEW_TEXT);
    expect(held.body_text).toContain('Antwort an den Kunden');
    expect(await inboxIds()).toContain(5201);

    // Kein erneuter automatischer Versand.
    await runScheduledTick(composeSender({ smtpSend }));
    expect(smtpSend).not.toHaveBeenCalled();
  });

  test('Block vor dem Zurücksetzen der Planung: restoreClaimedDraft plant den angehaltenen Entwurf nicht neu', async () => {
    await postgres.admin.query(`DELETE FROM job_queue`);
    await seedHoldWorkflow('');
    await seedWorkflowScheduledDraft(5202);
    const smtpSend = jest.fn();
    const real = composeSender({ smtpSend });
    // Der Ausgangs-Workflow-Job läuft, bevor der Planer den Claim zurückgibt.
    const racing: EmailComposeSenderApiPort = {
      async send(input) {
        const result = await real.send(input);
        for (const payload of await takeWorkflowJobs()) {
          await createPostgresWorkflowExecutionJobPort({ db }).execute(
            buildWorkflowExecutionJobPlan(payload, WORKSPACE_ID),
          );
        }
        return result;
      },
    };

    await runScheduledTick(racing);

    const held = await draftRow(5202);
    expect(held.outbound_hold).toBe(true);
    // Leerer Grund am Knoten „Versand sperren“: einheitlicher Fallback-Text.
    expect(held.outbound_block_reason).toBe(OUTBOUND_HOLD_FALLBACK_REASON);
    expect(held.body_text).toContain(OUTBOUND_HOLD_FALLBACK_REASON);
    expect(held.scheduled_send_at).toBeNull();
    expect(await syncInfoValue(`scheduled_send_claimed_at:5202`)).toBeNull();
    expect(await inboxIds()).toContain(5202);
    expect(smtpSend).not.toHaveBeenCalled();
  });

  test('synchroner Block (Dry-Run) beim geplanten Versand hält den Entwurf an statt ihn fünfmal zu wiederholen', async () => {
    await postgres.admin.query(`DELETE FROM job_queue`);
    await seedHoldWorkflow('Statische Regel');
    await seedWorkflowScheduledDraft(5203);
    const smtpSend = jest.fn();
    const sender = composeSender({
      smtpSend,
      workflowDryRun: async () => ({
        success: true,
        dryRun: true as const,
        blocked: true,
        blockReason: 'Statische Regel',
        status: 'blocked' as const,
      }),
    });

    await runScheduledTick(sender);

    const held = await draftRow(5203);
    expect(held.outbound_hold).toBe(true);
    expect(held.outbound_block_reason).toBe('Statische Regel');
    expect(held.scheduled_send_at).toBeNull();
    expect(held.scheduled_send_trusted_service_principal).toBeNull();
    expect(held.body_text).toContain('Statische Regel');
    expect(await syncInfoValue('scheduled_send_failures:5203')).not.toBe('1');
    expect(await syncInfoValue('scheduled_send_status:5203')).not.toBe('pending');
    expect(await syncInfoValue('scheduled_send_claimed_at:5203')).toBeNull();
    expect(await takeWorkflowJobs()).toHaveLength(0);
    expect(await inboxIds()).toContain(5203);
    expect(smtpSend).not.toHaveBeenCalled();
  });
  test('„Ohne Ausgangsprüfung senden“: Freigabe für den aktuellen Inhalt, Versand ohne Workflow-Durchlauf und ohne Banner', async () => {
    await postgres.admin.query(`DELETE FROM job_queue`);
    await seedHoldWorkflow('Preisangabe fehlt');
    await seedWorkflowScheduledDraft(5204);
    // Erst endgültig anhalten (echter Pfad), dann überspringen.
    await runScheduledTick(composeSender({ smtpSend: jest.fn() }));
    for (const payload of await takeWorkflowJobs()) {
      await createPostgresWorkflowExecutionJobPort({ db }).execute(
        buildWorkflowExecutionJobPlan(payload, WORKSPACE_ID),
      );
    }
    expect((await draftRow(5204)).outbound_block_reason).toBe('Preisangabe fehlt');

    const skip = createPostgresOutboundReviewSkipPort({ db });
    expect(await skip.readPolicy({ workspaceId: WORKSPACE_ID })).toBe('all');
    const prepared = await skip.prepare({ workspaceId: WORKSPACE_ID, actorUserId: 'user-1', messageId: 5204 });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(prepared.values.bodyText).not.toContain(OUTBOUND_WARNING_MARKER);
    const approved = await draftRow(5204);
    expect(approved.outbound_hold).toBe(false);
    expect(approved.body_text).not.toContain(OUTBOUND_WARNING_MARKER);
    const skipMarker = await syncInfoValue('outbound_review_skipped:5204');
    expect(skipMarker).not.toBeNull();
    expect(skipMarker).toBe(await syncInfoValue('outbound_review_approved:5204'));

    const smtpSend = jest.fn(async () => undefined);
    const result = await composeSender({ smtpSend }).send({
      workspaceId: WORKSPACE_ID,
      actorUserId: 'user-1',
      values: prepared.values,
    });

    expect(result).toEqual(expect.objectContaining({ ok: true, messageId: 5204 }));
    expect(smtpSend).toHaveBeenCalledTimes(1);
    const rfc822 = String((smtpSend.mock.calls[0] as unknown as [{ rfc822: string }])[0].rfc822);
    expect(rfc822).not.toContain('AUSGANGSPR');
    expect(rfc822).toContain('Antwort an den Kunden');
    // Kein neuer Durchlauf der Ausgangs-Workflows.
    expect(await takeWorkflowJobs()).toHaveLength(0);
    const sent = await postgres.admin.query<{ folder_kind: string }>(
      `SELECT folder_kind FROM email_messages WHERE workspace_id = $1 AND id = 5204`,
      [WORKSPACE_ID],
    );
    expect(sent.rows[0]?.folder_kind).toBe('sent');
  });

  test('„Ohne Ausgangsprüfung senden“ nur für angehaltene lokale Entwürfe', async () => {
    await seedDraft(5205, { hold: false, reason: null });
    const skip = createPostgresOutboundReviewSkipPort({ db });
    expect(await skip.prepare({ workspaceId: WORKSPACE_ID, actorUserId: 'user-1', messageId: 5205 }))
      .toEqual({ ok: false, reason: 'not_held' });
    expect(await skip.prepare({ workspaceId: WORKSPACE_ID, actorUserId: 'user-1', messageId: 999_999 }))
      .toEqual({ ok: false, reason: 'not_found' });
    await postgres.admin.query(
      `INSERT INTO sync_info (workspace_id, key, value, last_updated) VALUES ($1, 'outbound_review_skip_policy', 'admins', now())`,
      [WORKSPACE_ID],
    );
    expect(await skip.readPolicy({ workspaceId: WORKSPACE_ID })).toBe('admins');
  });
});
