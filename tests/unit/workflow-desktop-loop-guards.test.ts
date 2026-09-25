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
/** Schleife mit dem höchsten erlaubten maxItems (500, wie der Server). */
const bigLoop: GraphNode = {
  id: 'loop',
  type: 'registry',
  data: { nodeType: 'logic.loop', config: { sourceVariable: 'items', maxItems: 500 } },
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

  // F-A9-05: Eine Rückkante Rumpf → Schleife startete ohne Ende neue, verschachtelte Schleifen.
  test('stops each iteration before a back edge to the loop node', async () => {
    const calls = new Map<string, number>();
    installCountingNode(calls);

    const result = await run(
      [trigger, loop, countNode('body'), countNode('after')],
      [
        { id: 'e1', source: 'trigger', target: 'loop' },
        { id: 'e2', source: 'loop', target: 'body', label: 'each' },
        { id: 'e3', source: 'body', target: 'loop' },
        { id: 'e4', source: 'loop', target: 'after', label: 'done' },
      ],
      'a,b',
    );

    expect(result.status).toBe('ok');
    expect(calls.get('body')).toBe(2);
    expect(calls.get('after')).toBe(1);
  });

  // F-A9-05: Ein Kreis A→B→A im Je-Eintrag-Zweig lief ohne Schrittlimit endlos weiter.
  test('aborts a cycle inside the each branch at the step limit', async () => {
    const calls = new Map<string, number>();
    installCountingNode(calls, 1000);

    const result = await run(
      [trigger, loop, countNode('a'), countNode('b'), countNode('after')],
      [
        { id: 'e1', source: 'trigger', target: 'loop' },
        { id: 'e2', source: 'loop', target: 'a', label: 'each' },
        { id: 'e3', source: 'a', target: 'b' },
        { id: 'e4', source: 'b', target: 'a' },
        { id: 'e5', source: 'loop', target: 'after', label: 'done' },
      ],
      'x,y',
    );

    expect(result.status).toBe('blocked');
    expect(result.blocked).toBe(true);
    expect(result.blockReason).toMatch(/Schrittlimit/);
    expect(result.log.some((line) => line.startsWith('graph_step_limit:'))).toBe(true);
    expect((calls.get('a') ?? 0) + (calls.get('b') ?? 0)).toBeLessThanOrEqual(500);
    expect(calls.get('after')).toBeUndefined();
  });

  // PR-Review (#193): Jede Iteration begann mit eigenem Schrittzähler; 500 Einträge mal ein langer
  // Rumpf ergaben weit mehr als 500 Knotenausführungen je Lauf (bis 500×500).
  test('caps the total node executions of a run across all loop iterations', async () => {
    const calls = new Map<string, number>();
    installCountingNode(calls, 1000);
    const body = Array.from({ length: 30 }, (_, i) => countNode(`n${i}`));
    const bodyEdges = body.slice(1).map((node, i) => ({ id: `b${i}`, source: body[i]!.id, target: node.id }));
    const items = Array.from({ length: 500 }, (_, i) => `i${i}`).join(',');

    const result = await run(
      [trigger, bigLoop, ...body, countNode('after')],
      [
        { id: 'e1', source: 'trigger', target: 'loop' },
        { id: 'e2', source: 'loop', target: 'n0', label: 'each' },
        ...bodyEdges,
        { id: 'e3', source: 'loop', target: 'after', label: 'done' },
      ],
      items,
    );

    const total = [...calls.values()].reduce((sum, n) => sum + n, 0);
    expect(result.status).toBe('blocked');
    expect(result.blockReason).toMatch(/Schrittlimit/);
    expect(total).toBeLessThanOrEqual(10_000);
    expect(calls.get('after')).toBeUndefined();
  });

  test('a loop over 500 items with a short body still completes', async () => {
    const calls = new Map<string, number>();
    installCountingNode(calls, 1000);
    const items = Array.from({ length: 500 }, (_, i) => `i${i}`).join(',');

    const result = await run(
      [trigger, bigLoop, countNode('body'), countNode('after')],
      [
        { id: 'e1', source: 'trigger', target: 'loop' },
        { id: 'e2', source: 'loop', target: 'body', label: 'each' },
        { id: 'e3', source: 'loop', target: 'after', label: 'done' },
      ],
      items,
    );

    expect(result.status).toBe('ok');
    expect(calls.get('body')).toBe(500);
    expect(calls.get('after')).toBe(1);
  });

  // F-A9-05: Zwei Schleifen, die sich über ihre Je-Eintrag-Zweige gegenseitig
  // erreichen, starteten einander ohne Ende neu.
  test('nested loops do not restart an enclosing loop', async () => {
    const calls = new Map<string, number>();
    installCountingNode(calls);
    const inner: GraphNode = {
      id: 'inner',
      type: 'registry',
      data: { nodeType: 'logic.loop', config: { sourceVariable: 'items' } },
    };

    const result = await run(
      [trigger, loop, inner, countNode('x'), countNode('y')],
      [
        { id: 'e1', source: 'trigger', target: 'loop' },
        { id: 'e2', source: 'loop', target: 'x', label: 'each' },
        { id: 'e3', source: 'x', target: 'inner' },
        { id: 'e4', source: 'inner', target: 'y', label: 'each' },
        { id: 'e5', source: 'y', target: 'loop' },
      ],
      'a,b',
    );

    expect(result.status).toBe('ok');
    expect(calls.get('x')).toBe(2);
    expect(calls.get('y')).toBe(4);
  });

  // F-N-dwf-01: Jeder Durchlauf haengte eine Kopie des gesamten bisherigen Logs an; das Log verdoppelte sich je Eintrag bis zum RangeError.
  test('appends only the new log entries of each iteration', async () => {
    const calls = new Map<string, number>();
    installCountingNode(calls);
    const items = Array.from({ length: 25 }, (_, i) => `i${i}`);

    const result = await run(
      [trigger, loop, countNode('body'), countNode('after')],
      [
        { id: 'e1', source: 'trigger', target: 'loop' },
        { id: 'e2', source: 'loop', target: 'body', label: 'each' },
        { id: 'e4', source: 'loop', target: 'after', label: 'done' },
      ],
      items.join(','),
    );

    expect(result.status).toBe('ok');
    expect(calls.get('body')).toBe(25);
    expect(calls.get('after')).toBe(1);
    for (const [i, item] of items.entries()) {
      expect(result.log.filter((line) => line === `loop:${i}:${item}`)).toHaveLength(1);
    }
    expect(result.log.length).toBeLessThan(100);
  });

  // F-A9-04: Eine Verzögerung im Je-Eintrag-Zweig deferierte beim ersten Eintrag;
  // die Schleife gab auf, die übrigen Einträge gingen still verloren.
  test('fails a delay inside the each branch before it schedules anything', async () => {
    const calls = new Map<string, number>();
    const delayDef: RegisteredWorkflowNode = {
      type: 'logic.delay',
      label: 'Verzögerung',
      category: 'logic',
      canvasType: 'registry',
      execute: async (_ctx, _config, nodeId): Promise<NodeExecuteResult> => {
        calls.set(nodeId, (calls.get(nodeId) ?? 0) + 1);
        return { status: 'ok', stop: true, deferred: true, message: 'delayed_until:later' };
      },
    };
    jest.mocked(getWorkflowNode).mockImplementation((type: string) =>
      type === 'logic.delay' ? delayDef : undefined,
    );

    const result = await run(
      [
        trigger,
        loop,
        { id: 'wait', type: 'registry', data: { nodeType: 'logic.delay', config: { delaySeconds: 60 } } },
        countNode('body'),
      ],
      [
        { id: 'e1', source: 'trigger', target: 'loop' },
        { id: 'e2', source: 'loop', target: 'wait', label: 'each' },
        { id: 'e3', source: 'wait', target: 'body' },
      ],
      'a,b,c',
    );

    expect(result.status).toBe('error');
    expect(result.deferred).not.toBe(true);
    expect(calls.get('wait')).toBeUndefined();
    expect(result.log.some((line) => line.includes('Schleife'))).toBe(true);
  });
});

describe('desktop trigger branches', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // F-N-dwf-03: Jede Trigger-Kante haengte eine Kopie des gesamten bisherigen Logs an; das Log verdoppelte sich je Kante.
  test('appends only the new log entries of each trigger branch', async () => {
    const calls = new Map<string, number>();
    installCountingNode(calls);
    const targets = ['a', 'b', 'c', 'd', 'e', 'f'];

    const result = await run(
      [trigger, ...targets.map((id) => countNode(id))],
      targets.map((id) => ({ id: `e-${id}`, source: 'trigger', target: id })),
      '',
    );

    expect(result.status).toBe('ok');
    for (const id of targets) expect(calls.get(id)).toBe(1);
    expect(result.log.filter((line) => line === 'graph_run_start')).toHaveLength(1);
    for (const id of targets) {
      expect(result.log.filter((line) => line === `branch:${id}`)).toHaveLength(1);
    }
    const branchStarts = targets.map((id) => result.log.indexOf(`branch:${id}`));
    expect(branchStarts).toEqual([...branchStarts].sort((x, y) => x - y));
    expect(result.log.length).toBeLessThan(40);
  });
});
