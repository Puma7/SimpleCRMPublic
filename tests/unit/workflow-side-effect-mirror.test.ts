import {
  LOGIC_INMEMORY_NODE_TYPES as CORE_LOGIC_INMEMORY_NODE_TYPES,
  READ_ONLY_WORKFLOW_NODE_TYPES as CORE_READ_ONLY_WORKFLOW_NODE_TYPES,
  workflowGraphHasSideEffectNode as coreWorkflowGraphHasSideEffectNode,
} from '../../packages/core/src/workflow/graph-validate';
import {
  LOGIC_INMEMORY_NODE_TYPES as SHARED_LOGIC_INMEMORY_NODE_TYPES,
  READ_ONLY_WORKFLOW_NODE_TYPES as SHARED_READ_ONLY_WORKFLOW_NODE_TYPES,
  workflowGraphHasSideEffectNode as sharedWorkflowGraphHasSideEffectNode,
} from '../../shared/email-workflow-graph-validate';

/**
 * Der Editor (shared) und die kanonische Implementierung (packages/core, die der
 * Server benutzt) entscheiden mit zwei getrennten Allowlists, ob ein Graph
 * Seiteneffekte hat. Driften sie auseinander, sperrt die UI Nutzern mit
 * workflows.edit Aenderungen, die der Server zulaesst (oder — schlimmer —
 * umgekehrt). Dieser Test haelt die Spiegel deckungsgleich.
 */
describe('side-effect allowlist mirror', () => {
  const sorted = (values: ReadonlySet<string>) => [...values].sort();

  test('read-only node types are identical', () => {
    expect(sorted(SHARED_READ_ONLY_WORKFLOW_NODE_TYPES)).toEqual(sorted(CORE_READ_ONLY_WORKFLOW_NODE_TYPES));
  });

  test('in-memory logic node types are identical', () => {
    expect(sorted(SHARED_LOGIC_INMEMORY_NODE_TYPES)).toEqual(sorted(CORE_LOGIC_INMEMORY_NODE_TYPES));
  });

  test('every exempt node type is judged the same by both implementations', () => {
    const exempt = [...CORE_READ_ONLY_WORKFLOW_NODE_TYPES, ...CORE_LOGIC_INMEMORY_NODE_TYPES];
    for (const nodeType of exempt) {
      const doc = {
        version: 1,
        nodes: [
          { id: 't1', type: 'trigger', data: { kind: 'inbound' } },
          { id: 'n1', type: 'registry', data: { nodeType } },
        ],
        edges: [{ id: 'e1', source: 't1', target: 'n1' }],
      } as never;
      expect({ nodeType, sideEffect: sharedWorkflowGraphHasSideEffectNode(doc) })
        .toEqual({ nodeType, sideEffect: coreWorkflowGraphHasSideEffectNode(doc) });
      expect(sharedWorkflowGraphHasSideEffectNode(doc)).toBe(false);
    }
  });

  test('logic.stop_after_spam is exempt in both — several shipped templates use it', () => {
    expect(SHARED_LOGIC_INMEMORY_NODE_TYPES.has('logic.stop_after_spam')).toBe(true);
    expect(CORE_LOGIC_INMEMORY_NODE_TYPES.has('logic.stop_after_spam')).toBe(true);
  });

  test('a genuine side-effect node still trips both', () => {
    const doc = {
      version: 1,
      nodes: [
        { id: 't1', type: 'trigger', data: { kind: 'inbound' } },
        { id: 'n1', type: 'registry', data: { nodeType: 'logic.delay' } },
      ],
      edges: [{ id: 'e1', source: 't1', target: 'n1' }],
    } as never;
    expect(sharedWorkflowGraphHasSideEffectNode(doc)).toBe(true);
    expect(coreWorkflowGraphHasSideEffectNode(doc)).toBe(true);
  });
});
