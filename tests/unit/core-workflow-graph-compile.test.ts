import { compileGraphToDefinition } from '../../packages/core/src/workflow/graph-compile';
import type { WorkflowGraphDocument } from '../../shared/email-workflow-graph';

describe('core workflow graph compile', () => {
  test('keeps trigger-to-action fallback rules for UI/server compiler parity', () => {
    const graph: WorkflowGraphDocument = {
      version: 1,
      nodes: [
        { id: 't1', type: 'trigger', position: { x: 0, y: 0 }, data: { kind: 'inbound' } },
        { id: 'a1', type: 'action', position: { x: 0, y: 0 }, data: { actionType: 'tag', tag: 'direct' } },
      ],
      edges: [{ id: 'e0', source: 't1', target: 'a1' }],
    };

    expect(compileGraphToDefinition(graph).rules).toEqual([
      { when: null, then: [{ type: 'tag', tag: 'direct' }] },
    ]);
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

  /** `levels` Bedingungen, deren Ja-/Nein-Zweige getrennt taggen und dann wieder zusammenlaufen. */
  function reconvergingChain(levels: number): WorkflowGraphDocument {
    const nodes: WorkflowGraphDocument['nodes'] = [{ id: 't1', type: 'trigger', data: { kind: 'inbound' } }];
    const edges: WorkflowGraphDocument['edges'] = [{ id: 'e-t', source: 't1', target: 'c0' }];
    for (let i = 0; i < levels; i++) {
      const next = i + 1 < levels ? `c${i + 1}` : 'end';
      nodes.push(
        { id: `c${i}`, type: 'condition', data: { field: 'subject', op: 'contains', value: `x${i}` } },
        { id: `a${i}`, type: 'action', data: { actionType: 'tag', tag: `a${i}` } },
        { id: `b${i}`, type: 'action', data: { actionType: 'tag', tag: `b${i}` } },
      );
      edges.push(
        { id: `y${i}`, source: `c${i}`, target: `a${i}`, label: 'yes' },
        { id: `n${i}`, source: `c${i}`, target: `b${i}`, label: 'no' },
        { id: `ea${i}`, source: `a${i}`, target: next },
        { id: `eb${i}`, source: `b${i}`, target: next },
      );
    }
    nodes.push({ id: 'end', type: 'action', data: { actionType: 'tag', tag: 'end' } });
    return { version: 1, nodes, edges };
  }

  // C-A82: Wieder zusammenlaufende Bedingungen wurden ungebremst in 2^n Regeln aufgefaechert (20 Ebenen: rund 1 Mio. Regeln, Sekunden im Event-Loop).
  test('rejects a path explosion with a clear error instead of materialising 2^n rules', () => {
    const started = Date.now();
    expect(() => compileGraphToDefinition(reconvergingChain(20))).toThrow('Workflow-Graph zu komplex');
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  test('still compiles a branched graph with 1024 paths completely', () => {
    const rules = compileGraphToDefinition(reconvergingChain(10)).rules;
    expect(rules).toHaveLength(1024);
    expect(rules[0]).toEqual({
      when: { all: Array.from({ length: 10 }, (_, i) => ({ field: 'subject', op: 'contains', value: `x${i}` })) },
      then: [{ type: 'tag', tag: 'a9' }, { type: 'tag', tag: 'end' }],
    });
  });
});