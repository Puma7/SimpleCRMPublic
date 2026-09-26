/**
 * TA-P6: Die Vorlage „Eingehend: Mensch oder KI? → KI-Antwort mit
 * Gegenprüfung“ läuft auf dem Server gegen eine echte Datenbank Job für Job
 * durch: KI-Entscheidung (Decisions API) → Gate → Entwurf → Gegenprüfung →
 * email.send_draft mit runOutboundReview=true. Dazu die Spam-Entscheidung
 * (Priorität 5) in der Eingangskette vor einem nachrangigen Workflow.
 * Gemockt sind nur die KI-Aufrufe und der IMAP-Zugriff.
 */
import type { Kysely } from 'kysely';

import { getWorkflowTemplate, PARTIAL_AUTOMATION_TEMPLATE_IDS } from '../../packages/core/src/workflow';
import { guardedAiPost } from '../../packages/server/src/ai-guarded-fetch';
import { createPostgresSecretPort, type PostgresSecretPort } from '../../packages/server/src/db/postgres-secret-port';
import { createPostgresAiProfileReadPort } from '../../packages/server/src/db/postgres-workflow-read-ports';
import type { ServerDatabase } from '../../packages/server/src/db/schema';
import {
  buildAiDecideJobPlan,
  buildAiDraftReplyJobPlan,
  buildAiReviewDraftJobPlan,
  buildWorkflowExecutionJobPlan,
} from '../../packages/server/src/jobs/production-handlers';
import type { JobPayload } from '../../packages/server/src/jobs/types';
import { parseBase64MasterKey } from '../../packages/server/src/security/master-key';
import { runWorkflowTrackedChatCompletion } from '../../packages/server/src/workflow-ai-chat';
import { createPostgresAiDecidePort } from '../../packages/server/src/workflow-ai-decide';
import {
  createPostgresAiDraftReplyPort,
  createPostgresAiReviewDraftPort,
} from '../../packages/server/src/workflow-ai-draft-nodes';
import { createPostgresWorkflowExecutionJobPort } from '../../packages/server/src/workflow-execution';
import { startMigratedEmbeddedPostgres, type EmbeddedPostgres } from './helpers/embedded-postgres';

jest.mock('kysely', () => jest.requireActual('../../packages/server/node_modules/kysely'));
// Kein Netz: Decisions API über den SSRF-geschützten Transport abgefangen,
// Chat-KI (Entwurf, Gegenprüfung) über den zentralen Aufruf.
jest.mock('../../packages/server/src/ai-guarded-fetch', () => ({
  guardedAiPost: jest.fn(),
}));
jest.mock('../../packages/server/src/workflow-ai-chat', () => ({
  ...jest.requireActual('../../packages/server/src/workflow-ai-chat'),
  runWorkflowTrackedChatCompletion: jest.fn(),
}));

jest.setTimeout(120_000);

const WORKSPACE_ID = '10000000-0000-4000-8000-0000000000f6';
const USER_ID = '10000000-0000-4000-8000-0000000000f7';
const ACCOUNT_ID = 861;
const FOLDER_ID = 871;
const WORKFLOW_ID = 881;
const SPAM_WORKFLOW_ID = 882;
const LATER_WORKFLOW_ID = 883;

type JobRow = { type: string; payload: JobPayload };

const guardedMock = guardedAiPost as unknown as jest.Mock;
const chatMock = runWorkflowTrackedChatCompletion as unknown as jest.Mock;

function decisionsAnswer(noul: number) {
  return {
    ok: true,
    status: 200,
    async text() {
      return JSON.stringify({
        answers: { decision: { type: 'noul', noul } },
        usage: { input_tokens: 120, output_tokens: 1, cost: 0.0003 },
      });
    },
  };
}

