import { createSqliteMock } from '../mail/helpers/sqlite-mock';

const { db, stmt } = createSqliteMock();
jest.mock('../../electron/sqlite-service', () => ({ getDb: () => db }));

import {
  getLatestWorkflowRunForMessage,
  startWorkflowRun,
} from '../../electron/workflow/run-steps';

describe('workflow run-steps', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    stmt.run.mockReturnValue({ lastInsertRowid: 1, changes: 1 });
    stmt.get.mockReturnValue(undefined);
    stmt.all.mockReturnValue([]);
  });

  test('getLatestWorkflowRunForMessage returns newest run', () => {
    const runId = startWorkflowRun({ workflowId: 3, messageId: 42, direction: 'outbound' });
    stmt.get.mockReturnValue({
      id: runId,
      workflow_id: 3,
      status: 'blocked',
      started_at: '2026-01-01T00:00:00.000Z',
      finished_at: '2026-01-01T00:00:01.000Z',
    });
    const latest = getLatestWorkflowRunForMessage(42);
    expect(latest?.id).toBe(runId);
    expect(latest?.workflow_id).toBe(3);
  });

  test('getLatestWorkflowRunForMessage returns null when none', () => {
    stmt.get.mockReturnValue(undefined);
    expect(getLatestWorkflowRunForMessage(999)).toBeNull();
  });
});
