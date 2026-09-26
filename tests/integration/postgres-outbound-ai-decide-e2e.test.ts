import type { Kysely } from 'kysely';

import { createServerApi } from '../../packages/server/src/api/server-api';
import type { AuthenticatedPrincipal, ServerApiPorts } from '../../packages/server/src/api/types';
import { guardedAiPost } from '../../packages/server/src/ai-guarded-fetch';
import { createPostgresAuditPort } from '../../packages/server/src/db/postgres-audit-port';
import { createPostgresEmailMessageReadPort } from '../../packages/server/src/db/postgres-mail-read-ports';
import { createPostgresSecretPort, type PostgresSecretPort } from '../../packages/server/src/db/postgres-secret-port';
import { createPostgresAiProfileReadPort } from '../../packages/server/src/db/postgres-workflow-read-ports';
import type { ServerDatabase } from '../../packages/server/src/db/schema';
import { withWorkspaceTransaction } from '../../packages/server/src/db/workspace-context';
import {
  buildAiDecideJobPlan,
  buildWorkflowExecutionJobPlan,
} from '../../packages/server/src/jobs/production-handlers';
import type { JobPayload } from '../../packages/server/src/jobs/types';
import { createPostgresEmailComposeSenderPort } from '../../packages/server/src/mail-compose-send';
import { createPostgresOutboundReviewSkipPort } from '../../packages/server/src/mail-outbound-review-skip';
import { createPostgresScheduledSendJobPort } from '../../packages/server/src/mail-scheduled-send';
import { markDraftOrigin } from '../../packages/server/src/mail-sent-provenance';
import { parseBase64MasterKey } from '../../packages/server/src/security/master-key';
import { createPostgresAiDecidePort } from '../../packages/server/src/workflow-ai-decide';
import { createPostgresWorkflowExecutionJobPort } from '../../packages/server/src/workflow-execution';
import { OUTBOUND_WARNING_MARKER } from '../../packages/core/src/email';
import { startMigratedEmbeddedPostgres, type EmbeddedPostgres } from './helpers/embedded-postgres';

jest.mock('kysely', () => jest.requireActual('../../packages/server/node_modules/kysely'));
// Kein Netz: die Decisions API läuft über guardedAiPost, das hier abgefangen wird.
jest.mock('../../packages/server/src/ai-guarded-fetch', () => ({
  guardedAiPost: jest.fn(),
}));

jest.setTimeout(120_000);

const WORKSPACE_ID = '10000000-0000-4000-8000-0000000000f3';
const USER_ID = '20000000-0000-4000-8000-0000000000f3';
const ACCOUNT_ID = 941;
const FOLDER_ID = 942;
const INBOUND_WORKFLOW_ID = 943;
const OUTBOUND_WORKFLOW_ID = 944;
const DECIDE_BLOCK_TEXT = 'Vom Entscheidungsmodell als nicht versandfähig blockiert – bitte E-Mail prüfen.';

const guardedMock = guardedAiPost as unknown as jest.Mock;

function decisionsAnswer(noul: number) {
  return {
    ok: true,
    status: 200,
    async text() {
      return JSON.stringify({ answers: { decision: { type: 'noul', noul } }, usage: { input_tokens: 90, output_tokens: 1, cost: 0.0004 } });
    },
  };
}

/**
 * Teilautomatisierung P1 + P2, Server Ende-zu-Ende: ai.decide im
 * Ausgangs-Workflow (Decisions API gemockt).
 * a) Ein Mensch sendet, die KI sagt „nein“: Entwurf angehalten mit
 *    Standardtext; „Ohne Ausgangsprüfung senden“ verschickt ihn (Mensch,
 *    übersprungen, Audit).
 * b) Eine automatische KI-Antwort (send_draft mit Ausgangsprüfung, geplant):
 *    „nein“ ⇒ Entwurf im Posteingang, Planung gelöscht — synchron in der
 *    Versandvorschau wie auch erst im ai.decide-Job; „ja“ ⇒ versendet als ai_auto.
 */
