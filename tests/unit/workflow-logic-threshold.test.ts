import { ensureBuiltinWorkflowNodes, getWorkflowNode } from '../../electron/workflow/registry';

jest.mock('../../electron/sqlite-service', () => ({
  getSyncInfo: jest.fn(() => '55'),
}));

describe('logic.threshold global setting', () => {
  beforeAll(() => {
    ensureBuiltinWorkflowNodes();
  });

  test('uses global spam threshold when useGlobalThreshold is true', async () => {
    const def = getWorkflowNode('logic.threshold')!;
    const ctx = {
      variables: { 'ai.spam_score': 60 },
      strings: {} as never,
      dryRun: false,
      messageId: null,
      message: null,
      direction: 'inbound' as const,
      trigger: 'inbound' as const,
      workflowId: 1,
      runId: 1,
      ai: {},
    };
    const r = await def.execute(ctx as never, {
      variable: 'ai.spam_score',
      operator: 'gte',
      useGlobalThreshold: true,
      value: 99,
    });
    expect(r.port).toBe('yes');
  });
});
