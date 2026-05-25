import { useWorkflowEditorStore } from '../../src/app/email/stores/workflow-editor-store';
import {
  applyAutoLayoutToDocument,
  computeAutoLayoutPositions,
  isValidGraphPosition,
} from '../../src/components/email/workflow/workflow-graph-layout';
import type { WorkflowGraphDocument } from '../../shared/email-workflow-graph';

describe('workflow graph layout', () => {
  const sample: WorkflowGraphDocument = {
    version: 1,
    nodes: [
      { id: 't1', type: 'trigger', data: { kind: 'inbound' } },
      {
        id: 'c1',
        type: 'condition',
        data: { field: 'subject', op: 'contains', value: 'test', caseInsensitive: true },
      },
      { id: 'a1', type: 'action', data: { actionType: 'archive' } },
    ],
    edges: [
      { id: 'e1', source: 't1', target: 'c1' },
      { id: 'e2', source: 'c1', target: 'a1', label: 'ja' },
    ],
  };

  test('auto layout assigns distinct positions per layer', () => {
    const pos = computeAutoLayoutPositions(sample);
    expect(isValidGraphPosition(pos.t1)).toBe(true);
    expect(isValidGraphPosition(pos.c1)).toBe(true);
    expect(isValidGraphPosition(pos.a1)).toBe(true);
    expect(pos.t1!.y).toBeLessThan(pos.c1!.y);
    expect(pos.c1!.y).toBeLessThan(pos.a1!.y);
  });

  test('editor store persists positions in graph document', () => {
    useWorkflowEditorStore.getState().resetFromGraph(sample);
    useWorkflowEditorStore.getState().setNodes(
      useWorkflowEditorStore.getState().nodes.map((n) =>
        n.id === 'a1' ? { ...n, position: { x: 400, y: 320 } } : n,
      ),
    );
    const doc = useWorkflowEditorStore.getState().toGraphDocument();
    const a1 = doc.nodes.find((n) => n.id === 'a1');
    expect(a1?.position).toEqual({ x: 400, y: 320 });
  });

  test('reload restores saved positions from graph_json', () => {
    const withPos: WorkflowGraphDocument = {
      ...sample,
      nodes: [
        { ...sample.nodes[0], position: { x: 120, y: 80 } },
        { ...sample.nodes[1], position: { x: 360, y: 240 } },
        { ...sample.nodes[2], position: { x: 520, y: 400 } },
      ],
    };
    useWorkflowEditorStore.getState().resetFromGraph(withPos);
    const a1 = useWorkflowEditorStore.getState().nodes.find((n) => n.id === 'a1');
    expect(a1?.position).toEqual({ x: 520, y: 400 });
  });
});
