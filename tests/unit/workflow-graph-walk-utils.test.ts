import {
  pickEdge,
  resolveResumeNodeAfter,
  type WorkflowGraphDocument,
} from '../../packages/core/src/workflow';

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

  it('returns target of ok edge after multi-port node', () => {
    const doc = graph(
      [
        { id: 'review-1', type: 'registry', data: { nodeType: 'ai.outbound_review' } },
        { id: 'release', type: 'registry', data: { nodeType: 'email.release_outbound' } },
        { id: 'tag-block', type: 'registry', data: { nodeType: 'email.tag' } },
      ],
      [
        { id: 'e_ok', source: 'review-1', target: 'release', label: 'ok' },
        { id: 'e_block', source: 'review-1', target: 'tag-block', label: 'block' },
      ],
    );
    expect(resolveResumeNodeAfter(doc, 'review-1')).toBe('release');
  });
});

describe('pickEdge (condition branches)', () => {
  it('does not follow yes edge when port is no and only ja branch exists', () => {
    const edges = [{ id: 'e1', source: 'c_amz', target: 'a_amz_tag', label: 'ja' }];
    expect(pickEdge(edges, 'no')).toBeUndefined();
    expect(pickEdge(edges, 'yes')?.target).toBe('a_amz_tag');
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

  it('does not follow a case branch when the switch falls back to default', () => {
    const edges = [
      { id: 'e1', source: 'sw', target: 'case-yes', label: 'yes' },
    ];
    expect(pickEdge(edges, 'default')).toBeUndefined();
  });

  it('follows explicit or unlabeled default branches', () => {
    expect(pickEdge([
      { id: 'e1', source: 'sw', target: 'case-yes', label: 'yes' },
      { id: 'e2', source: 'sw', target: 'fallback', label: 'default' },
    ], 'default')?.target).toBe('fallback');

    expect(pickEdge([
      { id: 'e1', source: 'node', target: 'next' },
    ], 'default')?.target).toBe('next');
  });
});

describe('pickEdge (ai.outbound_review ports)', () => {
  const edges = [
    { id: 'e_ok', source: 'r1', target: 'release', label: 'ok' },
    { id: 'e_block', source: 'r1', target: 'tag-block', label: 'block' },
    { id: 'e_error', source: 'r1', target: 'tag-error', label: 'error' },
  ];

  it('matches ok/block/error labels explicitly', () => {
    expect(pickEdge(edges, 'ok')?.target).toBe('release');
    expect(pickEdge(edges, 'block')?.target).toBe('tag-block');
    expect(pickEdge(edges, 'error')?.target).toBe('tag-error');
  });

  it('falls back to unlabeled edge only for ok, not for block/error/hold/send (fail-closed)', () => {
    const legacy = [{ id: 'e0', source: 'r1', target: 'release' }];
    expect(pickEdge(legacy, 'ok')?.target).toBe('release');
    expect(pickEdge(legacy, 'block')).toBeUndefined();
    expect(pickEdge(legacy, 'error')).toBeUndefined();
    expect(pickEdge(legacy, 'hold')).toBeUndefined();
    expect(pickEdge(legacy, 'send')).toBeUndefined();
  });

  it('unknown custom ports still follow the default/unlabeled edge', () => {
    const edges = [{ id: 'e0', source: 'act-1', target: 'switch-1' }];
    expect(pickEdge(edges, 'approved')?.target).toBe('switch-1');
  });
});
