jest.mock('../../electron/sqlite-service', () => ({
  getSyncInfo: jest.fn(() => null),
  getCustomerById: jest.fn(() => null),
}));

jest.mock('../../electron/email/email-store', () => ({
  getEmailAccountById: jest.fn(),
  listEmailAccounts: jest.fn(() => []),
}));

jest.mock('../../electron/email/email-workflow-store', () => ({
  getWorkflowById: jest.fn(() => ({
    id: 7,
    enabled: 1,
    trigger: 'schedule',
    schedule_account_id: null,
    execution_mode: 'graph',
    graph_json: '{"version":1,"nodes":[],"edges":[]}',
  })),
  insertWorkflowRun: jest.fn(),
}));

jest.mock('../../electron/workflow/workflow-executor', () => ({
  executeWorkflowForTrigger: jest.fn(async () => ({
    runId: 1,
    status: 'ok',
    log: ['ok'],
    blocked: false,
    blockReason: null,
  })),
}));

import { runScheduledWorkflowFire } from '../../electron/email/email-workflow-engine';
import { executeWorkflowForTrigger } from '../../electron/workflow/workflow-executor';

describe('runScheduledWorkflowFire', () => {
  test('runs workflow graph after optional sync', async () => {
    await runScheduledWorkflowFire(7);
    expect(executeWorkflowForTrigger).toHaveBeenCalledWith(
      expect.objectContaining({
        trigger: 'schedule',
        direction: 'schedule',
      }),
    );
  });
});
