import type { Kysely } from 'kysely';

import type { ServerDatabase } from '../../packages/server/src/db/schema';
import { buildWorkflowExecutionJobPlan } from '../../packages/server/src/jobs/production-handlers';
import {
  createEmailReadReceiptResponderPort,
  createPostgresReadReceiptOutboundReviewPort,
  type ReadReceiptResponderStore,
} from '../../packages/server/src/mail-read-receipt-responder';
import type { ServerSmtpSendInput } from '../../packages/server/src/mail-smtp-send';
import { createPostgresWorkflowExecutionJobPort } from '../../packages/server/src/workflow-execution';
import { startMigratedEmbeddedPostgres, type EmbeddedPostgres } from './helpers/embedded-postgres';

jest.mock('kysely', () => jest.requireActual('../../packages/server/node_modules/kysely'));

jest.setTimeout(120_000);

const WORKSPACE_ID = '10000000-0000-4000-8000-0000000000e4';
const ACCOUNT_ID = 841;
const FOLDER_ID = 851;
const SEND_WORKFLOW_ID = 861;
const HOLD_WORKFLOW_ID = 862;
const AI_WORKFLOW_ID = 863;

type QueuedJob = { id: number; type: string; payload: Record<string, any> };

const trigger = { id: 'trigger-1', type: 'trigger', data: { kind: 'outbound' } };
const release = {
  id: 'release-1',
  type: 'registry',
  data: { nodeType: 'email.release_outbound', config: { autoSend: true } },
};

