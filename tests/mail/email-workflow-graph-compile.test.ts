import {
  compileGraphToDefinition,
  definitionToJson,
} from '../../electron/email/email-workflow-graph-compile';
import type { WorkflowGraphDocument } from '../../shared/email-workflow-graph';

function doc(over: Partial<WorkflowGraphDocument> = {}): WorkflowGraphDocument {
  return {
    nodes: [
      { id: 't1', type: 'trigger', position: { x: 0, y: 0 }, data: { kind: 'inbound' } },
      { id: 'c1', type: 'condition', position: { x: 0, y: 0 }, data: { field: 'subject', op: 'contains', value: 'x' } },
      { id: 'a1', type: 'action', position: { x: 0, y: 0 }, data: { actionType: 'tag', tag: 't' } },
    ],
    edges: [
      { id: 'e0', source: 't1', target: 'c1' },
      { id: 'e1', source: 'c1', target: 'a1', label: 'yes' },
    ],
    ...over,
  } as WorkflowGraphDocument;
}

describe('email-workflow-graph-compile', () => {
  test('returns empty rules without trigger or edges', () => {
    expect(compileGraphToDefinition({ nodes: [], edges: [] }).rules).toEqual([]);
    expect(compileGraphToDefinition({ nodes: [{ id: 'x', type: 'action', position: { x: 0, y: 0 }, data: {} }], edges: [] }).rules).toEqual([]);
    expect(compileGraphToDefinition({ ...doc(), edges: [] }).rules).toEqual([]);
  });

  test('compiles linear condition then action', () => {
    const rules = compileGraphToDefinition(doc()).rules;
    expect(rules).toHaveLength(1);
    expect(rules[0]?.then[0]).toEqual({ type: 'tag', tag: 't' });
  });

  test('preserves negated condition nodes as not conditions', () => {
    const rules = compileGraphToDefinition(doc({
      nodes: [
        { id: 't1', type: 'trigger', position: { x: 0, y: 0 }, data: { kind: 'inbound' } },
        { id: 'c1', type: 'condition', position: { x: 0, y: 0 }, data: { field: 'subject', op: 'contains', value: 'x', negated: true } },
        { id: 'a1', type: 'action', position: { x: 0, y: 0 }, data: { actionType: 'tag', tag: 'not-x' } },
      ],
    })).rules;

    expect(rules[0]?.when).toEqual({ not: { field: 'subject', op: 'contains', value: 'x' } });
  });

  test('splits yes/no branches into separate rules', () => {
    const graph = doc({
      nodes: [
        { id: 't1', type: 'trigger', position: { x: 0, y: 0 }, data: { kind: 'inbound' } },
        { id: 'c1', type: 'condition', position: { x: 0, y: 0 }, data: { field: 'subject', op: 'contains', value: 'urgent' } },
        { id: 'ay', type: 'action', position: { x: 0, y: 0 }, data: { actionType: 'tag', tag: 'yes' } },
        { id: 'an', type: 'action', position: { x: 0, y: 0 }, data: { actionType: 'archive' } },
      ],
      edges: [
        { id: 'e0', source: 't1', target: 'c1' },
        { id: 'ey', source: 'c1', target: 'ay', label: 'ja' },
        { id: 'en', source: 'c1', target: 'an', label: 'nein' },
      ],
    });
    const rules = compileGraphToDefinition(graph).rules;
    expect(rules).toHaveLength(2);
    expect(rules.some((r) => r.then.some((s) => s.type === 'archive'))).toBe(true);
    expect(rules.some((r) => 'not' in (r.when as object))).toBe(true);
  });

  test('maps all action types and stop flushes early', () => {
    const actions = [
      { actionType: 'mark_seen' },
      { actionType: 'hold_outbound', reason: 'r' },
      { actionType: 'set_category', path: 'Sales' },
      { actionType: 'link_customer' },
      { actionType: 'forward_copy', to: 'copy@x.de' },
      { actionType: 'tag_attachment_meta', tag: 'meta' },
      { actionType: 'ai_review', promptId: 3, blockKeyword: 'STOP' },
      { actionType: 'unknown' },
      { actionType: 'stop' },
    ] as const;
    const nodes = [
      { id: 't1', type: 'trigger', position: { x: 0, y: 0 }, data: { kind: 'inbound' } },
      { id: 'c1', type: 'condition', position: { x: 0, y: 0 }, data: { field: 'subject', op: 'contains', value: 'a' } },
      ...actions.map((data, i) => ({
        id: `a${i}`,
        type: 'action' as const,
        position: { x: 0, y: 0 },
        data,
      })),
    ];
    const edges = [
      { id: 'e0', source: 't1', target: 'c1' },
      ...actions.map((_, i) => ({
        id: `e${i + 1}`,
        source: i === 0 ? 'c1' : `a${i - 1}`,
        target: `a${i}`,
        label: i === 0 ? 'true' : undefined,
      })),
    ];
    const rules = compileGraphToDefinition({ nodes, edges }).rules;
    expect(rules.length).toBeGreaterThan(0);
    const steps = rules.flatMap((r) => r.then);
    expect(steps.some((s) => s.type === 'ai_review')).toBe(true);
    expect(steps.some((s) => s.type === 'stop')).toBe(true);
  });

  test('drops trigger-to-action paths instead of emitting skipped unconditional rules', () => {
    const graph = {
      nodes: [
        { id: 't1', type: 'trigger', position: { x: 0, y: 0 }, data: { kind: 'inbound' } },
        { id: 'a1', type: 'action', position: { x: 0, y: 0 }, data: { actionType: 'tag', tag: 'orphan' } },
      ],
      edges: [{ id: 'e0', source: 't1', target: 'a1' }],
    } as WorkflowGraphDocument;
    expect(compileGraphToDefinition(graph).rules).toEqual([]);
  });

  test('definitionToJson serializes', () => {
    const json = definitionToJson({ version: 1, rules: [] });
    expect(JSON.parse(json).version).toBe(1);
  });
});
