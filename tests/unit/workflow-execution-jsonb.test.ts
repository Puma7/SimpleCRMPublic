import { createPostgresWorkflowExecutionJobPort } from '../../packages/server/src';

// Regression for "Failed task (workflow.execute) with error 'invalid input
// syntax for type json'" at finishExistingRun. The email_workflow_runs.log_json
// column is jsonb. node-postgres serializes a JS *array* parameter as a Postgres
// array literal ({...}), which the jsonb column rejects (22P02) — so every run
// finalize crashed and the worker could never mark a run done.
//
// The fix passes a JSON *string* for log_json (insert and update). These tests
// drive the real port through the workflow-not-found and delayed-job-not-found
// paths and assert the value bound for log_json is a string, not an array. The
// `kysely` module is mocked in unit tests, so we fake the query-builder chain
// and capture the payloads the production code hands to it.

type Captured = {
  inserts: Array<{ table: string; values: Record<string, unknown> }>;
  updates: Array<{ table: string; set: Record<string, unknown> }>;
};

function fakeDb(options: {
  selectResults?: Record<string, unknown>;
  captured: Captured;
}): { db: unknown } {
  const { selectResults = {}, captured } = options;

  const makeSelect = (table: string) => {
    const builder: Record<string, unknown> = {};
    builder.select = () => builder;
    builder.where = () => builder;
    builder.executeTakeFirst = async () => selectResults[table];
    builder.execute = async () => [];
    return builder;
  };

  const makeInsert = (table: string) => {
    const builder: Record<string, unknown> = {};
    builder.values = (values: Record<string, unknown>) => {
      captured.inserts.push({ table, values });
      return builder;
    };
    builder.returning = () => builder;
    builder.onConflict = () => builder;
    builder.execute = async () => [];
    builder.executeTakeFirst = async () => ({ id: 1, source_sqlite_id: null });
    builder.executeTakeFirstOrThrow = async () => ({ id: 1, source_sqlite_id: null });
    return builder;
  };

  const makeUpdate = (table: string) => {
    const builder: Record<string, unknown> = {};
    builder.set = (set: Record<string, unknown>) => {
      captured.updates.push({ table, set });
      return builder;
    };
    builder.where = () => builder;
    builder.execute = async () => [];
    return builder;
  };

  const trx = {
    selectFrom: (table: string) => makeSelect(table),
    insertInto: (table: string) => makeInsert(table),
    updateTable: (table: string) => makeUpdate(table),
  };

  const db = {
    transaction: () => ({
      execute: async (cb: (t: typeof trx) => Promise<unknown>) => cb(trx),
    }),
  };

  return { db };
}

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const NOW = () => new Date('2026-06-06T00:00:00.000Z');

describe('workflow run finalize writes jsonb-safe log_json', () => {
  test('workflow-not-found path stringifies the run log for the UPDATE', async () => {
    const captured: Captured = { inserts: [], updates: [] };
    const { db } = fakeDb({ selectResults: { email_workflows: undefined }, captured });

    const port = createPostgresWorkflowExecutionJobPort({
      db: db as never,
      now: NOW,
      applyWorkspaceSession: async () => {},
    });

    await port.execute({ workspaceId: WORKSPACE_ID, workflowId: 999, runId: 7, context: {} });

    const update = captured.updates.find((u) => u.table === 'email_workflow_runs');
    expect(update).toBeDefined();
    expect(typeof update!.set.log_json).toBe('string');
    expect(JSON.parse(update!.set.log_json as string)).toEqual(['error:workflow_not_found']);
  });

  test('delayed-job-not-found path stringifies log_json for both INSERT and UPDATE', async () => {
    const captured: Captured = { inserts: [], updates: [] };
    const workflowRow = {
      id: 5,
      source_sqlite_id: 50,
      trigger_name: 'manual',
      enabled: true,
      definition_json: null,
      graph_json: null,
      execution_mode: 'modular',
    };
    const { db } = fakeDb({
      selectResults: { email_workflows: workflowRow, workflow_delayed_jobs: undefined },
      captured,
    });

    const port = createPostgresWorkflowExecutionJobPort({
      db: db as never,
      now: NOW,
      applyWorkspaceSession: async () => {},
    });

    await port.execute({
      workspaceId: WORKSPACE_ID,
      workflowId: 5,
      delayedJobId: 123,
      context: {},
    });

    const insert = captured.inserts.find((i) => i.table === 'email_workflow_runs');
    expect(insert).toBeDefined();
    expect(typeof insert!.values.log_json).toBe('string');
    expect(JSON.parse(insert!.values.log_json as string)).toEqual([]);

    const update = captured.updates.find((u) => u.table === 'email_workflow_runs');
    expect(update).toBeDefined();
    expect(typeof update!.set.log_json).toBe('string');
    expect(JSON.parse(update!.set.log_json as string)).toEqual(['error:delayed_job_not_found']);
  });
});
