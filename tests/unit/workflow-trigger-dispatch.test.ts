const mockGetSyncInfo = jest.fn();
const mockSetSyncInfo = jest.fn();

jest.mock('../../electron/sqlite-service', () => ({
  getDb: jest.fn(() => ({
    prepare: () => ({ get: jest.fn(), all: jest.fn() }),
  })),
  getSyncInfo: (...args: unknown[]) => mockGetSyncInfo(...args),
  setSyncInfo: (...args: unknown[]) => mockSetSyncInfo(...args),
}));

jest.mock('../../electron/email/email-workflow-store', () => ({
  listWorkflowsByTrigger: jest.fn(() => []),
}));

jest.mock('../../electron/workflow/workflow-executor', () => ({
  executeWorkflowForTrigger: jest.fn(),
}));

import {
  dispatchCrmWorkflowEvent,
  fireDealStageChangedWorkflows,
  dispatchCustomerCreatedWorkflow,
} from '../../electron/workflow/workflow-trigger-dispatch';

describe('workflow-trigger-dispatch dedup', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSyncInfo.mockReturnValue(null);
  });

  test('deal stage uses timestamp debounce, not permanent flag', async () => {
    const now = Date.now();
    mockGetSyncInfo.mockReturnValueOnce(null).mockReturnValueOnce(String(now));

    await fireDealStageChangedWorkflows(1, 2, 'lead', 'won');
    await fireDealStageChangedWorkflows(1, 2, 'lead', 'won');

    expect(mockSetSyncInfo).toHaveBeenCalledTimes(1);
    const [, value] = mockSetSyncInfo.mock.calls[0] as [string, string];
    expect(Number(value)).toBeGreaterThan(1_000_000_000_000);
  });

  test('deal stage fires again after debounce window', async () => {
    const old = String(Date.now() - 10_000);
    mockGetSyncInfo.mockReturnValue(old);

    await fireDealStageChangedWorkflows(5, 6, 'a', 'b');

    expect(mockSetSyncInfo).toHaveBeenCalledTimes(1);
  });

  test('deal stage key includes old and new stage', async () => {
    await fireDealStageChangedWorkflows(9, 1, 'open', 'closed');

    const key = mockSetSyncInfo.mock.calls[0]?.[0] as string;
    expect(key).toBe('workflow_trigger_fired:crm.deal_stage_changed:9:open:closed');
  });

  test('customer_created dedup is permanent per customer id', async () => {
    mockGetSyncInfo.mockReturnValue('1');

    await dispatchCustomerCreatedWorkflow({
      customerId: 42,
      name: 'Test',
      email: 't@example.com',
    });

    expect(mockSetSyncInfo).not.toHaveBeenCalled();
  });

  test('customer_created sets permanent flag on first fire', async () => {
    await dispatchCustomerCreatedWorkflow({
      customerId: 7,
      name: 'A',
      email: null,
    });

    expect(mockSetSyncInfo).toHaveBeenCalledWith(
      'workflow_trigger_fired:crm.customer_created:7',
      '1',
    );
  });

  test('task.due scan uses TTL timestamp, not permanent', async () => {
    await dispatchCrmWorkflowEvent({
      trigger: 'task.due',
      taskId: 3,
      customerId: null,
      title: 'Call',
      dueDate: '2026-05-24',
    });

    const [, value] = mockSetSyncInfo.mock.calls[0] as [string, string];
    expect(Number(value)).toBeGreaterThan(1_000_000_000_000);
  });
});
