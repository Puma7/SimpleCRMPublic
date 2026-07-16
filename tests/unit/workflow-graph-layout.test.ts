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

  test('diamond graph lays out without overlaps, branches share a rank', () => {
    const diamond: WorkflowGraphDocument = {
      version: 1,
      nodes: [
        { id: 't1', type: 'trigger', data: { kind: 'inbound' } },
        {
          id: 'c1',
          type: 'condition',
          data: { field: 'subject', op: 'contains', value: 'x', caseInsensitive: true },
        },
        { id: 'a1', type: 'action', data: { actionType: 'tag', tag: 'ja' } },
        { id: 'a2', type: 'action', data: { actionType: 'tag', tag: 'nein' } },
        { id: 'a3', type: 'action', data: { actionType: 'archive' } },
      ],
      edges: [
        { id: 'e1', source: 't1', target: 'c1' },
        { id: 'e2', source: 'c1', target: 'a1', label: 'ja' },
        { id: 'e3', source: 'c1', target: 'a2', label: 'nein' },
        { id: 'e4', source: 'a1', target: 'a3' },
        { id: 'e5', source: 'a2', target: 'a3' },
      ],
    };
    const pos = computeAutoLayoutPositions(diamond);
    for (const id of ['t1', 'c1', 'a1', 'a2', 'a3']) {
      expect(isValidGraphPosition(pos[id])).toBe(true);
    }
    const coords = Object.values(pos).map((p) => `${p!.x}/${p!.y}`);
    expect(new Set(coords).size).toBe(coords.length);
    expect(pos.a1!.y).toBe(pos.a2!.y);
    expect(pos.a1!.x).not.toBe(pos.a2!.x);
    expect(pos.c1!.y).toBeGreaterThan(pos.t1!.y);
    expect(pos.a3!.y).toBeGreaterThan(pos.a1!.y);
  });

  test('dangling edges (unknown node ids) do not break the layout', () => {
    const withDangling: WorkflowGraphDocument = {
      ...sample,
      edges: [
        ...sample.edges,
        { id: 'e-del1', source: 'c1', target: 'gone-node' },
        { id: 'e-del2', source: 'ghost', target: 'a1' },
      ],
    };
    const pos = computeAutoLayoutPositions(withDangling);
    expect(isValidGraphPosition(pos.t1)).toBe(true);
    expect(isValidGraphPosition(pos.c1)).toBe(true);
    expect(isValidGraphPosition(pos.a1)).toBe(true);
    expect(pos['gone-node']).toBeUndefined();
    expect(pos.ghost).toBeUndefined();
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
