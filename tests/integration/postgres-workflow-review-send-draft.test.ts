import type {
  Kysely,
  KyselyPlugin,
  PluginTransformQueryArgs,
  PluginTransformResultArgs,
  QueryResult,
  RootOperationNode,
  UnknownRow,
} from 'kysely';

import type { PostgresSecretPort } from '../../packages/server/src/db/postgres-secret-port';
import { createPostgresEmailMessageReadPort } from '../../packages/server/src/db/postgres-mail-read-ports';
import type { ServerDatabase } from '../../packages/server/src/db/schema';
import {
  buildAiReviewDraftJobPlan,
  buildWorkflowExecutionJobPlan,
} from '../../packages/server/src/jobs/production-handlers';
import type { JobPayload } from '../../packages/server/src/jobs/types';
import { createPostgresAiReviewDraftPort } from '../../packages/server/src/workflow-ai-draft-nodes';
import { createPostgresWorkflowExecutionJobPort } from '../../packages/server/src/workflow-execution';
import { startMigratedEmbeddedPostgres, type EmbeddedPostgres } from './helpers/embedded-postgres';

jest.mock('kysely', () => jest.requireActual('../../packages/server/node_modules/kysely'));
// Die Gegenlese-KI liefert immer SEND; alles andere läuft gegen die echte DB.
jest.mock('../../packages/server/src/workflow-ai-chat', () => ({
  ...jest.requireActual('../../packages/server/src/workflow-ai-chat'),
  runWorkflowTrackedChatCompletion: jest.fn(async () => 'STATUS: SEND\nANSWERED: yes\nREASON: passt'),
}));

jest.setTimeout(120_000);

const WORKSPACE_ID = '10000000-0000-4000-8000-0000000000d4';
const ACCOUNT_ID = 401;
const FOLDER_ID = 411;
const WORKFLOW_ID = 431;

type JobRow = { type: string; payload: JobPayload };

