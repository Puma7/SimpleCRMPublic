/**
 * @jest-environment node
 */
jest.mock('electron', () => ({
  app: { getPath: () => `${process.cwd()}/.tmp-tests/simplecrm-delayed-jobs-dedup` },
}));

jest.mock('../../electron/email/email-workflow-store', () => ({
  getWorkflowById: jest.fn(),
  releaseInboundWorkflowClaim: jest.fn(),
}));

jest.mock('../../electron/email/email-store', () => ({
  getEmailMessageById: jest.fn(),
}));

jest.mock('../../electron/workflow/workflow-executor', () => ({
  executeWorkflowForTrigger: jest.fn(),
}));

import Database from 'better-sqlite3';
import { bootstrapFreshDatabaseSchema, closeDatabase } from '../../electron/sqlite-service';
import { scheduleDelayedJob } from '../../electron/workflow/delayed-jobs';

describe('SQLite workflow delayed jobs dedup', () => {
  let db: Database.Database;
  const executeAt = new Date(Date.now() + 60_000).toISOString();

  beforeEach(() => {
    db = new Database(':memory:');
    bootstrapFreshDatabaseSchema(db, { keepDbAssigned: true });
    db.prepare(
      `INSERT INTO email_workflows (id, name, trigger, definition_json)
       VALUES (1, 'Aufgabe fällig', 'task.due', '{"version":1,"rules":[]}')`,
    ).run();
  });

  afterEach(() => {
    closeDatabase();
  });

  function pendingContexts(): string[] {
    return (
      db
        .prepare(`SELECT context_json FROM workflow_delayed_jobs WHERE status = 'pending' ORDER BY id`)
        .all() as { context_json: string }[]
    ).map((row) => row.context_json);
  }

  // F-A9-08: Nachrichtenlose Läufe (task.due, Zeitplan, CRM) fielen auf einen
  // Verzögerungsjob zusammen; die Fortsetzung des zweiten Laufs ging verloren.
  test('message-less runs keep one delayed job per run', () => {
    const first = scheduleDelayedJob({
      workflowId: 1,
      messageId: null,
      resumeNodeId: 'a1',
      executeAt,
      contextJson: JSON.stringify({ variables: { 'task.id': 17 } }),
    });
    const second = scheduleDelayedJob({
      workflowId: 1,
      messageId: null,
      resumeNodeId: 'a1',
      executeAt,
      contextJson: JSON.stringify({ variables: { 'task.id': 18 } }),
    });

    expect(second).not.toBe(first);
    const contexts = pendingContexts();
    expect(contexts).toHaveLength(2);
    expect(contexts[1]).toContain('"task.id":18');
  });

  test('a resumed message-less job reaching the same delay again does not start a new job', () => {
    const resumed = scheduleDelayedJob({
      workflowId: 1,
      messageId: null,
      resumeNodeId: 'a1',
      executeAt,
      contextJson: JSON.stringify({ variables: { 'task.id': 17 } }),
    });
    // processDueDelayedJobs setzt den fortgesetzten Job auf 'running'.
    db.prepare(`UPDATE workflow_delayed_jobs SET status = 'running' WHERE id = ?`).run(resumed);

    const again = scheduleDelayedJob({
      workflowId: 1,
      messageId: null,
      resumeNodeId: 'a1',
      executeAt,
      contextJson: JSON.stringify({ variables: { 'task.id': 17 } }),
    });

    expect(again).toBe(resumed);
    expect(pendingContexts()).toHaveLength(0);
  });

  test('a re-run for the same message still reuses the pending delayed job', () => {
    // Nur die Dedup-Semantik ist hier Thema, keine echte Mail-Zeile nötig.
    db.pragma('foreign_keys = OFF');
    const input = {
      workflowId: 1,
      messageId: 5,
      resumeNodeId: 'a1',
      executeAt,
      contextJson: JSON.stringify({ variables: {} }),
    };

    const first = scheduleDelayedJob(input);
    const second = scheduleDelayedJob(input);

    expect(second).toBe(first);
    expect(pendingContexts()).toHaveLength(1);
  });
});
