import { compileGraphToDefinition } from '../../packages/core/src/workflow/graph-compile';
import type { WorkflowGraphDocument } from '../../shared/email-workflow-graph';

describe('core workflow graph compile', () => {
  test('drops trigger-to-action paths instead of emitting server-inconsistent unconditional rules', () => {
    const graph: WorkflowGraphDocument = {
      version: 1,
      nodes: [
        { id: 't1', type: 'trigger', position: { x: 0, y: 0 }, data: { kind: 'inbound' } },
        { id: 'a1', type: 'action', position: { x: 0, y: 0 }, data: { actionType: 'tag', tag: 'direct' } },
      ],
      edges: [{ id: 'e0', source: 't1', target: 'a1' }],
    };

    expect(compileGraphToDefinition(graph).rules).toEqual([]);
  });

  test('keeps registry-only fallback rules without conditions', () => {
    const graph: WorkflowGraphDocument = {
      version: 1,
      nodes: [
        { id: 't1', type: 'trigger', position: { x: 0, y: 0 }, data: { kind: 'inbound' } },
        {
          id: 'r1',
          type: 'registry',
          position: { x: 0, y: 0 },
          data: { nodeType: 'ai.classify', label: 'Classify', config: { promptId: 1 } },
        },
      ],
      edges: [{ id: 'e0', source: 't1', target: 'r1' }],
    };

    expect(compileGraphToDefinition(graph).rules).toEqual([
      { when: null, then: [{ type: 'registry', nodeType: 'ai.classify', config: { promptId: 1 } }] },
    ]);
  });
});