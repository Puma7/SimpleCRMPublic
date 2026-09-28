import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Kysely } from 'kysely';

import { outboundReviewSkippedKey } from '../../packages/core/src/email/outbound-review-skip';
import { createServerApi } from '../../packages/server/src/api/server-api';
import type { AuthenticatedPrincipal, ServerApiPorts } from '../../packages/server/src/api/types';
import { guardedAiPost } from '../../packages/server/src/ai-guarded-fetch';
import {
  createPostgresAiDecisionStatsPort,
  pruneAiDecisionEvents,
  recordAiDecisionEvent,
} from '../../packages/server/src/ai-decision-events';
import { createPostgresEmailMessageReadPort } from '../../packages/server/src/db/postgres-mail-read-ports';
import { createPostgresSecretPort, type PostgresSecretPort } from '../../packages/server/src/db/postgres-secret-port';
import {
  createPostgresAiProfileReadPort,
  createPostgresWorkflowReadPort,
} from '../../packages/server/src/db/postgres-workflow-read-ports';
import type { ServerDatabase } from '../../packages/server/src/db/schema';
import { withWorkspaceTransaction } from '../../packages/server/src/db/workspace-context';
import type { MailSqlScope } from '../../packages/server/src/mail-access/types';
import { buildAiDecideJobPlan } from '../../packages/server/src/jobs/production-handlers';
import type { JobPayload } from '../../packages/server/src/jobs/types';
import { outboundReviewApprovedKey } from '../../packages/server/src/mail-outbound-approval-store';
import { recordSentProvenance } from '../../packages/server/src/mail-sent-provenance';
import { parseBase64MasterKey } from '../../packages/server/src/security/master-key';
import { createPostgresAiDecidePort } from '../../packages/server/src/workflow-ai-decide';
import { createPostgresWorkflowExecutionJobPort } from '../../packages/server/src/workflow-execution';
import { inboundSiblingAbortKey } from '../../packages/server/src/workflow-inbound-chain-advance';
import { startMigratedEmbeddedPostgres, type EmbeddedPostgres } from './helpers/embedded-postgres';

jest.mock('kysely', () => jest.requireActual('../../packages/server/node_modules/kysely'));
jest.mock('../../packages/server/src/ai-guarded-fetch', () => ({
  guardedAiPost: jest.fn(),
}));

jest.setTimeout(120_000);

/**
 * Plan 050 (Server): Entscheidungen der KI-Entscheidung werden ohne Text
 * gespeichert, menschliche Korrekturen verknüpft, Kennzahlen über die Route
 * gelesen und alte Ereignisse gelöscht (docs/design/ai-decision-accuracy.md).
 */
const WORKSPACE_ID = '10000000-0000-4000-8000-0000000005a1';
const OTHER_WORKSPACE_ID = '10000000-0000-4000-8000-0000000005a9';
const USER_ID = '10000000-0000-4000-8000-0000000005a2';
const ACCOUNT_ID = 901;
const FOLDER_ID = 911;
const SPAM_WORKFLOW_ID = 931;
const HUMAN_WORKFLOW_ID = 932;
const OUTBOUND_WORKFLOW_ID = 933;
const PLAIN_WORKFLOW_ID = 934;

type JobRow = { type: string; payload: JobPayload };

const guardedMock = guardedAiPost as unknown as jest.Mock;

function decisionsAnswer(noul: number) {
  return {
    ok: true,
    status: 200,
    async text() {
      return JSON.stringify({ answers: { decision: { type: 'noul', noul } }, usage: { input_tokens: 9, output_tokens: 1 } });
    },
  };
}

function graph(trigger: 'inbound' | 'outbound', feedbackSignal: string | undefined, profileId: number) {
  return {
    version: 1,
    nodes: [
      { id: 'trigger-1', type: 'trigger', data: { kind: trigger } },
      {
        id: 'decide',
        type: 'registry',
        data: {
          nodeType: 'ai.decide',
          config: {
            question: 'Frage?',
            threshold: 80,
            profileId,
            ...(feedbackSignal === undefined ? {} : { feedbackSignal }),
          },
        },
      },
      { id: 'tag-ja', type: 'registry', data: { nodeType: 'email.tag', config: { tag: 'ja' } } },
    ],
    edges: [
      { id: 'edge-1', source: 'trigger-1', target: 'decide' },
      { id: 'edge-2', source: 'decide', target: 'tag-ja', label: 'ja' },
    ],
  };
}

