const store = new Map<string, string>();
const mockGetSyncInfo = jest.fn((key: string) => store.get(key) ?? null);
const mockSetSyncInfo = jest.fn((key: string, value: string) => {
  store.set(key, value);
});

jest.mock('../../electron/sqlite-service', () => ({
  getDb: jest.fn(() => ({
    prepare: () => ({ get: jest.fn(), all: jest.fn() }),
  })),
  getSyncInfo: (...args: unknown[]) => mockGetSyncInfo(...args),
  setSyncInfo: (...args: unknown[]) => mockSetSyncInfo(...args),
  deleteSyncInfo: (key: string) => {
    store.delete(key);
  },
  tryClaimSyncInfo: (key: string, value: string) => {
    if (store.has(key)) return false;
    store.set(key, value);
    return true;
  },
}));

jest.mock('../../electron/email/email-workflow-store', () => ({
  listWorkflowsByTrigger: jest.fn(() => [{ id: 1, enabled: 1 }]),
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
    store.clear();
    mockGetSyncInfo.mockReset();
    mockGetSyncInfo.mockImplementation((key: string) => store.get(key) ?? null);
    mockSetSyncInfo.mockReset();
    mockSetSyncInfo.mockImplementation((key: string, value: string) => {
      store.set(key, value);
    });
    jest.clearAllMocks();
  });

  test('deal stage uses timestamp debounce, not permanent flag', async () => {
    await fireDealStageChangedWorkflows(1, 2, 'lead', 'won');
    await fireDealStageChangedWorkflows(1, 2, 'lead', 'won');

    expect(mockSetSyncInfo).toHaveBeenCalledTimes(1);
    const [, value] = mockSetSyncInfo.mock.calls[0] as [string, string];
    expect(Number(value)).toBeGreaterThan(1_000_000_000_000);
  });

  test('deal stage fires again after debounce window', async () => {
    store.set('workflow_trigger_fired:crm.deal_stage_changed:5:a:b', String(Date.now() - 10_000));

    await fireDealStageChangedWorkflows(5, 6, 'a', 'b');

    expect(mockSetSyncInfo).toHaveBeenCalled();
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
    const { executeWorkflowForTrigger } = await import(
      '../../electron/workflow/workflow-executor'
    );
    (executeWorkflowForTrigger as jest.Mock).mockResolvedValue({ status: 'ok' });

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

  test('task.due uses permanent dedup after successful fire', async () => {
    const { executeWorkflowForTrigger } = await import(
      '../../electron/workflow/workflow-executor'
    );
    (executeWorkflowForTrigger as jest.Mock).mockResolvedValue({ status: 'ok' });

    await dispatchCrmWorkflowEvent({
      trigger: 'task.due',
      taskId: 3,
      customerId: null,
      title: 'Call',
      dueDate: '2026-05-24',
    });

    expect(mockSetSyncInfo).toHaveBeenCalledWith(
      'workflow_trigger_fired:task.due:3:2026-05-24',
      '1',
    );
  });
});
