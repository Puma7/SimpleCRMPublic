/**
 * Subflow-Rekursion über die echte Runtime (workflow-executor → runtime →
 * workflow.subflow). Nur Persistenz und Registry sind gemockt.
 */
import type { RegisteredWorkflowNode } from '../../electron/workflow/types';

jest.mock('../../electron/workflow/registry', () => ({
  ...jest.requireActual('../../electron/workflow/registry'),
  ensureBuiltinWorkflowNodes: jest.fn(),
  getWorkflowNode: jest.fn(),
}));

jest.mock('../../electron/workflow/run-steps', () => ({
  startWorkflowRun: jest.fn(),
  finishWorkflowRun: jest.fn(),
  insertWorkflowRunStep: jest.fn(),
}));

jest.mock('../../electron/workflow/delayed-jobs-store', () => ({
  cancelPendingDelayedJobsForMessageSafe: jest.fn(),
}));

jest.mock('../../electron/email/email-workflow-store', () => ({
  getWorkflowById: jest.fn(),
}));

jest.mock('../../electron/email/email-workflow-engine', () => ({
  outboundPayloadFromMessage: jest.fn(),
}));

jest.mock('../../electron/sqlite-service', () => ({
  getDb: jest.fn(),
  getSyncInfo: jest.fn(() => null),
  getCustomerById: jest.fn(() => null),
}));

import { getWorkflowNode } from '../../electron/workflow/registry';
import { insertWorkflowRunStep, startWorkflowRun } from '../../electron/workflow/run-steps';
import { getWorkflowById } from '../../electron/email/email-workflow-store';
import { executeWorkflowForTrigger } from '../../electron/workflow/workflow-executor';
import { registerWorkflowMetaNodes } from '../../electron/workflow/nodes/workflow-nodes';

function subflowWorkflow(id: number, targetId: number) {
  return {
    id,
    name: `WF ${id}`,
    enabled: 1,
    trigger: 'manual',
    execution_mode: 'graph',
    definition_json: '{"version":1,"rules":[]}',
    graph_json: JSON.stringify({
      version: 1,
      nodes: [
        { id: 't', type: 'trigger', data: { kind: 'manual' } },
        { id: 'sub', type: 'registry', data: { nodeType: 'workflow.subflow', config: { workflowId: targetId } } },
      ],
      edges: [{ id: 'e1', source: 't', target: 'sub' }],
    }),
  };
}

describe('workflow.subflow recursion guard (desktop runtime)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    const defs = new Map<string, RegisteredWorkflowNode>();
    registerWorkflowMetaNodes((def) => defs.set(def.type, def));
    jest.mocked(getWorkflowNode).mockImplementation((type: string) => defs.get(type));
  });

  // F-A9-07: A→B→A wurde nur bei direkter Selbstreferenz erkannt und lief sonst unbegrenzt.
  test('stops an indirect subflow cycle A→B→A at the depth limit', async () => {
    const workflows = new Map([
      [1, subflowWorkflow(1, 2)],
      [2, subflowWorkflow(2, 1)],
    ]);
    jest.mocked(getWorkflowById).mockImplementation((id: number) => workflows.get(id) as never);
    let runs = 0;
    jest.mocked(startWorkflowRun).mockImplementation(() => {
      runs += 1;
      // Notbremse, damit der Test ohne Tiefenlimit terminiert.
      if (runs > 50) throw new Error('test_runaway');
      return runs;
    });

    const result = await executeWorkflowForTrigger({
      workflow: workflows.get(1) as never,
      trigger: 'manual',
      direction: 'manual',
    });

    // Start-Lauf + höchstens 8 verschachtelte Subflow-Läufe (Parität Server).
    expect(runs).toBeLessThanOrEqual(9);
    expect(result.status).toBe('error');
    const depthErrors = jest
      .mocked(insertWorkflowRunStep)
      .mock.calls.map(([step]) => step)
      .filter((step) => step.status === 'error' && /Subflow-Tiefe/.test(String(step.message)));
    expect(depthErrors).toHaveLength(1);
  });
});
