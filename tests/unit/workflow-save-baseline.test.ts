import { useWorkflowEditorStore } from '@/app/email/stores/workflow-editor-store';

/**
 * Regression: workflow-shell vergleicht beim Speichern die aktuelle
 * `toGraphDocument()`-Serialisierung mit einer Baseline, um zu entscheiden, ob
 * der Graph geändert wurde (nur dann greift das workflows.manage-Gate für
 * aktive Seiteneffekt-Workflows). Wird die Baseline aus dem ROHEN graph_json
 * gebildet, meldet ein älterer/importierter Graph ohne Positionen sofort eine
 * Änderung — und ein Nutzer mit workflows.edit könnte nicht einmal den Namen
 * speichern. Die Baseline muss daher aus derselben kanonischen Form stammen.
 */
describe('workflow save baseline', () => {
  const storedDoc = {
    version: 1,
    nodes: [
      { id: 't1', type: 'trigger', data: { kind: 'inbound' } },
      { id: 'c1', type: 'condition', position: { x: 10.4, y: 20.6 }, data: { field: 'subject', op: 'contains', value: 'x', caseInsensitive: true } },
      { id: 'a1', type: 'action', data: { actionType: 'tag', tag: 'neu' } },
    ],
    edges: [
      { id: 'e1', source: 't1', target: 'c1' },
      { id: 'e2', source: 'c1', target: 'a1', label: 'ja' },
    ],
  } as never;

  test('raw graph_json differs from the canonical save serialization', () => {
    useWorkflowEditorStore.getState().resetFromGraph(storedDoc);
    const canonical = JSON.stringify(useWorkflowEditorStore.getState().toGraphDocument());

    // Die rohe Form ist NICHT vergleichbar (fehlende/ungerundete Positionen).
    expect(JSON.stringify(storedDoc)).not.toEqual(canonical);
  });

  test('canonical baseline stays stable without an edit', () => {
    useWorkflowEditorStore.getState().resetFromGraph(storedDoc);
    const baseline = JSON.stringify(useWorkflowEditorStore.getState().toGraphDocument());

    // Zweiter Save-Pfad-Aufruf ohne Nutzeraktion ⇒ kein graphChanged.
    const atSave = JSON.stringify(useWorkflowEditorStore.getState().toGraphDocument());
    expect(atSave).toEqual(baseline);
  });

  test('a real node edit still changes the canonical serialization', () => {
    useWorkflowEditorStore.getState().resetFromGraph(storedDoc);
    const baseline = JSON.stringify(useWorkflowEditorStore.getState().toGraphDocument());

    const nodes = useWorkflowEditorStore.getState().nodes;
    useWorkflowEditorStore.getState().setNodes(
      nodes.map((n) => (n.id === 'a1' ? { ...n, data: { ...n.data, tag: 'anders' } } : n)),
    );

    expect(JSON.stringify(useWorkflowEditorStore.getState().toGraphDocument())).not.toEqual(baseline);
  });
});