describe('Vorlagen Teilautomatisierung auf dem Server (Embedded Postgres)', () => {
  let postgres: EmbeddedPostgres;
  let db: Kysely<ServerDatabase>;
  let secrets: PostgresSecretPort;

  beforeAll(async () => {
    postgres = await startMigratedEmbeddedPostgres('workflow-templates-partial-automation');
    const { admin } = postgres;
    await admin.query(`INSERT INTO workspaces (id, name) VALUES ($1, 'Teilautomatisierung')`, [WORKSPACE_ID]);
    await admin.query(`
      INSERT INTO email_accounts (id, workspace_id, source_sqlite_id, display_name, email_address, imap_host, imap_username)
      VALUES ($1, $2, $1, 'Support', 'support@example.test', 'imap.example.test', 'support')
    `, [ACCOUNT_ID, WORKSPACE_ID]);
    await admin.query(`
      INSERT INTO email_folders (id, workspace_id, source_sqlite_id, account_source_sqlite_id, account_id, path)
      VALUES ($1, $2, $1, $3, $3, 'INBOX')
    `, [FOLDER_ID, WORKSPACE_ID, ACCOUNT_ID]);
    // Auto-Antwort-Schalter an (Voraussetzung der Vorlage).
    await admin.query(`
      INSERT INTO sync_info (workspace_id, key, value, last_updated)
      VALUES ($1, 'auto_reply_enabled', 'true', now())
    `, [WORKSPACE_ID]);

    db = postgres.createApplicationDb();
    secrets = createPostgresSecretPort({ db, key: parseBase64MasterKey(Buffer.alloc(32, 9).toString('base64')) });
    const profiles = createPostgresAiProfileReadPort({ db, secrets });
    const decisions = await profiles.create!({
      workspaceId: WORKSPACE_ID,
      actorUserId: USER_ID,
      values: {
        label: 'Jev',
        provider: 'openrouter_decisions',
        baseUrl: 'https://openrouter.ai/api',
        model: 'typesafe/jev-1.13',
        apiKey: 'or-decisions-test-key',
      },
    });
    if (!decisions.ok) throw new Error('profile setup failed');

    // Die ausgelieferte Vorlage, wie die Anleitung sie einrichtet: das
    // Entscheidungsmodell im Baustein „KI-Entscheidung“ gewählt.
    const template = getWorkflowTemplate(PARTIAL_AUTOMATION_TEMPLATE_IDS.humanOrAiReply);
    if (!template) throw new Error('Vorlage fehlt');
    const graph = JSON.parse(JSON.stringify(template.graph)) as { nodes: Array<{ id: string; data: { config?: Record<string, unknown> } }> };
    graph.nodes.find((node) => node.id === 'decide')!.data.config!.profileId = decisions.profile.id;
    await admin.query(`
      INSERT INTO email_workflows (
        id, workspace_id, source_sqlite_id, name, trigger_name, enabled, priority,
        definition_json, graph_json, execution_mode, engine_version
      ) VALUES ($1, $2, $1, $3, 'inbound', true, $4, '{}'::jsonb, $5::jsonb, 'graph', 1)
    `, [WORKFLOW_ID, WORKSPACE_ID, template.name, template.priority, JSON.stringify(graph)]);

    const spamTemplate = getWorkflowTemplate(PARTIAL_AUTOMATION_TEMPLATE_IDS.spamDecision);
    if (!spamTemplate) throw new Error('Vorlage fehlt');
    const spamGraph = JSON.parse(JSON.stringify(spamTemplate.graph)) as typeof graph;
    spamGraph.nodes.find((node) => node.id === 'decide')!.data.config!.profileId = decisions.profile.id;
    // Nachrangiger Workflow der Kette: markiert jede Mail, die ihn erreicht.
    const laterGraph = {
      version: 1,
      nodes: [
        { id: 't1', type: 'trigger', data: { kind: 'inbound' } },
        { id: 'tag', type: 'registry', data: { nodeType: 'email.tag', config: { tag: 'spaeter', runOnEveryInbound: true } } },
      ],
      edges: [{ id: 'e0', source: 't1', target: 'tag' }],
    };
    for (const [id, name, priority, workflowGraph] of [
      [SPAM_WORKFLOW_ID, spamTemplate.name, spamTemplate.priority, spamGraph],
      [LATER_WORKFLOW_ID, 'Später', 60, laterGraph],
    ] as const) {
      await admin.query(`
        INSERT INTO email_workflows (
          id, workspace_id, source_sqlite_id, name, trigger_name, enabled, priority,
          definition_json, graph_json, execution_mode, engine_version
        ) VALUES ($1, $2, $1, $3, 'inbound', true, $4, '{}'::jsonb, $5::jsonb, 'graph', 1)
      `, [id, WORKSPACE_ID, name, priority, JSON.stringify(workflowGraph)]);
    }
  });

  afterAll(async () => {
    if (db) await db.destroy();
    if (postgres) await postgres.stop();
  });

  beforeEach(async () => {
    guardedMock.mockReset();
    chatMock.mockReset();
    await postgres.admin.query(`DELETE FROM job_queue`);
  });

  async function seedInbound(id: number, subject: string, body: string): Promise<void> {
    await postgres.admin.query(`
      INSERT INTO email_messages (
        id, workspace_id, source_sqlite_id, account_source_sqlite_id, folder_source_sqlite_id,
        account_id, folder_id, uid, subject, from_json, body_text
      ) VALUES ($1, $2, $1, $3, $4, $3, $4, $1, $5, $6::jsonb, $7)
    `, [id, WORKSPACE_ID, ACCOUNT_ID, FOLDER_ID, subject, JSON.stringify({ value: [{ address: `kunde${id}@example.com`, name: 'Erika Muster' }] }), body]);
  }

  async function takeJob(type: string): Promise<JobRow> {
    const rows = await postgres.admin.query<JobRow>(
      `SELECT type, payload FROM job_queue WHERE workspace_id = $1 AND type = $2 ORDER BY id`,
      [WORKSPACE_ID, type],
    );
    expect({ type, count: rows.rows.length }).toEqual({ type, count: 1 });
    await postgres.admin.query(`DELETE FROM job_queue WHERE workspace_id = $1 AND type = $2`, [WORKSPACE_ID, type]);
    return rows.rows[0]!;
  }

  async function runContinuation(job: JobRow): Promise<void> {
    await createPostgresWorkflowExecutionJobPort({ db }).execute(buildWorkflowExecutionJobPlan(job.payload, WORKSPACE_ID));
  }

  async function tags(messageId: number): Promise<string[]> {
    const rows = await postgres.admin.query<{ tag: string }>(
      `SELECT tag FROM email_message_tags WHERE workspace_id = $1 AND message_id = $2 ORDER BY tag`,
      [WORKSPACE_ID, messageId],
    );
    return rows.rows.map((row) => row.tag);
  }

  /** Startet den Lauf und beantwortet die KI-Entscheidung; liefert die Fortsetzung. */
  async function decide(messageId: number, noul: number): Promise<JobRow> {
    guardedMock.mockResolvedValue(decisionsAnswer(noul));
    await createPostgresWorkflowExecutionJobPort({ db }).execute({
      workspaceId: WORKSPACE_ID,
      workflowId: WORKFLOW_ID,
      messageId,
      triggerName: 'inbound',
      context: {},
    });
    const decideJob = await takeJob('ai.decide');
    await createPostgresAiDecidePort({ db, secrets }).decide(buildAiDecideJobPlan(decideJob.payload, WORKSPACE_ID));
    expect(guardedMock).toHaveBeenCalledTimes(1);
    const request = JSON.parse((guardedMock.mock.calls[0]![0] as { body: string }).body);
    expect(request.questions.decision.instructions).toBe('Muss ein Mensch diese Anfrage bearbeiten?');
    expect(request.questions.decision.criteria.true).toContain('Kündigung');
    return takeJob('workflow.execute');
  }

  test('Nein → Gate → Entwurf → Gegenprüfung „senden“ → Versand mit Ausgangsprüfung eingeplant', async () => {
    await seedInbound(8601, 'Öffnungszeiten', 'Wann haben Sie am Samstag geöffnet?');
    chatMock.mockImplementation(async (_deps: unknown, input: { nodeType: string }) => (
      input.nodeType === 'ai.review_draft'
        ? 'STATUS: SEND\nANSWERED: yes\nREASON: Frage vollständig beantwortet'
        : 'Samstags haben wir von 9 bis 14 Uhr geöffnet.'
    ));

    const afterDecision = await decide(8601, 0.04);
    expect((afterDecision.payload as any).context.resumeNodeId).toBe('gate');
    expect((afterDecision.payload as any).context.eventVariables).toMatchObject({
      'ai.decide.answer': 'nein',
      'ai.decide.confidence': 96,
      __inbound_condition_ok: true,
    });

    // Gate erlaubt (Schalter an, Sicherheit 96 ≥ 80) → Entwurf als Job.
    await runContinuation(afterDecision);
    const draftJob = await takeJob('ai.draft_reply');
    await createPostgresAiDraftReplyPort({ db, secrets }).draftReply(buildAiDraftReplyJobPlan(draftJob.payload, WORKSPACE_ID));
    const afterDraft = await takeJob('workflow.execute');
    expect((afterDraft.payload as any).context.resumeNodeId).toBe('review');
    const draftId = Number((afterDraft.payload as any).context.eventVariables['draft.id']);
    expect(draftId).toBeGreaterThan(0);

    await runContinuation(afterDraft);
    const reviewJob = await takeJob('ai.review_draft');
    await createPostgresAiReviewDraftPort({ db, secrets }).reviewDraft(buildAiReviewDraftJobPlan(reviewJob.payload, WORKSPACE_ID));
    const afterReview = await takeJob('workflow.execute');
    expect((afterReview.payload as any).context.resumeNodeId).toBe('send');

    await runContinuation(afterReview);
    const draft = await postgres.admin.query<{
      folder_kind: string;
      scheduled_send_at: Date | null;
      outbound_hold: boolean;
      approval_state: string | null;
      to_json: unknown;
      body_text: string;
    }>(
      `SELECT folder_kind, scheduled_send_at, outbound_hold, approval_state, to_json, body_text
         FROM email_messages WHERE workspace_id = $1 AND id = $2`,
      [WORKSPACE_ID, draftId],
    );
    expect(draft.rows[0]).toMatchObject({ folder_kind: 'draft', outbound_hold: false, approval_state: null });
    expect(draft.rows[0]!.scheduled_send_at).not.toBeNull();
    expect(JSON.stringify(draft.rows[0]!.to_json)).toContain('kunde8601@example.com');
    expect(draft.rows[0]!.body_text).toContain('Samstags haben wir von 9 bis 14 Uhr geöffnet.');
    // runOutboundReview=true: kein Freigabe-Marker — der geplante Versand geht
    // durch die Ausgangs-Workflows (z. B. „KI-Entscheidung vor dem Versand“).
    const marker = await postgres.admin.query(
      `SELECT 1 FROM sync_info WHERE workspace_id = $1 AND key = $2`,
      [WORKSPACE_ID, `outbound_review_approved:${draftId}`],
    );
    expect(marker.rows).toEqual([]);
    const step = await postgres.admin.query<{ message: string | null }>(
      `SELECT message FROM email_workflow_run_steps WHERE workspace_id = $1 AND node_id = 'send' ORDER BY id DESC LIMIT 1`,
      [WORKSPACE_ID],
    );
    expect(step.rows[0]!.message).toBe('send_draft_queued_with_review');
    expect(await tags(8601)).toEqual([]);
    expect(chatMock.mock.calls.map(([, input]) => (input as { nodeType: string }).nodeType)).toEqual([
      'ai.draft_reply',
      'ai.review_draft',
    ]);
  });

  test.each([
    ['Ja', 8611, 0.93],
    ['Unsicher', 8612, 0.5],
  ])('%s → Tag manuell, kein Entwurf, keine Chat-KI', async (_label, messageId, noul) => {
    await seedInbound(messageId, 'Kündigung', 'Ich kündige meinen Vertrag und will mein Geld zurück.');
    const continuation = await decide(messageId, noul);
    expect((continuation.payload as any).context.resumeNodeId).toBe('tag_manual');
    await runContinuation(continuation);
    expect(await tags(messageId)).toEqual(['manuell']);
    expect(chatMock).not.toHaveBeenCalled();
    const jobs = await postgres.admin.query(`SELECT type FROM job_queue WHERE workspace_id = $1`, [WORKSPACE_ID]);
    expect(jobs.rows).toEqual([]);
    const drafts = await postgres.admin.query(
      `SELECT 1 FROM email_messages WHERE workspace_id = $1 AND folder_kind = 'draft' AND to_json::text LIKE $2`,
      [WORKSPACE_ID, `%kunde${messageId}@%`],
    );
    expect(drafts.rows).toEqual([]);
  });
  describe('Spam-Entscheidung (Priorität 5) vor einem nachrangigen Workflow', () => {
    const moves: Array<{ messageId: number; targetFolderPath: string }> = [];
    const imapActions = {
      async move(input: { messageId: number; targetFolderPath: string }) {
        moves.push({ messageId: input.messageId, targetFolderPath: input.targetFolderPath });
        return { ok: true as const, sourceFolderPath: 'INBOX', targetFolderPath: input.targetFolderPath };
      },
      async delete() {
        return { ok: false as const, error: 'nicht erwartet' };
      },
      async setSeen() {
        return { ok: false as const, error: 'nicht erwartet' };
      },
    };

    beforeEach(() => {
      moves.length = 0;
    });

    function executionPort() {
      return createPostgresWorkflowExecutionJobPort({ db, workflowImapActions: imapActions as never });
    }

    /** Wie die Eingangskette: Spam-Entscheidung zuerst, danach der nachrangige Workflow. */
    async function decideSpam(messageId: number, noul: number): Promise<JobRow[]> {
      guardedMock.mockResolvedValue(decisionsAnswer(noul));
      await executionPort().execute({
        workspaceId: WORKSPACE_ID,
        workflowId: SPAM_WORKFLOW_ID,
        messageId,
        triggerName: 'inbound',
        context: {
          skipIfMessageSpamOrReview: true,
          inboundWorkflowChain: { workflowIds: [SPAM_WORKFLOW_ID, LATER_WORKFLOW_ID], index: 0 },
        },
      });
      const decideJob = await takeJob('ai.decide');
      await createPostgresAiDecidePort({ db, secrets }).decide(buildAiDecideJobPlan(decideJob.payload, WORKSPACE_ID));
      const request = JSON.parse((guardedMock.mock.calls[0]![0] as { body: string }).body);
      expect(request.questions.decision.instructions).toBe('Ist diese E-Mail Spam, Phishing oder unerwünschte Werbung?');
      return drainWorkflowJobs();
    }

    /** Führt eingereihte workflow.execute-Jobs aus, bis keiner mehr kommt; liefert die Workflow-Ids. */
    async function drainWorkflowJobs(): Promise<JobRow[]> {
      const seen: JobRow[] = [];
      for (let round = 0; round < 5; round += 1) {
        const rows = await postgres.admin.query<JobRow>(
          `SELECT type, payload FROM job_queue WHERE workspace_id = $1 AND type = 'workflow.execute' ORDER BY id`,
          [WORKSPACE_ID],
        );
        if (rows.rows.length === 0) break;
        await postgres.admin.query(`DELETE FROM job_queue WHERE workspace_id = $1 AND type = 'workflow.execute'`, [WORKSPACE_ID]);
        for (const job of rows.rows) {
          seen.push(job);
          await executionPort().execute(buildWorkflowExecutionJobPlan(job.payload, WORKSPACE_ID));
        }
      }
      return seen;
    }

    async function spamState(messageId: number) {
      const rows = await postgres.admin.query<{ is_spam: boolean; spam_status: string | null }>(
        `SELECT is_spam, spam_status FROM email_messages WHERE workspace_id = $1 AND id = $2`,
        [WORKSPACE_ID, messageId],
      );
      return rows.rows[0]!;
    }

    test('Ja → Spam, Verschieben nach „Spam“, nachrangiger Workflow läuft nicht', async () => {
      await seedInbound(8621, 'Sie haben gewonnen', 'Klicken Sie hier, um Ihren Preis abzuholen.');
      await decideSpam(8621, 0.97);
      expect(await spamState(8621)).toMatchObject({ is_spam: true, spam_status: 'spam' });
      expect(await tags(8621)).toEqual(['ki-spam']);
      expect(moves).toEqual([{ messageId: 8621, targetFolderPath: 'Spam' }]);
    });

    test('Unsicher → „Spam prüfen“, nachrangiger Workflow läuft nicht', async () => {
      await seedInbound(8622, 'Angebot', 'Wir hätten da ein Angebot für Sie.');
      await decideSpam(8622, 0.5);
      expect(await spamState(8622)).toMatchObject({ spam_status: 'review' });
      expect(await tags(8622)).toEqual(['spam-pruefen']);
      expect(moves).toEqual([]);
    });

    test('Nein → keine Änderung, der nachrangige Workflow läuft weiter', async () => {
      await seedInbound(8623, 'Rückfrage', 'Wann kommt meine Bestellung?');
      const jobs = await decideSpam(8623, 0.03);
      expect(await spamState(8623)).toMatchObject({ is_spam: false });
      expect(jobs.map((job) => (job.payload as any).workflowId)).toContain(LATER_WORKFLOW_ID);
      expect(await tags(8623)).toEqual(['spaeter']);
      expect(moves).toEqual([]);
    });
  });
});
