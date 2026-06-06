import { WORKFLOW_TEMPLATES, parseGraphDocument } from '@simplecrm/core';

// P1-7: prefab E-Commerce support templates must be valid, executable graphs
// (the server parses graph_json via parseGraphDocument before running).
describe('e-commerce workflow templates', () => {
  const ecom = WORKFLOW_TEMPLATES.filter((template) => template.id.startsWith('ecom-'));

  test('ships the standard e-commerce support cases with unique ids', () => {
    expect(ecom.length).toBeGreaterThanOrEqual(8);
    const ids = ecom.map((template) => template.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('every workflow template parses to a non-empty graph with a trigger', () => {
    for (const template of WORKFLOW_TEMPLATES) {
      const doc = parseGraphDocument(JSON.stringify(template.graph));
      expect(doc).not.toBeNull();
      expect(doc!.nodes.length).toBeGreaterThan(1);
      expect(doc!.nodes.some((node) => node.type === 'trigger')).toBe(true);
    }
  });

  test('each e-commerce template is an inbound condition→tag→category routing flow', () => {
    for (const template of ecom) {
      expect(template.trigger).toBe('inbound');
      const doc = parseGraphDocument(JSON.stringify(template.graph))!;
      expect(doc.nodes.some((node) => node.type === 'condition')).toBe(true);
      const actionTypes = doc.nodes
        .filter((node) => node.type === 'action')
        .map((node) => (node.data as { actionType?: string }).actionType);
      expect(actionTypes).toEqual(expect.arrayContaining(['tag', 'set_category']));
    }
  });
});
