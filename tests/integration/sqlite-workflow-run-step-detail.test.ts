/**
 * @jest-environment node
 */
/**
 * Lauf-Historie (Desktop, echte In-Memory-SQLite): jeder Schritt speichert
 * Eingang und Ausgang; ein gewählter Ausgang ohne Folgeknoten wird erklärt;
 * nach 30 Tagen werden die Details geleert, die Schritte bleiben.
 */
jest.mock('electron', () => ({
  app: { getPath: () => `${process.cwd()}/.tmp-tests/simplecrm-run-step-detail` },
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
import { bootstrapFreshDatabaseSchema, closeDatabase } from '../../electron/sqlite-service';
import { getWorkflowById } from '../../electron/email/email-workflow-store';
import { getEmailMessageById } from '../../electron/email/email-store';
import { executeWorkflowForTrigger } from '../../electron/workflow/workflow-executor';
import {
  getLatestWorkflowRunForMessage,
  listWorkflowRunSteps,
  listWorkflowRunsForMessage,
  pruneWorkflowRunStepDetails,
} from '../../electron/workflow/run-steps';

const ACCOUNT_ID = 1;
const FOLDER_ID = 10;
const WORKFLOW_ID = 7;

describe('Desktop: Eingang/Ausgang je Lauf-Schritt', () => {
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
    const graph = {
      version: 1,
      nodes: [
        { id: 'trigger-1', type: 'trigger', data: { kind: 'inbound' } },
        {
          id: 'decide',
          type: 'registry',
          data: {
            nodeType: 'ai.decide',
            config: { question: 'Ist „{{subject}}“ Spam?', threshold: 70, apiKey: 'sk-geheim' },
          },
        },
        { id: 'tag-spam', type: 'registry', data: { nodeType: 'email.tag', config: { tag: 'spam' } } },
      ],
      edges: [
        { id: 'edge-1', source: 'trigger-1', target: 'decide' },
        { id: 'edge-2', source: 'decide', target: 'tag-spam', label: 'ja' },
      ],
    };
    db.prepare(
      `INSERT INTO email_workflows (id, name, trigger, enabled, priority, definition_json, graph_json)
       VALUES (?, 'Spamfilter', 'inbound', 1, 100, '{"version":1,"rules":[]}', ?)`,
    ).run(WORKFLOW_ID, JSON.stringify(graph));
    db.prepare(
      `INSERT INTO email_messages
         (id, account_id, folder_id, uid, subject, folder_kind, from_json, body_text, date_received)
       VALUES (501, ?, ?, 501, 'Sie haben gewonnen', 'inbox', ?, 'Klicken Sie hier, um Ihren Preis abzuholen.', '2026-09-27T06:00:00Z')`,
    ).run(ACCOUNT_ID, FOLDER_ID, JSON.stringify({ value: [{ address: 'gewinn@example.com' }] }));
  });

  afterEach(() => {
    closeDatabase();
  });

  async function runSpamfilter() {
    const result = await executeWorkflowForTrigger({
      workflow: getWorkflowById(WORKFLOW_ID)!,
      trigger: 'inbound',
      direction: 'inbound',
      message: getEmailMessageById(501),
    });
    expect(result.status).toBe('ok');
    const run = getLatestWorkflowRunForMessage(501);
    expect(run).not.toBeNull();
    return listWorkflowRunSteps(run!.id);
  }

  test('„Nein“ ohne Kante: Schritt zeigt Mail, Einstellungen (geschwärzt), Ergebnis und den Hinweis', async () => {
    mockDecide.mockResolvedValue({ source: 'decisions', probability: 10, modelAnswer: null, reason: '', model: 'typesafe/jev-1.13' });

    const steps = await runSpamfilter();

    expect(steps.map((step) => [step.node_id, step.status, step.port])).toEqual([['decide', 'ok', 'nein']]);
    const detail = steps[0]!.detail!;
    expect(detail.input?.mail).toMatchObject({
      direction: 'inbound',
      subject: 'Sie haben gewonnen',
      from: 'gewinn@example.com',
      excerpt: 'Klicken Sie hier, um Ihren Preis abzuholen.',
    });
    expect(detail.input?.config).toMatchObject({ question: 'Ist „{{subject}}“ Spam?', threshold: 70, apiKey: '[geschwärzt]' });
    expect(detail.output).toMatchObject({
      port: 'nein',
      variables: { 'ai.decide.answer': 'nein', 'ai.decide.probability': 10 },
      note: 'Ausgang „Nein“ ist mit keinem Knoten verbunden – der Lauf endet hier, es passiert nichts weiter.',
    });
  });

  // Plan 046: Details → Automatik im Lesefenster.
  test('Läufe einer Mail: Workflow-Name, Status und KI-Entscheidung', async () => {
    mockDecide.mockResolvedValue({ source: 'decisions', probability: 10, modelAnswer: null, reason: '', model: 'typesafe/jev-1.13' });
    await runSpamfilter();
    const runs = listWorkflowRunsForMessage(501);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      server_id: runs[0]!.id,
      workflow_id: WORKFLOW_ID,
      workflow_name: 'Spamfilter',
      direction: 'inbound',
      last_step: { node_type: 'ai.decide', port: 'nein' },
      decision: { answer: 'nein', probability: 10 },
      continued_from_run_id: null,
    });
    expect(listWorkflowRunsForMessage(99_999)).toEqual([]);
  });

  test('„Ja“ mit Kante: kein Hinweis; die Mail steht nur im ersten Schritt', async () => {
    mockDecide.mockResolvedValue({ source: 'decisions', probability: 95, modelAnswer: null, reason: '', model: 'typesafe/jev-1.13' });

    const steps = await runSpamfilter();

    expect(steps.map((step) => [step.node_id, step.port])).toEqual([['decide', 'ja'], ['tag-spam', null]]);
    expect(steps[0]!.detail?.output?.note).toBeUndefined();
    expect(steps[0]!.detail?.input?.mail).toBeDefined();
    expect(steps[1]!.detail?.input?.mail).toBeUndefined();
    expect(steps[1]!.detail?.input?.config).toEqual({ tag: 'spam' });
  });

  test('nach 30 Tagen werden die Details geleert, die Schritte bleiben', async () => {
    mockDecide.mockResolvedValue({ source: 'decisions', probability: 10, modelAnswer: null, reason: '', model: 'typesafe/jev-1.13' });
    const [step] = await runSpamfilter();
    db.prepare(`UPDATE email_workflow_run_steps SET created_at = ? WHERE id = ?`)
      .run(new Date(Date.now() - 31 * 24 * 60 * 60_000).toISOString(), step!.id);

    expect(pruneWorkflowRunStepDetails()).toBe(1);
    const run = getLatestWorkflowRunForMessage(501)!;
    const after = listWorkflowRunSteps(run.id);
    expect(after).toHaveLength(1);
    expect(after[0]!.detail).toBeNull();
    expect(after[0]!.port).toBe('nein');
  });

  test('mehrere Trigger-Zweige: die Mail steht nur einmal im Lauf', async () => {
    const fanOut = {
      version: 1,
      nodes: [
        { id: 'trigger-1', type: 'trigger', data: { kind: 'inbound' } },
        { id: 'tag-a', type: 'registry', data: { nodeType: 'email.tag', config: { tag: 'a', runOnEveryInbound: true } } },
        { id: 'tag-b', type: 'registry', data: { nodeType: 'email.tag', config: { tag: 'b', runOnEveryInbound: true } } },
      ],
      edges: [
        { id: 'edge-a', source: 'trigger-1', target: 'tag-a' },
        { id: 'edge-b', source: 'trigger-1', target: 'tag-b' },
      ],
    };
    db.prepare(`UPDATE email_workflows SET graph_json = ? WHERE id = ?`).run(JSON.stringify(fanOut), WORKFLOW_ID);

    const steps = await runSpamfilter();

    expect(steps.map((step) => step.node_id)).toEqual(['tag-a', 'tag-b']);
    expect(steps.filter((step) => step.detail?.input?.mail)).toHaveLength(1);
  });
});
