import type { NodeExecuteResult, RegisteredWorkflowNode } from '../../electron/workflow/types';

jest.mock('../../electron/workflow/registry', () => ({
  ...jest.requireActual('../../electron/workflow/registry'),
  ensureBuiltinWorkflowNodes: jest.fn(),
  getWorkflowNode: jest.fn(),
}));

jest.mock('../../electron/workflow/run-steps', () => ({
  insertWorkflowRunStep: jest.fn(),
}));

jest.mock('../../electron/workflow/delayed-jobs-store', () => ({
  cancelPendingDelayedJobsForMessageSafe: jest.fn(),
}));

jest.mock('../../electron/sqlite-service', () => ({
  getDb: jest.fn(),
  getSyncInfo: jest.fn(() => null),
  getCustomerById: jest.fn(() => null),
}));

import { getWorkflowNode } from '../../electron/workflow/registry';
import { runWorkflowGraph } from '../../electron/workflow/runtime';

type GraphNode = { id: string; type: 'trigger' | 'registry'; data: Record<string, unknown> };
type GraphEdge = { id: string; source: string; target: string; label?: string };

/** Zählt die Ausführungen je Knoten-ID; Notbremse, damit ein roter Test terminiert. */
function installCountingNode(calls: Map<string, number>, maxCalls = 50) {
  const def: RegisteredWorkflowNode = {
    type: 'test.count',
    label: 'Zähler',
    category: 'logic',
    canvasType: 'registry',
    execute: async (_ctx, _config, nodeId): Promise<NodeExecuteResult> => {
      const n = (calls.get(nodeId) ?? 0) + 1;
      calls.set(nodeId, n);
      if (n > maxCalls) return { status: 'error', message: 'test_runaway' };
      return { status: 'ok' };
    },
  };
  jest.mocked(getWorkflowNode).mockImplementation((type: string) =>
    type === 'test.count' ? def : undefined,
  );
}

function countNode(id: string): GraphNode {
  return { id, type: 'registry', data: { nodeType: 'test.count', config: {} } };
}

async function run(nodes: GraphNode[], edges: GraphEdge[], items: string) {
  return runWorkflowGraph({
    workflow: { id: 1, graph_json: JSON.stringify({ version: 1, nodes, edges }) } as never,
    trigger: 'manual',
    direction: 'manual',
    runId: 1,
    dryRun: true,
    eventStrings: { items },
  });
}

const trigger: GraphNode = { id: 'trigger', type: 'trigger', data: { kind: 'manual' } };
const loop: GraphNode = {
  id: 'loop',
  type: 'registry',
  data: { nodeType: 'logic.loop', config: { sourceVariable: 'items' } },
};

describe('desktop logic.loop guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // F-A9-06: Ohne „Je Eintrag“-Kante lief der Fertig-Zweig N+1-mal statt einmal.
  test('runs the done branch exactly once when only the done edge is wired', async () => {
    const calls = new Map<string, number>();
    installCountingNode(calls);

    const result = await run(
      [trigger, loop, countNode('after')],
      [
        { id: 'e1', source: 'trigger', target: 'loop' },
        { id: 'e2', source: 'loop', target: 'after', label: 'done' },
      ],
      'a,b,c',
    );

    expect(result.status).toBe('ok');
    expect(calls.get('after')).toBe(1);
    expect(result.log).toContain('loop:empty');
    expect(result.log).not.toContain('loop:0:a');
  });
});