// F-A5-11: Mit aktivem Outbound-Workflow konnte der Server nie eine
// Lesebestaetigung senden: review() lieferte immer allowed:false, und keine
// abgeschlossene Pruefung gab die MDN je frei.
describe('read receipt outbound review releases the MDN after a finished review', () => {
  let postgres: EmbeddedPostgres;
  let db: Kysely<ServerDatabase>;
  let nextMessageId = 871;

  beforeAll(async () => {
    postgres = await startMigratedEmbeddedPostgres('read-receipt-review-release');
    const { admin } = postgres;
    await admin.query(`INSERT INTO workspaces (id, name) VALUES ($1, 'MDN Release Test')`, [WORKSPACE_ID]);
    await admin.query(`
      INSERT INTO email_accounts (id, workspace_id, source_sqlite_id, display_name, email_address, imap_host, imap_username)
      VALUES ($1, $2, $1, 'Support', 'support@example.test', 'imap.example.test', 'support')
    `, [ACCOUNT_ID, WORKSPACE_ID]);
    await admin.query(`
      INSERT INTO email_folders (id, workspace_id, source_sqlite_id, account_source_sqlite_id, account_id, path)
      VALUES ($1, $2, $1, $3, $3, 'INBOX')
    `, [FOLDER_ID, WORKSPACE_ID, ACCOUNT_ID]);
    const graphs: Array<[number, unknown]> = [
      [SEND_WORKFLOW_ID, {
        version: 1,
        nodes: [trigger, release],
        edges: [{ id: 'edge-1', source: 'trigger-1', target: 'release-1' }],
      }],
      [HOLD_WORKFLOW_ID, {
        version: 1,
        nodes: [
          trigger,
          {
            id: 'hold-1',
            type: 'registry',
            data: { nodeType: 'email.hold_outbound', config: { reason: 'Signatur fehlt' } },
          },
        ],
        edges: [{ id: 'edge-1', source: 'trigger-1', target: 'hold-1' }],
      }],
      [AI_WORKFLOW_ID, {
        version: 1,
        nodes: [
          trigger,
          { id: 'review-1', type: 'registry', data: { nodeType: 'ai.outbound_review', config: {} } },
          release,
        ],
        edges: [
          { id: 'edge-1', source: 'trigger-1', target: 'review-1' },
          { id: 'edge-2', source: 'review-1', target: 'release-1', label: 'ok' },
        ],
      }],
    ];
    for (const [id, graph] of graphs) {
      await admin.query(`
        INSERT INTO email_workflows (
          id, workspace_id, source_sqlite_id, name, trigger_name, enabled, priority,
          definition_json, graph_json, execution_mode, engine_version
        ) VALUES ($1, $2, $1, $3, 'outbound', false, 1, '{}'::jsonb, $4::jsonb, 'graph', 1)
      `, [id, WORKSPACE_ID, `Ausgangspruefung ${id}`, JSON.stringify(graph)]);
    }
    db = postgres.createApplicationDb();
  });

  afterAll(async () => {
    if (db) await db.destroy();
    if (postgres) await postgres.stop();
  });

  async function useOnlyWorkflow(workflowId: number): Promise<number> {
    await postgres.admin.query(`DELETE FROM job_queue WHERE workspace_id = $1`, [WORKSPACE_ID]);
    await postgres.admin.query(
      `UPDATE email_workflows SET enabled = (id = $2) WHERE workspace_id = $1`,
      [WORKSPACE_ID, workflowId],
    );
    const messageId = nextMessageId++;
    await postgres.admin.query(`
      INSERT INTO email_messages (
        id, workspace_id, source_sqlite_id, account_source_sqlite_id, folder_source_sqlite_id,
        account_id, folder_id, uid, subject, body_text, from_json
      ) VALUES ($1, $2, $1, $3, $4, $3, $4, $1, 'Angebot', 'Bitte bestaetigen', $5::jsonb)
    `, [messageId, WORKSPACE_ID, ACCOUNT_ID, FOLDER_ID, JSON.stringify({ value: [{ address: 'kunde@example.com' }] })]);
    return messageId;
  }

  function reviewInput(messageId: number) {
    return {
      workspaceId: WORKSPACE_ID,
      actorUserId: 'user-a',
      messageId,
      subject: 'Gelesen: Angebot',
      bodyText: 'Lesebestaetigung',
      to: 'kunde@example.com',
    };
  }

  async function queuedJobs(type?: string): Promise<QueuedJob[]> {
    const result = await postgres.admin.query<QueuedJob>(
      `SELECT id, type, payload FROM job_queue WHERE workspace_id = $1 ${type ? 'AND type = $2' : ''} ORDER BY id`,
      type ? [WORKSPACE_ID, type] : [WORKSPACE_ID],
    );
    return [...result.rows];
  }

  /** Fuehrt die wartenden workflow.execute-Jobs aus wie der Worker (erledigt = geloescht). */
  async function runQueuedWorkflowJobs(): Promise<void> {
    const port = createPostgresWorkflowExecutionJobPort({ db });
    for (const job of await queuedJobs('workflow.execute')) {
      await port.execute(buildWorkflowExecutionJobPlan(job.payload, WORKSPACE_ID));
      await postgres.admin.query(`DELETE FROM job_queue WHERE id = $1`, [job.id]);
    }
  }

  async function runCount(messageId: number): Promise<number> {
    const result = await postgres.admin.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM email_workflow_runs WHERE workspace_id = $1 AND message_id = $2`,
      [WORKSPACE_ID, messageId],
    );
    return result.rows[0]!.n;
  }

  test('a review run that finishes with SEND releases exactly one MDN', async () => {
    const messageId = await useOnlyWorkflow(SEND_WORKFLOW_ID);
    const guard = createPostgresReadReceiptOutboundReviewPort({ db });
    const smtpSends: ServerSmtpSendInput[] = [];
    const store: ReadReceiptResponderStore = {
      async getMessage() {
        return {
          id: messageId,
          accountId: ACCOUNT_ID,
          subject: 'Angebot',
          messageIdHeader: '<angebot@example.com>',
          referencesHeader: null,
          rawHeaders: 'Disposition-Notification-To: kunde@example.com\r\n',
          fromJson: { value: [{ address: 'kunde@example.com' }] },
          isSpam: false,
          folderKind: 'inbox',
          softDeleted: false,
        };
      },
      async getAccount() {
        return {
          id: ACCOUNT_ID,
          displayName: 'Support',
          emailAddress: 'support@example.test',
          imapHost: 'imap.example.test',
          imapUsername: 'support',
          smtpHost: 'smtp.example.test',
          smtpPort: 587,
          smtpTls: true,
          smtpUsername: null,
          smtpUseImapAuth: true,
          oauthProvider: null,
          respondToReadReceipts: 'ask',
          readReceiptTrustedDomains: null,
        };
      },
      async readSecret() {
        return Buffer.from('mailbox-password');
      },
      async recordSentBack(input) {
        return { messageId: input.messageId, recipient: input.recipient } as never;
      },
    };
    const responder = createEmailReadReceiptResponderPort({
      store,
      outboundReview: guard,
      smtpSend: async (input) => {
        smtpSends.push(input);
      },
    });

    const first = await responder.send({ workspaceId: WORKSPACE_ID, actorUserId: 'user-a', messageId });
    expect(first).toMatchObject({ success: false, error: expect.stringContaining('Ausgangspruefung') });
    // Waehrend die Pruefung wartet: keine neue Runde, kein Versand.
    await responder.send({ workspaceId: WORKSPACE_ID, actorUserId: 'user-a', messageId });
    expect(await runCount(messageId)).toBe(1);
    expect(smtpSends).toHaveLength(0);

    await runQueuedWorkflowJobs();

    const second = await responder.send({ workspaceId: WORKSPACE_ID, actorUserId: 'user-a', messageId });
    expect(second).toMatchObject({ success: true });
    expect(smtpSends).toHaveLength(1);
    expect(await runCount(messageId)).toBe(1);

    // "Versand freigeben" gilt in der Pruefrunde nur der Lesebestaetigung:
    // die eingegangene Mail bleibt unveraendert.
    const inbound = await postgres.admin.query(
      `SELECT subject, scheduled_send_at, ticket_code FROM email_messages WHERE id = $1`,
      [messageId],
    );
    expect(inbound.rows[0]).toEqual({ subject: 'Angebot', scheduled_send_at: null, ticket_code: null });

    // Die Freigabe wird verbraucht: ein weiterer Versuch prueft erneut.
    await expect(guard.review(reviewInput(messageId))).resolves.toMatchObject({ allowed: false });
    expect(await runCount(messageId)).toBe(2);
  });

  test('a review run that holds the MDN reports the block and does not send', async () => {
    const messageId = await useOnlyWorkflow(HOLD_WORKFLOW_ID);
    const guard = createPostgresReadReceiptOutboundReviewPort({ db });

    await expect(guard.review(reviewInput(messageId))).resolves.toMatchObject({ allowed: false });
    await runQueuedWorkflowJobs();

    await expect(guard.review(reviewInput(messageId))).resolves.toEqual({
      allowed: false,
      error: expect.stringContaining('Signatur fehlt'),
      workflowRunId: expect.any(Number),
    });
    expect(await runCount(messageId)).toBe(1);

    // Nach der Meldung startet ein neuer Klick eine frische Pruefung.
    await expect(guard.review(reviewInput(messageId))).resolves.toMatchObject({ allowed: false });
    expect(await runCount(messageId)).toBe(2);
  });

  test('a deferred AI review keeps the MDN blocked until its continuation finishes', async () => {
    const messageId = await useOnlyWorkflow(AI_WORKFLOW_ID);
    const guard = createPostgresReadReceiptOutboundReviewPort({ db });

    await guard.review(reviewInput(messageId));
    await runQueuedWorkflowJobs();
    const [aiJob] = await queuedJobs('ai.review');
    expect(aiJob).toBeDefined();

    // Lauf beendet, KI-Urteil steht aus: weiter blockiert, keine neue Runde.
    await expect(guard.review(reviewInput(messageId))).resolves.toMatchObject({ allowed: false });
    expect(await runCount(messageId)).toBe(1);

    // KI sagt OK: der Job reiht die Fortsetzung am OK-Ausgang ein und ist erledigt.
    const continuation = aiJob!.payload.continuation;
    await postgres.admin.query(`DELETE FROM job_queue WHERE id = $1`, [aiJob!.id]);
    await postgres.admin.query(`
      INSERT INTO job_queue (type, payload, run_after, max_attempts, workspace_id, updated_at)
      VALUES ('workflow.execute', $1::jsonb, now(), 3, $2, now())
    `, [JSON.stringify({
      workspaceId: WORKSPACE_ID,
      workflowId: continuation.workflowId,
      messageId,
      actorUserId: 'user-a',
      triggerName: continuation.triggerName,
      context: {
        resumeNodeId: 'release-1',
        eventStrings: continuation.eventStrings,
        eventVariables: { ...continuation.eventVariables, 'ai.outbound_review.verdict': 'ok' },
      },
    }), WORKSPACE_ID]);
    await expect(guard.review(reviewInput(messageId))).resolves.toMatchObject({ allowed: false });

    await runQueuedWorkflowJobs();
    await expect(guard.review(reviewInput(messageId))).resolves.toEqual({ allowed: true });
  });

  test('an AI block without a block edge keeps the MDN blocked', async () => {
    const messageId = await useOnlyWorkflow(AI_WORKFLOW_ID);
    const guard = createPostgresReadReceiptOutboundReviewPort({ db });

    await guard.review(reviewInput(messageId));
    await runQueuedWorkflowJobs();
    const [aiJob] = await queuedJobs('ai.review');
    // KI sagt BLOCK ohne Kante: der Job sperrt nur die Nachricht (persistAiReviewBlock).
    await postgres.admin.query(`DELETE FROM job_queue WHERE id = $1`, [aiJob!.id]);
    await postgres.admin.query(
      `UPDATE email_messages SET outbound_hold = true, outbound_block_reason = 'KI: Ton unpassend' WHERE id = $1`,
      [messageId],
    );

    await expect(guard.review(reviewInput(messageId))).resolves.toMatchObject({
      allowed: false,
      error: expect.stringContaining('KI: Ton unpassend'),
    });
  });
});
