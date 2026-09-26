/**
 * @jest-environment node
 */
jest.mock('electron', () => ({
  app: { getPath: () => `${process.cwd()}/.tmp-tests/simplecrm-task-due-scan` },
}));

jest.mock('../../electron/email/email-workflow-store', () => ({
  listWorkflowsByTrigger: jest.fn(() => [{ id: 1, enabled: 1 }]),
}));

jest.mock('../../electron/email/email-store', () => ({
  getEmailMessageById: jest.fn(),
}));

jest.mock('../../electron/workflow/workflow-executor', () => ({
  executeWorkflowForTrigger: jest.fn(async () => ({
    runId: 1,
    status: 'ok',
    log: [],
    blocked: false,
    blockReason: null,
  })),
}));

import Database from 'better-sqlite3';
import { bootstrapFreshDatabaseSchema, closeDatabase } from '../../electron/sqlite-service';
import { executeWorkflowForTrigger } from '../../electron/workflow/workflow-executor';
import { scanDueTasksAndFireWorkflows } from '../../electron/workflow/workflow-trigger-dispatch';

function isoDay(offsetDays: number): string {
  return new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

describe('SQLite task.due scan', () => {
  let db: Database.Database;

  beforeEach(() => {
    jest.clearAllMocks();
    db = new Database(':memory:');
    bootstrapFreshDatabaseSchema(db, { keepDbAssigned: true });
    db.prepare("INSERT INTO customers (id, name, company) VALUES (1, 'Ada', 'Analytical Engines')").run();
  });

  afterEach(() => {
    closeDatabase();
  });

  function firedTaskIds(): number[] {
    return jest
      .mocked(executeWorkflowForTrigger)
      .mock.calls.map(([input]) => Number(input.eventVariables?.['task.id']));
  }

  // F-A9-10: Nach 50 offenen, bereits gefeuerten überfälligen Aufgaben lieferte der
  // Scan immer dieselben 50 Zeilen; neu fällige Aufgaben wurden nie ausgelöst.
  test('fires newly due tasks even when 50+ old overdue tasks stay open', async () => {
    const insert = db.prepare(
      `INSERT INTO tasks (id, customer_id, title, due_date, priority, completed)
       VALUES (?, 1, ?, ?, 'Medium', 0)`,
    );
    for (let id = 1; id <= 51; id += 1) insert.run(id, `Alt ${id}`, isoDay(-30));
    insert.run(52, 'Heute fällig', isoDay(0));

    await scanDueTasksAndFireWorkflows();
    await scanDueTasksAndFireWorkflows();

    const fired = firedTaskIds();
    expect(fired).toContain(52);
    expect(fired).toContain(51);
    // Jede Aufgabe genau einmal.
    expect(new Set(fired).size).toBe(fired.length);
  });
});
