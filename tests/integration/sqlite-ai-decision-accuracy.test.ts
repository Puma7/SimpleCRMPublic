/**
 * @jest-environment node
 */
/**
 * Plan 050 (Desktop, echte In-Memory-SQLite): Entscheidungen der KI-Entscheidung
 * werden ohne Text gespeichert (nicht im Testlauf, nicht in der Versandvorschau),
 * menschliche Korrekturen verknüpft, Kennzahlen gelesen und alte Ereignisse
 * gelöscht (docs/design/ai-decision-accuracy.md).
 */
jest.mock('electron', () => ({
  app: { getPath: () => `${process.cwd()}/.tmp-tests/simplecrm-ai-decision-accuracy` },
  dialog: {},
}));

const mockDecide = jest.fn();
jest.mock('../../electron/email/email-openai', () => ({
  runAiDecideCall: (...args: unknown[]) => mockDecide(...args),
  runChatCompletion: jest.fn(async () => {
    throw new Error('Kein Chat-Aufruf in diesem Test');
  }),
}));

import Database from 'better-sqlite3';
import { bootstrapFreshDatabaseSchema, closeDatabase, setSyncInfo } from '../../electron/sqlite-service';
import { getWorkflowById } from '../../electron/email/email-workflow-store';
import { getEmailMessageById, moveMessageToMailView, setMessageSpamStatus } from '../../electron/email/email-store';
import { recordSentProvenance } from '../../electron/email/email-sent-provenance';
import { outboundReviewApprovedKey } from '../../electron/email/outbound-approval';
import { outboundReviewSkippedKey } from '../../packages/core/src/email/outbound-review-skip';
import { executeWorkflowForTrigger } from '../../electron/workflow/workflow-executor';
import {
  loadAiDecisionStats,
  pruneAiDecisionEvents,
  pruneAiDecisionEventsIfDue,
  resetAiDecisionPruneClockForTests,
} from '../../electron/workflow/ai-decision-events';

const ACCOUNT_ID = 1;
const FOLDER_ID = 10;
const SPAM_WORKFLOW_ID = 7;
const HUMAN_WORKFLOW_ID = 8;
const OUTBOUND_WORKFLOW_ID = 9;

type EventRow = {
  workflow_id: number;
  workflow_source_id: number;
  node_id: string;
  run_id: number | null;
  message_id: number | null;
  direction: string;
  answer: string;
  probability: number | null;
  threshold: number;
  model: string | null;
  feedback_signal: string;
  override_kind: string | null;
  truth: string | null;
};

function graph(trigger: 'inbound' | 'outbound', feedbackSignal: string) {
  return {
    version: 1,
    nodes: [
      { id: 'trigger-1', type: 'trigger', data: { kind: trigger } },
      {
        id: 'decide',
        type: 'registry',
        data: { nodeType: 'ai.decide', config: { question: 'Frage?', threshold: 70, feedbackSignal } },
      },
    ],
    edges: [{ id: 'edge-1', source: 'trigger-1', target: 'decide' }],
  };
}

