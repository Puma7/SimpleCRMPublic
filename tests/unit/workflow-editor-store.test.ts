import type { WorkflowGraphDocument } from '../../shared/email-workflow-graph';
import { useWorkflowEditorStore } from '../../src/app/email/stores/workflow-editor-store';

describe('workflow editor store graph conversion', () => {
  afterEach(() => {
    useWorkflowEditorStore.getState().resetFromGraph(null);
  });

  test('reloads switch edge labels as source handles and persists labels on save', () => {
    const doc: WorkflowGraphDocument = {
      version: 1,
      nodes: [
        { id: 't1', type: 'trigger', data: { kind: 'manual' }, position: { x: 0, y: 0 } },
        {
          id: 'sw',
          type: 'registry',
          data: { nodeType: 'logic.switch', config: { field: 'ai.class', cases: 'rechnung,support' } },
          position: { x: 10.6, y: 20.4 },
        },
        { id: 'a1', type: 'action', data: { actionType: 'tag', tag: 'support' }, position: { x: 30, y: 40 } },
      ],
      edges: [
        { id: 'e1', source: 't1', target: 'sw' },
        { id: 'e2', source: 'sw', target: 'a1', label: 'support' },
      ],
    };

    useWorkflowEditorStore.getState().resetFromGraph(doc);

    const loaded = useWorkflowEditorStore.getState();
    expect(loaded.edges.find((edge) => edge.id === 'e2')?.sourceHandle).toBe('support');

    const saved = loaded.toGraphDocument();
    expect(saved.edges.find((edge) => edge.id === 'e2')?.label).toBe('support');
    expect(saved.nodes.find((node) => node.id === 'sw')?.position).toEqual({ x: 11, y: 20 });
  });

  test('keeps stale switch labels visible without binding them to missing handles', () => {
    const doc: WorkflowGraphDocument = {
      version: 1,
      nodes: [
        { id: 't1', type: 'trigger', data: { kind: 'manual' } },
        {
          id: 'sw',
          type: 'registry',
          data: { nodeType: 'logic.switch', config: { field: 'ai.class', cases: 'rechnung' } },
        },
        { id: 'a1', type: 'action', data: { actionType: 'tag', tag: 'alt' } },
      ],
      edges: [
        { id: 'e1', source: 't1', target: 'sw' },
        { id: 'e2', source: 'sw', target: 'a1', label: 'support' },
      ],
    };

    useWorkflowEditorStore.getState().resetFromGraph(doc);

    const edge = useWorkflowEditorStore.getState().edges.find((candidate) => candidate.id === 'e2');
    expect(edge?.label).toBe('support');
    expect(edge?.sourceHandle).toBeUndefined();
  });
});