describe('Server: KI-Entscheidung im Ausgang Ende-zu-Ende', () => {
  let postgres: EmbeddedPostgres;
  let db: Kysely<ServerDatabase>;
  let secrets: PostgresSecretPort;

  beforeAll(async () => {
    postgres = await startMigratedEmbeddedPostgres('outbound-ai-decide-e2e');
    const { admin } = postgres;
    await admin.query(`INSERT INTO workspaces (id, name) VALUES ($1, 'Outbound Decide E2E')`, [WORKSPACE_ID]);
    await admin.query(`
      INSERT INTO users (id, workspace_id, email, display_name, password_hash, role)
      VALUES ($1, $2, 'anna@example.test', 'Anna Beispiel', 'x', 'user')
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
      INSERT INTO sync_info (workspace_id, key, value, last_updated)
      VALUES ($1, 'auto_reply_enabled', 'true', now())
    `, [WORKSPACE_ID]);
    db = postgres.createApplicationDb();
    secrets = createPostgresSecretPort({ db, key: parseBase64MasterKey(Buffer.alloc(32, 9).toString('base64')) });
    const profile = await createPostgresAiProfileReadPort({ db, secrets }).create!({
      workspaceId: WORKSPACE_ID,
      actorUserId: USER_ID,
      values: {
        label: 'Entscheidung',
        provider: 'openrouter_decisions',
        baseUrl: 'https://openrouter.ai/api',
        model: 'typesafe/jev-1.13',
        apiKey: 'decisions-test-key',
      },
    });
    if (!profile.ok) throw new Error('profile setup failed');

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
    const outboundGraph = {
      version: 1,
      nodes: [
        { id: 'trigger-1', type: 'trigger', data: { kind: 'outbound' } },
        {
          id: 'decide',
          type: 'registry',
          data: {
            nodeType: 'ai.decide',
            config: { question: 'Ist die Mail versandfähig?', threshold: 80, profileId: profile.profile.id },
          },
        },
        { id: 'release', type: 'registry', data: { nodeType: 'email.release_outbound', config: { autoSend: true } } },
      ],
      edges: [
        { id: 'edge-1', source: 'trigger-1', target: 'decide' },
        { id: 'edge-2', source: 'decide', target: 'release', label: 'ja' },
      ],
    };
    for (const [id, name, trigger, graph] of [
      [INBOUND_WORKFLOW_ID, 'KI-Antwort', 'inbound', inboundGraph],
      [OUTBOUND_WORKFLOW_ID, 'Versandfreigabe', 'outbound', outboundGraph],
    ] as const) {
      await admin.query(`
        INSERT INTO email_workflows (
          id, workspace_id, source_sqlite_id, name, trigger_name, enabled, priority,
          definition_json, graph_json, execution_mode, engine_version
        ) VALUES ($1, $2, $1, $3, $4, true, 50, '{}'::jsonb, $5::jsonb, 'graph', 1)
      `, [id, WORKSPACE_ID, name, trigger, JSON.stringify(graph)]);
    }
  });

  afterAll(async () => {
    if (db) await db.destroy();
    if (postgres) await postgres.stop();
  });

  beforeEach(async () => {
    guardedMock.mockReset();
    await postgres.admin.query(`DELETE FROM job_queue`);
  });

  function execution() {
    return createPostgresWorkflowExecutionJobPort({ db, secrets });
  }

  function composeSender(smtpSend: jest.Mock) {
    const port = execution();
    return createPostgresEmailComposeSenderPort({
      db,
      secrets: { async readSecret() { return Buffer.from('smtp-secret'); } } as never,
      smtpSend,
      // Wie in Produktion: synchrone Versandvorschau — ai.decide fragt dort die KI.
      workflowDryRun: (plan) => port.dryRun!(plan),
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

  async function takeJobs(type: string): Promise<JobPayload[]> {
    const rows = await postgres.admin.query<{ payload: JobPayload }>(
      `SELECT payload FROM job_queue WHERE workspace_id = $1 AND type = $2 ORDER BY id`,
      [WORKSPACE_ID, type],
    );
    await postgres.admin.query(`DELETE FROM job_queue WHERE workspace_id = $1 AND type = $2`, [WORKSPACE_ID, type]);
    return rows.rows.map((row) => row.payload);
  }

  /** Führt eingereihte Workflow- und ai.decide-Jobs aus, bis keine mehr da sind. */
  async function drainJobs(): Promise<void> {
    for (let round = 0; round < 10; round += 1) {
      const workflows = await takeJobs('workflow.execute');
      const decisions = await takeJobs('ai.decide');
      if (workflows.length === 0 && decisions.length === 0) return;
      for (const payload of workflows) {
        await execution().execute(buildWorkflowExecutionJobPlan(payload, WORKSPACE_ID));
      }
      for (const payload of decisions) {
        await createPostgresAiDecidePort({ db, secrets }).decide(buildAiDecideJobPlan(payload, WORKSPACE_ID));
      }
    }
    throw new Error('Jobs laufen im Kreis');
  }

  async function row(id: number) {
    const rows = await postgres.admin.query<{
      folder_kind: string;
      outbound_hold: boolean;
      outbound_block_reason: string | null;
      body_text: string | null;
      scheduled_send_at: Date | null;
      sent_by_kind: string | null;
      sent_by_user_id: string | null;
      sent_outbound_review_skipped: boolean;
    }>(`
      SELECT folder_kind, outbound_hold, outbound_block_reason, body_text, scheduled_send_at,
        sent_by_kind, sent_by_user_id, sent_outbound_review_skipped
      FROM email_messages WHERE workspace_id = $1 AND id = $2
    `, [WORKSPACE_ID, id]);
    return rows.rows[0]!;
  }

  async function inboxIds(): Promise<number[]> {
    const inbox = await createPostgresEmailMessageReadPort({ db }).list({ workspaceId: WORKSPACE_ID, view: 'inbox', limit: 100 });
    return inbox.items.map((item) => item.id);
  }

  async function seedDraft(id: number, customer: string): Promise<void> {
    await postgres.admin.query(`
      INSERT INTO email_messages (
        id, workspace_id, source_sqlite_id, account_source_sqlite_id, folder_source_sqlite_id,
        account_id, folder_id, uid, folder_kind, subject, to_json, body_text, body_html
      ) VALUES ($1, $2, $1, $3, $4, $3, $4, $6, 'draft', 'Re: Frage', $5::jsonb,
        'Ihre Bestellung kommt morgen.', '<p>Ihre Bestellung kommt morgen.</p>')
    `, [id, WORKSPACE_ID, ACCOUNT_ID, FOLDER_ID, JSON.stringify({ value: [{ address: customer }] }), -id]);
  }

  /** Eingang + KI-Entwurf (Herkunft 'ai' wie von ai.draft_reply gesetzt), dann der Eingangs-Workflow. */
  async function planAutoReply(messageId: number, draftId: number): Promise<void> {
    const customer = `kunde${messageId}@example.com`;
    await postgres.admin.query(`
      INSERT INTO email_messages (
        id, workspace_id, source_sqlite_id, account_source_sqlite_id, folder_source_sqlite_id,
        account_id, folder_id, uid, subject, from_json, body_text
      ) VALUES ($1, $2, $1, $3, $4, $3, $4, $1, 'Frage', $5::jsonb, 'Wann kommt meine Bestellung?')
    `, [messageId, WORKSPACE_ID, ACCOUNT_ID, FOLDER_ID, JSON.stringify({ value: [{ address: customer }] })]);
    await seedDraft(draftId, customer);
    await withWorkspaceTransaction(db, { workspaceId: WORKSPACE_ID, role: 'system' }, async (trx) => {
      await markDraftOrigin(trx, { workspaceId: WORKSPACE_ID, draftId, kind: 'ai', workflowId: INBOUND_WORKFLOW_ID });
    });
    await execution().execute({
      workspaceId: WORKSPACE_ID,
      workflowId: INBOUND_WORKFLOW_ID,
      messageId,
      triggerName: 'inbound',
      trustedService: true,
      context: { eventVariables: { 'draft.id': draftId } },
    });
    expect((await row(draftId)).scheduled_send_at).not.toBeNull();
  }

  test('a) Mensch sendet, KI sagt „nein“ ⇒ angehalten; „Ohne Ausgangsprüfung senden“ ⇒ versendet und protokolliert', async () => {
    await seedDraft(9401, 'kunde9401@example.com');
    guardedMock.mockResolvedValue(decisionsAnswer(0.12));
    const smtpSend = jest.fn(async () => undefined);

    const result = await composeSender(smtpSend).send({
      workspaceId: WORKSPACE_ID,
      actorUserId: USER_ID,
      values: {
        accountId: ACCOUNT_ID,
        draftMessageId: 9401,
        subject: 'Re: Frage',
        bodyText: 'Ihre Bestellung kommt morgen.',
        bodyHtml: '<p>Ihre Bestellung kommt morgen.</p>',
        to: 'kunde9401@example.com',
      },
    });

    const reason = `${DECIDE_BLOCK_TEXT} (Ja-Wahrscheinlichkeit 12 %)`;
    expect(result).toEqual(expect.objectContaining({ ok: false, error: reason }));
    expect(guardedMock).toHaveBeenCalledTimes(1);
    expect(smtpSend).not.toHaveBeenCalled();
    const held = await row(9401);
    expect(held).toEqual(expect.objectContaining({ folder_kind: 'draft', outbound_hold: true, outbound_block_reason: reason }));
    expect(held.body_text).toContain(OUTBOUND_WARNING_MARKER);
    expect(await inboxIds()).toContain(9401);

    // „Ohne Ausgangsprüfung senden“ über die HTTP-Route (Rechte, Audit, normaler Sendepfad).
    const api = createServerApi({
      auth: {} as ServerApiPorts['auth'],
      locks: {} as ServerApiPorts['locks'],
      mailAccess: {
        async assertPermission() { return undefined; },
        async resolveScope() { return { kind: 'all' }; },
      },
      mailResourceLookup: {
        async resolve(input: { target: { kind: string; id?: number } }) {
          return input.target.kind === 'message'
            ? [{ type: 'message', accountId: String(ACCOUNT_ID), messageId: String(input.target.id) }]
            : [];
        },
      },
      emailOutboundReviewSkip: createPostgresOutboundReviewSkipPort({ db }),
      emailComposeSender: composeSender(smtpSend),
      audit: createPostgresAuditPort({ db }),
    } as unknown as ServerApiPorts);
    const principal = { userId: USER_ID, workspaceId: WORKSPACE_ID, role: 'user', capabilities: ['crm.write'] } as AuthenticatedPrincipal;

    const response = await api.handle({
      method: 'POST',
      path: '/api/v1/email/messages/9401/send-skip-outbound-review',
      principal,
    });

    expect(response.status).toBe(200);
    // Erfolg (der Hinweis zur fehlenden IMAP-Kopie gehört zur Test-Konfiguration).
    expect((response.body as { data: { success: boolean } }).data.success).toBe(true);
    // Keine erneute KI-Anfrage: die Ausgangs-Workflows sind übersprungen.
    expect(guardedMock).toHaveBeenCalledTimes(1);
    expect(smtpSend).toHaveBeenCalledTimes(1);
    expect(String((smtpSend.mock.calls[0] as unknown as [{ rfc822: string }])[0].rfc822)).not.toContain('AUSGANGSPR');
    expect(await row(9401)).toEqual(expect.objectContaining({
      folder_kind: 'sent',
      outbound_hold: false,
      sent_by_kind: 'human',
      sent_by_user_id: USER_ID,
      sent_outbound_review_skipped: true,
    }));
    const audit = await postgres.admin.query<{ action: string; actor_user_id: string; entity_id: string }>(
      `SELECT action, actor_user_id, entity_id FROM audit_events WHERE workspace_id = $1 ORDER BY id`,
      [WORKSPACE_ID],
    );
    expect(audit.rows).toEqual(expect.arrayContaining([
      { action: 'email_message.outbound_review_skipped', actor_user_id: USER_ID, entity_id: '9401' },
      expect.objectContaining({ action: 'email_message.sent', entity_id: '9401' }),
    ]));
  });

  test('b) automatische KI-Antwort, KI sagt schon in der Versandvorschau „nein“ ⇒ Posteingang, Planung gelöscht', async () => {
    await planAutoReply(9411, 9412);
    guardedMock.mockResolvedValue(decisionsAnswer(0.2));
    const smtpSend = jest.fn(async () => undefined);

    await tick(smtpSend);
    await drainJobs();
    await tick(smtpSend);

    expect(smtpSend).not.toHaveBeenCalled();
    const held = await row(9412);
    expect(held).toEqual(expect.objectContaining({
      folder_kind: 'draft',
      outbound_hold: true,
      outbound_block_reason: `${DECIDE_BLOCK_TEXT} (Ja-Wahrscheinlichkeit 20 %)`,
      scheduled_send_at: null,
    }));
    expect(held.body_text).toContain(OUTBOUND_WARNING_MARKER);
    expect(await inboxIds()).toContain(9412);
  });

  test('b) KI sagt in der Vorschau „ja“, im ai.decide-Job „nein“ ⇒ der Job hält über den gemeinsamen Helfer an', async () => {
    await planAutoReply(9421, 9422);
    guardedMock
      .mockResolvedValueOnce(decisionsAnswer(0.95))
      .mockResolvedValueOnce(decisionsAnswer(0.1));
    const smtpSend = jest.fn(async () => undefined);

    await tick(smtpSend);
    await drainJobs();
    await tick(smtpSend);

    expect(guardedMock).toHaveBeenCalledTimes(2);
    expect(smtpSend).not.toHaveBeenCalled();
    const held = await row(9422);
    expect(held).toEqual(expect.objectContaining({
      folder_kind: 'draft',
      outbound_hold: true,
      outbound_block_reason: `${DECIDE_BLOCK_TEXT} (Ja-Wahrscheinlichkeit 10 %)`,
      scheduled_send_at: null,
    }));
    // Banner mit dem echten Grund statt „Prüfung läuft“.
    expect(held.body_text).toContain('Ja-Wahrscheinlichkeit 10 %');
    expect(held.body_text).not.toContain('serverseitig');
    expect(await inboxIds()).toContain(9422);
  });

  test('b) KI sagt „ja“ ⇒ Freigabe, Versand als automatische KI-Antwort (ai_auto)', async () => {
    await planAutoReply(9431, 9432);
    guardedMock.mockResolvedValue(decisionsAnswer(0.97));
    const smtpSend = jest.fn(async () => undefined);

    await tick(smtpSend);
    expect(smtpSend).not.toHaveBeenCalled();
    await drainJobs();
    await tick(smtpSend);

    expect(smtpSend).toHaveBeenCalledTimes(1);
    const rfc822 = String((smtpSend.mock.calls[0] as unknown as [{ rfc822: string }])[0].rfc822);
    expect(rfc822).toContain('Auto-Submitted: auto-replied');
    expect(rfc822).not.toContain('AUSGANGSPR');
    expect(await row(9432)).toEqual(expect.objectContaining({
      folder_kind: 'sent',
      sent_by_kind: 'ai_auto',
      sent_by_user_id: null,
      sent_outbound_review_skipped: false,
    }));
  });
});