type EventRow = {
  message_id: string | null;
  direction: string;
  node_id: string;
  workflow_source_id: string;
  answer: string;
  probability: number | null;
  threshold: number;
  model: string | null;
  feedback_signal: string;
  override_kind: string | null;
  truth: string | null;
};

describe('Treffsicherheit der KI-Entscheidung (Embedded Postgres)', () => {
  let postgres: EmbeddedPostgres;
  let db: Kysely<ServerDatabase>;
  let secrets: PostgresSecretPort;
  let attachmentsRoot: string;

  beforeAll(async () => {
    postgres = await startMigratedEmbeddedPostgres('ai-decision-accuracy');
    const { admin } = postgres;
    for (const id of [WORKSPACE_ID, OTHER_WORKSPACE_ID]) {
      await admin.query(`INSERT INTO workspaces (id, name) VALUES ($1, 'Treffsicherheit')`, [id]);
    }
    await admin.query(`
      INSERT INTO users (id, workspace_id, email, display_name, password_hash, role)
      VALUES ($1, $2, 'owner@example.test', 'Owner', 'x', 'owner')
    `, [USER_ID, WORKSPACE_ID]);
    await admin.query(`
      INSERT INTO email_accounts (id, workspace_id, source_sqlite_id, display_name, email_address, imap_host, imap_username)
      VALUES ($1, $2, $1, 'Support', 'support@example.test', 'imap.example.test', 'support')
    `, [ACCOUNT_ID, WORKSPACE_ID]);
    await admin.query(`
      INSERT INTO email_folders (id, workspace_id, source_sqlite_id, account_source_sqlite_id, account_id, path)
      VALUES ($1, $2, $1, $3, $3, 'INBOX')
    `, [FOLDER_ID, WORKSPACE_ID, ACCOUNT_ID]);
    db = postgres.createApplicationDb();
    secrets = createPostgresSecretPort({ db, key: parseBase64MasterKey(Buffer.alloc(32, 9).toString('base64')) });
    const profiles = createPostgresAiProfileReadPort({ db, secrets });
    const created = await profiles.create!({
      workspaceId: WORKSPACE_ID,
      actorUserId: USER_ID,
      values: {
        label: 'Jev',
        provider: 'openrouter_decisions',
        baseUrl: 'https://openrouter.ai/api',
        model: 'typesafe/jev-1.13',
        apiKey: 'or-key',
      },
    });
    if (!created.ok) throw new Error('profile setup failed');
    const profileId = created.profile.id;
    for (const [id, trigger, signal] of [
      [SPAM_WORKFLOW_ID, 'inbound', 'spam'],
      [HUMAN_WORKFLOW_ID, 'inbound', 'human_needed'],
      [OUTBOUND_WORKFLOW_ID, 'outbound', 'send_ok'],
      [PLAIN_WORKFLOW_ID, 'inbound', undefined],
    ] as const) {
      await admin.query(`
        INSERT INTO email_workflows (
          id, workspace_id, source_sqlite_id, name, trigger_name, enabled, priority,
          definition_json, graph_json, execution_mode, engine_version
        ) VALUES ($1, $2, $1, $3, $4, true, 1, '{}'::jsonb, $5::jsonb, 'graph', 1)
      `, [id, WORKSPACE_ID, `Workflow ${id}`, trigger, JSON.stringify(graph(trigger, signal, profileId))]);
    }
    attachmentsRoot = mkdtempSync(join(tmpdir(), 'simplecrm-ai-decision-'));
  });

  afterAll(async () => {
    if (db) await db.destroy();
    if (postgres) await postgres.stop();
    if (attachmentsRoot) rmSync(attachmentsRoot, { recursive: true, force: true });
  });

  beforeEach(async () => {
    guardedMock.mockReset();
    await postgres.admin.query(`DELETE FROM job_queue`);
    await postgres.admin.query(`DELETE FROM ai_decision_events`);
  });

  async function seedInbound(id: number, spamStatus: 'clean' | 'spam' | 'review' = 'clean'): Promise<void> {
    await postgres.admin.query(`
      INSERT INTO email_messages (
        id, workspace_id, source_sqlite_id, account_source_sqlite_id, folder_source_sqlite_id,
        account_id, folder_id, uid, subject, from_json, body_text, spam_status, is_spam
      ) VALUES ($1, $2, $1, $3, $4, $3, $4, $1, 'Betreff', $5::jsonb, 'Text', $6, $7)
    `, [id, WORKSPACE_ID, ACCOUNT_ID, FOLDER_ID, JSON.stringify({ value: [{ address: `a${id}@example.com` }] }), spamStatus, spamStatus === 'spam']);
  }

  async function seedDraft(id: number, replyParentId: number | null = null): Promise<void> {
    await postgres.admin.query(`
      INSERT INTO email_messages (
        id, workspace_id, source_sqlite_id, account_source_sqlite_id, folder_source_sqlite_id,
        account_id, folder_id, uid, folder_kind, subject, to_json, body_text, reply_parent_message_id
      ) VALUES ($1, $2, $1, $3, $4, $3, $4, $5, 'draft', 'Antwort', $6::jsonb, 'Danke.', $7)
    `, [id, WORKSPACE_ID, ACCOUNT_ID, FOLDER_ID, -id, JSON.stringify({ value: [{ address: 'kunde@example.com' }] }), replyParentId]);
  }

  async function takeJobs(type: string): Promise<JobRow[]> {
    const rows = await postgres.admin.query<JobRow>(
      `SELECT type, payload FROM job_queue WHERE workspace_id = $1 AND type = $2 ORDER BY id`,
      [WORKSPACE_ID, type],
    );
    await postgres.admin.query(`DELETE FROM job_queue WHERE workspace_id = $1`, [WORKSPACE_ID]);
    return [...rows.rows];
  }

  async function decide(workflowId: number, messageId: number, triggerName: string, noul: number, context: Record<string, unknown> = {}) {
    guardedMock.mockResolvedValue(decisionsAnswer(noul));
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
  }

  async function events(messageId?: number): Promise<EventRow[]> {
    const rows = await postgres.admin.query<EventRow>(`
      SELECT message_id::text, direction, node_id, workflow_source_id::text, answer, probability, threshold, model,
             feedback_signal, override_kind, truth
      FROM ai_decision_events WHERE workspace_id = $1 ${messageId === undefined ? '' : 'AND message_id = $2'}
      ORDER BY id
    `, messageId === undefined ? [WORKSPACE_ID] : [WORKSPACE_ID, messageId]);
    return [...rows.rows];
  }

  function mailPort() {
    return createPostgresEmailMessageReadPort({ db, attachmentsRoot });
  }

  test('Ereignis ohne Text: Antwort, Wahrscheinlichkeit, Schwelle, Modell, Rückmeldungsart', async () => {
    await seedInbound(9101);
    await decide(SPAM_WORKFLOW_ID, 9101, 'inbound', 0.95);
    expect(await events(9101)).toEqual([{
      message_id: '9101',
      direction: 'inbound',
      node_id: 'decide',
      workflow_source_id: String(SPAM_WORKFLOW_ID),
      answer: 'ja',
      probability: 95,
      threshold: 80,
      model: 'typesafe/jev-1.13',
      feedback_signal: 'spam',
      override_kind: null,
      truth: null,
    }]);
    // Kein Text in der Tabelle: nur feste Spalten.
    const columns = await postgres.admin.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'ai_decision_events' ORDER BY column_name`,
    );
    expect(columns.rows.map((row) => row.column_name)).not.toEqual(
      expect.arrayContaining(['question', 'reason', 'subject', 'summary']),
    );

    // Ohne gewählte Rückmeldung: Ereignis mit none.
    await seedInbound(9102);
    await decide(PLAIN_WORKFLOW_ID, 9102, 'inbound', 0.2);
    expect(await events(9102)).toEqual([expect.objectContaining({ answer: 'nein', feedback_signal: 'none' })]);
  });

  test('kein Ereignis bei Kettenabbruch oder fehlendem Lauf; RLS verbirgt fremde Workspaces', async () => {
    await seedInbound(9103);
    guardedMock.mockResolvedValue(decisionsAnswer(0.9));
    await createPostgresWorkflowExecutionJobPort({ db }).execute({
      workspaceId: WORKSPACE_ID,
      workflowId: SPAM_WORKFLOW_ID,
      messageId: 9103,
      triggerName: 'inbound',
      context: {},
    });
    const [job] = await takeJobs('ai.decide');
    const continuation = (job!.payload as any).continuation;
    await postgres.admin.query(
      `INSERT INTO sync_info (workspace_id, key, value, last_updated) VALUES ($1, $2, 'sibling_inbound_chain_stop', now())`,
      [WORKSPACE_ID, inboundSiblingAbortKey(9103, SPAM_WORKFLOW_ID, continuation.inboundWorkflowChain ?? null, continuation.inboundFanOutRunId)],
    );
    await createPostgresAiDecidePort({ db, secrets }).decide(buildAiDecideJobPlan(job!.payload, WORKSPACE_ID));
    expect(await events(9103)).toEqual([]);

    const written = await withWorkspaceTransaction(db, { workspaceId: WORKSPACE_ID, role: 'system' }, (trx) => recordAiDecisionEvent(trx, {
      workspaceId: WORKSPACE_ID,
      runId: 987_654,
      nodeId: 'decide',
      messageId: 9103,
      direction: 'inbound',
      answer: 'ja',
      probability: 90,
      threshold: 80,
      model: null,
      feedbackSignal: 'spam',
      now: new Date(),
    }));
    expect(written).toBe(false);
    expect(await events(9103)).toEqual([]);

    await seedInbound(9104);
    await decide(SPAM_WORKFLOW_ID, 9104, 0.9);
    expect(await events(9104)).toHaveLength(1);
    // RLS: ohne workspace_id-Filter sieht der fremde Workspace keine Zeile.
    const foreign = await withWorkspaceTransaction(db, { workspaceId: OTHER_WORKSPACE_ID, role: 'system' }, (trx) =>
      trx.selectFrom('ai_decision_events').select('id').execute());
    expect(foreign).toEqual([]);
  });

  test('Spam-Korrektur durch einen Menschen: Widerspruch, Klärung, keine Zweitkorrektur, System zählt nicht', async () => {
    const port = mailPort();
    await seedInbound(9111, 'spam');
    await decide(SPAM_WORKFLOW_ID, 9111, 'inbound', 0.95);
    // System (ohne actorUserId) verknüpft nichts.
    await port.setSpamStatus!({ workspaceId: WORKSPACE_ID, messageId: 9111, values: { status: 'clean', train: false } });
    expect(await events(9111)).toEqual([expect.objectContaining({ override_kind: null })]);
    await port.setSpamStatus!({ workspaceId: WORKSPACE_ID, messageId: 9111, values: { status: 'spam', train: false } });

    await port.setSpamStatus!({ workspaceId: WORKSPACE_ID, actorUserId: USER_ID, messageId: 9111, values: { status: 'clean', train: false } });
    expect(await events(9111)).toEqual([expect.objectContaining({ override_kind: 'spam_to_clean', truth: 'nein' })]);
    // Zweite Korrektur überschreibt die erste nicht.
    await port.setSpamStatus!({ workspaceId: WORKSPACE_ID, actorUserId: USER_ID, messageId: 9111, values: { status: 'spam', train: false } });
    expect(await events(9111)).toEqual([expect.objectContaining({ override_kind: 'spam_to_clean', truth: 'nein' })]);

    // „Unsicher“ wird durch den Menschen geklärt (Sammelaktion).
    await seedInbound(9112, 'review');
    await decide(SPAM_WORKFLOW_ID, 9112, 'inbound', 0.5);
    await port.bulkSetSpamStatus!({
      workspaceId: WORKSPACE_ID,
      actorUserId: USER_ID,
      messageIds: [9112],
      values: { status: 'spam', train: false },
    });
    expect(await events(9112)).toEqual([expect.objectContaining({ answer: 'unsicher', override_kind: 'review_to_spam', truth: 'ja' })]);

    // Zustimmung (ja → Spam) verknüpft nichts.
    await seedInbound(9113, 'clean');
    await decide(SPAM_WORKFLOW_ID, 9113, 'inbound', 0.95);
    await port.setSpamStatus!({ workspaceId: WORKSPACE_ID, actorUserId: USER_ID, messageId: 9113, values: { status: 'spam', train: false } });
    expect(await events(9113)).toEqual([expect.objectContaining({ override_kind: null })]);
  });

  test('Korrekturen nur innerhalb von 30 Tagen und nur für dieselbe Rückmeldungsart', async () => {
    const port = mailPort();
    await seedInbound(9121, 'spam');
    await decide(SPAM_WORKFLOW_ID, 9121, 'inbound', 0.95);
    await postgres.admin.query(
      `UPDATE ai_decision_events SET created_at = now() - interval '31 days' WHERE message_id = 9121`,
    );
    await port.setSpamStatus!({ workspaceId: WORKSPACE_ID, actorUserId: USER_ID, messageId: 9121, values: { status: 'clean', train: false } });
    expect(await events(9121)).toEqual([expect.objectContaining({ override_kind: null })]);

    // human_needed-Knoten: ein Spam-Wechsel zählt dort nicht.
    await seedInbound(9122, 'clean');
    await decide(HUMAN_WORKFLOW_ID, 9122, 'inbound', 0.05);
    await port.setSpamStatus!({ workspaceId: WORKSPACE_ID, actorUserId: USER_ID, messageId: 9122, values: { status: 'spam', train: false } });
    expect(await events(9122)).toEqual([expect.objectContaining({ feedback_signal: 'human_needed', override_kind: null })]);
  });

  test('Versand: menschliche Antwort widerspricht „kein Mensch nötig“, „Ohne Ausgangsprüfung senden“ widerspricht „nein“', async () => {
    await seedInbound(9131);
    await decide(HUMAN_WORKFLOW_ID, 9131, 'inbound', 0.05);
    await seedDraft(9132, 9131);
    await withWorkspaceTransaction(db, { workspaceId: WORKSPACE_ID, role: 'system' }, (trx) => recordSentProvenance(trx, {
      workspaceId: WORKSPACE_ID,
      messageId: 9132,
      sentBy: { kind: 'human', userId: USER_ID },
      now: new Date(),
    }));
    expect(await events(9131)).toEqual([expect.objectContaining({ answer: 'nein', override_kind: 'human_reply', truth: 'ja' })]);

    // Workflow-Versand ist keine menschliche Antwort.
    await seedInbound(9133);
    await decide(HUMAN_WORKFLOW_ID, 9133, 'inbound', 0.05);
    await seedDraft(9134, 9133);
    await withWorkspaceTransaction(db, { workspaceId: WORKSPACE_ID, role: 'system' }, (trx) => recordSentProvenance(trx, {
      workspaceId: WORKSPACE_ID,
      messageId: 9134,
      sentBy: { kind: 'workflow' },
      now: new Date(),
    }));
    expect(await events(9133)).toEqual([expect.objectContaining({ override_kind: null })]);

    // Ausgang: KI sagt „nein – nicht versandfähig“, der Mensch sendet ohne Ausgangsprüfung.
    await seedDraft(9135);
    await decide(OUTBOUND_WORKFLOW_ID, 9135, 'outbound', 0.1);
    expect(await events(9135)).toEqual([expect.objectContaining({ direction: 'outbound', answer: 'nein', feedback_signal: 'send_ok' })]);
    await postgres.admin.query(
      `INSERT INTO sync_info (workspace_id, key, value) VALUES ($1, $2, 'fp-1'), ($1, $3, 'fp-1')`,
      [WORKSPACE_ID, outboundReviewSkippedKey(9135), outboundReviewApprovedKey(9135)],
    );
    await withWorkspaceTransaction(db, { workspaceId: WORKSPACE_ID, role: 'system' }, (trx) => recordSentProvenance(trx, {
      workspaceId: WORKSPACE_ID,
      messageId: 9135,
      sentBy: { kind: 'human', userId: USER_ID },
      now: new Date(),
    }));
    expect(await events(9135)).toEqual([expect.objectContaining({ override_kind: 'sent_without_review', truth: 'ja' })]);
  });

  test('Kennzahlen über die Route (nur Zusammenfassung, Rechte wie die Lauf-Liste)', async () => {
    const port = mailPort();
    for (let i = 0; i < 3; i += 1) {
      await seedInbound(9141 + i, 'spam');
      await decide(SPAM_WORKFLOW_ID, 9141 + i, 'inbound', 0.95);
    }
    await port.setSpamStatus!({ workspaceId: WORKSPACE_ID, actorUserId: USER_ID, messageId: 9141, values: { status: 'clean', train: false } });
    await postgres.admin.query(
      `UPDATE ai_decision_events SET created_at = now() - interval '40 days' WHERE message_id IN (9142, 9143)`,
    );

    // Mail-Sicht des Aufrufers, wie sie die Mail-Zugriffskontrolle auflöst.
    let routeMailScope: MailSqlScope = { kind: 'all' };
    const api = createServerApi({
      auth: {} as ServerApiPorts['auth'],
      locks: {} as ServerApiPorts['locks'],
      workflows: createPostgresWorkflowReadPort({ db }),
      aiDecisionStats: createPostgresAiDecisionStatsPort({ db }),
      mailAccess: {
        async assertPermission() {
          return undefined;
        },
        async resolveScope() {
          return routeMailScope;
        },
      },
      mailResourceLookup: {
        async resolve() {
          return [];
        },
      },
    } as unknown as ServerApiPorts);
    const principal = (capabilities: string[]) =>
      ({ userId: USER_ID, workspaceId: WORKSPACE_ID, role: 'user', capabilities }) as AuthenticatedPrincipal;

    const response = await api.handle({
      method: 'GET',
      path: `/api/v1/workflows/by-source/${SPAM_WORKFLOW_ID}/ai-decisions`,
      query: { nodeId: 'decide' },
      principal: principal(['workflows.view']),
    });
    expect(response.status).toBe(200);
    const stats = (response.body as { data: Record<string, unknown> }).data;
    expect(stats).toMatchObject({
      total: 3,
      byAnswer: { ja: 3, nein: 0, unsicher: 0, error: 0 },
      closed: 3,
      agreed: 2,
      overridden: 1,
      labelled: 3,
      minSamples: 30,
      suggestedThreshold: null,
    });
    expect(stats.agreementRate).toBeCloseTo(2 / 3);
    expect(stats).not.toHaveProperty('items');

    const forbidden = await api.handle({
      method: 'GET',
      path: `/api/v1/workflows/by-source/${SPAM_WORKFLOW_ID}/ai-decisions`,
      query: { nodeId: 'decide' },
      principal: principal([]),
    });
    expect(forbidden.status).toBe(403);
    const missingNode = await api.handle({
      method: 'GET',
      path: `/api/v1/workflows/by-source/${SPAM_WORKFLOW_ID}/ai-decisions`,
      query: {},
      principal: principal(['workflows.view']),
    });
    expect(missingNode.status).toBe(400);
    const badDays = await api.handle({
      method: 'GET',
      path: `/api/v1/workflows/by-source/${SPAM_WORKFLOW_ID}/ai-decisions`,
      query: { nodeId: 'decide', days: '366' },
      principal: principal(['workflows.view']),
    });
    expect(badDays.status).toBe(400);

    // Über die Route: workflows.view ohne volle Mail-Sicht zählt nur sichtbare
    // Mails, ohne Mailzugriff keine – nie die Summe des ganzen Workspaces.
    const viaRoute = async (scope: MailSqlScope) => {
      routeMailScope = scope;
      const scoped = await api.handle({
        method: 'GET',
        path: `/api/v1/workflows/by-source/${SPAM_WORKFLOW_ID}/ai-decisions`,
        query: { nodeId: 'decide' },
        principal: principal(['workflows.view']),
      });
      expect(scoped.status).toBe(200);
      return (scoped.body as { data: { total: number } }).data.total;
    };
    expect(await viaRoute({ kind: 'restricted', accountIds: [], folderIds: [], messageIds: [9141] })).toBe(1);
    expect(await viaRoute({ kind: 'none' })).toBe(0);
    expect(await viaRoute({ kind: 'all' })).toBe(3);

    // Eingeschränkte Mail-Sicht (vom Enforcer gesetzt): nur sichtbare Mails zählen.
    const statsPort = createPostgresAiDecisionStatsPort({ db });
    const base = { workspaceId: WORKSPACE_ID, workflowSourceId: SPAM_WORKFLOW_ID, nodeId: 'decide', days: 90 };
    expect((await statsPort.get({ ...base, mailScope: { kind: 'none' } })).total).toBe(0);
    expect((await statsPort.get({
      ...base,
      mailScope: { kind: 'restricted', accountIds: [], folderIds: [], messageIds: [9141] },
    })).total).toBe(1);
    expect((await statsPort.get({ ...base, mailScope: { kind: 'all' } })).total).toBe(3);

    // Anderer Workspace sieht nichts (RLS + workspace_id).
    const other = await createPostgresAiDecisionStatsPort({ db }).get({
      workspaceId: OTHER_WORKSPACE_ID,
      workflowSourceId: SPAM_WORKFLOW_ID,
      nodeId: 'decide',
      days: 90,
    });
    expect(other.total).toBe(0);
  });

  // Codex-Review PR #199: Ereignisse ohne Rückmeldung (`none`) galten nach
  // 30 Tagen als bestätigt – scheinbar 100 % Übereinstimmung samt Vorschlag.
  test('Kennzahlen: Ereignisse ohne Rückmeldung zählen nur zur Verteilung', async () => {
    const insert = (count: number, probability: number, signal: string, override: [string, string] | null) =>
      postgres.admin.query(`
        INSERT INTO ai_decision_events (
          workspace_id, workflow_id, workflow_source_id, node_id, direction, answer, probability, threshold,
          feedback_signal, override_kind, truth, override_at, created_at
        )
        SELECT $1, $2, $2, 'decide', 'inbound', 'ja', $3, 80, $4, $5::text, $6::text,
               CASE WHEN $5::text IS NULL THEN NULL ELSE now() - interval '39 days' END,
               now() - interval '40 days'
        FROM generate_series(1, $7::int)
      `, [WORKSPACE_ID, PLAIN_WORKFLOW_ID, probability, signal, override?.[0] ?? null, override?.[1] ?? null, count]);
    await insert(35, 95, 'none', null);
    const statsPort = createPostgresAiDecisionStatsPort({ db });
    const base = { workspaceId: WORKSPACE_ID, workflowSourceId: PLAIN_WORKFLOW_ID, nodeId: 'decide', days: 90 };

    const onlyNone = await statsPort.get(base);
    expect(onlyNone).toMatchObject({
      total: 35,
      byAnswer: { ja: 35, nein: 0, unsicher: 0, error: 0 },
      closed: 0,
      agreed: 0,
      overridden: 0,
      agreementRate: null,
      labelled: 0,
      suggestedThreshold: null,
    });
    expect(onlyNone.histogram[9]).toBe(35);

    // Später Rückmeldung „spam“ gewählt: nur diese Ereignisse zählen.
    await insert(1, 97, 'spam', null);
    await insert(1, 96, 'spam', ['spam_to_clean', 'nein']);
    const mixed = await statsPort.get(base);
    expect(mixed).toMatchObject({ total: 37, closed: 2, agreed: 1, overridden: 1, labelled: 2, suggestedThreshold: null });
    expect(mixed.agreementRate).toBeCloseTo(0.5);
  });

  test('Aufbewahrung: Ereignisse älter als 365 Tage werden gelöscht', async () => {
    await seedInbound(9151);
    await decide(SPAM_WORKFLOW_ID, 9151, 'inbound', 0.95);
    await seedInbound(9152);
    await decide(SPAM_WORKFLOW_ID, 9152, 'inbound', 0.95);
    await postgres.admin.query(
      `UPDATE ai_decision_events SET created_at = now() - interval '366 days' WHERE message_id = 9151`,
    );
    await postgres.admin.query(
      `UPDATE ai_decision_events SET created_at = now() - interval '364 days' WHERE message_id = 9152`,
    );
    expect(await pruneAiDecisionEvents({ db }, WORKSPACE_ID)).toBe(1);
    expect((await events()).map((row) => row.message_id)).toEqual(['9152']);
  });
});
