import { compileGraphToDefinition } from '../../electron/email/email-workflow-graph-compile';
import type { WorkflowGraphDocument } from '../../shared/email-workflow-graph';

describe('email-workflow-graph-compile', () => {
  it('compiles if/else branches into separate rules', () => {
    const doc: WorkflowGraphDocument = {
      version: 1,
      nodes: [
        { id: 't1', type: 'trigger', data: { kind: 'inbound' } },
        { id: 'c1', type: 'condition', data: { field: 'subject', op: 'contains', value: 'Rechnung' } },
        { id: 'a1', type: 'action', data: { actionType: 'tag', tag: 'rechnung' } },
        { id: 'a2', type: 'action', data: { actionType: 'tag', tag: 'sonst' } },
      ],
      edges: [
        { id: 'e0', source: 't1', target: 'c1' },
        { id: 'e1', source: 'c1', target: 'a1', label: 'ja' },
        { id: 'e2', source: 'c1', target: 'a2', label: 'nein' },
      ],
    };
    const def = compileGraphToDefinition(doc);
    expect(def.rules.length).toBe(2);
    const tags = def.rules.map((r) => r.then[0]).filter((s) => s?.type === 'tag');
    expect(tags).toHaveLength(2);
  });
});
