import { createSqliteMock } from './helpers/sqlite-mock';

const { db, stmt } = createSqliteMock();
jest.mock('../../electron/sqlite-service', () => ({ getDb: () => db }));
jest.mock('../../electron/workflow/workflow-graph-resolve', () => ({
  migrateLegacyWorkflowsWithoutGraph: jest.fn(),
}));

import {
  createWorkflow,
  ensureDefaultWorkflowsSeeded,
  getWorkflowById,
  listAllWorkflows,
  listWorkflowsByTrigger,
  listWorkflowsWithCron,
  insertWorkflowRun,
  loadAppliedWorkflowIdsForMessage,
  updateWorkflow,
  deleteWorkflow,
  wasWorkflowAppliedToMessage,
  markWorkflowAppliedToMessage,
  clearInboundWorkflowAppliedForMessage,
} from '../../electron/email/email-workflow-store';

describe('email-workflow-store', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    stmt.get.mockReturnValue({ c: 0 });
    stmt.all.mockReturnValue([]);
    stmt.run.mockReturnValue({ changes: 1, lastInsertRowid: 42 });
  });

  test('ensureDefaultWorkflowsSeeded inserts defaults when empty', () => {
    ensureDefaultWorkflowsSeeded();
    expect(stmt.run).toHaveBeenCalled();
  });

  test('skips seed when workflows exist', () => {
    stmt.get.mockReturnValue({ c: 3 });
    ensureDefaultWorkflowsSeeded();
    expect(stmt.run).not.toHaveBeenCalled();
  });

  test('listWorkflowsByTrigger maps rows', () => {
    stmt.get.mockReturnValue({ c: 1 });
    stmt.all.mockReturnValue([
      {
        id: 1,
        name: 'W',
        trigger: 'inbound',
        enabled: 1,
        priority: 1,
        definition_json: '{}',
        graph_json: null,
        cron_expr: null,
        schedule_account_id: null,
        execution_mode: null,
        engine_version: null,
        created_at: 't',
        updated_at: 't',
      },
    ]);
    const rows = listWorkflowsByTrigger('inbound');
    expect(rows[0].execution_mode).toBe('graph');
    expect(rows[0].engine_version).toBe(1);
  });

  test('listWorkflowsByTrigger applies account override precedence', () => {
    stmt.get.mockReturnValue({ c: 1 });
    stmt.all.mockReturnValue([
      {
        id: 1,
        name: 'Global inbound',
        trigger: 'inbound',
        enabled: 1,
        priority: 1,
        definition_json: '{}',
        graph_json: null,
        cron_expr: null,
        schedule_account_id: null,
        account_id: null,
        override_key: 'reply',
        execution_mode: 'graph',
        engine_version: 1,
        created_at: 't',
        updated_at: 't',
      },
      {
        id: 2,
        name: 'Shop inbound',
        trigger: 'inbound',
        enabled: 1,
        priority: 1,
        definition_json: '{}',
        graph_json: null,
        cron_expr: null,
        schedule_account_id: null,
        account_id: 7,
        override_key: 'reply',
        execution_mode: 'graph',
        engine_version: 1,
        created_at: 't',
        updated_at: 't',
      },
      {
        id: 3,
        name: 'Global tagging',
        trigger: 'inbound',
        enabled: 1,
        priority: 2,
        definition_json: '{}',
        graph_json: null,
        cron_expr: null,
        schedule_account_id: null,
        account_id: null,
        override_key: 'tagging',
        execution_mode: 'graph',
        engine_version: 1,
        created_at: 't',
        updated_at: 't',
      },
    ]);

    expect(listWorkflowsByTrigger('inbound', 'all').map((row) => row.name)).toEqual([
      'Global inbound',
      'Global tagging',
    ]);
    expect(listWorkflowsByTrigger('inbound', 7).map((row) => row.name)).toEqual([
      'Shop inbound',
      'Global tagging',
    ]);
  });

  test('getWorkflowById returns undefined when missing', () => {
    stmt.get.mockReturnValue(undefined);
    expect(getWorkflowById(99)).toBeUndefined();
  });

  test('createWorkflow and list helpers', () => {
    stmt.get.mockReturnValue({ c: 1 });
    const id = createWorkflow({
      name: 'Test',
      trigger: 'inbound',
      definitionJson: '{}',
    });
    expect(id).toBe(42);
    listAllWorkflows();
    listWorkflowsWithCron();
    expect(stmt.all).toHaveBeenCalled();
  });

  test('applied flags and workflow runs', () => {
    stmt.all.mockReturnValue([{ workflow_id: 1 }, { workflow_id: 2 }]);
    expect(loadAppliedWorkflowIdsForMessage(5)).toEqual(new Set([1, 2]));
    stmt.get.mockReturnValue({ 1: 1 });
    expect(wasWorkflowAppliedToMessage(5, 1)).toBe(true);
    markWorkflowAppliedToMessage(5, 3);
    clearInboundWorkflowAppliedForMessage(5);
    insertWorkflowRun({
      workflowId: 1,
      messageId: 2,
      direction: 'inbound',
      status: 'ok',
      logJson: '{}',
    });
    expect(stmt.run).toHaveBeenCalled();
  });

  test('updateWorkflow and deleteWorkflow', () => {
    stmt.get.mockReturnValue({
      id: 1,
      name: 'W',
      trigger: 'inbound',
      enabled: 1,
      priority: 1,
      definition_json: '{}',
      graph_json: null,
      cron_expr: null,
      schedule_account_id: null,
      execution_mode: 'graph',
      engine_version: 1,
      created_at: 't',
      updated_at: 't',
    });
    updateWorkflow(1, { name: 'New', enabled: false });
    deleteWorkflow(1);
    expect(stmt.run).toHaveBeenCalled();
  });

  test('updateWorkflow throws when missing', () => {
    stmt.get.mockReturnValue(undefined);
    expect(() => updateWorkflow(9, { name: 'x' })).toThrow(/nicht gefunden/);
  });

  test('updateWorkflow all optional fields', () => {
    stmt.get.mockReturnValue({
      id: 1,
      name: 'W',
      trigger: 'inbound',
      enabled: 1,
      priority: 1,
      definition_json: '{}',
      graph_json: null,
      cron_expr: null,
      schedule_account_id: null,
      execution_mode: 'graph',
      engine_version: 1,
      created_at: 't',
      updated_at: 't',
    });
    updateWorkflow(1, {
      name: 'N',
      trigger: 'outbound',
      priority: 2,
      definitionJson: '{"version":1,"rules":[]}',
      graphJson: '{}',
      cronExpr: '0 * * * *',
      enabled: false,
      scheduleAccountId: 3,
      executionMode: 'legacy',
      engineVersion: 2,
    });
    expect(stmt.run).toHaveBeenCalled();
  });

  test('updateWorkflow no-op when no fields', () => {
    stmt.get.mockReturnValue({
      id: 1,
      name: 'W',
      trigger: 'inbound',
      enabled: 1,
      priority: 1,
      definition_json: '{}',
      graph_json: null,
      cron_expr: null,
      schedule_account_id: null,
      execution_mode: 'graph',
      engine_version: 1,
      created_at: 't',
      updated_at: 't',
    });
    updateWorkflow(1, {});
    expect(stmt.run).not.toHaveBeenCalled();
  });

  test('wasWorkflowAppliedToMessage false when missing', () => {
    stmt.get.mockReturnValue(undefined);
    expect(wasWorkflowAppliedToMessage(1, 9)).toBe(false);
  });
});
