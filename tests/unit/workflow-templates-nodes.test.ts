import { WORKFLOW_TEMPLATES, listBuiltinWorkflowNodeCatalog } from '@simplecrm/core';

// Structural guarantee: every node a shipped template uses must be addable in the
// editor (registry nodeType in the catalog) or be a known legacy action. This
// catches "template references a node the editor doesn't know" (e.g. the missing
// email.release_outbound), so templates stay editable and don't render as unknown.
const LEGACY_ACTION_TYPES = new Set([
  'tag',
  'mark_seen',
  'archive',
  'hold_outbound',
  'set_category',
  'link_customer',
  'forward_copy',
  'tag_attachment_meta',
  'ai_review',
  'stop',
]);

describe('workflow templates only use known nodes', () => {
  const catalogTypes = new Set(listBuiltinWorkflowNodeCatalog().map((entry) => entry.type));

  for (const template of WORKFLOW_TEMPLATES) {
    test(`template "${template.id}" uses only catalog/known nodes`, () => {
      for (const node of template.graph.nodes) {
        const data = node.data as { nodeType?: string; actionType?: string };
        if (node.type === 'trigger' || node.type === 'condition') continue;
        if (node.type === 'registry') {
          expect({ id: template.id, node: node.id, nodeType: data.nodeType }).toMatchObject({
            nodeType: expect.any(String),
          });
          expect(catalogTypes.has(String(data.nodeType))).toBe(true);
          continue;
        }
        if (node.type === 'action') {
          expect(LEGACY_ACTION_TYPES.has(String(data.actionType))).toBe(true);
          continue;
        }
        throw new Error(`Unexpected node type "${node.type}" in template ${template.id}`);
      }
    });
  }

  test('every registry catalog entry has a label', () => {
    for (const entry of listBuiltinWorkflowNodeCatalog()) {
      expect(typeof entry.label).toBe('string');
      expect(entry.label.length).toBeGreaterThan(0);
    }
  });

  // The editor renders entry.description as inline node documentation, so a
  // missing description is a documentation gap. This test pins it.
  test('every catalog entry has an inline description for the editor', () => {
    const missing: string[] = [];
    for (const entry of listBuiltinWorkflowNodeCatalog()) {
      if (!entry.description || entry.description.trim().length < 10) {
        missing.push(entry.type);
      }
    }
    expect(missing).toEqual([]);
  });
});