describe('Desktop: Treffsicherheit der KI-Entscheidung', () => {
  let db: Database.Database;

  beforeEach(() => {
    mockDecide.mockReset();
    db = new Database(':memory:');
    bootstrapFreshDatabaseSchema(db, { keepDbAssigned: true });
    db.prepare(
      `INSERT INTO email_accounts (id, display_name, email_address, imap_host, imap_username, keytar_account_key)
       VALUES (?, 'Support', 'support@example.test', 'imap.example.test', 'support', 'kt-1')`,
    ).run(ACCOUNT_ID);
    db.prepare(`INSERT INTO email_folders (id, account_id, path) VALUES (?, ?, 'INBOX')`).run(FOLDER_ID, ACCOUNT_ID);
    for (const [id, trigger, signal] of [
      [SPAM_WORKFLOW_ID, 'inbound', 'spam'],
      [HUMAN_WORKFLOW_ID, 'inbound', 'human_needed'],
      [OUTBOUND_WORKFLOW_ID, 'outbound', 'send_ok'],
    ] as const) {
      db.prepare(
        `INSERT INTO email_workflows (id, name, trigger, enabled, priority, definition_json, graph_json)
         VALUES (?, ?, ?, 1, 100, '{"version":1,"rules":[]}', ?)`,
      ).run(id, `Workflow ${id}`, trigger, JSON.stringify(graph(trigger, signal)));
    }
  });

  afterEach(() => {
    closeDatabase();
  });

  function seedMessage(id: number, spamStatus: 'clean' | 'spam' | 'review' = 'clean', folderKind = 'inbox', replyParent: number | null = null): void {
    db.prepare(
      `INSERT INTO email_messages
         (id, account_id, folder_id, uid, subject, folder_kind, from_json, body_text, date_received,
          spam_status, is_spam, reply_parent_message_id)
       VALUES (?, ?, ?, ?, 'Betreff', ?, ?, 'Text', '2026-09-27T06:00:00Z', ?, ?, ?)`,
    ).run(
      id, ACCOUNT_ID, FOLDER_ID, folderKind === 'draft' ? -id : id, folderKind,
      JSON.stringify({ value: [{ address: `a${id}@example.com` }] }),
      spamStatus, spamStatus === 'spam' ? 1 : 0, replyParent,
    );
  }

  async function decide(workflowId: number, messageId: number, probability: number, opts: { dryRun?: boolean; previewOutbound?: boolean; testRealAi?: boolean } = {}) {
    mockDecide.mockResolvedValue({ source: 'decisions', probability, modelAnswer: null, reason: '', model: 'typesafe/jev-1.13' });
    const workflow = getWorkflowById(workflowId)!;
    const outbound = workflow.trigger === 'outbound';
    const message = getEmailMessageById(messageId);
    return executeWorkflowForTrigger({
      workflow,
      trigger: outbound ? 'outbound' : 'inbound',
      direction: outbound ? 'outbound' : 'inbound',
      message: outbound ? null : message,
      outbound: outbound
        ? { messageId, subject: 'Antwort', bodyText: 'Danke.', to: 'kunde@example.com', accountId: ACCOUNT_ID }
        : null,
      ...opts,
    });
  }

  function events(messageId?: number): EventRow[] {
    return db.prepare(
      `SELECT workflow_id, workflow_source_id, node_id, run_id, message_id, direction, answer, probability, threshold,
              model, feedback_signal, override_kind, truth
       FROM ai_decision_events ${messageId === undefined ? '' : 'WHERE message_id = ?'} ORDER BY id`,
    ).all(...(messageId === undefined ? [] : [messageId])) as EventRow[];
  }

  test('echter Lauf speichert ein Ereignis ohne Text; Testlauf und Versandvorschau nicht', async () => {
    seedMessage(501);
    const run = await decide(SPAM_WORKFLOW_ID, 501, 95);
    expect(events(501)).toEqual([{
      workflow_id: SPAM_WORKFLOW_ID,
      workflow_source_id: SPAM_WORKFLOW_ID,
      node_id: 'decide',
      run_id: run.runId,
      message_id: 501,
      direction: 'inbound',
      answer: 'ja',
      probability: 95,
      threshold: 70,
      model: 'typesafe/jev-1.13',
      feedback_signal: 'spam',
      override_kind: null,
      truth: null,
    }]);

    // Beide fragen die KI wirklich, zählen aber nicht.
    await decide(SPAM_WORKFLOW_ID, 501, 95, { dryRun: true, testRealAi: true });
    seedMessage(502, 'clean', 'draft');
    await decide(OUTBOUND_WORKFLOW_ID, 502, 95, { dryRun: true, previewOutbound: true });
    expect(mockDecide).toHaveBeenCalledTimes(3);
    expect(events()).toHaveLength(1);
  });

  test('Spam-Korrektur nur mit aiOverride (Mensch); Drag & Drop in den Posteingang zählt', async () => {
    seedMessage(511, 'spam');
    await decide(SPAM_WORKFLOW_ID, 511, 95);
    // Workflow/API (ohne aiOverride) verknüpft nichts.
    setMessageSpamStatus(511, 'clean', { source: 'workflow' });
    expect(events(511)[0]).toMatchObject({ override_kind: null });
    setMessageSpamStatus(511, 'spam', { source: 'workflow' });
    setMessageSpamStatus(511, 'clean', { source: 'manual', aiOverride: true });
    expect(events(511)[0]).toMatchObject({ override_kind: 'spam_to_clean', truth: 'nein' });

    seedMessage(512, 'review');
    await decide(SPAM_WORKFLOW_ID, 512, 50);
    moveMessageToMailView(512, 'inbox');
    expect(events(512)[0]).toMatchObject({ answer: 'unsicher', override_kind: 'review_to_clean', truth: 'nein' });

    seedMessage(513, 'clean');
    await decide(SPAM_WORKFLOW_ID, 513, 10);
    moveMessageToMailView(513, 'spam');
    expect(events(513)[0]).toMatchObject({ answer: 'nein', override_kind: 'clean_to_spam', truth: 'ja' });
  });

  test('Versand: menschliche Antwort und „Ohne Ausgangsprüfung senden“', async () => {
    seedMessage(521);
    await decide(HUMAN_WORKFLOW_ID, 521, 10);
    seedMessage(522, 'clean', 'draft', 521);
    recordSentProvenance(522, { kind: 'human', userId: 'u1' });
    expect(events(521)[0]).toMatchObject({ answer: 'nein', override_kind: 'human_reply', truth: 'ja' });

    // Workflow-Versand ist keine menschliche Antwort.
    seedMessage(523);
    await decide(HUMAN_WORKFLOW_ID, 523, 10);
    seedMessage(524, 'clean', 'draft', 523);
    recordSentProvenance(524, { kind: 'workflow' });
    expect(events(523)[0]).toMatchObject({ override_kind: null });

    seedMessage(525, 'clean', 'draft');
    await decide(OUTBOUND_WORKFLOW_ID, 525, 50);
    expect(events(525)[0]).toMatchObject({ direction: 'outbound', answer: 'unsicher', feedback_signal: 'send_ok' });
    setSyncInfo(outboundReviewSkippedKey(525), 'fp-1');
    setSyncInfo(outboundReviewApprovedKey(525), 'fp-1');
    recordSentProvenance(525, { kind: 'human', userId: 'u1' });
    expect(events(525)[0]).toMatchObject({ override_kind: 'sent_without_review', truth: 'ja' });
  });

  test('Kennzahlen je Knoten und Aufbewahrung', async () => {
    for (const id of [531, 532, 533]) {
      seedMessage(id, 'spam');
      await decide(SPAM_WORKFLOW_ID, id, 95);
    }
    setMessageSpamStatus(531, 'clean', { aiOverride: true });
    const old = new Date(Date.now() - 40 * 86_400_000).toISOString();
    db.prepare(`UPDATE ai_decision_events SET created_at = ? WHERE message_id IN (532, 533)`).run(old);

    const stats = loadAiDecisionStats({ workflowId: SPAM_WORKFLOW_ID, nodeId: 'decide' });
    expect(stats).toMatchObject({
      total: 3,
      byAnswer: { ja: 3, nein: 0, unsicher: 0, error: 0 },
      agreed: 2,
      overridden: 1,
      labelled: 3,
      suggestedThreshold: null,
    });
    expect(loadAiDecisionStats({ workflowId: SPAM_WORKFLOW_ID, nodeId: 'andere' }).total).toBe(0);
    expect(loadAiDecisionStats({ workflowId: SPAM_WORKFLOW_ID, nodeId: 'decide', days: 30 }).total).toBe(1);

    const ancient = new Date(Date.now() - 366 * 86_400_000).toISOString();
    db.prepare(`UPDATE ai_decision_events SET created_at = ? WHERE message_id = 532`).run(ancient);
    const almost = new Date(Date.now() - 364 * 86_400_000).toISOString();
    db.prepare(`UPDATE ai_decision_events SET created_at = ? WHERE message_id = 533`).run(almost);
    expect(pruneAiDecisionEvents()).toBe(1);
    expect(events().map((row) => row.message_id)).toEqual([531, 533]);

    db.prepare(`UPDATE ai_decision_events SET created_at = ? WHERE message_id = 533`).run(ancient);
    const logger = { warn: jest.fn(), debug: jest.fn() };
    resetAiDecisionPruneClockForTests();
    pruneAiDecisionEventsIfDue(logger);
    // Zweiter Aufruf am selben Tag tut nichts.
    pruneAiDecisionEventsIfDue(logger);
    expect(logger.debug).toHaveBeenCalledTimes(1);
    expect(events().map((row) => row.message_id)).toEqual([531]);
  });
});
