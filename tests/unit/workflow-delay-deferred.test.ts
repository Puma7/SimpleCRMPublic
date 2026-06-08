import { registerLogicNodes } from '../../electron/workflow/nodes/logic-nodes';
import type { RegisteredWorkflowNode } from '../../electron/workflow/types';

jest.mock('../../electron/email/email-workflow-store', () => ({
  getWorkflowById: () => ({
    id: 1,
    graph_json: JSON.stringify({
      version: 1,
      nodes: [
        { id: 't1', type: 'trigger', data: { kind: 'inbound' } },
        { id: 'd1', type: 'registry', data: { nodeType: 'logic.delay', config: { delaySeconds: 30 } } },
        { id: 'a1', type: 'action', data: { actionType: 'archive' } },
      ],
      edges: [
        { id: 'e0', source: 't1', target: 'd1' },
        { id: 'e1', source: 'd1', target: 'a1' },
      ],
    }),
  }),
}));

jest.mock('../../electron/workflow/delayed-jobs', () => ({
  scheduleDelayedJob: jest.fn(),
}));

function collect(registerFn: (register: (def: RegisteredWorkflowNode) => void) => void) {
  const map = new Map<string, RegisteredWorkflowNode>();
  registerFn((def) => map.set(def.type, def));
  return map;
}

describe('logic.delay deferred inbound gate', () => {
  test('returns deferred:true when scheduling resume', async () => {
    const def = collect(registerLogicNodes).get('logic.delay')!;
    const result = await def.execute(
      {
        trigger: 'inbound',
        direction: 'inbound',
        messageId: 5,
        message: { id: 5, account_id: 1 } as never,
        outbound: null,
        workflowId: 1,
        runId: 1,
        dryRun: false,
        variables: {},
        strings: {},
        ai: {},
      },
      { delaySeconds: 30 },
      'd1',
    );

    expect(result).toMatchObject({
      status: 'ok',
      stop: true,
      deferred: true,
    });
    expect(result.message).toMatch(/^delayed_until:/);
  });
});
