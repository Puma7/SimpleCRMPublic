import type { Kysely } from 'kysely';

import { createServerApi } from '../../packages/server/src/api/server-api';
import type { AuthenticatedPrincipal, ServerApiPorts } from '../../packages/server/src/api/types';
import { guardedAiPost } from '../../packages/server/src/ai-guarded-fetch';
import { createPostgresSecretPort, type PostgresSecretPort } from '../../packages/server/src/db/postgres-secret-port';
import { createPostgresAiProfileReadPort } from '../../packages/server/src/db/postgres-workflow-read-ports';
import type { ServerDatabase } from '../../packages/server/src/db/schema';
import {
  buildAiDecideJobPlan,
  buildWorkflowExecutionJobPlan,
} from '../../packages/server/src/jobs/production-handlers';
import type { JobPayload } from '../../packages/server/src/jobs/types';
import { parseBase64MasterKey } from '../../packages/server/src/security/master-key';
import {
  createAiProfileConnectionTestPort,
  createPostgresAiDecidePort,
} from '../../packages/server/src/workflow-ai-decide';
import { createPostgresWorkflowExecutionJobPort } from '../../packages/server/src/workflow-execution';
import { inboundSiblingAbortKey } from '../../packages/server/src/workflow-inbound-chain-advance';
import { startMigratedEmbeddedPostgres, type EmbeddedPostgres } from './helpers/embedded-postgres';

jest.mock('kysely', () => jest.requireActual('../../packages/server/node_modules/kysely'));
// Kein Netz: der SSRF-geschützte KI-Transport wird abgefangen. So prüft der
// Test zugleich, dass die Decisions API über guardedAiPost läuft.
jest.mock('../../packages/server/src/ai-guarded-fetch', () => ({
  guardedAiPost: jest.fn(),
}));

jest.setTimeout(120_000);

const WORKSPACE_ID = '10000000-0000-4000-8000-0000000000e1';
const USER_ID = '10000000-0000-4000-8000-0000000000e2';
const ACCOUNT_ID = 801;
const FOLDER_ID = 811;
const INBOUND_WORKFLOW_ID = 831;
const OUTBOUND_WORKFLOW_ID = 832;
const INBOUND_UNSICHER_WORKFLOW_ID = 833;
const DECISIONS_KEY = 'or-decisions-secret';

type JobRow = { type: string; payload: JobPayload };
type GuardedInput = { url: string; baseUrl: string; headers: Record<string, string>; body: string; timeoutMs?: number };

const guardedMock = guardedAiPost as unknown as jest.Mock;

function respond(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return typeof body === 'string' ? body : JSON.stringify(body);
    },
  };
}

function decisionsAnswer(noul: number, cost = 0.00042) {
  return respond(200, {
    answers: { decision: { type: 'noul', noul } },
    usage: { input_tokens: 90, output_tokens: 1, cost },
  });
}

