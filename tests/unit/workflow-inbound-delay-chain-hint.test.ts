import {
  findInboundDelaysHoldingChain as findCoreDelays,
  inboundChainStopReachableAfter as coreStopReachableAfter,
} from '../../packages/core/src/workflow/graph-validate';
import {
  findInboundDelaysHoldingChain as findSharedDelays,
  inboundChainStopReachableAfter as sharedStopReachableAfter,
} from '../../shared/email-workflow-graph-validate';

type Node = { id: string; type: string; data: Record<string, unknown> };
type Edge = { id: string; source: string; target: string; label?: string };

function graph(nodes: Node[], edges: Edge[]) {
  return { version: 1 as const, nodes, edges } as never;
}

const trigger: Node = { id: 't', type: 'trigger', data: { kind: 'inbound' } };
const delay: Node = { id: 'd', type: 'registry', data: { nodeType: 'logic.delay', config: { delaySeconds: 60 } } };
function registry(id: string, nodeType: string, config: Record<string, unknown> = {}): Node {
  return { id, type: 'registry', data: { nodeType, config } };
}

// F-D1-03: the server advances the inbound chain at a logic.delay only when no
// node behind it can still stop the chain; otherwise the chain stays serial and
// the editor must say so. Both copies (core for the server, shared for the
// renderer) have to agree.
describe.each([
  ['core', coreStopReachableAfter, findCoreDelays],
  ['shared', sharedStopReachableAfter, findSharedDelays],
] as const)('inbound delay chain hint (%s)', (_name, stopReachableAfter, findDelays) => {
  test('a delay followed only by ordinary nodes does not hold the chain', () => {
    const doc = graph(
      [trigger, delay, registry('tag', 'email.tag', { tag: 'x' }), registry('task', 'crm.create_task')],
      [
        { id: 'e1', source: 't', target: 'd' },
        { id: 'e2', source: 'd', target: 'tag' },
        { id: 'e3', source: 'tag', target: 'task' },
      ],
    );
    expect(stopReachableAfter(doc, 'd')).toBe(false);
    expect(findDelays(doc)).toEqual([]);
  });

  test.each([
    ['stopFurtherWorkflows in config', registry('stop', 'email.tag', { tag: 'x', stopFurtherWorkflows: true })],
    ['stopFurtherWorkflows as string', registry('stop', 'email.mark_spam', { stopFurtherWorkflows: 'true' })],
    ['stopFurtherWorkflows as placeholder', registry('stop', 'email.set_spam_status', { stopFurtherWorkflows: '{{flag}}' })],
    ['stopFurtherWorkflows on node data', { id: 'stop', type: 'action', data: { actionType: 'tag', stopFurtherWorkflows: true } }],
    ['logic.stop_after_spam', registry('stop', 'logic.stop_after_spam')],
  ] as const)('%s behind the delay holds the chain', (_label, stopper) => {
    const doc = graph(
      [trigger, delay, registry('ai', 'ai.classify'), stopper as Node],
      [
        { id: 'e1', source: 't', target: 'd' },
        { id: 'e2', source: 'd', target: 'ai' },
        // Auch hinter einem weiteren deferierten Knoten und auf einem Fehlerzweig.
        { id: 'e3', source: 'ai', target: 'stop', label: 'error' },
      ],
    );
    expect(stopReachableAfter(doc, 'd')).toBe(true);
    expect(findDelays(doc)).toEqual(['d']);
  });

  test('an explicit resumeNodeId counts as a path', () => {
    const doc = graph(
      [trigger, registry('d', 'logic.delay', { resumeNodeId: 'stop' }), registry('stop', 'logic.stop_after_spam')],
      [{ id: 'e1', source: 't', target: 'd' }],
    );
    expect(stopReachableAfter(doc, 'd')).toBe(true);
  });

  test('a stopper before the delay does not count', () => {
    const doc = graph(
      [trigger, registry('stop', 'logic.stop_after_spam'), delay, registry('tag', 'email.tag')],
      [
        { id: 'e1', source: 't', target: 'stop' },
        { id: 'e2', source: 'stop', target: 'd' },
        { id: 'e3', source: 'd', target: 'tag' },
      ],
    );
    expect(stopReachableAfter(doc, 'd')).toBe(false);
  });

  test('only inbound workflows get the hint', () => {
    const doc = graph(
      [{ id: 't', type: 'trigger', data: { kind: 'manual' } }, delay, registry('stop', 'logic.stop_after_spam')],
      [
        { id: 'e1', source: 't', target: 'd' },
        { id: 'e2', source: 'd', target: 'stop' },
      ],
    );
    expect(findDelays(doc)).toEqual([]);
    expect(findDelays(doc, { effectiveTrigger: 'inbound' })).toEqual(['d']);
  });
});