describe('email.send_draft after an ai.review_draft SEND verdict', () => {
  let postgres: EmbeddedPostgres;
  let db: Kysely<ServerDatabase>;

  beforeAll(async () => {
    postgres = await startMigratedEmbeddedPostgres('workflow-review-send');
    const { admin } = postgres;
    await admin.query(`INSERT INTO workspaces (id, name) VALUES ($1, 'Review Send Test')`, [WORKSPACE_ID]);
    await admin.query(`
      INSERT INTO email_accounts (id, workspace_id, source_sqlite_id, display_name, email_address, imap_host, imap_username)
      VALUES ($1, $2, $1, 'Support', 'support@example.test', 'imap.example.test', 'support')
    `, [ACCOUNT_ID, WORKSPACE_ID]);
    await admin.query(`
      INSERT INTO email_folders (id, workspace_id, source_sqlite_id, account_source_sqlite_id, account_id, path)
      VALUES ($1, $2, $1, $3, $3, 'INBOX')
    `, [FOLDER_ID, WORKSPACE_ID, ACCOUNT_ID]);
    await admin.query(`
      INSERT INTO sync_info (workspace_id, key, value, last_updated)
      VALUES ($1, 'auto_reply_enabled', 'true', now())
    `, [WORKSPACE_ID]);
    // Wie die Vorlage „KI-Antwort mit Gegenprüfung“: review --send--> send_draft.
    const graph = {
      version: 1,
      nodes: [
        { id: 'trigger-1', type: 'trigger', data: { kind: 'inbound' } },
        { id: 'review', type: 'registry', data: { nodeType: 'ai.review_draft', config: { draftIdVariable: 'draft.id', runOnEveryInbound: true } } },
        { id: 'send', type: 'registry', data: { nodeType: 'email.send_draft', config: { draftIdVariable: 'draft.id', runOutboundReview: false, runOnEveryInbound: true } } },
      ],
      edges: [
        { id: 'edge-1', source: 'trigger-1', target: 'review' },
        { id: 'edge-2', source: 'review', target: 'send', label: 'send' },
      ],
    };
    await admin.query(`
      INSERT INTO email_workflows (
        id, workspace_id, source_sqlite_id, name, trigger_name, enabled, priority,
        definition_json, graph_json, execution_mode, engine_version
      ) VALUES ($1, $2, $1, 'Review then send', 'inbound', true, 1, '{}'::jsonb, $3::jsonb, 'graph', 1)
    `, [WORKFLOW_ID, WORKSPACE_ID, JSON.stringify(graph)]);
    db = postgres.createApplicationDb();
  });

  afterAll(async () => {
    if (db) await db.destroy();
    if (postgres) await postgres.stop();
  });

  beforeEach(async () => {
    await postgres.admin.query(`DELETE FROM job_queue`);
    await postgres.admin.query(`DELETE FROM email_workflow_run_steps WHERE workspace_id = $1`, [WORKSPACE_ID]);
  });

  async function seedInboundWithDraft(messageId: number, draftId: number): Promise<void> {
    // Eigener Absender je Test: die Auto-Antwort-Drossel zählt pro Empfänger und Tag.
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
        account_id, folder_id, uid, folder_kind, subject, to_json, body_text
      ) VALUES ($1, $2, $1, $3, $4, $3, $4, $6, 'draft', 'Re: Frage', $5::jsonb, 'Fassung A')
    `, [draftId, WORKSPACE_ID, ACCOUNT_ID, FOLDER_ID, JSON.stringify({ value: [{ address: customer }] }), -draftId]);
  }

  async function takeJob(type: string): Promise<JobRow> {
    const rows = await postgres.admin.query<JobRow>(
      `SELECT type, payload FROM job_queue WHERE workspace_id = $1 AND type = $2 ORDER BY id`,
      [WORKSPACE_ID, type],
    );
    expect(rows.rows).toHaveLength(1);
    await postgres.admin.query(`DELETE FROM job_queue WHERE workspace_id = $1 AND type = $2`, [WORKSPACE_ID, type]);
    return rows.rows[0]!;
  }

  /** Startet den Lauf, führt den Review-Job aus und liefert die eingereihte Fortsetzung. */
  async function reviewWithSendVerdict(messageId: number, draftId: number): Promise<JobRow> {
    const executionPort = createPostgresWorkflowExecutionJobPort({ db });
    await executionPort.execute({
      workspaceId: WORKSPACE_ID,
      workflowId: WORKFLOW_ID,
      messageId,
      triggerName: 'inbound',
      context: { eventVariables: { 'draft.id': draftId } },
    });
    const reviewJob = await takeJob('ai.review_draft');
    await createPostgresAiReviewDraftPort({ db, secrets: {} as PostgresSecretPort })
      .reviewDraft(buildAiReviewDraftJobPlan(reviewJob.payload, WORKSPACE_ID));
    return await takeJob('workflow.execute');
  }

  async function draftState(draftId: number) {
    const rows = await postgres.admin.query<{
      scheduled_send_at: Date | null;
      approval_state: string | null;
      approval_reason: string | null;
    }>(
      `SELECT scheduled_send_at, approval_state, approval_reason FROM email_messages WHERE workspace_id = $1 AND id = $2`,
      [WORKSPACE_ID, draftId],
    );
    const marker = await postgres.admin.query(
      `SELECT value FROM sync_info WHERE workspace_id = $1 AND key = $2`,
      [WORKSPACE_ID, `outbound_review_approved:${draftId}`],
    );
    return { ...rows.rows[0]!, approvalMarker: marker.rows[0]?.value ?? null };
  }

  async function sendStepMessages(): Promise<unknown[]> {
    const rows = await postgres.admin.query<{ message: string | null }>(
      `SELECT message FROM email_workflow_run_steps WHERE workspace_id = $1 AND node_type = 'email.send_draft' ORDER BY id`,
      [WORKSPACE_ID],
    );
    return rows.rows.map((row) => row.message);
  }

  test('unchanged reviewed draft is armed for sending', async () => {
    await seedInboundWithDraft(4501, 4502);
    const continuation = await reviewWithSendVerdict(4501, 4502);

    await createPostgresWorkflowExecutionJobPort({ db })
      .execute(buildWorkflowExecutionJobPlan(continuation.payload, WORKSPACE_ID));

    const state = await draftState(4502);
    expect(state.scheduled_send_at).not.toBeNull();
    expect(state.approvalMarker).not.toBeNull();
    expect(await sendStepMessages()).toEqual(['send_draft_queued_auto']);

    // Erneute Zustellung derselben Fortsetzung (Worker starb nach dem Commit):
    // send_draft hat Betreff/Text selbst angepasst, das ist keine Änderung
    // nach der Prüfung und darf den eingeplanten Versand nicht zurückstellen.
    // Ohne Applied-Marker, wie bei einem Fan-out mit noch offenem Geschwisterzweig.
    await postgres.admin.query(`DELETE FROM email_message_workflow_applied WHERE workspace_id = $1 AND message_id = 4501`, [WORKSPACE_ID]);
    await createPostgresWorkflowExecutionJobPort({ db })
      .execute(buildWorkflowExecutionJobPlan(continuation.payload, WORKSPACE_ID));

    const redelivered = await draftState(4502);
    expect(redelivered.scheduled_send_at).not.toBeNull();
    expect(redelivered.approval_state).toBeNull();
    expect(await sendStepMessages()).toEqual(['send_draft_queued_auto', 'auto_reply_duplicate']);
  });

  // F-D1-08: a sibling branch that stopped the chain after the continuation's
  // entry check did not stop email.send_draft, which never re-read the marker.
  test('a sibling chain stop committed after the entry check keeps send_draft from arming the draft', async () => {
    await seedInboundWithDraft(4521, 4522);
    const continuation = await reviewWithSendVerdict(4521, 4522);

    // Geschwisterzweig committet seinen Kettenstopp, direkt nachdem die
    // Fortsetzung den Abbruchmarker beim Einstieg gelesen hat.
    const siblingStop = new CommitSiblingAbortAfterFirstCheck(async (key) => {
      await postgres.admin.query(`
        INSERT INTO sync_info (workspace_id, key, value, last_updated)
        VALUES ($1, $2, 'sibling_inbound_chain_stop', now())
      `, [WORKSPACE_ID, key]);
    });
    await createPostgresWorkflowExecutionJobPort({ db: db.withPlugin(siblingStop) })
      .execute(buildWorkflowExecutionJobPlan(continuation.payload, WORKSPACE_ID));

    expect(siblingStop.committedKey).toMatch(/^inbound_sibling_abort:4521:/);
    const state = await draftState(4522);
    expect(state.scheduled_send_at).toBeNull();
    expect(state.approvalMarker).toBeNull();
    expect(await sendStepMessages()).toEqual(['skip:sibling_terminal_abort']);
  });

  // F-D1-04: an edit saved between the review commit and the queued
  // continuation was sent as if the AI had reviewed it.
  test('a draft edited after the SEND verdict is held for manual approval instead of being sent', async () => {
    await seedInboundWithDraft(4511, 4512);
    const continuation = await reviewWithSendVerdict(4511, 4512);

    // Autosave eines Mitarbeiters (PATCH compose-draft) vor der Fortsetzung.
    const edited = await createPostgresEmailMessageReadPort({ db }).updateComposeDraft!({
      workspaceId: WORKSPACE_ID,
      messageId: 4512,
      values: { bodyText: 'Fassung B, noch nicht fertig' },
    });
    expect(edited.ok).toBe(true);

    await createPostgresWorkflowExecutionJobPort({ db })
      .execute(buildWorkflowExecutionJobPlan(continuation.payload, WORKSPACE_ID));

    const state = await draftState(4512);
    expect(state.scheduled_send_at).toBeNull();
    expect(state.approvalMarker).toBeNull();
    expect(state.approval_state).toBe('pending');
    expect(await sendStepMessages()).toEqual(['send_draft_changed_after_review']);
  });
});

/** Commits the sibling-abort marker once, right after the first query that reads it. */
class CommitSiblingAbortAfterFirstCheck implements KyselyPlugin {
  committedKey: string | null = null;
  private readonly pending = new WeakMap<object, string>();

  constructor(private readonly commit: (key: string) => Promise<void>) {}

  transformQuery(args: PluginTransformQueryArgs): RootOperationNode {
    if (this.committedKey === null && args.node.kind === 'SelectQueryNode') {
      const key = /"(inbound_sibling_abort:[^"]+)"/.exec(JSON.stringify(args.node))?.[1];
      if (key) this.pending.set(args.queryId, key);
    }
    return args.node;
  }

  async transformResult(args: PluginTransformResultArgs): Promise<QueryResult<UnknownRow>> {
    const key = this.pending.get(args.queryId);
    if (key && this.committedKey === null) {
      this.committedKey = key;
      await this.commit(key);
    }
    return args.result;
  }
}