describe('ai.decide server job (Embedded Postgres)', () => {
  let postgres: EmbeddedPostgres;
  let db: Kysely<ServerDatabase>;
  let secrets: PostgresSecretPort;
  let aiProfiles: ReturnType<typeof createPostgresAiProfileReadPort>;
  let decisionsProfileId: number;
  let chatProfileId: number;

  beforeAll(async () => {
    postgres = await startMigratedEmbeddedPostgres('workflow-ai-decide');
    const { admin } = postgres;
    await admin.query(`INSERT INTO workspaces (id, name) VALUES ($1, 'AI Decide Test')`, [WORKSPACE_ID]);
    await admin.query(`
      INSERT INTO email_accounts (id, workspace_id, source_sqlite_id, display_name, email_address, imap_host, imap_username)
      VALUES ($1, $2, $1, 'Support', 'support@example.test', 'imap.example.test', 'support')
    `, [ACCOUNT_ID, WORKSPACE_ID]);
    await admin.query(`
      INSERT INTO email_folders (id, workspace_id, source_sqlite_id, account_source_sqlite_id, account_id, path)
      VALUES ($1, $2, $1, $3, $3, 'INBOX')
    `, [FOLDER_ID, WORKSPACE_ID, ACCOUNT_ID]);
    db = postgres.createApplicationDb();
    secrets = createPostgresSecretPort({ db, key: parseBase64MasterKey(Buffer.alloc(32, 7).toString('base64')) });
    aiProfiles = createPostgresAiProfileReadPort({ db, secrets });
    const decisions = await aiProfiles.create!({
      workspaceId: WORKSPACE_ID,
      actorUserId: USER_ID,
      values: {
        label: 'Jev',
        provider: 'openrouter_decisions',
        baseUrl: 'https://openrouter.ai/api',
        model: 'typesafe/jev-1.13',
        apiKey: DECISIONS_KEY,
      },
    });
    const chat = await aiProfiles.create!({
      workspaceId: WORKSPACE_ID,
      actorUserId: USER_ID,
      values: {
        label: 'Chat',
        provider: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-4o-mini',
        apiKey: 'sk-chat-secret',
      },
    });
    if (!decisions.ok || !chat.ok) throw new Error('profile setup failed');
    decisionsProfileId = decisions.profile.id;
    chatProfileId = chat.profile.id;

    const inboundGraph = {
      version: 1,
      nodes: [
        { id: 'trigger-1', type: 'trigger', data: { kind: 'inbound' } },
        {
          id: 'decide',
          type: 'registry',
          data: {
            nodeType: 'ai.decide',
            config: {
              question: 'Ist „{{subject}}“ Spam?',
              yesCriteria: 'Werbung',
              contextMode: 'full',
              threshold: 80,
              profileId: decisionsProfileId,
            },
          },
        },
        { id: 'tag-ja', type: 'registry', data: { nodeType: 'email.tag', config: { tag: 'spam-ja' } } },
        { id: 'tag-nein', type: 'registry', data: { nodeType: 'email.tag', config: { tag: 'spam-nein' } } },
        // Ohne runOnEveryInbound: jeder Ausgang von ai.decide öffnet das Inbound-Gate.
        { id: 'tag-fehler', type: 'registry', data: { nodeType: 'email.tag', config: { tag: 'ki-fehler' } } },
        { id: 'tag-unsicher', type: 'registry', data: { nodeType: 'email.tag', config: { tag: 'spam-pruefen' } } },
      ],
      edges: [
        { id: 'edge-1', source: 'trigger-1', target: 'decide' },
        { id: 'edge-2', source: 'decide', target: 'tag-ja', label: 'ja' },
        { id: 'edge-3', source: 'decide', target: 'tag-nein', label: 'nein' },
        { id: 'edge-4', source: 'decide', target: 'tag-fehler', label: 'error' },
      ],
    };
    // Wie inboundGraph, zusätzlich „Unsicher → Spam prüfen“.
    const inboundUnsicherGraph = {
      ...inboundGraph,
      edges: [...inboundGraph.edges, { id: 'edge-5', source: 'decide', target: 'tag-unsicher', label: 'unsicher' }],
    };
    const outboundGraph = {
      version: 1,
      nodes: [
        { id: 'trigger-1', type: 'trigger', data: { kind: 'outbound' } },
        {
          id: 'decide',
          type: 'registry',
          data: { nodeType: 'ai.decide', config: { question: 'Ist die Mail versandfähig?', threshold: 80 } },
        },
        { id: 'release', type: 'registry', data: { nodeType: 'email.release_outbound', config: { autoSend: false } } },
        { id: 'tag-halt', type: 'registry', data: { nodeType: 'email.tag', config: { tag: 'ki-halt' } } },
      ],
      edges: [
        { id: 'edge-1', source: 'trigger-1', target: 'decide' },
        { id: 'edge-2', source: 'decide', target: 'release', label: 'ja' },
        { id: 'edge-3', source: 'decide', target: 'tag-halt', label: 'nein' },
      ],
    };
    for (const [id, trigger, graph] of [
      [INBOUND_WORKFLOW_ID, 'inbound', inboundGraph],
      [OUTBOUND_WORKFLOW_ID, 'outbound', outboundGraph],
      [INBOUND_UNSICHER_WORKFLOW_ID, 'inbound', inboundUnsicherGraph],
    ] as const) {
      await admin.query(`
        INSERT INTO email_workflows (
          id, workspace_id, source_sqlite_id, name, trigger_name, enabled, priority,
          definition_json, graph_json, execution_mode, engine_version
        ) VALUES ($1, $2, $1, $3, $4, true, 1, '{}'::jsonb, $5::jsonb, 'graph', 1)
      `, [id, WORKSPACE_ID, `Workflow ${id}`, trigger, JSON.stringify(graph)]);
    }
  });

  afterAll(async () => {
    if (db) await db.destroy();
    if (postgres) await postgres.stop();
  });

  beforeEach(async () => {
    guardedMock.mockReset();
    await postgres.admin.query(`DELETE FROM job_queue`);
    await postgres.admin.query(`DELETE FROM ai_usage_events WHERE workspace_id = $1`, [WORKSPACE_ID]);
  });

  async function seedInbound(id: number, subject: string): Promise<void> {
    await postgres.admin.query(`
      INSERT INTO email_messages (
        id, workspace_id, source_sqlite_id, account_source_sqlite_id, folder_source_sqlite_id,
        account_id, folder_id, uid, subject, from_json, body_text
      ) VALUES ($1, $2, $1, $3, $4, $3, $4, $1, $5, $6::jsonb, 'Sie haben gewonnen!')
    `, [id, WORKSPACE_ID, ACCOUNT_ID, FOLDER_ID, subject, JSON.stringify({ value: [{ address: `absender${id}@example.com` }] })]);
  }

  async function seedDraft(id: number): Promise<void> {
    await postgres.admin.query(`
      INSERT INTO email_messages (
        id, workspace_id, source_sqlite_id, account_source_sqlite_id, folder_source_sqlite_id,
        account_id, folder_id, uid, folder_kind, subject, to_json, body_text, outbound_hold, outbound_block_reason
      ) VALUES ($1, $2, $1, $3, $4, $3, $4, $5, 'draft', 'Ihr Angebot', $6::jsonb, 'Anbei das Angebot.', true, 'Ausgangspruefung laeuft')
    `, [id, WORKSPACE_ID, ACCOUNT_ID, FOLDER_ID, -id, JSON.stringify({ value: [{ address: 'kunde@example.com' }] })]);
  }

  async function takeJobs(type: string): Promise<JobRow[]> {
    const rows = await postgres.admin.query<JobRow>(
      `SELECT type, payload FROM job_queue WHERE workspace_id = $1 AND type = $2 ORDER BY id`,
      [WORKSPACE_ID, type],
    );
    await postgres.admin.query(`DELETE FROM job_queue WHERE workspace_id = $1 AND type = $2`, [WORKSPACE_ID, type]);
    return [...rows.rows];
  }

  async function tags(messageId: number): Promise<string[]> {
    const rows = await postgres.admin.query<{ tag: string }>(
      `SELECT tag FROM email_message_tags WHERE workspace_id = $1 AND message_id = $2 ORDER BY tag`,
      [WORKSPACE_ID, messageId],
    );
    return rows.rows.map((row) => row.tag);
  }

  async function runDecision(workflowId: number, messageId: number, triggerName: string, context: Record<string, unknown> = {}) {
    await createPostgresWorkflowExecutionJobPort({ db }).execute({
      workspaceId: WORKSPACE_ID,
      workflowId,
      messageId,
      triggerName,
      context,
    });
    const [job] = await takeJobs('ai.decide');
    expect(job).toBeDefined();
    await createPostgresAiDecidePort({ db, secrets }).decide(buildAiDecideJobPlan(job!.payload, WORKSPACE_ID));
    return takeJobs('workflow.execute');
  }

  test('eingehend: Decisions API über guardedAiPost, Fortsetzung am Ausgang „nein“, Kosten übernommen', async () => {
    await seedInbound(8101, 'Gewinnspiel');
    guardedMock.mockResolvedValue(decisionsAnswer(0.05));

    const continuations = await runDecision(INBOUND_WORKFLOW_ID, 8101, 'inbound');

    expect(guardedMock).toHaveBeenCalledTimes(1);
    const request = guardedMock.mock.calls[0]![0] as GuardedInput;
    expect(request).toMatchObject({
      url: 'https://openrouter.ai/api/alpha/decisions',
      baseUrl: 'https://openrouter.ai/api',
      timeoutMs: 30_000,
      headers: { Authorization: `Bearer ${DECISIONS_KEY}` },
    });
    const body = JSON.parse(request.body);
    // Platzhalter im Job aufgelöst; Mailtext als state.
    expect(body.questions.decision).toEqual({
      type: 'noul',
      instructions: 'Ist „Gewinnspiel“ Spam?',
      criteria: { true: 'Werbung', false: 'Nein' },
    });
    expect(body.state.email).toMatchObject({ direction: 'inbound', subject: 'Gewinnspiel', body: 'Sie haben gewonnen!' });

    expect(continuations).toHaveLength(1);
    const context = (continuations[0]!.payload as any).context;
    expect(context.resumeNodeId).toBe('tag-nein');
    expect(context.eventVariables).toMatchObject({
      'ai.decide.answer': 'nein',
      'ai.decide.probability': 5,
      'ai.decide.confidence': 95,
      'ai.decide.summary': 'Entscheidungsmodell: Nein (Ja-Wahrscheinlichkeit 5 %)',
      'ai.decide.model': 'typesafe/jev-1.13',
      __inbound_condition_ok: true,
    });
    await createPostgresWorkflowExecutionJobPort({ db })
      .execute(buildWorkflowExecutionJobPlan(continuations[0]!.payload, WORKSPACE_ID));
    expect(await tags(8101)).toEqual(['spam-nein']);

    const usage = await postgres.admin.query<{ node_type: string; est_cost_micro_usd: string; model: string }>(
      `SELECT node_type, est_cost_micro_usd::text, model FROM ai_usage_events WHERE workspace_id = $1`,
      [WORKSPACE_ID],
    );
    expect(usage.rows).toEqual([{ node_type: 'ai.decide', est_cost_micro_usd: '420', model: 'typesafe/jev-1.13' }]);
  });

  test('eingehend: „unsicher“ ohne Kante endet den Zweig, KI-Fehler nimmt den Ausgang error', async () => {
    await seedInbound(8102, 'Hallo');
    guardedMock.mockResolvedValue(decisionsAnswer(0.5));
    expect(await runDecision(INBOUND_WORKFLOW_ID, 8102, 'inbound')).toEqual([]);
    expect(await tags(8102)).toEqual([]);

    await seedInbound(8103, 'Hallo');
    guardedMock.mockResolvedValue(respond(502, 'upstream down'));
    const continuations = await runDecision(INBOUND_WORKFLOW_ID, 8103, 'inbound');
    expect(continuations).toHaveLength(1);
    const context = (continuations[0]!.payload as any).context;
    expect(context.resumeNodeId).toBe('tag-fehler');
    expect(context.eventVariables).toMatchObject({
      'ai.decide.answer': 'error',
      'ai.decide.summary': 'KI-Fehler bei der Entscheidung: Decisions API HTTP 502',
    });
    // Auch der Ausgang „KI-Fehler“ ist ein bewusst verdrahteter Zweig: Gate offen.
    expect(context.eventVariables.__inbound_condition_ok).toBe(true);
    await createPostgresWorkflowExecutionJobPort({ db })
      .execute(buildWorkflowExecutionJobPlan(continuations[0]!.payload, WORKSPACE_ID));
    expect(await tags(8103)).toEqual(['ki-fehler']);
  });

  test('eingehend: Aktion hinter „unsicher“ läuft ohne runOnEveryInbound (Gate offen)', async () => {
    await seedInbound(8106, 'Vielleicht');
    guardedMock.mockResolvedValue(decisionsAnswer(0.5));
    const continuations = await runDecision(INBOUND_UNSICHER_WORKFLOW_ID, 8106, 'inbound');
    expect(continuations).toHaveLength(1);
    const context = (continuations[0]!.payload as any).context;
    expect(context.resumeNodeId).toBe('tag-unsicher');
    expect(context.eventVariables).toMatchObject({ 'ai.decide.answer': 'unsicher', __inbound_condition_ok: true });
    await createPostgresWorkflowExecutionJobPort({ db })
      .execute(buildWorkflowExecutionJobPlan(continuations[0]!.payload, WORKSPACE_ID));
    expect(await tags(8106)).toEqual(['spam-pruefen']);
    const skipped = await postgres.admin.query(
      `SELECT 1 FROM email_workflow_run_steps WHERE workspace_id = $1 AND node_id = 'tag-unsicher' AND status = 'skipped'`,
      [WORKSPACE_ID],
    );
    expect(skipped.rows).toEqual([]);
  });

  test('eingehend: Kettenstopp eines Geschwisters ⇒ kein Modellaufruf, keine Fortsetzung; Spam wird nicht übersprungen', async () => {
    await seedInbound(8104, 'Stopp');
    await createPostgresWorkflowExecutionJobPort({ db }).execute({
      workspaceId: WORKSPACE_ID,
      workflowId: INBOUND_WORKFLOW_ID,
      messageId: 8104,
      triggerName: 'inbound',
      context: {},
    });
    const [job] = await takeJobs('ai.decide');
    const continuation = (job!.payload as any).continuation;
    await postgres.admin.query(
      `INSERT INTO sync_info (workspace_id, key, value, last_updated) VALUES ($1, $2, 'sibling_inbound_chain_stop', now())`,
      [WORKSPACE_ID, inboundSiblingAbortKey(8104, INBOUND_WORKFLOW_ID, continuation.inboundWorkflowChain ?? null, continuation.inboundFanOutRunId)],
    );
    guardedMock.mockResolvedValue(decisionsAnswer(0.9));
    await createPostgresAiDecidePort({ db, secrets }).decide(buildAiDecideJobPlan(job!.payload, WORKSPACE_ID));
    expect(guardedMock).not.toHaveBeenCalled();
    expect(await takeJobs('workflow.execute')).toEqual([]);

    // Die Frage kann „Ist das Spam?“ sein: eine bereits als Spam markierte Mail
    // wird trotzdem entschieden (keine Übersprung-Logik wie bei anderen KI-Jobs).
    await seedInbound(8105, 'Spam?');
    await postgres.admin.query(
      `UPDATE email_messages SET is_spam = true, spam_status = 'spam' WHERE workspace_id = $1 AND id = 8105`,
      [WORKSPACE_ID],
    );
    guardedMock.mockResolvedValue(decisionsAnswer(0.99));
    const continuations = await runDecision(INBOUND_WORKFLOW_ID, 8105, 'inbound');
    expect(guardedMock).toHaveBeenCalledTimes(1);
    expect((continuations[0]!.payload as any).context.resumeNodeId).toBe('tag-ja');
  });

  test('ausgehend: „nein“ hält den Versand mit Standardgrund an, „ja“ läuft zur Freigabe', async () => {
    await postgres.admin.query(
      `UPDATE email_workflows SET graph_json = jsonb_set(graph_json, '{nodes,1,data,config,profileId}', to_jsonb($2::int)) WHERE workspace_id = $1 AND id = $3`,
      [WORKSPACE_ID, decisionsProfileId, OUTBOUND_WORKFLOW_ID],
    );
    await seedDraft(8201);
    guardedMock.mockResolvedValue(decisionsAnswer(0.12));
    const held = await runDecision(OUTBOUND_WORKFLOW_ID, 8201, 'outbound');
    const draft = await postgres.admin.query<{ outbound_hold: boolean; outbound_block_reason: string }>(
      `SELECT outbound_hold, outbound_block_reason FROM email_messages WHERE workspace_id = $1 AND id = 8201`,
      [WORKSPACE_ID],
    );
    expect(draft.rows[0]).toEqual({
      outbound_hold: true,
      outbound_block_reason:
        'Vom Entscheidungsmodell als nicht versandfähig blockiert – bitte E-Mail prüfen. (Ja-Wahrscheinlichkeit 12 %)',
    });
    expect((held[0]!.payload as any).context.resumeNodeId).toBe('tag-halt');

    await seedDraft(8202);
    guardedMock.mockResolvedValue(decisionsAnswer(0.97));
    const released = await runDecision(OUTBOUND_WORKFLOW_ID, 8202, 'outbound');
    expect((released[0]!.payload as any).context.resumeNodeId).toBe('release');
    await createPostgresWorkflowExecutionJobPort({ db })
      .execute(buildWorkflowExecutionJobPlan(released[0]!.payload, WORKSPACE_ID));
    const releasedDraft = await postgres.admin.query<{ outbound_hold: boolean }>(
      `SELECT outbound_hold FROM email_messages WHERE workspace_id = $1 AND id = 8202`,
      [WORKSPACE_ID],
    );
    expect(releasedDraft.rows[0]!.outbound_hold).toBe(false);
  });

  test('ausgehend mit Chat-Modell: Begründung des Modells wird Sperrgrund', async () => {
    await postgres.admin.query(
      `UPDATE email_workflows SET graph_json = jsonb_set(graph_json, '{nodes,1,data,config,profileId}', to_jsonb($2::int)) WHERE workspace_id = $1 AND id = $3`,
      [WORKSPACE_ID, chatProfileId, OUTBOUND_WORKFLOW_ID],
    );
    await seedDraft(8203);
    guardedMock.mockImplementation(async (input: GuardedInput) => {
      expect(input.url).toBe('https://api.openai.com/v1/chat/completions');
      return respond(200, {
        choices: [{ message: { content: '{"antwort":"nein","wahrscheinlichkeit_ja":10,"begruendung":"Rabattzusage ohne Freigabe."}' } }],
        usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
      });
    });
    await runDecision(OUTBOUND_WORKFLOW_ID, 8203, 'outbound');
    const draft = await postgres.admin.query<{ outbound_block_reason: string }>(
      `SELECT outbound_block_reason FROM email_messages WHERE workspace_id = $1 AND id = 8203`,
      [WORKSPACE_ID],
    );
    expect(draft.rows[0]!.outbound_block_reason).toBe('Rabattzusage ohne Freigabe.');
  });

  test('Versandvorschau entscheidet synchron und echt, ohne Sperre zu speichern', async () => {
    await postgres.admin.query(
      `UPDATE email_workflows SET graph_json = jsonb_set(graph_json, '{nodes,1,data,config,profileId}', to_jsonb($2::int)) WHERE workspace_id = $1 AND id = $3`,
      [WORKSPACE_ID, decisionsProfileId, OUTBOUND_WORKFLOW_ID],
    );
    await seedDraft(8204);
    guardedMock.mockResolvedValue(decisionsAnswer(0.3));
    const result = await createPostgresWorkflowExecutionJobPort({ db, secrets }).dryRun!({
      workspaceId: WORKSPACE_ID,
      workflowId: OUTBOUND_WORKFLOW_ID,
      messageId: 8204,
      triggerName: 'outbound',
      context: {
        previewOutbound: true,
        outbound: { messageId: 8204, subject: 'Ihr Angebot', bodyText: 'Anbei das Angebot.', to: 'kunde@example.com' },
      },
    });
    expect(guardedMock).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      success: true,
      blocked: true,
      blockReason: 'Vom Entscheidungsmodell als nicht versandfähig blockiert – bitte E-Mail prüfen. (Ja-Wahrscheinlichkeit 30 %)',
    });
    const draft = await postgres.admin.query<{ outbound_block_reason: string }>(
      `SELECT outbound_block_reason FROM email_messages WHERE workspace_id = $1 AND id = 8204`,
      [WORKSPACE_ID],
    );
    expect(draft.rows[0]!.outbound_block_reason).toBe('Ausgangspruefung laeuft');
    expect(await takeJobs('ai.decide')).toEqual([]);
  });

  describe('Verbindung testen (POST /api/v1/ai/profiles/:id/test-connection)', () => {
    const audit: Array<Record<string, unknown>> = [];
    let api: ReturnType<typeof createServerApi>;

    beforeAll(() => {
      api = createServerApi({
        auth: {} as ServerApiPorts['auth'],
        locks: {} as ServerApiPorts['locks'],
        aiProfiles,
        aiProfileConnectionTest: createAiProfileConnectionTestPort({ db, secrets }),
        audit: { async record(input) { audit.push(input); } },
      } as unknown as ServerApiPorts);
    });

    function principal(capabilities: string[]): AuthenticatedPrincipal {
      return { userId: USER_ID, workspaceId: WORKSPACE_ID, role: 'user', capabilities } as AuthenticatedPrincipal;
    }

    test('Entscheidungsmodell: Testfrage, Ergebnis, Audit und Nutzung', async () => {
      guardedMock.mockResolvedValue(decisionsAnswer(0.97, 0.0001));
      const response = await api.handle({
        method: 'POST',
        path: `/api/v1/ai/profiles/${decisionsProfileId}/test-connection`,
        principal: principal(['workflows.manage']),
        body: {},
      });
      expect(response.status).toBe(200);
      expect((response.body as any).data).toEqual({
        ok: true,
        message: 'Verbindung erfolgreich (Ja-Wahrscheinlichkeit 97 %)',
        model: 'typesafe/jev-1.13',
        latencyMs: expect.any(Number),
        probability: 97,
      });
      expect(JSON.parse((guardedMock.mock.calls[0]![0] as GuardedInput).body)).toMatchObject({
        state: 'connection test',
        questions: { decision: { type: 'noul', instructions: 'Is this a connection test?' } },
      });
      expect(audit.at(-1)).toMatchObject({ action: 'ai_profile.connection_tested', metadata: { ok: true } });
      const usage = await postgres.admin.query<{ node_type: string; est_cost_micro_usd: string }>(
        `SELECT node_type, est_cost_micro_usd::text FROM ai_usage_events WHERE workspace_id = $1`,
        [WORKSPACE_ID],
      );
      expect(usage.rows).toEqual([{ node_type: 'ai.profile_test', est_cost_micro_usd: '100' }]);
    });

    test('Chat-Profil, Fehler ohne Key, Rechte und unbekanntes Profil', async () => {
      guardedMock.mockResolvedValue(respond(200, { choices: [{ message: { content: 'OK' } }] }));
      const chat = await api.handle({
        method: 'POST',
        path: `/api/v1/ai/profiles/${chatProfileId}/test-connection`,
        principal: principal(['workflows.manage']),
        body: {},
      });
      expect((chat.body as any).data).toMatchObject({ ok: true, model: 'gpt-4o-mini', message: 'Verbindung erfolgreich – Antwort: OK' });
      expect(JSON.parse((guardedMock.mock.calls[0]![0] as GuardedInput).body).messages[0].content).toBe('Antworte nur mit OK.');

      guardedMock.mockResolvedValue(respond(401, `invalid key ${DECISIONS_KEY}`));
      const failed = await api.handle({
        method: 'POST',
        path: `/api/v1/ai/profiles/${decisionsProfileId}/test-connection`,
        principal: principal(['workflows.manage']),
        body: {},
      });
      expect((failed.body as any).data).toMatchObject({ ok: false, message: 'Decisions API HTTP 401' });
      expect(JSON.stringify(failed.body)).not.toContain(DECISIONS_KEY);

      const forbidden = await api.handle({
        method: 'POST',
        path: `/api/v1/ai/profiles/${decisionsProfileId}/test-connection`,
        principal: principal([]),
        body: {},
      });
      expect(forbidden.status).toBe(403);
      const missing = await api.handle({
        method: 'POST',
        path: '/api/v1/ai/profiles/999999/test-connection',
        principal: principal(['workflows.manage']),
        body: {},
      });
      expect(missing.status).toBe(404);
      const wrongMethod = await api.handle({
        method: 'GET',
        path: `/api/v1/ai/profiles/${decisionsProfileId}/test-connection`,
        principal: principal(['workflows.manage']),
      });
      expect(wrongMethod.status).toBe(405);
    });

    test('Profil-Typ Entscheidungsmodell: Kennung normalisiert, nur https', async () => {
      const insecure = await api.handle({
        method: 'POST',
        path: '/api/v1/ai/profiles',
        principal: principal(['workflows.manage']),
        body: { label: 'Span', provider: 'OpenRouter_Decisions', baseUrl: 'http://openrouter.ai/api', model: 'respan/span-01' },
      });
      expect(insecure.status).toBe(400);
      const created = await api.handle({
        method: 'POST',
        path: '/api/v1/ai/profiles',
        principal: principal(['workflows.manage']),
        body: { label: 'Span', provider: 'OpenRouter_Decisions', baseUrl: 'https://openrouter.ai/api', model: 'respan/span-01' },
      });
      expect(created.status).toBe(201);
      expect((created.body as any).data.provider).toBe('openrouter_decisions');
    });

    // Sicherheits-Review B6: „nur https“ gilt für die effektiven Werte (gespeichert + Änderung).
    test('PATCH: http-Adresse auf ein Entscheidungsmodell oder Entscheidungsmodell auf ein http-Profil ⇒ 400', async () => {
      const decisions = await api.handle({
        method: 'POST',
        path: '/api/v1/ai/profiles',
        principal: principal(['workflows.manage']),
        body: { label: 'Jev 2', provider: 'openrouter_decisions', baseUrl: 'https://openrouter.ai/api', model: 'typesafe/jev-1.13' },
      });
      expect(decisions.status).toBe(201);
      const decisionsId = (decisions.body as any).data.id as number;
      const onlyBaseUrl = await api.handle({
        method: 'PATCH',
        path: `/api/v1/ai/profiles/${decisionsId}`,
        principal: principal(['workflows.manage']),
        body: { baseUrl: 'http://openrouter.ai/api', apiKey: 'neuer-key' },
      });
      expect(onlyBaseUrl.status).toBe(400);
      expect((onlyBaseUrl.body as any).error.details.fields).toEqual([
        { field: 'baseUrl', message: 'Entscheidungsmodelle (Decisions API) nur ueber https' },
      ]);

      const plain = await api.handle({
        method: 'POST',
        path: '/api/v1/ai/profiles',
        principal: principal(['workflows.manage']),
        body: { label: 'Eigenes LLM', provider: 'openai', baseUrl: 'http://llm.example.com/v1', model: 'm' },
      });
      expect(plain.status).toBe(201);
      const onlyProvider = await api.handle({
        method: 'PATCH',
        path: `/api/v1/ai/profiles/${(plain.body as any).data.id}`,
        principal: principal(['workflows.manage']),
        body: { provider: 'openrouter_decisions', apiKey: 'neuer-key' },
      });
      expect(onlyProvider.status).toBe(400);

      // Weiterhin erlaubt: https-Adresse ändern bzw. andere Felder.
      const ok = await api.handle({
        method: 'PATCH',
        path: `/api/v1/ai/profiles/${decisionsId}`,
        principal: principal(['workflows.manage']),
        body: { label: 'Jev (neu)' },
      });
      expect(ok.status).toBe(200);
      const stored = await aiProfiles.get({ workspaceId: WORKSPACE_ID, id: decisionsId });
      expect(stored).toMatchObject({ baseUrl: 'https://openrouter.ai/api', provider: 'openrouter_decisions' });
    });
  });
});
