/**
 * @jest-environment node
 */
/**
 * Plan 047 (Desktop): Testlauf mit einer ausgewählten Mail – auch für einen
 * deaktivierten Workflow. Der Lauf wird als Test gekennzeichnet gespeichert
 * (Schritte ansehbar), zählt nicht als „letzter Lauf“ der Mail und hat keine
 * Seiteneffekte (kein Tag).
 */
jest.mock('electron', () => ({
  app: { getPath: () => `${process.cwd()}/.tmp-tests/simplecrm-workflow-test-run` },
  dialog: {},
}));

jest.mock('../../electron/email/email-openai', () => ({
  runAiDecideCall: jest.fn(async () => {
    throw new Error('Kein KI-Aufruf in diesem Test');
  }),
  runChatCompletion: jest.fn(async () => {
    throw new Error('Kein Chat-Aufruf in diesem Test');
  }),
}));

import Database from 'better-sqlite3';
import { bootstrapFreshDatabaseSchema, closeDatabase } from '../../electron/sqlite-service';
import { testWorkflowOnMessage, executeWorkflowNow } from '../../electron/workflow/workflow-executor';
import {
  getLatestWorkflowRunForMessage,
  listRecentWorkflowRuns,
  listWorkflowRunSteps,
  pruneWorkflowRunStepDetails,
} from '../../electron/workflow/run-steps';
import { getEmailReportingSnapshot } from '../../electron/email/email-reported-stats';

const ACCOUNT_ID = 1;
const FOLDER_ID = 10;
const WORKFLOW_ID = 71;
const MESSAGE_ID = 601;

describe('Workflow-Testlauf (Desktop)', () => {
  let db: Database.Database;

  beforeEach(() => {
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
        { id: 'cond', type: 'condition', data: { field: 'subject', op: 'contains', value: 'Rückgabe' } },
        { id: 'tag', type: 'registry', data: { nodeType: 'email.tag', config: { tag: 'rueckgabe' } } },
      ],
      edges: [
        { id: 'edge-1', source: 'trigger-1', target: 'cond' },
        { id: 'edge-2', source: 'cond', target: 'tag', label: 'ja' },
      ],
    };
    // Deaktiviert: neu angelegt, noch nicht eingeschaltet.
    db.prepare(
      `INSERT INTO email_workflows (id, name, trigger, enabled, priority, definition_json, graph_json)
       VALUES (?, 'Rückgaben', 'inbound', 0, 100, '{"version":1,"rules":[]}', ?)`,
    ).run(WORKFLOW_ID, JSON.stringify(graph));
    db.prepare(
      `INSERT INTO email_messages
         (id, account_id, folder_id, uid, subject, folder_kind, from_json, body_text, date_received)
       VALUES (?, ?, ?, 601, 'Rückgabe meiner Jacke', 'inbox', ?, 'Wie kann ich zurückgeben?', '2026-09-27T06:00:00Z')`,
    ).run(MESSAGE_ID, ACCOUNT_ID, FOLDER_ID, JSON.stringify({ value: [{ address: 'kunde@example.com' }] }));
  });

  afterEach(() => {
    closeDatabase();
  });

  test('deaktivierter Workflow: Testlauf gespeichert und gekennzeichnet, ohne Seiteneffekte', async () => {
    const result = await testWorkflowOnMessage(WORKFLOW_ID, MESSAGE_ID, true);
    expect(result).toMatchObject({ success: true, runId: expect.any(Number) });
    const run = db.prepare('SELECT workflow_id, message_id, dry_run FROM email_workflow_runs WHERE id = ?').get(result.runId);
    expect(run).toEqual({ workflow_id: WORKFLOW_ID, message_id: MESSAGE_ID, dry_run: 1 });
    const steps = listWorkflowRunSteps(result.runId!);
    expect(steps.map((step) => step.node_type)).toEqual(expect.arrayContaining(['email.tag']));
    expect(db.prepare('SELECT count(*) AS n FROM email_message_tags WHERE message_id = ?').get(MESSAGE_ID)).toEqual({ n: 0 });
    expect(getLatestWorkflowRunForMessage(MESSAGE_ID)).toBeNull();
    // Testläufe zählen nicht in der Auswertung, stehen aber in der Lauf-Historie.
    expect(getEmailReportingSnapshot(null).workflowRuns24h).toEqual([]);
    expect(listRecentWorkflowRuns(WORKFLOW_ID)).toEqual([expect.objectContaining({ id: result.runId, dry_run: 1 })]);
  });

  test('Aufbewahrung: Testläufe werden nach 30 Tagen samt Schritten gelöscht', async () => {
    const result = await testWorkflowOnMessage(WORKFLOW_ID, MESSAGE_ID, true);
    db.prepare(`UPDATE email_workflow_runs SET started_at = '2026-01-01T00:00:00.000Z' WHERE id = ?`).run(result.runId);
    pruneWorkflowRunStepDetails(new Date('2026-09-27T12:00:00.000Z'));
    expect(db.prepare('SELECT count(*) AS n FROM email_workflow_runs').get()).toEqual({ n: 0 });
    expect(db.prepare('SELECT count(*) AS n FROM email_workflow_run_steps').get()).toEqual({ n: 0 });
  });

  test('echter Lauf eines deaktivierten Workflows bleibt verweigert', async () => {
    await expect(executeWorkflowNow(WORKFLOW_ID, { messageId: MESSAGE_ID, dryRun: false }))
      .resolves.toEqual({ success: false, error: 'Workflow ist deaktiviert' });
    expect(db.prepare('SELECT count(*) AS n FROM email_workflow_runs').get()).toEqual({ n: 0 });
  });
});
