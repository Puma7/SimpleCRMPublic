import type { WorkflowGraphDocument } from '../../shared/email-workflow-graph';
import { pickEdge, resolveResumeNodeAfter } from '../../electron/workflow/graph-walk-utils';

function graph(
  nodes: WorkflowGraphDocument['nodes'],
  edges: WorkflowGraphDocument['edges'],
): WorkflowGraphDocument {
  return { version: 1, nodes, edges };
}

describe('resolveResumeNodeAfter', () => {
  it('returns target of default edge after delay node', () => {
    const doc = graph(
      [
        { id: 'delay-1', type: 'registry', data: { registryType: 'logic.delay' } },
        { id: 'next-1', type: 'registry', data: { registryType: 'logic.set_variable' } },
      ],
      [{ id: 'e1', source: 'delay-1', target: 'next-1', label: 'default' }],
    );
    expect(resolveResumeNodeAfter(doc, 'delay-1')).toBe('next-1');
  });

  it('returns null when delay has no outgoing edges', () => {
    const doc = graph(
      [{ id: 'delay-1', type: 'registry', data: { registryType: 'logic.delay' } }],
      [],
    );
    expect(resolveResumeNodeAfter(doc, 'delay-1')).toBeNull();
  });
});

describe('pickEdge (logic.switch)', () => {
  it('matches case-insensitive port labels', () => {
    const edges = [
      { id: 'e1', source: 'sw', target: 'a', label: 'A' },
      { id: 'e2', source: 'sw', target: 'b', label: 'B' },
    ];
    expect(pickEdge(edges, 'a')?.target).toBe('a');
    expect(pickEdge(edges, 'b')?.target).toBe('b');
  });
});
